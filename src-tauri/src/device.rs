//! Secret de poste du déverrouillage par code PIN — `%LOCALAPPDATA%\SGPA`.
//!
//! **Ce module est la seule exception assumée à la portabilité de SGPA.** Tout
//! le reste vit à côté de l'exécutable (voir `portable.rs`) ; ici, et ici
//! seulement, un fichier est écrit dans le profil du poste hôte. C'est la
//! condition même de la fonction : si ce fichier suivait la clé USB, il serait
//! perdu avec elle, et six chiffres suffiraient alors à ouvrir la base.
//!
//! Rien n'est écrit tant que l'enseignant n'a pas activé le PIN sur ce poste, et
//! « Oublier ce poste » efface le fichier. Une clé USB branchée sur un poste du
//! collège n'y laisse donc toujours aucune trace.
//!
//! ## Ce que le PIN protège, et ce qu'il ne protège pas
//!
//! Le secret qui ouvre l'enveloppe PIN a deux moitiés :
//!
//! - **32 octets tirés au hasard**, dans ce fichier, chiffrés par DPAPI pour le
//!   compte Windows courant — donc ni sur la clé USB, ni lisibles par un autre
//!   compte du même poste ;
//! - **les six chiffres**, qui ne sont écrits nulle part.
//!
//! Qui ramasse la clé USB n'a que l'enveloppe : il lui manque 32 octets, soit
//! 2^256 possibilités. L'enveloppe PIN est donc aussi inouvrable que celle du
//! mot de passe.
//!
//! Qui a en revanche **les deux** — la clé USB et une session Windows ouverte
//! sur ce compte — n'a plus que 10^6 combinaisons à essayer. Argon2id les rend
//! lentes, pas impossibles : quelques minutes sur une carte graphique. C'est
//! pourquoi le mot de passe reste la vraie clé, et pourquoi le PIN ne s'active
//! que poste par poste, à la main. Le compteur d'essais ci-dessous relève la
//! barre du cas courant — quelqu'un qui tape des codes au clavier — sans rien
//! promettre contre une attaque hors ligne : il vit dans le même fichier, qu'un
//! attaquant peut copier avant d'essayer puis remettre en place.
//!
//! Le compteur vit tout de même **ici** et non sur la clé USB : là-bas, dupliquer
//! la clé avant d'essayer suffirait à le remettre à zéro, et il ne vaudrait
//! strictement rien.

use std::fmt;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

/// Longueur du secret de poste : la moitié qui ne passe pas par le clavier.
pub const SECRET_LEN: usize = 32;

/// Essais manqués au bout desquels le poste est oublié.
///
/// Dix, et non trois : se tromper de PIN arrive, et la sanction n'est pas une
/// perte de données mais la réapparition du mot de passe. Un seuil trop bas
/// transformerait une maladresse en corvée.
pub const MAX_FAILURES: u32 = 10;

const FILE_NAME: &str = "poste.bin";
const TMP_FILE_NAME: &str = "poste.bin.tmp";

/// Variable d'échappement, pour les tests et pour un poste où `%LOCALAPPDATA%`
/// ne serait pas inscriptible.
const DIR_ENV: &str = "SGPA_DEVICE_DIR";

const FORMAT_VERSION: u32 = 1;

/// Entropie supplémentaire de DPAPI. Elle lie le blob à SGPA : un fichier
/// protégé par une autre application du même compte ne se déchiffre pas ici.
const DPAPI_ENTROPY: &[u8] = b"sgpa-pin-v1";

