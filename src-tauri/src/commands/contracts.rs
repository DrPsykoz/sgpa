use std::collections::HashSet;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::state::AppState;

#[derive(Serialize)]
pub struct ProfessionalField {
    pub id: String,
    pub name: String,
    pub position: i32,
}

#[derive(Serialize, Deserialize)]
pub struct ContractRow {
    /// `None` à l'entrée = ligne nouvelle. Au retour, toujours renseigné.
    pub id: Option<String>,
    pub position: i32,
    pub student_activity: String,
    pub training_activity: String,
    pub socle_domain_label: String,
    pub socle_competency_label: String,
}

#[derive(Serialize)]
pub struct ContractSheet {
    pub id: String,
    pub evaluation_id: String,
    pub project_title: String,
    pub professional_field_id: Option<String>,
    pub professional_field_label: String,
    pub socle_domain: String,
    pub reference_activities: String,
    pub target_careers: String,
    pub given_text: String,
    pub asked_text: String,
    pub required_text: String,
    pub rows: Vec<ContractRow>,
}

#[derive(Deserialize)]
pub struct ContractSheetInput {
    pub project_title: String,
    pub professional_field_id: Option<String>,
    pub professional_field_label: String,
    pub socle_domain: String,
    pub reference_activities: String,
    pub target_careers: String,
    pub given_text: String,
    pub asked_text: String,
    pub required_text: String,
    pub rows: Vec<ContractRow>,
}

/// Enrobe l'erreur brute de rusqlite, qui est en anglais et ne dit pas à quelle
/// étape l'enregistrement a échoué.
fn sql(step: &'static str) -> impl Fn(rusqlite::Error) -> String {
    move |e| format!("{step} : {e}")
}

