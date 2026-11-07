//! Page d'accueil : la journée, les jours à venir, et ce qui reste à faire.
//!
//! Deux commandes, et la coupure n'est pas cosmétique.
//!
//!   * `get_upcoming_days` est de l'emploi du temps, et ne calcule rien que
//!     `timetable::day_schedule` ne sache déjà faire : elle l'appelle, jour
//!     après jour, en sautant le samedi et le dimanche. Une seconde
//!     implémentation de la journée aurait divergé au premier créneau à
//!     quinzaine — ou aux premières vacances.
//!
//!   * `get_home_overview` est le relevé de ce qui manque, et ne lit que le
//!     **passé**. La borne est `date < today`, stricte : une séance
//!     d'aujourd'hui dont l'appel n'est pas fait n'est pas un oubli, c'est un
//!     cours qui n'a peut-être pas encore eu lieu. Un tableau de bord qui
//!     réclame l'appel d'un cours de 16 h à 8 h du matin apprend à se faire
//!     ignorer, et emporte avec lui les rappels qui, eux, étaient justes.
//!
//! Aucun rappel ne vient d'un seuil ou d'une estimation : chacun est un fait
//! vérifiable dans la base — l'appel est incomplet ou il ne l'est pas, le
//! cahier de texte est vide ou il ne l'est pas. Et chaque groupe porte son
//! dénominateur (`scope`), parce que « 7 appels incomplets » n'a pas le même
//! sens sur 12 séances que sur 180.
//!
//! Les groupes sont rendus **tous les six, même vides**. Un groupe absent et un
//! groupe à zéro ne disent pas la même chose : le premier laisse croire que
//! l'application n'a pas regardé, le second affirme qu'elle a regardé et que
//! tout est à jour. C'est précisément ce qu'on veut lire un dimanche soir.
//!
//! ⚠ « Visite de stage non remplie » n'est PAS un groupe de cette liste, et
//! l'absence est assumée : aucune commande ne sait encore créer un
//! `stage_placement` (voir l'avertissement en tête du palier 006), donc
//! `agenda_entries.stage_placement_id` vaut NULL partout et le groupe serait
//! vide par construction — un rappel qui ne se déclenche jamais est un mensonge
//! tranquille. Le relevé rend à la place `compte_rendu_manquant`, qui compte
//! toutes les entrées d'agenda passées restées vides ; les visites de stage en
//! seront un sous-ensemble le jour où elles existeront, et l'item porte déjà
//! `is_stage_visit` pour que l'affichage les distingue sans nouvelle requête.

use chrono::{Datelike, Days, NaiveDate, Weekday};
use rusqlite::{params, Connection};
use serde::Serialize;

use crate::commands::timetable::{day_schedule, parse_date, year_start_for, DaySchedule};
use crate::db;
use crate::state::AppState;

/// Jours ouvrés rendus au plus par `get_upcoming_days`.
///
/// Dix, c'est deux semaines de cours : de quoi préparer la semaine en cours et
/// la suivante, ce qui est exactement la demande. Au-delà, chaque jour coûte
/// les sept requêtes de `day_schedule` pour une carte que personne ne lit.
const MAX_DAYS: i64 = 10;

/// Cas nommément listés par groupe de rappel.
///
/// Le compte complet, lui, est toujours rendu (`count`) : la liste se coupe,
/// le constat non. Cinq lignes tiennent dans une carte sans la faire défiler,
/// et « et 23 autres » est une information plus utile que vingt-huit lignes
/// qu'on survolera sans en traiter une seule.
const ITEM_LIMIT: usize = 5;

// ---------------------------------------------------------------------------
// Les six natures de rappel
// ---------------------------------------------------------------------------
//
// Des constantes et non des littéraux dispersés : ces chaînes sont le contrat
// avec le front, qui choisit une icône et une phrase d'après elles. Un `kind`
// mal orthographié d'un côté produirait une carte muette, sans erreur.

const KIND_APPEL: &str = "appel_incomplet";
const KIND_CAHIER: &str = "cahier_vide";
const KIND_ANNULEE: &str = "annulee_sans_motif";
const KIND_EVAL_NOTES: &str = "evaluation_incomplete";
const KIND_EVAL_COMPETENCES: &str = "evaluation_sans_competence";
const KIND_AGENDA: &str = "compte_rendu_manquant";

