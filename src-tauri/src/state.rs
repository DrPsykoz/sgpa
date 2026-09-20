use std::fs::File;
use std::ops::{Deref, DerefMut};
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;

use crate::portable::PortableLayout;

/// État partagé de l'application, injecté par Tauri dans chaque commande.
///
/// Une seule `Connection` pour tout le processus. Avant la refonte, chaque
/// commande appelait `db::init_db()`, ce qui rouvrait le fichier et rejouait
/// l'intégralité des migrations à chaque clic.
pub struct AppState {
    /// `None` tant que la session est verrouillée.
    ///
    /// L'état de verrouillage **est** la présence ou non de la connexion, et
    /// non plus un booléen posé à côté d'elle : il devient impossible d'être
    /// « déverrouillé » sans base, ou l'inverse. C'est aussi la seule façon de
    /// tenir la promesse du chiffrement — une `Connection` vivante garde la clé
    /// en clair dans le contexte SQLCipher, donc verrouiller doit la fermer.
    db: Mutex<Option<Connection>>,
    pub layout: PortableLayout,
    /// Verrou de seconde instance, pris au démarrage.
    ///
    /// Jamais lu : c'est sa seule existence qui compte. Il doit vivre aussi
    /// longtemps que `AppState`, donc que le processus.
    _lock: File,
}

/// Emprunt de la `Connection` déverrouillée.
///
/// Le `Deref` permet aux commandes d'écrire `conn.execute(...)` et de passer
/// `&conn` là où un `&Connection` est attendu, exactement comme avec l'ancien
/// `MutexGuard<Connection>`.
pub struct ConnGuard<'a>(MutexGuard<'a, Option<Connection>>);

impl Deref for ConnGuard<'_> {
    type Target = Connection;

    fn deref(&self) -> &Connection {
        // `AppState::conn()` est seul à construire ce garde, et seulement après
        // avoir vu l'option pleine ; le verrou du mutex empêche quiconque de la
        // vider entre-temps.
        self.0.as_ref().expect("ConnGuard sans connexion")
    }
}

impl DerefMut for ConnGuard<'_> {
    fn deref_mut(&mut self) -> &mut Connection {
        self.0.as_mut().expect("ConnGuard sans connexion")
    }
}

impl AppState {
    /// Construit l'état **sans** connexion : la base n'est ouverte qu'après le
    /// mot de passe, donc bien après le démarrage.
    pub fn new(layout: PortableLayout, lock: File) -> Self {
        Self {
            db: Mutex::new(None),
            layout,
            _lock: lock,
        }
    }

    /// Unique point d'accès à la base pour les commandes métier.
    ///
    /// Le garde-fou de verrouillage vit ici et nulle part ailleurs : une
    /// commande qui n'obtient pas de `Connection` ne peut rien lire. Ajouter une
    /// commande demain ne peut donc pas ouvrir de trou dans le verrou.
    pub fn conn(&self) -> Result<ConnGuard<'_>, String> {
        let guard = self.lock_db();
        if guard.is_none() {
            return Err("Session verrouillée".to_string());
        }
        Ok(ConnGuard(guard))
    }

    /// Installe la connexion ouverte par `unlock` ou `setup_lock`.
    ///
    /// Une connexion déjà en place est fermée : deux connexions vivantes
    /// signifieraient deux clés en mémoire.
    pub fn set_connection(&self, conn: Connection) {
        let previous = self.lock_db().replace(conn);
        close_quietly(previous);
    }

    /// Verrouille la session en **fermant** réellement la base.
    ///
    /// Se contenter d'oublier un drapeau laisserait la clé de chiffrement
    /// vivante dans le contexte SQLCipher pour le reste de la session.
    pub fn close(&self) {
        // La connexion sort de l'état avant d'être fermée : même si la
        // fermeture échoue, la session est verrouillée.
        let taken = self.lock_db().take();
        close_quietly(taken);
    }

    pub fn is_unlocked(&self) -> bool {
        self.lock_db().is_some()
    }

    fn lock_db(&self) -> MutexGuard<'_, Option<Connection>> {
        // Un panic isolé dans une commande empoisonne le mutex ; refuser toutes
        // les requêtes suivantes briquerait l'application pour le reste de la
        // session. La connexion, elle, reste valide.
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// `Connection::close` rend la connexion quand une requête est encore vivante ;
/// on la laisse alors tomber, ce qui appelle `sqlite3_close_v2` et libère le
/// contexte SQLCipher — donc la clé — dès la dernière requête terminée.
fn close_quietly(conn: Option<Connection>) {
    if let Some(conn) = conn {
        let _ = conn.close();
    }
}
