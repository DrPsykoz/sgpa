use crate::db;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Seance {
    pub id: String,
    pub session_id: String,
    pub title: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub content_html: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AttendanceWithStudent {
    pub id: Option<String>,
    pub seance_id: String,
    pub student_id: String,
    pub student_first_name: String,
    pub student_last_name: String,
    pub status: String,
}

// ---- Séances CRUD ----

#[tauri::command]
pub fn get_seances(session_id: String) -> Result<Vec<Seance>, String> {
    let conn = db::init_db();
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, title, start_date, end_date, content_html, created_at
             FROM seances WHERE session_id = ?1 ORDER BY start_date DESC, created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let seances = stmt
        .query_map(params![session_id], |row| {
            Ok(Seance {
                id: row.get(0)?,
                session_id: row.get(1)?,
                title: row.get(2)?,
                start_date: row.get(3)?,
                end_date: row.get(4)?,
                content_html: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(seances)
}

#[tauri::command]
pub fn create_seance(
    session_id: String,
    title: String,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<Seance, String> {
    if title.trim().is_empty() {
        return Err("Le titre de la séance est obligatoire".to_string());
    }

    let conn = db::init_db();
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO seances (id, session_id, title, start_date, end_date) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, session_id, title.trim(), start_date, end_date],
    )
    .map_err(|e| e.to_string())?;

    // Auto-insert "present" attendance records for all students in the session
    let mut stmt = conn
        .prepare("SELECT id FROM students WHERE session_id = ?1")
        .map_err(|e| e.to_string())?;
    let student_ids: Vec<String> = stmt
        .query_map(params![session_id], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    for student_id in &student_ids {
        let att_id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO attendance_records (id, seance_id, student_id, status) VALUES (?1, ?2, ?3, 'present')",
            params![att_id, id, student_id],
        )
        .map_err(|e| e.to_string())?;
    }

    let created_at: String = conn
        .query_row(
            "SELECT created_at FROM seances WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(Seance {
        id,
        session_id,
        title: title.trim().to_string(),
        start_date,
        end_date,
        content_html: String::new(),
        created_at,
    })
}

#[tauri::command]
pub fn update_seance(
    id: String,
    title: String,
    start_date: Option<String>,
    end_date: Option<String>,
    content_html: String,
) -> Result<(), String> {
    if title.trim().is_empty() {
        return Err("Le titre de la séance est obligatoire".to_string());
    }

    let conn = db::init_db();
    conn.execute(
        "UPDATE seances SET title = ?1, start_date = ?2, end_date = ?3, content_html = ?4 WHERE id = ?5",
        params![title.trim(), start_date, end_date, content_html, id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn delete_seance(id: String) -> Result<(), String> {
    let conn = db::init_db();
    conn.execute("DELETE FROM seances WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- Attendance ----

#[tauri::command]
pub fn get_attendance(seance_id: String) -> Result<Vec<AttendanceWithStudent>, String> {
    let conn = db::init_db();

    // Get all students for this seance's session, with their attendance status (if any)
    let mut stmt = conn
        .prepare(
            "SELECT ar.id, s.id as student_id, s.first_name, s.last_name,
                    COALESCE(ar.status, 'present') as status
             FROM students s
             LEFT JOIN attendance_records ar ON ar.student_id = s.id AND ar.seance_id = ?1
             WHERE s.session_id = (SELECT session_id FROM seances WHERE id = ?1)
             ORDER BY s.last_name, s.first_name",
        )
        .map_err(|e| e.to_string())?;

    let records = stmt
        .query_map(params![seance_id], |row| {
            Ok(AttendanceWithStudent {
                id: row.get(0)?,
                seance_id: seance_id.clone(),
                student_id: row.get(1)?,
                student_first_name: row.get(2)?,
                student_last_name: row.get(3)?,
                status: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(records)
}

#[tauri::command]
pub fn set_attendance(seance_id: String, student_id: String, status: String) -> Result<(), String> {
    let valid_statuses = ["present", "absent", "retard", "excuse"];
    if !valid_statuses.contains(&status.as_str()) {
        return Err(format!("Statut invalide: {}", status));
    }

    let conn = db::init_db();
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO attendance_records (id, seance_id, student_id, status)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(seance_id, student_id) DO UPDATE SET status = ?4",
        params![id, seance_id, student_id, status],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn set_bulk_attendance(
    seance_id: String,
    records: Vec<(String, String)>,
) -> Result<(), String> {
    let valid_statuses = ["present", "absent", "retard", "excuse"];
    let conn = db::init_db();

    for (student_id, status) in &records {
        if !valid_statuses.contains(&status.as_str()) {
            return Err(format!("Statut invalide: {}", status));
        }

        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO attendance_records (id, seance_id, student_id, status)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(seance_id, student_id) DO UPDATE SET status = ?4",
            params![id, seance_id, student_id, status],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}
