use chrono::NaiveDate;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::timetable;
use crate::db;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct Seance {
    pub id: String,
    pub session_id: String,
    pub title: String,
    pub date: String,
    pub trimester: i32,
    pub trimester_is_manual: bool,
    pub cancelled: bool,
    pub content_html: String,
    pub attendance_taken_at: Option<String>,
    pub created_at: String,
    /// Créneau d'origine, ou `None` pour une séance saisie à la main — et pour
    /// toutes celles antérieures au palier 004. Le créneau supprimé remet ce
    /// champ à NULL sans jamais toucher à l'appel.
    pub slot_id: Option<String>,
    /// Horaire **recopié** à la création : il appartient au dossier historique,
    /// pas au modèle. `""` = séance hors créneau, ou antérieure au palier 004.
    pub start_time: String,
    pub end_time: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AttendanceWithStudent {
    pub student_id: String,
    pub student_first_name: String,
    pub student_last_name: String,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AttendanceInput {
    pub student_id: String,
    pub status: String,
}

/// Les cinq valeurs acceptées par le CHECK de `attendance_records.status`.
const ATTENDANCE_STATUSES: [&str; 5] = ["non_fait", "present", "absent", "retard", "excuse"];

/// Projection commune à toutes les lectures de séance.
///
/// **Elle, `map_seance` et la structure `Seance` se modifient du même geste** :
/// les indices de `row.get` sont codés en dur, et une colonne ajoutée ici sans
/// mappeur ne se voit qu'à l'exécution.
const SEANCE_COLUMNS: &str = "id, session_id, title, date, trimester, trimester_is_manual, \
                              cancelled, content_html, attendance_taken_at, created_at, \
                              slot_id, start_time, end_time";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn map_seance(row: &rusqlite::Row<'_>) -> rusqlite::Result<Seance> {
    Ok(Seance {
        id: row.get(0)?,
        session_id: row.get(1)?,
        title: row.get(2)?,
        date: row.get(3)?,
        trimester: row.get(4)?,
        trimester_is_manual: row.get(5)?,
        cancelled: row.get(6)?,
        content_html: row.get(7)?,
        attendance_taken_at: row.get(8)?,
        created_at: row.get(9)?,
        slot_id: row.get(10)?,
        start_time: row.get(11)?,
        end_time: row.get(12)?,
    })
}

fn load_seance(conn: &rusqlite::Connection, id: &str) -> Result<Seance, String> {
    let sql = format!("SELECT {SEANCE_COLUMNS} FROM seances WHERE id = ?1");
    conn.query_row(&sql, params![id], map_seance)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => "Séance introuvable".to_string(),
            other => other.to_string(),
        })
}

fn clean_title(title: &str) -> Result<String, String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err("Le titre de la séance est obligatoire".to_string());
    }
    Ok(trimmed.to_string())
}

/// Le CHECK du schéma rejetterait déjà un format invalide, mais avec un message
/// SQLite en anglais illisible pour l'enseignant : on valide donc en amont.
///
/// Et pas seulement la **forme** : le GLOB du schéma laisse passer un 31 février,
/// et un navigateur qui émet les valeurs intermédiaires d'un champ `type=date`
/// envoie « 0002-11-17 » pendant que l'année se tape chiffre par chiffre. On
/// parse donc réellement, par la même fonction que l'emploi du temps — une seule
/// implémentation de la règle.
fn check_date(date: &str) -> Result<NaiveDate, String> {
    timetable::parse_date(date, "La date de la séance")
}

