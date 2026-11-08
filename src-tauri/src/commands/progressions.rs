//! La progression annuelle d'une classe : les domaines explorés, les étapes de
//! l'année, les activités et les semaines où elles tombent.
//!
//! Le modèle et ses six choix structurants sont documentés dans
//! `db/sql/019_progression.sql`. Quatre d'entre eux pèsent sur ce module :
//!
//! * **Le vocabulaire appartient à l'enseignant.** `progression_domaines`
//!   arrive vide et aucune commande n'y sème quoi que ce soit — pas même les
//!   quatre domaines du référentiel Habitat que son document cite.
//!
//! * **L'activité ne porte pas `progression_id`.** Elle pend à son étape, qui
//!   pend à la progression. Toute vérification d'appartenance passe donc par
//!   deux jointures, écrites une fois pour toutes dans `PROGRESSION_DE_L_ACTIVITE`.
//!
//! * **Une plage dont l'activité appartient à une autre progression est
//!   refusée, jamais rectifiée.** La clé primaire des plages duplique
//!   `progression_id` pour rendre irreprésentable « deux activités la même
//!   semaine sur la même voie » ; le prix est ce contrôle. Rectifier en
//!   silence — en déduisant la progression de l'activité et en ignorant celle
//!   qu'on nous a passée — masquerait le défaut d'écran qui a produit le couple
//!   contradictoire. C'est la règle de `resolve_entry_session` au palier 016.
//!
//! * **Le rang d'une activité dans l'année est calculé ici**, à la lecture, par
//!   le parcours `(etape.position, activite.position)`. C'est lui qui décide de
//!   la couleur, et la couleur est le seul lien entre la frise et le tableau du
//!   bas. Le front ne le recalcule pas : deux parcours de la même liste
//!   finiraient par différer sur le tri d'égalité, et la frise annoncerait une
//!   couleur que le tableau ne confirmerait pas — c'est exactement le défaut du
//!   document d'origine.
//!
//! **Les semaines ne sont pas stockées comme des numéros.** `week_monday` est
//! le lundi, une date, et ce module vérifie que c'en est bien un : une plage
//! posée un mercredi passerait le GLOB du schéma et resterait invisible sur une
//! frise qui indexe par lundi.

use chrono::Datelike;
use rusqlite::params;
use serde::Serialize;
use std::collections::HashSet;
use uuid::Uuid;

use crate::commands::timetable::parse_date;
use crate::db::collect;
use crate::state::AppState;

/// Une activité telle que `ACTIVITES` la rend : identifiant, étape, domaine,
/// position, intitulé.
///
/// Elle passe par ce tuple et non directement par `ProgressionActivite` parce
/// que le **rang** ne vient pas de la base : il est le compteur du parcours, et
/// ne peut donc être posé qu'après la lecture complète.
type ActiviteBrute = (String, String, Option<String>, i32, String);

/// Un domaine d'activité du vocabulaire de l'enseignant.
#[derive(Debug, Clone, Serialize)]
pub struct ProgressionDomaine {
    pub id: String,
    pub name: String,
    pub position: i32,
    /// Combien d'activités le citent, toutes classes et toutes années
    /// confondues.
    ///
    /// Rendu par le listage pour que l'écran puisse dire ce qu'une suppression
    /// va heurter **avant** de la proposer : la clé étrangère est en RESTRICT,
    /// donc le refus arriverait de toute façon, mais sous la forme d'un message
    /// de SQLite plutôt que d'un décompte.
    pub activity_count: i64,
}

/// Une activité, à sa place dans l'année.
#[derive(Debug, Clone, Serialize)]
pub struct ProgressionActivite {
    pub id: String,
    pub etape_id: String,
    /// `None` = domaine pas encore choisi. Quatre activités du document de
    /// l'auteur étaient dans ce cas.
    pub domaine_id: Option<String>,
    pub position: i32,
    pub libelle: String,
    /// Rang dans l'année, à partir de 0, toutes étapes confondues.
    ///
    /// **C'est la couleur.** `src/lib/progression.ts` en tire une teinte, et la
    /// frise comme le tableau imprimé lisent ce même rang : ils ne peuvent donc
    /// pas se contredire.
    pub rang: i32,
}

