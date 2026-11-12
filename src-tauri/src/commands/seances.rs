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
    /// Pourquoi ce cours n'a pas eu lieu. `""` = pas de motif.
    ///
    /// Texte libre, et AUCUN calcul ne s'appuie dessus : c'est `cancelled` seul
    /// qui sort la séance du dénominateur d'assiduité. Ce champ ne s'imprime sur
    /// aucun bilan — note de travail pour l'enseignant, pas information due aux
    /// familles.
    pub cancel_reason: String,
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
    /// Quand l'enseignant a déclaré qu'il n'y avait **rien à écrire** au cahier
    /// de texte, ou `None` s'il n'a rien déclaré.
    ///
    /// Ce n'est pas une annulation : la séance a eu lieu, l'appel y compte. Elle
    /// sort seulement de la liste « À reprendre » de l'accueil, qui autrement
    /// réclamerait éternellement le compte rendu d'une évaluation surveillée ou
    /// d'une sortie. Un horodatage et non un booléen, comme
    /// `attendance_taken_at` : l'écran peut dire *quand* la décision a été
    /// prise, ce qu'un drapeau muet ne sait pas faire trois mois après.
    pub content_waived_at: Option<String>,
    /// Vrai si au moins une pièce jointe pend à cette séance.
    ///
    /// **Dérivé, jamais écrit** : aucune commande ne le reçoit, il est recalculé
    /// à chaque lecture par un `EXISTS` de `SEANCE_COLUMNS`. Il n'est là que
    /// pour la liste de la fiche de classe, qui doit dire « réglé » d'une séance
    /// dont la photo du tableau EST le compte rendu — sans lui, elle réclamait
    /// un cahier que l'accueil avait cessé de demander.
    ///
    /// Un compte et non un booléen aurait été une seconde vérité à côté de
    /// `list_seance_attachments`, et celle-ci serait périmée la moitié du temps.
    pub has_attachment: bool,
    /// Le groupe que ce cours a réuni, ou `None` pour « toute la classe ».
    ///
    /// **C'est un fait et non un réglage** (palier 023) : il décide qui a été
    /// appelé, et il retire la séance du dénominateur d'assiduité des élèves de
    /// l'autre groupe. D'où le `RESTRICT` du schéma — un groupe supprimé
    /// n'efface pas cette colonne, sans quoi un bilan déjà rendu changerait de
    /// chiffres sans que personne ne l'ait demandé.
    ///
    /// Il est **recopié du créneau** à la naissance d'une occurrence, et jamais
    /// relu de lui ensuite : l'enseignant qui corrige la semaine A de son
    /// emploi du temps ne réécrit pas les appels déjà faits.
    pub group_id: Option<String>,
    /// Le nom du groupe, joint à la lecture pour que l'écran n'ait pas à
    /// recroiser la liste des groupes pour afficher trois caractères.
    ///
    /// **Dérivé, jamais écrit**, comme `has_attachment`.
    pub group_name: Option<String>,
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
                              slot_id, start_time, end_time, cancel_reason, content_waived_at, \
                              EXISTS (SELECT 1 FROM seance_attachments sat \
                                      WHERE sat.seance_id = seances.id), \
                              group_id, \
                              (SELECT g.name FROM student_groups g \
                                WHERE g.id = seances.group_id)";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Le motif d'annulation retenu pour une séance.