/// Seule l'ABSENCE DE LIGNE devient `None`. Toute autre erreur reste une erreur :
/// c'est la différence avec le `.ok()` d'avant, qui transformait une panne SQL en
/// « pas de fiche » et ouvrait l'éditeur vierge, prêt à écraser le travail saisi.
fn optional<T>(res: rusqlite::Result<T>) -> rusqlite::Result<Option<T>> {
    match res {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

fn read_sheet(row: &rusqlite::Row<'_>) -> rusqlite::Result<ContractSheet> {
    Ok(ContractSheet {
        id: row.get(0)?,
        evaluation_id: row.get(1)?,
        project_title: row.get(2)?,
        professional_field_id: row.get(3)?,
        professional_field_label: row.get(4)?,
        socle_domain: row.get(5)?,
        reference_activities: row.get(6)?,
        target_careers: row.get(7)?,
        given_text: row.get(8)?,
        asked_text: row.get(9)?,
        required_text: row.get(10)?,
        rows: Vec::new(),
    })
}

fn read_field(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProfessionalField> {
    Ok(ProfessionalField {
        id: row.get(0)?,
        name: row.get(1)?,
        position: row.get(2)?,
    })
}

fn load_rows(conn: &rusqlite::Connection, sheet_id: &str) -> Result<Vec<ContractRow>, String> {
    const STEP: &str = "Lecture des lignes de la fiche contrat impossible";

    let mut stmt = conn
        .prepare(
            "SELECT id, position, student_activity, training_activity,
                    socle_domain_label, socle_competency_label
               FROM contract_sheet_rows
              WHERE contract_sheet_id = ?1
              ORDER BY position",
        )
        .map_err(sql(STEP))?;

    let rows = stmt
        .query_map(params![sheet_id], |row| {
            Ok(ContractRow {
                id: Some(row.get(0)?),
                position: row.get(1)?,
                student_activity: row.get(2)?,
                training_activity: row.get(3)?,
                socle_domain_label: row.get(4)?,
                socle_competency_label: row.get(5)?,
            })
        })
        .map_err(sql(STEP))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(sql(STEP))?;

    Ok(rows)
}

/// Identifiants des lignes actuellement en base pour cette fiche, base du diff.
fn load_row_ids(conn: &rusqlite::Connection, sheet_id: &str) -> Result<HashSet<String>, String> {
    const STEP: &str = "Lecture des lignes de la fiche contrat impossible";

    let mut stmt = conn
        .prepare("SELECT id FROM contract_sheet_rows WHERE contract_sheet_id = ?1")
        .map_err(sql(STEP))?;

    let ids = stmt
        .query_map(params![sheet_id], |row| row.get::<_, String>(0))
        .map_err(sql(STEP))?
        .collect::<rusqlite::Result<HashSet<String>>>()
        .map_err(sql(STEP))?;

    Ok(ids)
}

/// Fige le libellé du champ professionnel au moment de la saisie.
///
/// Un identifiant devenu inconnu (champ supprimé entre l'ouverture de l'éditeur et
/// l'enregistrement) ne fait PAS échouer la sauvegarde : on retombe sur le libellé
/// seul, exactement ce que produit le `ON DELETE SET NULL` du schéma. Perdre le
/// lien est acceptable, perdre la saisie de l'enseignant ne l'est pas.
fn resolve_field(
    tx: &rusqlite::Transaction<'_>,
    sheet: &ContractSheetInput,
) -> Result<(Option<String>, String), String> {
    let typed_label = sheet.professional_field_label.trim().to_string();

    let id = match sheet
        .professional_field_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        Some(id) => id,
        None => return Ok((None, typed_label)),
    };

    let name = optional(tx.query_row(
        "SELECT name FROM professional_fields WHERE id = ?1",
        params![id],
        |row| row.get::<_, String>(0),
    ))
    .map_err(sql("Lecture du champ professionnel impossible"))?;

    match name {
        Some(name) => Ok((Some(id.to_string()), name)),
        None => Ok((None, typed_label)),
    }
}

// ---------------------------------------------------------------------------
// Fiches contrat
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_contract_sheet(
    state: tauri::State<'_, AppState>,
    evaluation_id: String,
) -> Result<Option<ContractSheet>, String> {
    let conn = state.conn()?;

    let found = optional(conn.query_row(
        "SELECT id, evaluation_id, project_title, professional_field_id,
                professional_field_label, socle_domain, reference_activities,
                target_careers, given_text, asked_text, required_text
           FROM contract_sheets
          WHERE evaluation_id = ?1",
        params![evaluation_id],
        read_sheet,
    ))
    .map_err(sql("Lecture de la fiche contrat impossible"))?;

    let Some(mut sheet) = found else {
        return Ok(None);
    };

    sheet.rows = load_rows(&conn, &sheet.id)?;
    Ok(Some(sheet))
}

#[tauri::command]
pub fn save_contract_sheet(
    state: tauri::State<'_, AppState>,
    evaluation_id: String,
    sheet: ContractSheetInput,
) -> Result<ContractSheet, String> {
    let mut conn = state.conn()?;
    let tx = conn
        .transaction()
        .map_err(sql("Enregistrement de la fiche contrat impossible"))?;

    // Vérifié avant d'écrire : sans cela, l'échec remonte sous la forme d'une
    // violation de clé étrangère, illisible pour l'enseignant.
    let evaluation_exists = optional(tx.query_row(
        "SELECT 1 FROM evaluations WHERE id = ?1",
        params![evaluation_id],
        |_| Ok(()),
    ))
    .map_err(sql("Vérification de l'évaluation impossible"))?
    .is_some();
    if !evaluation_exists {
        return Err(
            "Cette évaluation n'existe plus : la fiche contrat n'a pas été \
                    enregistrée."
                .to_string(),
        );
    }

    let (field_id, field_label) = resolve_field(&tx, &sheet)?;

    let existing_id = optional(tx.query_row(
        "SELECT id FROM contract_sheets WHERE evaluation_id = ?1",
        params![evaluation_id],
        |row| row.get::<_, String>(0),
    ))
    .map_err(sql("Lecture de la fiche contrat impossible"))?;

    let sheet_id = match existing_id {
        Some(id) => {
            tx.execute(
                "UPDATE contract_sheets
                    SET project_title = ?2, professional_field_id = ?3,
                        professional_field_label = ?4, socle_domain = ?5,
                        reference_activities = ?6, target_careers = ?7,
                        given_text = ?8, asked_text = ?9, required_text = ?10,
                        updated_at = datetime('now')
                  WHERE id = ?1",
                params![
                    id,
                    sheet.project_title,
                    field_id,
                    field_label,
                    sheet.socle_domain,
                    sheet.reference_activities,
                    sheet.target_careers,
                    sheet.given_text,
                    sheet.asked_text,
                    sheet.required_text
                ],
            )
            .map_err(sql("Enregistrement de la fiche contrat impossible"))?;
            id
        }
        None => {
            let id = Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO contract_sheets
                     (id, evaluation_id, project_title, professional_field_id,
                      professional_field_label, socle_domain, reference_activities,
                      target_careers, given_text, asked_text, required_text)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    id,
                    evaluation_id,
                    sheet.project_title,
                    field_id,
                    field_label,
                    sheet.socle_domain,
                    sheet.reference_activities,
                    sheet.target_careers,
                    sheet.given_text,
                    sheet.asked_text,
                    sheet.required_text
                ],
            )
            .map_err(sql("Création de la fiche contrat impossible"))?;
            id
        }
    };

    // Diff, et non DELETE-tout + réinsertion : les identifiants de lignes doivent
    // survivre à un enregistrement. Sinon, le jour où quoi que ce soit les
    // référencera, un clic sur « Enregistrer » emporterait le travail en cascade.
    let known = load_row_ids(&tx, &sheet_id)?;

    let mut kept: HashSet<String> = HashSet::with_capacity(sheet.rows.len());
    let mut saved: Vec<ContractRow> = Vec::with_capacity(sheet.rows.len());

    for (index, row) in sheet.rows.iter().enumerate() {
        // L'ordre du tableau reçu EST l'ordre affiché : on renumérote 0, 1, 2…
        // plutôt que de reprendre la position envoyée, pour qu'aucun trou ni
        // doublon de position ne puisse s'installer.
        let position = index as i32;

        let reusable = row
            .id
            .as_deref()
            .filter(|id| known.contains(*id) && !kept.contains(*id));

        let id = match reusable {
            Some(id) => {
                tx.execute(
                    "UPDATE contract_sheet_rows
                        SET position = ?2, student_activity = ?3,
                            training_activity = ?4, socle_domain_label = ?5,
                            socle_competency_label = ?6
                      WHERE id = ?1",
                    params![
                        id,
                        position,
                        row.student_activity,
                        row.training_activity,
                        row.socle_domain_label,
                        row.socle_competency_label
                    ],
                )
                .map_err(sql("Enregistrement d'une ligne de la fiche impossible"))?;
                id.to_string()
            }
            None => {
                // Identifiant absent, étranger à cette fiche, ou déjà consommé par
                // une ligne précédente de la même charge utile : on crée une ligne,
                // on ne ressuscite jamais un identifiant qui appartient ailleurs.
                let id = Uuid::new_v4().to_string();
                tx.execute(
                    "INSERT INTO contract_sheet_rows
                         (id, contract_sheet_id, position, student_activity,
                          training_activity, socle_domain_label, socle_competency_label)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        id,
                        sheet_id,
                        position,
                        row.student_activity,
                        row.training_activity,
                        row.socle_domain_label,
                        row.socle_competency_label
                    ],
                )
                .map_err(sql("Ajout d'une ligne à la fiche contrat impossible"))?;
                id
            }
        };

        kept.insert(id.clone());
        saved.push(ContractRow {
            id: Some(id),
            position,
            student_activity: row.student_activity.clone(),
            training_activity: row.training_activity.clone(),
            socle_domain_label: row.socle_domain_label.clone(),
            socle_competency_label: row.socle_competency_label.clone(),
        });
    }

    for id in known.difference(&kept) {
        tx.execute("DELETE FROM contract_sheet_rows WHERE id = ?1", params![id])
            .map_err(sql("Suppression d'une ligne de la fiche impossible"))?;
    }

    tx.commit()
        .map_err(sql("Enregistrement de la fiche contrat impossible"))?;

    Ok(ContractSheet {
        id: sheet_id,
        evaluation_id,
        project_title: sheet.project_title,
        professional_field_id: field_id,
        professional_field_label: field_label,
        socle_domain: sheet.socle_domain,
        reference_activities: sheet.reference_activities,
        target_careers: sheet.target_careers,
        given_text: sheet.given_text,
        asked_text: sheet.asked_text,
        required_text: sheet.required_text,
        rows: saved,
    })
}