/// Une étape de l'année, et les activités qu'elle couvre.
#[derive(Debug, Clone, Serialize)]
pub struct ProgressionEtape {
    pub id: String,
    pub position: i32,
    /// `""` = étape sans titre, et c'est le cas normal : les quatre blocs du
    /// document de l'auteur n'en avaient pas.
    pub libelle: String,
    /// Les trois textes libres, une ligne par puce. Jamais `null` : une valeur
    /// qui a deux façons de dire « vide » finit par n'être testée que d'une des
    /// deux.
    pub competences: String,
    pub connaissances: String,
    pub priorites: String,
    pub activites: Vec<ProgressionActivite>,
}

/// L'occupation d'une semaine par une activité.
#[derive(Debug, Clone, Serialize)]
pub struct ProgressionPlage {
    pub week_monday: String,
    /// 0 = bande principale, 1 = bande parallèle.
    pub voie: i32,
    pub activite_id: String,
}

/// La progression d'une classe, d'un seul appel.
///
/// Tout arrive ensemble parce que tout s'affiche ensemble : la frise a besoin
/// des plages ET des activités pour les nommer, et le tableau du bas a besoin
/// des étapes ET des activités. Trois commandes auraient voulu dire trois
/// chargements à tenir cohérents dans l'écran.
#[derive(Debug, Clone, Serialize)]
pub struct Progression {
    pub id: String,
    pub session_id: String,
    pub titre: String,
    pub intitule_groupe: String,
    pub devise: String,
    pub etapes: Vec<ProgressionEtape>,
    pub plages: Vec<ProgressionPlage>,
}

// ---------------------------------------------------------------------------
// Requêtes littérales — jamais assemblées par `format!`, pour que `sql_smoke`
// les prépare contre le schéma migré.
// ---------------------------------------------------------------------------

const DOMAINES: &str = "SELECT d.id, d.name, d.position, COUNT(a.id)
     FROM progression_domaines d
     LEFT JOIN progression_activites a ON a.domaine_id = d.id
     GROUP BY d.id
     ORDER BY d.position, d.name COLLATE NOCASE";

const DOMAINE_PAR_NOM: &str =
    "SELECT id FROM progression_domaines WHERE name = ?1 COLLATE NOCASE";

const PROGRESSION_DE_LA_CLASSE: &str =
    "SELECT id, session_id, titre, intitule_groupe, devise FROM progressions
      WHERE session_id = ?1";

const ETAPES: &str = "SELECT id, position, libelle, competences, connaissances, priorites
     FROM progression_etapes
    WHERE progression_id = ?1
    ORDER BY position, created_at, id";

const ACTIVITES: &str = "SELECT a.id, a.etape_id, a.domaine_id, a.position, a.libelle
     FROM progression_activites a
     JOIN progression_etapes e ON e.id = a.etape_id
    WHERE e.progression_id = ?1
    ORDER BY e.position, e.created_at, e.id, a.position, a.created_at, a.id";

const PLAGES: &str = "SELECT week_monday, voie, activite_id FROM progression_plages
      WHERE progression_id = ?1
      ORDER BY week_monday, voie";

/// Les deux jointures qui remontent de l'activité à sa progression.
///
/// Un seul endroit, parce que c'est le contrôle d'appartenance de tout le
/// module : une activité déplacée d'étape change de progression sans changer de
/// ligne, et un contrôle recopié ailleurs aurait pu ne pas suivre.
const PROGRESSION_DE_L_ACTIVITE: &str = "SELECT e.progression_id
     FROM progression_activites a
     JOIN progression_etapes e ON e.id = a.etape_id
    WHERE a.id = ?1";

const PROGRESSION_DE_L_ETAPE: &str = "SELECT progression_id FROM progression_etapes WHERE id = ?1";

// ---------------------------------------------------------------------------
// Le vocabulaire des domaines
// ---------------------------------------------------------------------------

