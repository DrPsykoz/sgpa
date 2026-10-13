//! Emploi du temps : créneaux hebdomadaires et entrées datées.
//!
//! **Le créneau est un modèle, jamais un cours.** Aucune séance n'est engendrée
//! d'office : c'est ce qui rend l'application indifférente aux vacances et aux
//! jours fériés, et ce qui protège le dénominateur d'assiduité — une séance qui
//! existe compte dans le bilan remis à la famille, et un clic de curiosité sur
//! une date passée imprimerait 92 % au lieu de 100 %.
//!
//! Deux sources, deux natures :
//!   * `timetable_slots` — le modèle hebdomadaire. Il n'est ouvrable que s'il
//!     désigne une classe, et il faut alors fabriquer l'occurrence.
//!   * `agenda_entries` — l'occurrence elle-même (visite de stage, réunion,
//!     ESS). Elle porte son contenu et est toujours ouvrable. Aucune de ses
//!     lignes n'entre dans `seances`, donc aucun comptage de bilan ne change.

use chrono::{Datelike, Days, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db;
use crate::state::AppState;

/// Jours fériés calculés — aucune donnée, aucune requête, et ça ne périme
/// jamais. L'open data du ministère ne les publie pas.
pub mod feries;

// ---------------------------------------------------------------------------
// Types renvoyés au front
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct TimetableSlot {
    pub id: String,
    pub year_start: i32,
    /// `None` = occupation sans classe (coordination, réunion hebdomadaire).
    /// C'est la seule façon de connaître le type d'un créneau : il n'y a pas de
    /// colonne `kind`, qui serait une seconde source de vérité.
    pub session_id: Option<String>,
    pub session_name: Option<String>,
    pub label: String,
    pub room: String,
    /// ISO : 1 = lundi … 7 = dimanche.
    pub weekday: i32,
    pub start_time: String,
    pub end_time: String,
    /// `toutes` | `paires` | `impaires` — parité de la semaine ISO.
    pub week_parity: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Une séance telle que la journée l'affiche : assez pour décider quoi montrer,
/// sans transporter le cahier de texte entier.
#[derive(Debug, Clone, Serialize)]
pub struct DaySeance {
    pub id: String,
    pub session_id: String,
    pub session_name: String,
    pub slot_id: Option<String>,
    pub title: String,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    pub trimester: i32,
    pub cancelled: bool,
    pub has_content: bool,
    pub attendance_taken_at: Option<String>,
    /// Élèves inscrits ce jour-là dans la classe.
    pub attendance_total: i32,
    /// Élèves réellement pointés (statut autre que `non_fait`).
    ///
    /// L'avancement se dit « 18/20 », pas « appel fait » : `attendance_taken_at`
    /// est posé dès le PREMIER élève pointé, il ne prouve donc pas qu'un appel
    /// soit terminé.
    pub attendance_done: i32,
}

/// Un créneau du jour, et l'occurrence qui lui correspond si elle existe.
#[derive(Debug, Clone, Serialize)]
pub struct DaySlot {
    pub slot: TimetableSlot,
    pub seance: Option<DaySeance>,
}

/// Entrée datée sans son corps rédigé, pour les listes.
#[derive(Debug, Clone, Serialize)]
pub struct AgendaEntrySummary {
    pub id: String,
    pub date: String,
    /// `""` = heure à caler : l'entrée s'affiche hors de la grille horaire.
    pub start_time: String,
    pub end_time: String,
    pub title: String,
    pub student_id: Option<String>,
    pub student_first_name: Option<String>,
    pub student_last_name: Option<String>,
    pub has_content: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Entrée datée complète, corps compris.
#[derive(Debug, Clone, Serialize)]
pub struct AgendaEntry {
    pub id: String,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    pub title: String,
    pub student_id: Option<String>,
    pub student_first_name: Option<String>,
    pub student_last_name: Option<String>,
    pub content_html: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DaySchedule {
    pub date: String,
    /// ISO : 1 = lundi … 7 = dimanche.
    pub weekday: i32,
    pub iso_week: i32,
    /// Parité de la semaine ISO de ce jour : `paires` ou `impaires`.
    pub week_parity: String,
    pub year_start: i32,
    /// Trimestre de cette date, calculé par le backend — le front ne recalcule
    /// jamais un trimestre.
    pub trimester: i32,
    /// Vrai si au moins un créneau de l'année porte une parité : c'est la seule
    /// condition qui autorise l'affichage du numéro de semaine. Tant que
    /// l'enseignant ne se sert pas de la quinzaine, il n'en voit aucune trace.
    pub show_parity: bool,
    pub slots: Vec<DaySlot>,
    /// Séances du jour qui ne viennent d'aucun créneau affiché.
    ///
    /// Sans elles, une séance créée depuis l'écran de la classe n'apparaîtrait
    /// pas dans la journée : on cliquerait « Créer et ouvrir » sur le créneau, et
    /// on obtiendrait un second appel pour le même cours.
    pub loose_seances: Vec<DaySeance>,
    pub entries: Vec<AgendaEntrySummary>,
    /// Pourquoi personne ne fait cours ce jour-là : vacances scolaires, jour
    /// férié, ou journée banalisée saisie à la main. Vide = jour ordinaire.
    ///
    /// Plusieurs raisons sont possibles le même jour — le 1er novembre est à la
    /// fois la Toussaint et dans les vacances qui portent son nom — et on les
    /// rend toutes plutôt que d'en choisir une : l'affichage décide, le backend
    /// constate.
    pub closures: Vec<DayClosure>,
    /// Classes dont TOUTE la classe est hors cours ce jour-là — une période
    /// d'`absence_periods` à `student_id IS NULL`, c'est-à-dire un stage.
    ///
    /// Une période NOMINATIVE n'y figure jamais : la classe est là, un élève
    /// manque. Les confondre referait, à l'envers, le défaut que le palier 006
    /// a corrigé.
    pub sessions_away: Vec<SessionAway>,
    /// Dernier jour que le calendrier embarqué couvre, ou `None` si le fichier
    /// est illisible.
    ///
    /// **La grille DOIT l'afficher.** Passé cette date, la fonctionnalité ne
    /// s'éteint pas : elle se met à mentir dans l'autre sens — des créneaux
    /// redessinés pendant des vacances qu'on ne connaît plus. En septembre 2029
    /// l'enseignant sera dans la grille, pas dans les réglages.
    pub calendar_until: Option<String>,
}

/// Une raison de ne pas faire cours, un jour donné.
#[derive(Debug, Clone, Serialize)]
pub struct DayClosure {
    pub label: String,
    /// `ferie` (calculé, jamais en base), `officiel` ou `manuel`.
    pub origin: String,
}

/// Une classe entière hors cours, et pourquoi.
#[derive(Debug, Clone, Serialize)]
pub struct SessionAway {
    pub session_id: String,
    pub session_name: String,
    /// Le motif saisi sur la période — « Stage en entreprise », le plus souvent.
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WeekSchedule {
    pub monday: String,
    pub iso_week: i32,
    pub week_parity: String,
    pub year_start: i32,
    pub show_parity: bool,
    /// Sept journées, du lundi au dimanche.
    pub days: Vec<DaySchedule>,
}

/// Saisie d'un créneau.
///
/// Regroupée en structure plutôt qu'étalée en huit paramètres : côté front, les
/// clés restent en snake_case, exactement comme `AttendanceInput`.
#[derive(Debug, Clone, Deserialize)]
pub struct TimetableSlotInput {
    pub session_id: Option<String>,
    pub label: String,
    pub room: String,
    pub weekday: i32,
    pub start_time: String,
    pub end_time: String,
    pub week_parity: String,
}

// ---------------------------------------------------------------------------
// Règles de calendrier — une seule implémentation, en Rust
// ---------------------------------------------------------------------------

/// Les trois valeurs acceptées par le CHECK de `timetable_slots.week_parity`.
const PARITES: [&str; 3] = ["toutes", "paires", "impaires"];

/// Parité de la semaine **ISO** d'une date.
///
/// Point à connaître, figé par un test : 2026-12-28 est la semaine 53 (impaire)
/// et 2027-01-04 la semaine 1 (impaire) — deux semaines impaires de suite,
/// l'unique rupture d'alternance. Elle tombe dans les vacances de Noël.
pub fn week_parity(date: NaiveDate) -> &'static str {
    if date.iso_week().week().is_multiple_of(2) {
        "paires"
    } else {
        "impaires"
    }
}

/// Année scolaire d'une date, bascule au 1er août.
///
/// Dérivée de la date affichée, **jamais** envoyée par le front : figée sur
/// « aujourd'hui », la grille deviendrait vide sans un mot au franchissement du
/// 1er août.
pub fn year_start_for(date: NaiveDate) -> i32 {
    if date.month() >= 8 {
        date.year()
    } else {
        date.year() - 1
    }
}

/// Jour ISO, 1 = lundi … 7 = dimanche.
///
/// Calculé en Rust et jamais par `strftime('%w')`, qui rend 0 pour dimanche là
/// où le schéma attend 1..7.
fn iso_weekday(date: NaiveDate) -> i32 {
    date.weekday().number_from_monday() as i32
}

fn monday_of(date: NaiveDate) -> Result<NaiveDate, String> {
    let recul = u64::from(date.weekday().num_days_from_monday());
    date.checked_sub_days(Days::new(recul))
        .ok_or_else(|| "Cette date sort du calendrier géré par SGPA.".to_string())
}

pub(crate) fn iso(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

// ---------------------------------------------------------------------------
// Validations — en français, avant toute écriture
// ---------------------------------------------------------------------------

/// Forme **et** existence de la date : le GLOB du schéma laisserait passer un
/// 30 février, et chrono accepterait « 2024-9-1 » que le GLOB refuserait ensuite.
pub(crate) fn parse_date(value: &str, quoi: &str) -> Result<NaiveDate, String> {
    let bytes = value.as_bytes();
    let bien_forme = bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit());

    let date = if bien_forme {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
    } else {
        None
    };

    date.ok_or_else(|| {
        format!(
            "{quoi} « {value} » n'est pas une date valide au format AAAA-MM-JJ \
             (exemple : 2026-11-17)."
        )
    })
}

/// Heure obligatoire `HH:MM`. Le GLOB du schéma laisse passer « 29:00 » : la
/// vérification des bornes est faite ici, en clair.
fn parse_time(value: &str, quoi: &str) -> Result<String, String> {
    let value = value.trim();
    let refus =
        || format!("{quoi} « {value} » n'est pas une heure au format HH:MM (exemple : 08:30).");

    let bytes = value.as_bytes();
    if bytes.len() != 5 || bytes[2] != b':' {
        return Err(refus());
    }
    let heures: u32 = value[0..2].parse().map_err(|_| refus())?;
    let minutes: u32 = value[3..5].parse().map_err(|_| refus())?;
    if heures > 23 || minutes > 59 {
        return Err(refus());
    }
    Ok(value.to_string())
}

/// Heure facultative : `""` vaut « heure à caler », et l'entrée s'affiche alors
/// en bandeau du jour. Sans cette tolérance, une visite notée à la volée serait
/// impossible à saisir tant que l'horaire n'est pas connu.
pub(crate) fn parse_optional_time(value: &str, quoi: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(String::new());
    }
    parse_time(value, quoi)
}

pub(crate) fn check_time_order(start: &str, end: &str) -> Result<(), String> {
    if start.is_empty() && !end.is_empty() {
        return Err("Indiquez d'abord une heure de début, ou laissez les deux vides.".to_string());
    }
    if !start.is_empty() && !end.is_empty() && end <= start {
        return Err(format!(
            "L'heure de fin ({end}) doit suivre l'heure de début ({start})."
        ));
    }
    Ok(())
}

fn clean_label(label: &str) -> Result<String, String> {
    let label = label.trim();
    if label.is_empty() {
        return Err(
            "Donnez un libellé au créneau, par exemple « Atelier » ou « Coordination » : \
             c'est lui qui titrera la séance créée depuis ce créneau."
                .to_string(),
        );
    }
    Ok(label.to_string())
}

fn clean_entry_title(title: &str) -> Result<String, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err(
            "Donnez un intitulé à cette entrée, par exemple « Visite de stage » ou \
             « Conseil de classe »."
                .to_string(),
        );
    }
    Ok(title.to_string())
}

fn check_weekday(weekday: i32) -> Result<(), String> {
    if (1..=7).contains(&weekday) {
        return Ok(());
    }
    Err(format!(
        "Jour de la semaine invalide : {weekday}. Attendu 1 pour lundi … 7 pour dimanche."
    ))
}

fn check_parity(parity: &str) -> Result<(), String> {
    if PARITES.contains(&parity) {
        return Ok(());
    }
    Err(format!(
        "Périodicité inconnue : « {parity} ». Valeurs attendues : toutes, paires, impaires."
    ))
}

fn check_year(year_start: i32) -> Result<(), String> {
    if (2000..=2100).contains(&year_start) {
        return Ok(());
    }
    Err(format!(
        "Année scolaire invalide : {year_start}. Saisissez l'année de la rentrée, \
         entre 2000 et 2100."
    ))
}

/// Le schéma ne peut rien garantir ici : rien ne l'empêche d'attacher une classe
/// de 2024 à un créneau de 2026.
fn check_session_year(
    conn: &Connection,
    session_id: Option<&str>,
    year_start: i32,
) -> Result<(), String> {
    let Some(session_id) = session_id else {
        return Ok(());
    };

    let trouvee: Option<(String, i32)> = conn
        .query_row(
            "SELECT name, year_start FROM sessions WHERE id = ?1",
            params![session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    match trouvee {
        None => Err("Classe introuvable".to_string()),
        Some((name, annee)) if annee != year_start => {
            let fin_classe = annee + 1;
            let fin_creneau = year_start + 1;
            Err(format!(
                "La classe « {name} » appartient à l'année scolaire {annee}-{fin_classe}, \
                 alors que ce créneau est placé en {year_start}-{fin_creneau}. Choisissez \
                 une classe de la même année."
            ))
        }
        Some(_) => Ok(()),
    }
}

fn check_student(conn: &Connection, student_id: Option<&str>) -> Result<(), String> {
    let Some(student_id) = student_id else {
        return Ok(());
    };
    let existe: Option<i32> = conn
        .query_row(
            "SELECT 1 FROM students WHERE id = ?1",
            params![student_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if existe.is_none() {
        return Err("Élève introuvable".to_string());
    }
    Ok(())
}

/// Normalise un identifiant facultatif : `Some("")` vaut `None`.
fn optional_id(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

// ---------------------------------------------------------------------------
// Requêtes — des littéraux entiers, jamais assemblés par `format!`
// ---------------------------------------------------------------------------

const SLOTS_DU_JOUR: &str = "SELECT ts.id, ts.year_start, ts.session_id, s.name, ts.label,
       ts.room, ts.weekday, ts.start_time, ts.end_time, ts.week_parity,
       ts.created_at, ts.updated_at
  FROM timetable_slots ts
  LEFT JOIN sessions s ON s.id = ts.session_id
 WHERE ts.year_start = ?1
   AND ts.weekday = ?2
   AND (ts.week_parity = 'toutes' OR ts.week_parity = ?3)
 ORDER BY ts.start_time, ts.end_time, ts.label";

const SLOTS_DE_LA_SEMAINE: &str = "SELECT ts.id, ts.year_start, ts.session_id, s.name, ts.label,
       ts.room, ts.weekday, ts.start_time, ts.end_time, ts.week_parity,
       ts.created_at, ts.updated_at
  FROM timetable_slots ts
  LEFT JOIN sessions s ON s.id = ts.session_id
 WHERE ts.year_start = ?1
   AND (ts.week_parity = 'toutes' OR ts.week_parity = ?2)
 ORDER BY ts.weekday, ts.start_time, ts.end_time, ts.label";

const SLOTS_DE_L_ANNEE: &str = "SELECT ts.id, ts.year_start, ts.session_id, s.name, ts.label,
       ts.room, ts.weekday, ts.start_time, ts.end_time, ts.week_parity,
       ts.created_at, ts.updated_at
  FROM timetable_slots ts
  LEFT JOIN sessions s ON s.id = ts.session_id
 WHERE ts.year_start = ?1
 ORDER BY ts.weekday, ts.start_time, ts.end_time, ts.label";

const SLOT_PAR_ID: &str = "SELECT ts.id, ts.year_start, ts.session_id, s.name, ts.label,
       ts.room, ts.weekday, ts.start_time, ts.end_time, ts.week_parity,
       ts.created_at, ts.updated_at
  FROM timetable_slots ts
  LEFT JOIN sessions s ON s.id = ts.session_id
 WHERE ts.id = ?1";

/// Séances d'une période, avec l'avancement réel de l'appel.
///
/// Les deux sous-requêtes bornent le comptage à la période d'inscription, comme
/// `get_attendance` : un élève arrivé en janvier ne doit pas manquer à l'appel
/// d'octobre, et un élève parti ne doit pas le bloquer à 19/20 pour toujours.
const SEANCES_DE_LA_PERIODE: &str = "SELECT se.id, se.session_id, s.name, se.slot_id, se.title,
       se.date, se.start_time, se.end_time, se.trimester, se.cancelled,
       se.content_html <> '', se.attendance_taken_at,
       (SELECT COUNT(*) FROM students st
         WHERE st.session_id = se.session_id
           AND st.enrolled_on <= se.date
           AND (st.left_on IS NULL OR se.date <= st.left_on)),
       (SELECT COUNT(*) FROM attendance_records ar
          JOIN students sa ON sa.id = ar.student_id
         WHERE ar.seance_id = se.id
           AND ar.status <> 'non_fait'
           AND sa.enrolled_on <= se.date
           AND (sa.left_on IS NULL OR se.date <= sa.left_on))
  FROM seances se
  JOIN sessions s ON s.id = se.session_id
 WHERE se.date BETWEEN ?1 AND ?2
 ORDER BY se.date, se.start_time, se.title";

const ENTREES_DE_LA_PERIODE: &str = "SELECT ae.id, ae.date, ae.start_time, ae.end_time, ae.title,
       ae.student_id, st.first_name, st.last_name, ae.content_html <> '',
       ae.created_at, ae.updated_at
  FROM agenda_entries ae
  LEFT JOIN students st ON st.id = ae.student_id
 WHERE ae.date BETWEEN ?1 AND ?2
 ORDER BY ae.date, ae.start_time, ae.title";

const ENTREES_DE_L_ELEVE: &str = "SELECT ae.id, ae.date, ae.start_time, ae.end_time, ae.title,
       ae.student_id, st.first_name, st.last_name, ae.content_html <> '',
       ae.created_at, ae.updated_at
  FROM agenda_entries ae
  LEFT JOIN students st ON st.id = ae.student_id
 WHERE ae.student_id = ?1
 ORDER BY ae.date DESC, ae.start_time, ae.title";

const ENTREE_PAR_ID: &str = "SELECT ae.id, ae.date, ae.start_time, ae.end_time, ae.title,
       ae.student_id, st.first_name, st.last_name, ae.content_html,
       ae.created_at, ae.updated_at
  FROM agenda_entries ae
  LEFT JOIN students st ON st.id = ae.student_id
 WHERE ae.id = ?1";

/// Vrai dès qu'un seul créneau de l'année porte une parité. C'est un booléen
/// calculé, pas un réglage : rien à activer, rien à désactiver.
const PARITE_UTILISEE: &str = "SELECT EXISTS(SELECT 1 FROM timetable_slots
                                              WHERE year_start = ?1 AND week_parity <> 'toutes')";

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

fn map_slot(row: &rusqlite::Row<'_>) -> rusqlite::Result<TimetableSlot> {
    Ok(TimetableSlot {
        id: row.get(0)?,
        year_start: row.get(1)?,
        session_id: row.get(2)?,
        session_name: row.get(3)?,
        label: row.get(4)?,
        room: row.get(5)?,
        weekday: row.get(6)?,
        start_time: row.get(7)?,
        end_time: row.get(8)?,
        week_parity: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn map_day_seance(row: &rusqlite::Row<'_>) -> rusqlite::Result<DaySeance> {
    Ok(DaySeance {
        id: row.get(0)?,
        session_id: row.get(1)?,
        session_name: row.get(2)?,
        slot_id: row.get(3)?,
        title: row.get(4)?,
        date: row.get(5)?,
        start_time: row.get(6)?,
        end_time: row.get(7)?,
        trimester: row.get(8)?,
        cancelled: row.get(9)?,
        has_content: row.get(10)?,
        attendance_taken_at: row.get(11)?,
        attendance_total: row.get(12)?,
        attendance_done: row.get(13)?,
    })
}

fn map_entry_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgendaEntrySummary> {
    Ok(AgendaEntrySummary {
        id: row.get(0)?,
        date: row.get(1)?,
        start_time: row.get(2)?,
        end_time: row.get(3)?,
        title: row.get(4)?,
        student_id: row.get(5)?,
        student_first_name: row.get(6)?,
        student_last_name: row.get(7)?,
        has_content: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn map_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgendaEntry> {
    Ok(AgendaEntry {
        id: row.get(0)?,
        date: row.get(1)?,
        start_time: row.get(2)?,
        end_time: row.get(3)?,
        title: row.get(4)?,
        student_id: row.get(5)?,
        student_first_name: row.get(6)?,
        student_last_name: row.get(7)?,
        content_html: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn collect<T, P, F>(conn: &Connection, sql: &str, args: P, map: F) -> Result<Vec<T>, String>
where
    P: rusqlite::Params,
    F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
{
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(args, map)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn load_entry(conn: &Connection, id: &str) -> Result<AgendaEntry, String> {
    conn.query_row(ENTREE_PAR_ID, params![id], map_entry)
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Entrée d'agenda introuvable".to_string())
}

fn load_slot(conn: &Connection, id: &str) -> Result<TimetableSlot, String> {
    conn.query_row(SLOT_PAR_ID, params![id], map_slot)
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Créneau introuvable".to_string())
}

fn parity_is_used(conn: &Connection, year_start: i32) -> Result<bool, String> {
    conn.query_row(PARITE_UTILISEE, params![year_start], |row| row.get(0))
        .map_err(|e| e.to_string())
}

/// Range les séances derrière leur créneau, et laisse les autres à part.
/// Les morceaux d'une journée, regroupés.
///
/// Ils voyagent dans une structure et non en sept paramètres de plus : avec
/// `closures` et `sessions_away`, `assemble_day` passerait à neuf arguments et
/// `clippy::too_many_arguments` se déclencherait — son seuil est à sept.
struct DayParts {
    year_start: i32,
    trimester: i32,
    show_parity: bool,
    slots: Vec<TimetableSlot>,
    seances: Vec<DaySeance>,
    entries: Vec<AgendaEntrySummary>,
    closures: Vec<DayClosure>,
    sessions_away: Vec<SessionAway>,
}

/// Dernier jour couvert par le calendrier embarqué. Lu une fois par réponse.
fn calendar_until() -> Option<String> {
    db::holidays::couvert_jusqu_au()
}

fn assemble_day(date: NaiveDate, parts: DayParts) -> DaySchedule {
    let DayParts {
        year_start,
        trimester,
        show_parity,
        slots,
        seances,
        entries,
        closures,
        sessions_away,
    } = parts;
    let mut day_slots: Vec<DaySlot> = slots
        .into_iter()
        .map(|slot| DaySlot { slot, seance: None })
        .collect();
    let mut loose_seances = Vec::new();

    for seance in seances {
        let place = seance.slot_id.as_deref().and_then(|slot_id| {
            day_slots
                .iter_mut()
                .find(|d| d.slot.id == slot_id && d.seance.is_none())
        });
        match place {
            Some(day_slot) => day_slot.seance = Some(seance),
            // Séance créée depuis l'écran de la classe, ou rattachée à un créneau
            // que ce jour-là n'affiche pas : elle doit rester visible, sinon on
            // recrée un second appel pour le même cours.
            None => loose_seances.push(seance),
        }
    }

    DaySchedule {
        date: iso(date),
        weekday: iso_weekday(date),
        iso_week: date.iso_week().week() as i32,
        week_parity: week_parity(date).to_string(),
        year_start,
        trimester,
        show_parity,
        slots: day_slots,
        loose_seances,
        entries,
        closures,
        sessions_away,
        calendar_until: calendar_until(),
    }
}

/// Les vacances scolaires et journées banalisées qui recouvrent une plage.
///
/// L'académie est lue EN SOUS-REQUÊTE et non passée par le front : c'est la même
/// doctrine que le trimestre, une seule implémentation de la règle. Le front ne
/// choisit pas de quelle académie il parle.
///
/// ⚠ AUCUN filtre par année scolaire, et c'est mesuré : les vacances d'été
/// 2026-2027 à Besançon courent du 2027-07-03 au 2027-09-01, donc à cheval sur
/// le 1er août. Un filtre par année les ferait disparaître le 20 août, au moment
/// précis où l'on prépare la rentrée. On interroge par plage de dates, point.
const VACANCES_DE_LA_PERIODE: &str = "SELECT sh.start_date, sh.end_date, sh.label, sh.origin
  FROM school_holidays sh
 WHERE sh.academie = (SELECT academie FROM app_settings WHERE id = 1)
   AND sh.end_date   >= ?1
   AND sh.start_date <= ?2
 ORDER BY sh.start_date, sh.label";

/// Les classes ENTIÈRES hors cours sur une plage — les stages.
///
/// `p.student_id IS NULL` est la condition qui compte : une période nominative
/// (hospitalisation, stage annulé pour un seul) ne retire JAMAIS un créneau. La
/// classe est là, un élève manque. Les confondre referait, à l'envers, le défaut
/// que le palier 006 a corrigé.
const CLASSES_HORS_COURS: &str = "SELECT p.session_id, s.name, p.reason, p.start_date, p.end_date
  FROM absence_periods p
  JOIN sessions s ON s.id = p.session_id
 WHERE p.student_id IS NULL
   AND p.end_date   >= ?1
   AND p.start_date <= ?2
 ORDER BY s.name, p.start_date";

/// Une période recouvrant des jours : les bornes, et de quoi la décrire.
type Periode = (String, String, String, String);

/// Une classe hors cours sur une période : classe, nom, motif, bornes.
type ClasseHorsCours = (String, String, String, String, String);

fn map_periode(row: &rusqlite::Row<'_>) -> rusqlite::Result<Periode> {
    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
}

fn map_classe_hors_cours(row: &rusqlite::Row<'_>) -> rusqlite::Result<ClasseHorsCours> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
    ))
}

/// Les raisons de ne pas faire cours un jour donné, vacances **et** fériés.
///
/// Les fériés viennent du calcul et ne coûtent aucune requête ; les vacances
/// sont filtrées depuis la plage déjà chargée, pour que la semaine n'interroge
/// pas sept fois.
fn closures_du_jour(date: NaiveDate, jour: &str, vacances: &[Periode]) -> Vec<DayClosure> {
    let mut closures: Vec<DayClosure> = feries::nom_du_ferie(date)
        .map(|nom| DayClosure {
            label: nom.to_string(),
            origin: "ferie".to_string(),
        })
        .into_iter()
        .collect();
    for (debut, fin, label, origin) in vacances {
        if debut.as_str() <= jour && jour <= fin.as_str() {
            closures.push(DayClosure {
                label: label.clone(),
                origin: origin.clone(),
            });
        }
    }
    closures
}

/// Les classes entières hors cours un jour donné.
fn sessions_away_du_jour(jour: &str, periodes: &[ClasseHorsCours]) -> Vec<SessionAway> {
    periodes
        .iter()
        .filter(|(_, _, _, debut, fin)| debut.as_str() <= jour && jour <= fin.as_str())
        .map(|(session_id, session_name, reason, _, _)| SessionAway {
            session_id: session_id.clone(),
            session_name: session_name.clone(),
            reason: reason.clone(),
        })
        .collect()
}

/// Journée complète en **sept requêtes**, quel que soit le nombre de cours.
fn day_schedule(conn: &Connection, date: NaiveDate) -> Result<DaySchedule, String> {
    let year_start = year_start_for(date);
    let jour = iso(date);
    let parity = week_parity(date);

    // `bounds_or_default`, jamais `ensure_bounds` : une lecture n'écrit pas.
    let bounds = db::bounds_or_default(conn, year_start).map_err(|e| e.to_string())?;
    let trimester = db::trimester_for(&jour, &bounds);
    let show_parity = parity_is_used(conn, year_start)?;

    let slots = collect(
        conn,
        SLOTS_DU_JOUR,
        params![year_start, iso_weekday(date), parity],
        map_slot,
    )?;
    let seances = collect(
        conn,
        SEANCES_DE_LA_PERIODE,
        params![jour, jour],
        map_day_seance,
    )?;
    let entries = collect(
        conn,
        ENTREES_DE_LA_PERIODE,
        params![jour, jour],
        map_entry_summary,
    )?;

    let vacances = collect(
        conn,
        VACANCES_DE_LA_PERIODE,
        params![jour, jour],
        map_periode,
    )?;
    let hors_cours = collect(
        conn,
        CLASSES_HORS_COURS,
        params![jour, jour],
        map_classe_hors_cours,
    )?;

    Ok(assemble_day(
        date,
        DayParts {
            year_start,
            trimester,
            show_parity,
            slots,
            seances,
            entries,
            closures: closures_du_jour(date, &jour, &vacances),
            sessions_away: sessions_away_du_jour(&jour, &hors_cours),
        },
    ))
}

/// Semaine complète, en cinq requêtes elle aussi : les sept jours d'une semaine
/// ISO partagent le même numéro de semaine, donc la même parité, donc le même
/// filtre de créneaux.
fn week_schedule(conn: &Connection, monday: NaiveDate) -> Result<WeekSchedule, String> {
    // L'année est dérivée du lundi pour toute la semaine. Seule la semaine qui
    // contient le 1er août est concernée, et elle tombe en plein été.
    let year_start = year_start_for(monday);
    let parity = week_parity(monday);
    let hors_calendrier = || "Cette semaine sort du calendrier géré par SGPA.".to_string();
    let sunday = monday
        .checked_add_days(Days::new(6))
        .ok_or_else(hors_calendrier)?;

    let bounds = db::bounds_or_default(conn, year_start).map_err(|e| e.to_string())?;
    let show_parity = parity_is_used(conn, year_start)?;

    let slots = collect(
        conn,
        SLOTS_DE_LA_SEMAINE,
        params![year_start, parity],
        map_slot,
    )?;
    let seances = collect(
        conn,
        SEANCES_DE_LA_PERIODE,
        params![iso(monday), iso(sunday)],
        map_day_seance,
    )?;
    let entries = collect(
        conn,
        ENTREES_DE_LA_PERIODE,
        params![iso(monday), iso(sunday)],
        map_entry_summary,
    )?;

    // Chargées UNE FOIS pour les sept jours, puis filtrées en mémoire : la
    // semaine ne doit pas interroger sept fois ce qu'une plage de dates rend
    // d'un coup.
    let vacances = collect(
        conn,
        VACANCES_DE_LA_PERIODE,
        params![iso(monday), iso(sunday)],
        map_periode,
    )?;
    let hors_cours = collect(
        conn,
        CLASSES_HORS_COURS,
        params![iso(monday), iso(sunday)],
        map_classe_hors_cours,
    )?;

    let mut days = Vec::with_capacity(7);
    for decalage in 0..7u64 {
        let date = monday
            .checked_add_days(Days::new(decalage))
            .ok_or_else(hors_calendrier)?;
        let jour = iso(date);
        let weekday = iso_weekday(date);

        days.push(assemble_day(
            date,
            DayParts {
                year_start,
                trimester: db::trimester_for(&jour, &bounds),
                show_parity,
                slots: slots
                    .iter()
                    .filter(|s| s.weekday == weekday)
                    .cloned()
                    .collect(),
                seances: seances.iter().filter(|s| s.date == jour).cloned().collect(),
                entries: entries.iter().filter(|e| e.date == jour).cloned().collect(),
                closures: closures_du_jour(date, &jour, &vacances),
                sessions_away: sessions_away_du_jour(&jour, &hors_cours),
            },
        ));
    }

    Ok(WeekSchedule {
        monday: iso(monday),
        iso_week: monday.iso_week().week() as i32,
        week_parity: parity.to_string(),
        year_start,
        show_parity,
        days,
    })
}

// ---------------------------------------------------------------------------
// Commandes — lecture
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_day_schedule(
    state: tauri::State<'_, AppState>,
    date: String,
) -> Result<DaySchedule, String> {
    let date = parse_date(&date, "La date")?;
    let conn = state.conn()?;
    day_schedule(&conn, date)
}

/// Semaine entière. La date reçue est ramenée au lundi de sa semaine ISO :
/// l'appelant n'a pas à savoir calculer un début de semaine.
#[tauri::command]
pub fn get_week_schedule(
    state: tauri::State<'_, AppState>,
    monday: String,
) -> Result<WeekSchedule, String> {
    let date = parse_date(&monday, "La date")?;
    let conn = state.conn()?;
    week_schedule(&conn, monday_of(date)?)
}

/// Les académies pour lesquelles le calendrier embarqué porte des dates.
///
/// Lue DANS LES DONNÉES, jamais recopiée d'une liste administrative : mesuré,
/// le jeu du ministère porte 36 valeurs `location` distinctes mais seules 34 ont
/// des dates dans la fenêtre embarquée — Caen et Rouen sont fusionnées dans
/// Normandie depuis 2020. Une liste recopiée proposerait donc des académies sans
/// dates, c'est-à-dire un réglage qui a l'air de marcher et ne fait rien.
#[tauri::command]
pub fn get_available_academies(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    let conn = state.conn()?;
    collect(
        &conn,
        "SELECT DISTINCT academie FROM school_holidays ORDER BY academie",
        params![],
        |row| row.get(0),
    )
}

/// Tous les créneaux d'une année, tous jours confondus et sans filtre de parité :
/// c'est la grille telle qu'on la règle, pas telle qu'on la vit un jour donné.
#[tauri::command]
pub fn get_timetable_slots(
    state: tauri::State<'_, AppState>,
    year_start: i32,
) -> Result<Vec<TimetableSlot>, String> {
    check_year(year_start)?;
    let conn = state.conn()?;
    collect(&conn, SLOTS_DE_L_ANNEE, params![year_start], map_slot)
}

// ---------------------------------------------------------------------------
// Commandes — créneaux
// ---------------------------------------------------------------------------

/// Valeurs d'un créneau, vérifiées et nettoyées : identifiant de classe, libellé,
/// salle, heure de début, heure de fin.
type SlotValues = (Option<String>, String, String, String, String);

fn validated_slot(
    conn: &Connection,
    year_start: i32,
    input: &TimetableSlotInput,
) -> Result<SlotValues, String> {
    let label = clean_label(&input.label)?;
    let room = input.room.trim().to_string();
    check_weekday(input.weekday)?;
    check_parity(&input.week_parity)?;

    let start_time = parse_time(&input.start_time, "L'heure de début")?;
    let end_time = parse_time(&input.end_time, "L'heure de fin")?;
    check_time_order(&start_time, &end_time)?;

    let session_id = optional_id(input.session_id.clone());
    check_session_year(conn, session_id.as_deref(), year_start)?;

    Ok((session_id, label, room, start_time, end_time))
}

#[tauri::command]
pub fn create_timetable_slot(
    state: tauri::State<'_, AppState>,
    year_start: i32,
    slot: TimetableSlotInput,
) -> Result<TimetableSlot, String> {
    check_year(year_start)?;

    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let (session_id, label, room, start_time, end_time) = validated_slot(&tx, year_start, &slot)?;

    let id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO timetable_slots
             (id, year_start, session_id, label, room, weekday, start_time, end_time, week_parity)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id,
            year_start,
            session_id,
            label,
            room,
            slot.weekday,
            start_time,
            end_time,
            slot.week_parity
        ],
    )
    .map_err(|e| e.to_string())?;

    let created = load_slot(&tx, &id)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(created)
}

/// L'année d'un créneau n'est pas modifiable : elle est relue sur la ligne
/// existante. Déplacer un créneau d'une année à l'autre n'a aucun sens — on en
/// crée un dans la bonne année, et le calendrier de l'année en cours ne bouge pas
/// sous les pieds de l'enseignant.
#[tauri::command]
pub fn update_timetable_slot(
    state: tauri::State<'_, AppState>,
    id: String,
    slot: TimetableSlotInput,
) -> Result<TimetableSlot, String> {
    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let year_start = load_slot(&tx, &id)?.year_start;
    let (session_id, label, room, start_time, end_time) = validated_slot(&tx, year_start, &slot)?;

    tx.execute(
        "UPDATE timetable_slots
            SET session_id = ?1, label = ?2, room = ?3, weekday = ?4,
                start_time = ?5, end_time = ?6, week_parity = ?7,
                updated_at = datetime('now')
          WHERE id = ?8",
        params![
            session_id,
            label,
            room,
            slot.weekday,
            start_time,
            end_time,
            slot.week_parity,
            id
        ],
    )
    .map_err(|e| e.to_string())?;

    let updated = load_slot(&tx, &id)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(updated)
}

/// Supprime un créneau. Les séances déjà tenues **ne partent pas** : leur
/// `slot_id` passe à NULL (schéma, palier 004) et leurs appels restent intacts.
#[tauri::command]
pub fn delete_timetable_slot(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.conn()?;
    let supprimes = conn
        .execute("DELETE FROM timetable_slots WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if supprimes == 0 {
        return Err("Créneau introuvable".to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Commandes — entrées datées
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn create_agenda_entry(
    state: tauri::State<'_, AppState>,
    date: String,
    start_time: String,
    end_time: String,
    title: String,
    student_id: Option<String>,
) -> Result<AgendaEntry, String> {
    let date = parse_date(&date, "La date")?;
    let start_time = parse_optional_time(&start_time, "L'heure de début")?;
    let end_time = parse_optional_time(&end_time, "L'heure de fin")?;
    check_time_order(&start_time, &end_time)?;
    let title = clean_entry_title(&title)?;
    let student_id = optional_id(student_id);

    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    check_student(&tx, student_id.as_deref())?;

    let id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO agenda_entries (id, date, start_time, end_time, title, student_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, iso(date), start_time, end_time, title, student_id],
    )
    .map_err(|e| e.to_string())?;

    let created = load_entry(&tx, &id)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(created)
}

#[tauri::command]
pub fn get_agenda_entry(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<AgendaEntry, String> {
    let conn = state.conn()?;
    load_entry(&conn, &id)
}

/// Date, horaire, intitulé — **jamais** la cible ni le corps rédigé.
///
/// L'élève désigné est immuable après création, comme la classe d'une séance : un
/// rapport écrit sur Jean ne doit pas pouvoir devenir un rapport sur Marie. Mauvais
/// élève choisi, on supprime et on recrée — la friction est le bon comportement.
#[tauri::command]
pub fn update_agenda_entry_meta(
    state: tauri::State<'_, AppState>,
    id: String,
    date: String,
    start_time: String,
    end_time: String,
    title: String,
) -> Result<AgendaEntry, String> {
    let date = parse_date(&date, "La date")?;
    let start_time = parse_optional_time(&start_time, "L'heure de début")?;
    let end_time = parse_optional_time(&end_time, "L'heure de fin")?;
    check_time_order(&start_time, &end_time)?;
    let title = clean_entry_title(&title)?;

    let conn = state.conn()?;
    let touched = conn
        .execute(
            "UPDATE agenda_entries
                SET date = ?1, start_time = ?2, end_time = ?3, title = ?4,
                    updated_at = datetime('now')
              WHERE id = ?5",
            params![iso(date), start_time, end_time, title, id],
        )
        .map_err(|e| e.to_string())?;
    if touched == 0 {
        return Err("Entrée d'agenda introuvable".to_string());
    }

    load_entry(&conn, &id)
}

/// Corps rédigé seul. Même scission que `update_seance_meta` /
/// `update_seance_content` : deux écritures qui ne concernent pas les mêmes
/// colonnes sont deux commandes.
#[tauri::command]
pub fn update_agenda_entry_content(
    state: tauri::State<'_, AppState>,
    id: String,
    content_html: String,
) -> Result<(), String> {
    let conn = state.conn()?;
    let touched = conn
        .execute(
            "UPDATE agenda_entries
                SET content_html = ?1, updated_at = datetime('now')
              WHERE id = ?2",
            params![content_html, id],
        )
        .map_err(|e| e.to_string())?;
    if touched == 0 {
        return Err("Entrée d'agenda introuvable".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn delete_agenda_entry(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.conn()?;
    let supprimees = conn
        .execute("DELETE FROM agenda_entries WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if supprimees == 0 {
        return Err("Entrée d'agenda introuvable".to_string());
    }
    Ok(())
}

/// Les entrées d'un élève, la plus récente d'abord : c'est là qu'on cherche un
/// rapport de visite six mois plus tard, pas dans l'emploi du temps.
#[tauri::command]
pub fn get_student_agenda_entries(
    state: tauri::State<'_, AppState>,
    student_id: String,
) -> Result<Vec<AgendaEntrySummary>, String> {
    let conn = state.conn()?;
    collect(
        &conn,
        ENTREES_DE_L_ELEVE,
        params![student_id],
        map_entry_summary,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn migrated_db(nom: &str) -> Connection {
        let dir = std::env::temp_dir().join(format!("sgpa-edt-{nom}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = Connection::open(dir.join("sgpa.db")).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::db::migrations::run(&mut conn, &dir).unwrap();
        conn
    }

    fn date(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap()
    }

    /// L'unique rupture d'alternance de la décennie, et elle est ici par choix,
    /// pas par surprise : la semaine ISO 53 de 2026 et la semaine 1 de 2027 sont
    /// toutes deux impaires. La 53ᵉ tombe entièrement dans les vacances de Noël.
    /// Occurrence suivante : 2032.
    #[test]
    fn deux_semaines_impaires_de_suite_au_passage_de_2027() {
        assert_eq!(date("2026-12-28").iso_week().week(), 53);
        assert_eq!(week_parity(date("2026-12-28")), "impaires");
        assert_eq!(date("2027-01-04").iso_week().week(), 1);
        assert_eq!(week_parity(date("2027-01-04")), "impaires");
    }

    #[test]
    fn parite_alterne_le_reste_du_temps() {
        // Semaines ISO 47 puis 48.
        assert_eq!(week_parity(date("2026-11-17")), "impaires");
        assert_eq!(week_parity(date("2026-11-24")), "paires");
        // Le 1er janvier 2026 appartient à la semaine ISO 1 de 2026.
        assert_eq!(week_parity(date("2026-01-01")), "impaires");
    }

    /// `strftime('%w')` rendrait 0 pour dimanche, là où le schéma attend 1..7.
    #[test]
    fn jour_iso_de_lundi_a_dimanche() {
        assert_eq!(iso_weekday(date("2026-11-16")), 1, "lundi");
        assert_eq!(iso_weekday(date("2026-11-22")), 7, "dimanche");
    }

    #[test]
    fn annee_scolaire_bascule_au_1er_aout() {
        assert_eq!(year_start_for(date("2026-07-31")), 2025);
        assert_eq!(year_start_for(date("2026-08-01")), 2026);
        assert_eq!(year_start_for(date("2027-06-30")), 2026);
    }

    #[test]
    fn lundi_de_la_semaine() {
        assert_eq!(monday_of(date("2026-11-22")).unwrap(), date("2026-11-16"));
        assert_eq!(monday_of(date("2026-11-16")).unwrap(), date("2026-11-16"));
    }

    #[test]
    fn heures_hors_bornes_refusees() {
        // Le GLOB du schéma laisse passer « 29:00 » : la borne est ici.
        assert!(parse_time("29:00", "L'heure de début").is_err());
        assert!(parse_time("08:75", "L'heure de début").is_err());
        assert!(parse_time("8:30", "L'heure de début").is_err());
        assert!(parse_time("", "L'heure de début").is_err());
        assert_eq!(parse_time(" 08:30 ", "L'heure de début").unwrap(), "08:30");
        assert_eq!(parse_optional_time("", "L'heure de début").unwrap(), "");
    }

    #[test]
    fn ordre_des_heures() {
        assert!(check_time_order("10:00", "09:00").is_err());
        assert!(check_time_order("10:00", "10:00").is_err());
        assert!(check_time_order("", "10:00").is_err());
        assert!(check_time_order("", "").is_ok());
        assert!(check_time_order("08:00", "10:00").is_ok());
    }

    #[test]
    fn dates_impossibles_refusees() {
        assert!(parse_date("2026-02-30", "La date").is_err());
        assert!(parse_date("2026-9-1", "La date").is_err());
        assert!(parse_date("17/11/2026", "La date").is_err());
        assert!(parse_date("2024-02-29", "La date").is_ok());
    }

    #[test]
    fn libelle_et_intitule_obligatoires() {
        assert!(clean_label("   ").is_err());
        assert_eq!(clean_label("  Atelier ").unwrap(), "Atelier");
        assert!(clean_entry_title("").is_err());
    }

    #[test]
    fn parites_et_jours_hors_liste_refuses() {
        // Le bug reproduit au plan : 'all' au lieu de 'toutes' vidait la grille
        // sans un mot. La valeur est refusée avant d'atteindre la base.
        assert!(check_parity("all").is_err());
        assert!(check_parity("toutes").is_ok());
        assert!(check_weekday(0).is_err());
        assert!(check_weekday(8).is_err());
        assert!(check_weekday(7).is_ok());
    }

    /// Mardi 17 novembre 2026 : semaine ISO 47, impaire.
    ///
    /// Une instruction par littéral — `sql_smoke` les prépare toutes contre le
    /// schéma, et refuse un lot de plusieurs instructions.
    fn peupler(conn: &Connection) {
        for instruction in [
            "INSERT INTO sessions (id, name, level_code, year_start)
                  VALUES ('s1', '4ème A', '4eme', 2026)",
            "INSERT INTO students (id, session_id, first_name, last_name, enrolled_on)
                  VALUES ('e1', 's1', 'Hugo', 'MARTIN', '2026-09-01'),
                         ('e2', 's1', 'Nadia', 'BOUMEDIENE', '2026-09-01')",
            "INSERT INTO timetable_slots
                 (id, year_start, session_id, label, room, weekday, start_time, end_time,
                  week_parity)
                  VALUES ('t1', 2026, 's1', 'Atelier', 'B12', 2, '08:00', '10:00', 'toutes'),
                         ('t2', 2026, NULL, 'Coordination', '', 2, '10:00', '11:00', 'toutes'),
                         ('t3', 2026, 's1', 'Quinzaine paire', '', 2, '14:00', '15:00', 'paires')",
            "INSERT INTO seances (id, session_id, slot_id, title, date, trimester,
                                  start_time, end_time, content_html)
                  VALUES ('c1', 's1', 't1', 'Atelier', '2026-11-17', 1,
                          '08:00', '10:00', '<p>Prise de mesures</p>'),
                         ('c2', 's1', NULL, 'Rattrapage', '2026-11-17', 1, '16:00', '17:00', '')",
            "INSERT INTO attendance_records (seance_id, student_id, status)
                  VALUES ('c1', 'e1', 'present')",
            "INSERT INTO agenda_entries (id, date, start_time, end_time, title, student_id,
                                         content_html)
                  VALUES ('a1', '2026-11-17', '14:00', '15:30', 'Visite de stage', 'e1',
                          '<p>Entretien avec le tuteur</p>')",
        ] {
            conn.execute_batch(instruction).unwrap();
        }
    }

    #[test]
    fn journee_assemblee_depuis_les_trois_sources() {
        let conn = migrated_db("journee");
        peupler(&conn);

        // Mardi 17 novembre 2026 : semaine ISO 47, impaire.
        let jour = day_schedule(&conn, date("2026-11-17")).unwrap();
        assert_eq!(jour.weekday, 2, "mardi");
        assert_eq!(jour.iso_week, 47);
        assert_eq!(jour.week_parity, "impaires");
        assert_eq!(jour.year_start, 2026, "novembre 2026 = année 2026-2027");
        assert_eq!(jour.trimester, 1);
        assert!(jour.show_parity, "un créneau de l'année porte une parité");

        // Le créneau de quinzaine paire ne sort PAS une semaine impaire.
        assert_eq!(jour.slots.len(), 2);
        assert_eq!(jour.slots[0].slot.label, "Atelier");
        assert_eq!(jour.slots[0].slot.session_name.as_deref(), Some("4ème A"));
        assert_eq!(jour.slots[1].slot.label, "Coordination");
        assert!(
            jour.slots[1].slot.session_id.is_none(),
            "un créneau sans classe n'a rien à ouvrir"
        );

        // La séance du créneau est rangée derrière lui, l'autre reste visible.
        let seance = jour.slots[0].seance.as_ref().expect("séance du créneau");
        assert_eq!(seance.id, "c1");
        assert!(seance.has_content);
        assert_eq!(seance.attendance_done, 1);
        assert_eq!(seance.attendance_total, 2, "un comptage, pas un booléen");
        assert!(jour.slots[1].seance.is_none());
        assert_eq!(jour.loose_seances.len(), 1);
        assert_eq!(jour.loose_seances[0].id, "c2");

        assert_eq!(jour.entries.len(), 1);
        assert_eq!(jour.entries[0].title, "Visite de stage");
        assert_eq!(jour.entries[0].student_last_name.as_deref(), Some("MARTIN"));
        assert!(jour.entries[0].has_content);
    }

    #[test]
    fn la_quinzaine_paire_sort_la_bonne_semaine() {
        let conn = migrated_db("quinzaine");
        peupler(&conn);

        // 24/11/2026 : mardi de la semaine 48, paire.
        let jour = day_schedule(&conn, date("2026-11-24")).unwrap();
        assert_eq!(jour.week_parity, "paires");
        let libelles: Vec<&str> = jour.slots.iter().map(|d| d.slot.label.as_str()).collect();
        assert_eq!(libelles, ["Atelier", "Coordination", "Quinzaine paire"]);
        assert!(jour.loose_seances.is_empty());
        assert!(jour.entries.is_empty());
    }

    #[test]
    fn une_lecture_de_journee_n_ecrit_rien() {
        let conn = migrated_db("lecture-pure");
        peupler(&conn);

        // `ensure_bounds` aurait semé la ligne 2026 au premier affichage.
        day_schedule(&conn, date("2026-11-17")).unwrap();
        let bornes: i64 = conn
            .query_row("SELECT COUNT(*) FROM trimester_bounds", [], |r| r.get(0))
            .unwrap();
        assert_eq!(bornes, 0, "aucune écriture pendant une lecture");
    }

    #[test]
    fn semaine_complete_de_lundi_a_dimanche() {
        let conn = migrated_db("semaine");
        peupler(&conn);

        // Un jour quelconque de la semaine ramène bien à son lundi.
        let semaine = week_schedule(&conn, monday_of(date("2026-11-19")).unwrap()).unwrap();
        assert_eq!(semaine.monday, "2026-11-16");
        assert_eq!(semaine.iso_week, 47);
        assert_eq!(semaine.days.len(), 7);
        assert_eq!(semaine.days[0].date, "2026-11-16");
        assert_eq!(semaine.days[6].date, "2026-11-22");
        // Tout est le mardi : deux créneaux, une entrée, une séance hors créneau.
        assert_eq!(semaine.days[1].slots.len(), 2);
        assert_eq!(semaine.days[1].entries.len(), 1);
        assert_eq!(semaine.days[1].loose_seances.len(), 1);
        assert!(semaine.days[0].slots.is_empty());
        assert!(semaine.days[2].slots.is_empty());
    }

    #[test]
    fn sans_creneau_de_quinzaine_le_numero_de_semaine_reste_cache() {
        let conn = migrated_db("sans-parite");
        conn.execute_batch(
            "INSERT INTO timetable_slots
                 (id, year_start, session_id, label, weekday, start_time, end_time)
              VALUES ('t1', 2026, NULL, 'Coordination', 2, '10:00', '11:00');",
        )
        .unwrap();
        let jour = day_schedule(&conn, date("2026-11-17")).unwrap();
        assert!(!jour.show_parity, "rien à afficher, rien à configurer");
    }
}
