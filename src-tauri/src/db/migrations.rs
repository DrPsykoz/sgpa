use std::path::Path;

use rusqlite::{Connection, Transaction};

use super::{at, DbError};

/// Version du schéma que cette version de l'application sait lire et écrire.
pub const SCHEMA_VERSION: i32 = 8;

/// Les paliers, dans l'ordre. **Un palier livré n'est jamais modifié** : on en
/// ajoute un nouveau. C'est ce qui manquait entièrement à la v0.1.1, où faire
/// évoluer le schéma sur une base existante était un no-op silencieux.
const STEPS: &[(i32, &str, &str)] = &[
    (1, "schéma v2 initial", include_str!("sql/001_initial.sql")),
    (
        2,
        "référentiel de départ",
        include_str!("sql/002_referentiel.sql"),
    ),
    (
        3,
        "base sans condensat de mot de passe",
        include_str!("sql/003_sans_bcrypt.sql"),
    ),
    (
        4,
        "emploi du temps",
        include_str!("sql/004_emploi_du_temps.sql"),
    ),
    (
        5,
        "périodes d'absence justifiée",
        include_str!("sql/005_periodes_absence.sql"),
    ),
    (
        6,
        "suivi de stage",
        include_str!("sql/006_suivi_de_stage.sql"),
    ),
    (
        7,
        "motif d'annulation d'un cours",
        include_str!("sql/007_motif_annulation.sql"),
    ),
    (
        8,
        "calendrier scolaire",
        include_str!("sql/008_calendrier_scolaire.sql"),
    ),
];

pub fn run(conn: &mut Connection, backups_dir: &Path) -> Result<(), DbError> {
    let mut version: i32 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(at("lecture de la version du schéma"))?;

    if version > SCHEMA_VERSION {
        return Err(DbError::TooNew {
            found: version,
            supported: SCHEMA_VERSION,
        });
    }
    if version == SCHEMA_VERSION {
        return Ok(());
    }

    // Une base déjà peuplée qu'on s'apprête à faire évoluer : on en garde une
    // copie avant d'y toucher. Inutile pour une base neuve (version 0 et vide).
    if version > 0 {
        backup_before_migration(conn, backups_dir, version)?;
    }

    for (target, label, sql) in STEPS.iter().copied() {
        if target <= version {
            continue;
        }

        // Les contraintes de clé étrangère sont suspendues pendant un palier :
        // l'ordre de création des tables ne doit pas dicter l'écriture du SQL.
        // Le PRAGMA est ignoré à l'intérieur d'une transaction, il doit donc être
        // posé AVANT de l'ouvrir.
        conn.pragma_update(None, "foreign_keys", "OFF")
            .map_err(at("suspension des clés étrangères"))?;

        let outcome = apply_step(conn, target, sql);

        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(at("rétablissement des clés étrangères"))?;

        outcome?;
        version = target;
        eprintln!("[sgpa] migration appliquée : palier {target} — {label}");
    }

    Ok(())
}

fn apply_step(conn: &mut Connection, target: i32, sql: &str) -> Result<(), DbError> {
    let tx = conn
        .transaction()
        .map_err(at("ouverture de la transaction de migration"))?;

    tx.execute_batch(sql)
        .map_err(at("exécution du palier de migration"))?;

    if has_orphan_reference(&tx)? {
        // Le Drop de `tx` annule tout : la base reste exactement dans l'état où
        // elle était avant le palier.
        return Err(DbError::ForeignKeyCheck { step: target });
    }

    // `user_version` vit dans l'en-tête du fichier et est écrit dans la même
    // transaction : impossible de se retrouver avec un palier à moitié appliqué.
    tx.pragma_update(None, "user_version", target)
        .map_err(at("écriture de la version du schéma"))?;

    tx.commit().map_err(at("validation de la migration"))?;
    Ok(())
}

fn has_orphan_reference(tx: &Transaction<'_>) -> Result<bool, DbError> {
    let mut stmt = tx
        .prepare("PRAGMA foreign_key_check")
        .map_err(at("contrôle des clés étrangères"))?;
    let mut rows = stmt.query([]).map_err(at("contrôle des clés étrangères"))?;
    let orphan = rows
        .next()
        .map_err(at("contrôle des clés étrangères"))?
        .is_some();
    Ok(orphan)
}

