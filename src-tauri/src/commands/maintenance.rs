use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;

use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct BackupInfo {
    pub file_name: String,
    pub size_bytes: u64,
    pub created_at: String,
}

/// Nombre de sauvegardes manuelles conservées.
///
/// Un seul critère, volontairement : un seuil de taille ou d'ancienneté se règle
/// mal et finit toujours par supprimer la seule copie dont on avait besoin.
const KEEP_BACKUPS: usize = 10;

/// Mêmes préfixe et extension que les copies prises par `db::migrations`, pour
/// que les deux apparaissent dans la même liste.
const BACKUP_PREFIX: &str = "sgpa_";
const BACKUP_EXT: &str = ".db";

/// Caractères que Windows interdit dans un nom de fichier.
const FORBIDDEN: &[char] = &['<', '>', ':', '"', '|', '?', '*'];

/// Noms de périphériques réservés par Windows, quelle que soit l'extension :
/// `CON.pdf` n'est pas un fichier, c'est la console.
const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Longueurs maximales du tronc et de l'extension d'un export.
///
/// Windows plafonne le chemin complet à 260 caractères par défaut, et le dossier
/// exports peut se trouver au fond d'une arborescence de clé USB.
const MAX_STEM: usize = 100;
const MAX_EXT: usize = 16;

/// Nombre maximal de tentatives de désambiguïsation d'un nom d'export.
const MAX_DISAMBIGUATION: u32 = 999;

/// Nom de schéma sous lequel la sauvegarde fraîchement écrite est relue.
///
/// Inutilisable comme nom de table par ailleurs : c'est un espace de noms
/// éphémère, attaché puis détaché dans la même fonction.
const VERIFICATION_SCHEMA: &str = "verification_sauvegarde";

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn create_backup(state: tauri::State<'_, AppState>) -> Result<BackupInfo, String> {
    let conn = state.conn()?;

    let dir = &state.layout.backups_dir;
    std::fs::create_dir_all(dir).map_err(|e| {
        format!(
            "Le dossier des sauvegardes n'a pas pu être créé.\n\
             Dossier : {}\n\
             Détail : {e}\n\
             Vérifiez que le support n'est pas protégé en écriture.",
            dir.display()
        )
    })?;

    // La base est la seule horloge du projet. Un horodatage pris côté Rust
    // dériverait de celui des colonnes `created_at`, et deux sauvegardes faites
    // de part et d'autre d'un changement d'heure ne s'ordonneraient plus entre
    // elles ni avec le reste des données.
    let stamp: String = conn
        .query_row("SELECT strftime('%Y%m%d-%H%M%S', 'now')", [], |row| {
            row.get(0)
        })
        .map_err(|e| format!("L'horodatage de la sauvegarde a échoué.\nDétail : {e}"))?;

    let file_name = format!("{BACKUP_PREFIX}{stamp}{BACKUP_EXT}");
    let target = dir.join(&file_name);
    if target.exists() {
        // `VACUUM INTO` refuse une cible existante : autant le dire en français
        // plutôt que de laisser remonter le message de SQLite.
        return Err("Une sauvegarde vient d'être créée à la même seconde. \
                    Patientez un instant puis recommencez."
            .to_string());
    }

    // `VACUUM INTO` est une instruction SQL : aucune dépendance supplémentaire,
    // un fichier unique et compacté, et surtout un instantané cohérent. Un
    // `std::fs::copy` du fichier ouvert est à proscrire : il peut capturer une
    // lecture déchirée, c'est-à-dire une sauvegarde inutilisable qui ne se
    // signale qu'au moment où on en a besoin.
    let target_path = target.to_string_lossy().into_owned();
    conn.execute("VACUUM INTO ?1", [target_path.as_str()])
        .map_err(|e| {
            format!(
                "La sauvegarde n'a pas pu être écrite.\n\
                 Fichier : {target_path}\n\
                 Détail : {e}\n\
                 Vérifiez l'espace disponible et que le support n'est pas \
                 protégé en écriture."
            )
        })?;

    // Une sauvegarde chiffrée illisible ressemble trait pour trait à une bonne :
    // même nom, même taille plausible, et rien pour la distinguer jusqu'au jour
    // où on en a besoin. On la relit donc avant de la déclarer écrite.
    if let Err(message) = verifier_sauvegarde(&conn, &target_path) {
        // Un fichier qui ne s'ouvre pas ne doit pas rester dans la liste des
        // sauvegardes : il y ferait figure de filet de sécurité.
        let _ = std::fs::remove_file(&target);
        return Err(message);
    }

    conn.execute(
        "UPDATE app_settings SET last_backup_at = datetime('now') WHERE id = 1",
        [],
    )
    .map_err(|e| {
        format!(
            "La sauvegarde est bien écrite, mais sa date n'a pas pu être notée.\n\
             Détail : {e}"
        )
    })?;

    // La rotation ne touche plus à la base : on rend le verrou avant de parcourir
    // le dossier.
    drop(conn);

    let size_bytes = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
    let created_at = stamp_to_datetime(&stamp).unwrap_or_else(|| stamp.clone());

    rotate(dir);

    Ok(BackupInfo {
        file_name,
        size_bytes,
        created_at,
    })
}

