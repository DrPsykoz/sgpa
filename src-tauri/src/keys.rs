//! Enveloppes de la clé maître — `data/sgpa.keys`.
//!
//! La base est chiffrée par SQLCipher avec une **clé maître** de 32 octets tirée
//! au hasard, jamais dérivée du mot de passe. Le mot de passe et la phrase de
//! récupération ne servent qu'à déballer cette clé, chacun par son enveloppe.
//!
//! Ce détour tient en quatre points :
//!
//! 1. Argon2id (coût mémoire) remplace le PBKDF2 interne de SQLCipher, qui se
//!    casse bien sur carte graphique. La menace réelle est quelqu'un qui ramasse
//!    la clé USB et a tout son temps.
//! 2. Changer de mot de passe réécrit un fichier de 1 Ko au lieu de rechiffrer
//!    toute la base.
//! 3. Les sauvegardes déjà prises restent ouvrables après ce changement.
//! 4. Une phrase de récupération devient possible : SQLCipher n'accepte qu'une
//!    clé par base, deux enveloppes sur une clé maître unique lèvent la limite.
//!
//! Ce fichier ne contient **aucune donnée d'élève et aucun nom d'enseignant** :
//! une clé USB trouvée ne doit pas dire à qui elle appartient.

use std::fmt;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{Key, KeyInit, XChaCha20Poly1305, XNonce};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

/// Nom du fichier d'enveloppes dans `data/`. `portable.rs` s'en sert pour
/// composer `PortableLayout::keys_path` : une seule définition, pas deux.
pub const FILE_NAME: &str = "sgpa.keys";

/// Fichier temporaire de l'écriture atomique. Toujours dans `data/`, donc sur le
/// même volume que la cible : `rename` y est atomique.
const TMP_FILE_NAME: &str = "sgpa.keys.tmp";

/// Seule version de format reconnue.
const FORMAT_VERSION: u32 = 1;

/// Longueur minimale du mot de passe.
///
/// Ce n'est plus un verrou de courtoisie, c'est la clé : quatre caractères
/// resteraient à portée malgré Argon2id. Aucune règle de complexité en revanche
/// — une phrase longue vaut mieux qu'un mot court et tordu, et l'enseignant la
/// retape plusieurs fois par jour.
pub const MIN_PASSWORD_LEN: usize = 8;

const MASTER_KEY_LEN: usize = 32;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 24;
/// 32 octets de clé maître + 16 octets d'étiquette Poly1305.
const CIPHERTEXT_LEN: usize = MASTER_KEY_LEN + 16;

/// Préfixe des données associées de l'AEAD. Suivi du nom de l'enveloppe, il
/// interdit d'intervertir « password » et « recovery » dans le fichier.
const AAD_PREFIX: &str = "sgpa-keys-v1";
const WRAP_PASSWORD: &str = "password";
const WRAP_RECOVERY: &str = "recovery";
const WRAP_PIN: &str = "pin";

/// Longueur imposée du code PIN. Exactement six chiffres : ni cinq, ni sept.
///
/// Six chiffres ne font qu'un million de combinaisons, ce qui serait dérisoire
/// si le PIN ouvrait seul une enveloppe. Il n'en ouvre jamais seul : l'autre
/// moitié du secret est les 32 octets de `device.rs`, qui restent sur le poste
/// et ne suivent pas la clé USB.
pub const PIN_LEN: usize = 6;

/// Nombre d'enveloppes PIN conservées dans le fichier.
///
/// Une par poste où l'enseignant a activé le PIN. La borne existe pour qu'un
/// fichier de clés reste un fichier de 1 Ko : au-delà, la plus ancienne part, et
/// le poste correspondant redemandera le mot de passe. Huit postes, c'est déjà
/// bien plus que « la salle de classe et la maison ».
const MAX_PIN_WRAPS: usize = 8;

/// Alphabet base32 sans caractères ambigus : ni I, ni L, ni O, ni U.
const ALPHABET: &[u8; 32] = b"ABCDEFGHJKMNPQRSTVWXYZ0123456789";

/// 8 groupes de 5 caractères, soit 40 symboles de 5 bits = 200 bits d'entropie.
const PHRASE_GROUPS: usize = 8;
const PHRASE_GROUP_LEN: usize = 5;
const PHRASE_LEN: usize = PHRASE_GROUPS * PHRASE_GROUP_LEN;
/// L'entropie est tirée d'un coup puis découpée en groupes de 5 bits : aucun
/// modulo, donc aucun biais dans le choix des caractères.
const PHRASE_ENTROPY_BYTES: usize = PHRASE_LEN * 5 / 8;