// ---------------------------------------------------------------------------
// Erreurs
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub enum DeviceError {
    /// Plateforme sans DPAPI : le PIN n'y est pas proposé.
    Unsupported,
    /// `%LOCALAPPDATA%` introuvable — profil Windows inhabituel.
    NoLocalAppData,
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    /// DPAPI a refusé. Cas courant : le fichier a été écrit par un autre compte
    /// Windows, ou copié depuis un autre poste.
    Dpapi {
        step: &'static str,
        code: u32,
    },
    Corrupted(String),
    Internal(&'static str),
}

impl fmt::Display for DeviceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DeviceError::Unsupported => write!(
                f,
                "Le déverrouillage par code PIN n'est disponible que sous Windows.\n\n\
                 Utilisez votre mot de passe."
            ),
            DeviceError::NoLocalAppData => write!(
                f,
                "Le dossier personnel de ce poste est introuvable.\n\n\
                 Le code PIN a besoin d'y ranger un petit fichier, propre à ce poste \
                 et à votre compte Windows. Utilisez votre mot de passe, ou imposez \
                 un emplacement avec la variable d'environnement {DIR_ENV}."
            ),
            DeviceError::Io { path, source } => write!(
                f,
                "Le fichier de code PIN de ce poste n'a pas pu être lu ou écrit.\n\n\
                 Fichier : {}\n\
                 Détail : {source}\n\n\
                 Votre mot de passe, lui, ouvre toujours la base.",
                path.display()
            ),
            DeviceError::Dpapi { step, code } => write!(
                f,
                "Windows a refusé de {step} le code PIN de ce poste.\n\n\
                 Code d'erreur : {code}\n\n\
                 Le plus souvent, c'est que ce fichier a été créé depuis un autre \
                 compte Windows, ou recopié depuis un autre poste : il ne vaut que \
                 là où il a été créé, c'est précisément ce qui protège vos données. \
                 Déverrouillez avec votre mot de passe, puis réactivez le code PIN \
                 depuis les réglages."
            ),
            DeviceError::Corrupted(detail) => write!(
                f,
                "Le fichier de code PIN de ce poste est illisible.\n\n\
                 Détail : {detail}\n\n\
                 Rien n'est perdu : déverrouillez avec votre mot de passe, puis \
                 réactivez le code PIN depuis les réglages."
            ),
            DeviceError::Internal(step) => write!(
                f,
                "Une opération du code PIN a échoué.\n\n\
                 Étape : {step}\n\n\
                 Déverrouillez avec votre mot de passe."
            ),
        }
    }
}

impl std::error::Error for DeviceError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            DeviceError::Io { source, .. } => Some(source),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Le secret
// ---------------------------------------------------------------------------

/// Secret de ce poste, en mémoire.
///
/// Pas de `Clone`, `Debug` muet, effacement au `Drop` : les mêmes précautions
/// que `MasterKey`, pour la même raison — ces 32 octets sont la moitié d'une clé.
pub struct Device {
    id: String,
    secret: [u8; SECRET_LEN],
    failures: u32,
}

impl Device {
    /// Identifiant du poste. **Pas un secret** : il sert à retrouver la bonne
    /// enveloppe dans `data/sgpa.keys`, et n'ouvre rien à lui seul. Tiré au
    /// hasard et non dérivé du matériel : il ne dit rien du poste ni de son
    /// propriétaire.
    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn secret(&self) -> &[u8] {
        &self.secret
    }

    pub fn failures(&self) -> u32 {
        self.failures
    }
}

impl fmt::Debug for Device {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Device(masqué)")
    }
}

impl Drop for Device {
    fn drop(&mut self) {
        self.secret.zeroize();
    }
}

