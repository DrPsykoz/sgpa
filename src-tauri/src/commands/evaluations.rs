use std::collections::{HashMap, HashSet};

use rusqlite::{params, params_from_iter, Connection, Transaction};
use serde::Serialize;
use uuid::Uuid;

use crate::commands::referential::socle_reference;
use crate::db;
use crate::state::AppState;

#[derive(Debug, Serialize, Clone)]
pub struct Evaluation {
    pub id: String,
    pub session_id: String,
    pub title: String,
    pub date: String,
    pub trimester: i32,
    pub trimester_is_manual: bool,
    pub created_at: String,
    pub competency_ids: Vec<String>,
    /// Le groupe évalué, ou `None` pour « toute la classe » (palier 023).
    ///
    /// **C'est un fait et non un réglage**, comme `seances.group_id` : il décide
    /// de qui on attend des notes, donc de ce que l'accueil appelle une
    /// évaluation complète. D'où le `RESTRICT` du schéma — supprimer un groupe
    /// ne doit pas rendre complète, du jour au lendemain, une évaluation qui ne
    /// l'était pas.
    pub group_id: Option<String>,
    /// Le nom du groupe, joint à la lecture. **Dérivé, jamais écrit.**
    pub group_name: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct CompetencyInfo {
    pub id: String,
    pub name: String,
    pub field_name: String,
    pub domain_name: String,
    pub cycle_name: String,
    /// Le domaine désigné sans ambiguïté — « D3 — La formation de la personne
    /// et du citoyen (Cycle 3) ». À CÔTÉ de `domain_name` et `cycle_name`, pas
    /// à leur place : l'arbre du référentiel montre le nom sous son cycle, où
    /// répéter le cycle dans chaque feuille n'apprendrait rien, tandis que la
    /// cellule d'une fiche contrat est lue seule et doit se suffire.
    ///
    /// Composé par `referential::socle_reference`, jamais par le front :
    /// réimplémenter la règle là-bas la ferait diverger de ce qui est
    /// enregistré, et la fiche imprimerait autre chose que la base.
    pub socle_reference: String,
    pub archived: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct Grade {
    pub evaluation_id: String,
    pub student_id: String,
    pub competency_id: String,
    /// Note entière sur 20, de 1 à 20. **Pas de 0, et pas de « non évalué »** :
    /// une compétence non notée n'a pas de ligne dans `grades` (palier 018). Le
    /// libellé de maîtrise ne voyage pas avec elle — il est dérivé de la note
    /// par le front, qui porte le découpage en tranches.
    pub mark: i32,
}

/// Une case que l'enseignant a déclarée **« ne sera pas évaluée »** : un élève,
/// une compétence, sur une évaluation.
///
/// Elle ne porte pas de note et n'en portera pas. C'est le second sens de
/// l'absence de ligne dans `grades`, et le palier 022 existe pour le séparer du
/// premier : une case vierge est « en attente », une case déclarée ne sera
/// jamais remplie. L'accueil cesse de réclamer la seconde, et la feuille remise
/// à l'élève y imprime « non évalué » au lieu de laisser une ligne qui se lit
/// comme un oubli.
///
/// **Aucun champ de plus**, et surtout pas de motif : la déclaration dit qu'il
/// n'y aura pas de note, elle n'a pas à dire pourquoi. Un motif libre finirait
/// sur le document de l'élève ou dans un calcul.
#[derive(Debug, Serialize, Clone)]
pub struct GradeWaiver {
    pub evaluation_id: String,
    pub student_id: String,
    pub competency_id: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct OrphanGrades {
    pub competency_name: String,
    pub grade_count: i32,
}

// ---------------------------------------------------------------------------
// Validation et helpers internes
// ---------------------------------------------------------------------------

const DATE_HINT: &str = "La date doit être au format AAAA-MM-JJ, par exemple 2025-09-15.";

/// Bornes de la note sur 20. **Elles doublent le CHECK du schéma, exprès** : le
/// CHECK est le garde-fou, ces deux constantes sont ce qui permet de l'EXPLIQUER
/// — « CHECK constraint failed: grades » ne dit rien à un enseignant.
///
/// Le minimum est 1 et non 0 : il n'y a pas de note de 0 (décision du
/// 2026-11-07). Une compétence non notée n'a pas de ligne, et c'est
/// `delete_grade` qui l'y ramène.
///
/// Le découpage en tranches de maîtrise, lui, n'est **pas** ici : le backend ne
/// nomme jamais un niveau, il ne stocke et ne valide qu'un nombre. La règle vit
/// dans `src/types/index.ts`, en un seul endroit.
const MARK_MIN: i32 = 1;
const MARK_MAX: i32 = 20;

/// Le CHECK du schéma refuserait déjà une date mal formée, mais son message est
/// illisible pour un enseignant : on valide ici pour pouvoir l'expliquer.
fn check_date(date: &str) -> Result<(), String> {
    let bytes = date.as_bytes();
    let well_formed = bytes.len() == 10
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            4 | 7 => *byte == b'-',
            _ => byte.is_ascii_digit(),
        });
    if well_formed {
        Ok(())
    } else {
        Err(DATE_HINT.to_string())
    }
}

/// `db::resolve_trimester` ignore silencieusement un trimestre forcé hors bornes
/// et recalcule : on refuse plutôt, pour que la correction manuelle de
/// l'enseignant ne soit jamais perdue sans qu'il le sache.
fn check_trimester(trimester: Option<i32>) -> Result<(), String> {
    match trimester {
        Some(value) if !(1..=3).contains(&value) => {
            Err("Le trimestre doit être 1, 2 ou 3.".to_string())
        }
        _ => Ok(()),
    }
}

/// Dédoublonne en conservant l'ordre de sélection : la clé primaire de
/// `evaluation_competencies` ferait échouer l'insertion d'un doublon avec un
/// message SQLite brut.
///
/// Partagé avec `progressions`, qui rattache des compétences à une étape depuis
/// le palier 021 et bute sur la même clé primaire. Une seconde rédaction aurait
/// surtout recopié le détail qui compte : les identifiants vides sont filtrés
/// **avant** le dédoublonnage, sinon deux cases jamais cochées se comptent pour
/// une sélection.
pub(crate) fn unique_ids(ids: Vec<String>) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    ids.into_iter()
        .filter(|id| !id.trim().is_empty())
        .filter(|id| seen.insert(id.clone()))
        .collect()
}