// ---------------------------------------------------------------------------
// Types renvoyés au front
// ---------------------------------------------------------------------------

/// Un cas précis à traiter, avec juste ce qu'il faut pour l'afficher et pour y
/// aller.
///
/// Rien de rédigé ici : ni « 14 appels sur 18 », ni « il manque 3 notes ». Le
/// backend rend les nombres, le front rend la phrase. C'est la même raison qui
/// veut que le trimestre soit calculé en Rust et les dates mises en forme en
/// TypeScript : une phrase française assemblée en deux endroits finit par
/// exister en deux versions.
#[derive(Debug, Clone, Serialize)]
pub struct ReminderItem {
    pub id: String,
    pub title: String,
    pub date: String,
    /// Classe concernée, quand le rappel en a une. Un rendez-vous peut n'en
    /// nommer aucune — une réunion de secteur, un rendez-vous de médecine
    /// scolaire —, et reste alors un rappel sans classe.
    ///
    /// ⚠ Renseignée n'implique PAS « cliquable » : `reminderHref` exige aussi un
    /// onglet, et le compte rendu d'un rendez-vous n'en a pas. Il s'ouvre à
    /// l'accueil même quand sa classe est connue, parce qu'aucun écran de classe
    /// ne liste les rendez-vous.
    pub session_id: Option<String>,
    pub session_name: Option<String>,
    /// Élève concerné, quand le rappel est nominatif — aujourd'hui les seules
    /// entrées d'agenda rattachées à un élève.
    pub student_name: Option<String>,
    /// Vrai si l'entrée d'agenda est rattachée à un placement de stage. Toujours
    /// faux tant qu'aucune commande ne crée de placement : voir l'en-tête.
    pub is_stage_visit: bool,
    /// Avancement, quand le rappel en a un : 14 appels faits sur 18, 32 notes
    /// saisies sur 45. `None` pour les rappels binaires (cahier vide ou non).
    pub done: Option<i32>,
    pub total: Option<i32>,
}

/// Une nature de rappel : combien de cas, sur combien de possibles, et les
/// premiers d'entre eux.
#[derive(Debug, Clone, Serialize)]
pub struct ReminderGroup {
    /// L'une des six constantes `KIND_*`.
    pub kind: String,
    /// Nombre total de cas. **Pas** `items.len()` : la liste est tronquée à
    /// `ITEM_LIMIT`, le compte jamais.
    pub count: i32,
    /// Dénominateur : combien d'objets de cette nature le passé contient.
    /// Zéro signifie « rien de comparable encore », pas « aucun problème ».
    pub scope: i32,
    pub items: Vec<ReminderItem>,
}

/// L'état de l'année tel que l'accueil l'affiche.
#[derive(Debug, Clone, Serialize)]
pub struct HomeOverview {
    /// Le jour reçu, renvoyé tel quel : l'écran et le relevé parlent du même
    /// jour, et c'est vérifiable à l'œil nu.
    pub today: String,
    pub year_start: i32,
    /// Trimestre du jour, calculé ici. Le front ne recalcule jamais un
    /// trimestre.
    pub trimester: i32,
    pub trimester_start: String,
    pub trimester_end: String,
    /// Jours restants jusqu'à la fin du trimestre, bornes comprises.
    ///
    /// **Peut être négatif** : les bornes par défaut arrêtent l'année au 7
    /// juillet, et une séance de rattrapage du 15 juillet reste en T3. Le front
    /// affiche alors « terminé », il ne cache pas la valeur. `None` seulement si
    /// la borne enregistrée n'est pas une date lisible, ce que le CHECK du
    /// schéma rend déjà impossible — mais une lecture ne panique pas.
    pub trimester_days_left: Option<i64>,
    /// Les six groupes, dans l'ordre d'affichage, vides compris.
    pub groups: Vec<ReminderGroup>,
}

// ---------------------------------------------------------------------------
// Requêtes
// ---------------------------------------------------------------------------

