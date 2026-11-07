//! Verrou de session, récupération et réglages.
//!
//! Plus aucun condensat : le mot de passe n'est plus « vérifié », il est ce qui
//! déballe la clé maître de `data/sgpa.keys`. Un mot de passe faux ne produit
//! donc pas un refus poli mais une clé qui n'ouvre rien, et la base reste un
//! bloc d'octets.
//!
//! Trois conséquences pour ce module :
//!
//! 1. `get_lock_status` ne touche **jamais** la base. Tout ce qu'il répond vit
//!    dans `sgpa.keys`, seul fichier lisible session verrouillée.
//! 2. `setup_lock`, `unlock` et `recover` sont les seuls endroits où une
//!    `Connection` naît ; `lock` le seul où elle meurt. La clé de chiffrement
//!    vit dans le contexte SQLCipher de cette connexion : verrouiller, c'est la
//!    fermer.
//! 3. Le nom de l'enseignant ne sort plus de la base chiffrée. L'écran de
//!    déverrouillage n'affiche donc aucun nom : une clé USB trouvée ne doit pas
//!    dire à qui elle appartient.
//!
//! Tauri livre les mots de passe dans des `String` que personne n'efface. Chaque
//! commande les enveloppe dans un `Zeroizing` dès sa première ligne : c'est le
//! dernier moment où leur effacement est encore garanti.

use std::path::Path;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::state::AppState;
use crate::{db, device, keys};

const AVERAGE_RULES: [&str; 2] = ["unweighted_mean", "weighted_by_count"];
const REMOVED_COMPETENCY_POLICIES: [&str; 2] = ["keep", "ignore"];

/// État du verrou, lisible **sans** la base.
///
/// `password_hint` vient de `sgpa.keys` et non plus de `app_settings` : il sert
/// à retrouver le mot de passe qui ouvre la base, il doit donc être lisible
/// avant elle. Le palier 003 l'a sorti du schéma pour cette raison.
#[derive(Debug, Serialize)]
pub struct LockStatus {
    pub configured: bool,
    pub unlocked: bool,
    pub password_hint: String,
    /// Vrai si **ce poste** peut ouvrir cette base par un code PIN.
    ///
    /// Un booléen, et rien de plus : il ne nomme personne, et la règle « une clé
    /// USB trouvée ne doit pas dire à qui elle appartient » tient donc encore.
    /// Sur un poste du collège il vaut faux, et l'écran de déverrouillage ne
    /// propose alors même pas le champ — c'est l'intérêt de le calculer ici
    /// plutôt que de laisser le front essayer pour voir.
    pub pin_available: bool,
}

/// Retour de `setup_lock`.
///
/// La phrase traverse l'IPC dans un `String` ordinaire — impossible de
/// l'effacer, c'est le prix de son affichage. C'est aussi la **seule** fois où
/// elle est lisible : `sgpa.keys` n'en garde que l'enveloppe.
#[derive(Debug, Serialize)]
pub struct SetupResult {
    pub status: LockStatus,
    pub recovery_phrase: String,
}

/// Réglages de l'application, ligne unique garantie par le palier 001.
///
/// `password_hint` n'en fait plus partie : il a quitté la base pour le fichier
/// d'enveloppes. Il se lit dans `LockStatus` et s'écrit par `set_password_hint`.
#[derive(Debug, Serialize, Deserialize)]
pub struct AppSettings {
    pub teacher_display_name: String,
    pub school_name: String,
    pub lock_timeout_minutes: i32,
    pub lock_on_minimize: bool,
    pub overall_average_rule: String,
    pub removed_competency_policy: String,
    /// Académie de l'enseignant. `""` = non renseignée, et c'est le défaut : le
    /// calendrier scolaire n'affiche alors AUCUNE vacance plutôt que celles
    /// d'une académie au hasard — des dates fausses seraient pires que pas de
    /// dates.
    pub academie: String,
    pub last_backup_at: Option<String>,
}

