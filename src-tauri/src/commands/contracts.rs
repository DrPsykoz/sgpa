use crate::db;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ContractSheet {
    pub id: String,
    pub evaluation_id: String,
    pub project_title: String,
    pub professional_field: String,
    pub socle_domain: String,
    pub reference_activities: String,
    pub target_careers: String,
    pub given_text: String,
    pub asked_text: String,
    pub required_text: String,
    pub created_at: String,
    pub rows: Vec<ContractSheetRow>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ContractSheetRow {
    pub id: String,
    pub contract_sheet_id: String,
    pub row_order: i32,
    pub student_activity: String,
    pub training_activity: String,
    pub socle_domain_text: String,
    pub socle_competency_text: String,
}

// ---- Contract Sheet CRUD ----

#[tauri::command]
pub fn get_contract_sheet(evaluation_id: String) -> Result<Option<ContractSheet>, String> {
    let conn = db::init_db();

    let sheet = conn
        .query_row(
            "SELECT id, evaluation_id, project_title, professional_field, socle_domain,
                    reference_activities, target_careers, given_text, asked_text, required_text, created_at
             FROM contract_sheets WHERE evaluation_id = ?1",
            params![evaluation_id],
            |row| {
                Ok(ContractSheet {
                    id: row.get(0)?,
                    evaluation_id: row.get(1)?,
                    project_title: row.get(2)?,
                    professional_field: row.get(3)?,
                    socle_domain: row.get(4)?,
                    reference_activities: row.get(5)?,
                    target_careers: row.get(6)?,
                    given_text: row.get(7)?,
                    asked_text: row.get(8)?,
                    required_text: row.get(9)?,
                    created_at: row.get(10)?,
                    rows: Vec::new(),
                })
            },
        )
        .ok();

    match sheet {
        Some(mut s) => {
            let mut stmt = conn
                .prepare(
                    "SELECT id, contract_sheet_id, row_order, student_activity,
                            training_activity, socle_domain_text, socle_competency_text
                     FROM contract_sheet_rows WHERE contract_sheet_id = ?1 ORDER BY row_order",
                )
                .map_err(|e| e.to_string())?;

            s.rows = stmt
                .query_map(params![s.id], |row| {
                    Ok(ContractSheetRow {
                        id: row.get(0)?,
                        contract_sheet_id: row.get(1)?,
                        row_order: row.get(2)?,
                        student_activity: row.get(3)?,
                        training_activity: row.get(4)?,
                        socle_domain_text: row.get(5)?,
                        socle_competency_text: row.get(6)?,
                    })
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;

            Ok(Some(s))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn save_contract_sheet(
    evaluation_id: String,
    project_title: String,
    professional_field: String,
    socle_domain: String,
    reference_activities: String,
    target_careers: String,
    given_text: String,
    asked_text: String,
    required_text: String,
    rows: Vec<(String, String, String, String)>, // (student_activity, training_activity, socle_domain_text, socle_competency_text)
) -> Result<ContractSheet, String> {
    let conn = db::init_db();

    // Check if the sheet already exists
    let existing_id: Option<String> = conn
        .query_row(
            "SELECT id FROM contract_sheets WHERE evaluation_id = ?1",
            params![evaluation_id],
            |row| row.get(0),
        )
        .ok();

    let sheet_id = match existing_id {
        Some(id) => {
            conn.execute(
                "UPDATE contract_sheets SET project_title = ?1, professional_field = ?2,
                 socle_domain = ?3, reference_activities = ?4, target_careers = ?5,
                 given_text = ?6, asked_text = ?7, required_text = ?8 WHERE id = ?9",
                params![
                    project_title, professional_field, socle_domain,
                    reference_activities, target_careers, given_text,
                    asked_text, required_text, id
                ],
            )
            .map_err(|e| e.to_string())?;
            id
        }
        None => {
            let id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO contract_sheets (id, evaluation_id, project_title, professional_field,
                 socle_domain, reference_activities, target_careers, given_text, asked_text, required_text)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    id, evaluation_id, project_title, professional_field,
                    socle_domain, reference_activities, target_careers,
                    given_text, asked_text, required_text
                ],
            )
            .map_err(|e| e.to_string())?;
            id
        }
    };

    // Replace all rows
    conn.execute(
        "DELETE FROM contract_sheet_rows WHERE contract_sheet_id = ?1",
        params![sheet_id],
    )
    .map_err(|e| e.to_string())?;

    let mut saved_rows = Vec::new();
    for (i, (student_act, training_act, domain_txt, comp_txt)) in rows.iter().enumerate() {
        let row_id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO contract_sheet_rows (id, contract_sheet_id, row_order, student_activity,
             training_activity, socle_domain_text, socle_competency_text)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![row_id, sheet_id, i as i32, student_act, training_act, domain_txt, comp_txt],
        )
        .map_err(|e| e.to_string())?;

        saved_rows.push(ContractSheetRow {
            id: row_id,
            contract_sheet_id: sheet_id.clone(),
            row_order: i as i32,
            student_activity: student_act.clone(),
            training_activity: training_act.clone(),
            socle_domain_text: domain_txt.clone(),
            socle_competency_text: comp_txt.clone(),
        });
    }

    let created_at: String = conn
        .query_row(
            "SELECT created_at FROM contract_sheets WHERE id = ?1",
            params![sheet_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(ContractSheet {
        id: sheet_id,
        evaluation_id,
        project_title,
        professional_field,
        socle_domain,
        reference_activities,
        target_careers,
        given_text,
        asked_text,
        required_text,
        created_at,
        rows: saved_rows,
    })
}

// ---- Professional Fields ----

#[tauri::command]
pub fn get_professional_fields(user_id: String) -> Result<Vec<(String, String)>, String> {
    let conn = db::init_db();
    let mut stmt = conn
        .prepare("SELECT id, name FROM professional_fields WHERE user_id = ?1 ORDER BY name")
        .map_err(|e| e.to_string())?;

    let fields = stmt
        .query_map(params![user_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(fields)
}

#[tauri::command]
pub fn create_professional_field(user_id: String, name: String) -> Result<(String, String), String> {
    if name.trim().is_empty() {
        return Err("Le nom du champ professionnel est obligatoire".to_string());
    }

    let conn = db::init_db();
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO professional_fields (id, user_id, name) VALUES (?1, ?2, ?3)",
        params![id, user_id, name.trim()],
    )
    .map_err(|e| e.to_string())?;

    Ok((id, name.trim().to_string()))
}