#[tauri::command]
pub fn list_backups(state: tauri::State<'_, AppState>) -> Result<Vec<BackupInfo>, String> {
    require_unlocked(&state)?;

    // Les copies prises avant une migration figurent aussi dans la liste : ce
    // sont des sauvegardes restaurables, les masquer reviendrait à cacher la
    // seule qui compte le jour où une mise à jour s'est mal passée.
    Ok(scan(&state.layout.backups_dir)
        .into_iter()
        .map(|found| found.info)
        .collect())
}

#[tauri::command]
pub fn reveal_data_dir(state: tauri::State<'_, AppState>) -> Result<(), String> {
    require_unlocked(&state)?;

    let root = &state.layout.root;
    // `open_path` ouvre le dossier lui-même ; `reveal_item_in_dir` ouvrirait le
    // dossier parent avec `data` simplement sélectionné.
    tauri_plugin_opener::open_path(root, None::<&str>).map_err(|e| {
        format!(
            "Le dossier de données n'a pas pu être ouvert.\n\
             Dossier : {}\n\
             Détail : {e}\n\
             Ouvrez-le à la main depuis l'explorateur de fichiers.",
            root.display()
        )
    })
}

#[tauri::command]
pub fn save_export(
    state: tauri::State<'_, AppState>,
    file_name: String,
    bytes: Vec<u8>,
    open_after: bool,
) -> Result<String, String> {
    require_unlocked(&state)?;

    if bytes.is_empty() {
        return Err("Le document à enregistrer est vide : rien n'a été écrit. \
                    Relancez la génération du document."
            .to_string());
    }

    write_export(&state.layout.exports_dir, &file_name, &bytes, open_after)
}

