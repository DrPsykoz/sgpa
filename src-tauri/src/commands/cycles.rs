use crate::db;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ---- Cycles ----

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Cycle {
    pub id: String,
    pub user_id: String,
    pub name: String,
}

#[tauri::command]
pub fn get_cycles(user_id: String) -> Result<Vec<Cycle>, String> {
    let conn = db::init_db();
    let mut stmt = conn
        .prepare("SELECT id, user_id, name FROM cycles WHERE user_id = ?1 ORDER BY name")
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map(params![user_id], |row| {
            Ok(Cycle {
                id: row.get(0)?,
                user_id: row.get(1)?,
                name: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}

#[tauri::command]
pub fn create_cycle(user_id: String, name: String) -> Result<Cycle, String> {
    if name.trim().is_empty() {
        return Err("Le nom est obligatoire".to_string());
    }
    let conn = db::init_db();
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO cycles (id, user_id, name) VALUES (?1, ?2, ?3)",
        params![id, user_id, name.trim()],
    )
    .map_err(|e| e.to_string())?;

    Ok(Cycle {
        id,
        user_id,
        name: name.trim().to_string(),
    })
}

#[tauri::command]
pub fn update_cycle(id: String, name: String) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Le nom est obligatoire".to_string());
    }
    let conn = db::init_db();
    conn.execute(
        "UPDATE cycles SET name = ?1 WHERE id = ?2",
        params![name.trim(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_cycle(id: String) -> Result<(), String> {
    let conn = db::init_db();
    conn.execute("DELETE FROM cycles WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- Domains ----

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Domain {
    pub id: String,
    pub cycle_id: String,
    pub name: String,
}

#[tauri::command]
pub fn get_domains(cycle_id: String) -> Result<Vec<Domain>, String> {
    let conn = db::init_db();
    let mut stmt = conn
        .prepare("SELECT id, cycle_id, name FROM domains WHERE cycle_id = ?1 ORDER BY name")
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map(params![cycle_id], |row| {
            Ok(Domain {
                id: row.get(0)?,
                cycle_id: row.get(1)?,
                name: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}

#[tauri::command]
pub fn create_domain(cycle_id: String, name: String) -> Result<Domain, String> {
    if name.trim().is_empty() {
        return Err("Le nom est obligatoire".to_string());
    }
    let conn = db::init_db();
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO domains (id, cycle_id, name) VALUES (?1, ?2, ?3)",
        params![id, cycle_id, name.trim()],
    )
    .map_err(|e| e.to_string())?;

    Ok(Domain {
        id,
        cycle_id,
        name: name.trim().to_string(),
    })
}

#[tauri::command]
pub fn update_domain(id: String, name: String) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Le nom est obligatoire".to_string());
    }
    let conn = db::init_db();
    conn.execute(
        "UPDATE domains SET name = ?1 WHERE id = ?2",
        params![name.trim(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_domain(id: String) -> Result<(), String> {
    let conn = db::init_db();
    conn.execute("DELETE FROM domains WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- Fields ----

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Field {
    pub id: String,
    pub domain_id: String,
    pub name: String,
}

#[tauri::command]
pub fn get_fields(domain_id: String) -> Result<Vec<Field>, String> {
    let conn = db::init_db();
    let mut stmt = conn
        .prepare("SELECT id, domain_id, name FROM fields WHERE domain_id = ?1 ORDER BY name")
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map(params![domain_id], |row| {
            Ok(Field {
                id: row.get(0)?,
                domain_id: row.get(1)?,
                name: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}

#[tauri::command]
pub fn create_field(domain_id: String, name: String) -> Result<Field, String> {
    if name.trim().is_empty() {
        return Err("Le nom est obligatoire".to_string());
    }
    let conn = db::init_db();
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO fields (id, domain_id, name) VALUES (?1, ?2, ?3)",
        params![id, domain_id, name.trim()],
    )
    .map_err(|e| e.to_string())?;

    Ok(Field {
        id,
        domain_id,
        name: name.trim().to_string(),
    })
}

#[tauri::command]
pub fn update_field(id: String, name: String) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Le nom est obligatoire".to_string());
    }
    let conn = db::init_db();
    conn.execute(
        "UPDATE fields SET name = ?1 WHERE id = ?2",
        params![name.trim(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_field(id: String) -> Result<(), String> {
    let conn = db::init_db();
    conn.execute("DELETE FROM fields WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- Competencies ----

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Competency {
    pub id: String,
    pub field_id: String,
    pub name: String,
}

#[tauri::command]
pub fn get_competencies(field_id: String) -> Result<Vec<Competency>, String> {
    let conn = db::init_db();
    let mut stmt = conn
        .prepare(
            "SELECT id, field_id, name FROM competencies WHERE field_id = ?1 ORDER BY name",
        )
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map(params![field_id], |row| {
            Ok(Competency {
                id: row.get(0)?,
                field_id: row.get(1)?,
                name: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}

#[tauri::command]
pub fn create_competency(field_id: String, name: String) -> Result<Competency, String> {
    if name.trim().is_empty() {
        return Err("Le nom est obligatoire".to_string());
    }
    let conn = db::init_db();
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO competencies (id, field_id, name) VALUES (?1, ?2, ?3)",
        params![id, field_id, name.trim()],
    )
    .map_err(|e| e.to_string())?;

    Ok(Competency {
        id,
        field_id,
        name: name.trim().to_string(),
    })
}

#[tauri::command]
pub fn update_competency(id: String, name: String) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Le nom est obligatoire".to_string());
    }
    let conn = db::init_db();
    conn.execute(
        "UPDATE competencies SET name = ?1 WHERE id = ?2",
        params![name.trim(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_competency(id: String) -> Result<(), String> {
    let conn = db::init_db();
    conn.execute("DELETE FROM competencies WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
