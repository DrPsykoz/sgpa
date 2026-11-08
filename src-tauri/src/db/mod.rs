pub mod holidays;
pub mod migrations;

use std::fmt;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::keys::MasterKey;
use crate::portable::PortableLayout;

/// Prépare, exécute et rassemble : le squelette de toute lecture de liste.
///
/// Elle vit dans `db` et non dans un module de commandes parce que trois
/// modules s'en servent déjà. Recopiée, elle aurait surtout recopié son piège :
/// écrit à la main, `stmt.query_map(…).collect()` en dernière expression d'un
/// bloc fait vivre le `MappedRows` temporaire plus longtemps que le `Statement`
/// dont il emprunte le curseur, et le compilateur refuse — on contourne alors
/// par une liaison intermédiaire que clippy signale à son tour. Un seul endroit
/// a le droit d'avoir résolu ce détail.
pub(crate) fn collect<T, P, F>(
    conn: &Connection,
    sql: &str,
    args: P,
    map: F,
) -> Result<Vec<T>, String>
where
    P: rusqlite::Params,
    F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
{
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(args, map)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[derive(Debug)]
pub enum DbError {
    Sqlite {
        context: &'static str,
        source: rusqlite::Error,
    },
    /// `PRAGMA journal_mode` a renvoyé autre chose que le mode demandé.
    JournalMode(String),
    /// Une autre instance de SGPA détient déjà la base.
    ///
    /// Produite par le verrou de fichier `data/.sgpa.lock`, pris au démarrage —
    /// donc **avant** la fenêtre, et avant que l'enseignant n'ait tapé quoi que
    /// ce soit.
    AlreadyOpen,
    /// La clé maître n'ouvre pas ce fichier.
    ///
    /// `PRAGMA key` ne vérifie rien : c'est la première lecture qui tranche.
    WrongKey,
    /// La base a été écrite par une version plus récente de l'application.
    TooNew { found: i32, supported: i32 },
    /// Un palier de migration a laissé une référence orpheline.
    ForeignKeyCheck { step: i32 },
    /// Impossible de mettre de côté une base antérieure au versionnement.
    LegacyAside {
        from: PathBuf,
        to: PathBuf,
        source: std::io::Error,
    },
}

impl fmt::Display for DbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DbError::Sqlite { context, source } => write!(
                f,
                "La base de données de SGPA n'a pas pu être ouverte.\n\n\
                 Étape : {context}\n\
                 Détail : {source}\n\n\
                 Si le fichier data/sgpa.db semble endommagé, restaurez la copie la \
                 plus récente du dossier data/backups : fermez SGPA, renommez le \
                 fichier de sauvegarde en sgpa.db, puis relancez l'application."
            ),
            DbError::JournalMode(got) => write!(
                f,
                "SGPA n'a pas pu configurer sa base de données.\n\n\
                 Le mode de journalisation demandé était « truncate », la base a \
                 répondu « {got} ».\n\n\
                 C'est le signe qu'une autre application ou une autre copie de SGPA \
                 utilise déjà le fichier data/sgpa.db. Fermez-la et relancez."
            ),
            DbError::AlreadyOpen => write!(
                f,
                "SGPA est déjà ouvert.\n\n\
                 Une autre fenêtre de l'application utilise la même base de données. \
                 Utilisez la fenêtre déjà ouverte, ou fermez-la avant de relancer.\n\n\
                 Si aucune fenêtre n'est visible, l'application est peut-être restée \
                 en cours d'exécution : terminez le processus SGPA.exe puis relancez."
            ),
            DbError::WrongKey => write!(
                f,
                "La base de données ne correspond pas au fichier de clés.\n\n\
                 data/sgpa.db et data/{keys} doivent venir de la même clé USB. \
                 Si vous avez restauré une sauvegarde, restaurez aussi le \
                 data/{keys} qui l'accompagnait : une base chiffrée ne s'ouvre \
                 qu'avec les enveloppes de sa propre clé maître.",
                keys = crate::keys::FILE_NAME
            ),
            DbError::TooNew { found, supported } => write!(
                f,
                "Cette base de données a été créée par une version plus récente de \
                 SGPA.\n\n\
                 Version du fichier : {found}\n\
                 Version de cette application : {supported}\n\n\
                 Mettez SGPA à jour, ou utilisez la copie de l'application qui a créé \
                 cette base. Ne l'ouvrez pas avec cette version : elle y perdrait des \
                 données."
            ),
            DbError::ForeignKeyCheck { step } => write!(
                f,
                "La mise à jour de la base de données a échoué et a été annulée.\n\n\
                 Palier : {step}\n\n\
                 Aucune donnée n'a été modifiée. Une sauvegarde a été déposée dans \
                 data/backups avant la tentative."
            ),
            DbError::LegacyAside { from, to, source } => write!(
                f,
                "SGPA a trouvé une base de données antérieure au format actuel et n'a \
                 pas pu la mettre de côté.\n\n\
                 Fichier : {}\n\
                 Destination : {}\n\
                 Détail : {source}\n\n\
                 Renommez ou déplacez ce fichier à la main, puis relancez \
                 l'application : une base vierge sera créée.",
                from.display(),
                to.display()
            ),
        }
    }
}