/// Refuse une date hors de l'**année scolaire de la classe**.
///
/// `check_date` ne juge que le calendrier : rien ne disait jusqu'ici qu'une
/// séance du 1er mai 2028 ne pouvait pas s'écrire sur une classe de 2026-2027.
/// Elle y était classée en silence — `trimester_for` est une fonction totale,
/// toute date postérieure au T3 rend 3 — puis comptée dans `seance_counts` et au
/// dénominateur d'assiduité de tous les élèves inscrits, sur un bilan remis aux
/// familles. Une année mal frappée ne doit pas se lire six mois plus tard sur un
/// pourcentage.
///
/// La frontière est celle de `year_start_for`, seule définition de l'année
/// scolaire du projet : bascule au 1er août. Elle laisse donc entrer la
/// prérentrée d'août et le rattrapage de juillet, que `trimester_for` range
/// volontairement en T1 et en T3.
///
/// C'est l'exact pendant de `check_session_year` pour les créneaux, et elle
/// rend le même « Classe introuvable » pour une classe qui n'existe pas.
fn check_session_year(
    conn: &rusqlite::Connection,
    session_id: &str,
    date: NaiveDate,
) -> Result<(), String> {
    let trouvee: Option<(String, i32)> = conn
        .query_row(
            "SELECT name, year_start FROM sessions WHERE id = ?1",
            params![session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let (nom, annee) = trouvee.ok_or_else(|| "Classe introuvable".to_string())?;
    let annee_date = timetable::year_start_for(date);
    if annee_date == annee {
        return Ok(());
    }
    Err(format!(
        "La date {date} n'appartient pas à l'année scolaire {annee}-{}, celle de la \
         classe « {nom} », mais à {annee_date}-{}. Corrigez la date, ou créez cette \
         séance dans une classe de l'année concernée.",
        annee + 1,
        annee_date + 1
    ))
}

/// `db::resolve_trimester` ignore silencieusement un trimestre forcé hors 1..3 et
/// retombe sur le calcul : l'enseignant croirait sa correction prise en compte.
fn check_forced_trimester(trimester: Option<i32>) -> Result<(), String> {
    match trimester {
        Some(value) if !(1..=3).contains(&value) => Err(format!(
            "Trimestre invalide : {value}. Choisissez 1, 2 ou 3, ou laissez SGPA le \
             déduire de la date."
        )),
        _ => Ok(()),
    }
}

fn check_status(status: &str) -> Result<(), String> {
    if ATTENDANCE_STATUSES.contains(&status) {
        Ok(())
    } else {
        Err(format!(
            "Statut d'assiduité inconnu : « {status} ». Valeurs attendues : non_fait, \
             present, absent, retard, excuse."
        ))
    }
}

/// Pose l'horodatage « l'appel a été fait ce jour-là » et signale au passage une
/// séance inexistante, avant toute écriture dans `attendance_records`.
fn mark_attendance_taken(conn: &rusqlite::Connection, seance_id: &str) -> Result<(), String> {
    let touched = conn
        .execute(
            "UPDATE seances
                SET attendance_taken_at = datetime('now'), updated_at = datetime('now')
              WHERE id = ?1",
            params![seance_id],
        )
        .map_err(|e| e.to_string())?;
    if touched == 0 {
        return Err("Séance introuvable".to_string());
    }
    Ok(())
}

/// Ce qu'un créneau apporte à la séance fabriquée depuis lui : classe
/// (facultative), libellé, heure de début, heure de fin, nom de la classe.
type SlotForSeance = (Option<String>, String, String, String, Option<String>);

/// Traduit la violation de l'index unique `(slot_id, date)`.
///
/// Le projet ne lit jamais le texte d'une erreur SQLite — il filtre sur le code,
/// comme `commands/referential.rs`. Sur cette requête, la seule contrainte qu'une
/// saisie déjà validée puisse encore heurter est cet index.
fn slot_conflict_error(err: rusqlite::Error) -> String {
    if let rusqlite::Error::SqliteFailure(inner, _) = &err {
        if inner.code == rusqlite::ErrorCode::ConstraintViolation {
            return "Une séance de ce créneau existe déjà à cette date. Changez la \
                    date, ou ouvrez la séance existante depuis l'emploi du temps."
                .to_string();
        }
    }
    err.to_string()
}

/// Le passage obligé des **trois** écritures de séance : le cours saisi à la
/// main, l'occurrence d'un créneau, et la modification d'en-tête.
///
/// Il vaut mieux que le garde-fou d'année vive ici : posé dans chaque appelant,
/// il aurait manqué au quatrième. `jour` est la date déjà parsée, `date` la même
/// au format ISO — `resolve_trimester` compare des chaînes.
fn resolve_or_explain(
    conn: &rusqlite::Connection,
    session_id: &str,
    date: &str,
    jour: NaiveDate,
    forced: Option<i32>,
) -> Result<(i32, bool), String> {
    check_session_year(conn, session_id, jour)?;
    db::resolve_trimester(conn, session_id, date, forced).map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => "Classe introuvable".to_string(),
        other => other.to_string(),
    })
}

