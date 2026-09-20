use std::fmt;
use std::fs;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Emplacements de travail de l'application.
///
/// Tout est résolu relativement à l'exécutable : l'application doit pouvoir vivre
/// entièrement sur une clé USB et suivre son porteur d'un poste à l'autre. Rien
/// n'est écrit dans `%APPDATA%` ni `%LOCALAPPDATA%` du poste hôte.
#[derive(Debug, Clone)]
pub struct PortableLayout {
    /// `<dossier de l'exe>/data`
    // `root`, `backups_dir` et `exports_dir` sont résolus et vérifiés dès maintenant
    // pour que le diagnostic de démarrage soit complet en un seul passage. Ils seront
    // consommés par la sauvegarde (lot 6) et par l'export PDF (lot 4).
    pub root: PathBuf,
    pub db_path: PathBuf,
    /// Enveloppes de la clé maître. Sans ce fichier, `sgpa.db` est un bloc
    /// d'octets définitivement illisible : il est aussi précieux que la base.
    pub keys_path: PathBuf,
    pub backups_dir: PathBuf,
    pub exports_dir: PathBuf,
    /// Profil WebView2 (localStorage, cookies, cache).
    ///
    /// Sans cette surcharge, WebView2 écrit dans le `%LOCALAPPDATA%` du poste
    /// hôte : l'application laisserait des traces sur chaque PC du collège où la
    /// clé est branchée, et ne serait donc pas réellement portable.
    pub webview_dir: PathBuf,
}

/// Variable d'échappement, utile en développement et pour les tests.
const DATA_DIR_ENV: &str = "SGPA_DATA_DIR";

/// Fichier de verrou de seconde instance, ouvert sans partage pour toute la vie
/// du processus.
const LOCK_FILE_NAME: &str = ".sgpa.lock";

#[derive(Debug)]
pub enum LayoutError {
    NoExePath(std::io::Error),
    NoExeParent(PathBuf),
    CreateDir {
        path: PathBuf,
        source: std::io::Error,
    },
    NotWritable {
        path: PathBuf,
        source: std::io::Error,
    },
    /// Le fichier de verrou est déjà détenu : une autre instance tourne.
    AlreadyRunning {
        path: PathBuf,
        source: std::io::Error,
    },
}

impl fmt::Display for LayoutError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LayoutError::NoExePath(e) => write!(
                f,
                "Impossible de déterminer l'emplacement de l'application.\n\n\
                 Détail : {e}"
            ),
            LayoutError::NoExeParent(p) => write!(
                f,
                "L'application semble se trouver à la racine d'un lecteur, ce qui \
                 n'est pas pris en charge.\n\n\
                 Placez SGPA.exe dans un dossier, puis relancez-le.\n\n\
                 Chemin : {}",
                p.display()
            ),
            LayoutError::CreateDir { path, source } => write!(
                f,
                "Impossible de créer le dossier de données de SGPA.\n\n\
                 Dossier : {}\n\
                 Détail : {source}\n\n\
                 Causes les plus fréquentes : l'application a été lancée depuis une \
                 archive ZIP sans être décompressée, depuis un support en lecture \
                 seule, ou depuis un dossier protégé (Program Files).\n\n\
                 Décompressez SGPA dans un dossier où vous pouvez écrire — par \
                 exemple sur votre clé USB — puis relancez-le.\n\n\
                 Vous pouvez aussi imposer un autre emplacement avec la variable \
                 d'environnement {DATA_DIR_ENV}.",
                path.display()
            ),
            LayoutError::NotWritable { path, source } => write!(
                f,
                "Le dossier de données de SGPA existe mais n'est pas accessible en \
                 écriture.\n\n\
                 Dossier : {}\n\
                 Détail : {source}\n\n\
                 Si SGPA est sur une clé USB, vérifiez qu'elle n'est pas protégée en \
                 écriture. Si l'application a été installée dans Program Files, \
                 déplacez-la dans un dossier personnel.\n\n\
                 Vous pouvez aussi imposer un autre emplacement avec la variable \
                 d'environnement {DATA_DIR_ENV}.",
                path.display()
            ),
            LayoutError::AlreadyRunning { path, source } => write!(
                f,
                "Le verrou de seconde instance n'a pas pu être pris.

                 Fichier : {}
                 Détail : {source}",
                path.display()
            ),
        }
    }
}

