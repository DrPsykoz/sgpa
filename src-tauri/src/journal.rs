//! Journal de diagnostic : la trace qu'une panne laisse derrière elle.
//!
//! # Pourquoi un fichier
//!
//! En release, `windows_subsystem = "windows"` supprime la console. Une panique
//! Rust, une exception JavaScript, un palier de migration qui échoue : rien de
//! tout cela n'apparaît nulle part. L'application se ferme, ou blanchit, et il
//! ne reste à l'enseignant que « ça n'a pas marché » — soit exactement
//! l'information qui ne permet pas de corriger. Ce module écrit ces événements
//! dans `data/logs/sgpa-AAAA-MM-JJ.log`, qu'on peut relire ou envoyer après
//! coup.
//!
//! # Pourquoi en clair, hors de la base
//!
//! Le journal **n'est pas chiffré**, et c'est un choix, pas un oubli. La panne
//! qu'il doit couvrir inclut « la base ne s'ouvre plus » : un journal rangé dans
//! `sgpa.db` serait illisible précisément le jour où il sert. Il vit donc à
//! côté, en texte, lisible session verrouillée — comme l'indice de mot de passe
//! de `sgpa.keys`, et pour la même raison.
//!
//! # CE QUI EN DÉCOULE, ET QUI N'EST PAS NÉGOCIABLE
//!
//! Un fichier en clair sur une clé USB qu'on perd dans un couloir **ne contient
//! aucune donnée personnelle**. Pas un prénom d'élève, pas une étiquette de
//! besoin particulier, pas une note, pas un secret. Le journal enregistre des
//! faits sur le **code** — quelle commande a échoué, quel fichier et quelle
//! ligne, quel palier — jamais les **données** que ce code manipulait.
//!
//! Ce n'est pas une consigne de vigilance, c'est une contrainte de forme :
//! `diagnostics::log_command_failure` ne prend **que le nom de la commande**, et
//! n'a aucun paramètre où un message pourrait se glisser. La raison est
//! précise : plusieurs messages d'erreur français interpolent une valeur, et
//! l'un d'eux nomme un élève (« {prénom} {nom} n'est pas inscrit dans cette
//! classe », `commands/absences.rs`). Recopier le message affiché aurait donc
//! écrit le nom d'un mineur en clair sur la clé. Le nom de la commande dit où
//! regarder, ce qui est tout ce dont on a besoin, et ne dit rien de qui que ce
//! soit.
//!
//! # Il ne casse jamais rien
//!
//! Aucune fonction ne rend d'erreur et aucune ne panique : ce module est appelé
//! **depuis le crochet de panique**, où une seconde panique avorterait le
//! processus. Un dossier en lecture seule, un disque plein, une horloge
//! fantaisiste : le journal ne s'écrit pas, et l'application continue. C'est la
//! même règle que le semis du calendrier scolaire (`db/holidays.rs`), pour la
//! même raison — un outil de confort qui fait échouer ce qu'il observe est pire
//! que son absence.
//!
//! # Il est borné
//!
//! Un fichier par jour, les quinze derniers jours, et un plafond par fichier :
//! une boucle de rendu qui journalise à chaque image ne doit pas remplir la clé
//! USB de l'enseignant. Au-delà du plafond, une seule ligne le signale et le
//! reste est abandonné.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// Dossier des journaux, posé par `init` au démarrage.
///
/// Tant qu'il est vide, écrire est un **non-événement** : pas de repli vers un
/// chemin devinable. Un repli sur le dossier de l'exécutable sèmerait des
/// fichiers dans `target/` à chaque `cargo test`, et surtout il écrirait hors du
/// dossier de données — ce que la portabilité interdit.
static DOSSIER: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Le plafond de taille n'est annoncé qu'une fois par exécution.
static PLAFOND_SIGNALE: AtomicBool = AtomicBool::new(false);

const PREFIXE: &str = "sgpa-";
const SUFFIXE: &str = ".log";

/// Journaux conservés. Au-delà, un incident est oublié — et c'est voulu : une
/// panne qu'on n'a pas signalée en deux semaines n'est pas une panne qu'on
/// diagnostiquera dans six mois, et la clé USB a mieux à porter.
const JOURS_CONSERVES: u64 = 15;

