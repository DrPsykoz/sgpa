use std::collections::HashMap;

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::db;
use crate::state::AppState;

mod scoring;

#[derive(Debug, Clone, Serialize)]
pub struct SessionReport {
    pub session_id: String,
    pub session_name: String,
    pub level_code: String,
    pub year_start: i32,
    pub trimester: i32,
    pub trimester_start: String,
    pub trimester_end: String,
    pub seance_count: i32,
    pub cancelled_count: i32,
    pub students: Vec<StudentReport>,
    pub average_rule: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StudentReport {
    pub student_id: String,
    pub student_first_name: String,
    pub student_last_name: String,
    pub competency_averages: Vec<CompetencyAverage>,
    /// `None` = aucune note. Jamais `0.0` : voir `scoring::overall_average`.
    pub overall_average: Option<f64>,
    pub attendance: AttendanceStats,
    pub teacher_comment: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompetencyAverage {
    pub competency_id: String,
    pub competency_name: String,
    pub field_name: String,
    pub domain_name: String,
    /// Moyenne des notes sur 20 de cette compétence, sur le trimestre. Le
    /// libellé de maîtrise n'est pas calculé ici : il se lit de la note, et la
    /// règle qui le lit vit en un seul endroit, `src/types/index.ts`.
    pub average_mark: f64,
    pub grade_count: i32,
}

/// Les compteurs s'additionnent exactement, et deux lignes le disent :
///
/// ```text
/// seances_applicables + hors_inscription + seances_neutralisees == seances_trimestre
/// present + absent + retard + excuse + non_renseigne            == seances_applicables
/// ```
///
/// Un bilan qui cesserait de vérifier l'une des deux serait un document faux
/// remis à une famille : c'est ce que gardent les tests de ce module.
#[derive(Debug, Clone, Serialize)]
pub struct AttendanceStats {
    pub seances_trimestre: i32,
    pub seances_applicables: i32,
    /// Séances tenues avant l'arrivée de l'élève ou après son départ.
    pub hors_inscription: i32,
    /// Séances écartées par une période d'absence justifiée — stage,
    /// hospitalisation, exclusion temporaire (table `absence_periods`).
    ///
    /// Compteur DISTINCT de `hors_inscription`, et il devait l'être : un stage
    /// de janvier rangé dans `hors_inscription` ferait imprimer « N séances
    /// hors de sa période d'inscription » sur le bilan d'un élève inscrit
    /// depuis septembre — faux deux fois.
    ///
    /// À ne pas confondre avec `excuse`, qui est un élève ABSENT EXCUSÉ sur une
    /// séance qui compte. Ici, c'est la séance elle-même qui sort du
    /// dénominateur.
    pub seances_neutralisees: i32,
    pub present: i32,
    pub absent: i32,
    pub retard: i32,
    pub excuse: i32,
    pub non_renseigne: i32,
}

/// Assiduité de TOUTE la classe en une seule requête.
///
/// Trois filtres absents de l'ancienne version, et qui donnaient des chiffres
/// rigoureusement identiques sur les bilans T1, T2 et T3 : le trimestre, les
/// séances annulées, et la période d'inscription de l'élève.
///
/// Le `LEFT JOIN` part des élèves : un élève arrivé en janvier n'a aucune séance
/// applicable au T1, il apparaît quand même avec un dénominateur de zéro plutôt
/// que de disparaître du bilan.
///
/// **Le `NOT EXISTS` du palier 005** est posé dans la clause `ON`, exactement là
/// où `enrolled_on` / `left_on` opèrent déjà : une séance couverte par une
/// période d'absence justifiée ne rejoint pas l'élève, donc elle ne compte ni au
/// dénominateur ni dans aucun des cinq statuts. Rien n'est créé ni détruit — la
/// séance, son cahier de texte et son appel restent intacts pour le reste de la
/// classe.
///
/// La sous-requête `neutralisees` compte ces mêmes séances, sur la même
/// condition et dans la même fenêtre d'inscription : elle ne peut pas diverger
/// du `NOT EXISTS`. Une séance à la fois antérieure à l'inscription ET dans une
/// période n'est donc comptée qu'une seule fois, du côté `hors_inscription` — la
/// fenêtre d'inscription est la vérité la plus ancienne.
///
/// Sur une base où aucune période n'est saisie, le `NOT EXISTS` est vrai partout
/// et la sous-requête rend zéro : pas un chiffre de bilan existant ne bouge.
///
/// **Le palier 006 ajoute une seconde condition, et corrige la première.** Une
/// `absence_periods` écarte une séance pour un élève si elle la couvre ET
/// qu'elle ne porte AUCUN suivi de stage ; un `stage_placements` écarte les
/// séances de SON élève sur SES dates, indépendamment de toute fenêtre de
/// période. Deux clauses INDÉPENDANTES, et non une imbrication : c'est la
/// seconde qui fait qu'un placement débordant la fenêtre de sa période
/// neutralise quand même, au lieu de laisser ces séances compter contre l'élève
/// en `non_fait` sans que rien ne le signale.
///
/// La règle, en une phrase : une séance sort du dénominateur d'un élève parce
/// que CET élève-là était en entreprise CE jour-là, pas parce que sa classe
/// était en stage cette semaine-là. Tant qu'aucun placement n'est saisi, la
/// table est vide, le `NOT EXISTS` imbriqué est vrai partout et le second
/// `NOT EXISTS` aussi : le comportement est celui de 005 au chiffre près, et
/// les quatre tests livrés avec lui passent sans qu'une valeur, un nom ni un
/// message ne bouge.
///
/// **⚠ LE `NOT EXISTS` IMBRIQUÉ REGARDE À QUI APPARTIENT LE PLACEMENT**, et
/// c'est portant. Un placement ne désarme une période que s'il vise un élève de
/// la classe de cette période (`sv.session_id = p.session_id`) et, quand la
/// période est NOMINATIVE, ce même élève (`sp.student_id = p.student_id`). Sans
/// ces deux conditions, le palier se retourne contre lui-même, mesuré : le
/// stage de Hugo rattaché par erreur à l'hospitalisation de Kevin désarmait
/// celle-ci, et les trois absences justifiées de Kevin réapparaissaient en
/// absences sèches sur le bilan remis à sa famille — 0 écartée / 26 applicables
/// / 6 absences au lieu de 3 / 23 / 3. Même défaut vu d'une période de CLASSE :
/// un placement d'un élève d'une AUTRE classe la désarmait pour les douze
/// élèves de celle-ci, dont aucun n'est en entreprise. Les deux faces sont
/// tenues par `un_placement_d_un_autre_eleve_ne_desarme_pas_une_periode_nominative`
/// et `un_placement_d_une_autre_classe_ne_desarme_pas_la_periode`.
///
/// Le garde-fou de saisie correspondant — un placement ne se rattache qu'à une
/// période de sa classe, et nominative seulement à celle de son élève — reste à
/// écrire EN RUST au lot 2, au titre du message d'erreur français. Cette clause
/// est ce qui garde le CALCUL juste sur une base reprise, importée, ou saisie
/// avant ce garde-fou.
///
/// **⚠ LES PARENTHÈSES DE LA SOUS-REQUÊTE SONT PORTANTES.** Le `LEFT JOIN`
/// porte deux `NOT EXISTS` conjoints ; la sous-requête `neutralisees` en est la
/// négation, donc une DISJONCTION — `NOT (A OR B) ≡ NOT A AND NOT B`. Sans les
/// parenthèses autour de `(EXISTS … OR EXISTS …)`, la précédence SQL lit
/// « (tout ce qui précède AND EXISTS A) OR EXISTS B » : la branche B perd le
/// trimestre, `cancelled`, la fenêtre d'inscription ET le filtre de classe, et
/// le compteur ramasse les séances des AUTRES classes de la base. Invisible sur
/// une base à une seule classe — d'où le test `deux_classes_en_stage_la_meme_semaine`.
///
/// Parce que c'est un seul `COUNT(*)`, une séance couverte à la fois par un
/// placement et par une période nominative est comptée UNE SEULE FOIS.
///
/// `pub(crate)` pour une seule raison : le test de migration
/// `une_base_v5_peuplee_traverse_le_palier_006_intacte` compare cette requête à
/// celle qui a été livrée au palier 005, sur une base peuplée et sans placement.
pub(crate) const ATTENDANCE_SQL: &str = "\
SELECT st.id,
       COUNT(se.id) AS applicable,
       COALESCE(SUM(ar.status = 'present'), 0) AS present,
       COALESCE(SUM(ar.status = 'absent'),  0) AS absent,
       COALESCE(SUM(ar.status = 'retard'),  0) AS retard,
       COALESCE(SUM(ar.status = 'excuse'),  0) AS excuse,
       COALESCE(SUM(se.id IS NOT NULL
                AND (ar.status IS NULL OR ar.status = 'non_fait')), 0) AS non_renseigne,
       (SELECT COUNT(*) FROM seances sx
         WHERE sx.session_id = st.session_id
           AND sx.trimester = ?2
           AND sx.cancelled = 0
           AND sx.date >= st.enrolled_on
           AND (st.left_on IS NULL OR sx.date <= st.left_on)
           AND (EXISTS (SELECT 1 FROM absence_periods p
                         WHERE p.session_id = st.session_id
                           AND (p.student_id IS NULL OR p.student_id = st.id)
                           AND sx.date BETWEEN p.start_date AND p.end_date
                           AND NOT EXISTS (SELECT 1 FROM stage_placements sp
                                             JOIN students sv ON sv.id = sp.student_id
                                            WHERE sp.absence_period_id = p.id
                                              AND sv.session_id = p.session_id
                                              AND (p.student_id IS NULL
                                                OR sp.student_id = p.student_id)))
             OR EXISTS (SELECT 1 FROM stage_placements sp
                         WHERE sp.student_id = st.id
                           AND sx.date BETWEEN sp.start_date AND sp.end_date))) AS neutralisees
  FROM students st
  LEFT JOIN seances se ON se.session_id = st.session_id
                      AND se.trimester = ?2
                      AND se.cancelled = 0
                      AND se.date >= st.enrolled_on
                      AND (st.left_on IS NULL OR se.date <= st.left_on)
                      AND NOT EXISTS (SELECT 1 FROM absence_periods p
                                       WHERE p.session_id = st.session_id
                                         AND (p.student_id IS NULL OR p.student_id = st.id)
                                         AND se.date BETWEEN p.start_date AND p.end_date
                                         AND NOT EXISTS (SELECT 1 FROM stage_placements sp
                                                           JOIN students sv ON sv.id = sp.student_id
                                                          WHERE sp.absence_period_id = p.id
                                                            AND sv.session_id = p.session_id
                                                            AND (p.student_id IS NULL
                                                              OR sp.student_id = p.student_id)))
                      AND NOT EXISTS (SELECT 1 FROM stage_placements sp
                                       WHERE sp.student_id = st.id
                                         AND se.date BETWEEN sp.start_date AND sp.end_date)
  LEFT JOIN attendance_records ar ON ar.seance_id = se.id AND ar.student_id = st.id
 WHERE st.session_id = ?1
 GROUP BY st.id";

/// Moyennes par compétence de toute la classe : une requête, pas 1 + 3N.
const AVERAGES_HEAD: &str = "\
SELECT g.student_id, c.id, c.name, f.name, d.name, AVG(g.mark), COUNT(*)
  FROM grades g
  JOIN evaluations e ON e.id = g.evaluation_id
  JOIN competencies c ON c.id = g.competency_id
  JOIN fields f ON f.id = c.field_id
  JOIN domains d ON d.id = f.domain_id
 WHERE e.session_id = ?1 AND e.trimester = ?2";

const AVERAGES_TAIL: &str = "\
 GROUP BY g.student_id, c.id
 ORDER BY d.position, f.position, c.position, c.name";

/// Notes portant sur une compétence retirée de l'évaluation depuis la saisie.
/// Ce fragment n'est ajouté que si `removed_competency_policy = 'ignore'`.
const AVERAGES_IGNORE_REMOVED: &str = "\
   AND EXISTS (SELECT 1 FROM evaluation_competencies ec
                WHERE ec.evaluation_id = g.evaluation_id
                  AND ec.competency_id = g.competency_id)";

#[tauri::command]
pub fn get_report(
    state: tauri::State<'_, AppState>,
    session_id: String,
    trimester: i32,
) -> Result<SessionReport, String> {
    if !(1..=3).contains(&trimester) {
        return Err("Le trimestre doit valoir 1, 2 ou 3.".to_string());
    }

    let conn = state.conn()?;

    let (session_name, level_code, year_start) = conn
        .query_row(
            "SELECT name, level_code, year_start FROM sessions WHERE id = ?1",
            params![session_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i32>(2)?,
                ))
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => "Classe introuvable".to_string(),
            other => other.to_string(),
        })?;

    let bounds = db::ensure_bounds(&conn, year_start).map_err(|e| e.to_string())?;
    let (trimester_start, trimester_end) = trimester_window(&conn, trimester, &bounds)?;

    let (average_rule, removed_policy) = conn
        .query_row(
            "SELECT overall_average_rule, removed_competency_policy FROM app_settings
              WHERE id = 1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let (seance_count, cancelled_count) = seance_counts(&conn, &session_id, trimester)?;

    let mut attendance = load_attendance(&conn, &session_id, trimester, seance_count)?;
    let mut averages = load_competency_averages(&conn, &session_id, trimester, &removed_policy)?;
    let mut comments = load_comments(&conn, &session_id, trimester)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, first_name, last_name FROM students
              WHERE session_id = ?1 ORDER BY last_name, first_name",
        )
        .map_err(|e| e.to_string())?;
    let roster = stmt
        .query_map(params![session_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let students = roster
        .into_iter()
        .map(|(student_id, first_name, last_name)| {
            let competency_averages = averages.remove(&student_id).unwrap_or_default();
            let overall_average = scoring::overall_average(&competency_averages, &average_rule);
            StudentReport {
                student_first_name: first_name,
                student_last_name: last_name,
                competency_averages,
                overall_average,
                attendance: attendance
                    .remove(&student_id)
                    .unwrap_or_else(|| empty_attendance(seance_count)),
                teacher_comment: comments.remove(&student_id).unwrap_or_default(),
                student_id,
            }
        })
        .collect();

    Ok(SessionReport {
        session_id,
        session_name,
        level_code,
        year_start,
        trimester,
        trimester_start,
        trimester_end,
        seance_count,
        cancelled_count,
        students,
        average_rule,
    })
}

#[tauri::command]
pub fn save_report_comment(
    state: tauri::State<'_, AppState>,
    student_id: String,
    trimester: i32,
    teacher_comment: String,
) -> Result<(), String> {
    if !(1..=3).contains(&trimester) {
        return Err("Le trimestre doit valoir 1, 2 ou 3.".to_string());
    }

    let conn = state.conn()?;
    conn.execute(
        "INSERT INTO report_comments (student_id, trimester, teacher_comment)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(student_id, trimester) DO UPDATE
            SET teacher_comment = excluded.teacher_comment,
                updated_at      = datetime('now')",
        params![student_id, trimester, teacher_comment],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------

/// Début et fin du trimestre, pour l'en-tête du bilan.
///
/// Les bornes du schéma sont CONTIGUËS : le début de T2 est la fin de T1. Sur un
/// document remis à une famille, « du 01/09 au 01/12 » puis « du 01/12 au 01/03 »
/// ferait apparaître le même jour dans deux trimestres. On affiche donc une fin
/// INCLUSE, le retrait du jour étant confié à SQLite plutôt qu'à une arithmétique
/// de dates en Rust.
fn trimester_window(
    conn: &Connection,
    trimester: i32,
    bounds: &db::TrimesterBounds,
) -> Result<(String, String), String> {
    let (start, next_start) = match trimester {
        1 => (&bounds.t1_start, Some(&bounds.t2_start)),
        2 => (&bounds.t2_start, Some(&bounds.t3_start)),
        _ => (&bounds.t3_start, None),
    };
    let end = match next_start {
        Some(next) => conn
            .query_row("SELECT date(?1, '-1 day')", params![next.as_str()], |row| {
                row.get(0)
            })
            .map_err(|e| e.to_string())?,
        // Le T3 n'a pas de trimestre suivant : sa fin est la fin de l'année.
        None => bounds.year_end.clone(),
    };
    Ok((start.clone(), end))
}

/// Dénominateur commun à toute la classe : les séances non annulées du
/// trimestre, et, à côté, les annulées.
///
/// Chaque élève en retranche ensuite ce qui précède son inscription et ce
/// qu'une période d'absence justifiée écarte. Le palier 005 ne touche PAS à ce
/// compte : une période ne supprime aucune séance, l'en-tête du bilan annonce
/// toujours le même nombre de séances au trimestre.
fn seance_counts(
    conn: &Connection,
    session_id: &str,
    trimester: i32,
) -> Result<(i32, i32), String> {
    conn.query_row(
        "SELECT COALESCE(SUM(cancelled = 0), 0), COALESCE(SUM(cancelled = 1), 0)
           FROM seances WHERE session_id = ?1 AND trimester = ?2",
        params![session_id, trimester],
        |row| Ok((row.get::<_, i32>(0)?, row.get::<_, i32>(1)?)),
    )
    .map_err(|e| e.to_string())
}

fn load_attendance(
    conn: &Connection,
    session_id: &str,
    trimester: i32,
    seance_count: i32,
) -> Result<HashMap<String, AttendanceStats>, String> {
    let mut stmt = conn.prepare(ATTENDANCE_SQL).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![session_id, trimester], |row| {
            let student_id: String = row.get(0)?;
            let applicable: i32 = row.get(1)?;
            let neutralisees: i32 = row.get(7)?;
            Ok((
                student_id,
                AttendanceStats {
                    seances_trimestre: seance_count,
                    seances_applicables: applicable,
                    // Ce qui reste une fois les séances neutralisées mises de
                    // côté : les séances tenues avant l'arrivée de l'élève ou
                    // après son départ, et elles seules. Sans ce retrait, un
                    // stage de janvier atterrirait ici, et le bilan imprimerait
                    // « hors de sa période d'inscription » à un élève inscrit
                    // depuis septembre.
                    hors_inscription: (seance_count - applicable - neutralisees).max(0),
                    seances_neutralisees: neutralisees,
                    present: row.get(2)?,
                    absent: row.get(3)?,
                    retard: row.get(4)?,
                    excuse: row.get(5)?,
                    non_renseigne: row.get(6)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out = HashMap::new();
    for row in rows {
        let (student_id, stats) = row.map_err(|e| e.to_string())?;
        out.insert(student_id, stats);
    }
    Ok(out)
}

fn load_competency_averages(
    conn: &Connection,
    session_id: &str,
    trimester: i32,
    removed_policy: &str,
) -> Result<HashMap<String, Vec<CompetencyAverage>>, String> {
    // Le fragment ajouté est un littéral choisi par ce `match` : la valeur lue en
    // base est contrainte par un CHECK et rien de ce que saisit l'enseignant
    // n'entre dans le SQL.
    let removed_filter = match removed_policy {
        "ignore" => AVERAGES_IGNORE_REMOVED,
        _ => "",
    };
    let sql = format!("{}\n{}\n{}", AVERAGES_HEAD, removed_filter, AVERAGES_TAIL);

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![session_id, trimester], |row| {
            Ok((
                row.get::<_, String>(0)?,
                CompetencyAverage {
                    competency_id: row.get(1)?,
                    competency_name: row.get(2)?,
                    field_name: row.get(3)?,
                    domain_name: row.get(4)?,
                    average_mark: row.get(5)?,
                    grade_count: row.get(6)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out: HashMap<String, Vec<CompetencyAverage>> = HashMap::new();
    for row in rows {
        let (student_id, average) = row.map_err(|e| e.to_string())?;
        out.entry(student_id).or_default().push(average);
    }
    Ok(out)
}

fn load_comments(
    conn: &Connection,
    session_id: &str,
    trimester: i32,
) -> Result<HashMap<String, String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT rc.student_id, rc.teacher_comment FROM report_comments rc
               JOIN students st ON st.id = rc.student_id
              WHERE st.session_id = ?1 AND rc.trimester = ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![session_id, trimester], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut out = HashMap::new();
    for row in rows {
        let (student_id, comment) = row.map_err(|e| e.to_string())?;
        out.insert(student_id, comment);
    }
    Ok(out)
}

/// Élève sans ligne d'assiduité : ne devrait pas arriver (la requête part des
/// élèves), mais un bilan doit sortir quoi qu'il arrive.
fn empty_attendance(seance_count: i32) -> AttendanceStats {
    AttendanceStats {
        seances_trimestre: seance_count,
        seances_applicables: 0,
        hors_inscription: seance_count,
        seances_neutralisees: 0,
        present: 0,
        absent: 0,
        retard: 0,
        excuse: 0,
        non_renseigne: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 26 séances non annulées au T2, du 5 au 30 janvier 2027, une par jour.
    /// C'est le trimestre du scénario mesuré : trois semaines de stage dessus.
    const PREMIER_JOUR: u32 = 5;
    const SEANCES: u32 = 26;
    /// Le stage : du 18 au 23 janvier inclus, soit 6 séances.
    const STAGE_DEBUT: &str = "2027-01-18";
    const STAGE_FIN: &str = "2027-01-23";

    fn migrated_db(nom: &str) -> Connection {
        let dir = std::env::temp_dir().join(format!("sgpa-bilan-{nom}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = Connection::open(dir.join("sgpa.db")).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::db::migrations::run(&mut conn, &dir).unwrap();
        conn
    }

    fn jour(n: u32) -> String {
        format!("2027-01-{:02}", PREMIER_JOUR + n)
    }

    /// Une classe, deux élèves, 26 séances et un appel déjà fait.
    ///
    /// Hugo MARTIN est présent partout SAUF pendant le stage, où l'enseignant
    /// l'a marqué `absent` — faute de mieux, c'est ce que l'application lui
    /// laissait faire. Nadia BOUMEDIENE arrive le 20 janvier : elle garde la
    /// preuve que la fenêtre d'inscription continue de fonctionner seule.
    fn peupler(conn: &Connection) {
        conn.execute_batch(
            "INSERT INTO sessions (id, name, level_code, year_start)
                  VALUES ('s1', '4ème A', '4eme', 2026)",
        )
        .unwrap();
        conn.execute_batch(
            "INSERT INTO students (id, session_id, first_name, last_name, enrolled_on)
                  VALUES ('e1', 's1', 'Hugo', 'MARTIN', '2026-09-01'),
                         ('e2', 's1', 'Nadia', 'BOUMEDIENE', '2027-01-20')",
        )
        .unwrap();

        for n in 0..SEANCES {
            let date = jour(n);
            conn.execute(
                "INSERT INTO seances (id, session_id, title, date, trimester, cancelled)
                 VALUES (?1, 's1', 'Atelier', ?2, 2, 0)",
                params![format!("c{n}"), date],
            )
            .unwrap();
            let statut = if date.as_str() >= STAGE_DEBUT && date.as_str() <= STAGE_FIN {
                "absent"
            } else {
                "present"
            };
            conn.execute(
                "INSERT INTO attendance_records (seance_id, student_id, status)
                 VALUES (?1, 'e1', ?2)",
                params![format!("c{n}"), statut],
            )
            .unwrap();
        }

        // Une séance annulée DANS la fenêtre du stage : elle ne doit compter ni
        // au dénominateur, ni parmi les séances écartées.
        conn.execute_batch(
            "INSERT INTO seances (id, session_id, title, date, trimester, cancelled)
                  VALUES ('cx', 's1', 'Sortie annulée', '2027-01-20', 2, 1)",
        )
        .unwrap();

        // Nadia : un retard et une absence excusée, tous deux dans la fenêtre du
        // stage et après son arrivée — les cinq statuts sont ainsi couverts.
        conn.execute_batch(
            "INSERT INTO attendance_records (seance_id, student_id, status)
                  VALUES ('c16', 'e2', 'retard'), ('c17', 'e2', 'excuse')",
        )
        .unwrap();
    }

    fn stats(conn: &Connection) -> HashMap<String, AttendanceStats> {
        let (seance_count, cancelled_count) = seance_counts(conn, "s1", 2).unwrap();
        assert_eq!(seance_count, 26, "26 séances non annulées au trimestre");
        assert_eq!(cancelled_count, 1);
        load_attendance(conn, "s1", 2, seance_count).unwrap()
    }

    /// Les deux invariants du contrat, vérifiés sur chaque élève de chaque test.
    fn invariants(a: &AttendanceStats) {
        assert_eq!(
            a.seances_applicables + a.hors_inscription + a.seances_neutralisees,
            a.seances_trimestre,
            "le trimestre doit se partager exactement en trois"
        );
        assert_eq!(
            a.present + a.absent + a.retard + a.excuse + a.non_renseigne,
            a.seances_applicables,
            "les cinq statuts doivent couvrir les séances applicables"
        );
    }

    fn poser_le_stage(conn: &Connection, student_id: Option<&str>) {
        conn.execute(
            "INSERT INTO absence_periods (id, session_id, student_id, reason,
                                          start_date, end_date)
             VALUES ('p1', 's1', ?1, 'Stage en entreprise', ?2, ?3)",
            params![student_id, STAGE_DEBUT, STAGE_FIN],
        )
        .unwrap();
    }

    /// LE TEST QUI PROTÈGE TOUS LES BILANS DÉJÀ IMPRIMÉS.
    ///
    /// Sur une base où aucune période n'est saisie — c'est-à-dire toutes les
    /// bases existantes au lendemain de la mise à jour — chaque chiffre est
    /// celui d'avant le palier 005, au décompte près. Le nouveau compteur vaut
    /// zéro et `hors_inscription` garde exactement son ancienne valeur.
    #[test]
    fn sans_aucune_periode_les_chiffres_ne_bougent_pas() {
        let conn = migrated_db("non-regression");
        peupler(&conn);
        let stats = stats(&conn);

        let hugo = &stats["e1"];
        assert_eq!(hugo.seances_trimestre, 26);
        assert_eq!(hugo.seances_applicables, 26);
        assert_eq!(hugo.hors_inscription, 0);
        assert_eq!(hugo.seances_neutralisees, 0);
        assert_eq!(hugo.present, 20);
        // 20/26 = 77 % : l'injustice mesurée, telle qu'elle s'imprime encore.
        assert_eq!(hugo.absent, 6);
        assert_eq!(hugo.retard, 0);
        assert_eq!(hugo.excuse, 0);
        assert_eq!(hugo.non_renseigne, 0);
        invariants(hugo);

        // Nadia arrive le 20 janvier : 15 séances du 5 au 19 lui sont
        // antérieures. C'est le chemin enrolled_on, inchangé.
        let nadia = &stats["e2"];
        assert_eq!(nadia.seances_applicables, 11);
        assert_eq!(nadia.hors_inscription, 15);
        assert_eq!(nadia.seances_neutralisees, 0);
        assert_eq!(nadia.present, 0);
        assert_eq!(nadia.retard, 1);
        assert_eq!(nadia.excuse, 1);
        assert_eq!(nadia.non_renseigne, 9);
        invariants(nadia);

        drop(conn);
    }

    /// LE SCÉNARIO MESURÉ : 26 séances, trois semaines de stage, 6 séances.
    ///
    /// Avant, l'élève sortait à 20/26 = 77 % sur le document remis à sa famille
    /// alors qu'il était exactement là où l'enseignant l'avait envoyé. Après, il
    /// sort à 20/20, et le bilan dispose du chiffre qui explique l'écart entre
    /// les 26 séances annoncées en en-tête et les 20 comptées.
    #[test]
    fn le_stage_sort_du_denominateur_sans_devenir_une_absence() {
        let conn = migrated_db("stage");
        peupler(&conn);

        let avant = stats(&conn);
        assert_eq!(avant["e1"].seances_applicables, 26);
        assert_eq!(avant["e1"].absent, 6);

        poser_le_stage(&conn, None);
        let apres = stats(&conn);

        let hugo = &apres["e1"];
        assert_eq!(
            hugo.seances_trimestre, 26,
            "l'en-tête du bilan ne bouge pas"
        );
        assert_eq!(hugo.seances_applicables, 20);
        assert_eq!(hugo.present, 20);
        assert_eq!(hugo.absent, 0, "le stage n'est plus une absence");
        assert_eq!(hugo.seances_neutralisees, 6);
        assert_eq!(
            hugo.hors_inscription, 0,
            "un stage de janvier n'est PAS une séance hors inscription"
        );
        invariants(hugo);

        // Nadia n'est inscrite que depuis le 20 : sur les 6 séances du stage,
        // 4 la concernent, les 2 autres lui restent hors inscription. Aucune
        // séance n'est comptée deux fois.
        let nadia = &apres["e2"];
        assert_eq!(nadia.hors_inscription, 15);
        assert_eq!(nadia.seances_neutralisees, 4);
        assert_eq!(nadia.seances_applicables, 7);
        assert_eq!(nadia.retard, 0, "le retard du 21 tombe dans le stage");
        assert_eq!(nadia.excuse, 0);
        assert_eq!(nadia.non_renseigne, 7);
        invariants(nadia);

        drop(conn);
    }

    /// Une période nominative ne touche qu'un élève : c'est ce qui autorise
    /// l'hospitalisation d'un seul, sans rien changer pour la classe.
    #[test]
    fn une_periode_nominative_laisse_les_autres_eleves_intacts() {
        let conn = migrated_db("nominative");
        peupler(&conn);
        poser_le_stage(&conn, Some("e1"));
        let stats = stats(&conn);

        assert_eq!(stats["e1"].seances_neutralisees, 6);
        assert_eq!(stats["e1"].seances_applicables, 20);

        let nadia = &stats["e2"];
        assert_eq!(nadia.seances_neutralisees, 0);
        assert_eq!(nadia.seances_applicables, 11);
        assert_eq!(nadia.retard, 1);
        assert_eq!(nadia.excuse, 1);
        invariants(nadia);

        drop(conn);
    }

    /// Un élève sans la moindre ligne d'assiduité doit quand même sortir un
    /// bilan qui s'additionne.
    #[test]
    fn le_repli_respecte_les_invariants() {
        let vide = empty_attendance(26);
        invariants(&vide);
        assert_eq!(vide.seances_neutralisees, 0);
    }

    // =======================================================================
    // PALIER 006 — le suivi de stage
    //
    // La fraction du palier 005, imprimée à l'envers : une période posée sur la
    // classe sort ses séances du dénominateur de TOUS les élèves, y compris de
    // celui qui n'a pas trouvé de stage et qui est resté au collège. Il sort à
    // 19/20 = 95 % au lieu de 20/26 = 77 %, et ses cinq absences, pointées à la
    // main, disparaissent du bilan remis à sa famille.
    //
    // La règle : une séance sort du dénominateur d'un élève parce que CET
    // élève-là était en entreprise CE jour-là, pas parce que sa classe était en
    // stage cette semaine-là.
    // =======================================================================

    /// Les 26 séances du T2 de la 3ème A : tous les lundis et jeudis du
    /// 4 janvier au 1er avril 2027. C'est le calendrier réel sur lequel les
    /// chiffres de ce palier ont été mesurés — pas une séance par jour, comme
    /// la fixture de 005, mais deux par semaine.
    const SEANCES_3A: [&str; 26] = [
        "2027-01-04",
        "2027-01-07",
        "2027-01-11",
        "2027-01-14",
        "2027-01-18",
        "2027-01-21",
        "2027-01-25",
        "2027-01-28",
        "2027-02-01",
        "2027-02-04",
        "2027-02-08",
        "2027-02-11",
        "2027-02-15",
        "2027-02-18",
        "2027-02-22",
        "2027-02-25",
        "2027-03-01",
        "2027-03-04",
        "2027-03-08",
        "2027-03-11",
        "2027-03-15",
        "2027-03-18",
        "2027-03-22",
        "2027-03-25",
        "2027-03-29",
        "2027-04-01",
    ];

    /// La période « Stage en entreprise » saisie sur la classe entière.
    const FENETRE_DEBUT: &str = "2027-01-18";
    const FENETRE_FIN: &str = "2027-02-05";

    /// Les 6 séances de la classe qui tombent dedans.
    const DANS_LA_FENETRE: [&str; 6] = [
        "2027-01-18",
        "2027-01-21",
        "2027-01-25",
        "2027-01-28",
        "2027-02-01",
        "2027-02-04",
    ];

    fn dans_la_fenetre(date: &str) -> bool {
        DANS_LA_FENETRE.contains(&date)
    }

    /// La seule absence commune aux quatre élèves, HORS fenêtre.
    ///
    /// Elle tient le dénominateur honnête — 19 présences sur 20, jamais 20 sur
    /// 20 — et elle prouve qu'un placement ne repeint pas les séances qu'il ne
    /// couvre pas.
    const ABSENCE_HORS_FENETRE: &str = "2027-03-11";

    /// La 3ème A du scénario mesuré : quatre élèves, quatre histoires.
    ///
    /// * BERTRAND Hugo — stage tenu de bout en bout : aucun appel sur la fenêtre.
    /// * DIALLO Kevin  — n'a PAS trouvé, reste au collège, vient 1 fois sur 6.
    /// * CHARLES Léa   — renvoyée le 22/01, revient : 2 présences, 2 absences.
    /// * FAURE Malik   — trouve en retard le 25/01 : au collège les 18 et 21,
    ///   présent les deux fois.
    ///
    /// La période de classe est posée d'emblée : c'est l'état d'une base
    /// existante, celle qui imprime aujourd'hui un chiffre faux.
    fn peupler_3a(conn: &Connection) {
        // Une instruction par littéral : sql_smoke les fait toutes préparer par
        // SQLite, et `prepare` refuse un lot multi-instructions.
        conn.execute_batch(
            "INSERT INTO sessions (id, name, level_code, year_start)
                  VALUES ('s1', '3ème A', '3eme', 2026)",
        )
        .unwrap();
        conn.execute_batch(
            "INSERT INTO students (id, session_id, first_name, last_name, enrolled_on)
                  VALUES ('hugo',  's1', 'Hugo',  'BERTRAND', '2026-09-01'),
                         ('kevin', 's1', 'Kevin', 'DIALLO',   '2026-09-01'),
                         ('lea',   's1', 'Léa',   'CHARLES',  '2026-09-01'),
                         ('malik', 's1', 'Malik', 'FAURE',    '2026-09-01')",
        )
        .unwrap();

        for (n, date) in SEANCES_3A.iter().enumerate() {
            conn.execute(
                "INSERT INTO seances (id, session_id, title, date, trimester, cancelled)
                 VALUES (?1, 's1', 'Atelier', ?2, 2, 0)",
                params![format!("d{n}"), date],
            )
            .unwrap();

            if dans_la_fenetre(date) {
                continue;
            }
            // Hors fenêtre, les quatre ont exactement le même parcours : présents
            // partout sauf une fois.
            let statut = if *date == ABSENCE_HORS_FENETRE {
                "absent"
            } else {
                "present"
            };
            for eleve in ["hugo", "kevin", "lea", "malik"] {
                conn.execute(
                    "INSERT INTO attendance_records (seance_id, student_id, status)
                     VALUES (?1, ?2, ?3)",
                    params![format!("d{n}"), eleve, statut],
                )
                .unwrap();
            }
        }

        // Dans la fenêtre, chacun son histoire. Ces lignes existent DÉJÀ dans la
        // base de l'enseignant : ce sont elles que le bug de 005 fait
        // disparaître du bilan.
        let pointages: [(&str, &str, &str); 10] = [
            // Kevin : vient le 18, sèche les cinq autres.
            ("2027-01-18", "kevin", "present"),
            ("2027-01-21", "kevin", "absent"),
            ("2027-01-25", "kevin", "absent"),
            ("2027-01-28", "kevin", "absent"),
            ("2027-02-01", "kevin", "absent"),
            ("2027-02-04", "kevin", "absent"),
            // Léa : rentrée au collège après son renvoi du 22.
            ("2027-01-25", "lea", "present"),
            ("2027-01-28", "lea", "present"),
            ("2027-02-01", "lea", "absent"),
            ("2027-02-04", "lea", "absent"),
        ];
        for (date, eleve, statut) in pointages {
            conn.execute(
                "INSERT INTO attendance_records (seance_id, student_id, status)
                 SELECT id, ?2, ?3 FROM seances WHERE session_id = 's1' AND date = ?1",
                params![date, eleve, statut],
            )
            .unwrap();
        }
        // Malik : au collège les deux premières séances, présent les deux fois.
        for date in ["2027-01-18", "2027-01-21"] {
            conn.execute(
                "INSERT INTO attendance_records (seance_id, student_id, status)
                 SELECT id, 'malik', 'present' FROM seances
                  WHERE session_id = 's1' AND date = ?1",
                params![date],
            )
            .unwrap();
        }

        conn.execute(
            "INSERT INTO absence_periods (id, session_id, student_id, reason,
                                          start_date, end_date)
             VALUES ('p1', 's1', NULL, 'Stage en entreprise', ?1, ?2)",
            params![FENETRE_DEBUT, FENETRE_FIN],
        )
        .unwrap();
    }

    /// Un suivi de stage rattaché à une période : c'est lui qui désarme la
    /// période pour toute la classe et la laisse décider élève par élève.
    fn placer(conn: &Connection, id: &str, eleve: &str, debut: &str, fin: &str) {
        conn.execute(
            "INSERT INTO stage_placements (id, absence_period_id, student_id,
                                           company_label, start_date, end_date)
             VALUES (?1, 'p1', ?2, 'Garage Bertrand', ?3, ?4)",
            params![id, eleve, debut, fin],
        )
        .unwrap();
    }

    /// L'échappatoire de 005, intacte : l'élève qui n'était pas au collège non
    /// plus se saisit comme avant, par une période nominative.
    fn hospitaliser(conn: &Connection, id: &str, eleve: &str, debut: &str, fin: &str) {
        conn.execute(
            "INSERT INTO absence_periods (id, session_id, student_id, reason,
                                          start_date, end_date)
             VALUES (?1, 's1', ?2, 'Hospitalisation', ?3, ?4)",
            params![id, eleve, debut, fin],
        )
        .unwrap();
    }

    fn stats_de(
        conn: &Connection,
        session_id: &str,
        attendu: i32,
    ) -> HashMap<String, AttendanceStats> {
        let (seance_count, _) = seance_counts(conn, session_id, 2).unwrap();
        assert_eq!(seance_count, attendu, "séances non annulées du trimestre");
        let stats = load_attendance(conn, session_id, 2, seance_count).unwrap();
        for a in stats.values() {
            invariants(a);
        }
        stats
    }

    fn stats_3a(conn: &Connection) -> HashMap<String, AttendanceStats> {
        stats_de(conn, "s1", 26)
    }

    /// Le comportement de 005, INCHANGÉ tant qu'aucun stage n'est suivi.
    ///
    /// C'est la moitié du contrat de ce palier : une base mise à jour et pas
    /// encore renseignée doit imprimer exactement ce qu'elle imprimait la
    /// veille. Les quatre élèves sont neutralisés ensemble, y compris Kevin,
    /// qui n'a pourtant jamais quitté le collège — c'est le défaut, et il est
    /// ici décrit, pas corrigé.
    #[test]
    fn la_periode_sans_placement_ecarte_encore_pour_tous() {
        let conn = migrated_db("006-sans-placement");
        peupler_3a(&conn);
        let stats = stats_3a(&conn);

        for eleve in ["hugo", "kevin", "lea", "malik"] {
            let a = &stats[eleve];
            assert_eq!(a.seances_trimestre, 26, "{eleve} : l'en-tête ne bouge pas");
            assert_eq!(a.seances_applicables, 20, "{eleve}");
            assert_eq!(a.seances_neutralisees, 6, "{eleve}");
            assert_eq!(a.hors_inscription, 0, "{eleve}");
            assert_eq!(a.present, 19, "{eleve}");
            assert_eq!(a.absent, 1, "{eleve}");
            assert_eq!(a.non_renseigne, 0, "{eleve}");
        }

        drop(conn);
    }

    /// LE CHIFFRE QUE CE PALIER CORRIGE.
    ///
    /// Kevin n'a pas trouvé de stage. Il est resté au collège et il a séché cinq
    /// séances sur six. Avant : 19/20 = 95 %, 6 séances « écartées », et le
    /// bilan remis à sa famille affiche « Absent : 1 ». Après : 20/26 = 77 %, et
    /// ses SIX absences sont là.
    #[test]
    fn l_eleve_sans_stage_recupere_ses_seances() {
        let conn = migrated_db("006-sans-stage");
        peupler_3a(&conn);
        placer(&conn, "sp1", "hugo", "2027-01-18", "2027-02-05");
        placer(&conn, "sp2", "lea", "2027-01-18", "2027-01-22");
        placer(&conn, "sp3", "malik", "2027-01-25", "2027-02-05");

        let stats = stats_3a(&conn);

        let kevin = &stats["kevin"];
        assert_eq!(
            kevin.seances_applicables, 26,
            "aucune séance ne lui est ôtée"
        );
        assert_eq!(
            kevin.seances_neutralisees, 0,
            "la période de classe ne l'écarte plus : elle porte des suivis de stage"
        );
        assert_eq!(kevin.hors_inscription, 0);
        assert_eq!(kevin.present, 20);
        assert_eq!(
            kevin.absent, 6,
            "les cinq absences de la fenêtre réapparaissent, plus celle du 11/03"
        );
        assert_eq!(kevin.non_renseigne, 0);

        // Et Hugo, qui a fait ce qu'on lui demandait, ne perd rien : le document
        // distingue de nouveau les deux.
        let hugo = &stats["hugo"];
        assert_eq!(hugo.seances_applicables, 20);
        assert_eq!(hugo.seances_neutralisees, 6);
        assert_eq!(hugo.present, 19);

        drop(conn);
    }

    /// Léa est renvoyée le 22 : à partir du 25, elle est au collège et ses
    /// séances comptent — deux présences, deux absences.
    #[test]
    fn le_renvoi_rend_les_seances_du_retour() {
        let conn = migrated_db("006-renvoi");
        peupler_3a(&conn);
        placer(&conn, "sp1", "lea", "2027-01-18", "2027-01-22");

        let lea = &stats_3a(&conn)["lea"];
        assert_eq!(
            lea.seances_neutralisees, 2,
            "seules les séances des 18 et 21 la trouvent en entreprise"
        );
        assert_eq!(lea.seances_applicables, 24);
        assert_eq!(lea.present, 21);
        assert_eq!(lea.absent, 3);
        assert_eq!(lea.non_renseigne, 0);

        drop(conn);
    }

    /// Malik ne trouve que le 25 : les 18 et 21, il était en cours, et il y
    /// était présent. Un placement n'écarte pas ce qui précède sa date de début,
    /// même si la période de la classe, elle, l'englobe.
    #[test]
    fn un_placement_commence_en_retard_ne_couvre_pas_l_avant() {
        let conn = migrated_db("006-retard");
        peupler_3a(&conn);
        placer(&conn, "sp1", "malik", "2027-01-25", "2027-02-05");

        let malik = &stats_3a(&conn)["malik"];
        assert_eq!(malik.seances_neutralisees, 4);
        assert_eq!(
            malik.seances_applicables, 22,
            "les 18 et 21 lui sont rendus"
        );
        assert_eq!(malik.present, 21);
        assert_eq!(malik.absent, 1);
        assert_eq!(malik.non_renseigne, 0);

        drop(conn);
    }

    /// Le patron accorde une semaine de plus : le stage finit le 11/02, la
    /// période s'arrête le 05. Les séances des 08 et 11 sortent QUAND MÊME du
    /// dénominateur.
    ///
    /// C'est ce qu'achète la clause INDÉPENDANTE. Imbriquée dans la fenêtre de
    /// la période, elle aurait laissé ces deux séances compter contre lui, en
    /// `non_fait`, sans que rien ne le signale — le bug de 005 recréé sur les
    /// bords.
    #[test]
    fn un_placement_qui_deborde_la_periode_neutralise_quand_meme() {
        let conn = migrated_db("006-debordement");
        peupler_3a(&conn);
        placer(&conn, "sp1", "hugo", "2027-01-18", "2027-02-11");

        let hugo = &stats_3a(&conn)["hugo"];
        assert_eq!(
            hugo.seances_neutralisees, 8,
            "les 6 de la fenêtre + 08 et 11/02"
        );
        assert_eq!(hugo.seances_applicables, 18);
        assert_eq!(hugo.hors_inscription, 0);
        assert_eq!(hugo.present, 17);
        assert_eq!(hugo.absent, 1);
        assert_eq!(hugo.non_renseigne, 0);

        drop(conn);
    }

    /// Hugo est en stage, et hospitalisé quatre jours au milieu. Les deux
    /// prédicats couvrent les mêmes séances : elles sont comptées UNE FOIS.
    ///
    /// C'est un seul `COUNT(*)` sur une disjonction, pas deux compteurs
    /// additionnés — 6, jamais 8. Sans quoi le bilan annoncerait plus de séances
    /// écartées qu'il n'y en a dans le trimestre.
    #[test]
    fn hospitalisation_pendant_un_stage_comptee_une_fois() {
        let conn = migrated_db("006-double-couverture");
        peupler_3a(&conn);
        placer(&conn, "sp1", "hugo", "2027-01-18", "2027-02-05");
        hospitaliser(&conn, "p2", "hugo", "2027-01-25", "2027-01-28");

        let hugo = &stats_3a(&conn)["hugo"];
        assert_eq!(hugo.seances_neutralisees, 6, "6, et surtout pas 8");
        assert_eq!(hugo.seances_applicables, 20);
        assert_eq!(hugo.present, 19);
        assert_eq!(hugo.absent, 1);

        drop(conn);
    }

    /// L'ÉCHAPPATOIRE, ET ELLE NE COÛTE PAS UNE LIGNE DE PLUS.
    ///
    /// Kevin n'a pas trouvé de stage ET n'était pas au collège — hospitalisé,
    /// renvoyé chez lui. L'enseignant saisit une période NOMINATIVE, exactement
    /// comme depuis 005 : elle ne porte aucun placement, donc elle neutralise.
    #[test]
    fn une_periode_nominative_neutralise_l_eleve_sans_stage() {
        let conn = migrated_db("006-nominative");
        peupler_3a(&conn);
        placer(&conn, "sp1", "hugo", "2027-01-18", "2027-02-05");
        placer(&conn, "sp2", "lea", "2027-01-18", "2027-01-22");
        placer(&conn, "sp3", "malik", "2027-01-25", "2027-02-05");
        hospitaliser(&conn, "p2", "kevin", "2027-01-25", "2027-02-01");

        let kevin = &stats_3a(&conn)["kevin"];
        assert_eq!(kevin.seances_neutralisees, 3, "les 25, 28 et 01/02");
        assert_eq!(kevin.seances_applicables, 23);
        assert_eq!(kevin.present, 20);
        assert_eq!(kevin.absent, 3, "le 21/01, le 04/02 et le 11/03");
        assert_eq!(kevin.non_renseigne, 0);

        drop(conn);
    }

    /// GARDE-FOU QUE LES INVARIANTS NE DONNENT PAS.
    ///
    /// `hors_inscription` est calculé par SOUSTRACTION et clampé à zéro : tant
    /// qu'il reste du mou, un sur-comptage de `seances_neutralisees` y est
    /// absorbé en silence, le total continue de faire 26 et `invariants()` passe
    /// en souriant. Il faut donc asserter `hors_inscription` sur un élève dont
    /// la date d'inscription est connue.
    ///
    /// Nadia arrive le 20 janvier. Son placement commence le 18 : les séances
    /// des 04, 07, 11, 14 et 18 janvier sont HORS INSCRIPTION et le restent. Si
    /// la sous-requête oubliait `enrolled_on` sur la branche du placement, le
    /// 18/01 basculerait du bon côté et `hors_inscription` tomberait à 4 — sur
    /// le bilan, « 4 séances hors de sa période d'inscription » au lieu de 5.
    #[test]
    fn le_placement_ne_ressuscite_pas_une_seance_hors_inscription() {
        let conn = migrated_db("006-hors-inscription");
        peupler_3a(&conn);
        conn.execute_batch(
            "INSERT INTO students (id, session_id, first_name, last_name, enrolled_on)
                  VALUES ('nadia', 's1', 'Nadia', 'BOUMEDIENE', '2027-01-20')",
        )
        .unwrap();
        placer(&conn, "sp1", "nadia", "2027-01-18", "2027-02-05");

        let nadia = &stats_3a(&conn)["nadia"];
        assert_eq!(
            nadia.hors_inscription, 5,
            "le 18/01 précède son arrivée : il ne devient pas une séance de stage"
        );
        assert_eq!(nadia.seances_neutralisees, 5, "du 21/01 au 04/02");
        assert_eq!(nadia.seances_applicables, 16);
        assert_eq!(nadia.non_renseigne, 16);

        drop(conn);
    }

    /// LE SEUL TEST QUI ATTRAPE LE PIÈGE DES PARENTHÈSES.
    ///
    /// Dans la sous-requête `neutralisees`, les parenthèses autour de
    /// `(EXISTS … OR EXISTS …)` sont portantes. Sans elles, la précédence SQL
    /// lit « (tout ce qui précède AND EXISTS A) OR EXISTS B » : la branche du
    /// placement perd le trimestre, `cancelled`, la fenêtre d'inscription ET le
    /// filtre de classe, et le compteur ramasse les séances des AUTRES classes.
    ///
    /// Invisible sur une base à une seule classe — et un enseignant de SEGPA en
    /// a plusieurs, qui partent en stage la même semaine. Ici, la 4ème B pose
    /// huit séances dans la fenêtre, dont une annulée et une rangée au T3 : sans
    /// les parenthèses, Hugo sortirait à 14 séances écartées sur un trimestre
    /// qui n'en compte que 26.
    #[test]
    fn deux_classes_en_stage_la_meme_semaine() {
        let conn = migrated_db("006-deux-classes");
        peupler_3a(&conn);

        conn.execute_batch(
            "INSERT INTO sessions (id, name, level_code, year_start)
                  VALUES ('s2', '4ème B', '4eme', 2026)",
        )
        .unwrap();
        conn.execute_batch(
            "INSERT INTO students (id, session_id, first_name, last_name, enrolled_on)
                  VALUES ('zoe', 's2', 'Zoé', 'NGUYEN', '2026-09-01')",
        )
        .unwrap();
        conn.execute_batch(
            "INSERT INTO seances (id, session_id, title, date, trimester, cancelled)
                  VALUES ('b0', 's2', 'Atelier', '2027-01-18', 2, 0),
                         ('b1', 's2', 'Atelier', '2027-01-21', 2, 0),
                         ('b2', 's2', 'Atelier', '2027-01-25', 2, 0),
                         ('b3', 's2', 'Atelier', '2027-01-28', 2, 0),
                         ('b4', 's2', 'Atelier', '2027-02-01', 2, 0),
                         ('b5', 's2', 'Atelier', '2027-02-04', 2, 0),
                         ('bx', 's2', 'Sortie annulée', '2027-01-25', 2, 1),
                         ('bt', 's2', 'Atelier', '2027-01-28', 3, 0)",
        )
        .unwrap();
        conn.execute_batch(
            "INSERT INTO absence_periods (id, session_id, student_id, reason,
                                          start_date, end_date)
                  VALUES ('p9', 's2', NULL, 'Stage en entreprise',
                          '2027-01-18', '2027-02-05')",
        )
        .unwrap();
        conn.execute_batch(
            "INSERT INTO stage_placements (id, absence_period_id, student_id,
                                           company_label, start_date, end_date)
                  VALUES ('sp9', 'p9', 'zoe', 'Boulangerie Durand',
                          '2027-01-18', '2027-02-05')",
        )
        .unwrap();

        placer(&conn, "sp1", "hugo", "2027-01-18", "2027-02-05");

        let hugo = &stats_3a(&conn)["hugo"];
        assert_eq!(
            hugo.seances_neutralisees, 6,
            "les 6 séances de SA classe, jamais celles de la 4ème B"
        );
        assert_eq!(hugo.seances_applicables, 20);
        assert_eq!(hugo.hors_inscription, 0);

        // Et symétriquement, la 4ème B ne ramasse pas la 3ème A.
        let zoe = &stats_de(&conn, "s2", 6)["zoe"];
        assert_eq!(zoe.seances_neutralisees, 6);
        assert_eq!(zoe.seances_applicables, 0);
        assert_eq!(zoe.hors_inscription, 0);

        drop(conn);
    }

    /// LE PALIER 006, RETOURNÉ CONTRE LUI-MÊME — première face.
    ///
    /// Le `NOT EXISTS` qui désarme une période ne regardait pas à QUI
    /// appartenait le placement : n'importe quel placement rattaché à la
    /// période la désarmait. Une période **nominative** — l'hospitalisation de
    /// Kevin, saisie à la main — se retrouvait ainsi désarmée par le stage de
    /// Hugo, et les trois absences justifiées de Kevin réapparaissaient en
    /// absences sèches sur le bilan remis à sa famille. Exactement le mode
    /// d'échec que ce palier prétend corriger, à l'envers.
    ///
    /// Mesuré avant la correction : Kevin passait de 3 écartées / 23
    /// applicables / 3 absences à 0 écartée / 26 applicables / **6 absences**.
    ///
    /// C'est `une_periode_nominative_neutralise_l_eleve_sans_stage`, plus UNE
    /// ligne : le second stage de Hugo, rattaché par erreur à l'hospitalisation
    /// de Kevin au lieu de la période de la classe. Aucune commande ne sait
    /// écrire cette ligne aujourd'hui ; elle le deviendra le jour où le lot 2
    /// livrera la création de placements, et le garde-fou en Rust devra la
    /// refuser — ce test tient la clause SQL en attendant, et après.
    #[test]
    fn un_placement_d_un_autre_eleve_ne_desarme_pas_une_periode_nominative() {
        let conn = migrated_db("006-desarmement-nominatif");
        peupler_3a(&conn);
        placer(&conn, "sp1", "hugo", "2027-01-18", "2027-02-05");
        placer(&conn, "sp2", "lea", "2027-01-18", "2027-01-22");
        placer(&conn, "sp3", "malik", "2027-01-25", "2027-02-05");
        hospitaliser(&conn, "p2", "kevin", "2027-01-25", "2027-02-01");

        conn.execute_batch(
            "INSERT INTO stage_placements (id, absence_period_id, student_id,
                                           company_label, start_date, end_date)
                  VALUES ('sp4', 'p2', 'hugo', 'Boulangerie Durand',
                          '2027-02-08', '2027-02-11')",
        )
        .unwrap();

        let stats = stats_3a(&conn);

        let kevin = &stats["kevin"];
        assert_eq!(
            kevin.seances_neutralisees, 3,
            "l'hospitalisation de Kevin ne se désarme pas sur le stage d'un autre"
        );
        assert_eq!(kevin.seances_applicables, 23);
        assert_eq!(
            kevin.absent, 3,
            "les absences des 25, 28 et 01/02 restent justifiées"
        );
        assert_eq!(kevin.present, 20);

        // Et les deux stages de Hugo écartent bien SES séances, par leur propre
        // branche : la période à laquelle ils sont rattachés n'y est pour rien.
        let hugo = &stats["hugo"];
        assert_eq!(
            hugo.seances_neutralisees, 8,
            "6 du premier stage, 2 du second"
        );
        assert_eq!(hugo.seances_applicables, 18);

        drop(conn);
    }

    /// LE PALIER 006, RETOURNÉ CONTRE LUI-MÊME — seconde face.
    ///
    /// Même défaut, vu depuis une période de CLASSE : un placement d'un élève
    /// d'une AUTRE classe, rattaché à la période de la 3ème A, la désarmait
    /// pour les douze élèves de la 3ème A, dont aucun n'est en entreprise. Le
    /// stage de toute la classe redevenait six absences non renseignées.
    ///
    /// Mesuré avant la correction : Hugo passait de 6 écartées / 20 applicables
    /// à 0 écartée / 26 applicables.
    #[test]
    fn un_placement_d_une_autre_classe_ne_desarme_pas_la_periode() {
        let conn = migrated_db("006-desarmement-autre-classe");
        peupler_3a(&conn);

        conn.execute_batch(
            "INSERT INTO sessions (id, name, level_code, year_start)
                  VALUES ('s2', '4ème B', '4eme', 2026)",
        )
        .unwrap();
        conn.execute_batch(
            "INSERT INTO students (id, session_id, first_name, last_name, enrolled_on)
                  VALUES ('zoe', 's2', 'Zoé', 'NGUYEN', '2026-09-01')",
        )
        .unwrap();
        // Zoé est en 4ème B ; son placement est rattaché à la période de la
        // 3ème A. La 3ème A, elle, n'a pas un seul suivi de stage saisi.
        conn.execute_batch(
            "INSERT INTO stage_placements (id, absence_period_id, student_id,
                                           company_label, start_date, end_date)
                  VALUES ('sp9', 'p1', 'zoe', 'Boulangerie Durand',
                          '2027-01-18', '2027-02-05')",
        )
        .unwrap();

        let stats = stats_3a(&conn);
        for eleve in ["hugo", "kevin", "lea", "malik"] {
            let a = &stats[eleve];
            assert_eq!(
                a.seances_neutralisees, 6,
                "la période de la 3ème A ne se désarme pas sur un placement de la 4ème B"
            );
            assert_eq!(a.seances_applicables, 20);
        }
        assert_eq!(stats["hugo"].present, 19);
        assert_eq!(stats["hugo"].absent, 1, "la seule absence hors fenêtre");

        drop(conn);
    }
}