fn not_found(error: rusqlite::Error, message: &str) -> String {
    match error {
        rusqlite::Error::QueryReturnedNoRows => message.to_string(),
        other => other.to_string(),
    }
}

/// Réécrit la grille de compétences d'une évaluation, la position portant
/// l'ordre d'affichage des colonnes.
fn write_competency_links(
    tx: &Transaction<'_>,
    evaluation_id: &str,
    competency_ids: &[String],
) -> Result<(), String> {
    let mut stmt = tx
        .prepare(
            "INSERT INTO evaluation_competencies (evaluation_id, competency_id, position)
             VALUES (?1, ?2, ?3)",
        )
        .map_err(|e| e.to_string())?;

    for (position, competency_id) in competency_ids.iter().enumerate() {
        stmt.execute(params![evaluation_id, competency_id, position as i32])
            .map_err(|e| {
                format!(
                    "Une compétence sélectionnée n'a pas pu être rattachée à \
                     l'évaluation : elle a probablement été supprimée du référentiel. \
                     Rouvrez le sélecteur de compétences puis réessayez.\nDétail : {e}"
                )
            })?;
    }
    Ok(())
}

/// Combien de cases réglées resteraient hors de la grille si l'évaluation
/// passait à ce groupe.
///
/// Une note et une déclaration comptent pareil : l'une comme l'autre est un
/// geste que l'enseignant a posé, et que restreindre le groupe ferait
/// disparaître de l'écran sans l'effacer de la base. C'est exactement le défaut
/// que le garde-fou des compétences retirées existe pour empêcher, à ceci près
/// qu'ici **on ne propose pas de supprimer** : les notes d'un élève lui
/// appartiennent, et un bouton « supprimer ces notes » placé dans un formulaire
/// de titre et de date serait une perte de données à un clic d'un renommage.
const CASES_HORS_GROUPE: &str = "SELECT COUNT(DISTINCT st.id)
  FROM students st
 WHERE st.session_id = (SELECT e.session_id FROM evaluations e WHERE e.id = ?1)
   AND st.group_id IS NOT NULL
   AND st.group_id <> ?2
   AND (EXISTS (SELECT 1 FROM grades g
                 WHERE g.evaluation_id = ?1 AND g.student_id = st.id)
     OR EXISTS (SELECT 1 FROM grade_waivers w
                 WHERE w.evaluation_id = ?1 AND w.student_id = st.id))";

