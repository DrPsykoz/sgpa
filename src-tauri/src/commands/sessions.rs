use rusqlite::{params, Connection, Row};
use serde::Serialize;
use uuid::Uuid;

use crate::db;
use crate::state::AppState;

/// Les cinq niveaux acceptés par le CHECK de `sessions.level_code`.
///
/// La liste est dupliquée ici volontairement : sans elle, un code invalide
/// remonterait à l'enseignant sous la forme d'un message SQLite en anglais.
const LEVEL_CODES: [&str; 5] = ["6eme", "5eme", "4eme", "3eme", "3eme_prepa"];

/// Une session EST une classe pour une année scolaire donnée.
#[derive(Debug, Clone, Serialize)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub level_code: String,
    pub year_start: i32,
    pub created_at: String,
    pub student_count: i32,
}

/// Projection commune à toutes les lectures. L'effectif vient d'une sous-requête
/// corrélée plutôt que d'un GROUP BY : une classe sans élève doit sortir avec 0,
/// pas disparaître.
const SESSION_SELECT: &str = "SELECT s.id, s.name, s.level_code, s.year_start, s.created_at,
       (SELECT COUNT(*) FROM students st WHERE st.session_id = s.id) AS student_count
  FROM sessions s";

fn map_session(row: &Row<'_>) -> rusqlite::Result<Session> {
    Ok(Session {
        id: row.get(0)?,
        name: row.get(1)?,
        level_code: row.get(2)?,
        year_start: row.get(3)?,
        created_at: row.get(4)?,
        student_count: row.get(5)?,
    })
}

fn clean_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Donnez un nom à la classe, par exemple « 4ème A ».".to_string());
    }
    Ok(name.to_string())
}

fn check_level(level_code: &str) -> Result<(), String> {
    if LEVEL_CODES.contains(&level_code) {
        return Ok(());
    }
    Err(format!(
        "Niveau de classe inconnu : « {level_code} ». Les niveaux possibles sont \
         6ème, 5ème, 4ème, 3ème et 3ème prépa-métiers."
    ))
}

fn check_year(year_start: i32) -> Result<(), String> {
    if (2000..=2100).contains(&year_start) {
        return Ok(());
    }
    Err(format!(
        "Année scolaire invalide : {year_start}. Saisissez l'année de la rentrée, \
         entre 2000 et 2100 — par exemple 2025 pour l'année 2025-2026."
    ))
}

fn load_session(conn: &Connection, id: &str) -> Result<Session, String> {
    let sql = format!("{SESSION_SELECT} WHERE s.id = ?1");
    conn.query_row(&sql, params![id], map_session)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => "Classe introuvable".to_string(),
            other => other.to_string(),
        })
}

#[tauri::command]
pub fn get_sessions(state: tauri::State<'_, AppState>) -> Result<Vec<Session>, String> {
    let conn = state.conn()?;
    let sql = format!("{SESSION_SELECT} ORDER BY s.year_start DESC, s.name");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let sessions = stmt
        .query_map([], map_session)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(sessions)
}

#[tauri::command]
pub fn get_session(state: tauri::State<'_, AppState>, id: String) -> Result<Session, String> {
    let conn = state.conn()?;
    load_session(&conn, &id)
}

#[tauri::command]
pub fn create_session(
    state: tauri::State<'_, AppState>,
    name: String,
    level_code: String,
    year_start: i32,
) -> Result<Session, String> {
    let name = clean_name(&name)?;
    check_level(&level_code)?;
    check_year(year_start)?;

    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO sessions (id, name, level_code, year_start) VALUES (?1, ?2, ?3, ?4)",
        params![id, name, level_code, year_start],
    )
    .map_err(|e| e.to_string())?;

    // Les bornes de trimestre de l'année doivent exister dès la création : la
    // date d'inscription par défaut d'un élève est t1_start, et la première
    // séance saisie a besoin de son trimestre. Créer la classe sans ses bornes
    // laisserait une fenêtre où les deux se replieraient sur des valeurs fausses.
    db::ensure_bounds(&tx, year_start).map_err(|e| e.to_string())?;

    let session = load_session(&tx, &id)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(session)
}

#[tauri::command]
pub fn update_session(
    state: tauri::State<'_, AppState>,
    id: String,
    name: String,
    level_code: String,
    year_start: i32,
) -> Result<Session, String> {
    let name = clean_name(&name)?;
    check_level(&level_code)?;
    check_year(year_start)?;

    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE sessions SET name = ?1, level_code = ?2, year_start = ?3 WHERE id = ?4",
        params![name, level_code, year_start, id],
    )
    .map_err(|e| e.to_string())?;

    // Corriger l'année d'une classe la déplace vers une année dont les bornes
    // peuvent ne pas exister encore ; on les crée comme à la création.
    db::ensure_bounds(&tx, year_start).map_err(|e| e.to_string())?;

    // Recharger sert aussi de contrôle d'existence : un id inconnu ressort en
    // « Classe introuvable » et la transaction est annulée.
    let session = load_session(&tx, &id)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(session)
}

#[tauri::command]
pub fn delete_session(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.conn()?;
    // Les élèves, séances et évaluations partent par la cascade du schéma.
    conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