/// Copie compacte et cohérente de la base avant une migration.
///
/// `VACUUM INTO` est une instruction SQL, sans dépendance supplémentaire, et
/// produit un fichier unique. Un `std::fs::copy` du fichier ouvert est à
/// proscrire : il peut capturer une lecture déchirée.
fn backup_before_migration(
    conn: &Connection,
    backups_dir: &Path,
    from_version: i32,
) -> Result<(), DbError> {
    let stamp: String = conn
        .query_row("SELECT strftime('%Y%m%d-%H%M%S', 'now')", [], |row| {
            row.get(0)
        })
        .map_err(at("horodatage de la sauvegarde"))?;

    let target = backups_dir.join(format!("sgpa_v{from_version}_{stamp}.db"));
    if target.exists() {
        return Ok(());
    }

    // VACUUM INTO refuse une cible existante ; le chemin est construit par nous,
    // jamais par une saisie utilisateur.
    conn.execute("VACUUM INTO ?1", [target.to_string_lossy().as_ref()])
        .map_err(at("sauvegarde avant migration"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("sgpa-mig-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn fresh(dir: &Path) -> Connection {
        let mut conn = Connection::open(dir.join("sgpa.db")).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run(&mut conn, dir).unwrap();
        conn
    }

    #[test]
    fn migration_amene_a_la_version_courante() {
        let dir = temp_dir("version");
        let conn = fresh(&dir);
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);

        let tables: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            tables, 23,
            "18 tables au palier 003, plus timetable_slots, agenda_entries, \
             absence_periods et stage_placements"
        );

        // Palier 003 : le verrou ne laisse plus rien dans la base. Un condensat
        // oublié ici serait une seconde cible à attaquer, pour une vérification
        // que plus personne ne fait.
        let colonnes: Vec<String> = conn
            .prepare("SELECT name FROM pragma_table_info('app_settings')")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert!(!colonnes.iter().any(|c| c == "password_hash"));
        assert!(!colonnes.iter().any(|c| c == "password_hint"));
        assert!(colonnes.iter().any(|c| c == "teacher_display_name"));
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn migration_est_idempotente() {
        let dir = temp_dir("idempotent");
        let mut conn = fresh(&dir);
        // Rejouer ne doit rien faire — et surtout pas ressemer le référentiel.
        run(&mut conn, &dir).unwrap();
        run(&mut conn, &dir).unwrap();
        let cycles: i64 = conn
            .query_row("SELECT COUNT(*) FROM cycles", [], |row| row.get(0))
            .unwrap();
        assert_eq!(cycles, 1, "le semis ne doit pas être rejoué");
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn base_trop_recente_est_refusee() {
        let dir = temp_dir("trop-recente");
        let mut conn = Connection::open(dir.join("sgpa.db")).unwrap();
        conn.pragma_update(None, "user_version", 99).unwrap();
        match run(&mut conn, &dir) {
            Err(DbError::TooNew { found, supported }) => {
                assert_eq!(found, 99);
                assert_eq!(supported, SCHEMA_VERSION);
            }
            other => panic!("attendu TooNew, obtenu {other:?}"),
        }
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn aucune_reference_orpheline_apres_migration() {
        let dir = temp_dir("fk");
        let conn = fresh(&dir);
        let mut stmt = conn.prepare("PRAGMA foreign_key_check").unwrap();
        let orphan = stmt.query([]).unwrap().next().unwrap().is_some();
        assert!(
            !orphan,
            "le semis ne doit laisser aucune référence orpheline"
        );
        drop(stmt);
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn le_semis_pose_le_socle_commun() {
        let dir = temp_dir("semis");
        let conn = fresh(&dir);
        let domains: i64 = conn
            .query_row("SELECT COUNT(*) FROM domains", [], |row| row.get(0))
            .unwrap();
        assert_eq!(domains, 5, "les 5 domaines du socle commun");
        let fields: i64 = conn
            .query_row("SELECT COUNT(*) FROM fields", [], |row| row.get(0))
            .unwrap();
        assert_eq!(fields, 4, "les 4 composantes du domaine 1");
        let competencies: i64 = conn
            .query_row("SELECT COUNT(*) FROM competencies", [], |row| row.get(0))
            .unwrap();
        assert_eq!(competencies, 0, "aucune compétence n'est inventée");
        let pro: i64 = conn
            .query_row("SELECT COUNT(*) FROM professional_fields", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(
            pro, 0,
            "les champs professionnels attendent la liste de l'auteur"
        );
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Applique les paliers un par un **sans** passer par `run`, pour fabriquer
    /// une base telle qu'elle existe chez l'enseignant *avant* la mise à jour :
    /// `run` irait d'emblée jusqu'à `SCHEMA_VERSION`.
    fn migrer_jusqua(conn: &mut Connection, upto: i32) {
        for (target, _, sql) in STEPS.iter().copied() {
            if target > upto {
                break;
            }
            conn.pragma_update(None, "foreign_keys", "OFF").unwrap();
            conn.execute_batch(sql).unwrap();
            conn.pragma_update(None, "foreign_keys", "ON").unwrap();
            conn.pragma_update(None, "user_version", target).unwrap();
        }
    }

    /// Le seul test qui parte d'une base **peuplée**.
    ///
    /// Tous les autres migrent une base neuve, où aucune donnée ne peut être
    /// perdue puisqu'il n'y en a pas : aucun ne prouve qu'un palier préserve ce
    /// que l'enseignant a déjà saisi.
    #[test]
    fn une_base_v3_peuplee_traverse_les_paliers_004_et_005_intacte() {
        let dir = temp_dir("v3-peuplee");
        let mut conn = Connection::open(dir.join("sgpa.db")).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrer_jusqua(&mut conn, 3);

        conn.execute_batch(
            "INSERT INTO sessions (id, name, level_code, year_start)
                  VALUES ('s1', '4ème A', '4eme', 2026);
             INSERT INTO students (id, session_id, first_name, last_name, enrolled_on)
                  VALUES ('e1', 's1', 'Hugo', 'MARTIN', '2026-09-01'),
                         ('e2', 's1', 'Nadia', 'BOUMEDIENE', '2026-09-01');
             INSERT INTO seances (id, session_id, title, date, trimester, content_html,
                                  attendance_taken_at)
                  VALUES ('c1', 's1', 'Atelier', '2026-11-17', 1,
                          '<p>Prise de mesures</p>', '2026-11-17 08:05:00');
             INSERT INTO attendance_records (seance_id, student_id, status)
                  VALUES ('c1', 'e1', 'present'), ('c1', 'e2', 'absent');",
        )
        .unwrap();

        run(&mut conn, &dir).unwrap();

        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);

        // Une base peuplée est copiée avant qu'on y touche : c'est la seule
        // chose qui rende la migration rattrapable si elle tourne mal.
        let copie = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .any(|entry| entry.file_name().to_string_lossy().starts_with("sgpa_v3_"));
        assert!(
            copie,
            "une sauvegarde doit précéder la migration d'une base peuplée"
        );

        // Ce que l'enseignant avait saisi est toujours là, au caractère près.
        let contenu: String = conn
            .query_row(
                "SELECT content_html FROM seances WHERE id = 'c1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(contenu, "<p>Prise de mesures</p>", "le cahier de texte");
        let eleves: i64 = conn
            .query_row("SELECT COUNT(*) FROM students", [], |r| r.get(0))
            .unwrap();
        assert_eq!(eleves, 2);
        let appels: i64 = conn
            .query_row("SELECT COUNT(*) FROM attendance_records", [], |r| r.get(0))
            .unwrap();
        assert_eq!(appels, 2);
        let pointe: Option<String> = conn
            .query_row(
                "SELECT attendance_taken_at FROM seances WHERE id = 'c1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pointe.as_deref(), Some("2026-11-17 08:05:00"));

        // Les colonnes ajoutées arrivent avec leur valeur par défaut : une
        // séance antérieure au palier n'a ni créneau ni horaire.
        let (slot, debut, fin): (Option<String>, String, String) = conn
            .query_row(
                "SELECT slot_id, start_time, end_time FROM seances WHERE id = 'c1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(slot, None);
        assert_eq!(debut, "");
        assert_eq!(fin, "");

        let tables: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tables, 23);

        let mut stmt = conn.prepare("PRAGMA foreign_key_check").unwrap();
        let orphan = stmt.query([]).unwrap().next().unwrap().is_some();
        assert!(
            !orphan,
            "la migration ne doit laisser aucune référence orpheline"
        );
        drop(stmt);

        // Supprimer un créneau ne doit JAMAIS emporter un appel : c'est toute la
        // promesse du `ON DELETE SET NULL` posé sur seances.slot_id, et elle ne
        // se vérifie que sur une base qui contient déjà des appels.
        conn.execute_batch(
            "INSERT INTO timetable_slots
                 (id, year_start, session_id, label, weekday, start_time, end_time)
                  VALUES ('t1', 2026, 's1', 'Atelier', 2, '08:00', '10:00');
             UPDATE seances SET slot_id = 't1', start_time = '08:00', end_time = '10:00'
              WHERE id = 'c1';
             DELETE FROM timetable_slots WHERE id = 't1';",
        )
        .unwrap();
        let (slot, appels): (Option<String>, i64) = conn
            .query_row(
                "SELECT se.slot_id,
                        (SELECT COUNT(*) FROM attendance_records WHERE seance_id = se.id)
                   FROM seances se WHERE se.id = 'c1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(slot, None, "le créneau supprimé se détache de la séance");
        assert_eq!(appels, 2, "et l'appel reste intact");

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Le palier 007 ajoute une COLONNE, pas une table : c'est le premier du
    /// projet dans ce cas, et les deux assertions `tables == 22` doivent rester
    /// telles quelles. Ce test le fixe, pour qu'un futur lecteur ne « corrige »
    /// pas un compte qu'il croit en retard.
    ///
    /// Il vérifie surtout qu'une base v6 PEUPLÉE traverse le palier sans rien
    /// perdre, et que la colonne arrive à `''` partout — pas à NULL, qui
    /// obligerait chaque lecture à traiter deux cas d'absence au lieu d'un.
    #[test]
    fn une_base_v6_peuplee_traverse_le_palier_007_intacte() {
        let dir = temp_dir("v6-peuplee");
        let mut conn = Connection::open(dir.join("sgpa.db")).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrer_jusqua(&mut conn, 6);

        conn.execute_batch(
            "INSERT INTO sessions (id, name, level_code, year_start)
                  VALUES ('s1', '3ème A', '3eme', 2026);",
        )
        .unwrap();
        conn.execute_batch(
            "INSERT INTO students (id, session_id, first_name, last_name, enrolled_on)
                  VALUES ('e1', 's1', 'Hugo', 'MARTIN', '2026-09-01');",
        )
        .unwrap();
        // Une séance tenue, et une ANNULÉE d'avant le palier : c'est elle qui
        // doit hériter d'un motif vide sans que rien ne soit inventé.
        conn.execute_batch(
            "INSERT INTO seances (id, session_id, title, date, trimester, cancelled,
                                  content_html)
                  VALUES ('c1', 's1', 'Atelier', '2026-11-17', 1, 0,
                          '<p>Prise de mesures</p>'),
                         ('c2', 's1', 'Sortie', '2026-11-19', 1, 1, '<p>Musée</p>');",
        )
        .unwrap();
        conn.execute_batch(
            "INSERT INTO attendance_records (seance_id, student_id, status)
                  VALUES ('c1', 'e1', 'present');",
        )
        .unwrap();

        run(&mut conn, &dir).unwrap();

        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);

        // AUCUNE table ajoutée par ce palier.
        let tables: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tables, 23, "007 n'ajoute aucune table, 008 en ajoute une");

        // La colonne arrive vide partout, y compris sur la séance déjà annulée :
        // la migration n'invente aucun motif.
        let motifs: Vec<(String, i32, String)> = conn
            .prepare("SELECT id, cancelled, cancel_reason FROM seances ORDER BY id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(
            motifs,
            vec![
                ("c1".to_string(), 0, String::new()),
                ("c2".to_string(), 1, String::new()),
            ],
            "aucun motif inventé, et jamais NULL"
        );

        // Ce que l'enseignant avait saisi est toujours là, au caractère près.
        let contenu: String = conn
            .query_row(
                "SELECT content_html FROM seances WHERE id = 'c1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(contenu, "<p>Prise de mesures</p>");
        let appels: i64 = conn
            .query_row("SELECT COUNT(*) FROM attendance_records", [], |r| r.get(0))
            .unwrap();
        assert_eq!(appels, 1);

        let mut stmt = conn.prepare("PRAGMA foreign_key_check").unwrap();
        let orphan = stmt.query([]).unwrap().next().unwrap().is_some();
        assert!(!orphan);
        drop(stmt);
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Le palier 005 ne doit RIEN changer aux bilans déjà imprimés.
    ///
    /// Il n'y arrive que d'une façon : en n'inventant aucune période. Une table
    /// vide laisse le `NOT EXISTS` de l'assiduité faux partout, donc chaque
    /// dénominateur identique à la veille de la mise à jour. Ce test est le
    /// pendant, côté schéma, du test de non-régression de `reports.rs`.
    #[test]
    fn une_base_v4_peuplee_traverse_le_palier_005_intacte() {
        let dir = temp_dir("v4-peuplee");
        let mut conn = Connection::open(dir.join("sgpa.db")).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrer_jusqua(&mut conn, 4);

        conn.execute_batch(
            "INSERT INTO sessions (id, name, level_code, year_start)
                  VALUES ('s1', '4ème A', '4eme', 2026);
             INSERT INTO students (id, session_id, first_name, last_name, enrolled_on)
                  VALUES ('e1', 's1', 'Hugo', 'MARTIN', '2026-09-01');
             INSERT INTO seances (id, session_id, title, date, trimester, content_html)
                  VALUES ('c1', 's1', 'Atelier', '2026-11-17', 1, '<p>Prise de mesures</p>');
             INSERT INTO attendance_records (seance_id, student_id, status)
                  VALUES ('c1', 'e1', 'present');",
        )
        .unwrap();

        run(&mut conn, &dir).unwrap();

        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);

        let periodes: i64 = conn
            .query_row("SELECT COUNT(*) FROM absence_periods", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            periodes, 0,
            "aucune période n'est inventée par la migration"
        );

        let contenu: String = conn
            .query_row(
                "SELECT content_html FROM seances WHERE id = 'c1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(contenu, "<p>Prise de mesures</p>");
        let appels: i64 = conn
            .query_row("SELECT COUNT(*) FROM attendance_records", [], |r| r.get(0))
            .unwrap();
        assert_eq!(appels, 1);

        // La période suit l'élève qu'elle vise : SET NULL en ferait une absence
        // de toute la classe, et fausserait le bilan des autres.
        conn.execute_batch(
            "INSERT INTO absence_periods (id, session_id, student_id, reason,
                                          start_date, end_date)
                  VALUES ('p1', 's1', 'e1', 'Hospitalisation',
                          '2026-11-16', '2026-11-20');",
        )
        .unwrap();
        conn.execute_batch("DELETE FROM students WHERE id = 'e1';")
            .unwrap();
        let restantes: i64 = conn
            .query_row("SELECT COUNT(*) FROM absence_periods", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            restantes, 0,
            "la période part avec l'élève, elle ne s'élargit pas"
        );

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// LA REQUÊTE D'ASSIDUITÉ TELLE QU'ELLE A ÉTÉ LIVRÉE AU PALIER 005, GELÉE.
    ///
    /// Elle est recopiée ici et ne doit plus jamais changer : c'est l'étalon.
    /// Le test ci-dessous la fait tourner sur la base de l'enseignant AVANT la
    /// mise à jour, puis compare ligne à ligne avec ce que rend la requête
    /// courante APRÈS. Comparer la requête courante à elle-même ne prouverait
    /// rien.
    const ASSIDUITE_005: &str = "\
SELECT st.id,
       COUNT(se.id) AS applicable,
       COALESCE(SUM(ar.status = 'present'), 0) AS present,
       COALESCE(SUM(ar.status = 'absent'),  0) AS absent,
       COALESCE(SUM(ar.status = 'retard'),  0) AS retard,
       COALESCE(SUM(ar.status = 'excuse'),  0) AS excuse,
       COALESCE(SUM(se.id IS NOT NULL
                AND (ar.status IS NULL OR ar.status = 'non_fait')), 0) AS non_renseigne,
       (SELECT COUNT(*) FROM seances sx
         WHERE sx.session_id = st.session_id
           AND sx.trimester = ?2
           AND sx.cancelled = 0
           AND sx.date >= st.enrolled_on
           AND (st.left_on IS NULL OR sx.date <= st.left_on)
           AND EXISTS (SELECT 1 FROM absence_periods p
                        WHERE p.session_id = st.session_id
                          AND (p.student_id IS NULL OR p.student_id = st.id)
                          AND sx.date BETWEEN p.start_date AND p.end_date)) AS neutralisees
  FROM students st
  LEFT JOIN seances se ON se.session_id = st.session_id
                      AND se.trimester = ?2
                      AND se.cancelled = 0
                      AND se.date >= st.enrolled_on
                      AND (st.left_on IS NULL OR se.date <= st.left_on)
                      AND NOT EXISTS (SELECT 1 FROM absence_periods p
                                       WHERE p.session_id = st.session_id
                                         AND (p.student_id IS NULL OR p.student_id = st.id)
                                         AND se.date BETWEEN p.start_date AND p.end_date)
  LEFT JOIN attendance_records ar ON ar.seance_id = se.id AND ar.student_id = st.id
 WHERE st.session_id = ?1
 GROUP BY st.id ORDER BY st.id";

    /// Une ligne d'assiduité brute, dans l'ordre des colonnes de la requête :
    /// élève, applicables, présent, absent, retard, excusé, non renseigné,
    /// neutralisées. Aucune interprétation — c'est ce qui permet de comparer
    /// deux versions de la requête sans rien leur supposer.
    type LigneAssiduite = (String, i64, i64, i64, i64, i64, i64, i64);

    /// Les huit colonnes d'assiduité de toute la classe, triées, telles quelles.
    fn assiduite(conn: &Connection, sql: &str) -> Vec<LigneAssiduite> {
        let mut stmt = conn.prepare(sql).unwrap();
        let rows = stmt
            .query_map(rusqlite::params!["s1", 1], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                ))
            })
            .unwrap();
        let mut out: Vec<_> = rows.collect::<rusqlite::Result<_>>().unwrap();
        out.sort();
        out
    }

    /// LE SEUL TEST QUI PROUVE QU'UNE MISE À JOUR NE CHANGE RIEN CHEZ
    /// L'UTILISATEUR.
    ///
    /// Le palier 006 change la règle d'assiduité : une période de classe qui
    /// porte un suivi de stage cesse d'écarter pour tout le monde. Une base
    /// existante contient DÉJÀ des périodes « Stage en entreprise » de classe,
    /// et ne contient AUCUN placement le jour de la mise à jour — la table vient
    /// de naître vide. Ce test le vérifie en chiffres : la requête livrée au
    /// palier 005, exécutée avant, et la requête courante, exécutée après,
    /// rendent exactement les mêmes lignes.
    ///
    /// Si ce test rougit, ce n'est pas lui qu'il faut corriger : c'est qu'une
    /// mise à jour ferait bouger des pourcentages déjà imprimés et remis à des
    /// familles.
    #[test]
    fn une_base_v5_peuplee_traverse_le_palier_006_intacte() {
        let dir = temp_dir("v5-peuplee");
        let mut conn = Connection::open(dir.join("sgpa.db")).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrer_jusqua(&mut conn, 5);

        // Une classe telle qu'elle existe chez l'enseignant à la veille de la
        // mise à jour : six séances au T1, un appel fait, une élève arrivée en
        // cours de trimestre, et la période de stage DÉJÀ SAISIE sur la classe.
        conn.execute_batch(
            "INSERT INTO sessions (id, name, level_code, year_start)
                  VALUES ('s1', '3ème A', '3eme', 2026);
             INSERT INTO students (id, session_id, first_name, last_name, enrolled_on)
                  VALUES ('e1', 's1', 'Hugo', 'BERTRAND', '2026-09-01'),
                         ('e2', 's1', 'Nadia', 'BOUMEDIENE', '2026-11-09');
             INSERT INTO seances (id, session_id, title, date, trimester, content_html)
                  VALUES ('c1', 's1', 'Atelier', '2026-11-02', 1, '<p>Prise de mesures</p>'),
                         ('c2', 's1', 'Atelier', '2026-11-05', 1, ''),
                         ('c3', 's1', 'Atelier', '2026-11-09', 1, ''),
                         ('c4', 's1', 'Atelier', '2026-11-12', 1, ''),
                         ('c5', 's1', 'Atelier', '2026-11-16', 1, ''),
                         ('c6', 's1', 'Atelier', '2026-11-19', 1, '');
             INSERT INTO attendance_records (seance_id, student_id, status)
                  VALUES ('c1', 'e1', 'present'), ('c2', 'e1', 'present'),
                         ('c3', 'e1', 'present'), ('c4', 'e1', 'absent'),
                         ('c3', 'e2', 'present'), ('c4', 'e2', 'retard');
             INSERT INTO absence_periods (id, session_id, student_id, reason,
                                          start_date, end_date)
                  VALUES ('p1', 's1', NULL, 'Stage en entreprise',
                          '2026-11-16', '2026-11-20');",
        )
        .unwrap();

        let avant = assiduite(&conn, ASSIDUITE_005);
        // Ce que le bilan imprime la veille : 4 séances applicables pour Hugo,
        // les 2 du stage écartées. Écrit en clair pour que l'étalon lui-même
        // soit lisible, et non pas seulement comparé à lui-même.
        assert_eq!(avant[0], ("e1".into(), 4, 3, 1, 0, 0, 0, 2));
        assert_eq!(avant[1], ("e2".into(), 2, 1, 0, 1, 0, 0, 2));

        run(&mut conn, &dir).unwrap();

        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);

        let placements: i64 = conn
            .query_row("SELECT COUNT(*) FROM stage_placements", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            placements, 0,
            "aucun suivi de stage n'est inventé par la migration"
        );
        let periodes: i64 = conn
            .query_row("SELECT COUNT(*) FROM absence_periods", [], |r| r.get(0))
            .unwrap();
        assert_eq!(periodes, 1, "et la période saisie est toujours là");

        let apres = assiduite(&conn, crate::commands::reports::ATTENDANCE_SQL);
        assert_eq!(
            avant, apres,
            "une période de classe sans placement doit écarter EXACTEMENT comme au palier 005"
        );

        // Ce que l'enseignant avait saisi est toujours là, au caractère près.
        let contenu: String = conn
            .query_row(
                "SELECT content_html FROM seances WHERE id = 'c1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(contenu, "<p>Prise de mesures</p>");
        let appels: i64 = conn
            .query_row("SELECT COUNT(*) FROM attendance_records", [], |r| r.get(0))
            .unwrap();
        assert_eq!(appels, 6);

        // La colonne ajoutée à agenda_entries arrive vide : une entrée datée
        // antérieure au palier n'est la visite d'aucun stage.
        conn.execute_batch(
            "INSERT INTO agenda_entries (id, date, title, student_id)
                  VALUES ('a1', '2026-11-17', 'Réunion', 'e1');",
        )
        .unwrap();
        let visite: Option<String> = conn
            .query_row(
                "SELECT stage_placement_id FROM agenda_entries WHERE id = 'a1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(visite, None);

        // ⚠ SET NULL et non CASCADE : supprimer un placement mal saisi ne doit
        // JAMAIS emporter le compte rendu d'une visite déjà rédigée. C'est la
        // promesse du ON DELETE posé par l'ALTER TABLE, et elle ne se vérifie
        // que sur une base qui contient déjà une entrée datée.
        conn.execute_batch(
            "INSERT INTO stage_placements (id, absence_period_id, student_id, company_label,
                                           start_date, end_date)
                  VALUES ('sp1', 'p1', 'e1', 'Garage Bertrand',
                          '2026-11-16', '2026-11-20');
             UPDATE agenda_entries SET stage_placement_id = 'sp1',
                                       content_html = '<p>Bon accueil</p>'
              WHERE id = 'a1';
             DELETE FROM stage_placements WHERE id = 'sp1';",
        )
        .unwrap();
        let (place, rendu): (Option<String>, String) = conn
            .query_row(
                "SELECT stage_placement_id, content_html FROM agenda_entries WHERE id = 'a1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(place, None, "le placement supprimé se détache de la visite");
        assert_eq!(rendu, "<p>Bon accueil</p>", "et le compte rendu reste");

        // ⚠ CASCADE sur student_id : le suivi de stage est nominatif, il part
        // avec l'élève comme ses notes et ses appels.
        conn.execute_batch(
            "INSERT INTO stage_placements (id, absence_period_id, student_id, company_label,
                                           start_date, end_date)
                  VALUES ('sp2', 'p1', 'e1', 'Garage Bertrand',
                          '2026-11-16', '2026-11-20');
             DELETE FROM students WHERE id = 'e1';",
        )
        .unwrap();
        let restants: i64 = conn
            .query_row("SELECT COUNT(*) FROM stage_placements", [], |r| r.get(0))
            .unwrap();
        assert_eq!(restants, 0, "le placement part avec l'élève");

        let mut stmt = conn.prepare("PRAGMA foreign_key_check").unwrap();
        let orphan = stmt.query([]).unwrap().next().unwrap().is_some();
        assert!(
            !orphan,
            "la migration ne doit laisser aucune référence orpheline"
        );
        drop(stmt);

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