// ---------------------------------------------------------------------------
// Séances
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_seances(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Vec<Seance>, String> {
    let conn = state.conn()?;
    let sql = format!(
        "SELECT {SEANCE_COLUMNS} FROM seances
          WHERE session_id = ?1
          ORDER BY date DESC, start_time DESC, created_at DESC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let seances = stmt
        .query_map(params![session_id], map_seance)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(seances)
}

/// Crée une séance **saisie à la main**, hors de tout modèle hebdomadaire :
/// celle de la fiche de classe, et le cours ponctuel de l'emploi du temps —
/// remplacement d'un collègue absent, séance exceptionnelle.
///
/// `slot_id` reste NULL, et ce n'est pas un oubli : cette séance n'est
/// l'occurrence d'aucun créneau, donc l'index unique `(slot_id, date)` ne la
/// concerne pas. Deux cours ponctuels le même jour dans la même classe sont
/// légitimes — deux remplacements, ça arrive.
///
/// L'horaire est **facultatif** : absent comme vide, il vaut « sans horaire »,
/// exactement comme partout ailleurs dans le schéma. La fiche de classe n'en
/// donne pas, la grille de l'emploi du temps en donne un — et sans ces deux
/// paramètres, une séance tracée de 14h à 16h perdait ses heures en route.
#[tauri::command]
pub fn create_seance(
    state: tauri::State<'_, AppState>,
    session_id: String,
    title: String,
    date: String,
    start_time: Option<String>,
    end_time: Option<String>,
    trimester: Option<i32>,
) -> Result<Seance, String> {
    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let seance = insert_seance(
        &tx,
        &session_id,
        &title,
        &date,
        start_time.as_deref().unwrap_or_default(),
        end_time.as_deref().unwrap_or_default(),
        trimester,
    )?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(seance)
}

/// Le corps de `create_seance`, appelable sur une transaction — c'est ce qui
/// permet de l'éprouver sans harnais Tauri, comme `seance_from_slot`.
fn insert_seance(
    conn: &rusqlite::Connection,
    session_id: &str,
    title: &str,
    date: &str,
    start_time: &str,
    end_time: &str,
    trimester: Option<i32>,
) -> Result<Seance, String> {
    let title = clean_title(title)?;
    let jour = check_date(date)?;
    check_forced_trimester(trimester)?;
    // Mêmes règles d'horaire que `update_seance_meta` et que l'emploi du temps,
    // par les mêmes fonctions : deux implémentations de la même règle
    // divergeraient au premier ajustement.
    let start_time = timetable::parse_optional_time(start_time, "L'heure de début")?;
    let end_time = timetable::parse_optional_time(end_time, "L'heure de fin")?;
    timetable::check_time_order(&start_time, &end_time)?;

    // `resolve_trimester` crée au besoin les bornes de l'année : cette écriture
    // doit vivre dans la même transaction que la séance qu'elle sert à classer.
    let (trimester, is_manual) = resolve_or_explain(conn, session_id, date, jour, trimester)?;

    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO seances (id, session_id, title, date, start_time, end_time,
                              trimester, trimester_is_manual)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id, session_id, title, date, start_time, end_time, trimester, is_manual
        ],
    )
    .map_err(|e| e.to_string())?;

    // AUCUN enregistrement d'appel n'est créé ici, volontairement. L'ancienne
    // version pré-remplissait toute la classe en « présent » : l'enseignant qui
    // oubliait l'appel obtenait une assiduité parfaite, et un élève inscrit après
    // coup n'était compté nulle part. L'absence de ligne vaut désormais
    // « non renseigné », ce que le bilan sait dire.
    load_seance(conn, &id)
}

