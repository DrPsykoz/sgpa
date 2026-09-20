//! Bornes de trimestres, et reclassement des lignes datées de l'année.
//!
//! Déplacer une borne ne se résume pas à écrire quatre dates : cela redéfinit le
//! trimestre de toutes les séances et de toutes les évaluations de l'année.
//! L'aperçu et l'application passent par la même fonction de planification, sinon
//! l'enseignant validerait un résumé qui n'est pas ce qui sera écrit.

use chrono::NaiveDate;
use rusqlite::{params, Connection};
use serde::Serialize;

use crate::db::{self, TrimesterBounds};
use crate::state::AppState;

#[derive(Serialize)]
pub struct RecomputePreview {
    pub seances_changing: i32,
    pub evaluations_changing: i32,
    pub kept_manual: i32,
    pub samples: Vec<String>,
}

#[derive(Serialize)]
pub struct RecomputeResult {
    pub reclassed: i32,
    pub kept_manual: i32,
}

const ANNEE_HORS_BORNES: &str = "L'année scolaire doit commencer entre 2000 et 2100.";

/// Nombre maximum de libellés d'exemple renvoyés par l'aperçu : de quoi juger sur
/// pièces sans transformer la confirmation en liste à faire défiler.
const SAMPLE_LIMIT: usize = 8;

const SEANCES: &str = "seances";
const EVALUATIONS: &str = "evaluations";

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_trimester_bounds(
    state: tauri::State<'_, AppState>,
    year_start: i32,
) -> Result<TrimesterBounds, String> {
    if !(2000..=2100).contains(&year_start) {
        return Err(ANNEE_HORS_BORNES.to_string());
    }

    let conn = state.conn()?;
    // `ensure_bounds` crée la ligne par défaut quand l'année n'a jamais été
    // réglée : l'écran s'ouvre donc toujours sur des dates cohérentes, jamais sur
    // une erreur « année inconnue ».
    db::ensure_bounds(&conn, year_start).map_err(|e| e.to_string())
}

/// Ce que donnerait un changement de bornes, **sans rien écrire**.
#[tauri::command]
pub fn preview_trimester_recompute(
    state: tauri::State<'_, AppState>,
    year_start: i32,
    t1_start: String,
    t2_start: String,
    t3_start: String,
    year_end: String,
) -> Result<RecomputePreview, String> {
    let bounds = validated_bounds(year_start, t1_start, t2_start, t3_start, year_end)?;

    let conn = state.conn()?;
    let plan = plan_recompute(&conn, &bounds)?;

    Ok(RecomputePreview {
        seances_changing: plan.seances_changing,
        evaluations_changing: plan.evaluations_changing,
        kept_manual: plan.kept_manual,
        samples: plan.samples,
    })
}

#[tauri::command]
pub fn update_trimester_bounds(
    state: tauri::State<'_, AppState>,
    year_start: i32,
    t1_start: String,
    t2_start: String,
    t3_start: String,
    year_end: String,
) -> Result<RecomputeResult, String> {
    let bounds = validated_bounds(year_start, t1_start, t2_start, t3_start, year_end)?;

    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO trimester_bounds
             (year_start, t1_start, t2_start, t3_start, year_end, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
         ON CONFLICT(year_start) DO UPDATE SET
             t1_start   = excluded.t1_start,
             t2_start   = excluded.t2_start,
             t3_start   = excluded.t3_start,
             year_end   = excluded.year_end,
             updated_at = datetime('now')",
        params![
            bounds.year_start,
            bounds.t1_start,
            bounds.t2_start,
            bounds.t3_start,
            bounds.year_end
        ],
    )
    .map_err(|e| e.to_string())?;

    // Les bornes viennent d'être écrites : le plan est calculé sur l'état exact
    // qui sera celui de la base après validation.
    let plan = plan_recompute(&tx, &bounds)?;

    {
        // Séances ET évaluations sont reclassées ici, dans la MÊME transaction.
        // Reclasser les unes sans les autres mélangerait, dans un même bilan, des
        // séances du nouveau trimestre et des évaluations restées à l'ancien.
        let mut update_seance = tx
            .prepare(
                "UPDATE seances SET trimester = ?1, updated_at = datetime('now') WHERE id = ?2",
            )
            .map_err(|e| e.to_string())?;
        // `evaluations` n'a pas de colonne updated_at (voir le palier 001).
        let mut update_evaluation = tx
            .prepare("UPDATE evaluations SET trimester = ?1 WHERE id = ?2")
            .map_err(|e| e.to_string())?;

        for change in &plan.changes {
            let stmt = if change.table == SEANCES {
                &mut update_seance
            } else {
                &mut update_evaluation
            };
            stmt.execute(params![change.trimester, change.id])
                .map_err(|e| e.to_string())?;
        }
    }

    let result = RecomputeResult {
        reclassed: plan.changes.len() as i32,
        kept_manual: plan.kept_manual,
    };
    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
}