/// Plafond par fichier et par jour.
const TAILLE_MAX: u64 = 1024 * 1024;

/// Longueur maximale d'un détail. Une pile d'appels JavaScript complète fait
/// plusieurs kilo-octets ; ses premières lignes portent toute l'information.
const DETAIL_MAX: usize = 2000;

#[derive(Clone, Copy)]
pub enum Niveau {
    /// Quelque chose n'a pas marché.
    Erreur,
    /// Quelque chose a marché, et le savoir aide à lire la suite : version
    /// lancée, palier appliqué, calendrier semé.
    Avis,
}

impl Niveau {
    /// Largeur fixe : les deux étiquettes alignent les colonnes du fichier.
    fn etiquette(self) -> &'static str {
        match self {
            Niveau::Erreur => "ERREUR",
            Niveau::Avis => "AVIS  ",
        }
    }
}

/// Installe le dossier des journaux, purge les anciens et inscrit la ligne de
/// démarrage.
///
/// Appelé juste après `portable::resolve`, donc avant la fenêtre. Un échec de
/// `resolve` lui-même n'est pas journalisable — il n'y a alors aucun dossier où
/// écrire — et reste couvert par la `MessageBoxW` de `fatal()`.
pub fn init(logs_dir: &Path) {
    *verrou() = Some(logs_dir.to_path_buf());
    purger(logs_dir);

    // Cette ligne vaut la moitié d'un diagnostic : elle date l'exécution, nomme
    // la version du binaire et celle du schéma, et dit où l'application a
    // réellement rangé ses données — donc si `SGPA_DATA_DIR` était posée, et si
    // elle tourne depuis la clé ou depuis le disque du poste.
    avis(
        "démarrage",
        &format!(
            "SGPA {} — schéma {} — {} — données : {}",
            env!("CARGO_PKG_VERSION"),
            crate::db::migrations::SCHEMA_VERSION,
            std::env::consts::OS,
            logs_dir.display(),
        ),
    );
}

/// Détourne le crochet de panique vers le journal, puis laisse le crochet
/// d'origine faire son travail.
///
/// Sans cela, une panique en release ferme la fenêtre sans un mot : le crochet
/// par défaut écrit sur une sortie d'erreur qui n'existe pas. `PanicHookInfo`
/// s'affiche déjà sous la forme « panicked at fichier:ligne: message », ce qui
/// est exactement ce qu'on veut lire.
///
/// Le crochet précédent est conservé et rappelé : en `cargo test` et en
/// `tauri dev`, le message habituel continue de s'afficher.
pub fn installer_capture_de_panique() {
    let precedent = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        erreur("panique", &info.to_string());
        precedent(info);
    }));
}

/// Inscrit un échec.
pub fn erreur(origine: &str, detail: &str) {
    ecrire(Niveau::Erreur, origine, detail);
}

/// Inscrit un fait qui aide à lire les échecs voisins.
pub fn avis(origine: &str, detail: &str) {
    ecrire(Niveau::Avis, origine, detail);
}

fn ecrire(niveau: Niveau, origine: &str, detail: &str) {
    // La console de `tauri dev` reste servie. En release elle n'existe pas, et
    // la bibliothèque standard traite alors l'écriture comme un rejet réussi :
    // `eprintln!` ne peut donc pas paniquer ici, ce qui importe puisque ce
    // chemin est aussi celui du crochet de panique.
    eprintln!("[sgpa] {} {origine} : {detail}", niveau.etiquette().trim_end());

    let Some(dossier) = verrou().clone() else {
        return;
    };
    ecrire_dans(&dossier, niveau, origine, detail);
}