// ---------------------------------------------------------------------------
// Commandes du verrou
// ---------------------------------------------------------------------------

/// Ce que l'écran d'accueil a besoin de savoir, et rien de plus.
///
/// Aucune ouverture de base ici : au premier lancement elle n'existe pas, et
/// aux suivants elle est chiffrée. `configured` n'est donc pas une colonne mais
/// la présence du fichier d'enveloppes.
#[tauri::command]
pub fn get_lock_status(state: tauri::State<'_, AppState>) -> Result<LockStatus, String> {
    Ok(status(&state))
}

/// Premier lancement : crée les enveloppes, la base chiffrée, et ouvre la
/// session.
///
/// L'ordre compte. Les enveloppes d'abord — sans clé maître, aucune base
/// chiffrée n'est possible — puis la base, puis seulement le nom de
/// l'enseignant, qui est la seule de ces écritures à vivre dans la base.
#[tauri::command]
pub fn setup_lock(
    state: tauri::State<'_, AppState>,
    password: String,
    teacher_display_name: String,
    password_hint: String,
) -> Result<SetupResult, String> {
    // Jamais de `trim` sur le mot de passe : un espace final fait partie de ce
    // que l'enseignant retapera demain.
    let password = Zeroizing::new(password);
    let root = &state.layout.root;

    let (master, phrase) = keys::create(root, password.as_str()).map_err(|e| e.to_string())?;

    // À partir d'ici `sgpa.keys` existe sur le disque. Tout échec avant que la
    // base ne soit ouverte doit le retirer : des enveloppes seules ne protègent
    // rien, leur phrase n'a jamais été montrée, et `keys::create` refuserait
    // toute nouvelle tentative tant que le fichier est là.
    keys::set_hint(root, &password_hint).map_err(|e| annuler_setup(&state, e.to_string()))?;

    // Un `sgpa.db` partiel resterait derrière en cas d'échec ici ; il sera mis
    // de côté au prochain démarrage, `move_legacy_aside` traitant précisément le
    // cas « une base sans fichier de clés ».
    let conn = db::prepare_encrypted(&state.layout, &master)
        .map_err(|e| annuler_setup(&state, e.to_string()))?;

    // Dernière écriture, et la seule qui ne soit plus rattrapable : si elle
    // échoue, la base et le mot de passe sont valides mais la phrase n'aura pas
    // été montrée. Elle se régénère alors depuis les réglages, une fois la
    // session ouverte — c'est pourquoi on n'annule rien ici.
    conn.execute(
        "UPDATE app_settings SET teacher_display_name = ?1, updated_at = datetime('now')
          WHERE id = 1",
        params![teacher_display_name.trim()],
    )
    .map_err(|e| {
        format!(
            "La base a bien été créée, mais le nom de l'enseignant n'a pas pu y être \
             enregistré.\nDétail : {e}\nRelancez SGPA : le mot de passe fonctionne, et le \
             nom se corrige dans les réglages."
        )
    })?;

    state.set_connection(conn);

    Ok(SetupResult {
        status: status(&state),
        recovery_phrase: phrase.as_str().to_string(),
    })
}

/// Déballe la clé maître, ouvre la base et installe la connexion.
///
/// `master` meurt avec la fonction et s'efface en tombant ; la clé ne survit
/// ensuite que dans le contexte SQLCipher de la connexion.
#[tauri::command]
pub fn unlock(state: tauri::State<'_, AppState>, password: String) -> Result<LockStatus, String> {
    let password = Zeroizing::new(password);

    let master =
        keys::unwrap_with_password(&state.layout.root, password.as_str()).map_err(to_message)?;
    let conn = db::prepare_encrypted(&state.layout, &master).map_err(|e| e.to_string())?;

    state.set_connection(conn);
    Ok(status(&state))
}