/// Les domaines d'activité, avec ce que chacun emporterait.
#[tauri::command]
pub fn get_progression_domaines(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ProgressionDomaine>, String> {
    let conn = state.conn()?;
    collect(&conn, DOMAINES, [], |row| {
        Ok(ProgressionDomaine {
            id: row.get(0)?,
            name: row.get(1)?,
            position: row.get(2)?,
            activity_count: row.get(3)?,
        })
    })
}

#[tauri::command]
pub fn create_progression_domaine(
    state: tauri::State<'_, AppState>,
    name: String,
) -> Result<ProgressionDomaine, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Le nom du domaine est obligatoire.".to_string());
    }

    let conn = state.conn()?;

    // Le doublon est intercepté ici pour le NOMMER. L'index unique le refuserait
    // de toute façon, mais « UNIQUE constraint failed » n'apprend rien à
    // l'enseignant qui vient de retaper « aménagement » en minuscules.
    let existant: Option<String> = conn
        .query_row(DOMAINE_PAR_NOM, params![name], |row| row.get(0))
        .ok();
    if existant.is_some() {
        return Err(format!("Le domaine « {name} » existe déjà."));
    }

    let position: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM progression_domaines",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO progression_domaines (id, name, position) VALUES (?1, ?2, ?3)",
        params![id, name, position],
    )
    .map_err(|e| e.to_string())?;

    Ok(ProgressionDomaine {
        id,
        name: name.to_string(),
        position,
        activity_count: 0,
    })
}

#[tauri::command]
pub fn rename_progression_domaine(
    state: tauri::State<'_, AppState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Le nom du domaine est obligatoire.".to_string());
    }

    let conn = state.conn()?;

    let existant: Option<String> = conn
        .query_row(DOMAINE_PAR_NOM, params![name], |row| row.get(0))
        .ok();
    if let Some(autre) = existant {
        if autre != id {
            return Err(format!("Le domaine « {name} » existe déjà."));
        }
    }

    let touched = conn
        .execute(
            "UPDATE progression_domaines SET name = ?2 WHERE id = ?1",
            params![id, name],
        )
        .map_err(|e| e.to_string())?;
    if touched == 0 {
        return Err("Domaine introuvable.".to_string());
    }
    Ok(())
}