/// Cœur de l'écriture, isolé du dossier global pour être testable sans toucher
/// à l'état du processus.
///
/// Ne rend rien : chaque échec est absorbé. Le seul comportement attendu d'un
/// dossier inaccessible est qu'il ne se passe rien.
fn ecrire_dans(dossier: &Path, niveau: Niveau, origine: &str, detail: &str) {
    if fs::create_dir_all(dossier).is_err() {
        return;
    }

    let chemin = dossier.join(nom_du_jour());
    let taille = fs::metadata(&chemin).map(|m| m.len()).unwrap_or(0);

    let ligne = if taille < TAILLE_MAX {
        format!(
            "{} {} {} : {}\n",
            horodatage(),
            niveau.etiquette(),
            replier(origine),
            plafonner(&replier(detail)),
        )
    } else if PLAFOND_SIGNALE.fetch_or(true, Ordering::Relaxed) {
        // Déjà annoncé : on abandonne en silence plutôt que de répéter la même
        // ligne jusqu'à remplir le support.
        return;
    } else {
        format!(
            "{} {} journal : plafond de {} Ko atteint pour aujourd'hui, les \
             événements suivants ne sont plus enregistrés.\n",
            horodatage(),
            Niveau::Avis.etiquette(),
            TAILLE_MAX / 1024,
        )
    };

    let Ok(mut fichier) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&chemin)
    else {
        return;
    };

    // `sync_all` parce que le lecteur de ce fichier est quelqu'un qui enquête
    // sur un arrêt brutal : une ligne restée dans le cache d'écriture d'une clé
    // USB retirée sans précaution n'a jamais existé.
    if fichier.write_all(ligne.as_bytes()).is_ok() {
        let _ = fichier.sync_all();
    }
}

/// Un événement, une ligne : le fichier reste lisible d'un coup d'œil et
/// `findstr` y retrouve un horodatage en début de ligne. Les retours à la ligne
/// d'une pile d'appels sont donc repliés plutôt que recopiés.
fn replier(texte: &str) -> String {
    texte.replace(['\n', '\r'], " ⏎ ").trim().to_string()
}

fn plafonner(texte: &str) -> String {
    if texte.len() <= DETAIL_MAX {
        return texte.to_string();
    }
    let mut fin = DETAIL_MAX;
    while fin > 0 && !texte.is_char_boundary(fin) {
        fin -= 1;
    }
    format!("{} […tronqué]", &texte[..fin])
}

/// Heure **locale**, comme partout ailleurs dans ce projet : un incident de
/// 00h30 le 1er décembre journalisé en UTC paraîtrait daté du 30 novembre, et
/// l'on chercherait l'événement dans le fichier de la veille.
fn horodatage() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// Chemin du journal du jour, pour les écrans qui le relisent.
pub fn chemin_du_jour(logs_dir: &Path) -> PathBuf {
    logs_dir.join(nom_du_jour())
}

/// Reconnaît un fichier de ce module, pour compter sans se tromper de voisin.
pub fn est_un_journal(nom: &str) -> bool {
    nom.strip_prefix(PREFIXE)
        .and_then(|reste| reste.strip_suffix(SUFFIXE))
        .is_some_and(|date| date.len() == 10)
}

fn nom_du_jour() -> String {
    format!(
        "{PREFIXE}{}{SUFFIXE}",
        chrono::Local::now().format("%Y-%m-%d")
    )
}

/// Supprime les journaux antérieurs à la fenêtre conservée.
///
/// La date est lue dans le **nom du fichier** et jamais dans ses métadonnées,
/// pour la même raison que `maintenance::stamp_to_datetime` : copier le dossier
/// d'un poste à l'autre réécrit les dates du système de fichiers, et tous les
/// journaux paraîtraient alors datés du même instant.
fn purger(dossier: &Path) {
    let Some(limite) = chrono::Local::now()
        .date_naive()
        .checked_sub_days(chrono::Days::new(JOURS_CONSERVES))
    else {
        return;
    };
    let limite = limite.format("%Y-%m-%d").to_string();

    let Ok(entrees) = fs::read_dir(dossier) else {
        return;
    };
    for entree in entrees.flatten() {
        let nom = entree.file_name();
        let Some(nom) = nom.to_str() else {
            continue;
        };
        let Some(date) = nom
            .strip_prefix(PREFIXE)
            .and_then(|reste| reste.strip_suffix(SUFFIXE))
        else {
            continue;
        };
        // Le test de longueur écarte tout ce qui n'est pas une date : un fichier
        // que l'enseignant aurait renommé ne doit pas être emporté.
        if date.len() == 10 && date < limite.as_str() {
            let _ = fs::remove_file(entree.path());
        }
    }
}