/// Contenu du fichier, **avant** la protection DPAPI.
#[derive(Serialize, Deserialize)]
struct DeviceFile {
    version: u32,
    device_id: String,
    /// Les 32 octets en base64. La chaîne est effacée dès qu'elle a servi.
    secret: String,
    #[serde(default)]
    failures: u32,
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/// Vrai si cette plateforme sait lier un secret au poste.
pub fn supported() -> bool {
    cfg!(windows)
}

/// Dossier du secret de poste : `%LOCALAPPDATA%\SGPA`, sauf surcharge.
///
/// Le dossier n'est pas créé ici — le dire ne doit rien écrire. C'est
/// `ensure` qui le crée, au moment où l'enseignant active le PIN.
pub fn dir() -> Result<PathBuf, DeviceError> {
    if !supported() {
        return Err(DeviceError::Unsupported);
    }
    if let Some(forced) = std::env::var_os(DIR_ENV) {
        return Ok(PathBuf::from(forced));
    }
    let base = std::env::var_os("LOCALAPPDATA").ok_or(DeviceError::NoLocalAppData)?;
    Ok(PathBuf::from(base).join("SGPA"))
}

pub fn path(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

/// Lit le secret de ce poste. `Ok(None)` = aucun PIN n'y a été activé.
///
/// L'absence du fichier n'est pas une erreur : c'est l'état de tous les postes
/// sauf ceux que l'enseignant a choisis.
pub fn load(dir: &Path) -> Result<Option<Device>, DeviceError> {
    let target = path(dir);
    let blob = match fs::read(&target) {
        Ok(blob) => blob,
        Err(source) if source.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(source) => {
            return Err(DeviceError::Io {
                path: target,
                source,
            })
        }
    };

    let plain = unprotect(&blob)?;
    let mut file: DeviceFile = serde_json::from_slice(&plain)
        .map_err(|e| DeviceError::Corrupted(format!("contenu illisible ({e})")))?;
    if file.version != FORMAT_VERSION {
        return Err(DeviceError::Corrupted(format!(
            "version {} inconnue",
            file.version
        )));
    }

    let decoded = Zeroizing::new(
        B64.decode(&file.secret)
            .map_err(|_| DeviceError::Corrupted("secret : base64 invalide".to_string()))?,
    );
    file.secret.zeroize();
    if decoded.len() != SECRET_LEN {
        return Err(DeviceError::Corrupted(format!(
            "secret : {} octets au lieu de {SECRET_LEN}",
            decoded.len()
        )));
    }
    let mut secret = [0u8; SECRET_LEN];
    secret.copy_from_slice(&decoded);

    Ok(Some(Device {
        id: file.device_id,
        secret,
        failures: file.failures,
    }))
}

/// Rend le secret de ce poste, en le créant si besoin, compteur d'essais remis
/// à zéro.
///
/// Un secret déjà présent est **réutilisé** : l'enseignant peut avoir activé le
/// PIN pour une autre base depuis ce poste, et en tirer un nouveau laisserait
/// là-bas une enveloppe que plus rien n'ouvre.
pub fn ensure(dir: &Path) -> Result<Device, DeviceError> {
    if let Some(mut existing) = load(dir)? {
        if existing.failures != 0 {
            write(dir, existing.id(), existing.secret(), 0)?;
            existing.failures = 0;
        }
        return Ok(existing);
    }

    let mut secret = [0u8; SECRET_LEN];
    getrandom::fill(&mut secret).map_err(|_| DeviceError::Internal("tirage aléatoire"))?;
    let id = uuid::Uuid::new_v4().to_string();
    write(dir, &id, &secret, 0)?;

    Ok(Device {
        id,
        secret,
        failures: 0,
    })
}

/// Enregistre le nouveau compte d'essais manqués.
pub fn set_failures(dir: &Path, device: &Device, failures: u32) -> Result<(), DeviceError> {
    write(dir, device.id(), device.secret(), failures)
}

/// Oublie ce poste : le fichier disparaît, et l'enveloppe PIN qui lui
/// correspondait devient inouvrable.
///
/// Un fichier déjà absent n'est pas une erreur — « oublier » est l'état visé, pas
/// l'opération.
pub fn forget(dir: &Path) -> Result<(), DeviceError> {
    let target = path(dir);
    match fs::remove_file(&target) {
        Ok(()) => Ok(()),
        Err(source) if source.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(source) => Err(DeviceError::Io {
            path: target,
            source,
        }),
    }
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

/// Écrit le fichier protégé, en deux temps comme `keys::write_atomic` : un
/// temporaire synchronisé, puis un `rename`.
///
/// Un fichier tronqué ici ne détruirait rien — le mot de passe ouvre toujours la
/// base — mais il obligerait l'enseignant à repasser par les réglages sans
/// comprendre pourquoi.
fn write(dir: &Path, id: &str, secret: &[u8], failures: u32) -> Result<(), DeviceError> {
    fs::create_dir_all(dir).map_err(|source| DeviceError::Io {
        path: dir.to_path_buf(),
        source,
    })?;

    let mut file = DeviceFile {
        version: FORMAT_VERSION,
        device_id: id.to_string(),
        secret: B64.encode(secret),
        failures,
    };
    // `plain` et le champ `secret` portent tous deux les 32 octets : le premier
    // s'efface en tombant, le second à la main puisque `DeviceFile` est un
    // struct ordinaire.
    let plain = Zeroizing::new(
        serde_json::to_vec(&file)
            .map_err(|_| DeviceError::Internal("sérialisation du secret de poste"))?,
    );
    file.secret.zeroize();

    let blob = protect(&plain)?;

    let target = path(dir);
    let tmp = dir.join(TMP_FILE_NAME);
    let written = (|| {
        let mut handle = fs::File::create(&tmp)?;
        handle.write_all(&blob)?;
        handle.sync_all()
    })();
    if let Err(source) = written {
        let _ = fs::remove_file(&tmp);
        return Err(DeviceError::Io { path: tmp, source });
    }

    fs::rename(&tmp, &target).map_err(|source| {
        let _ = fs::remove_file(&tmp);
        DeviceError::Io {
            path: target,
            source,
        }
    })
}

// ---------------------------------------------------------------------------
// DPAPI
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn protect(plain: &[u8]) -> Result<Vec<u8>, DeviceError> {
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input = blob(plain);
    let entropy = blob(DPAPI_ENTROPY);
    let mut out = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    // SAFETY : `input` et `entropy` décrivent des tranches vivantes jusqu'au
    // retour de l'appel, et DPAPI ne les écrit pas. `CRYPTPROTECT_UI_FORBIDDEN`
    // interdit toute boîte de dialogue : l'appel échoue plutôt que de bloquer
    // l'application sur une invite invisible.
    let ok = unsafe {
        CryptProtectData(
            &input,
            std::ptr::null(),
            &entropy,
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out,
        )
    };
    if ok == 0 {
        return Err(DeviceError::Dpapi {
            step: "protéger",
            code: last_error(),
        });
    }
    Ok(take_blob(out))
}

#[cfg(windows)]
fn unprotect(blob_in: &[u8]) -> Result<Zeroizing<Vec<u8>>, DeviceError> {
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input = blob(blob_in);
    let entropy = blob(DPAPI_ENTROPY);
    let mut out = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    // SAFETY : mêmes garanties que `protect`. Le descripteur de sortie est
    // ignoré (`null`) : il ne contient rien d'utile ici.
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            &entropy,
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out,
        )
    };
    if ok == 0 {
        return Err(DeviceError::Dpapi {
            step: "relire",
            code: last_error(),
        });
    }
    Ok(Zeroizing::new(take_blob(out)))
}

#[cfg(windows)]
fn blob(data: &[u8]) -> windows_sys::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB {
    windows_sys::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        // DPAPI ne modifie pas ses entrées ; la structure ne connaît qu'un
        // pointeur mutable, d'où la conversion.
        pbData: data.as_ptr() as *mut u8,
    }
}