// ---------------------------------------------------------------------------
// Erreurs
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub enum KeyError {
    /// `data/sgpa.keys` n'existe pas : aucune base n'a encore été configurée.
    Absent,
    /// Le fichier existe déjà — on ne réécrit jamais des enveloppes par-dessus.
    AlreadyExists,
    /// Le fichier n'a pas pu être lu ou écrit.
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    /// Contenu illisible : JSON invalide, champ manquant, base64 ou longueur
    /// incorrecte, paramètres Argon2id hors bornes.
    Corrupted(String),
    /// Écrit par une version plus récente de SGPA.
    UnknownVersion {
        found: u32,
        supported: u32,
    },
    WrongPassword,
    WrongRecovery,
    /// La saisie n'a pas la forme d'une phrase de récupération.
    MalformedRecovery,
    PasswordTooShort,
    WrongPin,
    /// La saisie n'est pas un code PIN : ce n'est pas six chiffres.
    MalformedPin,
    /// Ce poste n'a pas d'enveloppe PIN dans ce fichier de clés.
    PinAbsent,
    /// Panne d'une primitive cryptographique ou du générateur d'aléa.
    Internal(&'static str),
}

impl fmt::Display for KeyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            KeyError::Absent => write!(
                f,
                "Aucun mot de passe n'est défini pour cette base.\n\n\
                 Le fichier data/{FILE_NAME} est introuvable. Créez un mot de passe \
                 depuis l'écran d'accueil."
            ),
            KeyError::AlreadyExists => write!(
                f,
                "Un mot de passe est déjà défini pour cette base.\n\n\
                 Utilisez « Changer le mot de passe » dans les réglages."
            ),
            KeyError::Io { path, source } => write!(
                f,
                "Le fichier de clés de SGPA n'a pas pu être lu ou écrit.\n\n\
                 Fichier : {}\n\
                 Détail : {source}\n\n\
                 Vérifiez que la clé USB n'est pas protégée en écriture et qu'elle \
                 est toujours branchée.",
                path.display()
            ),
            KeyError::Corrupted(detail) => write!(
                f,
                "Le fichier de clés data/{FILE_NAME} est endommagé.\n\n\
                 Détail : {detail}\n\n\
                 Ce fichier est le seul moyen d'ouvrir la base chiffrée. S'il vous \
                 reste une copie de data/{FILE_NAME}, remettez-la en place ; sinon, \
                 les données de data/sgpa.db ne sont plus récupérables."
            ),
            KeyError::UnknownVersion { found, supported } => write!(
                f,
                "Ce fichier de clés a été écrit par une version plus récente de \
                 SGPA.\n\n\
                 Version du fichier : {found}\n\
                 Version de cette application : {supported}\n\n\
                 Mettez SGPA à jour, ou utilisez la copie de l'application qui a \
                 créé cette base."
            ),
            KeyError::WrongPassword => write!(f, "Mot de passe incorrect."),
            KeyError::WrongRecovery => write!(
                f,
                "Cette phrase de récupération ne correspond pas à cette base.\n\n\
                 Vérifiez que vous utilisez bien la phrase remise lors du premier \
                 lancement de SGPA sur cette clé. Régénérer une phrase depuis les \
                 réglages annule la précédente."
            ),
            KeyError::MalformedRecovery => write!(
                f,
                "La phrase de récupération doit comporter {PHRASE_LEN} caractères, \
                 présentés en {PHRASE_GROUPS} groupes de {PHRASE_GROUP_LEN}.\n\n\
                 La casse, les tirets et les espaces n'ont pas d'importance. Les \
                 lettres I, L, O et U n'en font jamais partie : lisez 1, 1, 0 et V."
            ),
            KeyError::PasswordTooShort => write!(
                f,
                "Le mot de passe doit contenir au moins {MIN_PASSWORD_LEN} \
                 caractères.\n\n\
                 Il ne verrouille plus seulement l'écran : c'est lui qui protège le \
                 contenu de la base. Une phrase facile à retenir vaut mieux qu'un \
                 mot court et compliqué."
            ),
            KeyError::WrongPin => write!(f, "Code PIN incorrect."),
            KeyError::MalformedPin => write!(
                f,
                "Le code PIN doit être composé de {PIN_LEN} chiffres, sans espace ni \
                 lettre."
            ),
            KeyError::PinAbsent => write!(
                f,
                "Aucun code PIN n'est enregistré pour ce poste.\n\n\
                 Le code PIN ne vaut que sur l'ordinateur où il a été activé : la \
                 moitié de son secret y reste et ne suit pas la clé USB. \
                 Déverrouillez avec votre mot de passe, puis activez-le depuis les \
                 réglages si vous voulez vous en servir ici."
            ),
            KeyError::Internal(step) => write!(
                f,
                "Une opération cryptographique de SGPA a échoué.\n\n\
                 Étape : {step}\n\n\
                 Relancez l'application. Si le problème persiste, signalez-le : \
                 cela ne devrait jamais arriver."
            ),
        }
    }
}

impl std::error::Error for KeyError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            KeyError::Io { source, .. } => Some(source),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

/// Clé de chiffrement de la base, en mémoire et nulle part ailleurs.
///
/// Pas de `Clone` : une copie de plus est une occasion de plus d'en oublier une
/// en mémoire. Le `Debug` est muet volontairement — un `{:?}` posé par mégarde
/// dans un journal ne doit rien pouvoir livrer.
pub struct MasterKey([u8; MASTER_KEY_LEN]);

impl MasterKey {
    /// Rend la clé sous la forme `x'<64 hexadécimaux>'`, seule syntaxe que
    /// SQLCipher reconnaît comme **clé brute** : il n'applique alors pas son
    /// PBKDF2 par-dessus notre Argon2id, et la clé posée est exactement
    /// celle-ci.
    ///
    /// Le `Zeroizing` efface la chaîne dès que l'appelant la relâche, et la
    /// capacité est réservée d'un coup pour qu'aucune réallocation ne laisse
    /// traîner un fragment.
    pub fn pragma_literal(&self) -> Zeroizing<String> {
        const HEX: &[u8; 16] = b"0123456789ABCDEF";
        let mut out = String::with_capacity(MASTER_KEY_LEN * 2 + 3);
        out.push_str("x'");
        for byte in self.0 {
            out.push(HEX[(byte >> 4) as usize] as char);
            out.push(HEX[(byte & 0x0f) as usize] as char);
        }
        out.push('\'');
        Zeroizing::new(out)
    }

    #[cfg(test)]
    pub(crate) fn from_bytes_for_tests(bytes: [u8; MASTER_KEY_LEN]) -> Self {
        Self(bytes)
    }
}

impl fmt::Debug for MasterKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("MasterKey(masquée)")
    }
}

impl Drop for MasterKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

/// Phrase de récupération, telle qu'elle est montrée à l'enseignant.
///
/// Affichée une seule fois, au premier lancement. Jamais stockée en clair :
/// seule son enveloppe vit dans `sgpa.keys`.
pub struct RecoveryPhrase(String);

impl RecoveryPhrase {
    /// Forme affichable : 8 groupes de 5 séparés par des tirets.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for RecoveryPhrase {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("RecoveryPhrase(masquée)")
    }
}