/// Titre, date, horaire, trimestre, annulation — **jamais** le cahier de texte.
///
/// La séparation d'avec `update_seance_content` est ce qui rend impossible, côté
/// serveur, l'écrasement mutuel : l'écran qui édite l'en-tête ne renvoyait pas le
/// contenu HTML et l'effaçait donc à chaque enregistrement.
///
/// L'horaire est ici et pas ailleurs : c'est la même famille de colonnes et le
/// même écran d'en-tête. Sans lui, une séance créée avec un mauvais horaire le
/// garderait pour toujours.
// Huit paramètres : ce sont les champs d'un formulaire, et la signature d'une
// commande Tauri EST le contrat du front. Les regrouper en structure rendrait
// l'appel plus opaque qu'il ne l'est.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn update_seance_meta(
    state: tauri::State<'_, AppState>,
    id: String,
    title: String,
    date: String,
    start_time: String,
    end_time: String,
    trimester: Option<i32>,
    cancelled: bool,
) -> Result<Seance, String> {
    let title = clean_title(&title)?;
    let jour = check_date(&date)?;
    check_forced_trimester(trimester)?;
    // Mêmes règles d'horaire que l'emploi du temps, et une seule implémentation :
    // deux copies de la même règle divergeraient au premier ajustement.
    let start_time = timetable::parse_optional_time(&start_time, "L'heure de début")?;
    let end_time = timetable::parse_optional_time(&end_time, "L'heure de fin")?;
    timetable::check_time_order(&start_time, &end_time)?;

    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // La classe n'est pas modifiable : on la relit sur la ligne existante plutôt
    // que de faire confiance à l'appelant.
    let session_id: String = tx
        .query_row(
            "SELECT session_id FROM seances WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => "Séance introuvable".to_string(),
            other => other.to_string(),
        })?;

    let (trimester, is_manual) = resolve_or_explain(&tx, &session_id, &date, jour, trimester)?;

    tx.execute(
        "UPDATE seances
            SET title = ?1, date = ?2, start_time = ?3, end_time = ?4, trimester = ?5,
                trimester_is_manual = ?6, cancelled = ?7, updated_at = datetime('now')
          WHERE id = ?8",
        params![title, date, start_time, end_time, trimester, is_manual, cancelled, id],
    )
    .map_err(slot_conflict_error)?;

    let seance = load_seance(&tx, &id)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(seance)
}

/// Fabrique l'occurrence d'un créneau à une date donnée.
///
/// Elle vit ici, et non dans `commands/timetable.rs` : `seances` garde une porte
/// d'écriture unique, et cette commande réutilise `clean_title`, `check_date` et
/// `resolve_or_explain`.
///
/// `cancelled = true`, c'est « ce cours n'a pas lieu » : la séance naît annulée,
/// donc hors du dénominateur d'assiduité de toute la classe
/// (`commands/reports.rs`). C'est la seule écriture à la fois fréquente et
/// totalement inoffensive pour les chiffres du bilan.
///
/// **Idempotente** : si la séance existe déjà, elle est renvoyée telle quelle —
/// deux clics ne doublent jamais le dénominateur.
#[tauri::command]
pub fn create_seance_from_slot(
    state: tauri::State<'_, AppState>,
    slot_id: String,
    date: String,
    cancelled: bool,
) -> Result<Seance, String> {
    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    // La date se valide dans `seance_from_slot` et non ici : les tests appellent
    // le corps directement, et une garde posée sur la seule commande n'aurait
    // pas été éprouvée.
    let seance = seance_from_slot(&tx, &slot_id, &date, cancelled)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(seance)
}

