//! Les groupes d'élèves d'une classe : le vocabulaire, la répartition, et les
//! deux sorts qu'une suppression réserve à ce qui les cite.
//!
//! Le modèle et ses choix sont documentés dans `db/sql/023_groupes.sql`. Trois
//! d'entre eux pèsent sur ce module :
//!
//! * **Autant de groupes que voulu, nommés librement.** Décision de l'auteur
//!   du 2026-11-12 : ce n'est donc pas une colonne `groupe INTEGER CHECK IN
//!   (1, 2)` mais une table, et « Groupe 1 » n'a aucun statut particulier. Le
//!   nom est à lui ; ce module ne vérifie que ce qu'un nom doit être pour
//!   pouvoir être désigné — non vide, et assez court pour tenir sur une carte
//!   de calendrier.
//!
//! * **Un élève appartient à un seul groupe.** Même décision, et c'est elle
//!   qui fait de `students.group_id` une colonne et non une table de
//!   rattachement. L'appartenance s'écrit donc par `set_student_group` et par
//!   elle seule : `update_student` ne touche pas à cette colonne, pour la
//!   troisième règle d'architecture du projet — deux écritures qui ne
//!   concernent pas les mêmes colonnes sont deux commandes. Le corollaire est
//!   agréable : aucun appelant n'a de `group_id` à faire transiter, donc aucun
//!   ne peut l'effacer en l'omettant.
//!
//! * **Le groupe d'un élève et celui d'une séance doivent venir de la MÊME
//!   classe.** Le schéma ne sait pas l'exiger : sa clé étrangère ne vise que
//!   `student_groups(id)`, et rien n'y dit de quelle classe l'élève relève.
//!   Un élève de la 4ᵉ B rangé dans un groupe de la 3ᵉ A sortirait de tous les
//!   dénominateurs d'assiduité de sa propre classe sans qu'aucun écran ne
//!   puisse le montrer — la séance aurait un groupe, l'élève un autre, et la
//!   règle « autre groupe » ferait le reste en silence. C'est donc contrôlé
//!   ici, en français, et refusé ; jamais rectifié, comme `resolve_entry_session`
//!   au palier 016 : une rectification muette masquerait le défaut d'écran qui
//!   l'a produite.
//!
//! **La suppression a deux sorts, et c'est volontaire.** Un groupe que des
//! élèves, un créneau ou une période citent se supprime — ce sont des réglages,
//! ils reviennent à « toute la classe », c'est-à-dire à l'état d'avant le
//! palier. Un groupe qu'une séance tenue ou une évaluation citent ne se
//! supprime pas : ce sont des faits, et un bilan déjà imprimé s'appuie dessus.
//! La clé étrangère le dit déjà (RESTRICT), mais elle le dirait en anglais et
//! sans chiffre ; `delete_student_group` compte d'abord pour pouvoir le dire
//! en français et nommer ce qui retient.

use rusqlite::params;
use serde::Serialize;
use uuid::Uuid;

use crate::db::collect;
use crate::state::AppState;

/// Au-delà, le nom ne tient plus sur la pastille d'une carte de calendrier.
///
/// La borne vit ici et dans la saisie, **jamais dans un CHECK** : c'est une
/// limite d'affichage et non une règle de données, et un CHECK refuserait en
/// anglais ce que cette commande refuse en français. Même arbitrage que
/// `clean_entry_category` au palier 020.
const MAX_NOM: usize = 40;

/// Un groupe d'élèves, avec ce qu'une suppression heurterait.
#[derive(Debug, Clone, Serialize)]
pub struct StudentGroup {
    pub id: String,
    pub session_id: String,
    pub name: String,
    pub position: i32,
    /// Combien d'élèves y sont rangés. Pour l'affichage, et pour que
    /// l'enseignant voie du même coup ceux qui n'y sont pas.
    pub student_count: i64,
    /// Combien de séances ont été tenues avec ce groupe.
    pub seance_count: i64,
    /// Combien d'évaluations le visent.
    ///
    /// Ces deux derniers comptes sont rendus par le listage pour que l'écran
    /// sache **avant** de proposer le bouton : les clés étrangères sont en
    /// RESTRICT, donc le refus arriverait de toute façon, mais sous la forme
    /// d'un message de SQLite. Présenter un bouton qui échoue vaut moins que
    /// l'annoncer. Même geste qu'`activity_count` pour les domaines.
    pub evaluation_count: i64,
}

// ---------------------------------------------------------------------------
// Requêtes littérales — jamais assemblées par `format!`, pour que `sql_smoke`
// les prépare contre le schéma migré.
// ---------------------------------------------------------------------------