/// Écrit `bytes` dans `exports/` sous un nom assaini, et l'ouvre si demandé.
///
/// Partagée avec `attachments::export_seance_attachment`, et c'est la raison
/// de la scission : une pièce jointe de 9 Mo n'a aucune raison de traverser
/// l'IPC en tableau de nombres JSON pour revenir se faire écrire ici. Elle va
/// de la base au fichier sans jamais passer par le front.
///
/// **Ce fichier est en clair**, comme tout ce qui vit dans `exports/` : aucune
/// application du poste ne sait lire dans une base SQLCipher. Le chemin rendu
/// n'est donc pas un simple accusé de réception — c'est l'information que
/// l'appelant doit remonter à l'écran.
pub(super) fn write_export(
    dir: &Path,
    file_name: &str,
    bytes: &[u8],
    open_after: bool,
) -> Result<String, String> {
    let safe_name = sanitize_file_name(file_name)?;

    std::fs::create_dir_all(dir).map_err(|e| {
        format!(
            "Le dossier des exports n'a pas pu être créé.\n\
             Dossier : {}\n\
             Détail : {e}\n\
             Vérifiez que le support n'est pas protégé en écriture.",
            dir.display()
        )
    })?;

    let (path, mut file) = create_export_file(dir, &safe_name)?;

    let mut outcome = file.write_all(bytes);
    if outcome.is_ok() {
        // `sync_all` avant de rendre la main : sur une clé USB retirée sans
        // précaution, un document resté dans le cache d'écriture n'existe pas.
        outcome = file.sync_all();
    }
    // Sous Windows, certains lecteurs refusent un fichier encore tenu ouvert en
    // écriture : on ferme avant de proposer l'ouverture.
    drop(file);

    if let Err(e) = outcome {
        // Un document tronqué est pire que pas de document : l'enseignant
        // croirait avoir son bilan et ne s'en apercevrait qu'en le remettant.
        let _ = std::fs::remove_file(&path);
        return Err(format!(
            "L'écriture du document a échoué et le fichier partiel a été \
             supprimé.\n\
             Fichier : {}\n\
             Détail : {e}\n\
             Vérifiez l'espace disponible sur le support.",
            path.display()
        ));
    }

    let full_path = path.to_string_lossy().into_owned();

    if open_after {
        tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| {
            // Le document EST enregistré : le message doit donner son chemin,
            // sinon l'enseignant conclut à un échec, recommence, et fabrique un
            // doublon à chaque tentative.
            format!(
                "Le document a bien été enregistré, mais SGPA n'a pas pu \
                 l'ouvrir.\n\
                 Fichier : {full_path}\n\
                 Détail : {e}\n\
                 Ouvrez-le depuis le dossier exports."
            )
        })?;
    }

    Ok(full_path)
}

// ---------------------------------------------------------------------------
// Verrou
// ---------------------------------------------------------------------------

/// Ces commandes ne lisent pas la base, mais touchent au dossier de données, qui
/// contient la base elle-même et les bilans nominatifs. Elles passent par
/// `conn()` pour que le garde-fou du verrou reste l'unique point de contrôle de
/// l'application, sans réimplémenter le test ici.
fn require_unlocked(state: &AppState) -> Result<(), String> {
    drop(state.conn()?);
    Ok(())
}

// ---------------------------------------------------------------------------
// Sauvegardes
// ---------------------------------------------------------------------------

struct BackupFile {
    info: BackupInfo,
    /// Faux pour les copies prises automatiquement avant une migration.
    manual: bool,
}

/// Relit la sauvegarde qui vient d'être écrite, avec la clé de la session.
///
/// `ATTACH` sans clause `KEY` reprend la clé de la base principale : c'est ce
/// que fait `VACUUM INTO` lui-même pour écrire la copie, donc la clé et le sel
/// des deux fichiers sont exactement les mêmes. C'est aussi la seule façon de
/// rouvrir la sauvegarde avec la clé courante sans garder une seconde copie de
/// la clé maître en mémoire : `AppState` n'en détient aucune, délibérément.
///
/// La lecture porte sur une vraie ligne. Un simple attachement ne déchiffrerait
/// que l'en-tête et le schéma, alors que ce sont les pages de données qui
/// manquent à une copie tronquée.
fn verifier_sauvegarde(conn: &Connection, chemin: &str) -> Result<(), String> {
    conn.execute(
        &format!("ATTACH DATABASE ?1 AS {VERIFICATION_SCHEMA}"),
        [chemin],
    )
    .map_err(|source| echec_verification(chemin, source))?;

    let lue = conn.query_row(
        &format!("SELECT id FROM {VERIFICATION_SCHEMA}.app_settings WHERE id = 1"),
        [],
        |row| row.get::<_, i64>(0),
    );

    // Détachement dans tous les cas : un fichier resté attaché reste ouvert par
    // le processus, et la suppression qui suit un échec échouerait à son tour.
    let _ = conn.execute(&format!("DETACH DATABASE {VERIFICATION_SCHEMA}"), []);

    lue.map(|_| ())
        .map_err(|source| echec_verification(chemin, source))
}