/// Toutes les séances passées de l'année scolaire, annulées comprises.
///
/// **Une seule requête pour trois rappels.** Appel incomplet, cahier de texte
/// vide et annulation sans motif se lisent dans les mêmes lignes ; trois
/// requêtes auraient parcouru trois fois la même table, et surtout auraient
/// laissé trois occasions d'écrire trois fenêtres d'inscription légèrement
/// différentes.
///
/// Les deux sous-requêtes de comptage sont celles de `SEANCES_DE_LA_PERIODE`
/// dans `timetable.rs`, au caractère près : c'est la même paire `18/20` que
/// l'emploi du temps affiche en pastille. Deux définitions de « appel terminé »
/// se contrediraient d'un écran à l'autre, et l'enseignant refaisait l'appel.
///
/// Les deux dernières colonnes disent pourquoi un cahier vide peut ne pas être
/// un oubli — déclaré sans contenu, ou documenté par une pièce jointe. Elles
/// sont lues ici, dans la même ligne, plutôt que par deux requêtes de plus sur
/// les identifiants retenus : le filtrage se ferait alors après la troncature à
/// `ITEM_LIMIT`, et le `count` du groupe compterait des séances qu'il ne faut
/// pas réclamer. Ajoutées **à la fin** du SELECT, les indices de `row.get`
/// étant codés en dur.
///
/// « Vide » n'est pas `= ''`, et le détour par deux `REPLACE` n'est pas une
/// coquetterie : l'éditeur rend `<p></p>` pour un document vide, et un
/// `<p></p>` de plus par ligne laissée blanche. Un cahier rempli puis effacé
/// repartait donc avec un paragraphe vide, que `= ''` ne voyait pas — la liste
/// des séances le marquait « vide » (`hasContent` dans `SeancesTab.tsx`)
/// pendant que l'accueil le déclarait fait. Deux définitions du même mot sur
/// deux écrans, exactement ce que l'en-tête des sous-requêtes d'appel
/// interdit. Le même détour s'applique aux entrées d'agenda, qui passent par le
/// même éditeur.
const SEANCES_PASSEES: &str = "\
SELECT se.id, se.title, se.date, se.session_id, s.name,
       se.cancelled, TRIM(se.cancel_reason) = '',
       TRIM(REPLACE(REPLACE(se.content_html, '<br>', ''), '<p></p>', '')) = '',
       (SELECT COUNT(*) FROM students st
         WHERE st.session_id = se.session_id
           AND st.enrolled_on <= se.date
           AND (st.left_on IS NULL OR se.date <= st.left_on)),
       (SELECT COUNT(*) FROM attendance_records ar
          JOIN students sa ON sa.id = ar.student_id
         WHERE ar.seance_id = se.id
           AND ar.status <> 'non_fait'
           AND sa.enrolled_on <= se.date
           AND (sa.left_on IS NULL OR se.date <= sa.left_on)),
       se.content_waived_at IS NOT NULL,
       EXISTS (SELECT 1 FROM seance_attachments sat WHERE sat.seance_id = se.id)
  FROM seances se
  JOIN sessions s ON s.id = se.session_id
 WHERE s.year_start = ?1 AND se.date < ?2
 ORDER BY se.date DESC, se.start_time, se.title";

/// Toutes les évaluations passées de l'année, avec de quoi dire si elles sont
/// complètes.
///
/// Le dénominateur est un produit : autant de notes attendues que de
/// compétences rattachées × élèves inscrits le jour de l'évaluation. Compter
/// les élèves de la classe aujourd'hui aurait réclamé des notes à un élève
/// arrivé en février pour un devoir de novembre — c'est la même fenêtre
/// `enrolled_on` / `left_on` que `reports::ATTENDANCE_SQL`.
///
/// Deux restrictions sur le numérateur, chacune pour une raison :
///   * la compétence doit être ENCORE rattachée — sinon une compétence retirée
///     de l'évaluation laisserait ses notes gonfler le numérateur au-dessus du
///     dénominateur, et l'évaluation serait « complète à 112 % ».
///   * l'élève doit être inscrit ce jour-là, pour que les deux termes de la
///     fraction parlent de la même population.
///
/// Il y en avait une troisième, `g.level > 0`, et le palier 018 l'a rendue
/// inutile : « pas de note » n'est plus un niveau de l'échelle, c'est l'absence
/// de ligne. Compter les lignes compte donc exactement les notes, et une grille
/// ouverte puis refermée sans rien saisir n'en crée aucune.
const EVALUATIONS_PASSEES: &str = "\
SELECT e.id, e.title, e.date, e.session_id, s.name,
       (SELECT COUNT(*) FROM evaluation_competencies ec
         WHERE ec.evaluation_id = e.id),
       (SELECT COUNT(*) FROM students st
         WHERE st.session_id = e.session_id
           AND st.enrolled_on <= e.date
           AND (st.left_on IS NULL OR e.date <= st.left_on)),
       (SELECT COUNT(*) FROM grades g
          JOIN students sg ON sg.id = g.student_id
         WHERE g.evaluation_id = e.id
           AND sg.enrolled_on <= e.date
           AND (sg.left_on IS NULL OR e.date <= sg.left_on)
           AND EXISTS (SELECT 1 FROM evaluation_competencies ec
                        WHERE ec.evaluation_id = e.id
                          AND ec.competency_id = g.competency_id))
  FROM evaluations e
  JOIN sessions s ON s.id = e.session_id
 WHERE s.year_start = ?1 AND e.date < ?2
 ORDER BY e.date DESC, e.title";