impl std::error::Error for DbError {}

pub fn at(context: &'static str) -> impl FnOnce(rusqlite::Error) -> DbError {
    move |source| DbError::Sqlite { context, source }
}

/// Ouvre la base chiffrée et applique les migrations.
///
/// Appelée depuis `unlock` et `setup_lock`, jamais au démarrage : la clé maître
/// n'existe qu'une fois le mot de passe déballé. La `Connection` obtenue vit
/// ensuite dans `AppState` et est partagée par toutes les commandes.
pub fn prepare_encrypted(layout: &PortableLayout, key: &MasterKey) -> Result<Connection, DbError> {
    let mut conn = open_encrypted(&layout.db_path, key)?;
    migrations::run(&mut conn, &layout.backups_dir)?;
    // Le calendrier scolaire embarqué, après les migrations et **sans `?`**.
    //
    // L'absence de `?` est le point le plus important de cette fonction. Les
    // vacances sont une couche d'affichage : elles n'ont pas le droit
    // d'empêcher l'ouverture d'un bilan. Et l'erreur ne remonterait pas
    // seulement à `unlock` — elle remonterait à `setup_lock`, où l'échec
    // déclenche `annuler_setup`, qui SUPPRIME `data/sgpa.keys`. Une ligne de
    // calendrier mal formée rendrait l'application définitivement impossible à
    // configurer. `holidays::seed` ne rend donc rien, par construction.
    holidays::seed(&mut conn);
    Ok(conn)
}

/// Ouvre un fichier SQLCipher avec la clé maître.
///
/// L'ordre n'est pas négociable : `PRAGMA key` doit précéder **toute** autre
/// instruction, y compris les autres pragmas, sinon SQLCipher tente de lire des
/// pages chiffrées sans clé.
pub fn open_encrypted(db_path: &Path, key: &MasterKey) -> Result<Connection, DbError> {
    let conn = Connection::open(db_path).map_err(at("ouverture du fichier"))?;

    conn.pragma_update(None, "key", &*key.pragma_literal())
        .map_err(at("pose de la clé de chiffrement"))?;

    // LA vérification de la clé, et la seule : `PRAGMA key` n'authentifie rien,
    // il se contente d'enregistrer la clé. C'est la première lecture réelle qui
    // échoue si elle est fausse — SQLite rend alors SQLITE_NOTADB, le HMAC de la
    // page 1 ne tombant pas juste.
    //
    // Sur un fichier neuf (zéro octet), la requête réussit et rend 0 : rien
    // n'est encore chiffré, et les migrations écriront les premières pages avec
    // cette clé.
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |row| {
        row.get::<_, i64>(0)
    })
    .map_err(|source| match source {
        rusqlite::Error::SqliteFailure(e, _) if e.code == rusqlite::ErrorCode::NotADatabase => {
            DbError::WrongKey
        }
        source => DbError::Sqlite {
            context: "lecture de contrôle après déchiffrement",
            source,
        },
    })?;

    // PIÈGE : `pragma_update` passe par `execute_batch`, qui ignore la ligne
    // retournée. Or `PRAGMA journal_mode` renvoie le mode RÉELLEMENT appliqué —
    // il faut le lire, sinon la base peut rester silencieusement en WAL.
    //
    // WAL est abandonné pour une raison unique et suffisante : il crée
    // sgpa.db-wal et sgpa.db-shm, donc « je copie sgpa.db sur mon disque »
    // produit une sauvegarde périmée sans que rien ne le signale. En TRUNCATE,
    // entre deux transactions, sgpa.db seul EST la base complète — ce qui est la
    // condition d'une sauvegarde par simple copie depuis une clé USB.
    let mode: String = conn
        .query_row("PRAGMA journal_mode = TRUNCATE", [], |row| row.get(0))
        .map_err(at("configuration du mode de journalisation"))?;
    if !mode.eq_ignore_ascii_case("truncate") {
        return Err(DbError::JournalMode(mode));
    }

    // `locking_mode = EXCLUSIVE` a disparu : la détection de seconde instance
    // est passée au fichier `data/.sgpa.lock`, pris au démarrage. Le verrou
    // SQLite ne pouvait plus jouer ce rôle, la base ne s'ouvrant désormais
    // qu'après la saisie du mot de passe.
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA temp_store   = MEMORY;
         PRAGMA cache_size   = -8000;",
    )
    .map_err(at("configuration de la base"))?;

    Ok(conn)
}