/// Déverrouille par le code PIN de ce poste.
///
/// Mêmes effets qu'`unlock` — la même clé maître, la même base — par une autre
/// enveloppe. Le PIN n'est **pas** un second mot de passe : six chiffres ne
/// protégeraient rien seuls, et ce qui les complète est resté sur ce poste.
///
/// Un essai manqué est compté dans le fichier du poste, et au dixième ce poste
/// est oublié : plus de fichier, plus d'enveloppe, retour au mot de passe. Rien
/// n'est perdu pour autant — le mot de passe et la phrase de récupération
/// atteignent toujours la clé maître.
#[tauri::command]
pub fn unlock_with_pin(
    state: tauri::State<'_, AppState>,
    pin: String,
) -> Result<LockStatus, String> {
    let pin = Zeroizing::new(pin);
    let root = &state.layout.root;

    let dir = device::dir().map_err(|e| e.to_string())?;
    let poste = device::load(&dir)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| keys::KeyError::PinAbsent.to_string())?;

    match keys::unwrap_with_pin(root, poste.id(), poste.secret(), pin.as_str()) {
        Ok(master) => {
            let conn = db::prepare_encrypted(&state.layout, &master).map_err(|e| e.to_string())?;
            // Le compteur n'est remis à zéro qu'une fois la base réellement
            // ouverte : un PIN juste suivi d'une base illisible n'est pas un
            // succès, et créditer l'essai masquerait le vrai problème.
            let _ = device::set_failures(&dir, &poste, 0);
            state.set_connection(conn);
            Ok(status(&state))
        }
        // Une saisie mal formée n'a rien dérivé : ce n'est pas un essai, et la
        // compter punirait une faute de frappe.
        Err(e @ keys::KeyError::MalformedPin) => Err(e.to_string()),
        Err(keys::KeyError::WrongPin) => Err(compter_echec_pin(&dir, &poste, root)),
        Err(other) => Err(to_message(other)),
    }
}

/// Active le code PIN sur ce poste.
///
/// Le mot de passe est redemandé parce qu'il est le seul moyen d'atteindre la
/// clé maître : la session ouverte ne la garde pas en mémoire, elle ne vit que
/// dans le contexte SQLCipher de la connexion. Ce n'est donc pas une formalité
/// de confirmation, c'est une nécessité technique — et une bonne chose par
/// ailleurs, puisque poser un PIN est un affaiblissement consenti.
#[tauri::command]
pub fn enable_pin(
    state: tauri::State<'_, AppState>,
    password: String,
    pin: String,
) -> Result<LockStatus, String> {
    require_unlocked(&state)?;
    let password = Zeroizing::new(password);
    let pin = Zeroizing::new(pin);
    let root = &state.layout.root;

    // Le PIN est validé d'abord : sans cela, six chiffres mal tapés laisseraient
    // derrière eux un fichier de poste que rien n'utilise.
    keys::check_pin(pin.as_str()).map_err(to_message)?;
    let dir = device::dir().map_err(|e| e.to_string())?;

    let master = keys::unwrap_with_password(root, password.as_str()).map_err(to_message)?;
    let poste = device::ensure(&dir).map_err(|e| e.to_string())?;
    keys::set_pin(root, &master, poste.id(), poste.secret(), pin.as_str()).map_err(to_message)?;

    Ok(status(&state))
}

/// « Oublier ce poste » : retire le secret du poste **puis** l'enveloppe.
///
/// Cet ordre n'est pas indifférent. Le secret du poste est ce qui, combiné à un
/// million d'essais, ouvre l'enveloppe : il part le premier. Si la seconde
/// moitié échouait, il resterait dans `sgpa.keys` une enveloppe que plus rien ne
/// peut ouvrir — inoffensive. L'ordre inverse aurait laissé, le temps d'un
/// échec, un secret vivant sur le disque.
#[tauri::command]
pub fn disable_pin(state: tauri::State<'_, AppState>) -> Result<LockStatus, String> {
    require_unlocked(&state)?;

    let dir = device::dir().map_err(|e| e.to_string())?;
    let identifiant = device::load(&dir)
        .ok()
        .flatten()
        .map(|poste| poste.id().to_string());
    device::forget(&dir).map_err(|e| e.to_string())?;
    if let Some(identifiant) = identifiant {
        keys::remove_pin(&state.layout.root, &identifiant).map_err(to_message)?;
    }

    Ok(status(&state))
}