const GROUPES: &str = "SELECT g.id, g.session_id, g.name, g.position,
       (SELECT COUNT(*) FROM students    s WHERE s.group_id = g.id),
       (SELECT COUNT(*) FROM seances     e WHERE e.group_id = g.id),
       (SELECT COUNT(*) FROM evaluations v WHERE v.group_id = g.id)
  FROM student_groups g
 WHERE g.session_id = ?1
 ORDER BY g.position, g.name COLLATE NOCASE";

const GROUPE_PAR_NOM: &str =
    "SELECT id FROM student_groups WHERE session_id = ?1 AND name = ?2 COLLATE NOCASE";

const CLASSE_DU_GROUPE: &str = "SELECT session_id FROM student_groups WHERE id = ?1";

const CLASSE_DE_L_ELEVE: &str = "SELECT session_id FROM students WHERE id = ?1";

const PROCHAINE_POSITION: &str =
    "SELECT COALESCE(MAX(position), 0) + 1 FROM student_groups WHERE session_id = ?1";

const SEANCES_DU_GROUPE: &str = "SELECT COUNT(*) FROM seances WHERE group_id = ?1";

const EVALUATIONS_DU_GROUPE: &str = "SELECT COUNT(*) FROM evaluations WHERE group_id = ?1";

// ---------------------------------------------------------------------------
// Le vocabulaire
// ---------------------------------------------------------------------------

/// Un nom de groupe tel qu'il sera rangé : rogné, non vide, et borné.
fn clean_group_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Le nom du groupe est obligatoire.".to_string());
    }
    if name.chars().count() > MAX_NOM {
        return Err(format!(
            "Le nom du groupe ne peut pas dépasser {MAX_NOM} caractères."
        ));
    }
    Ok(name.to_string())
}