impl std::error::Error for LayoutError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            LayoutError::NoExePath(e) => Some(e),
            LayoutError::CreateDir { source, .. } => Some(source),
            LayoutError::NotWritable { source, .. } => Some(source),
            LayoutError::AlreadyRunning { source, .. } => Some(source),
            LayoutError::NoExeParent(_) => None,
        }
    }
}

/// Résout les emplacements de travail et garantit que la racine est **réellement**
/// inscriptible.
///
/// Un `create_dir_all` qui réussit ne prouve rien : le dossier peut préexister sur
/// un support en lecture seule. On écrit donc un fichier sonde, qu'on supprime.
pub fn resolve() -> Result<PortableLayout, LayoutError> {
    let root = match std::env::var_os(DATA_DIR_ENV) {
        Some(dir) => PathBuf::from(dir),
        None => exe_dir()?.join("data"),
    };

    ensure_dir(&root)?;
    probe_writable(&root)?;

    let backups_dir = root.join("backups");
    let webview_dir = root.join("webview");
    let exports_dir = exe_dir_or(&root).join("exports");
    ensure_dir(&backups_dir)?;
    ensure_dir(&webview_dir)?;
    ensure_dir(&exports_dir)?;

    Ok(PortableLayout {
        db_path: root.join("sgpa.db"),
        keys_path: crate::keys::path(&root),
        root,
        backups_dir,
        exports_dir,
        webview_dir,
    })
}

/// Prend le verrou de seconde instance et rend le handle à conserver.
///
/// Deux fenêtres sur la même clé travailleraient sur des états divergents. Le
/// `PRAGMA locking_mode = EXCLUSIVE` qui jouait ce rôle ne convient plus : la
/// base ne s'ouvre qu'après le mot de passe, et l'enseignant se verrait répondre
/// « SGPA est déjà ouvert » seulement après l'avoir tapé.
///
/// Le handle doit vivre aussi longtemps que le processus : Windows relâche le
/// fichier à sa mort, y compris après un plantage, donc aucun verrou fantôme ne
/// peut survivre à un arrêt brutal — ce que ne donne aucun fichier « PID »
/// écrit à la main.
pub fn acquire_lock(root: &Path) -> Result<File, LayoutError> {
    let path = root.join(LOCK_FILE_NAME);
    open_lock(&path).map_err(|source| LayoutError::AlreadyRunning { path, source })
}

#[cfg(windows)]
fn open_lock(path: &Path) -> std::io::Result<File> {
    // `share_mode(0)` est l'équivalent Windows d'un verrou exclusif, et vient de
    // la bibliothèque standard : aucune dépendance de plus.
    use std::os::windows::fs::OpenOptionsExt;

    fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .share_mode(0)
        .open(path)
}

#[cfg(not(windows))]
fn open_lock(path: &Path) -> std::io::Result<File> {
    // Les autres plateformes n'ont pas d'équivalent immédiat de `share_mode(0)`
    // dans la bibliothèque standard. SGPA n'y est pas distribuée ; la fonction
    // existe pour que le module compile et les tests tournent.
    fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
}

fn exe_dir() -> Result<PathBuf, LayoutError> {
    let exe = std::env::current_exe().map_err(LayoutError::NoExePath)?;
    exe.parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| LayoutError::NoExeParent(exe.clone()))
}

/// Les exports sont posés à côté de l'exécutable, pas dans `data/` : ce sont des
/// documents que l'enseignant va chercher, pas des fichiers internes. Si le chemin
/// de l'exe est indisponible, on retombe sur la racine de données.
fn exe_dir_or(fallback: &Path) -> PathBuf {
    exe_dir().unwrap_or_else(|_| fallback.to_path_buf())
}

fn ensure_dir(path: &Path) -> Result<(), LayoutError> {
    fs::create_dir_all(path).map_err(|source| LayoutError::CreateDir {
        path: path.to_path_buf(),
        source,
    })
}

fn probe_writable(root: &Path) -> Result<(), LayoutError> {
    let probe = root.join(".sgpa-write-test");
    let outcome = fs::File::create(&probe).and_then(|mut f| {
        f.write_all(b"sgpa")?;
        f.sync_all()
    });
    // On nettoie dans tous les cas, sans masquer l'erreur d'écriture.
    let _ = fs::remove_file(&probe);
    outcome.map_err(|source| LayoutError::NotWritable {
        path: root.to_path_buf(),
        source,
    })
}