impl Drop for RecoveryPhrase {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

/// Clé d'enveloppe dérivée par Argon2id. Jamais écrite nulle part.
struct WrapKey([u8; 32]);

impl Drop for WrapKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

// ---------------------------------------------------------------------------
// Le fichier
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct KdfParams {
    algo: String,
    m_cost_kib: u32,
    t_cost: u32,
    p_cost: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        Self {
            algo: "argon2id".to_string(),
            // 64 Mio et 3 passes : de l'ordre du dixième de seconde sur un
            // portable, mais 64 Mio par essai chez l'attaquant, ce qui ruine le
            // parallélisme d'une carte graphique.
            m_cost_kib: 65_536,
            t_cost: 3,
            p_cost: 1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Envelope {
    salt: String,
    nonce: String,
    ciphertext: String,
}

/// Enveloppe PIN d'un poste.
///
/// `device_id` n'est pas un secret : il ne sert qu'à retrouver la bonne
/// enveloppe, il est tiré au hasard, et il ne dit rien du poste — surtout pas
/// son nom. La règle « une clé USB trouvée ne doit pas dire à qui elle
/// appartient » vaut aussi ici.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PinWrap {
    device_id: String,
    #[serde(default)]
    created_at: String,
    envelope: Envelope,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Wraps {
    password: Envelope,
    recovery: Envelope,
    /// Zéro, une ou plusieurs enveloppes PIN, une par poste.
    ///
    /// `default` : les fichiers écrits avant le code PIN n'ont pas ce champ et
    /// doivent rester lisibles. `skip_serializing_if` : tant qu'aucun PIN n'est
    /// activé, le fichier garde exactement la forme qu'il avait — activer puis
    /// oublier ne laisse donc aucune trace dans `sgpa.keys`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pin: Vec<PinWrap>,
}

/// Contenu de `data/sgpa.keys`.
///
/// Rien d'identifiant ici : ni nom d'enseignant, ni nom d'établissement. Seul
/// `hint` est en clair, c'est sa raison d'être — l'interface rappelle qu'il ne
/// doit jamais contenir le mot de passe.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct KeysFile {
    version: u32,
    kdf: KdfParams,
    wraps: Wraps,
    #[serde(default)]
    hint: String,
    #[serde(default)]
    created_at: String,
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/// Chemin du fichier d'enveloppes sous la racine de données.
pub fn path(root: &Path) -> PathBuf {
    root.join(FILE_NAME)
}

/// Vrai si un mot de passe a déjà été défini sur cette clé USB.
pub fn exists(root: &Path) -> bool {
    path(root).is_file()
}

/// Premier lancement : tire une clé maître et une phrase de récupération, les
/// enveloppe toutes deux et écrit `data/sgpa.keys`.
pub fn create(root: &Path, password: &str) -> Result<(MasterKey, RecoveryPhrase), KeyError> {
    check_password_len(password)?;
    if exists(root) {
        return Err(KeyError::AlreadyExists);
    }

    let mut master = [0u8; MASTER_KEY_LEN];
    random(&mut master)?;
    let phrase = generate_phrase()?;
    let kdf = KdfParams::default();

    let file = KeysFile {
        version: FORMAT_VERSION,
        wraps: Wraps {
            password: wrap(&master, password.as_bytes(), WRAP_PASSWORD, &kdf)?,
            recovery: wrap(
                &master,
                phrase_secret(&phrase).as_bytes(),
                WRAP_RECOVERY,
                &kdf,
            )?,
            pin: Vec::new(),
        },
        kdf,
        hint: String::new(),
        created_at: now(),
    };
    write_atomic(root, &file)?;

    let key = MasterKey(master);
    master.zeroize();
    Ok((key, phrase))
}

pub fn unwrap_with_password(root: &Path, password: &str) -> Result<MasterKey, KeyError> {
    let file = read(root)?;
    open_envelope(
        &file.wraps.password,
        password.as_bytes(),
        WRAP_PASSWORD,
        &file.kdf,
        KeyError::WrongPassword,
    )
}

pub fn unwrap_with_recovery(root: &Path, phrase: &str) -> Result<MasterKey, KeyError> {
    let file = read(root)?;
    let normalized = normalize_phrase(phrase).ok_or(KeyError::MalformedRecovery)?;
    open_envelope(
        &file.wraps.recovery,
        normalized.as_bytes(),
        WRAP_RECOVERY,
        &file.kdf,
        KeyError::WrongRecovery,
    )
}

/// Réécrit **la seule** enveloppe `password`. La clé maître ne change pas : ni
/// la base ni les sauvegardes déjà prises n'ont à être rechiffrées, et la phrase
/// de récupération reste valable.
pub fn change_password(root: &Path, current: &str, next: &str) -> Result<(), KeyError> {
    check_password_len(next)?;
    let master = unwrap_with_password(root, current)?;
    reset_password(root, &master, next)
}

/// Pose un nouveau mot de passe à partir d'une clé maître déjà déballée.
///
/// C'est le second temps de la récupération : la phrase a ouvert la clé, il
/// reste à reconstruire l'enveloppe `password` autour d'elle.
pub fn reset_password(root: &Path, master: &MasterKey, next: &str) -> Result<(), KeyError> {
    check_password_len(next)?;
    let mut file = read(root)?;
    file.wraps.password = wrap(&master.0, next.as_bytes(), WRAP_PASSWORD, &file.kdf)?;
    write_atomic(root, &file)
}

/// Réécrit l'enveloppe `recovery` : l'ancienne phrase cesse aussitôt de
/// fonctionner, ce que l'interface doit annoncer avant d'appeler.
pub fn regenerate_recovery(root: &Path, password: &str) -> Result<RecoveryPhrase, KeyError> {
    let master = unwrap_with_password(root, password)?;
    let mut file = read(root)?;
    let phrase = generate_phrase()?;
    file.wraps.recovery = wrap(
        &master.0,
        phrase_secret(&phrase).as_bytes(),
        WRAP_RECOVERY,
        &file.kdf,
    )?;
    write_atomic(root, &file)?;
    Ok(phrase)
}

/// Indice de mot de passe, lisible sans rien déverrouiller — c'est sa raison
/// d'être. Une chaîne vide si le fichier est absent ou illisible : l'indice est
/// une commodité, il ne doit pas faire échouer l'écran de déverrouillage.
pub fn read_hint(root: &Path) -> String {
    read(root).map(|file| file.hint).unwrap_or_default()
}

pub fn set_hint(root: &Path, hint: &str) -> Result<(), KeyError> {
    let mut file = read(root)?;
    file.hint = hint.trim().to_string();
    write_atomic(root, &file)
}

// ---------------------------------------------------------------------------
// Enveloppe PIN — une par poste
// ---------------------------------------------------------------------------

/// Refuse tout ce qui n'est pas exactement six chiffres ASCII.
///
/// Publique, et appelée **avant** d'écrire quoi que ce soit : un PIN mal formé
/// ne doit pas laisser derrière lui un fichier de poste à moitié créé.
pub fn check_pin(pin: &str) -> Result<(), KeyError> {
    if pin.len() != PIN_LEN || !pin.bytes().all(|b| b.is_ascii_digit()) {
        return Err(KeyError::MalformedPin);
    }
    Ok(())
}

/// Vrai si ce poste a une enveloppe PIN dans ce fichier.
///
/// Comme `read_hint`, cette fonction ne fait pas échouer l'écran de
/// déverrouillage : un fichier illisible répond « non », et c'est le mot de
/// passe qui dira pourquoi.
pub fn has_pin(root: &Path, device_id: &str) -> bool {
    read(root)
        .map(|file| file.wraps.pin.iter().any(|w| w.device_id == device_id))
        .unwrap_or(false)
}

/// Pose — ou remplace — l'enveloppe PIN de ce poste autour de la clé maître.
///
/// La clé maître ne change pas : comme pour un changement de mot de passe, ni la
/// base ni les sauvegardes déjà prises n'ont à être rechiffrées.
pub fn set_pin(
    root: &Path,
    master: &MasterKey,
    device_id: &str,
    device_secret: &[u8],
    pin: &str,
) -> Result<(), KeyError> {
    check_pin(pin)?;
    let mut file = read(root)?;

    let secret = pin_secret(device_secret, pin);
    let envelope = wrap(&master.0, &secret, &pin_name(device_id), &file.kdf)?;

    // Réactiver sur un poste déjà connu remplace son enveloppe au lieu d'en
    // ajouter une seconde : deux enveloppes pour un même poste signifieraient
    // qu'un ancien PIN ouvre encore la base.
    file.wraps.pin.retain(|w| w.device_id != device_id);
    file.wraps.pin.push(PinWrap {
        device_id: device_id.to_string(),
        created_at: now(),
        envelope,
    });
    while file.wraps.pin.len() > MAX_PIN_WRAPS {
        file.wraps.pin.remove(0);
    }

    write_atomic(root, &file)
}

/// Déballe la clé maître avec les deux moitiés du secret : les 32 octets du
/// poste et les six chiffres.
pub fn unwrap_with_pin(
    root: &Path,
    device_id: &str,
    device_secret: &[u8],
    pin: &str,
) -> Result<MasterKey, KeyError> {
    check_pin(pin)?;
    let file = read(root)?;
    let entry = file
        .wraps
        .pin
        .iter()
        .find(|w| w.device_id == device_id)
        .ok_or(KeyError::PinAbsent)?;

    let secret = pin_secret(device_secret, pin);
    open_envelope(
        &entry.envelope,
        &secret,
        &pin_name(device_id),
        &file.kdf,
        KeyError::WrongPin,
    )
}

/// Retire l'enveloppe PIN d'un poste.
///
/// Un poste inconnu n'est pas une erreur : l'état visé est « plus d'enveloppe »,
/// et il est déjà atteint. Le fichier n'est alors même pas réécrit.
pub fn remove_pin(root: &Path, device_id: &str) -> Result<(), KeyError> {
    let mut file = read(root)?;
    let before = file.wraps.pin.len();
    file.wraps.pin.retain(|w| w.device_id != device_id);
    if file.wraps.pin.len() == before {
        return Ok(());
    }
    write_atomic(root, &file)
}

/// Nom d'enveloppe d'un poste, donc ses données associées.
///
/// Le `device_id` entre dans l'AAD : échanger deux enveloppes PIN dans le
/// fichier les rend toutes deux inouvrables, exactement comme intervertir
/// « password » et « recovery ».
fn pin_name(device_id: &str) -> String {
    format!("{WRAP_PIN}:{device_id}")
}

/// Secret de l'enveloppe PIN : les octets du poste, puis les chiffres.
///
/// La concaténation est sans ambiguïté parce que la moitié du poste a une
/// longueur fixe : aucune paire (secret, PIN) différente ne peut produire la
/// même suite d'octets.
fn pin_secret(device_secret: &[u8], pin: &str) -> Zeroizing<Vec<u8>> {
    let mut out = Zeroizing::new(Vec::with_capacity(device_secret.len() + pin.len()));
    out.extend_from_slice(device_secret);
    out.extend_from_slice(pin.as_bytes());
    out
}

/// Horodatage des écritures du fichier, en UTC et à la seconde.
fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

// ---------------------------------------------------------------------------
// Enveloppes
// ---------------------------------------------------------------------------

/// Données associées de l'AEAD : le préfixe de format et le nom de l'enveloppe.
///
/// Déchiffrer l'enveloppe « password » sous le nom « recovery » échoue même si
/// le secret est le bon — c'est ce qui interdit de les intervertir dans le
/// fichier.
fn aad(name: &str) -> String {
    format!("{AAD_PREFIX}:{name}")
}

fn wrap(
    master: &[u8; MASTER_KEY_LEN],
    secret: &[u8],
    name: &str,
    kdf: &KdfParams,
) -> Result<Envelope, KeyError> {
    let mut salt = [0u8; SALT_LEN];
    random(&mut salt)?;
    // Nonce de 24 octets : un tirage aléatoire y est sûr sans compteur, une
    // collision étant hors de portée. C'est la raison du choix de XChaCha20.
    let mut nonce = [0u8; NONCE_LEN];
    random(&mut nonce)?;

    let wrap_key = derive(secret, &salt, kdf)?;
    let cipher = XChaCha20Poly1305::new(Key::from_slice(&wrap_key.0));
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: master.as_slice(),
                aad: aad(name).as_bytes(),
            },
        )
        .map_err(|_| KeyError::Internal("chiffrement d'une enveloppe"))?;

    Ok(Envelope {
        salt: B64.encode(salt),
        nonce: B64.encode(nonce),
        ciphertext: B64.encode(ciphertext),
    })
}

fn open_envelope(
    envelope: &Envelope,
    secret: &[u8],
    name: &str,
    kdf: &KdfParams,
    wrong_secret: KeyError,
) -> Result<MasterKey, KeyError> {
    let salt = decode(&envelope.salt, SALT_LEN, "sel")?;
    let nonce = decode(&envelope.nonce, NONCE_LEN, "nonce")?;
    let ciphertext = decode(&envelope.ciphertext, CIPHERTEXT_LEN, "enveloppe")?;

    let wrap_key = derive(secret, &salt, kdf)?;
    let cipher = XChaCha20Poly1305::new(Key::from_slice(&wrap_key.0));
    // Poly1305 ne distingue pas un mauvais mot de passe d'un octet altéré, et
    // c'est très bien : rien ne fuit vers celui qui essaie.
    let plain = Zeroizing::new(
        cipher
            .decrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: &ciphertext,
                    aad: aad(name).as_bytes(),
                },
            )
            .map_err(|_| wrong_secret)?,
    );

    if plain.len() != MASTER_KEY_LEN {
        return Err(KeyError::Corrupted(format!(
            "l'enveloppe « {name} » contient {} octets au lieu de {MASTER_KEY_LEN}",
            plain.len()
        )));
    }
    let mut master = [0u8; MASTER_KEY_LEN];
    master.copy_from_slice(&plain);
    let key = MasterKey(master);
    master.zeroize();
    Ok(key)
}