/// Ferme réellement la base : une `Connection` vivante garde la clé de
/// chiffrement en clair dans le contexte SQLCipher pour le reste de la session.
#[tauri::command]
pub fn lock(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.close();
    Ok(())
}

/// Réécrit la seule enveloppe `password`.
///
/// Ni la base ni les sauvegardes déjà prises ne sont rechiffrées : la clé maître
/// ne bouge pas. Une sauvegarde d'avant le changement reste donc ouvrable, ce
/// qu'un `PRAGMA rekey` aurait rendu impossible.
#[tauri::command]
pub fn change_password(
    state: tauri::State<'_, AppState>,
    current: String,
    next: String,
) -> Result<(), String> {
    require_unlocked(&state)?;
    let current = Zeroizing::new(current);
    let next = Zeroizing::new(next);

    keys::change_password(&state.layout.root, current.as_str(), next.as_str()).map_err(to_message)
}

/// Mot de passe perdu : la phrase de récupération ouvre la clé maître, et un
/// nouveau mot de passe est posé autour d'elle.
///
/// Le nouveau mot de passe est écrit **avant** l'ouverture de la base : c'est
/// l'objet même de la démarche, et un échec d'ouverture ne doit pas renvoyer
/// l'enseignant à son problème de départ. La phrase, elle, reste valable —
/// `regenerate_recovery` est le seul moyen de l'invalider.
#[tauri::command]
pub fn recover(
    state: tauri::State<'_, AppState>,
    recovery_phrase: String,
    new_password: String,
) -> Result<LockStatus, String> {
    let recovery_phrase = Zeroizing::new(recovery_phrase);
    let new_password = Zeroizing::new(new_password);

    // Argon2id coûte quelques dixièmes de seconde par essai : autant refuser un
    // mot de passe trop court tout de suite, et avec le message du socle plutôt
    // qu'un second texte à maintenir.
    if new_password.chars().count() < keys::MIN_PASSWORD_LEN {
        return Err(keys::KeyError::PasswordTooShort.to_string());
    }

    let root = &state.layout.root;
    let master = keys::unwrap_with_recovery(root, recovery_phrase.as_str()).map_err(to_message)?;
    keys::reset_password(root, &master, new_password.as_str()).map_err(to_message)?;

    let conn = db::prepare_encrypted(&state.layout, &master).map_err(|e| e.to_string())?;
    state.set_connection(conn);
    Ok(status(&state))
}

/// Tire une nouvelle phrase de récupération et **invalide l'ancienne**.
///
/// L'interface doit l'annoncer avant d'appeler : une phrase notée dans un
/// carnet cesse ici de fonctionner, sans que rien ne le signale ailleurs.
#[tauri::command]
pub fn regenerate_recovery(
    state: tauri::State<'_, AppState>,
    password: String,
) -> Result<String, String> {
    require_unlocked(&state)?;
    let password = Zeroizing::new(password);

    let phrase =
        keys::regenerate_recovery(&state.layout.root, password.as_str()).map_err(to_message)?;
    Ok(phrase.as_str().to_string())
}

/// Écrit l'indice de mot de passe dans `data/sgpa.keys`.
///
/// Commande séparée, et non un champ de `AppSettings` : l'indice a quitté la
/// base au palier 003 parce qu'il doit être lisible **avant** elle. Le faire
/// voyager dans le formulaire des réglages obligerait `update_settings` à écrire
/// dans deux fichiers à la fois, dont un seul sait revenir en arrière. Il se lit
/// par `get_lock_status`, il s'écrit ici.
#[tauri::command]
pub fn set_password_hint(state: tauri::State<'_, AppState>, hint: String) -> Result<(), String> {
    require_unlocked(&state)?;
    keys::set_hint(&state.layout.root, &hint).map_err(to_message)
}

