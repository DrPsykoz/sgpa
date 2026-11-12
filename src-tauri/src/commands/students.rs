//! Élèves d'une classe.
//!
//! La période d'inscription (`enrolled_on` / `left_on`) est la donnée qui rend
//! l'assiduité juste : sans elle, « absent » et « pas encore inscrit » sont
//! indiscernables, et le dénominateur d'un élève arrivé en janvier est faux.
//!
//! **Le groupe se lit ici et ne s'y écrit pas** (palier 023). `Student` le
//! porte parce que tout écran qui liste des élèves doit pouvoir le montrer,
//! mais aucune commande de ce module ne touche `students.group_id` : la
//! répartition passe par `groups::set_student_group`, et par elle seule. C'est
//! la troisième règle d'architecture du projet, et elle paie comptant ici —
//! `update_student` n'ayant pas de `group_id` à faire transiter, aucun
//! appelant ne peut vider la colonne en l'omettant, comme il faut prendre
//! garde de le faire pour l'horaire d'`update_seance_meta`.

use chrono::NaiveDate;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use uuid::Uuid;

use crate::db;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct Student {
    pub id: String,
    pub session_id: String,
    pub first_name: String,
    pub last_name: String,
    pub enrolled_on: String,
    pub left_on: Option<String>,
    pub created_at: String,
    /// Le groupe où l'élève est rangé, s'il l'est (palier 023).
    ///
    /// `None` ne veut PAS dire « nulle part » : un élève sans groupe est
    /// convoqué à toutes les séances, y compris celles d'un groupe nommé. La
    /// règle complète est dans l'en-tête de `reports::ATTENDANCE_SQL`.
    pub group_id: Option<String>,
    /// Le nom de ce groupe, pour que l'écran n'ait pas à croiser deux listes.
    pub group_name: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn map_student(row: &rusqlite::Row<'_>) -> rusqlite::Result<Student> {
    Ok(Student {
        id: row.get(0)?,
        session_id: row.get(1)?,
        first_name: row.get(2)?,
        last_name: row.get(3)?,
        enrolled_on: row.get(4)?,
        left_on: row.get(5)?,
        created_at: row.get(6)?,
        // Colonnes ajoutées EN FIN de projection : les six index d'avant ne
        // bougent pas, donc aucun appelant n'est à relire.
        group_id: row.get(7)?,
        group_name: row.get(8)?,
    })
}

fn load_student(conn: &Connection, id: &str) -> Result<Student, String> {
    conn.query_row(
        "SELECT s.id, s.session_id, s.first_name, s.last_name, s.enrolled_on,
                s.left_on, s.created_at, s.group_id, g.name
           FROM students s
           LEFT JOIN student_groups g ON g.id = s.group_id
          WHERE s.id = ?1",
        params![id],
        map_student,
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Élève introuvable".to_string())
}

fn session_year_start(conn: &Connection, session_id: &str) -> Result<i32, String> {
    let found: Option<i32> = conn
        .query_row(
            "SELECT year_start FROM sessions WHERE id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    found.ok_or_else(|| "Classe introuvable".to_string())
}

/// Date d'inscription par défaut : le premier jour du T1 de l'année de la classe.
///
/// **Jamais `date('now')`** : un élève saisi en novembre serait alors réputé non
/// inscrit sur toutes les séances de septembre et d'octobre, qui sortiraient de
/// son assiduité sans que rien ne le signale.
fn default_enrolled_on(conn: &Connection, session_id: &str) -> Result<String, String> {
    let year_start = session_year_start(conn, session_id)?;
    let bounds = db::ensure_bounds(conn, year_start).map_err(|e| e.to_string())?;
    Ok(bounds.t1_start)
}

/// Valide une date saisie et la renvoie normalisée.
///
/// Le CHECK du schéma ne vérifie que la forme 'AAAA-MM-JJ', pas le calendrier :
/// un 31 février passerait le GLOB. On refuse ici, en français, plutôt que de
/// laisser remonter un message anglais de SQLite — ou pire, d'enregistrer une
/// date qui fausserait ensuite tous les calculs de trimestre.
fn parse_iso_date(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    let shaped = value.len() == 10 && value.as_bytes()[4] == b'-' && value.as_bytes()[7] == b'-';
    if !shaped || NaiveDate::parse_from_str(value, "%Y-%m-%d").is_err() {
        return Err(format!(
            "{label} : « {value} » n'est pas une date valide. \
             Format attendu : AAAA-MM-JJ (par exemple 2025-09-01)."
        ));
    }
    Ok(value.to_string())
}

/// Découpe une ligne collée en `(nom, prénom)`.
///
/// « NOM Prénom » et « Prénom NOM » sont indiscernables : plutôt que de deviner,
/// on tranche une fois pour toutes — **le dernier mot est le prénom**, tout ce
/// qui précède est le nom, ce qui garde intacts les noms composés (« LE GALL
/// Marie »). Une ligne d'un seul mot devient un nom sans prénom : elle reste
/// visible et corrigeable, au lieu d'être silencieusement perdue.
///
/// Renvoie `None` pour une ligne vide, qui est simplement ignorée.
fn split_name(line: &str) -> Option<(String, String)> {
    let mut parts: Vec<&str> = line.split_whitespace().collect();
    let first_name = if parts.len() > 1 {
        parts.pop().map(str::to_string).unwrap_or_default()
    } else {
        String::new()
    };
    let last_name = parts.join(" ");
    if last_name.is_empty() {
        None
    } else {
        Some((last_name, first_name))
    }
}

fn require_last_name(last_name: &str) -> Result<(), String> {
    if last_name.is_empty() {
        return Err("Le nom de l'élève est obligatoire".to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_students(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Vec<Student>, String> {
    let conn = state.conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.session_id, s.first_name, s.last_name, s.enrolled_on,
                    s.left_on, s.created_at, s.group_id, g.name
               FROM students s
               LEFT JOIN student_groups g ON g.id = s.group_id
              WHERE s.session_id = ?1
              ORDER BY s.last_name, s.first_name",
        )
        .map_err(|e| e.to_string())?;

    let students = stmt
        .query_map(params![session_id], map_student)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(students)
}

#[tauri::command]
pub fn create_student(
    state: tauri::State<'_, AppState>,
    session_id: String,
    first_name: String,
    last_name: String,
    enrolled_on: Option<String>,
) -> Result<Student, String> {
    let first_name = first_name.trim().to_string();
    let last_name = last_name.trim().to_string();
    require_last_name(&last_name)?;

    let conn = state.conn()?;
    let enrolled_on = match enrolled_on
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty())
    {
        Some(date) => {
            // La classe est vérifiée même quand la date est fournie : sinon une
            // session inexistante ne se manifesterait que par une violation de clé
            // étrangère, en anglais.
            session_year_start(&conn, &session_id)?;
            parse_iso_date(date, "Date d'inscription")?
        }
        None => default_enrolled_on(&conn, &session_id)?,
    };

    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO students (id, session_id, first_name, last_name, enrolled_on)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, session_id, first_name, last_name, enrolled_on],
    )
    .map_err(|e| e.to_string())?;

    load_student(&conn, &id)
}

/// Ajoute une liste d'élèves collée depuis un tableur : une ligne par élève.
#[tauri::command]
pub fn create_students_bulk(
    state: tauri::State<'_, AppState>,
    session_id: String,
    names: Vec<String>,
) -> Result<Vec<Student>, String> {
    let parsed: Vec<(String, String)> = names.iter().filter_map(|line| split_name(line)).collect();
    if parsed.is_empty() {
        return Err("Aucun nom à ajouter : collez une ligne par élève.".to_string());
    }

    let mut conn = state.conn()?;
    let enrolled_on = default_enrolled_on(&conn, &session_id)?;
    // Un seul horodatage pour tout le collage : les élèves d'une même liste
    // partagent la date de création, et aucun aller-retour n'est nécessaire pour
    // relire ce que la base aurait mis par défaut.
    let created_at: String = conn
        .query_row("SELECT datetime('now')", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    // Transaction unique : une liste de trente élèves s'ajoute entièrement ou pas
    // du tout, jamais à moitié.
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut students = Vec::with_capacity(parsed.len());
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO students
                     (id, session_id, first_name, last_name, enrolled_on, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .map_err(|e| e.to_string())?;

        for (last_name, first_name) in parsed {
            let id = Uuid::new_v4().to_string();
            stmt.execute(params![
                id,
                session_id,
                first_name,
                last_name,
                enrolled_on,
                created_at
            ])
            .map_err(|e| e.to_string())?;

            students.push(Student {
                id,
                session_id: session_id.clone(),
                first_name,
                last_name,
                enrolled_on: enrolled_on.clone(),
                left_on: None,
                created_at: created_at.clone(),
                // Un élève collé depuis un tableur n'arrive dans aucun groupe :
                // la répartition est un geste à part, et deviner ici ferait
                // entrer la moitié d'une classe dans le premier groupe venu.
                group_id: None,
                group_name: None,
            });
        }
    }
    tx.commit().map_err(|e| e.to_string())?;

    students.sort_by(|a, b| {
        (a.last_name.as_str(), a.first_name.as_str())
            .cmp(&(b.last_name.as_str(), b.first_name.as_str()))
    });
    Ok(students)
}

#[tauri::command]
pub fn update_student(
    state: tauri::State<'_, AppState>,
    id: String,
    first_name: String,
    last_name: String,
    enrolled_on: String,
    left_on: Option<String>,
) -> Result<Student, String> {
    let first_name = first_name.trim().to_string();
    let last_name = last_name.trim().to_string();
    require_last_name(&last_name)?;

    let enrolled_on = parse_iso_date(&enrolled_on, "Date d'inscription")?;
    let left_on = match left_on.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
        Some(date) => Some(parse_iso_date(date, "Date de départ")?),
        None => None,
    };

    // La comparaison lexicographique suffit, le format 'AAAA-MM-JJ' étant garanti
    // par parse_iso_date. Le schéma porte le même CHECK, mais son message serait
    // illisible pour l'enseignant.
    if let Some(left) = left_on.as_deref() {
        if left < enrolled_on.as_str() {
            return Err(format!(
                "La date de départ ({left}) précède la date d'inscription \
                 ({enrolled_on}) : corrigez l'une des deux."
            ));
        }
    }

    let conn = state.conn()?;
    let changed = conn
        .execute(
            "UPDATE students
                SET first_name = ?1, last_name = ?2, enrolled_on = ?3, left_on = ?4
              WHERE id = ?5",
            params![first_name, last_name, enrolled_on, left_on, id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Élève introuvable".to_string());
    }

    load_student(&conn, &id)
}

/// Ce qu'une suppression d'élève emporterait.
///
/// Tout part en cascade avec l'élève, et cela se faisait jusqu'ici **sans rien
/// annoncer** : notes, appels, appréciations de bulletin, fiches contrat, et
/// depuis le palier 004 les entrées d'agenda — dont les rapports de visite.
#[derive(Debug, Clone, Serialize)]
pub struct StudentDeletionImpact {
    pub grades: i32,
    pub attendance_records: i32,
    pub report_comments: i32,
    pub contract_sheets: i32,
    pub agenda_entries: i32,
    /// Parmi les entrées d'agenda, celles qui portent un texte rédigé : ce sont
    /// les seules irremplaçables, et c'est ce qu'il faut dire avant de détruire.
    pub written_agenda_entries: i32,
}

/// Compte l'impact **avant** la suppression, pour que la confirmation le dise.
#[tauri::command]
pub fn get_student_deletion_impact(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<StudentDeletionImpact, String> {
    let conn = state.conn()?;
    // Signale un élève inexistant en français plutôt que de renvoyer six zéros.
    load_student(&conn, &id)?;

    conn.query_row(
        "SELECT (SELECT COUNT(*) FROM grades                   WHERE student_id = ?1),
                (SELECT COUNT(*) FROM attendance_records       WHERE student_id = ?1),
                (SELECT COUNT(*) FROM report_comments          WHERE student_id = ?1),
                (SELECT COUNT(*) FROM contract_sheet_students  WHERE student_id = ?1),
                (SELECT COUNT(*) FROM agenda_entries           WHERE student_id = ?1),
                (SELECT COALESCE(SUM(content_html <> ''), 0) FROM agenda_entries
                  WHERE student_id = ?1)",
        params![id],
        |row| {
            Ok(StudentDeletionImpact {
                grades: row.get(0)?,
                attendance_records: row.get(1)?,
                report_comments: row.get(2)?,
                contract_sheets: row.get(3)?,
                agenda_entries: row.get(4)?,
                written_agenda_entries: row.get(5)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_student(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute("DELETE FROM students WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dernier_mot_est_le_prenom() {
        assert_eq!(
            split_name("DUPONT Jean"),
            Some(("DUPONT".to_string(), "Jean".to_string()))
        );
    }

    #[test]
    fn nom_compose_reste_entier() {
        assert_eq!(
            split_name("  LE GALL   Marie  "),
            Some(("LE GALL".to_string(), "Marie".to_string()))
        );
    }

    #[test]
    fn un_seul_mot_devient_le_nom() {
        assert_eq!(
            split_name("Traoré"),
            Some(("Traoré".to_string(), String::new()))
        );
    }

    #[test]
    fn ligne_vide_ignoree() {
        assert_eq!(split_name(""), None);
        assert_eq!(split_name("   \t "), None);
    }

    #[test]
    fn dates_refusees() {
        assert!(parse_iso_date("2025-02-31", "Date d'inscription").is_err());
        assert!(parse_iso_date("2025-9-1", "Date d'inscription").is_err());
        assert!(parse_iso_date("01/09/2025", "Date d'inscription").is_err());
        assert!(parse_iso_date("", "Date d'inscription").is_err());
    }

    #[test]
    fn dates_acceptees() {
        assert_eq!(
            parse_iso_date(" 2025-09-01 ", "Date d'inscription"),
            Ok("2025-09-01".to_string())
        );
        assert_eq!(
            parse_iso_date("2024-02-29", "Date d'inscription"),
            Ok("2024-02-29".to_string())
        );
    }
}
