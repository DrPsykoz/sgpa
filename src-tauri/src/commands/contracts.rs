//! Fiche contrat de séquence, et champs professionnels.
//!
//! **La fiche est un document à trois tableaux**, pas un formulaire de champs
//! texte. Le modèle a été corrigé au palier 010 après lecture des fusions de
//! cellules de « fiche contrat sequence.xls » :
//!
//! 1. un en-tête : projet, champ professionnel et son sous-ensemble, activités
//!    de référence, métiers visés ;
//! 2. le tableau des activités — `contract_sheet_rows` — où une entrée du socle
//!    couvre PLUSIEURS lignes d'activité : les lignes consécutives qui pointent
//!    la même `competency_id` s'impriment sous une seule cellule fusionnée.
//!    C'est ce qui évite de recopier une compétence, donc de la faire peser
//!    plusieurs fois dans une note ;
//! 3. ON DONNE / ON DEMANDE / ON EXIGE — `contract_sheet_requirements` — trois
//!    colonnes alignées sur N lignes, parce que l'alignement EST l'information.
//!
//! **Rien n'est écrit sans un enregistrement explicite.** `suggest_contract_sheet`
//! compose une proposition à partir de l'évaluation (titre, classe, et une ligne
//! par compétence notée) et ne touche pas la base : c'est l'écran qui l'adopte,
//! et l'enseignant qui enregistre. Une pré-écriture automatique créerait des
//! fiches vides pour toute évaluation simplement ouverte.

use std::collections::HashSet;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::commands::referential::socle_reference;
use crate::state::AppState;

#[derive(Serialize)]
pub struct ProfessionalField {
    pub id: String,
    pub name: String,
    pub position: i32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ContractRow {
    /// `None` à l'entrée = ligne nouvelle. Au retour, toujours renseigné.
    pub id: Option<String>,
    pub position: i32,
    /// « activités des élèves » de la fiche contrat, « ON DEMANDE » de la fiche
    /// d'évaluation : le même texte dans ses deux documents.
    pub student_activity: String,
    pub training_activity: String,
    /// Lien vers le référentiel. `None` = ligne qui ne porte qu'un libellé.
    pub competency_id: Option<String>,
    /// Ce qui s'imprime dans la colonne « domaines ». Rempli depuis le
    /// référentiel par `socle_reference` — code, nom, cycle — mais c'est un
    /// libellé, pas une dérivation : l'enseignant peut l'écrire autrement, et
    /// sa fiche garde alors sa formulation même si le référentiel bouge.
    pub socle_domain_label: String,
    pub socle_competency_label: String,
    /// « ON EXIGE » de la fiche d'évaluation, en face de cette activité.
    pub required_text: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ContractRequirement {
    pub id: Option<String>,
    pub position: i32,
    pub given_text: String,
    pub asked_text: String,
    pub required_text: String,
}

#[derive(Serialize)]
pub struct ContractSheet {
    pub id: String,
    pub evaluation_id: String,
    pub project_title: String,
    pub professional_field_id: Option<String>,
    pub professional_field_label: String,
    /// Le « AMENAGEMENT AGENCEMENT FINITION » de sa fiche : une subdivision du
    /// champ professionnel. L'en-tête de son classeur l'appelle « domaine du
    /// socle », à tort — les domaines du socle sont dans les lignes.
    pub professional_subset: String,
    pub reference_activities: String,
    pub target_careers: String,
    pub rows: Vec<ContractRow>,
    pub requirements: Vec<ContractRequirement>,
}

#[derive(Deserialize)]
pub struct ContractSheetInput {
    pub project_title: String,
    pub professional_field_id: Option<String>,
    pub professional_field_label: String,
    pub professional_subset: String,
    pub reference_activities: String,
    pub target_careers: String,
    pub rows: Vec<ContractRow>,
    pub requirements: Vec<ContractRequirement>,
}

/// Proposition de fiche, composée depuis l'évaluation. Jamais écrite en base.
///
/// Les trois éléments de classe sont renvoyés bruts : la table `level_code` →
/// « 4ème » vit déjà dans le front (`LEVEL_LABELS`), et une seconde copie ici
/// divergerait au premier renommage.
#[derive(Serialize)]
pub struct ContractSuggestion {
    pub project_title: String,
    pub session_name: String,
    pub level_code: String,
    pub year_start: i32,
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
        professional_subset: row.get(5)?,
        reference_activities: row.get(6)?,
        target_careers: row.get(7)?,
        rows: Vec::new(),
        requirements: Vec::new(),
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
                    competency_id, socle_domain_label, socle_competency_label,
                    required_text
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
                competency_id: row.get(4)?,
                socle_domain_label: row.get(5)?,
                socle_competency_label: row.get(6)?,
                required_text: row.get(7)?,
            })
        })
        .map_err(sql(STEP))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(sql(STEP))?;

    Ok(rows)
}