/// Retire un domaine du vocabulaire.
///
/// Le refus est **compté avant d'être prononcé** : la clé étrangère est en
/// RESTRICT, donc l'ordre échouerait seul, mais sur un message de SQLite. Dire
/// « 8 activités » est la seule forme utile — l'enseignant sait alors s'il a
/// renommé par erreur ou s'il doit détacher huit activités.
#[tauri::command]
pub fn delete_progression_domaine(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let conn = state.conn()?;

    let employe: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM progression_activites WHERE domaine_id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if employe > 0 {
        return Err(format!(
            "Ce domaine est employé par {employe} activité(s) : détachez-les d'abord."
        ));
    }

    let touched = conn
        .execute("DELETE FROM progression_domaines WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if touched == 0 {
        return Err("Domaine introuvable.".to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// La progression
// ---------------------------------------------------------------------------

/// La progression d'une classe, ou `None` si elle n'en a pas encore.
///
/// **Cette lecture n'écrit pas.** Créer la progression au premier affichage
/// aurait semé une ligne vide pour chaque classe jamais ouverte, et aurait fait
/// d'un simple coup d'œil une modification — `db::bounds_or_default` tient la
/// même règle face à `ensure_bounds`.
#[tauri::command]
pub fn get_progression(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Option<Progression>, String> {
    let conn = state.conn()?;

    let entete: Option<(String, String, String, String, String)> = conn
        .query_row(PROGRESSION_DE_LA_CLASSE, params![session_id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .ok();

    let Some((id, session_id, titre, intitule_groupe, devise)) = entete else {
        return Ok(None);
    };

    let mut etapes: Vec<ProgressionEtape> = collect(&conn, ETAPES, params![id], |row| {
        Ok(ProgressionEtape {
            id: row.get(0)?,
            position: row.get(1)?,
            libelle: row.get(2)?,
            competences: row.get(3)?,
            connaissances: row.get(4)?,
            priorites: row.get(5)?,
            activites: Vec::new(),
        })
    })?;

    // Les activités arrivent déjà dans l'ordre de l'année — `ACTIVITES` trie par
    // position d'étape puis par position d'activité. Le rang est donc le compteur
    // de ce parcours, et rien d'autre ne le définit.
    let brutes: Vec<ActiviteBrute> = collect(&conn, ACTIVITES, params![id], |row| {
        Ok((
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
        ))
    })?;

    for (rang, (aid, etape_id, domaine_id, position, libelle)) in brutes.into_iter().enumerate() {
        let activite = ProgressionActivite {
            id: aid,
            etape_id: etape_id.clone(),
            domaine_id,
            position,
            libelle,
            rang: rang as i32,
        };
        // L'étape est forcément présente : `ACTIVITES` part d'une jointure sur
        // `ETAPES`, qui vient d'être lue dans la même connexion.
        if let Some(etape) = etapes.iter_mut().find(|e| e.id == etape_id) {
            etape.activites.push(activite);
        }
    }

    let plages = collect(&conn, PLAGES, params![id], |row| {
        Ok(ProgressionPlage {
            week_monday: row.get(0)?,
            voie: row.get(1)?,
            activite_id: row.get(2)?,
        })
    })?;

    Ok(Some(Progression {
        id,
        session_id,
        titre,
        intitule_groupe,
        devise,
        etapes,
        plages,
    }))
}

#[tauri::command]
pub fn create_progression(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Progression, String> {
    let conn = state.conn()?;

    let classe: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if classe == 0 {
        return Err("Classe introuvable.".to_string());
    }

    let deja: Option<String> = conn
        .query_row(PROGRESSION_DE_LA_CLASSE, params![session_id], |row| {
            row.get(0)
        })
        .ok();
    if deja.is_some() {
        return Err("Cette classe a déjà une progression.".to_string());
    }

    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO progressions (id, session_id) VALUES (?1, ?2)",
        params![id, session_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(Progression {
        id,
        session_id,
        titre: String::new(),
        intitule_groupe: String::new(),
        devise: String::new(),
        etapes: Vec::new(),
        plages: Vec::new(),
    })
}

/// Les trois libellés de l'en-tête — titre imprimé, intitulé de groupe, devise.
///
/// Disjointe de tout ce qui touche aux étapes et aux plages : ce sont les
/// colonnes d'un seul formulaire, et aucun autre appelant ne les écrit.
#[tauri::command]
pub fn update_progression_meta(
    state: tauri::State<'_, AppState>,
    id: String,
    titre: String,
    intitule_groupe: String,
    devise: String,
) -> Result<(), String> {
    let conn = state.conn()?;
    let touched = conn
        .execute(
            "UPDATE progressions
                SET titre = ?2, intitule_groupe = ?3, devise = ?4,
                    updated_at = datetime('now')
              WHERE id = ?1",
            params![id, titre.trim(), intitule_groupe.trim(), devise.trim()],
        )
        .map_err(|e| e.to_string())?;
    if touched == 0 {
        return Err("Progression introuvable.".to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Les étapes
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn create_progression_etape(
    state: tauri::State<'_, AppState>,
    progression_id: String,
    libelle: String,
) -> Result<ProgressionEtape, String> {
    let conn = state.conn()?;

    let position: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM progression_etapes
              WHERE progression_id = ?1",
            params![progression_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO progression_etapes (id, progression_id, position, libelle)
              VALUES (?1, ?2, ?3, ?4)",
        params![id, progression_id, position, libelle.trim()],
    )
    .map_err(|e| e.to_string())?;

    Ok(ProgressionEtape {
        id,
        position,
        libelle: libelle.trim().to_string(),
        competences: String::new(),
        connaissances: String::new(),
        priorites: String::new(),
        activites: Vec::new(),
    })
}

/// Le titre de l'étape et ses trois textes.
///
/// **Une seule commande pour quatre colonnes**, à l'inverse de
/// `update_seance_meta` / `update_seance_content`. La règle des écritures
/// disjointes vise le cas où deux appelants écrivent la même ligne avec des
/// champs qu'ils n'ont pas rafraîchis ; ici les quatre colonnes sont les quatre
/// champs d'un formulaire unique, enregistrés d'un seul geste, et aucun autre
/// écran ne les touche. Le réordonnancement, lui, est une autre commande :
/// autre colonne, autre appelant, autre moment.
#[tauri::command]
pub fn update_progression_etape(
    state: tauri::State<'_, AppState>,
    id: String,
    libelle: String,
    competences: String,
    connaissances: String,
    priorites: String,
) -> Result<(), String> {
    let conn = state.conn()?;
    let touched = conn
        .execute(
            "UPDATE progression_etapes
                SET libelle = ?2, competences = ?3, connaissances = ?4,
                    priorites = ?5, updated_at = datetime('now')
              WHERE id = ?1",
            params![
                id,
                libelle.trim(),
                competences.trim(),
                connaissances.trim(),
                priorites.trim()
            ],
        )
        .map_err(|e| e.to_string())?;
    if touched == 0 {
        return Err("Étape introuvable.".to_string());
    }
    Ok(())
}

/// Supprime une étape, ses activités et leurs plages.
///
/// La cascade est en deux sauts et c'est le **schéma** qui la tient, pas ce
/// code : écrite à la main ici, elle aurait laissé des plages orphelines le
/// jour où une autre commande supprimerait une étape. L'écran avertit avant
/// d'appeler — il a déjà la liste des activités et les plages de la
/// progression, donc il sait compter ce que le geste emporte.
#[tauri::command]
pub fn delete_progression_etape(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let conn = state.conn()?;
    let touched = conn
        .execute("DELETE FROM progression_etapes WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if touched == 0 {
        return Err("Étape introuvable.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn reorder_progression_etapes(
    state: tauri::State<'_, AppState>,
    progression_id: String,
    ordered_ids: Vec<String>,
) -> Result<(), String> {
    verifier_liste(&ordered_ids)?;

    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let total: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM progression_etapes WHERE progression_id = ?1",
            params![progression_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if total != ordered_ids.len() as i64 {
        return Err(format!(
            "La réorganisation porte sur {} étape(s) alors que la progression en \
             contient {total} : rechargez l'écran.",
            ordered_ids.len()
        ));
    }

    {
        let mut stmt = tx
            .prepare(
                "UPDATE progression_etapes SET position = ?3
                  WHERE id = ?2 AND progression_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        for (index, id) in ordered_ids.iter().enumerate() {
            let touched = stmt
                .execute(params![progression_id, id, index as i32])
                .map_err(|e| e.to_string())?;
            if touched == 0 {
                return Err(
                    "Une étape de la liste n'appartient plus à cette progression : \
                     rechargez l'écran."
                        .to_string(),
                );
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Les activités
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn create_progression_activite(
    state: tauri::State<'_, AppState>,
    etape_id: String,
    libelle: String,
    domaine_id: Option<String>,
) -> Result<(), String> {
    let libelle = libelle.trim();
    if libelle.is_empty() {
        return Err("L'intitulé de l'activité est obligatoire.".to_string());
    }

    let conn = state.conn()?;

    let position: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM progression_activites
              WHERE etape_id = ?1",
            params![etape_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO progression_activites (id, etape_id, domaine_id, position, libelle)
              VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            Uuid::new_v4().to_string(),
            etape_id,
            domaine_id,
            position,
            libelle
        ],
    )
    .map_err(|e| e.to_string())?;

    // Rien n'est rendu : ajouter une activité change le RANG de toutes celles
    // qui suivent, donc leur couleur. L'écran recharge la progression — lui
    // renvoyer la seule ligne créée l'inviterait à l'insérer sur place et à
    // garder des couleurs périmées.
    Ok(())
}

#[tauri::command]
pub fn update_progression_activite(
    state: tauri::State<'_, AppState>,
    id: String,
    libelle: String,
    domaine_id: Option<String>,
) -> Result<(), String> {
    let libelle = libelle.trim();
    if libelle.is_empty() {
        return Err("L'intitulé de l'activité est obligatoire.".to_string());
    }

    let conn = state.conn()?;
    let touched = conn
        .execute(
            "UPDATE progression_activites
                SET libelle = ?2, domaine_id = ?3, updated_at = datetime('now')
              WHERE id = ?1",
            params![id, libelle, domaine_id],
        )
        .map_err(|e| e.to_string())?;
    if touched == 0 {
        return Err("Activité introuvable.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn delete_progression_activite(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let conn = state.conn()?;
    let touched = conn
        .execute("DELETE FROM progression_activites WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if touched == 0 {
        return Err("Activité introuvable.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn reorder_progression_activites(
    state: tauri::State<'_, AppState>,
    etape_id: String,
    ordered_ids: Vec<String>,
) -> Result<(), String> {
    verifier_liste(&ordered_ids)?;

    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let total: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM progression_activites WHERE etape_id = ?1",
            params![etape_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if total != ordered_ids.len() as i64 {
        return Err(format!(
            "La réorganisation porte sur {} activité(s) alors que l'étape en \
             contient {total} : rechargez l'écran.",
            ordered_ids.len()
        ));
    }

    {
        let mut stmt = tx
            .prepare(
                "UPDATE progression_activites SET position = ?3
                  WHERE id = ?2 AND etape_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        for (index, id) in ordered_ids.iter().enumerate() {
            let touched = stmt
                .execute(params![etape_id, id, index as i32])
                .map_err(|e| e.to_string())?;
            if touched == 0 {
                return Err(
                    "Une activité de la liste n'appartient plus à cette étape : \
                     rechargez l'écran."
                        .to_string(),
                );
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Déplace une activité vers une autre étape, en fin de liste.
///
/// **Les deux étapes doivent appartenir à la même progression.** Sans ce
/// contrôle, une activité passerait d'une classe à l'autre en gardant ses
/// plages, qui portent `progression_id` : la frise de la classe d'origine
/// nommerait une activité qui ne lui appartient plus, et la table n'aurait
/// aucune contradiction visible à montrer.
#[tauri::command]
pub fn set_progression_activite_etape(
    state: tauri::State<'_, AppState>,
    id: String,
    etape_id: String,
) -> Result<(), String> {
    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let depart: String = tx
        .query_row(PROGRESSION_DE_L_ACTIVITE, params![id], |row| row.get(0))
        .map_err(|_| "Activité introuvable.".to_string())?;
    let arrivee: String = tx
        .query_row(PROGRESSION_DE_L_ETAPE, params![etape_id], |row| row.get(0))
        .map_err(|_| "Étape introuvable.".to_string())?;
    if depart != arrivee {
        return Err(
            "Une activité ne change pas de classe : l'étape visée appartient à une \
             autre progression."
                .to_string(),
        );
    }

    let position: i32 = tx
        .query_row(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM progression_activites
              WHERE etape_id = ?1",
            params![etape_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE progression_activites
            SET etape_id = ?2, position = ?3, updated_at = datetime('now')
          WHERE id = ?1",
        params![id, etape_id, position],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Les plages — peindre et dépeindre des semaines
// ---------------------------------------------------------------------------

/// Peint une activité sur une ou plusieurs semaines, d'un seul geste.
///
/// **Au pluriel, et en une transaction.** Tirer la souris sur six semaines est
/// le geste normal ; six commandes auraient produit six transactions, donc six
/// états intermédiaires visibles, et un échec au milieu aurait laissé une bande
/// à moitié peinte sans que rien ne le dise.
///
/// `REPLACE` et non `INSERT` : repeindre une semaine déjà occupée sur la même
/// voie est le geste de correction le plus fréquent, et un refus obligerait à
/// effacer d'abord.
#[tauri::command]
pub fn set_progression_plages(
    state: tauri::State<'_, AppState>,
    progression_id: String,
    week_mondays: Vec<String>,
    voie: i32,
    activite_id: String,
) -> Result<(), String> {
    verifier_voie(voie)?;
    let lundis = verifier_lundis(&week_mondays)?;

    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Le couple contradictoire est REFUSÉ, jamais rectifié : déduire la
    // progression de l'activité et ignorer celle qu'on nous a passée masquerait
    // le défaut d'écran qui a produit l'appel.
    let proprietaire: String = tx
        .query_row(PROGRESSION_DE_L_ACTIVITE, params![activite_id], |row| {
            row.get(0)
        })
        .map_err(|_| "Activité introuvable.".to_string())?;
    if proprietaire != progression_id {
        return Err(
            "Cette activité appartient à la progression d'une autre classe : \
             rechargez l'écran."
                .to_string(),
        );
    }

    {
        let mut stmt = tx
            .prepare(
                "REPLACE INTO progression_plages
                      (progression_id, week_monday, voie, activite_id)
                      VALUES (?1, ?2, ?3, ?4)",
            )
            .map_err(|e| e.to_string())?;
        for lundi in &lundis {
            stmt.execute(params![progression_id, lundi, voie, activite_id])
                .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Dépeint une ou plusieurs semaines sur une voie.
///
/// L'effacement est une commande à part, comme `delete_grade` : « rien » n'est
/// pas une valeur conventionnelle qu'on écrirait à la place: c'est l'absence de
/// ligne.
#[tauri::command]
pub fn clear_progression_plages(
    state: tauri::State<'_, AppState>,
    progression_id: String,
    week_mondays: Vec<String>,
    voie: i32,
) -> Result<(), String> {
    verifier_voie(voie)?;
    let lundis = verifier_lundis(&week_mondays)?;

    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    {
        let mut stmt = tx
            .prepare(
                "DELETE FROM progression_plages
                  WHERE progression_id = ?1 AND week_monday = ?2 AND voie = ?3",
            )
            .map_err(|e| e.to_string())?;
        for lundi in &lundis {
            stmt.execute(params![progression_id, lundi, voie])
                .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Validations — en français, avant toute écriture
// ---------------------------------------------------------------------------

fn verifier_liste(ordered_ids: &[String]) -> Result<(), String> {
    let unique: HashSet<&String> = ordered_ids.iter().collect();
    if unique.len() != ordered_ids.len() {
        return Err(
            "La liste de réorganisation contient deux fois le même élément : \
             rechargez l'écran."
                .to_string(),
        );
    }
    Ok(())
}

fn verifier_voie(voie: i32) -> Result<(), String> {
    if voie != 0 && voie != 1 {
        return Err("La frise n'a que deux bandes.".to_string());
    }
    Ok(())
}

/// Chaque semaine est désignée par son **lundi**, et c'est vérifié.
///
/// Le GLOB du schéma n'accepte qu'une forme ; il laisserait passer un mercredi.
/// Une plage posée un mercredi serait écrite sans erreur puis resterait
/// invisible, la frise cherchant les lundis — la panne la plus coûteuse à
/// diagnostiquer est celle qui ne lève rien.
fn verifier_lundis(week_mondays: &[String]) -> Result<Vec<String>, String> {
    if week_mondays.is_empty() {
        return Err("Aucune semaine désignée.".to_string());
    }
    let mut lundis = Vec::with_capacity(week_mondays.len());
    for brut in week_mondays {
        let date = parse_date(brut, "La semaine")?;
        if date.weekday().number_from_monday() != 1 {
            return Err(format!(
                "« {brut} » n'est pas un lundi : une semaine est désignée par son lundi."
            ));
        }
        lundis.push(brut.clone());
    }
    Ok(lundis)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// Une base migrée, en mémoire, avec une classe et sa progression.
    ///
    /// Les commandes prennent un `AppState`, qui exige un verrou de fichier et
    /// une disposition portable : ces tests éprouvent donc les **règles**
    /// (appartenance, lundi, voie) sur la connexion directement, là où elles
    /// sont vérifiables sans fabriquer un faux environnement Tauri.
    fn base(nom: &str) -> Connection {
        let dir = std::env::temp_dir().join(format!("sgpa-prog-{nom}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = Connection::open(dir.join("sgpa.db")).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::db::migrations::run(&mut conn, &dir).unwrap();

        // Une instruction par littéral : `sql_smoke` extrait les chaînes de CE
        // fichier aussi, et prépare chacune contre le schéma — un lot de
        // plusieurs instructions serait refusé.
        for instruction in [
            "INSERT INTO sessions (id, name, level_code, year_start)
                  VALUES ('s1', '3ème A', '3eme', 2026),
                         ('s2', '4ème B', '4eme', 2026)",
            "INSERT INTO progressions (id, session_id) VALUES ('p1', 's1'), ('p2', 's2')",
            "INSERT INTO progression_etapes (id, progression_id, position)
                  VALUES ('et1', 'p1', 1), ('et2', 'p1', 2), ('et9', 'p2', 1)",
            "INSERT INTO progression_activites (id, etape_id, position, libelle)
                  VALUES ('a1', 'et1', 1, 'Trier le matériel'),
                         ('a2', 'et1', 2, 'Enduire'),
                         ('a3', 'et2', 1, 'Bardage'),
                         ('a9', 'et9', 1, 'Activité d''une autre classe')",
        ] {
            conn.execute_batch(instruction).unwrap();
        }
        conn
    }

    /// Le rang suit `(etape.position, activite.position)`, pas l'ordre
    /// d'insertion ni l'identifiant.
    ///
    /// C'est le rang qui décide de la couleur, donc du seul lien entre la frise
    /// et le tableau du bas. Un tri qui se déciderait sur `id` donnerait des
    /// couleurs stables mais fausses : deux activités voisines dans l'année
    /// recevraient des teintes éloignées, et l'enseignant perdrait la lecture
    /// « ça avance de gauche à droite ».
    #[test]
    fn le_rang_suit_l_ordre_de_l_annee() {
        let conn = base("rang");
        // On réordonne pour que l'ordre d'insertion ne puisse pas être
        // confondu avec l'ordre de l'année.
        conn.execute("UPDATE progression_etapes SET position = 1 WHERE id = 'et2'", [])
            .unwrap();
        conn.execute("UPDATE progression_etapes SET position = 2 WHERE id = 'et1'", [])
            .unwrap();

        let mut stmt = conn.prepare(ACTIVITES).unwrap();
        let ordre: Vec<String> = stmt
            .query_map(params!["p1"], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(ordre, vec!["a3", "a1", "a2"], "l'étape passe avant l'activité");
    }

    /// Une plage ne traverse pas la frontière d'une classe.
    ///
    /// `progression_id` est dupliqué sur la plage pour rendre irreprésentable
    /// « deux activités la même semaine sur la même voie ». La contrepartie est
    /// ce contrôle : sans lui, la frise de la 3ᵉ A pourrait nommer une activité
    /// de la 4ᵉ B, et aucune contrainte du schéma ne s'en plaindrait.
    #[test]
    fn une_activite_d_une_autre_classe_est_refusee() {
        let conn = base("frontiere");
        let proprietaire: String = conn
            .query_row(PROGRESSION_DE_L_ACTIVITE, params!["a9"], |row| row.get(0))
            .unwrap();
        assert_eq!(proprietaire, "p2");
        assert_ne!(
            proprietaire, "p1",
            "le contrôle d'appartenance doit voir la différence"
        );
    }

    /// Le lundi est vérifié, pas supposé.
    #[test]
    fn une_semaine_se_designe_par_son_lundi() {
        // 2026-09-07 est un lundi, 2026-09-09 un mercredi.
        assert!(verifier_lundis(&["2026-09-07".to_string()]).is_ok());
        let mercredi = verifier_lundis(&["2026-09-09".to_string()]);
        assert!(mercredi.is_err(), "un mercredi n'est pas un lundi");
        assert!(
            mercredi.unwrap_err().contains("lundi"),
            "le message doit dire ce qui est attendu"
        );
        // Le 30 février passe le GLOB du schéma, pas `parse_date`.
        assert!(verifier_lundis(&["2026-02-30".to_string()]).is_err());
        assert!(verifier_lundis(&[]).is_err(), "aucune semaine = rien à écrire");
    }

    #[test]
    fn la_frise_n_a_que_deux_bandes() {
        assert!(verifier_voie(0).is_ok());
        assert!(verifier_voie(1).is_ok());
        assert!(verifier_voie(2).is_err());
        assert!(verifier_voie(-1).is_err());
    }

    /// Supprimer une étape emporte ses activités ET leurs plages.
    ///
    /// La cascade est en deux sauts — la plage pend à l'activité, qui pend à
    /// l'étape. Une plage orpheline ne se verrait sur aucun écran : la frise lit
    /// par progression et par semaine, donc elle dessinerait une bande dont
    /// l'activité n'existe plus.
    #[test]
    fn supprimer_une_etape_ne_laisse_pas_une_plage_orpheline() {
        let conn = base("cascade");
        conn.execute_batch(
            "INSERT INTO progression_plages (progression_id, week_monday, voie, activite_id)
                  VALUES ('p1', '2026-09-07', 0, 'a1'),
                         ('p1', '2026-09-14', 0, 'a2'),
                         ('p1', '2026-09-21', 0, 'a3')",
        )
        .unwrap();

        conn.execute("DELETE FROM progression_etapes WHERE id = 'et1'", [])
            .unwrap();

        let restantes: Vec<String> = {
            let mut stmt = conn.prepare(PLAGES).unwrap();
            stmt.query_map(params!["p1"], |row| row.get::<_, String>(2))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(
            restantes,
            vec!["a3"],
            "les plages de l'étape supprimée partent avec elle"
        );

        let mut stmt = conn.prepare("PRAGMA foreign_key_check").unwrap();
        let orphan = stmt.query([]).unwrap().next().unwrap().is_some();
        assert!(!orphan);
    }
}