/// Le corps de `create_seance_from_slot`, appelable sur une transaction — c'est
/// ce qui permet de l'éprouver sans harnais Tauri.
fn seance_from_slot(
    conn: &rusqlite::Connection,
    slot_id: &str,
    date: &str,
    cancelled: bool,
) -> Result<Seance, String> {
    let jour = check_date(date)?;

    let creneau: Option<SlotForSeance> = conn
        .query_row(
            "SELECT ts.session_id, ts.label, ts.start_time, ts.end_time, s.name
               FROM timetable_slots ts
               LEFT JOIN sessions s ON s.id = ts.session_id
              WHERE ts.id = ?1",
            params![slot_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let (session_id, label, start_time, end_time, session_name) =
        creneau.ok_or_else(|| "Créneau introuvable".to_string())?;

    let session_id = session_id.ok_or_else(|| {
        "Ce créneau n'est rattaché à aucune classe : il n'y a rien à ouvrir derrière un \
         modèle. Pour écrire quelque chose ce jour-là, créez une entrée datée."
            .to_string()
    })?;

    // Le libellé du créneau titre la séance ; repli sur le nom de la classe pour
    // un créneau créé avant que le libellé ne soit exigé.
    let title = clean_title(&label)
        .or_else(|_| clean_title(session_name.as_deref().unwrap_or_default()))?;

    let (trimester, is_manual) = resolve_or_explain(conn, &session_id, date, jour, None)?;

    let id = Uuid::new_v4().to_string();
    // La clause `WHERE slot_id IS NOT NULL` répète celle de l'index partiel : sans
    // elle, SQLite refuse la requête dès la préparation.
    conn.execute(
        "INSERT INTO seances (id, session_id, slot_id, title, date, start_time, end_time,
                              trimester, trimester_is_manual, cancelled)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(slot_id, date) WHERE slot_id IS NOT NULL DO NOTHING",
        params![
            id, session_id, slot_id, title, date, start_time, end_time, trimester, is_manual,
            cancelled
        ],
    )
    .map_err(|e| e.to_string())?;

    // Relecture par (créneau, date) et non par `id` : en cas de conflit rien n'a
    // été inséré, et c'est la séance déjà là qu'il faut ouvrir.
    let sql = format!("SELECT {SEANCE_COLUMNS} FROM seances WHERE slot_id = ?1 AND date = ?2");
    conn.query_row(&sql, params![slot_id, date], map_seance)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => "Séance introuvable".to_string(),
            other => other.to_string(),
        })
}