/// Les entrées datées passées de l'année scolaire.
///
/// Filtrées par **plage de dates** et non par classe, et ce n'est plus faute de
/// colonne depuis le palier 016 : un rendez-vous peut ne nommer aucune classe —
/// une réunion de secteur, une formation, un rendez-vous de médecine scolaire —,
/// et filtrer par classe ferait disparaître du relevé exactement les comptes
/// rendus que personne d'autre ne réclame. La fenêtre part donc du 1er août,
/// jour où `year_start_for` fait basculer l'année scolaire, et s'arrête à hier.
const ENTREES_PASSEES: &str = "\
SELECT ae.id, ae.title, ae.date,
       TRIM(REPLACE(REPLACE(ae.content_html, '<br>', ''), '<p></p>', '')) = '',
       ae.stage_placement_id IS NOT NULL,
       st.first_name, st.last_name,
       ae.session_id, s.name,
       ae.content_waived_at IS NOT NULL,
       EXISTS (SELECT 1 FROM agenda_entry_attachments aat WHERE aat.entry_id = ae.id)
  FROM agenda_entries ae
  LEFT JOIN students st ON st.id = ae.student_id
  LEFT JOIN sessions s  ON s.id  = ae.session_id
 WHERE ae.date >= ?1 AND ae.date < ?2
 ORDER BY ae.date DESC, ae.start_time, ae.title";

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

/// Une ligne de `SEANCES_PASSEES`, nommée pour que la suite se lise.
struct PastSeance {
    id: String,
    title: String,
    date: String,
    session_id: String,
    session_name: String,
    cancelled: bool,
    reason_missing: bool,
    content_missing: bool,
    /// L'enseignant a déclaré qu'il n'y avait rien à écrire.
    content_waived: bool,
    /// Au moins une pièce jointe. Une photo du tableau documente la séance
    /// aussi bien qu'un paragraphe tapé.
    has_attachment: bool,
    enrolled: i32,
    marked: i32,
}

/// Une ligne d'`EVALUATIONS_PASSEES`.
struct PastEvaluation {
    id: String,
    title: String,
    date: String,
    session_id: String,
    session_name: String,
    competencies: i32,
    students: i32,
    graded: i32,
}

/// Une ligne d'`ENTREES_PASSEES`.
struct PastEntry {
    id: String,
    title: String,
    date: String,
    content_missing: bool,
    /// L'enseignant a déclaré qu'il n'y avait rien à écrire.
    content_waived: bool,
    /// Au moins une pièce jointe. Le rapport de visite signé, scanné et joint
    /// EST le compte rendu ; le retaper à côté n'apprendrait rien à personne.
    has_attachment: bool,
    is_stage_visit: bool,
    student_name: Option<String>,
    session_id: Option<String>,
    session_name: Option<String>,
}

fn map_past_seance(row: &rusqlite::Row<'_>) -> rusqlite::Result<PastSeance> {
    Ok(PastSeance {
        id: row.get(0)?,
        title: row.get(1)?,
        date: row.get(2)?,
        session_id: row.get(3)?,
        session_name: row.get(4)?,
        cancelled: row.get(5)?,
        reason_missing: row.get(6)?,
        content_missing: row.get(7)?,
        enrolled: row.get(8)?,
        marked: row.get(9)?,
        content_waived: row.get(10)?,
        has_attachment: row.get(11)?,
    })
}