///
/// Une séance qui a lieu n'a pas de raison de ne pas avoir eu lieu : le motif
/// est alors vidé, et non conservé « au cas où ». Décocher l'annulation puis la
/// recocher repart donc d'un champ vide, ce qui est le comportement honnête —
/// un motif ressorti tout seul après un aller-retour serait une affirmation que
/// l'enseignant n'a pas refaite.
///
/// Cette règle vit ici, dans une fonction, plutôt que dans un `CHECK` : un CHECK
/// ferait échouer la décoche sur la phrase brute de SQLite, en anglais, et ne se
/// retire jamais ensuite. Et elle est extraite plutôt qu'écrite deux fois dans
/// les deux chemins d'écriture, parce que `update_seance_meta` est une commande
/// Tauri — non appelable en test, donc jamais éprouvée si la règle y reste.
fn motif_retenu(cancelled: bool, cancel_reason: &str) -> String {
    if cancelled {
        cancel_reason.trim().to_string()
    } else {
        String::new()
    }
}

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
        // Lu en DERNIER, et non à côté de `cancelled` auquel il appartient :
        // les indices de `row.get` sont codés en dur, et insérer une colonne au
        // milieu décalerait en silence les six suivantes. Une colonne ajoutée se
        // lit à la fin.
        cancel_reason: row.get(13)?,
        content_waived_at: row.get(14)?,
        has_attachment: row.get(15)?,
        group_id: row.get(16)?,
        group_name: row.get(17)?,
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
/// (facultative), libellé, heure de début, heure de fin, nom de la classe,
/// groupe (facultatif).
type SlotForSeance = (
    Option<String>,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
);

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
#[allow(clippy::too_many_arguments)]
pub fn create_seance(
    state: tauri::State<'_, AppState>,
    session_id: String,
    title: String,
    date: String,
    start_time: Option<String>,
    end_time: Option<String>,
    trimester: Option<i32>,
    // Absent comme nul, il vaut « toute la classe » : un front qui ne connaît
    // pas encore les groupes continue de créer des séances de classe entière.
    group_id: Option<String>,
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
        group_id.as_deref(),
    )?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(seance)
}

