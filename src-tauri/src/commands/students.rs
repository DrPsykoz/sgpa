use crate::db;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Student {
    pub id: String,
    pub session_id: String,
    pub first_name: String,
    pub last_name: String,
    pub created_at: String,
}

#[tauri::command]
pub fn get_students(session_id: String) -> Result<Vec<Student>, String> {
    let conn = db::init_db();
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, first_name, last_name, created_at 
             FROM students WHERE session_id = ?1 ORDER BY last_name, first_name",
        )
        .map_err(|e| e.to_string())?;

    let students = stmt
        .query_map(params![session_id], |row| {
            Ok(Student {
                id: row.get(0)?,
                session_id: row.get(1)?,
                first_name: row.get(2)?,
                last_name: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(students)
}

#[tauri::command]
pub fn create_student(
    session_id: String,
    first_name: String,
    last_name: String,
) -> Result<Student, String> {
    if first_name.trim().is_empty() || last_name.trim().is_empty() {
        return Err("Le prénom et le nom sont obligatoires".to_string());
    }

    let conn = db::init_db();
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO students (id, session_id, first_name, last_name) VALUES (?1, ?2, ?3, ?4)",
        params![id, session_id, first_name.trim(), last_name.trim()],
    )
    .map_err(|e| e.to_string())?;

    let created_at: String = conn
        .query_row(
            "SELECT created_at FROM students WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(Student {
        id,
        session_id,
        first_name: first_name.trim().to_string(),
        last_name: last_name.trim().to_string(),
        created_at,
    })
}

#[tauri::command]
pub fn update_student(id: String, first_name: String, last_name: String) -> Result<(), String> {
    if first_name.trim().is_empty() || last_name.trim().is_empty() {
        return Err("Le prénom et le nom sont obligatoires".to_string());
    }

    let conn = db::init_db();
    conn.execute(
        "UPDATE students SET first_name = ?1, last_name = ?2 WHERE id = ?3",
        params![first_name.trim(), last_name.trim(), id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn delete_student(id: String) -> Result<(), String> {
    let conn = db::init_db();
    conn.execute("DELETE FROM students WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