fn map_past_evaluation(row: &rusqlite::Row<'_>) -> rusqlite::Result<PastEvaluation> {
    Ok(PastEvaluation {
        id: row.get(0)?,
        title: row.get(1)?,
        date: row.get(2)?,
        session_id: row.get(3)?,
        session_name: row.get(4)?,
        competencies: row.get(5)?,
        students: row.get(6)?,
        graded: row.get(7)?,
    })
}

fn map_past_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<PastEntry> {
    let first: Option<String> = row.get(5)?;
    let last: Option<String> = row.get(6)?;
    Ok(PastEntry {
        id: row.get(0)?,
        title: row.get(1)?,
        date: row.get(2)?,
        content_missing: row.get(3)?,
        is_stage_visit: row.get(4)?,
        // Les deux colonnes viennent du même LEFT JOIN : elles sont présentes
        // ensemble ou absentes ensemble.
        student_name: match (first, last) {
            (Some(first), Some(last)) => Some(format!("{first} {last}")),
            _ => None,
        },
        session_id: row.get(7)?,
        session_name: row.get(8)?,
        content_waived: row.get(9)?,
        has_attachment: row.get(10)?,
    })
}

fn collect<T, F>(
    conn: &Connection,
    sql: &str,
    args: &[&dyn rusqlite::ToSql],
    map: F,
) -> Result<Vec<T>, String>
where
    F: Fn(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
{
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(args, map).map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<T>>>()
        .map_err(|e| e.to_string())
}

/// Assemble un groupe : le compte AVANT la troncature, la liste après.
fn group(kind: &str, scope: usize, items: Vec<ReminderItem>) -> ReminderGroup {
    ReminderGroup {
        kind: kind.to_string(),
        count: items.len() as i32,
        scope: scope as i32,
        items: items.into_iter().take(ITEM_LIMIT).collect(),
    }
}

fn seance_item(seance: &PastSeance, done: Option<i32>, total: Option<i32>) -> ReminderItem {
    ReminderItem {
        id: seance.id.clone(),
        title: seance.title.clone(),
        date: seance.date.clone(),
        session_id: Some(seance.session_id.clone()),
        session_name: Some(seance.session_name.clone()),
        student_name: None,
        is_stage_visit: false,
        done,
        total,
    }
}

fn evaluation_item(eval: &PastEvaluation, done: Option<i32>, total: Option<i32>) -> ReminderItem {
    ReminderItem {
        id: eval.id.clone(),
        title: eval.title.clone(),
        date: eval.date.clone(),
        session_id: Some(eval.session_id.clone()),
        session_name: Some(eval.session_name.clone()),
        student_name: None,
        is_stage_visit: false,
        done,
        total,
    }
}

/// Les trois rappels que les séances portent.
fn seance_groups(
    conn: &Connection,
    year_start: i32,
    today: &str,
) -> Result<Vec<ReminderGroup>, String> {
    let seances = collect(
        conn,
        SEANCES_PASSEES,
        params![year_start, today],
        map_past_seance,
    )?;

    // Trois dénominateurs distincts, et c'est le point : une séance annulée n'a
    // ni appel ni cahier de texte à faire, elle ne doit donc pas alourdir le
    // « sur combien » des deux autres groupes. Les compter ensemble donnait
    // « 3 cahiers vides sur 91 » alors que 18 séances annulées n'en attendaient
    // aucun.
    let tenues = seances.iter().filter(|s| !s.cancelled).count();
    let avec_eleves = seances
        .iter()
        .filter(|s| !s.cancelled && s.enrolled > 0)
        .count();
    let annulees = seances.iter().filter(|s| s.cancelled).count();

    let appels = seances
        .iter()
        .filter(|s| !s.cancelled && s.enrolled > 0 && s.marked < s.enrolled)
        .map(|s| seance_item(s, Some(s.marked), Some(s.enrolled)))
        .collect();

    // Un cahier vide n'est un oubli que s'il n'a pas été traité autrement.
    // Deux façons de l'avoir été :
    //
    //   * « rien à écrire » déclaré — une évaluation surveillée, une sortie,
    //     une heure de vie de classe n'ont pas de compte rendu à produire ;
    //   * une pièce jointe — la photo du tableau EST le compte rendu, et
    //     réclamer en plus deux lignes tapées n'apporterait rien.
    //
    // Les deux restent dans le dénominateur `tenues`, contrairement aux séances
    // annulées : elles attendaient bien un compte rendu, et il a été fourni.
    // C'est le même traitement qu'un appel terminé, qui reste compté dans
    // `avec_eleves`. « 3 sur 91 » dit alors qu'il en manque trois, pas que
    // quatre-vingt-huit n'ont jamais été regardées.
    let cahiers = seances
        .iter()
        .filter(|s| !s.cancelled && s.content_missing && !s.content_waived && !s.has_attachment)
        .map(|s| seance_item(s, None, None))
        .collect();

    let sans_motif = seances
        .iter()
        .filter(|s| s.cancelled && s.reason_missing)
        .map(|s| seance_item(s, None, None))
        .collect();

    Ok(vec![
        group(KIND_APPEL, avec_eleves, appels),
        group(KIND_CAHIER, tenues, cahiers),
        group(KIND_ANNULEE, annulees, sans_motif),
    ])
}

/// Les deux rappels que les évaluations portent.
fn evaluation_groups(
    conn: &Connection,
    year_start: i32,
    today: &str,
) -> Result<Vec<ReminderGroup>, String> {
    let evaluations = collect(
        conn,
        EVALUATIONS_PASSEES,
        params![year_start, today],
        map_past_evaluation,
    )?;
    let total = evaluations.len();

    // Deux groupes et non un seul : une évaluation sans compétence rattachée
    // n'est pas « incomplète », elle est inutilisable. Aucune note ne peut y
    // être saisie, et aucune ne compte dans un bilan. La ranger avec les
    // grilles à finir ferait proposer « saisir les notes manquantes » devant un
    // écran qui n'a aucune colonne — l'enseignant chercherait longtemps.
    let sans_competence = evaluations
        .iter()
        .filter(|e| e.competencies == 0)
        .map(|e| evaluation_item(e, None, None))
        .collect();

    let incompletes = evaluations
        .iter()
        .filter(|e| e.competencies > 0 && e.students > 0 && e.graded < e.competencies * e.students)
        .map(|e| evaluation_item(e, Some(e.graded), Some(e.competencies * e.students)))
        .collect();

    Ok(vec![
        group(KIND_EVAL_NOTES, total, incompletes),
        group(KIND_EVAL_COMPETENCES, total, sans_competence),
    ])
}

/// Le rappel que les entrées d'agenda portent — et le plus proche de « visite de
/// stage non remplie » que la base sache dire aujourd'hui.
fn agenda_group(conn: &Connection, year_start: i32, today: &str) -> Result<ReminderGroup, String> {
    let debut = format!("{year_start}-08-01");
    let entries = collect(conn, ENTREES_PASSEES, params![debut, today], map_past_entry)?;
    let total = entries.len();

    // Exactement la règle des cahiers de texte ci-dessus, et c'est voulu : un
    // compte rendu vide n'est un oubli que s'il n'a pas été traité autrement.
    // Le palier 017 a donné au rendez-vous les deux mêmes sorties — « rien à
    // écrire » déclaré, ou une pièce jointe. Les deux restent dans `total` :
    // le rendez-vous attendait bien un compte rendu, et il a été fourni.
    //
    // Un rendez-vous ne s'annule pas (il se supprime), donc il n'y a pas de
    // troisième cas à écarter comme pour une séance annulée.
    let vides = entries
        .iter()
        .filter(|e| e.content_missing && !e.content_waived && !e.has_attachment)
        .map(|e| ReminderItem {
            id: e.id.clone(),
            title: e.title.clone(),
            date: e.date.clone(),
            session_id: e.session_id.clone(),
            session_name: e.session_name.clone(),
            student_name: e.student_name.clone(),
            is_stage_visit: e.is_stage_visit,
            done: None,
            total: None,
        })
        .collect();

    Ok(group(KIND_AGENDA, total, vides))
}

/// Le trimestre du jour, et ce qu'il reste à courir.
///
/// Les bornes enregistrées donnent trois débuts et une fin d'année ; la fin d'un
/// trimestre est donc la veille du début du suivant, et celle du troisième est
/// la fin de l'année. Lu avec `bounds_or_default` et jamais `ensure_bounds` :
/// afficher l'accueil n'écrit pas dans la base.
fn trimester_window(bounds: &db::TrimesterBounds, trimester: i32) -> (String, String) {
    let veille = |date: &str| {
        NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .ok()
            .and_then(|d| d.checked_sub_days(Days::new(1)))
            .map(|d| d.format("%Y-%m-%d").to_string())
            // Borne illisible : on rend la borne suivante telle quelle plutôt
            // que de masquer la section entière. Un jour de trop sur un compteur
            // vaut mieux qu'un écran vide.
            .unwrap_or_else(|| date.to_string())
    };

    match trimester {
        1 => (bounds.t1_start.clone(), veille(&bounds.t2_start)),
        2 => (bounds.t2_start.clone(), veille(&bounds.t3_start)),
        _ => (bounds.t3_start.clone(), bounds.year_end.clone()),
    }
}

/// Jours restants, bornes comprises : le dernier jour du trimestre en compte
/// encore un.
fn days_until(today: NaiveDate, end: &str) -> Option<i64> {
    let end = NaiveDate::parse_from_str(end, "%Y-%m-%d").ok()?;
    Some((end - today).num_days() + 1)
}

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------

/// Les prochains jours **ouvrés**, à partir de `from` inclus.
///
/// Samedi et dimanche sont sautés sans exception, y compris pour `from` : un
/// samedi, l'accueil ouvre donc sur lundi. C'est la demande, prise au mot — et
/// une carte vide intitulée « samedi » n'aurait rien appris, l'emploi du temps
/// restant là pour qui veut vraiment regarder le week-end.
///
/// Une seule commande, et non `count` appels à `get_day_schedule` enchaînés par
/// le front : l'appelant n'a pas à savoir que le 1er novembre est férié, ni
/// quels jours sont ouvrés. Il demande cinq jours de travail, il en reçoit cinq.
#[tauri::command]
pub fn get_upcoming_days(
    state: tauri::State<'_, AppState>,
    from: String,
    count: i32,
) -> Result<Vec<DaySchedule>, String> {
    let start = parse_date(&from, "La date")?;
    let wanted = i64::from(count).clamp(1, MAX_DAYS);

    let conn = state.conn()?;
    let mut days = Vec::new();
    let mut date = start;
    // Borne dure : deux semaines ouvrées couvrent au plus vingt jours
    // calendaires, et une boucle de lecture ne doit pas pouvoir tourner sans
    // fin si `checked_add_days` butait un jour sur la fin du calendrier chrono.
    let mut gardes = wanted * 2 + 14;

    while (days.len() as i64) < wanted && gardes > 0 {
        gardes -= 1;
        if !matches!(date.weekday(), Weekday::Sat | Weekday::Sun) {
            days.push(day_schedule(&conn, date)?);
        }
        date = match date.checked_add_days(Days::new(1)) {
            Some(next) => next,
            None => break,
        };
    }

    Ok(days)
}

/// Le relevé de l'accueil : le trimestre en cours, et les six groupes de
/// rappels.
///
/// `today` vient du front, et c'est délibéré : `date('now')` est en UTC côté
/// SQLite, et une consultation le 1er décembre à 00 h 30 aurait relevé le
/// trimestre du 30 novembre. C'est la même raison qui fait passer la date à
/// `get_day_schedule`.
#[tauri::command]
pub fn get_home_overview(
    state: tauri::State<'_, AppState>,
    today: String,
) -> Result<HomeOverview, String> {
    let jour = parse_date(&today, "La date")?;
    let today = crate::commands::timetable::iso(jour);
    let year_start = year_start_for(jour);

    let conn = state.conn()?;
    let bounds = db::bounds_or_default(&conn, year_start).map_err(|e| e.to_string())?;
    let trimester = db::trimester_for(&today, &bounds);
    let (trimester_start, trimester_end) = trimester_window(&bounds, trimester);

    let mut groups = seance_groups(&conn, year_start, &today)?;
    groups.extend(evaluation_groups(&conn, year_start, &today)?);
    groups.push(agenda_group(&conn, year_start, &today)?);

    Ok(HomeOverview {
        trimester_days_left: days_until(jour, &trimester_end),
        today,
        year_start,
        trimester,
        trimester_start,
        trimester_end,
        groups,
    })
}