/// Bases du profil WebView2 qui retiennent en clair ce que l'enseignant a tapé.
///
/// `Web Data` porte la table `autofill` (les « suggestions de saisie » d'Edge,
/// qui enregistre la valeur de chaque champ nommé, `autocomplete="off"` ou non)
/// et `History` la liste des URL internes visitées, identifiants de classe
/// compris. Les fichiers `-journal`, `-wal` et `-shm` sont les annexes SQLite :
/// les laisser derrière rendrait la suppression illusoire.
const TRACES_WEBVIEW: [&str; 2] = ["Web Data", "History"];

const SUFFIXES_SQLITE: [&str; 4] = ["", "-journal", "-wal", "-shm"];

/// Efface les traces de saisie laissées par WebView2 dans son profil.
///
/// Ce que cela fait : au lancement, le profil ne contient plus ce que la session
/// précédente a enregistré. Une clé perdue ne livre donc pas les noms de champs
/// et les URL de la dernière utilisation.
///
/// Ce que cela ne fait **pas** : Edge réécrit ces bases pendant la session. Tant
/// que SGPA tourne, les saisies du moment y sont de nouveau, en clair. Seule la
/// coupure de l'autofill (`lib.rs`) traite la session en cours ; cette purge ne
/// traite que l'héritage.
///
/// Aucune erreur n'est remontée : un fichier absent est le cas normal au premier
/// lancement, et un fichier verrouillé par un WebView2 résiduel ne doit surtout
/// pas empêcher l'application de démarrer.
pub fn purge_traces_webview(webview_dir: &Path) {
    let profil = webview_dir.join("EBWebView").join("Default");
    for base in TRACES_WEBVIEW {
        for suffixe in SUFFIXES_SQLITE {
            let _ = fs::remove_file(profil.join(format!("{base}{suffixe}")));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_accepte_un_dossier_inscriptible() {
        let dir = std::env::temp_dir().join("sgpa-probe-ok");
        fs::create_dir_all(&dir).unwrap();
        assert!(probe_writable(&dir).is_ok());
        // La sonde ne doit rien laisser derrière elle.
        assert!(!dir.join(".sgpa-write-test").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn probe_refuse_un_chemin_inexistant() {
        let dir = std::env::temp_dir()
            .join("sgpa-probe-absent")
            .join("nulle-part");
        assert!(probe_writable(&dir).is_err());
    }

    #[test]
    fn la_purge_supprime_les_bases_de_saisie_et_leurs_annexes() {
        let webview = std::env::temp_dir().join("sgpa-purge-webview");
        let profil = webview.join("EBWebView").join("Default");
        fs::create_dir_all(&profil).unwrap();
        for nom in ["Web Data", "Web Data-journal", "History", "History-wal"] {
            fs::write(profil.join(nom), b"trace").unwrap();
        }
        // Témoin : la purge ne doit pas emporter le reste du profil.
        fs::write(profil.join("Preferences"), b"reglages").unwrap();

        purge_traces_webview(&webview);

        for nom in ["Web Data", "Web Data-journal", "History", "History-wal"] {
            assert!(!profil.join(nom).exists(), "{nom} aurait dû être supprimé");
        }
        assert!(profil.join("Preferences").exists());
        let _ = fs::remove_dir_all(&webview);
    }

    #[test]
    #[cfg(windows)]
    fn le_verrou_refuse_une_seconde_instance() {
        let dir = std::env::temp_dir().join("sgpa-verrou");
        fs::create_dir_all(&dir).unwrap();
        let _ = fs::remove_file(dir.join(LOCK_FILE_NAME));

        let premier = acquire_lock(&dir).expect("la première instance obtient le verrou");
        match acquire_lock(&dir) {
            Err(LayoutError::AlreadyRunning { .. }) => {}
            Ok(_) => panic!("une seconde instance ne doit pas obtenir le verrou"),
            Err(other) => panic!("attendu AlreadyRunning, obtenu {other:?}"),
        }

        // Le handle relâché, le verrou l'est aussi : c'est ce qui fait qu'un
        // plantage ne laisse pas l'application inutilisable.
        drop(premier);
        assert!(acquire_lock(&dir).is_ok());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn la_purge_ignore_un_profil_absent() {
        // Premier lancement : le dossier n'existe pas encore, et cela ne doit
        // jamais interrompre le démarrage.
        purge_traces_webview(&std::env::temp_dir().join("sgpa-purge-inexistant"));
    }
}