/// Les groupes d'une classe, avec ce que chacun emporterait.
#[tauri::command]
pub fn get_student_groups(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Vec<StudentGroup>, String> {
    let conn = state.conn()?;
    collect(&conn, GROUPES, params![session_id], |row| {
        Ok(StudentGroup {
            id: row.get(0)?,
            session_id: row.get(1)?,
            name: row.get(2)?,
            position: row.get(3)?,
            student_count: row.get(4)?,
            seance_count: row.get(5)?,
            evaluation_count: row.get(6)?,
        })
    })
}

#[tauri::command]
pub fn create_student_group(
    state: tauri::State<'_, AppState>,
    session_id: String,
    name: String,
) -> Result<StudentGroup, String> {
    let name = clean_group_name(&name)?;
    let conn = state.conn()?;

    // Le doublon est intercepté ici pour le NOMMER. L'index unique le refuserait
    // de toute façon, mais « UNIQUE constraint failed » n'apprend rien à
    // l'enseignant qui vient de retaper « groupe 1 » en minuscules.
    let existant: Option<String> = conn
        .query_row(GROUPE_PAR_NOM, params![session_id, name], |row| row.get(0))
        .ok();
    if existant.is_some() {
        return Err(format!("Le groupe « {name} » existe déjà dans cette classe."));
    }

    let position: i32 = conn
        .query_row(PROCHAINE_POSITION, params![session_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO student_groups (id, session_id, name, position)
              VALUES (?1, ?2, ?3, ?4)",
        params![id, session_id, name, position],
    )
    .map_err(|_| "Classe introuvable.".to_string())?;

    Ok(StudentGroup {
        id,
        session_id,
        name,
        position,
        student_count: 0,
        seance_count: 0,
        evaluation_count: 0,
    })
}

/// Renomme un groupe. C'est le seul geste qui reste gratuit sur un groupe dont
/// des séances portent déjà le nom : il ne déplace aucun élève et ne change
/// aucun compte.
#[tauri::command]
pub fn rename_student_group(
    state: tauri::State<'_, AppState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let name = clean_group_name(&name)?;
    let conn = state.conn()?;

    let session_id: String = conn
        .query_row(CLASSE_DU_GROUPE, params![id], |row| row.get(0))
        .map_err(|_| "Groupe introuvable.".to_string())?;

    let existant: Option<String> = conn
        .query_row(GROUPE_PAR_NOM, params![session_id, name], |row| row.get(0))
        .ok();
    if let Some(autre) = existant {
        if autre != id {
            return Err(format!("Le groupe « {name} » existe déjà dans cette classe."));
        }
    }

    conn.execute(
        "UPDATE student_groups SET name = ?2 WHERE id = ?1",
        params![id, name],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Retire un groupe.
///
/// Le refus est **compté avant d'être prononcé**, et il nomme ce qui retient :
/// une séance tenue et une évaluation ne se défont pas de la même façon, et
/// l'enseignant doit savoir laquelle des deux aller corriger. Ce qui n'est
/// qu'un réglage — les élèves rangés, le créneau de l'emploi du temps, la
/// période d'absence — revient de lui-même à « toute la classe » par les
/// `ON DELETE SET NULL` du palier.
#[tauri::command]
pub fn delete_student_group(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let conn = state.conn()?;

    let seances: i64 = conn
        .query_row(SEANCES_DU_GROUPE, params![id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if seances > 0 {
        return Err(format!(
            "Ce groupe a tenu {seances} séance(s) : elles resteraient sans nom de groupe \
             dans les bilans déjà établis. Renommez-le plutôt."
        ));
    }

    let evaluations: i64 = conn
        .query_row(EVALUATIONS_DU_GROUPE, params![id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if evaluations > 0 {
        return Err(format!(
            "Ce groupe porte {evaluations} évaluation(s) : détachez-les d'abord, \
             ou renommez le groupe."
        ));
    }

    let touched = conn
        .execute("DELETE FROM student_groups WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if touched == 0 {
        return Err("Groupe introuvable.".to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// La répartition
// ---------------------------------------------------------------------------

/// Range un élève dans un groupe, ou l'en sort (`group_id = None`).
///
/// Commande à part entière, et non un champ d'`update_student` : la troisième
/// règle d'architecture du projet. Deux écritures qui ne concernent pas les
/// mêmes colonnes sont deux commandes, et ici le bénéfice est direct — l'écran
/// qui répartit la classe n'a ni prénom ni date d'inscription à faire
/// transiter, donc il ne peut pas en écraser.
///
/// **Sortir un élève d'un groupe n'est pas le mettre « nulle part ».** Un élève
/// sans groupe est convoqué à TOUTES les séances, y compris celles d'un groupe
/// nommé : c'est voulu, un élève non rangé étant presque toujours un oubli de
/// rangement, et le faire disparaître des appels serait invisible. La règle
/// complète, avec son revers, est dans le commentaire d'en-tête de
/// `reports::ATTENDANCE_SQL`.
#[tauri::command]
pub fn set_student_group(
    state: tauri::State<'_, AppState>,
    student_id: String,
    group_id: Option<String>,
) -> Result<(), String> {
    let conn = state.conn()?;

    let classe_eleve: String = conn
        .query_row(CLASSE_DE_L_ELEVE, params![student_id], |row| row.get(0))
        .map_err(|_| "Élève introuvable.".to_string())?;

    if let Some(groupe) = group_id.as_deref() {
        let classe_groupe: String = conn
            .query_row(CLASSE_DU_GROUPE, params![groupe], |row| row.get(0))
            .map_err(|_| "Groupe introuvable.".to_string())?;
        if classe_groupe != classe_eleve {
            return Err("Ce groupe appartient à une autre classe.".to_string());
        }
    }

    conn.execute(
        "UPDATE students SET group_id = ?2 WHERE id = ?1",
        params![student_id, group_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Vérifie qu'un groupe, s'il est nommé, appartient bien à la classe visée.
///
/// Partagée par tout ce qui range un groupe sur un objet daté — une séance, une
/// évaluation, un créneau, une période. Le contrôle est le même partout et le
/// message aussi : recopié, il aurait fini par manquer à l'un des quatre, et
/// c'est précisément celui-là qui aurait produit des dénominateurs faux.
pub(crate) fn check_group_belongs(
    conn: &rusqlite::Connection,
    session_id: &str,
    group_id: Option<&str>,
) -> Result<(), String> {
    let Some(groupe) = group_id else {
        return Ok(());
    };
    let classe: String = conn
        .query_row(CLASSE_DU_GROUPE, params![groupe], |row| row.get(0))
        .map_err(|_| "Groupe introuvable.".to_string())?;
    if classe != session_id {
        return Err("Ce groupe appartient à une autre classe.".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn migrated_db(nom: &str) -> Connection {
        let dir = std::env::temp_dir().join(format!("sgpa-grp-{nom}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = Connection::open(dir.join("sgpa.db")).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::db::migrations::run(&mut conn, &dir).unwrap();
        conn
    }

    /// Une instruction par littéral — `sql_smoke` les prépare toutes contre le
    /// schéma, et refuse un lot de plusieurs instructions.
    ///
    /// Deux classes, et dans chacune un groupe qui porte le MÊME nom : c'est
    /// permis, l'unicité étant par classe, et c'est ce qui rend le contrôle
    /// d'appartenance nécessaire — un écran qui passerait le mauvais
    /// identifiant ne produirait aucune incohérence visible à l'œil.
    fn peupler(conn: &Connection) {
        for instruction in [
            "INSERT INTO sessions (id, name, level_code, year_start)
                  VALUES ('s1', '4ème A', '4eme', 2026),
                         ('s2', '3ème B', '3eme', 2026)",
            "INSERT INTO students (id, session_id, first_name, last_name, enrolled_on)
                  VALUES ('e1', 's1', 'Hugo', 'MARTIN', '2026-09-01'),
                         ('e2', 's1', 'Nadia', 'BOUMEDIENE', '2026-09-01')",
            "INSERT INTO student_groups (id, session_id, name, position)
                  VALUES ('g1', 's1', 'Groupe 1', 1),
                         ('g2', 's2', 'Groupe 1', 1)",
        ] {
            conn.execute(instruction, []).unwrap();
        }
    }

    /// Le nom est à l'enseignant, mais il doit pouvoir être désigné : ni vide,
    /// ni plus long qu'une pastille de carte.
    #[test]
    fn un_nom_de_groupe_est_rogne_non_vide_et_borne() {
        assert_eq!(clean_group_name("  Atelier bois  ").unwrap(), "Atelier bois");
        assert!(clean_group_name("   ").is_err());
        assert!(clean_group_name(&"x".repeat(MAX_NOM)).is_ok());
        assert!(clean_group_name(&"x".repeat(MAX_NOM + 1)).is_err());
        // Compté en CARACTÈRES et non en octets : « é » en fait deux, et une
        // borne en octets aurait refusé un nom plus court que la limite.
        assert!(clean_group_name(&"é".repeat(MAX_NOM)).is_ok());
    }

    /// LE contrôle que le schéma ne sait pas faire.
    ///
    /// Un élève de la 4ᵉ A rangé dans un groupe de la 3ᵉ B passerait la clé
    /// étrangère sans broncher, et sortirait ensuite de tous les dénominateurs
    /// d'assiduité de sa propre classe — la séance portant un groupe, l'élève
    /// un autre, la règle « autre groupe » ferait le reste en silence. Il est
    /// refusé en français, et jamais rectifié.
    #[test]
    fn un_groupe_d_une_autre_classe_est_refuse() {
        let conn = migrated_db("autre-classe");
        peupler(&conn);

        assert!(check_group_belongs(&conn, "s1", Some("g1")).is_ok());
        assert!(
            check_group_belongs(&conn, "s1", None).is_ok(),
            "« aucun groupe » veut dire « toute la classe », pas une erreur"
        );

        let err = check_group_belongs(&conn, "s1", Some("g2")).unwrap_err();
        assert!(err.contains("autre classe"), "{err}");

        let err = check_group_belongs(&conn, "s1", Some("inconnu")).unwrap_err();
        assert!(err.contains("introuvable"), "{err}");
    }

    /// Les deux sorts, comptés avant d'être prononcés : une séance tenue
    /// retient le groupe, un élève rangé ne le retient pas.
    ///
    /// C'est toute la distinction du palier — un réglage revient de lui-même à
    /// « toute la classe », un fait imprimé retient. Le compte en Rust double
    /// le RESTRICT du schéma, il ne le remplace pas : le schéma refuserait en
    /// anglais et sans chiffre.
    #[test]
    fn une_seance_tenue_retient_le_groupe_pas_un_eleve_range() {
        let conn = migrated_db("suppression");
        peupler(&conn);
        conn.execute("UPDATE students SET group_id = 'g1' WHERE id = 'e1'", [])
            .unwrap();

        let seances: i64 = conn
            .query_row(SEANCES_DU_GROUPE, params!["g1"], |r| r.get(0))
            .unwrap();
        assert_eq!(seances, 0, "un élève rangé n'est pas une séance tenue");

        conn.execute(
            "INSERT INTO seances (id, session_id, title, date, trimester, group_id)
                  VALUES ('c1', 's1', 'Atelier', '2026-09-10', 1, 'g1')",
            [],
        )
        .unwrap();
        let seances: i64 = conn
            .query_row(SEANCES_DU_GROUPE, params!["g1"], |r| r.get(0))
            .unwrap();
        assert_eq!(seances, 1);
        assert!(
            conn.execute("DELETE FROM student_groups WHERE id = 'g1'", [])
                .is_err(),
            "le RESTRICT du schéma double le compte, il ne le remplace pas"
        );
    }

    /// Le listage rend les trois comptes, parce que l'écran doit savoir
    /// **avant** de proposer le bouton de suppression.
    #[test]
    fn le_listage_dit_ce_qu_une_suppression_heurterait() {
        let conn = migrated_db("comptes");
        peupler(&conn);
        conn.execute("UPDATE students SET group_id = 'g1' WHERE id = 'e1'", [])
            .unwrap();
        conn.execute(
            "INSERT INTO evaluations (id, session_id, title, date, trimester, group_id)
                  VALUES ('ev1', 's1', 'Séquence 1', '2026-10-05', 1, 'g1')",
            [],
        )
        .unwrap();

        let lignes = collect(&conn, GROUPES, params!["s1"], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })
        .unwrap();
        assert_eq!(
            lignes,
            vec![("g1".to_string(), 1, 0, 1)],
            "groupe, élèves rangés, séances tenues, évaluations — et le groupe \
             de l'autre classe n'y figure pas"
        );
    }
}