fn verrou() -> std::sync::MutexGuard<'static, Option<PathBuf>> {
    // Même précaution que `AppState::lock_db` : une panique ailleurs empoisonne
    // le mutex, et un journal qui refuserait d'écrire à partir de là serait muet
    // juste après le seul événement qui valait la peine d'être inscrit.
    DOSSIER.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dossier_neuf(nom: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(nom);
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn une_erreur_est_inscrite_dans_le_fichier_du_jour() {
        let dir = dossier_neuf("sgpa-journal-ecriture");
        ecrire_dans(&dir, Niveau::Erreur, "test", "quelque chose a cassé");

        let contenu = fs::read_to_string(dir.join(nom_du_jour())).unwrap();
        assert!(contenu.contains("ERREUR"));
        assert!(contenu.contains("test : quelque chose a cassé"));
        // L'horodatage ouvre la ligne : c'est ce qui rend le fichier triable.
        let aujourdhui = chrono::Local::now().format("%Y-%m-%d").to_string();
        assert!(contenu.starts_with(&aujourdhui));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn un_evenement_tient_sur_une_seule_ligne() {
        let dir = dossier_neuf("sgpa-journal-une-ligne");
        ecrire_dans(&dir, Niveau::Erreur, "pile", "haut\nmilieu\r\nbas");

        let contenu = fs::read_to_string(dir.join(nom_du_jour())).unwrap();
        assert_eq!(
            contenu.lines().count(),
            1,
            "les retours à la ligne doivent être repliés"
        );
        assert!(contenu.contains("haut ⏎ milieu"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn un_detail_demesure_est_tronque() {
        let dir = dossier_neuf("sgpa-journal-tronque");
        // Un caractère multioctet, pour que la coupe tombe sur une frontière
        // interdite si elle est faite à l'octet près — ce qui paniquerait.
        ecrire_dans(&dir, Niveau::Erreur, "pile", &"é".repeat(4000));

        let contenu = fs::read_to_string(dir.join(nom_du_jour())).unwrap();
        assert!(contenu.contains("[…tronqué]"));
        assert!(contenu.len() < 3000);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn la_purge_emporte_les_anciens_et_garde_les_recents() {
        let dir = dossier_neuf("sgpa-journal-purge");
        fs::create_dir_all(&dir).unwrap();
        let hier = chrono::Local::now()
            .date_naive()
            .checked_sub_days(chrono::Days::new(1))
            .unwrap()
            .format("%Y-%m-%d")
            .to_string();

        let ancien = dir.join(format!("{PREFIXE}2020-01-01{SUFFIXE}"));
        let recent = dir.join(format!("{PREFIXE}{hier}{SUFFIXE}"));
        let etranger = dir.join("notes-de-l-enseignant.txt");
        for fichier in [&ancien, &recent, &etranger] {
            fs::write(fichier, b"ligne\n").unwrap();
        }

        purger(&dir);

        assert!(!ancien.exists(), "un journal de 2020 doit être supprimé");
        assert!(recent.exists(), "celui d'hier est dans la fenêtre conservée");
        assert!(
            etranger.exists(),
            "la purge ne touche qu'à ses propres fichiers"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn un_dossier_impossible_ne_fait_rien_echouer() {
        // Le journal est appelé depuis le crochet de panique : s'il pouvait
        // paniquer ou remonter une erreur, il transformerait un incident
        // diagnosticable en arrêt brutal du processus. Ici le dossier demandé a
        // un FICHIER pour parent, donc `create_dir_all` ne peut pas réussir.
        let dir = dossier_neuf("sgpa-journal-barrage");
        fs::create_dir_all(&dir).unwrap();
        let barrage = dir.join("barrage");
        fs::write(&barrage, b"x").unwrap();

        ecrire_dans(
            &barrage.join("logs"),
            Niveau::Erreur,
            "test",
            "rien ne doit arriver",
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sans_dossier_installe_ecrire_est_un_non_evenement() {
        // `DOSSIER` est vide dans les tests : aucun fichier ne doit apparaître à
        // côté du binaire de test, et l'appel ne doit pas échouer pour autant.
        erreur("test", "ceci ne doit atterrir nulle part");
    }
}