fn load_requirements(
    conn: &rusqlite::Connection,
    sheet_id: &str,
) -> Result<Vec<ContractRequirement>, String> {
    const STEP: &str = "Lecture du tableau « on donne / on demande / on exige » impossible";

    let mut stmt = conn
        .prepare(
            "SELECT id, position, given_text, asked_text, required_text
               FROM contract_sheet_requirements
              WHERE contract_sheet_id = ?1
              ORDER BY position",
        )
        .map_err(sql(STEP))?;

    let rows = stmt
        .query_map(params![sheet_id], |row| {
            Ok(ContractRequirement {
                id: Some(row.get(0)?),
                position: row.get(1)?,
                given_text: row.get(2)?,
                asked_text: row.get(3)?,
                required_text: row.get(4)?,
            })
        })
        .map_err(sql(STEP))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(sql(STEP))?;

    Ok(rows)
}

/// Identifiants actuellement en base pour cette fiche, base du diff.
fn load_ids(
    conn: &rusqlite::Connection,
    query: &'static str,
    sheet_id: &str,
) -> Result<HashSet<String>, String> {
    const STEP: &str = "Lecture de la fiche contrat impossible";

    let mut stmt = conn.prepare(query).map_err(sql(STEP))?;
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

/// Résout la compétence d'une ligne : identifiant vérifié, libellés complétés.
///
/// **Le texte de l'enseignant gagne.** Sa fiche écrit « D1,1 français cycle 3 »
/// là où le référentiel, via `socle_reference`, dit « D1 — Les langages pour
/// penser et communiquer (Cycle 3) » : on ne remplace donc un libellé que s'il
/// est VIDE. Le référentiel comble les blancs,
/// il ne corrige pas une formulation choisie — et le lien, lui, reste exact,
/// c'est lui qui porte la fusion de cellule et la correspondance avec les notes.
fn resolve_competency(
    tx: &rusqlite::Transaction<'_>,
    row: &ContractRow,
) -> Result<(Option<String>, String, String), String> {
    let domain = row.socle_domain_label.trim().to_string();
    let competency = row.socle_competency_label.trim().to_string();

    let id = match row
        .competency_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        Some(id) => id,
        None => return Ok((None, domain, competency)),
    };

    let found = optional(tx.query_row(
        "SELECT c.name, d.code, d.name, cy.name
           FROM competencies c
           JOIN fields  f ON f.id = c.field_id
           JOIN domains d ON d.id = f.domain_id
           JOIN cycles  cy ON cy.id = d.cycle_id
          WHERE c.id = ?1",
        params![id],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                socle_reference(
                    &r.get::<_, String>(1)?,
                    &r.get::<_, String>(2)?,
                    &r.get::<_, String>(3)?,
                ),
            ))
        },
    ))
    .map_err(sql("Lecture de la compétence impossible"))?;

    // Compétence supprimée du référentiel entre l'ouverture de l'éditeur et
    // l'enregistrement : on garde le libellé, on lâche le lien. Même arbitrage
    // que pour le champ professionnel.
    let Some((competency_name, reference)) = found else {
        return Ok((None, domain, competency));
    };

    Ok((
        Some(id.to_string()),
        if domain.is_empty() { reference } else { domain },
        if competency.is_empty() {
            competency_name
        } else {
            competency
        },
    ))
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
                professional_field_label, professional_subset, reference_activities,
                target_careers
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
    sheet.requirements = load_requirements(&conn, &sheet.id)?;
    Ok(Some(sheet))
}