fn derive(secret: &[u8], salt: &[u8], kdf: &KdfParams) -> Result<WrapKey, KeyError> {
    check_kdf(kdf)?;
    let params = Params::new(kdf.m_cost_kib, kdf.t_cost, kdf.p_cost, Some(32))
        .map_err(|_| KeyError::Corrupted("paramètres Argon2id hors bornes".to_string()))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; 32];
    argon
        .hash_password_into(secret, salt, &mut out)
        .map_err(|_| KeyError::Internal("dérivation Argon2id"))?;
    Ok(WrapKey(out))
}

/// Les paramètres viennent du fichier, donc d'une source qu'un tiers peut avoir
/// remplacée : sans bornes, un `m_cost` de 4 Gio ferait tomber l'application à
/// chaque tentative de déverrouillage.
fn check_kdf(kdf: &KdfParams) -> Result<(), KeyError> {
    if kdf.algo != "argon2id" {
        return Err(KeyError::Corrupted(format!(
            "algorithme de dérivation inconnu : {}",
            kdf.algo
        )));
    }
    if !(8..=1_048_576).contains(&kdf.m_cost_kib)
        || !(1..=16).contains(&kdf.t_cost)
        || !(1..=4).contains(&kdf.p_cost)
    {
        return Err(KeyError::Corrupted(
            "paramètres Argon2id hors bornes raisonnables".to_string(),
        ));
    }
    Ok(())
}

