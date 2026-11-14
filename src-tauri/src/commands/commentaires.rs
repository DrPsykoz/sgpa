//! Le commentaire du professeur sur la fiche d'évaluation d'un élève
//! (palier 027, table `evaluation_comments`).
//!
//! Une ligne par (évaluation, élève), **jamais vide** : un texte vide supprime
//! la ligne, donc l'absence de ligne est « pas de commentaire ». Ce texte
//! s'imprime sur la fiche remise à l'élève, mais n'entre dans aucun calcul.

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::state::AppState;

/// Borne d'affichage et d'impression : la fiche n'a qu'un cadre.
const MAX_COMMENT_CHARS: usize = 2000;

#[derive(Debug, Serialize)]
pub struct EvaluationComment {
    pub student_id: String,
    pub comment: String,
}

/// Les commentaires d'une évaluation, un par élève au plus.
#[tauri::command]
pub fn get_evaluation_comments(
    state: tauri::State<'_, AppState>,
    evaluation_id: String,
) -> Result<Vec<EvaluationComment>, String> {
    let conn = state.conn()?;
    lire(&conn, &evaluation_id)
}

fn lire(conn: &Connection, evaluation_id: &str) -> Result<Vec<EvaluationComment>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT student_id, comment FROM evaluation_comments
              WHERE evaluation_id = ?1
              ORDER BY student_id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![evaluation_id], |row| {
            Ok(EvaluationComment {
                student_id: row.get(0)?,
                comment: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Écrit le commentaire d'un élève ; un texte vide (après rognage) supprime la
/// ligne. L'élève doit être de la classe de l'évaluation.
#[tauri::command]
pub fn set_evaluation_comment(
    state: tauri::State<'_, AppState>,
    evaluation_id: String,
    student_id: String,
    comment: String,
) -> Result<(), String> {
    let mut conn = state.conn()?;
    ecrire(&mut conn, &evaluation_id, &student_id, &comment)
}

fn ecrire(
    conn: &mut Connection,
    evaluation_id: &str,
    student_id: &str,
    comment: &str,
) -> Result<(), String> {
    let texte = comment.trim();
    if texte.chars().count() > MAX_COMMENT_CHARS {
        return Err(format!(
            "Le commentaire est trop long : {MAX_COMMENT_CHARS} caractères au plus."
        ));
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let de_la_classe: bool = tx
        .query_row(
            "SELECT EXISTS (SELECT 1
                              FROM evaluations e
                              JOIN students s ON s.session_id = e.session_id
                             WHERE e.id = ?1 AND s.id = ?2)",
            params![evaluation_id, student_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !de_la_classe {
        return Err("Cet élève ne fait pas partie de la classe de cette évaluation.".to_string());
    }

    if texte.is_empty() {
        tx.execute(
            "DELETE FROM evaluation_comments WHERE evaluation_id = ?1 AND student_id = ?2",
            params![evaluation_id, student_id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        tx.execute(
            "INSERT INTO evaluation_comments (evaluation_id, student_id, comment)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(evaluation_id, student_id) DO UPDATE SET comment = excluded.comment",
            params![evaluation_id, student_id, texte],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn migrated_db(nom: &str) -> Connection {
        let dir = std::env::temp_dir().join(format!("sgpa-comm-{nom}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = Connection::open(dir.join("sgpa.db")).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::db::migrations::run(&mut conn, &dir).unwrap();
        conn
    }

    /// Deux classes, une évaluation dans la première, un élève dans chacune.
    fn monde(conn: &Connection) {
        conn.execute_batch(
            "INSERT INTO sessions (id, name, level_code, year_start) VALUES ('s1','A','4eme',2026),('s2','B','4eme',2026);
             INSERT INTO students (id, session_id, first_name, last_name, enrolled_on) VALUES ('e1','s1','Léa','B','2026-09-01'),('e2','s2','Max','C','2026-09-01');
             INSERT INTO evaluations (id, session_id, title, date, trimester) VALUES ('ev1','s1','Éval','2026-11-10',1);",
        )
        .unwrap();
    }

    #[test]
    fn un_commentaire_s_ecrit_se_relit_se_corrige_et_un_texte_vide_le_supprime() {
        let mut conn = migrated_db("cycle");
        monde(&conn);
        ecrire(&mut conn, "ev1", "e1", "  Bien  ").unwrap();
        let lus = lire(&conn, "ev1").unwrap();
        assert_eq!(lus.len(), 1);
        assert_eq!(lus[0].comment, "Bien");
        ecrire(&mut conn, "ev1", "e1", "Très bien").unwrap();
        assert_eq!(lire(&conn, "ev1").unwrap()[0].comment, "Très bien");
        ecrire(&mut conn, "ev1", "e1", "   ").unwrap();
        assert!(lire(&conn, "ev1").unwrap().is_empty());
    }

    #[test]
    fn un_commentaire_trop_long_est_refuse_en_francais() {
        let mut conn = migrated_db("long");
        monde(&conn);
        let trop = "x".repeat(MAX_COMMENT_CHARS + 1);
        let err = ecrire(&mut conn, "ev1", "e1", &trop).unwrap_err();
        assert!(err.contains("trop long"));
        assert!(ecrire(&mut conn, "ev1", "e1", &"x".repeat(MAX_COMMENT_CHARS)).is_ok());
    }

    #[test]
    fn un_eleve_d_une_autre_classe_est_refuse_et_rien_n_est_ecrit() {
        let mut conn = migrated_db("autre");
        monde(&conn);
        let err = ecrire(&mut conn, "ev1", "e2", "Non").unwrap_err();
        assert!(err.contains("ne fait pas partie"));
        assert!(lire(&conn, "ev1").unwrap().is_empty());
    }
}