// ---------------------------------------------------------------------------
// Champs professionnels
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_professional_fields(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ProfessionalField>, String> {
    const STEP: &str = "Lecture des champs professionnels impossible";

    let conn = state.conn()?;
    let mut stmt = conn
        .prepare("SELECT id, name, position FROM professional_fields ORDER BY position, name")
        .map_err(sql(STEP))?;

    let fields = stmt
        .query_map([], read_field)
        .map_err(sql(STEP))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(sql(STEP))?;

    Ok(fields)
}

#[tauri::command]
pub fn create_professional_field(
    state: tauri::State<'_, AppState>,
    name: String,
) -> Result<ProfessionalField, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Le nom du champ professionnel est obligatoire.".to_string());
    }

    let conn = state.conn()?;

    // `name` est UNIQUE au schéma : renvoyer le champ déjà présent plutôt qu'une
    // violation de contrainte. L'enseignant qui retape « Habitat » veut le champ
    // Habitat, pas un message d'échec. Comparaison insensible à la casse, sinon
    // « habitat » passerait à côté de l'index UNIQUE, qui est binaire.
    let existing = optional(conn.query_row(
        "SELECT id, name, position FROM professional_fields WHERE name = ?1 COLLATE NOCASE",
        params![name],
        read_field,
    ))
    .map_err(sql("Lecture des champs professionnels impossible"))?;
    if let Some(field) = existing {
        return Ok(field);
    }

    let position: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM professional_fields",
            [],
            |row| row.get(0),
        )
        .map_err(sql("Lecture des champs professionnels impossible"))?;

    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO professional_fields (id, name, position) VALUES (?1, ?2, ?3)",
        params![id, name, position],
    )
    .map_err(sql("Création du champ professionnel impossible"))?;

    Ok(ProfessionalField {
        id,
        name: name.to_string(),
        position,
    })
}
