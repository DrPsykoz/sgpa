use crate::db;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Session {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub created_at: String,
    pub student_count: i64,
}

#[tauri::command]
pub fn get_sessions(user_id: String) -> Result<Vec<Session>, String> {
    let conn = db::init_db();
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.user_id, s.name, s.created_at, 
             (SELECT COUNT(*) FROM students st WHERE st.session_id = s.id) as student_count
             FROM sessions s WHERE s.user_id = ?1 ORDER BY s.created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let sessions = stmt
        .query_map(params![user_id], |row| {
            Ok(Session {
                id: row.get(0)?,
                user_id: row.get(1)?,
                name: row.get(2)?,
                created_at: row.get(3)?,
                student_count: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(sessions)
}

#[tauri::command]
pub fn create_session(user_id: String, name: String) -> Result<Session, String> {
    if name.trim().is_empty() {
        return Err("Le nom de la session est obligatoire".to_string());
    }

    let conn = db::init_db();
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO sessions (id, user_id, name) VALUES (?1, ?2, ?3)",
        params![id, user_id, name.trim()],
    )
    .map_err(|e| e.to_string())?;

    let created_at: String = conn
        .query_row(
            "SELECT created_at FROM sessions WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(Session {
        id,
        user_id,
        name: name.trim().to_string(),
        created_at,
        student_count: 0,
    })
}

#[tauri::command]
pub fn update_session(id: String, name: String) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Le nom de la session est obligatoire".to_string());
    }

    let conn = db::init_db();
    conn.execute(
        "UPDATE sessions SET name = ?1 WHERE id = ?2",
        params![name.trim(), id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn delete_session(id: String) -> Result<(), String> {
    let conn = db::init_db();
    conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