fn echec_verification(chemin: &str, source: rusqlite::Error) -> String {
    format!(
        "La sauvegarde a été écrite mais ne se relit pas : elle n'a donc pas été \
         conservée.\n\
         Fichier : {chemin}\n\
         Détail : {source}\n\
         Recommencez. Si l'échec se répète, c'est le support qui est en cause : \
         copiez data/sgpa.db et data/{keys} sur un disque sain avant toute autre \
         manipulation.",
        keys = crate::keys::FILE_NAME
    )
}

/// Inventaire du dossier de sauvegardes, de la plus récente à la plus ancienne.
fn scan(dir: &Path) -> Vec<BackupFile> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        // Dossier absent ou illisible : aucune sauvegarde à lister. Ce n'est pas
        // une panne à remonter à l'enseignant, c'est une liste vide.
        Err(_) => return Vec::new(),
    };

    let mut found: Vec<BackupFile> = Vec::new();
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().into_owned();
        let Some((created_at, manual)) = parse_backup_name(&file_name) else {
            continue;
        };
        found.push(BackupFile {
            info: BackupInfo {
                file_name,
                size_bytes: meta.len(),
                created_at,
            },
            manual,
        });
    }

    // `created_at` est de largeur fixe et complété par des zéros : l'ordre
    // lexicographique décroissant EST l'ordre chronologique inverse.
    found.sort_by(|a, b| b.info.created_at.cmp(&a.info.created_at));
    found
}

/// Supprime les sauvegardes manuelles au-delà des `KEEP_BACKUPS` plus récentes.
///
/// Les copies prises automatiquement avant une migration (`sgpa_v1_…`) en sont
/// exclues : ce sont les seules traces d'un schéma antérieur, et précisément
/// celles vers lesquelles on revient quand une mise à jour s'est mal passée.
fn rotate(dir: &Path) {
    let obsolete = scan(dir)
        .into_iter()
        .filter(|found| found.manual)
        .skip(KEEP_BACKUPS);

    for old in obsolete {
        let path = dir.join(&old.info.file_name);
        // Un échec de suppression ne doit pas transformer une sauvegarde réussie
        // en erreur : la copie est écrite, c'est ce qui compte.
        if let Err(e) = std::fs::remove_file(&path) {
            crate::journal::erreur(
                "sauvegardes/rotation",
                &format!("{} non supprimé ({e})", path.display()),
            );
        }
    }
}

/// Décompose `sgpa_AAAAMMJJ-HHMMSS.db` et `sgpa_v<n>_AAAAMMJJ-HHMMSS.db`.
///
/// Renvoie la date lisible et un booléen vrai pour les sauvegardes manuelles —
/// les seules que la rotation a le droit de supprimer.
fn parse_backup_name(file_name: &str) -> Option<(String, bool)> {
    let rest = file_name
        .strip_prefix(BACKUP_PREFIX)?
        .strip_suffix(BACKUP_EXT)?;
    match rest.rsplit_once('_') {
        Some((_, stamp)) => stamp_to_datetime(stamp).map(|date| (date, false)),
        None => stamp_to_datetime(rest).map(|date| (date, true)),
    }
}