/// Le corps de `create_seance`, appelable sur une transaction — c'est ce qui
/// permet de l'éprouver sans harnais Tauri, comme `seance_from_slot`.
#[allow(clippy::too_many_arguments)]
fn insert_seance(
    conn: &rusqlite::Connection,
    session_id: &str,
    title: &str,
    date: &str,
    start_time: &str,
    end_time: &str,
    trimester: Option<i32>,
    group_id: Option<&str>,
) -> Result<Seance, String> {
    let title = clean_title(title)?;
    let jour = check_date(date)?;
    check_forced_trimester(trimester)?;
    // La clé étrangère ne pointe que `student_groups(id)` : elle accepterait le
    // groupe d'une AUTRE classe, et cette séance-là viderait le dénominateur de
    // tout le monde sans qu'aucune contrainte ne proteste. Le contrôle vit donc
    // en Rust, en un seul endroit, partagé par tout ce qui écrit un groupe.
    super::groups::check_group_belongs(conn, session_id, group_id)?;
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
                              trimester, trimester_is_manual, group_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id,
            session_id,
            title,
            date,
            start_time,
            end_time,
            trimester,
            is_manual,
            group_id
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
///
/// Le **groupe** l'est aussi, et il s'écrit **sans condition** — contrairement à
/// l'horaire, que la fiche ne laisse corriger que pour un cours ponctuel. Une
/// occurrence née d'un créneau tient son heure du modèle hebdomadaire, qui se
/// corrige à l'emploi du temps et pour toutes les semaines à la fois ; son
/// groupe, lui, est un **fait** de cette séance-là — « cette semaine, le groupe
/// 2 n'est pas venu » ne doit pas réécrire toutes les autres. Corollaire
/// identique à celui de l'horaire : **tout appelant le fait transiter
/// inchangé**, sans quoi un simple renommage rendrait la séance à la classe
/// entière et rouvrirait l'appel de l'autre groupe.
// Neuf paramètres : ce sont les champs d'un formulaire, et la signature d'une
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
    cancel_reason: String,
    group_id: Option<String>,
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

    super::groups::check_group_belongs(&tx, &session_id, group_id.as_deref())?;

    let (trimester, is_manual) = resolve_or_explain(&tx, &session_id, &date, jour, trimester)?;

    // Le motif ne survit pas à la levée de l'annulation : « ce cours a bien eu
    // lieu, finalement » ne doit pas laisser derrière lui un « Sortie scolaire »
    // que plus aucun écran n'affiche. C'est fait ICI et non par un CHECK : un
    // CHECK ferait échouer la décoche sur la phrase brute de SQLite, en anglais,
    // et ne se retire jamais ensuite.
    let cancel_reason = motif_retenu(cancelled, &cancel_reason);

    tx.execute(
        "UPDATE seances
            SET title = ?1, date = ?2, start_time = ?3, end_time = ?4, trimester = ?5,
                trimester_is_manual = ?6, cancelled = ?7, cancel_reason = ?8, group_id = ?9,
                updated_at = datetime('now')
          WHERE id = ?10",
        params![
            title,
            date,
            start_time,
            end_time,
            trimester,
            is_manual,
            cancelled,
            cancel_reason,
            group_id,
            id
        ],
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
    // Motif, pour « ce cours n'a pas lieu ». Ignoré quand `cancelled` est faux :
    // une séance qui a lieu n'a pas de raison de ne pas avoir eu lieu.
    cancel_reason: String,
) -> Result<Seance, String> {
    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    // La date se valide dans `seance_from_slot` et non ici : les tests appellent
    // le corps directement, et une garde posée sur la seule commande n'aurait
    // pas été éprouvée.
    let seance = seance_from_slot(&tx, &slot_id, &date, cancelled, &cancel_reason)?;
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
    cancel_reason: &str,
) -> Result<Seance, String> {
    let jour = check_date(date)?;

    let creneau: Option<SlotForSeance> = conn
        .query_row(
            "SELECT ts.session_id, ts.label, ts.start_time, ts.end_time, s.name, ts.group_id
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
                    row.get(5)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    // Le groupe est **recopié**, comme l'horaire, et pour la même raison : il
    // appartient au dossier historique et non au modèle. Corriger la semaine A
    // en février ne doit pas rouvrir l'appel des occurrences de septembre.
    let (session_id, label, start_time, end_time, session_name, group_id) =
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
                              trimester, trimester_is_manual, cancelled, cancel_reason, group_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(slot_id, date) WHERE slot_id IS NOT NULL DO NOTHING",
        params![
            id,
            session_id,
            slot_id,
            title,
            date,
            start_time,
            end_time,
            trimester,
            is_manual,
            cancelled,
            // Même règle que `update_seance_meta`, par la même fonction. Et le
            // `DO NOTHING` reste intact : si la séance existe déjà, ce motif
            // n'écrase RIEN. C'est voulu — deux clics sur « ce cours n'a pas
            // lieu » ne doivent pas se contredire en silence, et le motif se
            // corrige depuis la séance elle-même.
            motif_retenu(cancelled, cancel_reason),
            group_id
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

/// Déclarer — ou retirer — le « rien à écrire » d'une séance.
///
/// **Une troisième commande, et non un paramètre des deux autres** (règle 3).
/// `update_seance_meta` écrit le titre, la date, le trimestre et l'annulation ;
/// `update_seance_content` écrit le cahier de texte. Celle-ci n'écrit qu'une
/// colonne, et c'est ce qui la rend sûre : l'écran du cahier de texte détient un
/// brouillon du contenu, et laisser ce bouton passer par
/// `update_seance_content` aurait réécrit le brouillon affiché par-dessus ce que
/// l'enseignant venait de taper — ou l'inverse.
///
/// Rien n'empêche une séance d'être à la fois « rien à écrire » et remplie : on
/// peut déclarer puis se raviser et écrire deux lignes. L'accueil ne la réclame
/// alors plus, ce qui est correct — elle a un contenu.
#[tauri::command]
pub fn set_seance_content_waived(
    state: tauri::State<'_, AppState>,
    id: String,
    waived: bool,
) -> Result<(), String> {
    let conn = state.conn()?;
    // L'horodatage est posé par SQLite et non par le front : c'est l'heure de
    // la machine qui écrit, et une seule source évite deux formats de date.
    let touched = conn
        .execute(
            "UPDATE seances
                SET content_waived_at = CASE WHEN ?1 THEN datetime('now') ELSE NULL END,
                    updated_at = datetime('now')
              WHERE id = ?2",
            params![waived, id],
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

/// Qui est appelé sur une séance.
///
/// La liste est bornée par la période d'inscription : un élève arrivé en
/// janvier n'a pas à figurer dans l'appel d'une séance d'octobre. Et l'absence
/// d'enregistrement vaut 'non_fait', plus jamais 'present' — ce défaut-là
/// fabriquait de l'assiduité parfaite à partir de rien.
///
/// ⚠ **CE PRÉDICAT DE GROUPE EST LE MODÈLE DE SES JUMEAUX**, et ils doivent
/// tous dire exactement la même chose — seuls les alias de table changent d'un
/// appelant à l'autre, jamais la forme. Ils vivent dans cinq modules :
/// `reports.rs` (les deux points d'`ATTENDANCE_SQL`), `timetable.rs`
/// (`SEANCES_DE_LA_PERIODE`, deux fois), `home.rs` (`SEANCES_PASSEES` et
/// `EVALUATIONS_PASSEES`, deux fois chacune) et `absences.rs` (le comptage des
/// séances écartées). Un écran qui appellerait un élève que le bilan ne compte
/// pas — ou l'inverse — donnerait deux vérités sur la même absence.
///
/// Ses deux `IS NULL` ne disent pas la même chose, et c'est voulu : une séance
/// **sans groupe** réunit toute la classe, donc elle appelle tout le monde ; un
/// élève **sans groupe** n'est rangé nulle part, donc il est appelé partout. Le
/// risque d'un élève oublié à la rentrée est ainsi une ligne en trop à l'appel,
/// visible, et non une absence qui ne se compte nulle part.
const APPEL_DE_LA_SEANCE: &str =
    "SELECT st.id, st.first_name, st.last_name, COALESCE(ar.status, 'non_fait')
       FROM seances se
       JOIN students st ON st.session_id = se.session_id
                       AND st.enrolled_on <= se.date
                       AND (st.left_on IS NULL OR se.date <= st.left_on)
                       AND (se.group_id IS NULL OR st.group_id IS NULL OR se.group_id = st.group_id)
       LEFT JOIN attendance_records ar ON ar.student_id = st.id
                                      AND ar.seance_id = se.id
      WHERE se.id = ?1
      ORDER BY st.last_name, st.first_name";

/// Le corps de `get_attendance`, appelable sur une connexion — c'est ce qui
/// permet d'éprouver le prédicat de groupe sans harnais Tauri.
fn attendance_rows(
    conn: &rusqlite::Connection,
    seance_id: &str,
) -> Result<Vec<AttendanceWithStudent>, String> {
    let mut stmt = conn.prepare(APPEL_DE_LA_SEANCE).map_err(|e| e.to_string())?;

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
pub fn get_attendance(
    state: tauri::State<'_, AppState>,
    seance_id: String,
) -> Result<Vec<AttendanceWithStudent>, String> {
    let conn = state.conn()?;
    attendance_rows(&conn, &seance_id)
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

        let premiere = seance_from_slot(&conn, "t1", "2026-11-17", false, "").unwrap();
        assert_eq!(premiere.title, "Atelier", "le libellé du créneau titre");
        assert_eq!(premiere.start_time, "08:00", "l'horaire est recopié");
        assert_eq!(premiere.end_time, "10:00");
        assert_eq!(premiere.slot_id.as_deref(), Some("t1"));
        assert_eq!(premiere.trimester, 1, "trimestre déduit de la date");
        assert!(!premiere.cancelled);
        assert_eq!(compte(&conn), 1);

        let seconde = seance_from_slot(&conn, "t1", "2026-11-17", false, "").unwrap();
        assert_eq!(
            seconde.id, premiere.id,
            "c'est la séance déjà là qu'on ouvre"
        );
        assert_eq!(compte(&conn), 1, "un second appel n'a pas été créé");

        // Une autre date reste un autre cours.
        seance_from_slot(&conn, "t1", "2026-11-24", false, "").unwrap();
        assert_eq!(compte(&conn), 2);
    }

    /// « Ce cours n'a pas lieu » : la séance naît annulée, donc hors du
    /// dénominateur d'assiduité de toute la classe.
    #[test]
    fn ce_cours_n_a_pas_lieu_cree_une_seance_annulee() {
        let conn = migrated_db("annulee");
        let seance = seance_from_slot(&conn, "t1", "2026-11-17", true, "Sortie scolaire").unwrap();
        assert!(seance.cancelled);
        // Palier 007 : le motif part avec l'annulation, dans la même écriture.
        assert_eq!(seance.cancel_reason, "Sortie scolaire");
    }

    /// Le motif n'a de sens que sur une séance annulée.
    ///
    /// Sans cette règle, décocher « ce cours n'a pas lieu » laisserait derrière
    /// lui un « Sortie scolaire » que plus aucun écran n'affiche — et qui
    /// ressortirait tel quel le jour où on recoche, comme une affirmation que
    /// l'enseignant n'a pas refaite.
    #[test]
    fn le_motif_ne_survit_pas_a_la_levee_de_l_annulation() {
        assert_eq!(motif_retenu(true, "Sortie scolaire"), "Sortie scolaire");
        assert_eq!(motif_retenu(false, "Sortie scolaire"), "");
        // Les espaces de bord sont retirés : un motif qui n'est qu'un espace
        // afficherait une ligne vide sous « Ce cours n'a pas eu lieu ».
        assert_eq!(motif_retenu(true, "  Jour férié  "), "Jour férié");
        assert_eq!(motif_retenu(true, "   "), "");
        assert_eq!(motif_retenu(true, ""), "");
    }

    /// Une séance qui a lieu ne porte jamais de motif, même si l'appelant en
    /// envoie un — c'est la commande qui tranche, pas le front.
    #[test]
    fn une_seance_qui_a_lieu_ne_porte_aucun_motif() {
        let conn = migrated_db("motif-sans-annulation");
        let seance = seance_from_slot(&conn, "t1", "2026-11-17", false, "Sortie scolaire").unwrap();
        assert!(!seance.cancelled);
        assert_eq!(
            seance.cancel_reason, "",
            "le motif envoyé par l'appelant doit être ignoré"
        );
    }

    #[test]
    fn un_creneau_sans_classe_n_a_rien_a_ouvrir() {
        let conn = migrated_db("sans-classe");
        let err = seance_from_slot(&conn, "t2", "2026-11-17", false, "").unwrap_err();
        assert!(err.contains("entrée datée"), "message : {err}");
        assert_eq!(compte(&conn), 0);

        let err = seance_from_slot(&conn, "inconnu", "2026-11-17", false, "").unwrap_err();
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
        let sans =
            insert_seance(&conn, "s1", "Séance du jour", "2026-11-18", "", "", None, None).unwrap();
        assert_eq!(sans.start_time, "");
        assert_eq!(sans.end_time, "");

        // Deux cours ponctuels le même jour restent possibles : l'index unique
        // porte sur (créneau, date), et il n'y a pas de créneau ici.
        insert_seance(
            &conn,
            "s1",
            "Second remplacement",
            "2026-11-17",
            "",
            "",
            None,
            None,
        )
        .unwrap();
        assert_eq!(compte(&conn), 3);

        let err =
            insert_seance(&conn, "s1", "Bancal", "2026-11-19", "14h", "16:00", None, None).unwrap_err();
        assert!(err.contains("L'heure de début"), "message : {err}");
        assert!(err.contains("HH:MM"), "message : {err}");

        let err =
            insert_seance(&conn, "s1", "Bancal", "2026-11-19", "16:00", "14:00", None, None).unwrap_err();
        assert!(err.starts_with("L'heure de fin"), "message : {err}");

        assert_eq!(
            compte(&conn),
            3,
            "aucun refus n'a laissé de séance derrière"
        );
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
        let err = insert_seance(&conn, "s1", "Égaré", "2028-05-01", "", "", None, None).unwrap_err();
        assert!(err.contains("2026-2027"), "l'année de la classe : {err}");
        assert!(err.contains("2028-05-01"), "la date reçue : {err}");
        // Mai 2028 appartient à l'année scolaire 2027-2028 : la bascule est au
        // 1er août, et le message le dit plutôt que de laisser croire à 2028-2029.
        assert!(err.contains("2027-2028"), "l'année de la date : {err}");

        // L'année tapée chiffre par chiffre passe par des valeurs bien formées.
        let err = insert_seance(&conn, "s1", "Égaré", "0202-11-17", "", "", None, None).unwrap_err();
        assert!(err.contains("2026-2027"), "message : {err}");

        // Le 31 février a la bonne forme et n'existe pas : le GLOB du schéma le
        // laissait passer.
        let err = insert_seance(&conn, "s1", "Égaré", "2026-02-31", "", "", None, None).unwrap_err();
        assert!(err.contains("n'est pas une date valide"), "message : {err}");

        // L'occurrence d'un créneau est gardée par la même fonction.
        let err = seance_from_slot(&conn, "t1", "2028-05-01", false, "").unwrap_err();
        assert!(err.contains("2026-2027"), "message : {err}");

        assert_eq!(
            compte(&conn),
            0,
            "aucun refus n'a laissé de séance derrière"
        );

        // Les deux bords de l'année scolaire restent ouverts : `year_start_for`
        // bascule au 1er août, et `trimester_for` range volontairement la
        // prérentrée d'août en T1 et le rattrapage de juillet en T3.
        let aout = insert_seance(&conn, "s1", "Prérentrée", "2026-08-25", "", "", None, None).unwrap();
        assert_eq!(aout.trimester, 1);
        let juillet = insert_seance(&conn, "s1", "Rattrapage", "2027-07-20", "", "", None, None).unwrap();
        assert_eq!(juillet.trimester, 3);
        assert_eq!(compte(&conn), 2);

        // Et la modification d'en-tête ne peut pas faire sortir une séance de
        // l'année par la fenêtre.
        let err =
            super::check_session_year(&conn, "s1", NaiveDate::from_ymd_opt(2027, 8, 1).unwrap())
                .unwrap_err();
        assert!(err.contains("2027-2028"), "message : {err}");
    }

    /// L'index unique est vivant, et ce que l'enseignant lit est du français.
    #[test]
    fn deux_seances_du_meme_creneau_le_meme_jour_sont_refusees_en_francais() {
        let conn = migrated_db("conflit");
        seance_from_slot(&conn, "t1", "2026-11-17", false, "").unwrap();

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

    /// Le cœur du palier 023 : une séance de groupe n'appelle que son groupe,
    /// et l'élève que personne n'a rangé reste appelé partout.
    ///
    /// Les deux `IS NULL` du prédicat ne disent pas la même chose, et c'est ce
    /// que ce test fige. Une séance sans groupe réunit toute la classe ; un
    /// élève sans groupe n'est rangé nulle part. Les intervertir ferait
    /// disparaître de l'appel l'élève oublié à la rentrée, c'est-à-dire
    /// exactement celui qu'il faut voir.
    #[test]
    fn une_seance_de_groupe_n_appelle_que_son_groupe() {
        let conn = migrated_db("appel-par-groupe");
        for instruction in [
            "INSERT INTO student_groups (id, session_id, name, position)
                  VALUES ('g1', 's1', 'Groupe 1', 1)",
            "INSERT INTO student_groups (id, session_id, name, position)
                  VALUES ('g2', 's1', 'Groupe 2', 2)",
            "INSERT INTO students (id, session_id, first_name, last_name, enrolled_on, group_id)
                  VALUES ('e1', 's1', 'A', 'Un', '2026-09-01', 'g1')",
            "INSERT INTO students (id, session_id, first_name, last_name, enrolled_on, group_id)
                  VALUES ('e2', 's1', 'B', 'Deux', '2026-09-01', 'g2')",
            "INSERT INTO students (id, session_id, first_name, last_name, enrolled_on)
                  VALUES ('e3', 's1', 'C', 'Trois', '2026-09-01')",
        ] {
            conn.execute_batch(instruction).unwrap();
        }

        let toute_la_classe =
            insert_seance(&conn, "s1", "Cours commun", "2026-11-17", "", "", None, None).unwrap();
        assert_eq!(toute_la_classe.group_id, None);
        assert_eq!(toute_la_classe.group_name, None);
        let appel = attendance_rows(&conn, &toute_la_classe.id).unwrap();
        assert_eq!(
            appel.iter().map(|a| a.student_id.as_str()).collect::<Vec<_>>(),
            vec!["e2", "e3", "e1"],
            "sans groupe, la séance réunit toute la classe (triée par nom)"
        );

        let atelier = insert_seance(
            &conn,
            "s1",
            "Atelier du groupe 1",
            "2026-11-18",
            "",
            "",
            None,
            Some("g1"),
        )
        .unwrap();
        assert_eq!(atelier.group_id.as_deref(), Some("g1"));
        assert_eq!(
            atelier.group_name.as_deref(),
            Some("Groupe 1"),
            "le nom est joint à la lecture, l'écran n'a pas à le recroiser"
        );
        let appel = attendance_rows(&conn, &atelier.id).unwrap();
        assert_eq!(
            appel.iter().map(|a| a.student_id.as_str()).collect::<Vec<_>>(),
            vec!["e3", "e1"],
            "le groupe 2 n'est pas concerné ; l'élève sans groupe, si"
        );
    }

    /// Le groupe est **recopié** du créneau, et le groupe d'une autre classe est
    /// refusé en français avant toute écriture.
    ///
    /// La clé étrangère ne pointe que `student_groups(id)` : sans ce contrôle en
    /// Rust, une séance portant le groupe d'une autre classe passerait, et son
    /// appel serait vide — tous ses élèves étant « d'un autre groupe ».
    #[test]
    fn l_occurrence_recopie_le_groupe_du_creneau_et_refuse_celui_d_une_autre_classe() {
        let conn = migrated_db("groupe-du-creneau");
        for instruction in [
            "INSERT INTO sessions (id, name, level_code, year_start)
                  VALUES ('s2', '3ème B', '3eme', 2026)",
            "INSERT INTO student_groups (id, session_id, name, position)
                  VALUES ('g1', 's1', 'Groupe 1', 1)",
            "INSERT INTO student_groups (id, session_id, name, position)
                  VALUES ('ailleurs', 's2', 'Groupe 1', 1)",
            "UPDATE timetable_slots SET group_id = 'g1' WHERE id = 't1'",
        ] {
            conn.execute_batch(instruction).unwrap();
        }

        let occurrence = seance_from_slot(&conn, "t1", "2026-11-17", false, "").unwrap();
        assert_eq!(
            occurrence.group_id.as_deref(),
            Some("g1"),
            "l'occurrence tient le groupe du créneau dont elle naît"
        );

        let err = insert_seance(
            &conn,
            "s1",
            "Égarée",
            "2026-11-19",
            "",
            "",
            None,
            Some("ailleurs"),
        )
        .unwrap_err();
        assert!(err.contains("autre classe"), "message : {err}");
        assert_eq!(compte(&conn), 1, "rien n'a été écrit");
    }
}