/// Met de côté une base antérieure au chiffrement.
///
/// Le critère tient en une ligne : `sgpa.db` présent **sans** `sgpa.keys`. Une
/// base écrite avant le chiffrement n'a pas d'enveloppes, elle est donc
/// définitivement inouvrable par cette version — et elle n'a pas non plus à être
/// inspectée, ce qui évite de l'ouvrir pour rien.
///
/// Aucune installation ne contient de données réelles : convertir coûterait plus
/// cher que de repartir à neuf, et l'ancien fichier est conservé intact à côté.
///
/// Appelée au démarrage, avant la fenêtre : elle ne demande aucune clé.
pub fn move_legacy_aside(layout: &PortableLayout) -> Result<(), DbError> {
    if !layout.db_path.exists() || layout.keys_path.exists() {
        return Ok(());
    }

    let aside = layout.root.join("sgpa-legacy-v1.db");
    let aside = if aside.exists() {
        // On ne réécrase jamais une mise de côté précédente.
        let mut n = 2;
        loop {
            let candidate = layout.root.join(format!("sgpa-legacy-v1-{n}.db"));
            if !candidate.exists() {
                break candidate;
            }
            n += 1;
        }
    } else {
        aside
    };

    std::fs::rename(&layout.db_path, &aside).map_err(|source| DbError::LegacyAside {
        from: layout.db_path.clone(),
        to: aside.clone(),
        source,
    })?;

    // Les fichiers annexes du mode WAL n'ont plus de base à accompagner.
    for suffix in ["-wal", "-shm"] {
        let mut annex = layout.db_path.clone().into_os_string();
        annex.push(suffix);
        let _ = std::fs::remove_file(PathBuf::from(annex));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Trimestres
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct TrimesterBounds {
    pub year_start: i32,
    pub t1_start: String,
    pub t2_start: String,
    pub t3_start: String,
    pub year_end: String,
}

/// Bornes par défaut d'une année scolaire démarrant en septembre `year_start`.
///
/// Ce sont des valeurs de départ raisonnables pour un collège français, pas une
/// vérité : l'enseignant les corrige dans les réglages de l'année.
pub fn default_bounds(year_start: i32) -> TrimesterBounds {
    TrimesterBounds {
        year_start,
        t1_start: format!("{year_start}-09-01"),
        t2_start: format!("{year_start}-12-01"),
        t3_start: format!("{}-03-01", year_start + 1),
        year_end: format!("{}-07-07", year_start + 1),
    }
}

/// Fonction TOTALE : une prérentrée d'août tombe en T1, un rattrapage de juillet
/// en T3. Aucun NULL possible, donc aucune séance invisible dans tous les bilans.
///
/// La comparaison lexicographique est légitime : le format 'AAAA-MM-JJ' est
/// garanti par les CHECK du schéma.
pub fn trimester_for(date: &str, bounds: &TrimesterBounds) -> i32 {
    if date < bounds.t2_start.as_str() {
        1
    } else if date < bounds.t3_start.as_str() {
        2
    } else {
        3
    }
}

/// Bornes réellement enregistrées pour une année, ou `None`.
fn stored_bounds(conn: &Connection, year_start: i32) -> rusqlite::Result<Option<TrimesterBounds>> {
    use rusqlite::OptionalExtension;
    conn.query_row(
        "SELECT t1_start, t2_start, t3_start, year_end FROM trimester_bounds WHERE year_start = ?1",
        [year_start],
        |row| {
            Ok(TrimesterBounds {
                year_start,
                t1_start: row.get(0)?,
                t2_start: row.get(1)?,
                t3_start: row.get(2)?,
                year_end: row.get(3)?,
            })
        },
    )
    .optional()
}

/// Lit les bornes d'une année **sans rien écrire**, en retombant sur les valeurs
/// par défaut quand l'année n'a jamais été réglée.
///
/// C'est la variante que doit appeler toute commande de LECTURE. `ensure_bounds`
/// insère la ligne manquante : appelée depuis un affichage, elle ferait écrire la
/// base à chaque consultation d'une journée d'une année encore vierge — une
/// écriture que rien à l'écran n'annonce, et qui ne peut pas vivre dans une
/// transaction de lecture.
pub fn bounds_or_default(conn: &Connection, year_start: i32) -> rusqlite::Result<TrimesterBounds> {
    Ok(stored_bounds(conn, year_start)?.unwrap_or_else(|| default_bounds(year_start)))
}

/// Lit les bornes d'une année, en créant la ligne par défaut si elle n'existe pas.
pub fn ensure_bounds(conn: &Connection, year_start: i32) -> rusqlite::Result<TrimesterBounds> {
    if let Some(bounds) = stored_bounds(conn, year_start)? {
        return Ok(bounds);
    }

    let bounds = default_bounds(year_start);
    conn.execute(
        "INSERT INTO trimester_bounds (year_start, t1_start, t2_start, t3_start, year_end)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            bounds.year_start,
            bounds.t1_start,
            bounds.t2_start,
            bounds.t3_start,
            bounds.year_end
        ],
    )?;
    Ok(bounds)
}

/// Résout le trimestre d'une date pour une session donnée.
///
/// `forced` court-circuite le calcul : c'est la correction manuelle de
/// l'enseignant. Renvoie `(trimestre, manuel)`.
pub fn resolve_trimester(
    conn: &Connection,
    session_id: &str,
    date: &str,
    forced: Option<i32>,
) -> rusqlite::Result<(i32, bool)> {
    if let Some(value) = forced {
        if (1..=3).contains(&value) {
            return Ok((value, true));
        }
    }
    let year_start: i32 = conn.query_row(
        "SELECT year_start FROM sessions WHERE id = ?1",
        [session_id],
        |row| row.get(0),
    )?;
    let bounds = ensure_bounds(conn, year_start)?;
    Ok((trimester_for(date, &bounds), false))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bounds() -> TrimesterBounds {
        default_bounds(2021)
    }

    fn temp_db(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sgpa-chiffre-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("sgpa.db")
    }

    #[test]
    fn la_base_se_rouvre_avec_la_meme_cle() {
        let path = temp_db("aller-retour");
        let key = MasterKey::from_bytes_for_tests([0x11; 32]);

        let conn = open_encrypted(&path, &key).unwrap();
        conn.execute_batch("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('Nadia');")
            .unwrap();
        conn.close().unwrap();

        let conn = open_encrypted(&path, &key).unwrap();
        let lu: String = conn.query_row("SELECT v FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(lu, "Nadia");
        conn.close().unwrap();
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn une_mauvaise_cle_est_refusee_par_la_lecture_de_controle() {
        let path = temp_db("mauvaise-cle");
        let bonne = MasterKey::from_bytes_for_tests([0x22; 32]);
        let mauvaise = MasterKey::from_bytes_for_tests([0x23; 32]);

        let conn = open_encrypted(&path, &bonne).unwrap();
        conn.execute_batch("CREATE TABLE t (v TEXT);").unwrap();
        conn.close().unwrap();

        // `PRAGMA key` accepte n'importe quoi sans broncher : sans la lecture de
        // contrôle, l'erreur ne surgirait qu'au premier clic de l'enseignant.
        match open_encrypted(&path, &mauvaise) {
            Err(DbError::WrongKey) => {}
            other => panic!("attendu WrongKey, obtenu {other:?}"),
        }
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn le_fichier_sur_le_disque_ne_laisse_rien_lire() {
        let path = temp_db("illisible");
        let key = MasterKey::from_bytes_for_tests([0x33; 32]);

        let conn = open_encrypted(&path, &key).unwrap();
        conn.execute_batch(
            "CREATE TABLE eleves (nom TEXT);
             INSERT INTO eleves VALUES ('Boumediene');",
        )
        .unwrap();
        conn.close().unwrap();

        let octets = std::fs::read(&path).unwrap();
        assert!(
            !octets.starts_with(b"SQLite format 3"),
            "l'en-tête doit être chiffré lui aussi"
        );
        assert!(
            !octets.windows(11).any(|f| f == b"Boumediene\0"),
            "aucun nom d'élève ne doit apparaître en clair"
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn la_sauvegarde_par_vacuum_into_reste_chiffree() {
        let path = temp_db("vacuum");
        let key = MasterKey::from_bytes_for_tests([0x44; 32]);
        let copie = path.parent().unwrap().join("copie.db");

        let conn = open_encrypted(&path, &key).unwrap();
        conn.execute_batch("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('Karim');")
            .unwrap();
        // Le mécanisme de sauvegarde de `maintenance` et de `migrations` repose
        // là-dessus : la copie doit hériter de la clé, sans quoi chaque
        // sauvegarde déposerait les données en clair dans data/backups.
        conn.execute("VACUUM INTO ?1", [copie.to_string_lossy().as_ref()])
            .unwrap();
        conn.close().unwrap();

        assert!(!std::fs::read(&copie)
            .unwrap()
            .starts_with(b"SQLite format 3"));
        let relue = open_encrypted(&copie, &key).unwrap();
        let lu: String = relue
            .query_row("SELECT v FROM t", [], |r| r.get(0))
            .unwrap();
        assert_eq!(lu, "Karim");
        relue.close().unwrap();
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn une_base_sans_fichier_de_cles_est_mise_de_cote() {
        let dir = std::env::temp_dir().join("sgpa-legacy");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let layout = PortableLayout {
            root: dir.clone(),
            db_path: dir.join("sgpa.db"),
            keys_path: dir.join("sgpa.keys"),
            backups_dir: dir.join("backups"),
            exports_dir: dir.join("exports"),
            logs_dir: dir.join("logs"),
            webview_dir: dir.join("webview"),
        };

        // Base d'avant le chiffrement : en clair, et sans enveloppes à côté.
        let conn = Connection::open(&layout.db_path).unwrap();
        conn.execute_batch("CREATE TABLE ancien (v TEXT);").unwrap();
        conn.close().unwrap();

        move_legacy_aside(&layout).unwrap();
        assert!(!layout.db_path.exists(), "la base v1 doit être écartée");
        assert!(
            dir.join("sgpa-legacy-v1.db").exists(),
            "et conservée intacte"
        );

        // Avec le fichier d'enveloppes présent, on ne touche plus à rien.
        std::fs::write(&layout.keys_path, b"{}").unwrap();
        std::fs::write(&layout.db_path, b"chiffre").unwrap();
        move_legacy_aside(&layout).unwrap();
        assert!(layout.db_path.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn trimestre_aux_dates_charnieres() {
        let b = bounds();
        assert_eq!(trimester_for("2021-09-01", &b), 1, "premier jour de T1");
        assert_eq!(trimester_for("2021-11-30", &b), 1, "veille de T2");
        assert_eq!(trimester_for("2021-12-01", &b), 2, "premier jour de T2");
        assert_eq!(trimester_for("2022-02-28", &b), 2, "veille de T3");
        assert_eq!(trimester_for("2022-03-01", &b), 3, "premier jour de T3");
        assert_eq!(
            trimester_for("2022-07-07", &b),
            3,
            "dernier jour de l'année"
        );
    }

    #[test]
    fn trimestre_hors_bornes_reste_total() {
        let b = bounds();
        // Prérentrée d'août : avant t1_start, donc T1.
        assert_eq!(trimester_for("2021-08-25", &b), 1);
        // Rattrapage de juillet : après year_end, donc T3. Jamais NULL, jamais
        // invisible dans les bilans.
        assert_eq!(trimester_for("2022-07-20", &b), 3);
    }

    #[test]
    fn annee_bissextile() {
        let b = default_bounds(2023); // 2023-2024, février 2024 a 29 jours
        assert_eq!(trimester_for("2024-02-29", &b), 2);
        assert_eq!(trimester_for("2024-03-01", &b), 3);
    }

    #[test]
    fn bornes_par_defaut_coherentes() {
        let b = default_bounds(2021);
        assert!(b.t1_start < b.t2_start);
        assert!(b.t2_start < b.t3_start);
        assert!(b.t3_start <= b.year_end);
    }
}