// ---------------------------------------------------------------------------
// Planification du reclassement
// ---------------------------------------------------------------------------

/// Une ligne datée porteuse d'un trimestre. `seances` et `evaluations` partagent
/// ces cinq colonnes et se reclassent exactement de la même façon.
struct DatedRow {
    id: String,
    title: String,
    date: String,
    trimester: i32,
    manual: bool,
}

struct Change {
    table: &'static str,
    id: String,
    trimester: i32,
}

struct Plan {
    changes: Vec<Change>,
    seances_changing: i32,
    evaluations_changing: i32,
    kept_manual: i32,
    samples: Vec<String>,
}

/// Calcule, sans rien écrire, ce que les bornes `bounds` changeraient pour l'année
/// `bounds.year_start`.
fn plan_recompute(conn: &Connection, bounds: &TrimesterBounds) -> Result<Plan, String> {
    let mut changes = Vec::new();
    let mut seances_changing = 0;
    let mut evaluations_changing = 0;
    let mut kept_manual = 0;
    // Les exemples sont accumulés avec leur date pour être triés ensemble :
    // séances et évaluations d'une même semaine se lisent côte à côte.
    let mut samples: Vec<(String, String)> = Vec::new();

    for table in [SEANCES, EVALUATIONS] {
        let rows = load_dated_rows(conn, table, bounds.year_start)?;
        for row in rows {
            let target = db::trimester_for(&row.date, bounds);
            if target == row.trimester {
                continue;
            }
            if row.manual {
                // Une correction manuelle de l'enseignant n'est jamais écrasée par
                // un changement de bornes. On ne compte que celles qui auraient
                // bougé : c'est le seul chiffre qui l'informe de quelque chose.
                kept_manual += 1;
                continue;
            }

            if table == SEANCES {
                seances_changing += 1;
            } else {
                evaluations_changing += 1;
            }
            samples.push((
                row.date.clone(),
                format!(
                    "{} — {} : T{} → T{}",
                    short_date(&row.date),
                    row.title,
                    row.trimester,
                    target
                ),
            ));
            changes.push(Change {
                table,
                id: row.id,
                trimester: target,
            });
        }
    }

    samples.sort_by(|a, b| a.0.cmp(&b.0));

    Ok(Plan {
        changes,
        seances_changing,
        evaluations_changing,
        kept_manual,
        samples: samples
            .into_iter()
            .take(SAMPLE_LIMIT)
            .map(|(_, label)| label)
            .collect(),
    })
}