/// Recopie le tampon rendu par DPAPI, l'efface, puis le libère.
///
/// L'effacement avant `LocalFree` n'est pas de la superstition : ce tampon
/// contient les 32 octets du poste en clair, et le tas rendu n'est pas remis à
/// zéro par Windows.
#[cfg(windows)]
fn take_blob(out: windows_sys::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB) -> Vec<u8> {
    use windows_sys::Win32::Foundation::LocalFree;

    // SAFETY : DPAPI garantit `cbData` octets lisibles à `pbData`, alloués par
    // `LocalAlloc`, et c'est à l'appelant de les libérer.
    unsafe {
        let copy = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        std::ptr::write_bytes(out.pbData, 0, out.cbData as usize);
        LocalFree(out.pbData as *mut core::ffi::c_void);
        copy
    }
}

#[cfg(windows)]
fn last_error() -> u32 {
    // SAFETY : aucun paramètre, aucune mémoire touchée.
    unsafe { windows_sys::Win32::Foundation::GetLastError() }
}

#[cfg(not(windows))]
fn protect(_plain: &[u8]) -> Result<Vec<u8>, DeviceError> {
    Err(DeviceError::Unsupported)
}

#[cfg(not(windows))]
fn unprotect(_blob_in: &[u8]) -> Result<Zeroizing<Vec<u8>>, DeviceError> {
    Err(DeviceError::Unsupported)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// DPAPI n'existe que sous Windows, et c'est la seule cible de SGPA : ailleurs,
/// il n'y a rien à éprouver que le refus.
#[cfg(all(test, windows))]
mod tests {
    use super::*;

    /// Chaque test écrit le même nom de fichier : il lui faut son dossier.
    fn dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sgpa-poste-{name}"));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn aller_retour_du_secret_de_poste() {
        let root = dir("aller-retour");
        let cree = ensure(&root).unwrap();
        let id = cree.id().to_string();
        let secret = cree.secret().to_vec();
        assert_eq!(secret.len(), SECRET_LEN);
        assert_eq!(cree.failures(), 0);
        drop(cree);

        let relu = load(&root).unwrap().expect("le fichier vient d'être écrit");
        assert_eq!(relu.id(), id);
        assert_eq!(relu.secret(), secret.as_slice());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn aucun_fichier_n_est_pas_une_erreur() {
        let root = dir("absent");
        fs::create_dir_all(&root).unwrap();
        assert!(load(&root).unwrap().is_none());
        // « Oublier » est un état visé, pas une opération : l'appeler deux fois
        // de suite ne doit pas échouer la seconde.
        forget(&root).unwrap();
        forget(&root).unwrap();
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn le_fichier_ne_laisse_rien_lire_en_clair() {
        let root = dir("opaque");
        let poste = ensure(&root).unwrap();
        let id = poste.id().to_string();
        let secret = poste.secret().to_vec();
        drop(poste);

        let brut = fs::read(path(&root)).unwrap();
        let fenetre = |aiguille: &[u8]| brut.windows(aiguille.len().max(1)).any(|w| w == aiguille);
        assert!(
            !fenetre(&secret),
            "les 32 octets du poste se lisent dans le fichier"
        );
        assert!(
            !fenetre(B64.encode(&secret).as_bytes()),
            "le secret se lit en base64 dans le fichier"
        );
        assert!(
            !fenetre(id.as_bytes()),
            "l'identifiant du poste se lit dans le fichier"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn le_compteur_d_essais_survit_a_la_relecture() {
        let root = dir("compteur");
        let poste = ensure(&root).unwrap();
        let id = poste.id().to_string();
        set_failures(&root, &poste, 4).unwrap();
        drop(poste);

        let relu = load(&root).unwrap().unwrap();
        assert_eq!(relu.failures(), 4);
        // Le secret ne bouge pas quand le compteur change : sinon l'enveloppe
        // PIN cesserait de s'ouvrir au premier essai manqué.
        assert_eq!(relu.id(), id);
        drop(relu);

        // `ensure` remet le compteur à zéro — c'est la réactivation — sans
        // changer d'identifiant.
        let reactive = ensure(&root).unwrap();
        assert_eq!(reactive.failures(), 0);
        assert_eq!(reactive.id(), id);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn un_fichier_altere_est_refuse() {
        let root = dir("altere");
        ensure(&root).unwrap();
        let mut brut = fs::read(path(&root)).unwrap();
        let dernier = brut.len() - 1;
        brut[dernier] ^= 0xff;
        fs::write(path(&root), &brut).unwrap();

        match load(&root) {
            Err(DeviceError::Dpapi { .. }) => {}
            other => panic!("attendu un refus de DPAPI, obtenu {other:?}"),
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn le_secret_ne_s_affiche_pas() {
        let root = dir("masque");
        let poste = ensure(&root).unwrap();
        let affiche = format!("{poste:?}");
        assert_eq!(affiche, "Device(masqué)");
        assert!(!affiche.contains(poste.id()));
        let _ = fs::remove_dir_all(&root);
    }
}