// ---------------------------------------------------------------------------
// Réglages — session déverrouillée exigée, donc `state.conn()?`.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_settings(state: tauri::State<'_, AppState>) -> Result<AppSettings, String> {
    let conn = state.conn()?;
    read_settings(&conn)
}

#[tauri::command]
pub fn update_settings(
    state: tauri::State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    // Les mêmes bornes que les CHECK du schéma, mais dites en français : une
    // violation de contrainte remonterait un message SQL illisible.
    if !(1..=120).contains(&settings.lock_timeout_minutes) {
        return Err(
            "Le délai de verrouillage doit être compris entre 1 et 120 minutes.".to_string(),
        );
    }
    if !AVERAGE_RULES.contains(&settings.overall_average_rule.as_str()) {
        return Err(
            "Règle de moyenne générale inconnue : choisissez « moyenne simple » ou \
             « moyenne pondérée par le nombre de notes »."
                .to_string(),
        );
    }
    if !REMOVED_COMPETENCY_POLICIES.contains(&settings.removed_competency_policy.as_str()) {
        return Err(
            "Politique des compétences retirées inconnue : choisissez « conserver » ou \
             « ignorer »."
                .to_string(),
        );
    }

    let conn = state.conn()?;

    // L'académie est validée contre LES DONNÉES, jamais contre une liste
    // recopiée : une académie sans dates serait un réglage qui a l'air de
    // marcher et ne fait rien.
    //
    // Trois valeurs sont acceptées : vide (non renseignée), une académie
    // présente dans `school_holidays`, OU LA VALEUR DÉJÀ ENREGISTRÉE. Ce
    // troisième cas n'est pas une complaisance : le jour où une académie cesse
    // d'être publiée, sans lui l'enseignant ne pourrait plus enregistrer son
    // délai de verrouillage — cette commande écrit les réglages d'un bloc, et
    // elle refuserait tout avec un message parlant d'académie.
    let academie = settings.academie.trim();
    if !academie.is_empty() {
        let connue: bool = conn
            .query_row(
                "SELECT EXISTS (SELECT 1 FROM school_holidays WHERE academie = ?1)
                     OR EXISTS (SELECT 1 FROM app_settings WHERE id = 1 AND academie = ?1)",
                params![academie],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !connue {
            return Err(format!(
                "Académie inconnue : « {academie} ». Choisissez-en une dans la liste —                  elle vient du calendrier officiel embarqué, et seules celles qui ont des                  dates y figurent."
            ));
        }
    }

    // `last_backup_at` ne figure pas dans le UPDATE : il appartient à la
    // sauvegarde. Un formulaire de réglages un peu périmé effacerait sinon la
    // date de la dernière sauvegarde.
    conn.execute(
        "UPDATE app_settings
            SET teacher_display_name = ?1, school_name = ?2, lock_timeout_minutes = ?3,
                lock_on_minimize = ?4, overall_average_rule = ?5,
                removed_competency_policy = ?6, academie = ?7,
                updated_at = datetime('now')
          WHERE id = 1",
        params![
            settings.teacher_display_name.trim(),
            settings.school_name.trim(),
            settings.lock_timeout_minutes,
            settings.lock_on_minimize,
            settings.overall_average_rule,
            settings.removed_competency_policy,
            academie,
        ],
    )
    .map_err(|e| e.to_string())?;

    read_settings(&conn)
}

// ---------------------------------------------------------------------------
// Outils du module
// ---------------------------------------------------------------------------

/// Les messages de `KeyError` sont déjà écrits pour l'enseignant, en français et
/// avec la marche à suivre : les reformuler ici les appauvrirait.
fn to_message(error: keys::KeyError) -> String {
    error.to_string()
}

fn status(state: &AppState) -> LockStatus {
    let root = &state.layout.root;
    LockStatus {
        configured: keys::exists(root),
        unlocked: state.is_unlocked(),
        password_hint: keys::read_hint(root),
        pin_available: pin_available(root),
    }
}

/// Le PIN n'est proposé que si **les deux** moitiés du secret sont là :
/// l'enveloppe sur la clé USB, et le fichier de ce poste.
///
/// Toute erreur répond « non » : ni l'absence de `%LOCALAPPDATA%`, ni un fichier
/// de poste écrit par un autre compte Windows ne doit empêcher l'écran de
/// déverrouillage de s'afficher. Le mot de passe, lui, marche toujours.
fn pin_available(root: &Path) -> bool {
    let Ok(dir) = device::dir() else {
        return false;
    };
    match device::load(&dir) {
        Ok(Some(poste)) => keys::has_pin(root, poste.id()),
        _ => false,
    }
}

/// Compte un essai manqué, et rend le message à afficher.
///
/// Au dixième, ce poste est oublié — mêmes gestes et même ordre que
/// `disable_pin`. L'écran de déverrouillage rafraîchit son état après un échec :
/// le champ PIN disparaît alors de lui-même, sans avoir à être désactivé à la
/// main.
///
/// Les erreurs d'écriture du compteur sont ignorées. Un fichier de poste devenu
/// non inscriptible ne doit pas transformer « code PIN incorrect » en message
/// technique : l'enseignant a encore son mot de passe, et c'est ce qu'il faut
/// lui dire.
fn compter_echec_pin(dir: &Path, poste: &device::Device, root: &Path) -> String {
    let essais = poste.failures().saturating_add(1);
    if essais >= device::MAX_FAILURES {
        let _ = device::forget(dir);
        let _ = keys::remove_pin(root, poste.id());
        return format!(
            "Code PIN incorrect, et c'était le {}e essai manqué : le code PIN de ce \
             poste vient d'être désactivé.\n\n\
             Rien n'est perdu — déverrouillez avec votre mot de passe. Vous pourrez \
             réactiver un code PIN depuis les réglages.",
            device::MAX_FAILURES
        );
    }

    let _ = device::set_failures(dir, poste, essais);
    let restants = device::MAX_FAILURES - essais;
    format!(
        "Code PIN incorrect.\n\n\
         Il reste {restants} essai{} avant que le code PIN de ce poste ne soit \
         désactivé. Votre mot de passe, lui, fonctionne toujours.",
        if restants > 1 { "s" } else { "" }
    )
}

/// Retire les enveloppes écrites par un `setup_lock` qui n'ira pas à son terme,
/// et rend le message d'erreur inchangé.
fn annuler_setup(state: &AppState, message: String) -> String {
    let _ = std::fs::remove_file(keys::path(&state.layout.root));
    message
}

/// Ces commandes ne lisent pas la base mais réécrivent le fichier de clés de la
/// base. Elles passent par `conn()` pour que le garde-fou du verrou reste
/// l'unique point de contrôle de l'application, sans le réimplémenter ici.
fn require_unlocked(state: &AppState) -> Result<(), String> {
    drop(state.conn()?);
    Ok(())
}

fn read_settings(conn: &rusqlite::Connection) -> Result<AppSettings, String> {
    conn.query_row(
        "SELECT teacher_display_name, school_name, lock_timeout_minutes, lock_on_minimize,
                overall_average_rule, removed_competency_policy, academie, last_backup_at
           FROM app_settings WHERE id = 1",
        [],
        |row| {
            Ok(AppSettings {
                teacher_display_name: row.get(0)?,
                school_name: row.get(1)?,
                lock_timeout_minutes: row.get(2)?,
                lock_on_minimize: row.get(3)?,
                overall_average_rule: row.get(4)?,
                removed_competency_policy: row.get(5)?,
                academie: row.get(6)?,
                last_backup_at: row.get(7)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}
