use crate::db;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Evaluation {
    pub id: String,
    pub session_id: String,
    pub title: String,
    pub school_year: String,
    pub trimester: i32,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EvaluationWithCompetencies {
    pub id: String,
    pub session_id: String,
    pub title: String,
    pub school_year: String,
    pub trimester: i32,
    pub created_at: String,
    pub competency_ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Grade {
    pub id: String,
    pub evaluation_id: String,
    pub student_id: String,
    pub competency_id: String,
    pub level: i32,
    pub comment: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CompetencyInfo {
    pub id: String,
    pub name: String,
    pub field_name: String,
    pub domain_name: String,
    pub cycle_name: String,
}

// ---- Evaluations CRUD ----

#[tauri::command]
pub fn get_evaluations(session_id: String) -> Result<Vec<EvaluationWithCompetencies>, String> {
    let conn = db::init_db();
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, title, school_year, trimester, created_at
             FROM evaluations WHERE session_id = ?1 ORDER BY school_year, trimester, created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let evals = stmt
        .query_map(params![session_id], |row| {
            Ok(Evaluation {
                id: row.get(0)?,
                session_id: row.get(1)?,
                title: row.get(2)?,
                school_year: row.get(3)?,
                trimester: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for eval in evals {
        let mut comp_stmt = conn
            .prepare("SELECT competency_id FROM evaluation_competencies WHERE evaluation_id = ?1")
            .map_err(|e| e.to_string())?;

        let comp_ids: Vec<String> = comp_stmt
            .query_map(params![eval.id], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        result.push(EvaluationWithCompetencies {
            id: eval.id,
            session_id: eval.session_id,
            title: eval.title,
            school_year: eval.school_year,
            trimester: eval.trimester,
            created_at: eval.created_at,
            competency_ids: comp_ids,
        });
    }

    Ok(result)
}

#[tauri::command]
pub fn create_evaluation(
    session_id: String,
    title: String,
    school_year: String,
    trimester: i32,
    competency_ids: Vec<String>,
) -> Result<EvaluationWithCompetencies, String> {
    if title.trim().is_empty() {
        return Err("Le titre de l'évaluation est obligatoire".to_string());
    }
    if !["4eme", "3eme"].contains(&school_year.as_str()) {
        return Err("L'année scolaire doit être 4ème ou 3ème".to_string());
    }
    if !(1..=3).contains(&trimester) {
        return Err("Le trimestre doit être 1, 2 ou 3".to_string());
    }

    let conn = db::init_db();
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO evaluations (id, session_id, title, school_year, trimester) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, session_id, title.trim(), school_year, trimester],
    )
    .map_err(|e| e.to_string())?;

    for comp_id in &competency_ids {
        conn.execute(
            "INSERT INTO evaluation_competencies (evaluation_id, competency_id) VALUES (?1, ?2)",
            params![id, comp_id],
        )
        .map_err(|e| e.to_string())?;
    }

    let created_at: String = conn
        .query_row(
            "SELECT created_at FROM evaluations WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(EvaluationWithCompetencies {
        id,
        session_id,
        title: title.trim().to_string(),
        school_year,
        trimester,
        created_at,
        competency_ids,
    })
}

#[tauri::command]
pub fn update_evaluation(
    id: String,
    title: String,
    school_year: String,
    trimester: i32,
    competency_ids: Vec<String>,
) -> Result<(), String> {
    if title.trim().is_empty() {
        return Err("Le titre de l'évaluation est obligatoire".to_string());
    }

    let conn = db::init_db();
    conn.execute(
        "UPDATE evaluations SET title = ?1, school_year = ?2, trimester = ?3 WHERE id = ?4",
        params![title.trim(), school_year, trimester, id],
    )
    .map_err(|e| e.to_string())?;

    // Replace competencies
    conn.execute(
        "DELETE FROM evaluation_competencies WHERE evaluation_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;

    for comp_id in &competency_ids {
        conn.execute(
            "INSERT INTO evaluation_competencies (evaluation_id, competency_id) VALUES (?1, ?2)",
            params![id, comp_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn delete_evaluation(id: String) -> Result<(), String> {
    let conn = db::init_db();
    conn.execute("DELETE FROM evaluations WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- Get evaluation competencies with full path info ----

#[tauri::command]
pub fn get_evaluation_competencies(evaluation_id: String) -> Result<Vec<CompetencyInfo>, String> {
    let conn = db::init_db();
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.name, f.name as field_name, d.name as domain_name, cy.name as cycle_name
             FROM evaluation_competencies ec
             JOIN competencies c ON c.id = ec.competency_id
             JOIN fields f ON f.id = c.field_id
             JOIN domains d ON d.id = f.domain_id
             JOIN cycles cy ON cy.id = d.cycle_id
             WHERE ec.evaluation_id = ?1
             ORDER BY cy.name, d.name, f.name, c.name",
        )
        .map_err(|e| e.to_string())?;

    let competencies = stmt
        .query_map(params![evaluation_id], |row| {
            Ok(CompetencyInfo {
                id: row.get(0)?,
                name: row.get(1)?,
                field_name: row.get(2)?,
                domain_name: row.get(3)?,
                cycle_name: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(competencies)
}

// ---- Grades ----

#[tauri::command]
pub fn get_grades(evaluation_id: String) -> Result<Vec<Grade>, String> {
    let conn = db::init_db();
    let mut stmt = conn
        .prepare(
            "SELECT id, evaluation_id, student_id, competency_id, level, comment
             FROM grades WHERE evaluation_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let grades = stmt
        .query_map(params![evaluation_id], |row| {
            Ok(Grade {
                id: row.get(0)?,
                evaluation_id: row.get(1)?,
                student_id: row.get(2)?,
                competency_id: row.get(3)?,
                level: row.get(4)?,
                comment: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(grades)
}

#[tauri::command]
pub fn set_grade(
    evaluation_id: String,
    student_id: String,
    competency_id: String,
    level: i32,
) -> Result<(), String> {
    if !(0..=5).contains(&level) {
        return Err("Le niveau doit être entre 0 et 5".to_string());
    }

    let conn = db::init_db();
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO grades (id, evaluation_id, student_id, competency_id, level)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(evaluation_id, student_id, competency_id) DO UPDATE SET level = ?5",
        params![id, evaluation_id, student_id, competency_id, level],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