/// Cahier de texte seul. Voir `update_seance_meta` pour la raison de la scission.
#[tauri::command]
pub fn update_seance_content(
    state: tauri::State<'_, AppState>,
    id: String,
    content_html: String,
) -> Result<(), String> {
    let conn = state.conn()?;
    let touched = conn
        .execute(
            "UPDATE seances
                SET content_html = ?1, updated_at = datetime('now')
              WHERE id = ?2",
            params![content_html, id],
        )
        .map_err(|e| e.to_string())?;
    if touched == 0 {
        return Err("Séance introuvable".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn delete_seance(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.conn()?;
    // Les enregistrements d'appel partent en cascade (schéma, table 11).
    conn.execute("DELETE FROM seances WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Appel
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_attendance(
    state: tauri::State<'_, AppState>,
    seance_id: String,
) -> Result<Vec<AttendanceWithStudent>, String> {
    let conn = state.conn()?;

    // La liste est bornée par la période d'inscription : un élève arrivé en
    // janvier n'a pas à figurer dans l'appel d'une séance d'octobre. Et l'absence
    // d'enregistrement vaut 'non_fait', plus jamais 'present' — ce défaut-là
    // fabriquait de l'assiduité parfaite à partir de rien.
    let mut stmt = conn
        .prepare(
            "SELECT st.id, st.first_name, st.last_name, COALESCE(ar.status, 'non_fait')
               FROM seances se
               JOIN students st ON st.session_id = se.session_id
                               AND st.enrolled_on <= se.date
                               AND (st.left_on IS NULL OR se.date <= st.left_on)
               LEFT JOIN attendance_records ar ON ar.student_id = st.id
                                              AND ar.seance_id = se.id
              WHERE se.id = ?1
              ORDER BY st.last_name, st.first_name",
        )
        .map_err(|e| e.to_string())?;

    let records = stmt
        .query_map(params![seance_id], |row| {
            Ok(AttendanceWithStudent {
                student_id: row.get(0)?,
                student_first_name: row.get(1)?,
                student_last_name: row.get(2)?,
                status: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(records)
}

#[tauri::command]
pub fn set_attendance(
    state: tauri::State<'_, AppState>,
    seance_id: String,
    student_id: String,
    status: String,
) -> Result<(), String> {
    check_status(&status)?;

    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    mark_attendance_taken(&tx, &seance_id)?;
    tx.execute(
        "INSERT INTO attendance_records (seance_id, student_id, status, recorded_at)
         VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT(seance_id, student_id)
         DO UPDATE SET status = excluded.status, recorded_at = excluded.recorded_at",
        params![seance_id, student_id, status],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_bulk_attendance(
    state: tauri::State<'_, AppState>,
    seance_id: String,
    records: Vec<AttendanceInput>,
) -> Result<(), String> {
    // Une charge utile vide ne prouve aucun appel : on ne pose pas l'horodatage.
    if records.is_empty() {
        return Ok(());
    }

    // Tout est validé avant la moindre écriture : un seul statut fautif ne doit pas
    // laisser un appel à moitié enregistré.
    for record in &records {
        check_status(&record.status)?;
    }

    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    mark_attendance_taken(&tx, &seance_id)?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO attendance_records (seance_id, student_id, status, recorded_at)
                 VALUES (?1, ?2, ?3, datetime('now'))
                 ON CONFLICT(seance_id, student_id)
                 DO UPDATE SET status = excluded.status, recorded_at = excluded.recorded_at",
            )
            .map_err(|e| e.to_string())?;
        for record in &records {
            stmt.execute(params![seance_id, record.student_id, record.status])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Efface l'appel d'une séance et le ramène à « jamais fait ».
#[tauri::command]
pub fn reset_attendance(
    state: tauri::State<'_, AppState>,
    seance_id: String,
) -> Result<(), String> {
    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let touched = tx
        .execute(
            "UPDATE seances
                SET attendance_taken_at = NULL, updated_at = datetime('now')
              WHERE id = ?1",
            params![seance_id],
        )
        .map_err(|e| e.to_string())?;
    if touched == 0 {
        return Err("Séance introuvable".to_string());
    }

    tx.execute(
        "DELETE FROM attendance_records WHERE seance_id = ?1",
        params![seance_id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn migrated_db(nom: &str) -> Connection {
        let dir = std::env::temp_dir().join(format!("sgpa-seances-{nom}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = Connection::open(dir.join("sgpa.db")).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::db::migrations::run(&mut conn, &dir).unwrap();
        for instruction in [
            "INSERT INTO sessions (id, name, level_code, year_start)
                  VALUES ('s1', '4ème A', '4eme', 2026)",
            "INSERT INTO timetable_slots
                 (id, year_start, session_id, label, room, weekday, start_time, end_time)
                  VALUES ('t1', 2026, 's1', 'Atelier', 'B12', 2, '08:00', '10:00')",
            "INSERT INTO timetable_slots
                 (id, year_start, session_id, label, weekday, start_time, end_time)
                  VALUES ('t2', 2026, NULL, 'Coordination', 2, '10:00', '11:00')",
        ] {
            conn.execute_batch(instruction).unwrap();
        }
        conn
    }

    fn compte(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM seances", [], |r| r.get(0))
            .unwrap()
    }

    /// LE point irréversible du palier : deux clics sur « Créer et ouvrir » ne
    /// doivent jamais fabriquer deux appels pour le même cours, sans quoi le
    /// dénominateur d'assiduité du bilan double en silence.
    #[test]
    fn deux_clics_ne_fabriquent_qu_une_seule_seance() {
        let conn = migrated_db("idempotence");

        let premiere = seance_from_slot(&conn, "t1", "2026-11-17", false).unwrap();
        assert_eq!(premiere.title, "Atelier", "le libellé du créneau titre");
        assert_eq!(premiere.start_time, "08:00", "l'horaire est recopié");
        assert_eq!(premiere.end_time, "10:00");
        assert_eq!(premiere.slot_id.as_deref(), Some("t1"));
        assert_eq!(premiere.trimester, 1, "trimestre déduit de la date");
        assert!(!premiere.cancelled);
        assert_eq!(compte(&conn), 1);

        let seconde = seance_from_slot(&conn, "t1", "2026-11-17", false).unwrap();
        assert_eq!(
            seconde.id, premiere.id,
            "c'est la séance déjà là qu'on ouvre"
        );
        assert_eq!(compte(&conn), 1, "un second appel n'a pas été créé");

        // Une autre date reste un autre cours.
        seance_from_slot(&conn, "t1", "2026-11-24", false).unwrap();
        assert_eq!(compte(&conn), 2);
    }

    /// « Ce cours n'a pas lieu » : la séance naît annulée, donc hors du
    /// dénominateur d'assiduité de toute la classe.
    #[test]
    fn ce_cours_n_a_pas_lieu_cree_une_seance_annulee() {
        let conn = migrated_db("annulee");
        let seance = seance_from_slot(&conn, "t1", "2026-11-17", true).unwrap();
        assert!(seance.cancelled);
    }

    #[test]
    fn un_creneau_sans_classe_n_a_rien_a_ouvrir() {
        let conn = migrated_db("sans-classe");
        let err = seance_from_slot(&conn, "t2", "2026-11-17", false).unwrap_err();
        assert!(err.contains("entrée datée"), "message : {err}");
        assert_eq!(compte(&conn), 0);

        let err = seance_from_slot(&conn, "inconnu", "2026-11-17", false).unwrap_err();
        assert_eq!(err, "Créneau introuvable");
    }

    /// Le cours ponctuel — un remplacement, une séance exceptionnelle. Il porte
    /// son horaire, il n'est l'occurrence d'aucun créneau, et un horaire mal
    /// formé est refusé en français avant toute écriture.
    #[test]
    fn un_cours_ponctuel_porte_son_horaire_et_ne_tient_a_aucun_creneau() {
        let conn = migrated_db("ponctuel");

        let avec = insert_seance(
            &conn,
            "s1",
            "  Remplacement de M. Durand  ",
            "2026-11-17",
            "14:00",
            "16:00",
            None,
        )
        .unwrap();
        assert_eq!(avec.title, "Remplacement de M. Durand", "titre nettoyé");
        assert_eq!(avec.start_time, "14:00", "l'horaire saisi est conservé");
        assert_eq!(avec.end_time, "16:00");
        assert_eq!(avec.slot_id, None, "aucun modèle hebdomadaire derrière");
        assert_eq!(avec.trimester, 1, "trimestre déduit de la date");
        assert!(!avec.trimester_is_manual);
        assert!(!avec.cancelled, "un cours ponctuel a bien lieu");

        // La fiche de classe n'a pas de champ horaire : elle ne doit pas en
        // hériter d'un par accident.
        let sans = insert_seance(&conn, "s1", "Séance du jour", "2026-11-18", "", "", None).unwrap();
        assert_eq!(sans.start_time, "");
        assert_eq!(sans.end_time, "");

        // Deux cours ponctuels le même jour restent possibles : l'index unique
        // porte sur (créneau, date), et il n'y a pas de créneau ici.
        insert_seance(&conn, "s1", "Second remplacement", "2026-11-17", "", "", None).unwrap();
        assert_eq!(compte(&conn), 3);

        let err =
            insert_seance(&conn, "s1", "Bancal", "2026-11-19", "14h", "16:00", None).unwrap_err();
        assert!(err.contains("L'heure de début"), "message : {err}");
        assert!(err.contains("HH:MM"), "message : {err}");

        let err =
            insert_seance(&conn, "s1", "Bancal", "2026-11-19", "16:00", "14:00", None).unwrap_err();
        assert!(err.starts_with("L'heure de fin"), "message : {err}");

        assert_eq!(compte(&conn), 3, "aucun refus n'a laissé de séance derrière");
    }

    /// Une date hors de l'année scolaire de la classe est refusée, sur les
    /// **trois** portes d'écriture.
    ///
    /// Sans cette garde, `trimester_for` — fonction totale — rangeait le 1er mai
    /// 2028 en T3 de 2026-2027 sans un mot : la séance gonflait
    /// `seances_trimestre` et entrait au dénominateur d'assiduité de toute la
    /// classe, sur un bilan remis aux familles. Le cas n'est pas théorique : un
    /// champ `type=date` émet « 0002-11-17 » pendant que l'année se tape.
    #[test]
    fn une_date_hors_de_l_annee_de_la_classe_est_refusee() {
        let conn = migrated_db("annee-hors-bornes");

        // Trop tard d'un an : la classe est en 2026-2027.
        let err = insert_seance(&conn, "s1", "Égaré", "2028-05-01", "", "", None).unwrap_err();
        assert!(err.contains("2026-2027"), "l'année de la classe : {err}");
        assert!(err.contains("2028-05-01"), "la date reçue : {err}");
        // Mai 2028 appartient à l'année scolaire 2027-2028 : la bascule est au
        // 1er août, et le message le dit plutôt que de laisser croire à 2028-2029.
        assert!(err.contains("2027-2028"), "l'année de la date : {err}");

        // L'année tapée chiffre par chiffre passe par des valeurs bien formées.
        let err = insert_seance(&conn, "s1", "Égaré", "0202-11-17", "", "", None).unwrap_err();
        assert!(err.contains("2026-2027"), "message : {err}");

        // Le 31 février a la bonne forme et n'existe pas : le GLOB du schéma le
        // laissait passer.
        let err = insert_seance(&conn, "s1", "Égaré", "2026-02-31", "", "", None).unwrap_err();
        assert!(err.contains("n'est pas une date valide"), "message : {err}");

        // L'occurrence d'un créneau est gardée par la même fonction.
        let err = seance_from_slot(&conn, "t1", "2028-05-01", false).unwrap_err();
        assert!(err.contains("2026-2027"), "message : {err}");

        assert_eq!(compte(&conn), 0, "aucun refus n'a laissé de séance derrière");

        // Les deux bords de l'année scolaire restent ouverts : `year_start_for`
        // bascule au 1er août, et `trimester_for` range volontairement la
        // prérentrée d'août en T1 et le rattrapage de juillet en T3.
        let aout = insert_seance(&conn, "s1", "Prérentrée", "2026-08-25", "", "", None).unwrap();
        assert_eq!(aout.trimester, 1);
        let juillet = insert_seance(&conn, "s1", "Rattrapage", "2027-07-20", "", "", None).unwrap();
        assert_eq!(juillet.trimester, 3);
        assert_eq!(compte(&conn), 2);

        // Et la modification d'en-tête ne peut pas faire sortir une séance de
        // l'année par la fenêtre.
        let err = super::check_session_year(
            &conn,
            "s1",
            NaiveDate::from_ymd_opt(2027, 8, 1).unwrap(),
        )
        .unwrap_err();
        assert!(err.contains("2027-2028"), "message : {err}");
    }

    /// L'index unique est vivant, et ce que l'enseignant lit est du français.
    #[test]
    fn deux_seances_du_meme_creneau_le_meme_jour_sont_refusees_en_francais() {
        let conn = migrated_db("conflit");
        seance_from_slot(&conn, "t1", "2026-11-17", false).unwrap();

        // Déplacer une autre séance sur ce couple (créneau, date) — exactement ce
        // que fait `update_seance_meta` quand on change la date.
        let erreur = conn
            .execute(
                "INSERT INTO seances (id, session_id, slot_id, title, date, trimester)
                 VALUES ('autre', 's1', 't1', 'Doublon', '2026-11-17', 1)",
                [],
            )
            .unwrap_err();
        let message = slot_conflict_error(erreur);
        assert!(
            message.starts_with("Une séance de ce créneau existe déjà à cette date."),
            "message : {message}"
        );
        assert!(message.contains("ouvrez la séance existante"));
    }
}