/// Compose une fiche depuis l'évaluation, SANS RIEN ÉCRIRE.
///
/// Une ligne par compétence notée, dans l'ordre où l'enseignant les a choisies,
/// avec le domaine et la compétence déjà renseignés — c'est la colonne « mise en
/// relation avec le socle commun » de sa fiche, qu'il n'a plus à recopier. Les
/// activités restent vides : elles sont de lui, et les inventer produirait un
/// document faux remis à un élève.
#[tauri::command]
pub fn suggest_contract_sheet(
    state: tauri::State<'_, AppState>,
    evaluation_id: String,
) -> Result<ContractSuggestion, String> {
    const STEP: &str = "Lecture de l'évaluation impossible";
    let conn = state.conn()?;

    let entete = optional(conn.query_row(
        "SELECT e.title, s.name, s.level_code, s.year_start
           FROM evaluations e
           JOIN sessions s ON s.id = e.session_id
          WHERE e.id = ?1",
        params![evaluation_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i32>(3)?,
            ))
        },
    ))
    .map_err(sql(STEP))?;

    let Some((title, session_name, level_code, year_start)) = entete else {
        return Err("Cette évaluation n'existe plus.".to_string());
    };

    // `ec.position` d'abord : l'ordre dans lequel l'enseignant a coché les
    // compétences est un choix, et sa fiche suit la chronologie du projet, pas
    // l'ordre du décret.
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.name, d.code, d.name, cy.name
               FROM evaluation_competencies ec
               JOIN competencies c ON c.id = ec.competency_id
               JOIN fields  f      ON f.id = c.field_id
               JOIN domains d      ON d.id = f.domain_id
               JOIN cycles  cy     ON cy.id = d.cycle_id
              WHERE ec.evaluation_id = ?1
              ORDER BY ec.position, d.position, f.position, c.position",
        )
        .map_err(sql(STEP))?;

    let rows = stmt
        .query_map(params![evaluation_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                socle_reference(
                    &row.get::<_, String>(2)?,
                    &row.get::<_, String>(3)?,
                    &row.get::<_, String>(4)?,
                ),
            ))
        })
        .map_err(sql(STEP))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(sql(STEP))?
        .into_iter()
        .enumerate()
        .map(|(index, (id, competency, reference))| ContractRow {
            id: None,
            position: index as i32,
            student_activity: String::new(),
            training_activity: String::new(),
            competency_id: Some(id),
            socle_domain_label: reference,
            socle_competency_label: competency,
            required_text: String::new(),
        })
        .collect();

    Ok(ContractSuggestion {
        project_title: title,
        session_name,
        level_code,
        year_start,
        rows,
    })
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
                        professional_field_label = ?4, professional_subset = ?5,
                        reference_activities = ?6, target_careers = ?7,
                        updated_at = datetime('now')
                  WHERE id = ?1",
                params![
                    id,
                    sheet.project_title,
                    field_id,
                    field_label,
                    sheet.professional_subset,
                    sheet.reference_activities,
                    sheet.target_careers
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
                      professional_field_label, professional_subset,
                      reference_activities, target_careers)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    id,
                    evaluation_id,
                    sheet.project_title,
                    field_id,
                    field_label,
                    sheet.professional_subset,
                    sheet.reference_activities,
                    sheet.target_careers
                ],
            )
            .map_err(sql("Création de la fiche contrat impossible"))?;
            id
        }
    };

    // Diff, et non DELETE-tout + réinsertion : les identifiants de lignes doivent
    // survivre à un enregistrement. Sinon, le jour où quoi que ce soit les
    // référencera, un clic sur « Enregistrer » emporterait le travail en cascade.
    let known = load_ids(
        &tx,
        "SELECT id FROM contract_sheet_rows WHERE contract_sheet_id = ?1",
        &sheet_id,
    )?;

    let mut kept: HashSet<String> = HashSet::with_capacity(sheet.rows.len());
    let mut saved: Vec<ContractRow> = Vec::with_capacity(sheet.rows.len());

    for (index, row) in sheet.rows.iter().enumerate() {
        // L'ordre du tableau reçu EST l'ordre affiché : on renumérote 0, 1, 2…
        // plutôt que de reprendre la position envoyée, pour qu'aucun trou ni
        // doublon de position ne puisse s'installer. L'ordre porte aussi les
        // fusions de cellules : deux lignes de même compétence ne s'impriment
        // sous une seule cellule que si elles sont voisines.
        let position = index as i32;
        let (competency_id, domain_label, competency_label) = resolve_competency(&tx, row)?;

        let reusable = row
            .id
            .as_deref()
            .filter(|id| known.contains(*id) && !kept.contains(*id));

        let id = match reusable {
            Some(id) => {
                tx.execute(
                    "UPDATE contract_sheet_rows
                        SET position = ?2, student_activity = ?3,
                            training_activity = ?4, competency_id = ?5,
                            socle_domain_label = ?6, socle_competency_label = ?7,
                            required_text = ?8
                      WHERE id = ?1",
                    params![
                        id,
                        position,
                        row.student_activity,
                        row.training_activity,
                        competency_id,
                        domain_label,
                        competency_label,
                        row.required_text
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
                          training_activity, competency_id, socle_domain_label,
                          socle_competency_label, required_text)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        id,
                        sheet_id,
                        position,
                        row.student_activity,
                        row.training_activity,
                        competency_id,
                        domain_label,
                        competency_label,
                        row.required_text
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
            competency_id,
            socle_domain_label: domain_label,
            socle_competency_label: competency_label,
            required_text: row.required_text.clone(),
        });
    }

    for id in known.difference(&kept) {
        tx.execute("DELETE FROM contract_sheet_rows WHERE id = ?1", params![id])
            .map_err(sql("Suppression d'une ligne de la fiche impossible"))?;
    }

    // Même diff pour le tableau « on donne / on demande / on exige ».
    let known_req = load_ids(
        &tx,
        "SELECT id FROM contract_sheet_requirements WHERE contract_sheet_id = ?1",
        &sheet_id,
    )?;

    let mut kept_req: HashSet<String> = HashSet::with_capacity(sheet.requirements.len());
    let mut saved_req: Vec<ContractRequirement> = Vec::with_capacity(sheet.requirements.len());

    for (index, req) in sheet.requirements.iter().enumerate() {
        let position = index as i32;
        let reusable = req
            .id
            .as_deref()
            .filter(|id| known_req.contains(*id) && !kept_req.contains(*id));

        let id = match reusable {
            Some(id) => {
                tx.execute(
                    "UPDATE contract_sheet_requirements
                        SET position = ?2, given_text = ?3, asked_text = ?4,
                            required_text = ?5
                      WHERE id = ?1",
                    params![
                        id,
                        position,
                        req.given_text,
                        req.asked_text,
                        req.required_text
                    ],
                )
                .map_err(sql("Enregistrement des consignes impossible"))?;
                id.to_string()
            }
            None => {
                let id = Uuid::new_v4().to_string();
                tx.execute(
                    "INSERT INTO contract_sheet_requirements
                         (id, contract_sheet_id, position, given_text, asked_text,
                          required_text)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        id,
                        sheet_id,
                        position,
                        req.given_text,
                        req.asked_text,
                        req.required_text
                    ],
                )
                .map_err(sql("Ajout d'une consigne impossible"))?;
                id
            }
        };

        kept_req.insert(id.clone());
        saved_req.push(ContractRequirement {
            id: Some(id),
            position,
            given_text: req.given_text.clone(),
            asked_text: req.asked_text.clone(),
            required_text: req.required_text.clone(),
        });
    }

    for id in known_req.difference(&kept_req) {
        tx.execute(
            "DELETE FROM contract_sheet_requirements WHERE id = ?1",
            params![id],
        )
        .map_err(sql("Suppression d'une consigne impossible"))?;
    }

    tx.commit()
        .map_err(sql("Enregistrement de la fiche contrat impossible"))?;

    Ok(ContractSheet {
        id: sheet_id,
        evaluation_id,
        project_title: sheet.project_title,
        professional_field_id: field_id,
        professional_field_label: field_label,
        professional_subset: sheet.professional_subset,
        reference_activities: sheet.reference_activities,
        target_careers: sheet.target_careers,
        rows: saved,
        requirements: saved_req,
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

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn migrated_db(nom: &str) -> Connection {
        let dir = std::env::temp_dir().join(format!("sgpa-contrats-{nom}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = Connection::open(dir.join("sgpa.db")).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::db::migrations::run(&mut conn, &dir).unwrap();
        conn
    }

    /// Une instruction par littéral — `sql_smoke` les prépare toutes contre le
    /// schéma, et `prepare` refuse un lot de plusieurs instructions.
    fn peupler(conn: &Connection) {
        for instruction in [
            "INSERT INTO sessions (id, name, level_code, year_start)
                  VALUES ('s1', '4ème A', '4eme', 2026)",
            "INSERT INTO evaluations (id, session_id, title, date, trimester)
                  VALUES ('ev1', 's1', 'Fabrication d''un nichoir', '2026-11-17', 1)",
            // Trois compétences du semis 009, cochées dans un ordre qui n'est
            // pas celui du décret : c'est l'ordre du projet.
            "INSERT INTO evaluation_competencies (evaluation_id, competency_id, position)
                  VALUES ('ev1', 'seed-c3-l31', 0),
                         ('ev1', 'seed-c3-l06', 1),
                         ('ev1', 'seed-c3-l22', 2)",
        ] {
            conn.execute_batch(instruction).unwrap();
        }
    }

    /// Reproduit `save_contract_sheet` sans la couche Tauri : le harnais
    /// `mock_builder` ne démarre pas sur ce poste (voir CLAUDE.md), donc les
    /// tests passent par la transaction, qui porte toute la logique utile.
    fn enregistrer(conn: &mut Connection, rows: Vec<ContractRow>) -> Vec<ContractRow> {
        let tx = conn.transaction().unwrap();
        tx.execute(
            "INSERT INTO contract_sheets (id, evaluation_id, project_title)
                  VALUES ('f1', 'ev1', 'Nichoir')
             ON CONFLICT (evaluation_id) DO NOTHING",
            [],
        )
        .unwrap();

        let mut sortie = Vec::new();
        for (index, row) in rows.iter().enumerate() {
            let (competency_id, domain, competency) = resolve_competency(&tx, row).unwrap();
            let id = format!("l{index}");
            tx.execute(
                "INSERT INTO contract_sheet_rows
                     (id, contract_sheet_id, position, student_activity,
                      training_activity, competency_id, socle_domain_label,
                      socle_competency_label, required_text)
                 VALUES (?1, 'f1', ?2, '', '', ?3, ?4, ?5, '')",
                params![id, index as i32, competency_id, domain, competency],
            )
            .unwrap();
            sortie.push(ContractRow {
                id: Some(id),
                position: index as i32,
                competency_id,
                socle_domain_label: domain,
                socle_competency_label: competency,
                ..row.clone()
            });
        }
        tx.commit().unwrap();
        sortie
    }

    fn ligne(competency_id: Option<&str>, domaine: &str, competence: &str) -> ContractRow {
        ContractRow {
            id: None,
            position: 0,
            student_activity: String::new(),
            training_activity: String::new(),
            competency_id: competency_id.map(str::to_string),
            socle_domain_label: domaine.to_string(),
            socle_competency_label: competence.to_string(),
            required_text: String::new(),
        }
    }

    /// Le référentiel comble les blancs, il ne réécrit pas une formulation.
    ///
    /// Sa fiche écrit « D1,1 français cycle 3 » pour le domaine 1 : écraser ce
    /// texte par « D1 — Les langages pour penser et communiquer (Cycle 3) »
    /// rendrait le document méconnaissable pour l'élève à qui il est remis.
    /// Laissé vide, en revanche, c'est bien ce libellé composé qui s'écrit —
    /// avec son code et son cycle, sans quoi la cellule ne permet pas de
    /// retrouver l'entrée dans le référentiel.
    #[test]
    fn le_libelle_saisi_survit_a_l_enregistrement() {
        let mut conn = migrated_db("libelle");
        peupler(&conn);

        let saved = enregistrer(
            &mut conn,
            vec![
                ligne(Some("seed-c3-l06"), "", ""),
                ligne(Some("seed-c3-l06"), "D1,1 français cycle 3", "à ma façon"),
            ],
        );

        assert_eq!(
            saved[0].socle_domain_label,
            "D1 — Les langages pour penser et communiquer (Cycle 3)",
            "un libellé vide se remplit depuis le référentiel, code et cycle compris"
        );
        assert_eq!(saved[1].socle_domain_label, "D1,1 français cycle 3");
        assert_eq!(saved[1].socle_competency_label, "à ma façon");
        assert_eq!(saved[1].competency_id.as_deref(), Some("seed-c3-l06"));
    }

    /// Une compétence retirée du référentiel ne vide pas la fiche.
    #[test]
    fn une_competence_inconnue_laisse_le_texte_et_lache_le_lien() {
        let mut conn = migrated_db("inconnue");
        peupler(&conn);

        let saved = enregistrer(
            &mut conn,
            vec![ligne(Some("competence-effacee"), "D2", "mon libellé")],
        );

        assert_eq!(saved[0].competency_id, None, "le lien est lâché");
        assert_eq!(saved[0].socle_competency_label, "mon libellé");
    }

    /// LE test qui protège la note. Trois activités sous une seule compétence,
    /// c'est la fusion de cellule de sa fiche — et c'est trois lignes pointant
    /// le MÊME identifiant, non trois copies du libellé. Si une évolution
    /// repassait au texte libre, cette compétence pèserait trois fois dans la
    /// moyenne /20 de l'élève, en silence.
    #[test]
    fn plusieurs_activites_partagent_une_seule_competence() {
        let mut conn = migrated_db("fusion");
        peupler(&conn);

        enregistrer(
            &mut conn,
            vec![
                ligne(Some("seed-c3-l31"), "", ""),
                ligne(Some("seed-c3-l31"), "", ""),
                ligne(Some("seed-c3-l31"), "", ""),
                ligne(Some("seed-c3-l06"), "", ""),
            ],
        );

        let distinctes: i64 = conn
            .query_row(
                "SELECT COUNT(DISTINCT competency_id) FROM contract_sheet_rows
                  WHERE contract_sheet_id = 'f1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let lignes: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM contract_sheet_rows WHERE contract_sheet_id = 'f1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!((lignes, distinctes), (4, 2));
    }

    /// Supprimer une compétence du référentiel ne doit pas effacer la ligne de
    /// fiche : `ON DELETE SET NULL`, et le libellé figé prend le relais.
    #[test]
    fn supprimer_la_competence_conserve_la_ligne() {
        let mut conn = migrated_db("cascade");
        peupler(&conn);
        enregistrer(
            &mut conn,
            vec![ligne(Some("seed-c3-l31"), "D3", "organiser")],
        );

        // La compétence est d'abord retirée de l'évaluation : `grades` et
        // `evaluation_competencies` la retiennent en RESTRICT, et c'est voulu —
        // une note sans compétence n'a pas de sens.
        conn.execute_batch(
            "DELETE FROM evaluation_competencies
              WHERE evaluation_id = 'ev1' AND competency_id = 'seed-c3-l31'",
        )
        .unwrap();
        conn.execute_batch("DELETE FROM competencies WHERE id = 'seed-c3-l31'")
            .unwrap();

        let (lien, libelle): (Option<String>, String) = conn
            .query_row(
                "SELECT competency_id, socle_competency_label
                   FROM contract_sheet_rows WHERE contract_sheet_id = 'f1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(lien, None);
        assert_eq!(libelle, "organiser", "le texte de l'enseignant reste");
    }

    /// Le palier 010 ne jette pas ce qui avait été saisi dans les trois
    /// anciennes colonnes : il en fait la première ligne du tableau.
    #[test]
    fn le_tableau_des_consignes_accepte_plusieurs_lignes_alignees() {
        let conn = migrated_db("consignes");
        peupler(&conn);
        conn.execute_batch(
            "INSERT INTO contract_sheets (id, evaluation_id, project_title)
                  VALUES ('f1', 'ev1', 'Nichoir')",
        )
        .unwrap();
        conn.execute_batch(
            "INSERT INTO contract_sheet_requirements
                 (id, contract_sheet_id, position, given_text, asked_text, required_text)
             VALUES ('r1', 'f1', 0, 'les plans', 'identifier et interpréter un document',
                     'les éléments sont correctement repérés'),
                    ('r2', 'f1', 1, 'les palettes', 'démonter sans casser',
                     'les planches sont dépourvues de pointes')",
        )
        .unwrap();

        let lues = load_requirements(&conn, "f1").unwrap();
        assert_eq!(lues.len(), 2);
        // L'alignement est l'information : « les plans » répond à « identifier
        // et interpréter un document », pas à « démonter sans casser ».
        assert_eq!(lues[0].given_text, "les plans");
        assert_eq!(lues[0].asked_text, "identifier et interpréter un document");
        assert_eq!(lues[1].given_text, "les palettes");
    }
}