/// `20260919-142530` → `2026-09-19 14:25:30`.
///
/// La date est lue dans le nom du fichier et jamais dans les métadonnées du
/// système de fichiers : copier le dossier de sauvegardes d'un poste à l'autre
/// réécrit celles-ci, et toutes les copies paraîtraient alors dater du même
/// instant. Le format produit est celui de `datetime('now')`, comme partout
/// ailleurs dans la base.
fn stamp_to_datetime(stamp: &str) -> Option<String> {
    let (date, time) = stamp.split_once('-')?;
    if date.len() != 8 || time.len() != 6 {
        return None;
    }
    if !date.bytes().chain(time.bytes()).all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(format!(
        "{}-{}-{} {}:{}:{}",
        &date[0..4],
        &date[4..6],
        &date[6..8],
        &time[0..2],
        &time[2..4],
        &time[4..6],
    ))
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/// Transforme un libellé venu du front en nom de fichier sûr.
///
/// Partagée avec `attachments` : le nom d'une pièce jointe subit le même
/// traitement, et pour la même raison — il finira comme nom de fichier dans
/// `exports/` le jour où l'enseignant ouvre la pièce dans Word.
///
/// Deux traitements distincts, parce que les deux fautes n'ont pas la même
/// origine :
/// - un séparateur de chemin ne sort pas d'une frappe légitime, c'est un chemin
///   et non un nom : on **refuse**, pour que l'anomalie se voie et pour que rien
///   ne puisse jamais être écrit hors du dossier exports ;
/// - les caractères interdits par Windows viennent d'un titre saisi par
///   l'enseignant (« Bilan 6e A : trimestre 1 ») : on les **remplace**, un export
///   rejeté à cause d'un deux-points serait incompréhensible.
pub(super) fn sanitize_file_name(raw: &str) -> Result<String, String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err("Le document n'a pas de nom. Donnez-lui un nom de fichier.".to_string());
    }

    // Une fois les séparateurs écartés, « .. » ne désigne plus de dossier parent :
    // il ne reste à refuser que les noms qui SONT « . » ou « .. ».
    if name.contains('/') || name.contains('\\') || name == "." || name == ".." {
        return Err(
            "Le nom du document doit désigner un fichier, pas un chemin : \
                    retirez les « \\ », les « / » et les « .. »."
                .to_string(),
        );
    }

    let cleaned: String = name
        .chars()
        .map(|c| {
            if FORBIDDEN.contains(&c) || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect();

    // Windows retire silencieusement les points et espaces de fin : « bilan. »
    // devient « bilan », et le fichier créé n'est plus celui qu'on croit rouvrir.
    let trimmed = cleaned.trim_end_matches(is_trailing_noise).trim_start();

    let (stem, ext) = split_extension(trimmed);
    let stem = truncate_chars(stem, MAX_STEM).trim_end_matches(is_trailing_noise);
    if stem.is_empty() {
        return Err("Le nom du document ne contient aucun caractère utilisable.".to_string());
    }

    let mut stem = stem.to_string();
    if RESERVED
        .iter()
        .any(|reserved| stem.eq_ignore_ascii_case(reserved))
    {
        stem.push('_');
    }

    Ok(match ext {
        Some(ext) => format!("{stem}.{}", truncate_chars(ext, MAX_EXT)),
        None => stem,
    })
}

fn is_trailing_noise(c: char) -> bool {
    c == ' ' || c == '.'
}

/// Sépare `bilan.pdf` en `("bilan", Some("pdf"))`.
///
/// Un nom commençant par un point n'a pas d'extension : il EST caché.
fn split_extension(file_name: &str) -> (&str, Option<&str>) {
    match file_name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => (stem, Some(ext)),
        _ => (file_name, None),
    }
}

/// Tronque sur une frontière de caractère : couper au milieu d'un « é »
/// ferait paniquer le découpage.
fn truncate_chars(value: &str, max: usize) -> &str {
    match value.char_indices().nth(max) {
        Some((index, _)) => &value[..index],
        None => value,
    }
}

