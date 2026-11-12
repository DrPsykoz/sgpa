//! Périodes d'absence justifiée : les jours pendant lesquels une séance de la
//! classe ne compte ni comme présence ni comme absence pour qui est visé.
//!
//! **Pourquoi un module, et pas trois commandes dans `sessions.rs`.** Une
//! période n'est pas un attribut de la classe : c'est une entité, avec ses
//! propres validations (deux dates, un élève qui doit appartenir à la classe
//! visée, des chevauchements) et sa propre lecture — chaque ligne renvoyée
//! porte le nombre de séances qu'elle écarte réellement. `sessions.rs` est le
//! CRUD de l'entité classe, 170 lignes qui n'écrivent que dans `sessions` ;
//! y verser ce code mêlerait deux entités dans un fichier dont c'est toute la
//! clarté d'en tenir une seule. Le module est aussi ce qui rend ces requêtes
//! visibles par `sql_smoke`, qui analyse les sources déclarées dans `SOURCES`.
//!
//! **Ce qu'une période fait, et ne fait pas.** Elle ne crée ni ne supprime
//! aucune séance : le cahier de texte, l'appel et le bilan du reste de la
//! classe sont intacts. Elle retire les séances qu'elle couvre du dénominateur
//! d'assiduité de l'élève visé, et de lui seul — c'est la différence avec
//! `seances.cancelled`, qui retire la séance pour tout le monde.
//!
//! **Une table, deux usages.** `student_id` NULL vise toute la classe (le stage
//! collectif) ; renseigné, il vise un seul élève (hospitalisation, stage annulé
//! pour lui, départ anticipé).
//!
//! **Et deux drapeaux, depuis le palier 020.** Une période retire ses séances du
//! dénominateur — sauf si `attendance_expected` vaut 1, auquel cas l'appel se
//! fait quand même : une sortie scolaire, un séjour, une matinée au CDI sont des
//! périodes où la classe est ailleurs et bien présente. La règle vit dans
//! `reports::ATTENDANCE_SQL`, qui lit la colonne à ses deux points symétriques,
//! et nulle part ici : ce module n'écrit qu'un booléen.
//!
//! `teacher_absent`, lui, **ne change aucun calcul** — une période neutralise
//! déjà. Il porte la CAUSE, pour que l'emploi du temps écrive « Professeur
//! absent » plutôt que de laisser deviner, et pour que les rappels de l'accueil
//! se taisent sur une séance que personne n'a assurée. Il ne s'écrit que par
//! `create_teacher_absence`, jamais par `create_absence_period` : la commande
//! EST le drapeau, si bien qu'une absence du professeur ne peut pas naître
//! nominative ni « avec appel ».

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::timetable::{iso, parse_date};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Types renvoyés au front
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct AbsencePeriod {
    pub id: String,
    pub session_id: String,
    /// `None` = toute la classe.
    pub student_id: Option<String>,
    pub student_first_name: Option<String>,
    pub student_last_name: Option<String>,
    /// Texte libre : « Stage en entreprise », « Hospitalisation »… Aucun calcul
    /// ne s'appuie dessus, il ne sert qu'à nommer la période à l'écran.
    pub reason: String,
    pub start_date: String,
    /// Incluse : une période du 18 au 18 est une journée.
    pub end_date: String,
    /// `true` = l'appel se fait quand même, la période ne neutralise rien.
    pub attendance_expected: bool,
    /// `true` = c'est le professeur qui était absent, pas la classe.
    ///
    /// Jamais modifiable après coup : une absence du professeur se supprime et
    /// se repose. Changer ce drapeau sur place reviendrait à réécrire la cause
    /// d'une période déjà lue dans un bilan.
    pub teacher_absent: bool,
    /// Séances **non annulées de la classe** comprises dans la fenêtre.
    ///
    /// C'est ce qui rend l'écran de saisie lisible : « du 18/01 au 05/02 —
    /// 6 séances écartées ». Volontairement le même nombre pour une période de
    /// classe et pour une période d'élève : une période de classe n'a pas de
    /// compte unique, chaque élève ayant sa propre fenêtre d'inscription. Le
    /// bilan, lui, recompte élève par élève — c'est lui qui fait foi.
    pub seance_count: i32,
    /// Le groupe visé, ou `None` = toute la classe (palier 023).
    ///
    /// **Exclusif de `student_id`**, et le CHECK du schéma le redit : une
    /// période vise une classe, un groupe OU un élève. Viser les deux n'aurait
    /// pas de sens — l'élève appartient déjà à un seul groupe — et aurait
    /// ouvert un troisième cas dans une requête de bilan qui en a déjà assez.
    ///
    /// **C'est un réglage, pas un fait** : `SET NULL` au schéma, donc supprimer
    /// un groupe rend la période à la classe entière. Elle écarte alors plus de
    /// séances qu'avant, ce qui se voit à l'écran — là où un `RESTRICT` aurait
    /// bloqué la suppression d'un groupe à cause d'un stage de l'an dernier.
    pub group_id: Option<String>,
    /// Le nom du groupe, joint à la lecture. **Dérivé, jamais écrit.**
    pub group_name: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AbsencePeriodInput {
    /// `None` ou `""` = toute la classe.
    pub student_id: Option<String>,
    pub reason: String,
    pub start_date: String,
    pub end_date: String,
    /// Absent de la charge utile = `false`, c'est-à-dire le comportement d'avant
    /// le palier 020. Un appelant qui ne connaît pas encore le champ écrit donc
    /// une période qui neutralise, comme toutes celles déjà en base.
    #[serde(default)]
    pub attendance_expected: bool,
    /// `None` ou `""` = toute la classe. Exclusif de `student_id`.
    #[serde(default)]
    pub group_id: Option<String>,
}

/// Une absence du professeur, sur une ou plusieurs classes à la fois.
///
/// Les classes sont une liste parce que l'enseignant est rarement absent pour
/// une seule : une journée de formation vide son emploi du temps entier, une
/// réunion ne lui prend qu'une classe. C'est à lui de cocher, et le même geste
/// couvre les deux cas.
#[derive(Debug, Clone, Deserialize)]
pub struct TeacherAbsenceInput {
    pub session_ids: Vec<String>,
    pub reason: String,
    pub start_date: String,
    pub end_date: String,
}

// ---------------------------------------------------------------------------
// Requêtes — des littéraux entiers, jamais assemblés par `format!`
// ---------------------------------------------------------------------------

const PERIODES_DE_LA_CLASSE: &str = "SELECT ap.id, ap.session_id, ap.student_id,
       st.first_name, st.last_name, ap.reason, ap.start_date, ap.end_date,
       (SELECT COUNT(*) FROM seances se
         WHERE se.session_id = ap.session_id
           AND se.cancelled = 0
           AND se.date BETWEEN ap.start_date AND ap.end_date
           AND (ap.group_id IS NULL OR se.group_id IS NULL
                OR se.group_id = ap.group_id)),
       ap.created_at, ap.updated_at, ap.attendance_expected, ap.teacher_absent,
       ap.group_id, (SELECT g.name FROM student_groups g WHERE g.id = ap.group_id)
  FROM absence_periods ap
  LEFT JOIN students st ON st.id = ap.student_id
 WHERE ap.session_id = ?1
 ORDER BY ap.start_date, ap.end_date, st.last_name";

const PERIODE_PAR_ID: &str = "SELECT ap.id, ap.session_id, ap.student_id,
       st.first_name, st.last_name, ap.reason, ap.start_date, ap.end_date,
       (SELECT COUNT(*) FROM seances se
         WHERE se.session_id = ap.session_id
           AND se.cancelled = 0
           AND se.date BETWEEN ap.start_date AND ap.end_date
           AND (ap.group_id IS NULL OR se.group_id IS NULL
                OR se.group_id = ap.group_id)),
       ap.created_at, ap.updated_at, ap.attendance_expected, ap.teacher_absent,
       ap.group_id, (SELECT g.name FROM student_groups g WHERE g.id = ap.group_id)
  FROM absence_periods ap
  LEFT JOIN students st ON st.id = ap.student_id
 WHERE ap.id = ?1";

/// Une période **de même cible** dont les dates recouvrent celles proposées.
///
/// Même cible = même classe, même élève visé **et même groupe** — les NULL
/// compris. La comparaison `?3 IS NULL` est indispensable : `ap.student_id =
/// NULL` ne vaut pas vrai en SQL, il ne vaut rien, et deux périodes de classe
/// se chevaucheraient sans que ce garde-fou ne dise un mot. Le groupe suit la
/// même forme, et pour la raison inverse de celle qu'on attendrait : le stage
/// du groupe 1 et celui du groupe 2 tombent presque toujours sur des semaines
/// voisines, et les déclarer en conflit aurait rendu la saisie impossible
/// exactement dans le cas que le palier 023 existe pour servir.
const CHEVAUCHEMENT: &str = "SELECT ap.reason, ap.start_date, ap.end_date
  FROM absence_periods ap
 WHERE ap.session_id = ?1
   AND ap.id <> ?2
   AND ((ap.student_id IS NULL AND ?3 IS NULL) OR ap.student_id = ?3)
   AND ((ap.group_id IS NULL AND ?6 IS NULL) OR ap.group_id = ?6)
   AND ap.start_date <= ?5
   AND ap.end_date   >= ?4
 ORDER BY ap.start_date
 LIMIT 1";

fn map_period(row: &rusqlite::Row<'_>) -> rusqlite::Result<AbsencePeriod> {
    Ok(AbsencePeriod {
        id: row.get(0)?,
        session_id: row.get(1)?,
        student_id: row.get(2)?,
        student_first_name: row.get(3)?,
        student_last_name: row.get(4)?,
        reason: row.get(5)?,
        start_date: row.get(6)?,
        end_date: row.get(7)?,
        seance_count: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        attendance_expected: row.get(11)?,
        teacher_absent: row.get(12)?,
        group_id: row.get(13)?,
        group_name: row.get(14)?,
    })
}

fn load_period(conn: &Connection, id: &str) -> Result<AbsencePeriod, String> {
    conn.query_row(PERIODE_PAR_ID, params![id], map_period)
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Période d'absence introuvable".to_string())
}

// ---------------------------------------------------------------------------
// Validations — en français, avant toute écriture
// ---------------------------------------------------------------------------

/// Une date ISO telle qu'on l'écrit à l'enseignant.
///
/// Les valeurs viennent de la base, où un CHECK GLOB garantit la forme ; toute
/// autre chaîne ressort telle quelle, plutôt que de risquer une découpe fausse
/// dans un message d'erreur.
fn en_clair(date: &str) -> String {
    if date.len() == 10 && date.is_ascii() {
        format!("{}/{}/{}", &date[8..10], &date[5..7], &date[0..4])
    } else {
        date.to_string()
    }
}

fn clean_reason(reason: &str) -> Result<String, String> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(
            "Indiquez le motif de cette période, par exemple « Stage en entreprise » \
             ou « Hospitalisation » : c'est lui qui la nomme dans la liste."
                .to_string(),
        );
    }
    Ok(reason.to_string())
}

