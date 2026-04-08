use crate::db;
use bcrypt::{hash, verify, DEFAULT_COST};
use rusqlite::params;
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize, Clone)]
pub struct User {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub created_at: String,
}

#[tauri::command]
pub fn login(username: String, password: String) -> Result<User, String> {
    let conn = db::init_db();
    let mut stmt = conn
        .prepare("SELECT id, username, password_hash, display_name, created_at FROM users WHERE username = ?1")
        .map_err(|e| e.to_string())?;

    let user = stmt
        .query_row(params![username], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|_| "Nom d'utilisateur ou mot de passe incorrect".to_string())?;

    let (id, username, password_hash, display_name, created_at) = user;

    if !verify(&password, &password_hash).map_err(|e| e.to_string())? {
        return Err("Nom d'utilisateur ou mot de passe incorrect".to_string());
    }

    Ok(User {
        id,
        username,
        display_name,
        created_at,
    })
}

#[tauri::command]
pub fn register(username: String, password: String, display_name: String) -> Result<User, String> {
    if username.trim().is_empty() || password.trim().is_empty() || display_name.trim().is_empty() {
        return Err("Tous les champs sont obligatoires".to_string());
    }

    if password.len() < 4 {
        return Err("Le mot de passe doit contenir au moins 4 caractères".to_string());
    }

    let conn = db::init_db();

    // Check if username already exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM users WHERE username = ?1",
            params![username.trim()],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    if exists {
        return Err("Ce nom d'utilisateur existe déjà".to_string());
    }

    let id = Uuid::new_v4().to_string();
    let password_hash = hash(password.as_bytes(), DEFAULT_COST).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO users (id, username, password_hash, display_name) VALUES (?1, ?2, ?3, ?4)",
        params![id, username.trim(), password_hash, display_name.trim()],
    )
    .map_err(|e| e.to_string())?;

    let created_at: String = conn
        .query_row(
            "SELECT created_at FROM users WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(User {
        id,
        username: username.trim().to_string(),
        display_name: display_name.trim().to_string(),
        created_at,
    })
}

#[tauri::command]
pub fn get_users() -> Result<Vec<User>, String> {
    let conn = db::init_db();
    let mut stmt = conn
        .prepare("SELECT id, username, display_name, created_at FROM users ORDER BY display_name")
        .map_err(|e| e.to_string())?;

    let users = stmt
        .query_map([], |row| {
            Ok(User {
                id: row.get(0)?,
                username: row.get(1)?,
                display_name: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(users)
}