/// Crée `bilan.pdf`, ou `bilan-2.pdf`, `bilan-3.pdf`… si le nom est déjà pris.
///
/// Écraser silencieusement serait le pire comportement possible ici : deux
/// bilans d'un même trimestre portent naturellement le même nom, et le second
/// effacerait le premier sans rien dire.
///
/// `create_new` échoue si le fichier existe : c'est la seule façon de réserver
/// un nom sans laisser de fenêtre entre le test d'existence et l'écriture.
fn create_export_file(dir: &Path, file_name: &str) -> Result<(PathBuf, File), String> {
    let (stem, ext) = split_extension(file_name);

    for n in 1..=MAX_DISAMBIGUATION {
        let candidate = match (n, ext) {
            (1, _) => file_name.to_string(),
            (_, Some(ext)) => format!("{stem}-{n}.{ext}"),
            (_, None) => format!("{stem}-{n}"),
        };
        let path = dir.join(&candidate);

        match File::options().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => {
                return Err(format!(
                    "Le fichier n'a pas pu être créé.\n\
                     Fichier : {}\n\
                     Détail : {e}\n\
                     Vérifiez que le support n'est pas protégé en écriture.",
                    path.display()
                ))
            }
        }
    }

    Err(format!(
        "Trop de documents portent déjà le nom « {file_name} » dans le dossier \
         exports. Faites-y le ménage, ou donnez un autre nom au document."
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sgpa-maint-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn la_verification_relit_la_sauvegarde_avec_la_cle_courante() {
        let dir = temp_dir("verification");
        let cle = crate::keys::MasterKey::from_bytes_for_tests([0x5a; 32]);
        let mut conn = crate::db::open_encrypted(&dir.join("sgpa.db"), &cle).unwrap();
        crate::db::migrations::run(&mut conn, &dir).unwrap();

        let bonne = dir.join("copie.db");
        conn.execute("VACUUM INTO ?1", [bonne.to_string_lossy().as_ref()])
            .unwrap();
        verifier_sauvegarde(&conn, bonne.to_string_lossy().as_ref())
            .expect("une copie fraîche doit se relire avec la clé de la session");

        // Ce que la vérification existe pour attraper : un fichier qui porte le
        // bon nom, la bonne extension, et ne contient pas une base.
        let tronquee = dir.join("tronquee.db");
        std::fs::write(&tronquee, b"ceci n'est pas une base").unwrap();
        assert!(verifier_sauvegarde(&conn, tronquee.to_string_lossy().as_ref()).is_err());

        // Le détachement a bien lieu même après un échec : sans lui, ce second
        // appel buterait sur un nom de schéma déjà pris.
        verifier_sauvegarde(&conn, bonne.to_string_lossy().as_ref())
            .expect("la connexion reste utilisable après un échec");

        conn.close().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn horodatage_devient_date_lisible() {
        assert_eq!(
            stamp_to_datetime("20260919-142530").as_deref(),
            Some("2026-09-19 14:25:30")
        );
        assert_eq!(stamp_to_datetime("20260919"), None);
        assert_eq!(stamp_to_datetime("abcdefgh-142530"), None);
        assert_eq!(stamp_to_datetime("20260919-1425"), None);
    }

    #[test]
    fn noms_de_sauvegarde_reconnus() {
        assert_eq!(
            parse_backup_name("sgpa_20260919-142530.db"),
            Some(("2026-09-19 14:25:30".to_string(), true))
        );
        // Copie d'avant migration : reconnue, mais hors rotation.
        assert_eq!(
            parse_backup_name("sgpa_v1_20260919-142530.db"),
            Some(("2026-09-19 14:25:30".to_string(), false))
        );
        assert_eq!(parse_backup_name("sgpa.db"), None);
        assert_eq!(parse_backup_name("notes.txt"), None);
    }

    #[test]
    fn le_nom_ne_peut_pas_sortir_du_dossier() {
        for tentative in [
            "../sgpa.db",
            "..\\..\\Windows\\System32\\charge.dll",
            "sous-dossier/bilan.pdf",
            "C:\\bilan.pdf",
            "..",
            "   ",
        ] {
            assert!(
                sanitize_file_name(tentative).is_err(),
                "aurait dû être refusé : {tentative}"
            );
        }
    }

    #[test]
    fn les_caracteres_interdits_sont_remplaces() {
        assert_eq!(
            sanitize_file_name("Bilan 6e A : trimestre 1.pdf").unwrap(),
            "Bilan 6e A - trimestre 1.pdf"
        );
        assert_eq!(
            sanitize_file_name("a<b>c|d?e*f\"g.pdf").unwrap(),
            "a-b-c-d-e-f-g.pdf"
        );
        // Les accents, eux, sont parfaitement valides.
        assert_eq!(
            sanitize_file_name("Bilan élève — T1.pdf").unwrap(),
            "Bilan élève — T1.pdf"
        );
    }

    #[test]
    fn les_noms_reserves_de_windows_sont_neutralises() {
        assert_eq!(sanitize_file_name("CON.pdf").unwrap(), "CON_.pdf");
        assert_eq!(sanitize_file_name("nul").unwrap(), "nul_");
        assert_eq!(sanitize_file_name("console.pdf").unwrap(), "console.pdf");
    }

    #[test]
    fn les_points_et_espaces_finaux_disparaissent() {
        assert_eq!(sanitize_file_name("bilan.pdf...").unwrap(), "bilan.pdf");
        assert_eq!(sanitize_file_name("  bilan.pdf  ").unwrap(), "bilan.pdf");
    }

    #[test]
    fn le_nom_reste_dans_les_limites_de_windows() {
        let long = format!("{}.pdf", "é".repeat(400));
        let safe = sanitize_file_name(&long).unwrap();
        assert_eq!(
            safe.chars().count(),
            MAX_STEM + 4,
            "tronc tronqué, extension gardée"
        );
        assert!(safe.ends_with(".pdf"));
    }

    #[test]
    fn les_doublons_sont_desambiguises() {
        let dir = temp_dir("doublon");

        let noms: Vec<String> = (0..3)
            .map(|_| {
                let (path, file) = create_export_file(&dir, "bilan.pdf").unwrap();
                drop(file);
                path.file_name().unwrap().to_string_lossy().into_owned()
            })
            .collect();

        assert_eq!(noms, vec!["bilan.pdf", "bilan-2.pdf", "bilan-3.pdf"]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn la_rotation_garde_les_dix_plus_recentes() {
        let dir = temp_dir("rotation");

        for jour in 1..=12 {
            std::fs::write(dir.join(format!("sgpa_202601{jour:02}-080000.db")), b"x").unwrap();
        }
        std::fs::write(dir.join("sgpa_v1_20250101-080000.db"), b"x").unwrap();
        std::fs::write(dir.join("notes.txt"), b"x").unwrap();

        rotate(&dir);

        let restantes = scan(&dir);
        assert_eq!(
            restantes.iter().filter(|b| b.manual).count(),
            KEEP_BACKUPS,
            "dix sauvegardes manuelles conservées"
        );
        // Les deux plus anciennes sauvegardes manuelles sont parties…
        assert!(!dir.join("sgpa_20260101-080000.db").exists());
        assert!(!dir.join("sgpa_20260102-080000.db").exists());
        // …mais ni la copie d'avant migration, ni ce qui n'est pas une sauvegarde.
        assert!(dir.join("sgpa_v1_20250101-080000.db").exists());
        assert!(dir.join("notes.txt").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn la_liste_va_de_la_plus_recente_a_la_plus_ancienne() {
        let dir = temp_dir("tri");

        std::fs::write(dir.join("sgpa_20260101-080000.db"), b"x").unwrap();
        std::fs::write(dir.join("sgpa_20260301-080000.db"), b"xx").unwrap();
        std::fs::write(dir.join("sgpa_20260201-080000.db"), b"xxx").unwrap();

        let noms: Vec<String> = scan(&dir).into_iter().map(|b| b.info.file_name).collect();
        assert_eq!(
            noms,
            vec![
                "sgpa_20260301-080000.db",
                "sgpa_20260201-080000.db",
                "sgpa_20260101-080000.db",
            ]
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn un_dossier_absent_donne_une_liste_vide() {
        let dir = std::env::temp_dir().join("sgpa-maint-nulle-part");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(scan(&dir).is_empty());
    }
}