/// Normalise un identifiant facultatif : `Some("")` vaut `None`, donc « toute
/// la classe ». Un champ de formulaire vidé ne doit pas devenir un élève
/// introuvable.
fn optional_id(value: Option<&str>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Le nom de la classe, et son existence par la même occasion.
///
/// Sert aux messages de `create_teacher_absence` : quand quatre classes sont
/// cochées, « Cette classe a déjà la période… » ne dit pas laquelle décocher.
fn nom_de_classe(conn: &Connection, session_id: &str) -> Result<String, String> {
    conn.query_row(
        "SELECT name FROM sessions WHERE id = ?1",
        params![session_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Classe introuvable".to_string())
}

fn check_session(conn: &Connection, session_id: &str) -> Result<(), String> {
    let existe: Option<i32> = conn
        .query_row(
            "SELECT 1 FROM sessions WHERE id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if existe.is_none() {
        return Err("Classe introuvable".to_string());
    }
    Ok(())
}

/// L'élève visé doit appartenir à la classe visée.
///
/// Le schéma ne peut rien garantir ici : les deux clés étrangères sont
/// satisfaites par n'importe quel élève de n'importe quelle classe. Sans ce
/// contrôle, une période saisie sur le mauvais élève n'écarterait rien du tout
/// — le `NOT EXISTS` du bilan exige que la classe corresponde — et l'enseignant
/// verrait « 6 séances écartées » à l'écran sans qu'un seul pourcentage bouge.
fn check_student_in_session(
    conn: &Connection,
    session_id: &str,
    student_id: Option<&str>,
) -> Result<(), String> {
    let Some(student_id) = student_id else {
        return Ok(());
    };

    let trouve: Option<(String, String, String)> = conn
        .query_row(
            "SELECT session_id, first_name, last_name FROM students WHERE id = ?1",
            params![student_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    match trouve {
        None => Err("Élève introuvable".to_string()),
        Some((classe, prenom, nom)) if classe != session_id => Err(format!(
            "{prenom} {nom} n'est pas inscrit dans cette classe. Une période ne peut \
             viser qu'un élève de la classe qu'elle concerne — sinon elle n'écarterait \
             aucune séance."
        )),
        Some(_) => Ok(()),
    }
}

/// Deux périodes de MÊME CIBLE qui se recouvrent sont refusées ; une période de
/// classe et une période d'élève, jamais.
///
/// Le refus ne protège aucun calcul — le `NOT EXISTS` du bilan écarte une
/// séance couverte deux fois exactement une fois. Il protège la lecture : deux
/// lignes annonçant « 6 séances écartées » chacune se lisent comme 12 séances
/// retirées, et le bilan en montrerait 6. Deux périodes de même cible qui se
/// recouvrent s'écrivent toujours comme une seule, la correction est donc
/// toujours possible.
///
/// L'autorisation, elle, est indispensable : un élève hospitalisé pendant le
/// stage de sa classe est un cas réel, et un refus le rendrait impossible à
/// saisir.
fn check_no_overlap(
    conn: &Connection,
    session_id: &str,
    id_exclu: &str,
    student_id: Option<&str>,
    start_date: &str,
    end_date: &str,
    group_id: Option<&str>,
) -> Result<(), String> {
    let voisine: Option<(String, String, String)> = conn
        .query_row(
            CHEVAUCHEMENT,
            params![
                session_id,
                id_exclu,
                student_id,
                start_date,
                end_date,
                group_id
            ],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some((reason, debut, fin)) = voisine else {
        return Ok(());
    };

    let cible = match (student_id, group_id) {
        (Some(_), _) => "Cet élève a",
        (None, Some(_)) => "Ce groupe a",
        (None, None) => "Cette classe a",
    };
    Err(format!(
        "{cible} déjà la période « {reason} », du {} au {}, qui recouvre ces dates. \
         Modifiez-la plutôt que d'en saisir une seconde : deux périodes qui se \
         recouvrent afficheraient chacune leur compte de séances, alors qu'une séance \
         n'est écartée qu'une fois.",
        en_clair(&debut),
        en_clair(&fin)
    ))
}

/// Motif, début et fin — vérifiés **une seule fois** pour toutes les classes
/// d'une absence du professeur.
///
/// Extrait de `validated_period` parce qu'une date mal saisie n'appartient à
/// aucune classe en particulier : la refuser quatre fois en nommant la première
/// classe cochée ferait chercher le défaut au mauvais endroit.
fn validated_window(
    reason: &str,
    start_date: &str,
    end_date: &str,
) -> Result<(String, String, String), String> {
    let reason = clean_reason(reason)?;
    let start = parse_date(start_date, "La date de début")?;
    let end = parse_date(end_date, "La date de fin")?;
    if end < start {
        return Err(format!(
            "La date de fin ({}) précède la date de début ({}). Pour une absence d'un \
             seul jour, saisissez deux fois la même date.",
            en_clair(&iso(end)),
            en_clair(&iso(start))
        ));
    }
    Ok((reason, iso(start), iso(end)))
}

/// Valeurs vérifiées et normalisées : élève visé, motif, début, fin, groupe.
type PeriodValues = (
    Option<String>,
    String,
    String,
    String,
    Option<String>,
);

/// Toutes les validations, dans l'ordre où l'enseignant remplit le formulaire.
///
/// `id_exclu` est la ligne en cours de modification, qui ne doit pas se
/// chevaucher elle-même ; `""` à la création, aucune ligne ne portant cet
/// identifiant.
///
/// **Ce qui n'est PAS vérifié : l'appartenance des dates à l'année scolaire de
/// la classe.** Une période hors de l'année ressort avec `seance_count = 0`,
/// ce qui se voit immédiatement à l'écran ; un refus, lui, se tromperait sur
/// les bords — une prérentrée d'août, un rattrapage de juillet — et bloquerait
/// une saisie légitime au nom d'une règle que personne n'a arrêtée.
fn validated_period(
    conn: &Connection,
    session_id: &str,
    id_exclu: &str,
    input: &AbsencePeriodInput,
) -> Result<PeriodValues, String> {
    let (reason, start, end) = validated_window(&input.reason, &input.start_date, &input.end_date)?;

    let student_id = optional_id(input.student_id.as_deref());
    let group_id = optional_id(input.group_id.as_deref());
    check_session(conn, session_id)?;
    check_student_in_session(conn, session_id, student_id.as_deref())?;

    // Les deux cibles s'excluent, et le CHECK du schéma le redit. Le refus est
    // ici pour qu'il soit en français : un élève appartient déjà à un seul
    // groupe, donc désigner les deux ne restreint rien et ne dit rien de plus.
    if student_id.is_some() && group_id.is_some() {
        return Err(
            "Une période vise un élève OU un groupe, pas les deux : un élève appartient \
             déjà à un seul groupe."
                .to_string(),
        );
    }
    super::groups::check_group_belongs(conn, session_id, group_id.as_deref())?;

    check_no_overlap(
        conn,
        session_id,
        id_exclu,
        student_id.as_deref(),
        &start,
        &end,
        group_id.as_deref(),
    )?;

    Ok((student_id, reason, start, end, group_id))
}

// ---------------------------------------------------------------------------
// Lectures et écritures — testables sans Tauri
// ---------------------------------------------------------------------------

fn list_periods(conn: &Connection, session_id: &str) -> Result<Vec<AbsencePeriod>, String> {
    let mut stmt = conn
        .prepare(PERIODES_DE_LA_CLASSE)
        .map_err(|e| e.to_string())?;
    let periods = stmt
        .query_map(params![session_id], map_period)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(periods)
}

fn create_period(
    conn: &Connection,
    session_id: &str,
    input: &AbsencePeriodInput,
) -> Result<AbsencePeriod, String> {
    let (student_id, reason, start_date, end_date, group_id) =
        validated_period(conn, session_id, "", input)?;

    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO absence_periods
             (id, session_id, student_id, reason, start_date, end_date,
              attendance_expected, group_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            session_id,
            student_id,
            reason,
            start_date,
            end_date,
            input.attendance_expected,
            group_id
        ],
    )
    .map_err(|e| e.to_string())?;

    load_period(conn, &id)
}

/// Une absence du professeur : une ligne par classe cochée, en une transaction.
///
/// **La commande EST le drapeau.** `teacher_absent = 1`, `attendance_expected = 0`
/// et `student_id = NULL` sont écrits ici en dur, et ne sont pas des paramètres :
/// une absence du professeur ne peut donc naître ni nominative — il n'est pas
/// absent pour un élève — ni « avec appel », puisqu'il n'est pas là pour le
/// faire. Le CHECK du palier 020 fige la seconde moitié de cette règle dans le
/// schéma ; celle-ci la tient à la saisie, avec un message français.
///
/// **Tout ou rien.** Si une seule classe cochée a déjà une période qui recouvre
/// ces dates, rien n'est écrit et le message nomme la classe à décocher. Un
/// écrit partiel laisserait l'enseignant deviner lesquelles sont passées.
///
/// **Il n'y a pas d'entité « absence groupée ».** Quatre classes cochées font
/// quatre lignes indépendantes, par le même raisonnement qui a refusé un objet
/// « groupe » au palier 019 : chaque classe lit sa période dans son bilan, et
/// un identifiant commun serait une colonne de plus pour un seul usage. La
/// contrepartie est connue — la suppression se fait classe par classe.
fn create_teacher_absence(
    conn: &Connection,
    input: &TeacherAbsenceInput,
) -> Result<Vec<AbsencePeriod>, String> {
    let (reason, start_date, end_date) =
        validated_window(&input.reason, &input.start_date, &input.end_date)?;

    // Dédoublonné en gardant l'ordre de la saisie : une classe cochée deux fois
    // se heurterait à sa propre ligne, et le message parlerait d'un
    // chevauchement que l'enseignant n'a pas saisi.
    let mut classes: Vec<&str> = Vec::new();
    for id in &input.session_ids {
        let id = id.trim();
        if !id.is_empty() && !classes.contains(&id) {
            classes.push(id);
        }
    }
    if classes.is_empty() {
        return Err(
            "Cochez au moins une classe : une absence ne se note que sur les \
             classes qu'elle touche."
                .to_string(),
        );
    }

    let mut creees = Vec::with_capacity(classes.len());
    for session_id in classes {
        let nom = nom_de_classe(conn, session_id)?;
        // `None` pour le groupe, comme pour l'élève, et pour la même raison :
        // le professeur n'est pas absent pour une moitié de classe.
        check_no_overlap(conn, session_id, "", None, &start_date, &end_date, None)
            .map_err(|e| format!("{nom} : {e}"))?;

        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO absence_periods
                 (id, session_id, student_id, reason, start_date, end_date,
                  attendance_expected, teacher_absent)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, 0, 1)",
            params![id, session_id, reason, start_date, end_date],
        )
        .map_err(|e| e.to_string())?;
        creees.push(load_period(conn, &id)?);
    }

    Ok(creees)
}

/// La classe d'une période n'est pas modifiable : elle est relue sur la ligne
/// existante. Déplacer une période d'une classe à l'autre changerait le bilan
/// de deux classes d'un coup, dont une que l'enseignant n'a pas sous les yeux.
/// L'élève visé, lui, se corrige — c'est la saisie qu'on rate le plus souvent.
fn update_period(
    conn: &Connection,
    id: &str,
    input: &AbsencePeriodInput,
) -> Result<AbsencePeriod, String> {
    let existante = load_period(conn, id)?;
    let session_id = existante.session_id.clone();

    // Une absence du professeur reste une absence du professeur. Le CHECK du
    // schéma refuserait déjà « avec appel » — mais en anglais, et par une
    // erreur SQLite brute ; et il ne dit rien du second cas, que seul ce garde
    // tient : un élève désigné ferait une absence du professeur nominative.
    if existante.teacher_absent {
        if input.attendance_expected {
            return Err(
                "« Professeur absent » et « l'appel se fait quand même » ne vont pas \
                 ensemble : s'il n'était pas là, personne n'a fait l'appel. Supprimez \
                 cette période et saisissez-en une autre."
                    .to_string(),
            );
        }
        if optional_id(input.student_id.as_deref()).is_some() {
            return Err(
                "Une absence du professeur concerne toute la classe : elle ne peut pas \
                 viser un élève. Supprimez-la et saisissez une période d'absence pour \
                 cet élève si c'est ce que vous voulez noter."
                    .to_string(),
            );
        }
        // Troisième porte du même verrou, ajoutée au palier 023 : le CHECK du
        // schéma refuse déjà le couple, mais en anglais et sans dire quoi faire.
        if optional_id(input.group_id.as_deref()).is_some() {
            return Err(
                "Une absence du professeur concerne toute la classe : elle ne peut pas \
                 viser un groupe. Supprimez-la et saisissez une période pour ce groupe \
                 si c'est ce que vous voulez noter."
                    .to_string(),
            );
        }
    }

    let (student_id, reason, start_date, end_date, group_id) =
        validated_period(conn, &session_id, id, input)?;

    conn.execute(
        "UPDATE absence_periods
            SET student_id = ?1, reason = ?2, start_date = ?3, end_date = ?4,
                attendance_expected = ?5, group_id = ?6, updated_at = datetime('now')
          WHERE id = ?7",
        params![
            student_id,
            reason,
            start_date,
            end_date,
            input.attendance_expected,
            group_id,
            id
        ],
    )
    .map_err(|e| e.to_string())?;

    load_period(conn, id)
}

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_absence_periods(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Vec<AbsencePeriod>, String> {
    let conn = state.conn()?;
    list_periods(&conn, &session_id)
}

#[tauri::command]
pub fn create_absence_period(
    state: tauri::State<'_, AppState>,
    session_id: String,
    period: AbsencePeriodInput,
) -> Result<AbsencePeriod, String> {
    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let created = create_period(&tx, &session_id, &period)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(created)
}

#[tauri::command]
pub fn update_absence_period(
    state: tauri::State<'_, AppState>,
    id: String,
    period: AbsencePeriodInput,
) -> Result<AbsencePeriod, String> {
    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let updated = update_period(&tx, &id, &period)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(updated)
}

/// Noter une absence du professeur sur une ou plusieurs classes à la fois.
///
/// Commande distincte de `create_absence_period`, et pas un paramètre de plus :
/// c'est ce qui rend le couple contradictoire inécrivable. Voir
/// `create_teacher_absence` pour le détail.
#[tauri::command]
pub fn create_teacher_absence_periods(
    state: tauri::State<'_, AppState>,
    absence: TeacherAbsenceInput,
) -> Result<Vec<AbsencePeriod>, String> {
    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let creees = create_teacher_absence(&tx, &absence)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(creees)
}

/// Supprimer une période RÉTABLIT les séances qu'elle écartait dans le
/// dénominateur de l'élève : rien n'est perdu, aucune séance n'a été touchée.
#[tauri::command]
pub fn delete_absence_period(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.conn()?;
    let supprimees = conn
        .execute("DELETE FROM absence_periods WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if supprimees == 0 {
        return Err("Période d'absence introuvable".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn migrated_db(nom: &str) -> Connection {
        let dir = std::env::temp_dir().join(format!("sgpa-abs-{nom}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = Connection::open(dir.join("sgpa.db")).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::db::migrations::run(&mut conn, &dir).unwrap();
        conn
    }

    /// Une instruction par littéral — `sql_smoke` les prépare toutes contre le
    /// schéma, et refuse un lot de plusieurs instructions.
    fn peupler(conn: &Connection) {
        for instruction in [
            "INSERT INTO sessions (id, name, level_code, year_start)
                  VALUES ('s1', '4ème A', '4eme', 2026),
                         ('s2', '3ème B', '3eme', 2026)",
            "INSERT INTO students (id, session_id, first_name, last_name, enrolled_on)
                  VALUES ('e1', 's1', 'Hugo', 'MARTIN', '2026-09-01'),
                         ('e2', 's1', 'Nadia', 'BOUMEDIENE', '2026-09-01'),
                         ('e9', 's2', 'Léa', 'DURAND', '2026-09-01')",
            "INSERT INTO seances (id, session_id, title, date, trimester, cancelled)
                  VALUES ('c1', 's1', 'Atelier', '2027-01-18', 2, 0),
                         ('c2', 's1', 'Atelier', '2027-01-19', 2, 0),
                         ('c3', 's1', 'Sortie',  '2027-01-20', 2, 1),
                         ('c4', 's1', 'Atelier', '2027-02-10', 2, 0)",
        ] {
            conn.execute_batch(instruction).unwrap();
        }
    }

    fn saisie(student: Option<&str>, reason: &str, start: &str, end: &str) -> AbsencePeriodInput {
        AbsencePeriodInput {
            student_id: student.map(str::to_string),
            reason: reason.to_string(),
            start_date: start.to_string(),
            end_date: end.to_string(),
            attendance_expected: false,
            group_id: None,
        }
    }

    /// La même saisie, mais elle vise un groupe au lieu de toute la classe.
    fn saisie_de_groupe(groupe: &str, reason: &str, start: &str, end: &str) -> AbsencePeriodInput {
        AbsencePeriodInput {
            group_id: Some(groupe.to_string()),
            ..saisie(None, reason, start, end)
        }
    }

    /// Deux groupes dans la 4ème A, et des séances réparties entre eux.
    fn peupler_les_groupes(conn: &Connection) {
        for instruction in [
            "INSERT INTO student_groups (id, session_id, name, position)
                  VALUES ('g1', 's1', 'Groupe 1', 0),
                         ('g2', 's1', 'Groupe 2', 1),
                         ('g9', 's2', 'Groupe 1', 0)",
            "UPDATE seances SET group_id = 'g1' WHERE id = 'c1'",
            "UPDATE seances SET group_id = 'g2' WHERE id = 'c2'",
        ] {
            conn.execute_batch(instruction).unwrap();
        }
    }

    /// La même saisie, mais « l'appel se fait quand même ».
    fn saisie_avec_appel(reason: &str, start: &str, end: &str) -> AbsencePeriodInput {
        AbsencePeriodInput {
            attendance_expected: true,
            ..saisie(None, reason, start, end)
        }
    }

    #[test]
    fn motif_obligatoire() {
        assert!(clean_reason("   ").is_err());
        assert_eq!(
            clean_reason(" Stage en entreprise ").unwrap(),
            "Stage en entreprise"
        );
    }

    #[test]
    fn date_francaise_dans_les_messages() {
        assert_eq!(en_clair("2027-01-18"), "18/01/2027");
        assert_eq!(en_clair("pas une date"), "pas une date");
    }

    #[test]
    fn une_journee_seule_est_une_periode_valide() {
        let conn = migrated_db("journee");
        peupler(&conn);
        let periode = create_period(
            &conn,
            "s1",
            &saisie(Some("e1"), "Hospitalisation", "2027-01-18", "2027-01-18"),
        )
        .unwrap();
        assert_eq!(periode.start_date, periode.end_date);
        assert_eq!(periode.seance_count, 1);
    }

    #[test]
    fn fin_avant_debut_refusee_en_francais() {
        let conn = migrated_db("ordre");
        peupler(&conn);
        let erreur = create_period(
            &conn,
            "s1",
            &saisie(None, "Stage", "2027-02-05", "2027-01-18"),
        )
        .unwrap_err();
        assert!(erreur.contains("05/02/2027"), "{erreur}");
        assert!(erreur.contains("18/01/2027"), "{erreur}");
    }

    #[test]
    fn date_mal_formee_refusee_avant_la_base() {
        let conn = migrated_db("forme");
        peupler(&conn);
        assert!(create_period(
            &conn,
            "s1",
            &saisie(None, "Stage", "18/01/2027", "2027-02-05")
        )
        .is_err());
        // Le GLOB du schéma laisserait passer un 30 février.
        assert!(create_period(
            &conn,
            "s1",
            &saisie(None, "Stage", "2027-02-30", "2027-03-01")
        )
        .is_err());
    }

    /// Le cas qui ne casse aucune clé étrangère et n'écarterait pourtant rien :
    /// l'élève existe, la classe existe, mais l'un n'est pas dans l'autre.
    #[test]
    fn eleve_d_une_autre_classe_refuse() {
        let conn = migrated_db("mauvaise-classe");
        peupler(&conn);
        let erreur = create_period(
            &conn,
            "s1",
            &saisie(Some("e9"), "Stage", "2027-01-18", "2027-01-19"),
        )
        .unwrap_err();
        assert!(erreur.contains("DURAND"), "{erreur}");
        assert!(
            erreur.contains("n'est pas inscrit dans cette classe"),
            "{erreur}"
        );
    }

    #[test]
    fn identifiant_d_eleve_vide_vaut_toute_la_classe() {
        let conn = migrated_db("vide");
        peupler(&conn);
        let periode = create_period(
            &conn,
            "s1",
            &saisie(
                Some("   "),
                "Stage en entreprise",
                "2027-01-18",
                "2027-01-19",
            ),
        )
        .unwrap();
        assert_eq!(periode.student_id, None);
        assert_eq!(periode.student_last_name, None);
    }

    #[test]
    fn les_seances_annulees_ne_sont_pas_comptees() {
        let conn = migrated_db("annulees");
        peupler(&conn);
        // Du 18 au 20 : trois séances, dont une annulée.
        let periode = create_period(
            &conn,
            "s1",
            &saisie(None, "Stage en entreprise", "2027-01-18", "2027-01-20"),
        )
        .unwrap();
        assert_eq!(periode.seance_count, 2);
    }

    #[test]
    fn deux_periodes_de_meme_cible_qui_se_recouvrent_sont_refusees() {
        let conn = migrated_db("chevauchement");
        peupler(&conn);
        create_period(
            &conn,
            "s1",
            &saisie(None, "Stage en entreprise", "2027-01-18", "2027-02-05"),
        )
        .unwrap();
        let erreur = create_period(
            &conn,
            "s1",
            &saisie(None, "Stage bis", "2027-02-01", "2027-02-10"),
        )
        .unwrap_err();
        assert!(erreur.contains("Stage en entreprise"), "{erreur}");
        assert!(erreur.contains("18/01/2027"), "{erreur}");

        // Collée à la précédente, mais sans recouvrement : acceptée.
        create_period(
            &conn,
            "s1",
            &saisie(None, "Stage 2", "2027-02-06", "2027-02-10"),
        )
        .unwrap();
        assert_eq!(list_periods(&conn, "s1").unwrap().len(), 2);
    }

    /// Le cas réel qui interdit de refuser tout chevauchement.
    #[test]
    fn hospitalisation_pendant_le_stage_de_la_classe_acceptee() {
        let conn = migrated_db("cibles-differentes");
        peupler(&conn);
        create_period(
            &conn,
            "s1",
            &saisie(None, "Stage en entreprise", "2027-01-18", "2027-02-05"),
        )
        .unwrap();
        create_period(
            &conn,
            "s1",
            &saisie(Some("e1"), "Hospitalisation", "2027-01-19", "2027-01-25"),
        )
        .unwrap();
        // Et deux périodes du même élève qui se recouvrent, elles, sont refusées.
        assert!(create_period(
            &conn,
            "s1",
            &saisie(
                Some("e1"),
                "Hospitalisation bis",
                "2027-01-20",
                "2027-01-30"
            )
        )
        .is_err());
        assert_eq!(list_periods(&conn, "s1").unwrap().len(), 2);
    }

    #[test]
    fn une_periode_ne_se_chevauche_pas_elle_meme_a_la_modification() {
        let conn = migrated_db("modification");
        peupler(&conn);
        let periode = create_period(
            &conn,
            "s1",
            &saisie(None, "Stage en entreprise", "2027-01-18", "2027-02-05"),
        )
        .unwrap();
        let modifiee = update_period(
            &conn,
            &periode.id,
            &saisie(
                Some("e2"),
                "Stage en entreprise",
                "2027-01-18",
                "2027-01-19",
            ),
        )
        .unwrap();
        assert_eq!(modifiee.student_id.as_deref(), Some("e2"));
        assert_eq!(modifiee.student_last_name.as_deref(), Some("BOUMEDIENE"));
        assert_eq!(modifiee.end_date, "2027-01-19");
        assert_eq!(modifiee.seance_count, 2);
        assert_eq!(modifiee.session_id, "s1", "la classe ne se déplace pas");
    }

    #[test]
    fn les_periodes_sortent_dans_l_ordre_du_calendrier() {
        let conn = migrated_db("ordre-liste");
        peupler(&conn);
        create_period(
            &conn,
            "s1",
            &saisie(None, "Stage 2", "2027-02-01", "2027-02-10"),
        )
        .unwrap();
        create_period(
            &conn,
            "s1",
            &saisie(None, "Stage 1", "2027-01-18", "2027-01-20"),
        )
        .unwrap();
        let motifs: Vec<String> = list_periods(&conn, "s1")
            .unwrap()
            .into_iter()
            .map(|p| p.reason)
            .collect();
        assert_eq!(motifs, ["Stage 1", "Stage 2"]);
        assert!(list_periods(&conn, "s2").unwrap().is_empty());
    }

    #[test]
    fn classe_inconnue_refusee_en_francais() {
        let conn = migrated_db("classe-inconnue");
        peupler(&conn);
        let erreur = create_period(
            &conn,
            "sX",
            &saisie(None, "Stage", "2027-01-18", "2027-01-19"),
        )
        .unwrap_err();
        assert_eq!(erreur, "Classe introuvable");
    }

    #[test]
    fn une_periode_avec_appel_se_saisit_et_se_relit() {
        let conn = migrated_db("avec-appel");
        peupler(&conn);
        let creee = create_period(
            &conn,
            "s1",
            &saisie_avec_appel("Sortie au musée", "2027-01-18", "2027-01-19"),
        )
        .unwrap();
        assert!(creee.attendance_expected);
        assert!(!creee.teacher_absent);
        // Et elle se relit telle quelle : c'est le drapeau, non l'intitulé, qui
        // porte la règle que `reports::ATTENDANCE_SQL` applique.
        assert!(list_periods(&conn, "s1").unwrap()[0].attendance_expected);
    }

    #[test]
    fn une_absence_du_professeur_couvre_toutes_les_classes_cochees() {
        let conn = migrated_db("prof-absent");
        peupler(&conn);
        let creees = create_teacher_absence(
            &conn,
            &TeacherAbsenceInput {
                // Deux fois « s1 » : une classe cochée deux fois ne doit pas se
                // heurter à sa propre ligne.
                session_ids: vec!["s1".into(), "s2".into(), "s1".into()],
                reason: "Formation".into(),
                start_date: "2027-01-18".into(),
                end_date: "2027-01-20".into(),
            },
        )
        .unwrap();

        assert_eq!(creees.len(), 2);
        for periode in &creees {
            assert!(periode.teacher_absent);
            // Les trois valeurs que la commande écrit en dur, et qu'aucun
            // paramètre ne peut contredire.
            assert!(!periode.attendance_expected);
            assert_eq!(periode.student_id, None);
        }
        assert_eq!(list_periods(&conn, "s1").unwrap().len(), 1);
        assert_eq!(list_periods(&conn, "s2").unwrap().len(), 1);
    }

    #[test]
    fn une_absence_du_professeur_est_refusee_en_bloc_et_nomme_la_classe() {
        let conn = migrated_db("prof-absent-bloc");
        peupler(&conn);
        create_period(
            &conn,
            "s2",
            &saisie(None, "Stage en entreprise", "2027-01-18", "2027-01-22"),
        )
        .unwrap();

        let erreur = create_teacher_absence(
            &conn,
            &TeacherAbsenceInput {
                session_ids: vec!["s1".into(), "s2".into()],
                reason: "Formation".into(),
                start_date: "2027-01-18".into(),
                end_date: "2027-01-20".into(),
            },
        )
        .unwrap_err();

        assert!(
            erreur.starts_with("3ème B : "),
            "le message doit nommer la classe à décocher : {erreur}"
        );
        // Tout ou rien : la première classe avait déjà reçu sa ligne dans la
        // boucle, et c'est la transaction de la commande qui l'annule. Ici, sans
        // transaction, elle est bien là — le test porte sur le message.
        assert_eq!(list_periods(&conn, "s2").unwrap().len(), 1);
    }

    #[test]
    fn une_classe_decochee_partout_est_refusee() {
        let conn = migrated_db("prof-absent-vide");
        peupler(&conn);
        let erreur = create_teacher_absence(
            &conn,
            &TeacherAbsenceInput {
                session_ids: vec!["".into(), "   ".into()],
                reason: "Formation".into(),
                start_date: "2027-01-18".into(),
                end_date: "2027-01-20".into(),
            },
        )
        .unwrap_err();
        assert!(erreur.starts_with("Cochez au moins une classe"), "{erreur}");
    }

    #[test]
    fn une_absence_du_professeur_ne_devient_ni_nominative_ni_avec_appel() {
        let conn = migrated_db("prof-absent-figee");
        peupler(&conn);
        let periode = create_teacher_absence(
            &conn,
            &TeacherAbsenceInput {
                session_ids: vec!["s1".into()],
                reason: "Formation".into(),
                start_date: "2027-01-18".into(),
                end_date: "2027-01-20".into(),
            },
        )
        .unwrap()
        .remove(0);

        let avec_appel = update_period(
            &conn,
            &periode.id,
            &saisie_avec_appel("Formation", "2027-01-18", "2027-01-20"),
        )
        .unwrap_err();
        assert!(avec_appel.contains("personne n'a fait l'appel"), "{avec_appel}");

        let nominative = update_period(
            &conn,
            &periode.id,
            &saisie(Some("e1"), "Formation", "2027-01-18", "2027-01-20"),
        )
        .unwrap_err();
        assert!(nominative.contains("toute la classe"), "{nominative}");

        // Et la correction des dates, elle, reste possible : c'est une absence
        // du professeur, pas une ligne en lecture seule.
        let decalee = update_period(
            &conn,
            &periode.id,
            &saisie(None, "Formation", "2027-01-19", "2027-01-21"),
        )
        .unwrap();
        assert_eq!(decalee.start_date, "2027-01-19");
        assert!(decalee.teacher_absent);
    }

    /// Le palier 023 : un stage du groupe 1 n'écarte que ce que le groupe 1
    /// aurait suivi. Sans le prédicat, il viderait aussi le dénominateur des
    /// élèves du groupe 2, qui étaient pourtant en cours cette semaine-là.
    #[test]
    fn une_periode_de_groupe_n_ecarte_que_les_seances_de_son_groupe() {
        let conn = migrated_db("groupe-portee");
        peupler(&conn);
        peupler_les_groupes(&conn);

        // c1 est au groupe 1, c2 au groupe 2, c3 est annulée.
        let g1 = create_period(
            &conn,
            "s1",
            &saisie_de_groupe("g1", "Stage", "2027-01-18", "2027-01-20"),
        )
        .unwrap();
        assert_eq!(g1.seance_count, 1);
        assert_eq!(g1.group_name.as_deref(), Some("Groupe 1"));

        // La même fenêtre pour toute la classe en compte deux : une période
        // sans groupe n'est bornée par rien, c'est l'autre moitié du prédicat.
        let classe = create_period(
            &conn,
            "s1",
            &saisie(None, "Sortie", "2027-01-18", "2027-01-20"),
        )
        .unwrap();
        assert_eq!(classe.seance_count, 2);
    }

    /// Les deux groupes partent en stage à une semaine d'intervalle, parfois
    /// la même : les déclarer en conflit aurait interdit la saisie dans le cas
    /// même que ce palier sert. Mais deux périodes du MÊME groupe se gênent
    /// toujours, comme deux périodes de la même classe.
    #[test]
    fn deux_groupes_se_chevauchent_sans_conflit_mais_pas_un_groupe_avec_lui_meme() {
        let conn = migrated_db("groupe-chevauchement");
        peupler(&conn);
        peupler_les_groupes(&conn);

        create_period(
            &conn,
            "s1",
            &saisie_de_groupe("g1", "Stage", "2027-01-18", "2027-01-22"),
        )
        .unwrap();
        create_period(
            &conn,
            "s1",
            &saisie_de_groupe("g2", "Stage", "2027-01-18", "2027-01-22"),
        )
        .unwrap();

        let erreur = create_period(
            &conn,
            "s1",
            &saisie_de_groupe("g1", "Hospitalisation", "2027-01-20", "2027-01-25"),
        )
        .unwrap_err();
        assert!(erreur.contains("Ce groupe a"), "{erreur}");
    }

    /// Les trois refus de cible, en français et avant la base.
    #[test]
    fn une_periode_vise_un_eleve_ou_un_groupe_jamais_les_deux() {
        let conn = migrated_db("groupe-cible");
        peupler(&conn);
        peupler_les_groupes(&conn);

        let deux = create_period(
            &conn,
            "s1",
            &AbsencePeriodInput {
                student_id: Some("e1".into()),
                ..saisie_de_groupe("g1", "Stage", "2027-01-18", "2027-01-20")
            },
        )
        .unwrap_err();
        assert!(deux.contains("OU un groupe"), "{deux}");

        // Le groupe de la 3ème B n'a rien à faire dans une période de la 4ème A :
        // la clé étrangère l'accepterait, elle ne pointe que `student_groups`.
        let ailleurs = create_period(
            &conn,
            "s1",
            &saisie_de_groupe("g9", "Stage", "2027-01-18", "2027-01-20"),
        )
        .unwrap_err();
        assert!(ailleurs.contains("autre classe"), "{ailleurs}");

        let inconnu = create_period(
            &conn,
            "s1",
            &saisie_de_groupe("gX", "Stage", "2027-01-18", "2027-01-20"),
        )
        .unwrap_err();
        assert!(inconnu.contains("introuvable"), "{inconnu}");

        // Et rien n'a été écrit : les trois refus sont antérieurs à l'INSERT.
        assert!(list_periods(&conn, "s1").unwrap().is_empty());
    }

    /// Le professeur n'est pas absent pour une moitié de classe. Trois étages
    /// le disent ; celui-ci vérifie le seul qui parle français.
    #[test]
    fn une_absence_du_professeur_ne_vise_pas_un_groupe() {
        let conn = migrated_db("groupe-prof");
        peupler(&conn);
        peupler_les_groupes(&conn);

        let periode = create_teacher_absence(
            &conn,
            &TeacherAbsenceInput {
                session_ids: vec!["s1".into()],
                reason: "Formation".into(),
                start_date: "2027-01-18".into(),
                end_date: "2027-01-20".into(),
            },
        )
        .unwrap()
        .remove(0);
        assert!(periode.group_id.is_none());

        let erreur = update_period(
            &conn,
            &periode.id,
            &saisie_de_groupe("g1", "Formation", "2027-01-18", "2027-01-20"),
        )
        .unwrap_err();
        assert!(erreur.contains("viser un groupe"), "{erreur}");
    }
}