fn decode(value: &str, expected: usize, what: &str) -> Result<Vec<u8>, KeyError> {
    let bytes = B64
        .decode(value)
        .map_err(|_| KeyError::Corrupted(format!("{what} : base64 invalide")))?;
    if bytes.len() != expected {
        return Err(KeyError::Corrupted(format!(
            "{what} : {} octets au lieu de {expected}",
            bytes.len()
        )));
    }
    Ok(bytes)
}

fn check_password_len(password: &str) -> Result<(), KeyError> {
    // Jamais de `trim` : un espace final fait partie de ce que l'enseignant
    // retapera, et l'enlever ici rendrait le mot de passe irreproductible.
    if password.chars().count() < MIN_PASSWORD_LEN {
        return Err(KeyError::PasswordTooShort);
    }
    Ok(())
}

fn random(buffer: &mut [u8]) -> Result<(), KeyError> {
    getrandom::fill(buffer).map_err(|_| KeyError::Internal("tirage aléatoire"))
}

// ---------------------------------------------------------------------------
// Phrase de récupération
// ---------------------------------------------------------------------------

fn generate_phrase() -> Result<RecoveryPhrase, KeyError> {
    let mut entropy = [0u8; PHRASE_ENTROPY_BYTES];
    random(&mut entropy)?;

    let mut display = String::with_capacity(PHRASE_LEN + PHRASE_GROUPS - 1);
    let mut accumulator: u16 = 0;
    let mut bits = 0u32;
    let mut emitted = 0usize;
    for byte in entropy {
        accumulator = (accumulator << 8) | u16::from(byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            if emitted > 0 && emitted.is_multiple_of(PHRASE_GROUP_LEN) {
                display.push('-');
            }
            display.push(ALPHABET[((accumulator >> bits) & 0x1f) as usize] as char);
            emitted += 1;
        }
    }
    entropy.zeroize();
    Ok(RecoveryPhrase(display))
}

/// Ce que la phrase donne à manger à Argon2id : ses 40 caractères, sans les
/// tirets qui ne servent qu'à l'affichage.
fn phrase_secret(phrase: &RecoveryPhrase) -> Zeroizing<String> {
    Zeroizing::new(phrase.0.chars().filter(|c| *c != '-').collect())
}

/// Ramène une saisie à ses 40 caractères canoniques, ou `None` si ce n'est pas
/// une phrase de récupération.
///
/// Casse, tirets et espaces sont ignorés. I, L et O sont relus 1, 1 et 0 : ces
/// lettres ne peuvent jamais appartenir à une phrase, la correction est donc
/// sans ambiguïté et rattrape une note prise à la main.
fn normalize_phrase(input: &str) -> Option<Zeroizing<String>> {
    let mut out = Zeroizing::new(String::with_capacity(PHRASE_LEN));
    for raw in input.chars() {
        if raw == '-' || raw.is_whitespace() {
            continue;
        }
        let c = match raw.to_ascii_uppercase() {
            'I' | 'L' => '1',
            'O' => '0',
            other => other,
        };
        if !ALPHABET.contains(&(c as u8)) || out.len() == PHRASE_LEN {
            return None;
        }
        out.push(c);
    }
    (out.len() == PHRASE_LEN).then_some(out)
}

// ---------------------------------------------------------------------------
// Lecture et écriture du fichier
// ---------------------------------------------------------------------------

fn read(root: &Path) -> Result<KeysFile, KeyError> {
    let target = path(root);
    let raw = match fs::read(&target) {
        Ok(raw) => raw,
        Err(source) if source.kind() == std::io::ErrorKind::NotFound => {
            return Err(KeyError::Absent)
        }
        Err(source) => {
            return Err(KeyError::Io {
                path: target,
                source,
            })
        }
    };

    let file: KeysFile = serde_json::from_slice(&raw)
        .map_err(|e| KeyError::Corrupted(format!("contenu JSON illisible ({e})")))?;
    if file.version != FORMAT_VERSION {
        return Err(KeyError::UnknownVersion {
            found: file.version,
            supported: FORMAT_VERSION,
        });
    }
    check_kdf(&file.kdf)?;
    Ok(file)
}