/// Refuse, en français, de restreindre une évaluation à un groupe si des élèves
/// hors de ce groupe y ont déjà une note ou une déclaration.
///
/// Refuser plutôt que supprimer, et refuser plutôt que cacher : une note qui
/// existe encore mais que plus aucun écran n'affiche est la panne qu'on ne voit
/// pas. Élargir à toute la classe (`None`) ne cache jamais rien, donc ne
/// déclenche rien.
fn check_no_grade_left_outside(
    conn: &Connection,
    evaluation_id: &str,
    group_id: Option<&str>,
) -> Result<(), String> {
    let Some(groupe) = group_id else {
        return Ok(());
    };
    let restants: i64 = conn
        .query_row(CASES_HORS_GROUPE, params![evaluation_id, groupe], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;
    if restants > 0 {
        return Err(format!(
            "{restants} élève(s) hors de ce groupe ont déjà une note ou une mention \
             « non évalué » sur cette évaluation. Effacez-les d'abord depuis la grille, \
             ou laissez l'évaluation ouverte à toute la classe."
        ));
    }
    Ok(())
}

fn load_evaluation(conn: &Connection, id: &str) -> Result<Evaluation, String> {
    let mut evaluation = conn
        .query_row(
            "SELECT e.id, e.session_id, e.title, e.date, e.trimester, e.trimester_is_manual,
                    e.created_at, e.group_id,
                    (SELECT g.name FROM student_groups g WHERE g.id = e.group_id)
               FROM evaluations e WHERE e.id = ?1",
            params![id],
            |row| {
                Ok(Evaluation {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    title: row.get(2)?,
                    date: row.get(3)?,
                    trimester: row.get(4)?,
                    trimester_is_manual: row.get(5)?,
                    created_at: row.get(6)?,
                    competency_ids: Vec::new(),
                    group_id: row.get(7)?,
                    group_name: row.get(8)?,
                })
            },
        )
        .map_err(|e| not_found(e, "Évaluation introuvable"))?;

    let mut stmt = conn
        .prepare(
            "SELECT competency_id FROM evaluation_competencies
              WHERE evaluation_id = ?1 ORDER BY position",
        )
        .map_err(|e| e.to_string())?;
    evaluation.competency_ids = stmt
        .query_map(params![id], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(evaluation)
}

fn orphan_message(orphans: &[OrphanGrades]) -> String {
    let total: i32 = orphans.iter().map(|orphan| orphan.grade_count).sum();
    let details = orphans
        .iter()
        .map(|orphan| {
            format!(
                "« {} » ({} note(s))",
                orphan.competency_name, orphan.grade_count
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "Vous retirez de cette évaluation des compétences qui portent déjà des notes : \
         {details}.\n\nEnregistrer supprimera définitivement ces {total} note(s). \
         Confirmez la suppression pour continuer, ou remettez ces compétences dans la grille."
    )
}

/// Supprime les notes des compétences qui ne font plus partie de la grille.
///
/// **Ne touche pas aux cases « ne sera pas évaluée »**, et c'est délibéré : une
/// déclaration ne contient rien qu'une suppression puisse perdre, plus rien ne
/// la lit tant que la compétence est hors de la grille (le compte de l'accueil
/// exige la compétence encore rattachée), et si l'enseignant remet cette
/// compétence, il retrouve ses cases telles qu'il les avait laissées. C'est la
/// promesse que le palier 015 fait déjà aux notes, tenue ici sans confirmation
/// puisqu'il n'y a rien à détruire.
fn delete_orphan_rows(
    tx: &Transaction<'_>,
    evaluation_id: &str,
    kept: &[String],
) -> Result<(), String> {
    if kept.is_empty() {
        // `NOT IN ()` n'est pas du SQL valide : plus aucune compétence retenue
        // veut dire que toutes les notes de l'évaluation sont orphelines.
        tx.execute(
            "DELETE FROM grades WHERE evaluation_id = ?1",
            params![evaluation_id],
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Seuls les ?n sont engendrés ici ; les identifiants restent des paramètres
    // liés, jamais concaténés dans le SQL.
    let placeholders = (2..=kept.len() + 1)
        .map(|n| format!("?{n}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "DELETE FROM grades WHERE evaluation_id = ?1 AND competency_id NOT IN ({placeholders})"
    );

    let mut args: Vec<&str> = Vec::with_capacity(kept.len() + 1);
    args.push(evaluation_id);
    args.extend(kept.iter().map(String::as_str));

    tx.execute(&sql, params_from_iter(args))
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Évaluations
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_evaluations(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Vec<Evaluation>, String> {
    let conn = state.conn()?;

    let mut stmt = conn
        .prepare(
            "SELECT e.id, e.session_id, e.title, e.date, e.trimester, e.trimester_is_manual,
                    e.created_at, e.group_id,
                    (SELECT g.name FROM student_groups g WHERE g.id = e.group_id)
               FROM evaluations e WHERE e.session_id = ?1
              ORDER BY e.trimester, e.date DESC",
        )
        .map_err(|e| e.to_string())?;
    let mut evaluations = stmt
        .query_map(params![session_id], |row| {
            Ok(Evaluation {
                id: row.get(0)?,
                session_id: row.get(1)?,
                title: row.get(2)?,
                date: row.get(3)?,
                trimester: row.get(4)?,
                trimester_is_manual: row.get(5)?,
                created_at: row.get(6)?,
                competency_ids: Vec::new(),
                group_id: row.get(7)?,
                group_name: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Une seule requête pour TOUS les liens de la classe. La version précédente
    // en lançait une par évaluation : sur une année complète, l'ouverture de
    // l'onglet coûtait une centaine d'allers-retours.
    let mut links: HashMap<String, Vec<String>> = HashMap::new();
    let mut link_stmt = conn
        .prepare(
            "SELECT ec.evaluation_id, ec.competency_id
               FROM evaluation_competencies ec
               JOIN evaluations e ON e.id = ec.evaluation_id
              WHERE e.session_id = ?1
              ORDER BY ec.evaluation_id, ec.position",
        )
        .map_err(|e| e.to_string())?;
    let rows = link_stmt
        .query_map(params![session_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (evaluation_id, competency_id) = row.map_err(|e| e.to_string())?;
        links.entry(evaluation_id).or_default().push(competency_id);
    }

    for evaluation in &mut evaluations {
        if let Some(ids) = links.remove(&evaluation.id) {
            evaluation.competency_ids = ids;
        }
    }

    Ok(evaluations)
}

#[tauri::command]
pub fn create_evaluation(
    state: tauri::State<'_, AppState>,
    session_id: String,
    title: String,
    date: String,
    trimester: Option<i32>,
    competency_ids: Vec<String>,
    // Absent comme nul, il vaut « toute la classe ».
    group_id: Option<String>,
) -> Result<Evaluation, String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("Le titre de l'évaluation est obligatoire.".to_string());
    }
    check_date(&date)?;
    check_trimester(trimester)?;
    let competency_ids = unique_ids(competency_ids);

    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Sans cette vérification, un trimestre forcé court-circuite la lecture de la
    // session et l'erreur remontée serait une violation de clé étrangère.
    let session_exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ?1)",
            params![session_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !session_exists {
        return Err("Classe introuvable".to_string());
    }

    // La clé étrangère ne pointe que `student_groups(id)` : elle accepterait le
    // groupe d'une autre classe, et cette évaluation-là n'attendrait de notes de
    // personne.
    super::groups::check_group_belongs(&tx, &session_id, group_id.as_deref())?;

    let (trimester_value, is_manual) =
        db::resolve_trimester(&tx, &session_id, &date, trimester).map_err(|e| e.to_string())?;

    let id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO evaluations (id, session_id, title, date, trimester, trimester_is_manual,
                                  group_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            session_id,
            title,
            date,
            trimester_value,
            is_manual,
            group_id
        ],
    )
    .map_err(|e| e.to_string())?;

    write_competency_links(&tx, &id, &competency_ids)?;

    let evaluation = load_evaluation(&tx, &id)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(evaluation)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn update_evaluation(
    state: tauri::State<'_, AppState>,
    id: String,
    title: String,
    date: String,
    trimester: Option<i32>,
    competency_ids: Vec<String>,
    delete_orphan_grades: bool,
    // ⚠ **Tout appelant le fait transiter inchangé**, même piège que l'horaire
    // d'`update_seance_meta` : l'omettre rendrait l'évaluation à la classe
    // entière au premier renommage, et l'accueil la déclarerait incomplète.
    group_id: Option<String>,
) -> Result<Evaluation, String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("Le titre de l'évaluation est obligatoire.".to_string());
    }
    check_date(&date)?;
    check_trimester(trimester)?;
    let competency_ids = unique_ids(competency_ids);

    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let session_id: String = tx
        .query_row(
            "SELECT session_id FROM evaluations WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| not_found(e, "Évaluation introuvable"))?;

    // Retirer une compétence de la grille faisait disparaître sa colonne mais pas
    // ses notes : elles continuaient d'alimenter les moyennes du bilan sans plus
    // être visibles ni corrigeables nulle part. On les compte AVANT d'écrire —
    // une violation de contrainte, elle, ne dirait pas quelles lignes sont en
    // cause.
    let kept: HashSet<&str> = competency_ids.iter().map(String::as_str).collect();
    let mut stmt = tx
        .prepare(
            "SELECT g.competency_id, c.name, COUNT(*)
               FROM grades g
               JOIN competencies c ON c.id = g.competency_id
              WHERE g.evaluation_id = ?1
              GROUP BY g.competency_id, c.name
              ORDER BY c.name",
        )
        .map_err(|e| e.to_string())?;
    let counted = stmt
        .query_map(params![id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                OrphanGrades {
                    competency_name: row.get(1)?,
                    grade_count: row.get(2)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    let orphans: Vec<OrphanGrades> = counted
        .into_iter()
        .filter(|(competency_id, _)| !kept.contains(competency_id.as_str()))
        .map(|(_, orphan)| orphan)
        .collect();

    if !orphans.is_empty() {
        if !delete_orphan_grades {
            return Err(orphan_message(&orphans));
        }
        delete_orphan_rows(&tx, &id, &competency_ids)?;
    }

    super::groups::check_group_belongs(&tx, &session_id, group_id.as_deref())?;
    check_no_grade_left_outside(&tx, &id, group_id.as_deref())?;

    let (trimester_value, is_manual) =
        db::resolve_trimester(&tx, &session_id, &date, trimester).map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE evaluations
            SET title = ?1, date = ?2, trimester = ?3, trimester_is_manual = ?4, group_id = ?5
          WHERE id = ?6",
        params![title, date, trimester_value, is_manual, group_id, id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "DELETE FROM evaluation_competencies WHERE evaluation_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    write_competency_links(&tx, &id, &competency_ids)?;

    let evaluation = load_evaluation(&tx, &id)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(evaluation)
}

#[tauri::command]
pub fn delete_evaluation(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.conn()?;
    // La cascade de `grades`, `grade_waivers` et `evaluation_competencies`
    // fait le reste.
    conn.execute("DELETE FROM evaluations WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_evaluation_competencies(
    state: tauri::State<'_, AppState>,
    evaluation_id: String,
) -> Result<Vec<CompetencyInfo>, String> {
    let conn = state.conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.name, f.name, d.name, cy.name, d.code,
                    c.archived_at IS NOT NULL
               FROM evaluation_competencies ec
               JOIN competencies c ON c.id = ec.competency_id
               JOIN fields f       ON f.id = c.field_id
               JOIN domains d      ON d.id = f.domain_id
               JOIN cycles cy      ON cy.id = d.cycle_id
              WHERE ec.evaluation_id = ?1
              ORDER BY d.position, f.position, c.position",
        )
        .map_err(|e| e.to_string())?;

    let competencies = stmt
        .query_map(params![evaluation_id], |row| {
            let domain_name: String = row.get(3)?;
            let cycle_name: String = row.get(4)?;
            Ok(CompetencyInfo {
                id: row.get(0)?,
                name: row.get(1)?,
                field_name: row.get(2)?,
                socle_reference: socle_reference(
                    &row.get::<_, String>(5)?,
                    &domain_name,
                    &cycle_name,
                ),
                domain_name,
                cycle_name,
                archived: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(competencies)
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_grades(
    state: tauri::State<'_, AppState>,
    evaluation_id: String,
) -> Result<Vec<Grade>, String> {
    let conn = state.conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT evaluation_id, student_id, competency_id, mark
               FROM grades WHERE evaluation_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let grades = stmt
        .query_map(params![evaluation_id], |row| {
            Ok(Grade {
                evaluation_id: row.get(0)?,
                student_id: row.get(1)?,
                competency_id: row.get(2)?,
                mark: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(grades)
}

#[tauri::command]
pub fn set_grade(
    state: tauri::State<'_, AppState>,
    evaluation_id: String,
    student_id: String,
    competency_id: String,
    mark: i32,
) -> Result<(), String> {
    if !(MARK_MIN..=MARK_MAX).contains(&mark) {
        return Err(format!(
            "La note doit être un nombre entier compris entre {MARK_MIN} et {MARK_MAX}."
        ));
    }

    // Transaction, pour une raison et une seule : poser une note sur une case
    // déclarée « ne sera pas évaluée » lève la déclaration, et les deux
    // écritures ne doivent pas pouvoir rester à moitié faites. Une case qui
    // porterait les deux n'est interdite par aucun CHECK — SQLite ne sait pas
    // regarder une autre table —, elle l'est ici et dans `set_grade_waiver`,
    // chacune dans son sens.
    //
    // C'est `set_grade` qui cède, et pas l'inverse : saisir une note est un
    // geste sans ambiguïté — l'élève a été évalué —, et la déclaration qu'elle
    // efface ne contient rien. Dans l'autre sens, `set_grade_waiver` refuse
    // plutôt que d'effacer une note, qui, elle, est une donnée.
    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "DELETE FROM grade_waivers
          WHERE evaluation_id = ?1 AND competency_id = ?2 AND student_id = ?3",
        params![evaluation_id, competency_id, student_id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO grades (evaluation_id, competency_id, student_id, mark)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(evaluation_id, competency_id, student_id)
         DO UPDATE SET mark = excluded.mark, updated_at = datetime('now')",
        params![evaluation_id, competency_id, student_id, mark],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Efface une note : la case redevient vierge, c'est-à-dire **« en attente »**.
///
/// En attente, et non « ne sera pas évaluée » : effacer une note ne déclare
/// rien, cela ramène la case à l'état où l'enseignant n'a pas encore noté.
/// L'autre état, celui qui dit que la note ne viendra jamais, se pose par
/// `set_grade_waiver` et par lui seul (palier 022).
///
/// **Commande distincte de `set_grade`, et non un `mark` conventionnel.** Avant
/// le palier 018, effacer s'écrivait `set_grade(…, 0)` : « non évalué » était un
/// niveau de l'échelle, et une flèche du clavier maintenue une seconde de trop
/// effaçait une note sans que personne ne l'ait demandé. Maintenant que 0 n'est
/// plus une note, effacer est un geste à part, qui ne peut pas arriver par
/// dépassement d'un autre.
///
/// Silencieuse sur une case déjà vierge : l'enseignant a voulu l'absence de
/// note, et il l'obtient. Lui rendre une erreur pour un état déjà atteint
/// n'apprendrait rien.
#[tauri::command]
pub fn delete_grade(
    state: tauri::State<'_, AppState>,
    evaluation_id: String,
    student_id: String,
    competency_id: String,
) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute(
        "DELETE FROM grades
          WHERE evaluation_id = ?1 AND competency_id = ?2 AND student_id = ?3",
        params![evaluation_id, competency_id, student_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Les cases qui ne seront pas notées
// ---------------------------------------------------------------------------

/// Les cases déclarées « ne sera pas évaluée » d'une évaluation.
///
/// Lue **à côté** de `get_grades` et non fondue dedans : ce sont deux tables,
/// deux sens, et un `Grade` dont la note serait facultative redemanderait à
/// chaque lecteur de se souvenir du cas — c'est précisément ce que le palier
/// 018 a fermé en sortant « non évalué » de l'échelle.
#[tauri::command]
pub fn get_grade_waivers(
    state: tauri::State<'_, AppState>,
    evaluation_id: String,
) -> Result<Vec<GradeWaiver>, String> {
    let conn = state.conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT evaluation_id, student_id, competency_id
               FROM grade_waivers WHERE evaluation_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let waivers = stmt
        .query_map(params![evaluation_id], |row| {
            Ok(GradeWaiver {
                evaluation_id: row.get(0)?,
                student_id: row.get(1)?,
                competency_id: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(waivers)
}

/// Déclare qu'une case ne sera pas notée.
///
/// **Refuse si la case porte une note**, et ne l'efface jamais de sa propre
/// initiative : une note est une donnée, la déclaration n'en est pas une. Le
/// message dit le geste à faire, parce que l'écran le permet en deux clics.
/// Dans l'autre sens, `set_grade` lève la déclaration sans rien demander — il
/// n'y a rien à perdre de ce côté-là.
///
/// Silencieuse sur une case déjà déclarée, comme `delete_grade` l'est sur une
/// case déjà vierge : l'enseignant a voulu cet état, il l'obtient.
#[tauri::command]
pub fn set_grade_waiver(
    state: tauri::State<'_, AppState>,
    evaluation_id: String,
    student_id: String,
    competency_id: String,
) -> Result<(), String> {
    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let notee: bool = tx
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM grades
                             WHERE evaluation_id = ?1
                               AND competency_id = ?2
                               AND student_id = ?3)",
            params![evaluation_id, competency_id, student_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if notee {
        return Err("Cette case porte déjà une note. Effacez-la d'abord si cet élève                     ne doit pas être évalué sur cette compétence."
            .to_string());
    }

    tx.execute(
        "INSERT INTO grade_waivers (evaluation_id, competency_id, student_id)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(evaluation_id, competency_id, student_id) DO NOTHING",
        params![evaluation_id, competency_id, student_id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Retire la déclaration : la case redevient « en attente ».
///
/// Elle ne redevient pas notée — il n'y avait pas de note dessous, la table ne
/// pouvant pas en garder une. Silencieuse sur une case qui n'était pas
/// déclarée, même raison que `delete_grade`.
#[tauri::command]
pub fn delete_grade_waiver(
    state: tauri::State<'_, AppState>,
    evaluation_id: String,
    student_id: String,
    competency_id: String,
) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute(
        "DELETE FROM grade_waivers
          WHERE evaluation_id = ?1 AND competency_id = ?2 AND student_id = ?3",
        params![evaluation_id, competency_id, student_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