/// Charge les lignes datées d'une table pour toutes les classes d'une année.
///
/// `table` vient toujours d'une constante de ce module, jamais de l'appelant :
/// un nom de table ne peut pas être passé en paramètre lié.
fn load_dated_rows(
    conn: &Connection,
    table: &'static str,
    year_start: i32,
) -> Result<Vec<DatedRow>, String> {
    let sql = format!(
        "SELECT r.id, r.title, r.date, r.trimester, r.trimester_is_manual
           FROM {table} r
           JOIN sessions s ON s.id = r.session_id
          WHERE s.year_start = ?1
          ORDER BY r.date, r.title"
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![year_start], |row| {
            Ok(DatedRow {
                id: row.get(0)?,
                title: row.get(1)?,
                date: row.get(2)?,
                trimester: row.get(3)?,
                manual: row.get::<_, i32>(4)? != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/// Vérifie les quatre dates et leur ordre avant toute écriture.
///
/// Le schéma porte le même CHECK, mais son message serait illisible pour un
/// enseignant : on veut « le trimestre 2 doit commencer après le trimestre 1 »,
/// pas « CHECK constraint failed ».
fn validated_bounds(
    year_start: i32,
    t1_start: String,
    t2_start: String,
    t3_start: String,
    year_end: String,
) -> Result<TrimesterBounds, String> {
    if !(2000..=2100).contains(&year_start) {
        return Err(ANNEE_HORS_BORNES.to_string());
    }

    for (label, value) in [
        ("le début du trimestre 1", &t1_start),
        ("le début du trimestre 2", &t2_start),
        ("le début du trimestre 3", &t3_start),
        ("la fin de l'année", &year_end),
    ] {
        if !is_calendar_date(value) {
            return Err(format!(
                "La date saisie pour {label} (« {value} ») n'existe pas. \
                 Utilisez le format AAAA-MM-JJ, par exemple {year_start}-09-01."
            ));
        }
    }

    if t2_start <= t1_start {
        return Err(format!(
            "Le trimestre 2 doit commencer après le trimestre 1 : \
             début saisi {t2_start}, alors que le trimestre 1 commence le {t1_start}."
        ));
    }
    if t3_start <= t2_start {
        return Err(format!(
            "Le trimestre 3 doit commencer après le trimestre 2 : \
             début saisi {t3_start}, alors que le trimestre 2 commence le {t2_start}."
        ));
    }
    if year_end < t3_start {
        return Err(format!(
            "La fin de l'année ({year_end}) ne peut pas précéder le début du \
             trimestre 3 ({t3_start})."
        ));
    }

    Ok(TrimesterBounds {
        year_start,
        t1_start,
        t2_start,
        t3_start,
        year_end,
    })
}

/// Vrai si la chaîne est une date réelle au format AAAA-MM-JJ.
///
/// Le contrôle de forme est fait à la main avant d'appeler chrono : son analyseur
/// accepte « 2024-9-1 », que le GLOB du schéma rejetterait ensuite. Et chrono
/// écarte ce que le GLOB laisserait passer, comme un 30 février.
fn is_calendar_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    if !bytes
        .iter()
        .enumerate()
        .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
    {
        return false;
    }

    // Les dix caractères viennent d'être vérifiés : ces trois analyses ne peuvent
    // pas échouer. `unwrap_or(0)` plutôt que `unwrap()` pour qu'aucune saisie ne
    // puisse faire paniquer une commande — 0 est de toute façon rejeté ensuite.
    let year = value[0..4].parse::<i32>().unwrap_or(0);
    let month = value[5..7].parse::<u32>().unwrap_or(0);
    let day = value[8..10].parse::<u32>().unwrap_or(0);
    NaiveDate::from_ymd_opt(year, month, day).is_some()
}

/// « 2022-01-12 » → « 12/01 ». Repli sur la chaîne entière si le format surprend,
/// plutôt qu'une tranche qui paniquerait.
fn short_date(date: &str) -> String {
    match (date.get(8..10), date.get(5..7)) {
        (Some(day), Some(month)) => format!("{day}/{month}"),
        _ => date.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bounds_ok() -> Result<TrimesterBounds, String> {
        validated_bounds(
            2024,
            "2024-09-01".to_string(),
            "2024-12-02".to_string(),
            "2025-03-10".to_string(),
            "2025-07-05".to_string(),
        )
    }

    #[test]
    fn bornes_valides_acceptees() {
        let bounds = bounds_ok().expect("bornes valides");
        assert_eq!(bounds.year_start, 2024);
        assert_eq!(bounds.t2_start, "2024-12-02");
    }

    #[test]
    fn ordre_des_bornes_refuse() {
        let err = validated_bounds(
            2024,
            "2024-09-01".to_string(),
            "2024-08-01".to_string(),
            "2025-03-10".to_string(),
            "2025-07-05".to_string(),
        )
        .unwrap_err();
        assert!(err.contains("trimestre 2"), "message : {err}");
    }

    #[test]
    fn fin_egale_au_debut_de_t3_acceptee() {
        // Le schéma autorise t3_start = year_end : une année qui s'arrêterait le
        // jour même du début du trimestre 3 est absurde mais pas incohérente.
        assert!(validated_bounds(
            2024,
            "2024-09-01".to_string(),
            "2024-12-02".to_string(),
            "2025-03-10".to_string(),
            "2025-03-10".to_string(),
        )
        .is_ok());
    }

    #[test]
    fn dates_impossibles_refusees() {
        for date in ["2025-02-30", "2025-13-01", "2025-3-10", "10/03/2025", ""] {
            assert!(!is_calendar_date(date), "{date} aurait dû être refusée");
        }
        assert!(is_calendar_date("2024-02-29"), "2024 est bissextile");
    }

    #[test]
    fn annee_hors_bornes_refusee() {
        let err = validated_bounds(
            1999,
            "1999-09-01".to_string(),
            "1999-12-02".to_string(),
            "2000-03-10".to_string(),
            "2000-07-05".to_string(),
        )
        .unwrap_err();
        assert_eq!(err, ANNEE_HORS_BORNES);
    }

    #[test]
    fn libelle_court_de_date() {
        assert_eq!(short_date("2022-01-12"), "12/01");
        assert_eq!(short_date("bizarre"), "bizarre");
    }
}