/// Écrit le fichier d'enveloppes en deux temps : un temporaire complet et
/// synchronisé, puis un `rename` par-dessus la cible.
///
/// Une écriture directe interrompue — clé USB arrachée, batterie à plat —
/// laisserait un fichier tronqué, et un fichier d'enveloppes tronqué signifie la
/// perte définitive de toute la base. Le `rename` est atomique sur le volume : à
/// tout instant, `sgpa.keys` est soit l'ancien fichier entier, soit le nouveau.
fn write_atomic(root: &Path, file: &KeysFile) -> Result<(), KeyError> {
    let target = path(root);
    let tmp = root.join(TMP_FILE_NAME);

    let json = serde_json::to_vec_pretty(file)
        .map_err(|_| KeyError::Internal("sérialisation du fichier de clés"))?;

    let written = (|| {
        let mut handle = fs::File::create(&tmp)?;
        handle.write_all(&json)?;
        // Sans `sync_all`, le rename pourrait devenir visible avant le contenu.
        handle.sync_all()
    })();
    if let Err(source) = written {
        let _ = fs::remove_file(&tmp);
        return Err(KeyError::Io { path: tmp, source });
    }

    fs::rename(&tmp, &target).map_err(|source| {
        let _ = fs::remove_file(&tmp);
        KeyError::Io {
            path: target,
            source,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const MDP: &str = "chateau-rouge";

    /// Chaque test travaille dans son propre dossier : ils tournent en parallèle
    /// et écrivent tous le même nom de fichier.
    fn dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sgpa-keys-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn literal(key: &MasterKey) -> String {
        key.pragma_literal().to_string()
    }

    #[test]
    fn aller_retour_de_l_enveloppe_mot_de_passe() {
        let root = dir("aller-retour");
        let (key, _phrase) = create(&root, MDP).unwrap();
        let reopened = unwrap_with_password(&root, MDP).unwrap();
        assert_eq!(literal(&key), literal(&reopened));
        // Forme exacte attendue par PRAGMA key : x' + 64 hexadécimaux + '.
        let text = literal(&key);
        assert!(text.starts_with("x'") && text.ends_with('\''));
        assert_eq!(text.len(), 67);
        assert!(text[2..66].bytes().all(|b| b.is_ascii_hexdigit()));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn mauvais_mot_de_passe_refuse() {
        let root = dir("mauvais-mdp");
        create(&root, MDP).unwrap();
        match unwrap_with_password(&root, "chateau-rouge!") {
            Err(KeyError::WrongPassword) => {}
            other => panic!("attendu WrongPassword, obtenu {other:?}"),
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn la_phrase_de_recuperation_ouvre_la_meme_cle() {
        let root = dir("phrase");
        let (key, phrase) = create(&root, MDP).unwrap();

        // Forme affichée : 8 groupes de 5, séparés par des tirets.
        let groups: Vec<&str> = phrase.as_str().split('-').collect();
        assert_eq!(groups.len(), PHRASE_GROUPS);
        assert!(groups.iter().all(|g| g.len() == PHRASE_GROUP_LEN));
        assert!(phrase
            .as_str()
            .bytes()
            .all(|b| b == b'-' || ALPHABET.contains(&b)));

        let reopened = unwrap_with_recovery(&root, phrase.as_str()).unwrap();
        assert_eq!(literal(&key), literal(&reopened));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn phrase_de_recuperation_etrangere_refusee() {
        let root = dir("phrase-etrangere");
        create(&root, MDP).unwrap();
        let autre = dir("phrase-etrangere-bis");
        let (_, phrase) = create(&autre, MDP).unwrap();

        match unwrap_with_recovery(&root, phrase.as_str()) {
            Err(KeyError::WrongRecovery) => {}
            other => panic!("attendu WrongRecovery, obtenu {other:?}"),
        }
        // Une saisie qui n'a pas la bonne forme se distingue d'une phrase fausse.
        match unwrap_with_recovery(&root, "trop court") {
            Err(KeyError::MalformedRecovery) => {}
            other => panic!("attendu MalformedRecovery, obtenu {other:?}"),
        }
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&autre);
    }

    #[test]
    fn normalisation_de_la_phrase() {
        let root = dir("normalisation");
        let (_, phrase) = create(&root, MDP).unwrap();
        let affichee = phrase.as_str().to_string();

        for variante in [
            affichee.to_lowercase(),
            affichee.replace('-', ""),
            affichee.replace('-', " "),
            format!("  {}  ", affichee.to_lowercase().replace('-', "\n")),
        ] {
            assert!(
                unwrap_with_recovery(&root, &variante).is_ok(),
                "variante refusée : {variante}"
            );
        }

        // I, L et O sont absents de l'alphabet : les relire 1, 1 et 0 est sans
        // ambiguïté et rattrape une phrase recopiée à la main.
        let brouillee = affichee.replace('1', "l").replace('0', "O");
        assert!(unwrap_with_recovery(&root, &brouillee).is_ok());

        // 41 caractères valides : ce n'est plus une phrase.
        let trop_longue = format!("{affichee}A");
        match unwrap_with_recovery(&root, &trop_longue) {
            Err(KeyError::MalformedRecovery) => {}
            other => panic!("attendu MalformedRecovery, obtenu {other:?}"),
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn changement_de_mot_de_passe() {
        let root = dir("changement");
        let (key, phrase) = create(&root, MDP).unwrap();

        change_password(&root, MDP, "nouveau-mot-de-passe").unwrap();

        match unwrap_with_password(&root, MDP) {
            Err(KeyError::WrongPassword) => {}
            other => panic!("l'ancien mot de passe doit être refusé, obtenu {other:?}"),
        }
        let par_mdp = unwrap_with_password(&root, "nouveau-mot-de-passe").unwrap();
        // La clé maître ne change pas : la base et les sauvegardes déjà prises
        // restent ouvrables.
        assert_eq!(literal(&key), literal(&par_mdp));

        // L'enveloppe de récupération n'a pas été touchée.
        let par_phrase = unwrap_with_recovery(&root, phrase.as_str()).unwrap();
        assert_eq!(literal(&key), literal(&par_phrase));

        // Un mauvais mot de passe actuel ne réécrit rien.
        match change_password(&root, MDP, "encore-un-autre") {
            Err(KeyError::WrongPassword) => {}
            other => panic!("attendu WrongPassword, obtenu {other:?}"),
        }
        assert!(unwrap_with_password(&root, "nouveau-mot-de-passe").is_ok());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn regeneration_de_la_phrase_invalide_l_ancienne() {
        let root = dir("regeneration");
        let (key, ancienne) = create(&root, MDP).unwrap();
        let nouvelle = regenerate_recovery(&root, MDP).unwrap();
        assert_ne!(ancienne.as_str(), nouvelle.as_str());

        match unwrap_with_recovery(&root, ancienne.as_str()) {
            Err(KeyError::WrongRecovery) => {}
            other => panic!("l'ancienne phrase doit être refusée, obtenu {other:?}"),
        }
        assert_eq!(
            literal(&key),
            literal(&unwrap_with_recovery(&root, nouvelle.as_str()).unwrap())
        );
        // Le mot de passe n'a pas bougé.
        assert_eq!(
            literal(&key),
            literal(&unwrap_with_password(&root, MDP).unwrap())
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn recuperation_puis_nouveau_mot_de_passe() {
        let root = dir("recuperation");
        let (key, phrase) = create(&root, MDP).unwrap();

        // Le mot de passe est oublié : la phrase ouvre la clé, puis on repose
        // une enveloppe password autour d'elle.
        let master = unwrap_with_recovery(&root, phrase.as_str()).unwrap();
        reset_password(&root, &master, "un-tout-autre-mdp").unwrap();

        assert!(matches!(
            unwrap_with_password(&root, MDP),
            Err(KeyError::WrongPassword)
        ));
        assert_eq!(
            literal(&key),
            literal(&unwrap_with_password(&root, "un-tout-autre-mdp").unwrap())
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn intervertir_les_enveloppes_echoue_grace_a_l_aad() {
        // Les deux enveloppes portent ici le MÊME secret : si l'échange échoue
        // quand même, c'est bien l'AAD qui les sépare, et pas la clé dérivée.
        let master = [7u8; MASTER_KEY_LEN];
        let kdf = KdfParams {
            // Le test porte sur l'AAD, pas sur le coût du KDF : on l'abaisse
            // pour ne pas payer 64 Mio quatre fois.
            m_cost_kib: 64,
            t_cost: 1,
            ..KdfParams::default()
        };
        let envelope = wrap(&master, b"le-meme-secret", WRAP_PASSWORD, &kdf).unwrap();

        let ok = open_envelope(
            &envelope,
            b"le-meme-secret",
            WRAP_PASSWORD,
            &kdf,
            KeyError::WrongPassword,
        );
        assert!(ok.is_ok(), "l'enveloppe doit s'ouvrir sous son propre nom");

        let swapped = open_envelope(
            &envelope,
            b"le-meme-secret",
            WRAP_RECOVERY,
            &kdf,
            KeyError::WrongRecovery,
        );
        assert!(
            matches!(swapped, Err(KeyError::WrongRecovery)),
            "une enveloppe déplacée sous l'autre nom doit être refusée"
        );
    }

    #[test]
    fn ecriture_atomique_ne_touche_pas_la_cible_avant_le_rename() {
        let root = dir("atomique");
        create(&root, MDP).unwrap();
        let avant = fs::read(path(&root)).unwrap();

        // Le temporaire ne doit jamais survivre à une écriture réussie.
        assert!(!root.join(TMP_FILE_NAME).exists());

        // On rend le temporaire impossible à créer : l'écriture doit échouer
        // AVANT d'avoir touché la cible.
        fs::create_dir(root.join(TMP_FILE_NAME)).unwrap();
        let echec = set_hint(&root, "le nom de mon premier chat");
        assert!(matches!(echec, Err(KeyError::Io { .. })));
        assert_eq!(
            fs::read(path(&root)).unwrap(),
            avant,
            "le fichier de clés doit être intact après une écriture avortée"
        );

        // Et une fois l'obstacle levé, la mise à jour passe et reste complète.
        fs::remove_dir(root.join(TMP_FILE_NAME)).unwrap();
        set_hint(&root, "le nom de mon premier chat").unwrap();
        assert_eq!(read_hint(&root), "le nom de mon premier chat");
        assert!(unwrap_with_password(&root, MDP).is_ok());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn le_fichier_ne_porte_aucune_identite() {
        let root = dir("anonyme");
        create(&root, MDP).unwrap();
        let raw = fs::read_to_string(path(&root)).unwrap();
        let value: serde_json::Value = serde_json::from_str(&raw).unwrap();

        let mut cles: Vec<&str> = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        cles.sort_unstable();
        // Garde-fou : rien d'identifiant ne doit s'ajouter ici. Une clé USB
        // trouvée ne doit pas dire à qui elle appartient.
        assert_eq!(cles, ["created_at", "hint", "kdf", "version", "wraps"]);
        assert_eq!(value["hint"], "");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn fichier_absent_corrompu_ou_trop_recent() {
        let root = dir("etats");
        assert!(!exists(&root));
        assert!(matches!(
            unwrap_with_password(&root, MDP),
            Err(KeyError::Absent)
        ));
        assert_eq!(read_hint(&root), "");

        fs::write(path(&root), b"ceci n'est pas du JSON").unwrap();
        assert!(matches!(
            unwrap_with_password(&root, MDP),
            Err(KeyError::Corrupted(_))
        ));

        let _ = fs::remove_file(path(&root));
        let (_, _) = create(&root, MDP).unwrap();
        let mut value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(path(&root)).unwrap()).unwrap();
        value["version"] = serde_json::json!(99);
        fs::write(path(&root), value.to_string()).unwrap();
        match unwrap_with_password(&root, MDP) {
            Err(KeyError::UnknownVersion { found, supported }) => {
                assert_eq!(found, 99);
                assert_eq!(supported, FORMAT_VERSION);
            }
            other => panic!("attendu UnknownVersion, obtenu {other:?}"),
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn parametres_kdf_hors_bornes_refuses() {
        let root = dir("kdf");
        create(&root, MDP).unwrap();
        let mut value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(path(&root)).unwrap()).unwrap();
        // Un fichier bricolé ne doit pas pouvoir faire réserver 4 Gio.
        value["kdf"]["m_cost_kib"] = serde_json::json!(4_194_304u32);
        fs::write(path(&root), value.to_string()).unwrap();
        assert!(matches!(
            unwrap_with_password(&root, MDP),
            Err(KeyError::Corrupted(_))
        ));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn mot_de_passe_trop_court_refuse_avant_tout_calcul() {
        let root = dir("trop-court");
        assert!(matches!(
            create(&root, "1234567"),
            Err(KeyError::PasswordTooShort)
        ));
        assert!(!exists(&root), "rien ne doit être écrit");

        create(&root, MDP).unwrap();
        assert!(matches!(
            change_password(&root, MDP, "court"),
            Err(KeyError::PasswordTooShort)
        ));
        assert!(matches!(create(&root, MDP), Err(KeyError::AlreadyExists)));
        let _ = fs::remove_dir_all(&root);
    }

    // -----------------------------------------------------------------------
    // Enveloppe PIN
    // -----------------------------------------------------------------------

    const POSTE: &str = "poste-de-la-salle-12";
    const SECRET: [u8; 32] = [0x5a; 32];

    #[test]
    fn le_pin_ouvre_la_meme_cle_que_le_mot_de_passe() {
        let root = dir("pin-aller-retour");
        let (key, _) = create(&root, MDP).unwrap();
        assert!(!has_pin(&root, POSTE));

        set_pin(&root, &key, POSTE, &SECRET, "042195").unwrap();
        assert!(has_pin(&root, POSTE));

        let ouverte = unwrap_with_pin(&root, POSTE, &SECRET, "042195").unwrap();
        assert_eq!(literal(&key), literal(&ouverte));
        // Le mot de passe reste la vraie clé : poser un PIN ne le touche pas.
        assert_eq!(
            literal(&unwrap_with_password(&root, MDP).unwrap()),
            literal(&key)
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn un_pin_faux_ou_mal_forme_se_distinguent() {
        let root = dir("pin-faux");
        let (key, _) = create(&root, MDP).unwrap();
        set_pin(&root, &key, POSTE, &SECRET, "042195").unwrap();

        match unwrap_with_pin(&root, POSTE, &SECRET, "042196") {
            Err(KeyError::WrongPin) => {}
            other => panic!("attendu WrongPin, obtenu {other:?}"),
        }
        // Ces saisies ne dérivent rien : l'appelant ne doit pas les compter
        // comme des essais, il lui faut donc une erreur différente. La dernière
        // porte un chiffre pleine largeur — `is_ascii_digit` le refuse, et c'est
        // voulu : six octets ASCII, pas six « chiffres » au sens d'Unicode.
        for saisie in ["", "0421", "0421956", "04219a", "04 195", "04219５"] {
            match unwrap_with_pin(&root, POSTE, &SECRET, saisie) {
                Err(KeyError::MalformedPin) => {}
                other => panic!("attendu MalformedPin pour « {saisie} », obtenu {other:?}"),
            }
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn sans_le_secret_du_poste_le_pin_n_ouvre_rien() {
        let root = dir("pin-sans-poste");
        let (key, _) = create(&root, MDP).unwrap();
        set_pin(&root, &key, POSTE, &SECRET, "042195").unwrap();

        // Le bon code, mais les 32 octets d'un autre poste : c'est la situation
        // de qui ramasse la clé USB et essaie des codes. Elle doit échouer même
        // avec le code juste — c'est tout ce sur quoi repose la fonction.
        match unwrap_with_pin(&root, POSTE, &[0x5b; 32], "042195") {
            Err(KeyError::WrongPin) => {}
            other => panic!("attendu WrongPin, obtenu {other:?}"),
        }
        // Un poste inconnu se distingue d'un code faux : il n'y a rien à
        // essayer, et l'écran doit proposer le mot de passe au lieu de compter
        // un essai.
        match unwrap_with_pin(&root, "autre-poste", &SECRET, "042195") {
            Err(KeyError::PinAbsent) => {}
            other => panic!("attendu PinAbsent, obtenu {other:?}"),
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn echanger_deux_enveloppes_pin_les_rend_inouvrables() {
        let root = dir("pin-echange");
        let (key, _) = create(&root, MDP).unwrap();
        set_pin(&root, &key, "poste-a", &SECRET, "111111").unwrap();
        set_pin(&root, &key, "poste-b", &[0x77; 32], "222222").unwrap();

        let mut value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(path(&root)).unwrap()).unwrap();
        let a = value["wraps"]["pin"][0]["envelope"].clone();
        let b = value["wraps"]["pin"][1]["envelope"].clone();
        value["wraps"]["pin"][0]["envelope"] = b;
        value["wraps"]["pin"][1]["envelope"] = a;
        fs::write(path(&root), value.to_string()).unwrap();

        // Le `device_id` entre dans les données associées : une enveloppe
        // déplacée d'un poste à l'autre ne s'ouvre plus, même avec le bon secret
        // et le bon code.
        assert!(matches!(
            unwrap_with_pin(&root, "poste-a", &SECRET, "111111"),
            Err(KeyError::WrongPin)
        ));
        assert!(matches!(
            unwrap_with_pin(&root, "poste-b", &[0x77; 32], "222222"),
            Err(KeyError::WrongPin)
        ));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn changer_de_mot_de_passe_ne_casse_pas_le_pin() {
        let root = dir("pin-changement-mdp");
        let (key, phrase) = create(&root, MDP).unwrap();
        set_pin(&root, &key, POSTE, &SECRET, "042195").unwrap();

        change_password(&root, MDP, "nouveau-chateau").unwrap();
        // La clé maître ne bouge pas : l'enveloppe PIN entoure toujours la même
        // clé. C'est la raison d'être du bouton « Oublier ce poste » — changer
        // le mot de passe ne retire pas le PIN, et l'interface doit le dire.
        assert_eq!(
            literal(&unwrap_with_pin(&root, POSTE, &SECRET, "042195").unwrap()),
            literal(&key)
        );
        regenerate_recovery(&root, "nouveau-chateau").unwrap();
        assert!(unwrap_with_pin(&root, POSTE, &SECRET, "042195").is_ok());
        assert!(unwrap_with_recovery(&root, phrase.as_str()).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reactiver_remplace_l_enveloppe_du_poste() {
        let root = dir("pin-reactivation");
        let (key, _) = create(&root, MDP).unwrap();
        set_pin(&root, &key, POSTE, &SECRET, "111111").unwrap();
        set_pin(&root, &key, POSTE, &SECRET, "222222").unwrap();

        // Une seule enveloppe par poste : l'ancien code doit cesser d'ouvrir la
        // base, sinon changer de PIN ne servirait à rien.
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(path(&root)).unwrap()).unwrap();
        assert_eq!(value["wraps"]["pin"].as_array().unwrap().len(), 1);
        assert!(unwrap_with_pin(&root, POSTE, &SECRET, "222222").is_ok());
        assert!(matches!(
            unwrap_with_pin(&root, POSTE, &SECRET, "111111"),
            Err(KeyError::WrongPin)
        ));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn oublier_un_poste_retire_son_enveloppe() {
        let root = dir("pin-oubli");
        let (key, _) = create(&root, MDP).unwrap();
        set_pin(&root, &key, POSTE, &SECRET, "042195").unwrap();

        remove_pin(&root, POSTE).unwrap();
        assert!(!has_pin(&root, POSTE));
        assert!(matches!(
            unwrap_with_pin(&root, POSTE, &SECRET, "042195"),
            Err(KeyError::PinAbsent)
        ));
        // Oublier est un état visé, pas une opération : le refaire ne doit pas
        // échouer, et un poste inconnu non plus.
        remove_pin(&root, POSTE).unwrap();
        remove_pin(&root, "jamais-vu").unwrap();

        // Le fichier reprend exactement la forme qu'il avait avant le PIN :
        // « pin » disparaît au lieu de rester un tableau vide.
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(path(&root)).unwrap()).unwrap();
        assert!(value["wraps"].get("pin").is_none());
        assert!(unwrap_with_password(&root, MDP).is_ok());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn le_nombre_d_enveloppes_pin_est_borne() {
        let root = dir("pin-borne");
        let (key, _) = create(&root, MDP).unwrap();
        for n in 0..=MAX_PIN_WRAPS {
            set_pin(&root, &key, &format!("poste-{n}"), &SECRET, "042195").unwrap();
        }

        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(path(&root)).unwrap()).unwrap();
        assert_eq!(
            value["wraps"]["pin"].as_array().unwrap().len(),
            MAX_PIN_WRAPS
        );
        // C'est la plus ancienne qui part, et le poste concerné redemandera le
        // mot de passe — jamais le fichier de clés qui enfle sans borne.
        assert!(!has_pin(&root, "poste-0"));
        assert!(has_pin(&root, &format!("poste-{MAX_PIN_WRAPS}")));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn un_fichier_ecrit_avant_le_pin_reste_lisible() {
        let root = dir("pin-compatibilite");
        let (key, phrase) = create(&root, MDP).unwrap();
        set_pin(&root, &key, POSTE, &SECRET, "042195").unwrap();

        // Un fichier de clés d'avant cette version n'a aucun champ « pin ».
        let mut value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(path(&root)).unwrap()).unwrap();
        value["wraps"]
            .as_object_mut()
            .unwrap()
            .remove("pin")
            .expect("l'enveloppe PIN vient d'être posée");
        fs::write(path(&root), value.to_string()).unwrap();

        assert_eq!(
            literal(&unwrap_with_password(&root, MDP).unwrap()),
            literal(&key)
        );
        assert!(unwrap_with_recovery(&root, phrase.as_str()).is_ok());
        assert!(!has_pin(&root, POSTE));
        // Et le PIN peut être reposé par-dessus un tel fichier.
        set_pin(&root, &key, POSTE, &SECRET, "042195").unwrap();
        assert!(unwrap_with_pin(&root, POSTE, &SECRET, "042195").is_ok());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn les_secrets_ne_s_affichent_pas() {
        let key = MasterKey::from_bytes_for_tests([0xab; MASTER_KEY_LEN]);
        let rendu = format!("{key:?}");
        assert_eq!(rendu, "MasterKey(masquée)");
        assert!(!rendu.contains("ab"));
    }
}
