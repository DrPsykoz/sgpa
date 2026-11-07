//! Besoins particuliers des élèves : dysorthographie, dyscalculie, AESH, PAP,
//! PPS, et la note libre qui porte ce qui ne se range pas en étiquette.
//!
//! Le modèle et ses trois choix structurants sont documentés dans
//! `db/sql/013_besoins_particuliers.sql`. Deux d'entre eux pèsent sur ce
//! module :
//!
//! * **Le vocabulaire appartient à l'enseignant.** `student_need_tags` arrive
//!   vide et aucune commande n'y sème quoi que ce soit. Les libellés viennent
//!   des notifications MDPH et des PAP de son établissement : une étiquette
//!   approchante, fournie par l'application, est une erreur qui ne se voit pas.
//!
//! * **Rien de tout ceci ne s'imprime.** Décision explicite de l'auteur. Ce
//!   sont des données de santé concernant des mineurs : `commands/reports.rs`
//!   ne lit aucune de ces deux tables, et ajouter `needs_note` à une projection
//!   de bilan serait un bug, pas un enrichissement.
//!
//! **La lecture est groupée par classe, pas greffée sur l'élève.**
//! `get_session_needs` rend tout d'un coup, et chaque écran (grille de notation,
//! feuille d'appel, liste de la classe, bilan à l'écran) indexe le résultat par
//! `student_id`. Greffer les étiquettes sur `Student`, sur
//! `AttendanceWithStudent` et sur la projection des notes aurait voulu dire
//! trois projections à faire évoluer ensemble pour la même information.

use rusqlite::params;
use serde::Serialize;
use uuid::Uuid;

use crate::state::AppState;

/// Une étiquette du vocabulaire de l'enseignant.
#[derive(Debug, Clone, Serialize)]
pub struct NeedTag {
    pub id: String,
    pub label: String,
    /// Abréviation pour les pastilles des écrans denses. `""` = aucune, et
    /// l'écran affiche alors le libellé complet. **Le front ne tronque jamais
    /// de lui-même** : « Dys » conviendrait aussi bien à « Dyscalculie » qu'à
    /// « Dysorthographie », qui ne demandent pas les mêmes aménagements.
    pub short_label: String,
    pub position: i32,
    /// Combien d'élèves la portent, toutes classes et toutes années confondues.
    ///
    /// Rendu par le listage pour que l'écran de réglages puisse dire ce qu'une
    /// suppression va emporter avant de la proposer.
    pub student_count: i64,
}

/// Les besoins d'UN élève : ses étiquettes, et sa note.
#[derive(Debug, Clone, Serialize)]
pub struct StudentNeeds {
    pub student_id: String,
    /// Identifiants seuls : le libellé vit dans le vocabulaire, que l'appelant
    /// a déjà. Le recopier sur chaque élève multiplierait la même chaîne par le
    /// nombre d'élèves qui la portent, et offrirait deux sources pour un même
    /// libellé renommé.
    pub tag_ids: Vec<String>,
    /// `""` = rien à signaler. Jamais `null` : une colonne qui a deux façons de
    /// dire « vide » finit par n'être testée que d'une des deux.
    pub note: String,
}

fn read_tag(row: &rusqlite::Row<'_>) -> rusqlite::Result<NeedTag> {
    Ok(NeedTag {
        id: row.get(0)?,
        label: row.get(1)?,
        short_label: row.get(2)?,
        position: row.get(3)?,
        student_count: row.get(4)?,
    })
}

/// Le vocabulaire complet, avec le nombre d'élèves par étiquette.
#[tauri::command]
pub fn get_need_tags(state: tauri::State<'_, AppState>) -> Result<Vec<NeedTag>, String> {
    let conn = state.conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.label, t.short_label, t.position, COUNT(n.student_id)
             FROM student_need_tags t
             LEFT JOIN student_needs n ON n.tag_id = t.id
             GROUP BY t.id
             ORDER BY t.position, t.label COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;

    let tags = stmt
        .query_map([], read_tag)
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(tags)
}

/// Crée une étiquette, ou rend celle qui existe déjà.
///
/// Même traitement que `create_professional_field`, et pour la même raison :
/// l'enseignant qui retape « AESH » veut l'étiquette AESH, pas un message
/// d'échec. La comparaison est insensible à la casse, comme l'index UNIQUE.
#[tauri::command]
pub fn create_need_tag(
    state: tauri::State<'_, AppState>,
    label: String,
    short_label: String,
) -> Result<NeedTag, String> {
    let label = label.trim();
    let short_label = short_label.trim();
    if label.is_empty() {
        return Err("Le libellé de l'étiquette est obligatoire.".to_string());
    }

    let conn = state.conn()?;

    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM student_need_tags WHERE label = ?1 COLLATE NOCASE",
            params![label],
            |row| row.get(0),
        )
        .ok();

    let id = match existing {
        Some(id) => id,
        None => {
            let position: i32 = conn
                .query_row(
                    "SELECT COALESCE(MAX(position), -1) + 1 FROM student_need_tags",
                    [],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            let id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO student_need_tags (id, label, short_label, position)
                 VALUES (?1, ?2, ?3, ?4)",
                params![id, label, short_label, position],
            )
            .map_err(|e| e.to_string())?;
            id
        }
    };

    conn.query_row(
        "SELECT t.id, t.label, t.short_label, t.position, COUNT(n.student_id)
         FROM student_need_tags t
         LEFT JOIN student_needs n ON n.tag_id = t.id
         WHERE t.id = ?1
         GROUP BY t.id",
        params![id],
        read_tag,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_need_tag(
    state: tauri::State<'_, AppState>,
    id: String,
    label: String,
    short_label: String,
) -> Result<(), String> {
    let label = label.trim();
    let short_label = short_label.trim();
    if label.is_empty() {
        return Err("Le libellé de l'étiquette est obligatoire.".to_string());
    }

    let conn = state.conn()?;

    // L'index UNIQUE refuserait le doublon, mais en anglais. Le test porte sur
    // les AUTRES lignes : renommer une étiquette en elle-même doit passer.
    let collision: Option<String> = conn
        .query_row(
            "SELECT label FROM student_need_tags
             WHERE label = ?1 COLLATE NOCASE AND id <> ?2",
            params![label, id],
            |row| row.get(0),
        )
        .ok();
    if let Some(autre) = collision {
        return Err(format!(
            "Une autre étiquette porte déjà le libellé « {autre} »."
        ));
    }

    let touched = conn
        .execute(
            "UPDATE student_need_tags SET label = ?1, short_label = ?2 WHERE id = ?3",
            params![label, short_label, id],
        )
        .map_err(|e| e.to_string())?;
    if touched == 0 {
        return Err("Étiquette introuvable".to_string());
    }
    Ok(())
}

/// Supprime une étiquette du vocabulaire, et donc de tous les élèves qui la
/// portent — c'est le `ON DELETE CASCADE` de `student_needs` qui s'en charge.
///
/// Aucun garde-fou ici : le nombre d'élèves concernés est déjà dans
/// `NeedTag::student_count`, donc l'écran peut le dire avant de proposer la
/// suppression. Refuser côté backend obligerait à dépointer l'étiquette de
/// chaque élève avant de pouvoir la retirer d'une liste devenue inutile.
#[tauri::command]
pub fn delete_need_tag(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.conn()?;
    let touched = conn
        .execute("DELETE FROM student_need_tags WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if touched == 0 {
        return Err("Étiquette introuvable".to_string());
    }
    Ok(())
}

/// Les besoins de TOUS les élèves d'une classe, d'un seul appel.
///
/// Les élèves sans étiquette ni note ne figurent pas dans le résultat : c'est
/// une table d'appoint, pas une projection de la classe. L'appelant indexe par
/// `student_id` et traite l'absence comme « rien à signaler ».
#[tauri::command]
pub fn get_session_needs(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Vec<StudentNeeds>, String> {
    let conn = state.conn()?;

    let mut par_eleve: std::collections::HashMap<String, StudentNeeds> =
        std::collections::HashMap::new();

    // Les notes d'abord : un élève peut n'avoir qu'une note, sans étiquette.
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, needs_note FROM students
                 WHERE session_id = ?1 AND needs_note <> ''",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (student_id, note) = row.map_err(|e| e.to_string())?;
            par_eleve.insert(
                student_id.clone(),
                StudentNeeds {
                    student_id,
                    tag_ids: Vec::new(),
                    note,
                },
            );
        }
    }

    // Puis les étiquettes, dans l'ordre du vocabulaire : deux élèves qui portent
    // les mêmes besoins doivent afficher leurs pastilles dans le même ordre,
    // sinon la colonne se lit mal d'une ligne à l'autre.
    {
        let mut stmt = conn
            .prepare(
                "SELECT n.student_id, n.tag_id
                 FROM student_needs n
                 JOIN students s ON s.id = n.student_id
                 JOIN student_need_tags t ON t.id = n.tag_id
                 WHERE s.session_id = ?1
                 ORDER BY t.position, t.label COLLATE NOCASE",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (student_id, tag_id) = row.map_err(|e| e.to_string())?;
            par_eleve
                .entry(student_id.clone())
                .or_insert_with(|| StudentNeeds {
                    student_id,
                    tag_ids: Vec::new(),
                    note: String::new(),
                })
                .tag_ids
                .push(tag_id);
        }
    }

    Ok(par_eleve.into_values().collect())
}

/// Remplace l'ensemble des étiquettes d'un élève.
///
/// Remplacement et non ajout : l'écran envoie la liste qu'il affiche, et une
/// commande qui n'ajouterait obligerait à appeler une seconde commande pour
/// chaque étiquette retirée — deux écritures pour un seul geste, dont la
/// seconde peut échouer.
///
/// **La note ne bouge pas ici.** Elle a sa propre commande : cocher une
/// étiquette ne doit pas réécrire un texte que l'écran n'a pas rafraîchi.
#[tauri::command]
pub fn set_student_needs(
    state: tauri::State<'_, AppState>,
    student_id: String,
    tag_ids: Vec<String>,
) -> Result<(), String> {
    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let known: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM students WHERE id = ?1",
            params![student_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if known == 0 {
        return Err("Élève introuvable".to_string());
    }

    tx.execute(
        "DELETE FROM student_needs WHERE student_id = ?1",
        params![student_id],
    )
    .map_err(|e| e.to_string())?;

    {
        let mut stmt = tx
            .prepare("INSERT OR IGNORE INTO student_needs (student_id, tag_id) VALUES (?1, ?2)")
            .map_err(|e| e.to_string())?;
        for tag_id in &tag_ids {
            stmt.execute(params![student_id, tag_id]).map_err(|e| {
                format!(
                    "L'étiquette n'a pas pu être posée sur l'élève : {e}.\n\
                     Elle a peut-être été supprimée du vocabulaire depuis \
                     l'affichage de cet écran."
                )
            })?;
        }
    }

    tx.commit().map_err(|e| e.to_string())
}

/// Écrit la note libre d'un élève, et RIEN d'autre.
///
/// Disjointe de `set_student_needs` pour la même raison que
/// `update_seance_content` est disjointe de `update_seance_meta` : une commande
/// qui écrirait les deux laisserait chaque appelant réécrire la moitié qu'il n'a
/// pas rafraîchie.
#[tauri::command]
pub fn update_student_needs_note(
    state: tauri::State<'_, AppState>,
    student_id: String,
    note: String,
) -> Result<(), String> {
    let conn = state.conn()?;
    let touched = conn
        .execute(
            "UPDATE students SET needs_note = ?1 WHERE id = ?2",
            params![note.trim(), student_id],
        )
        .map_err(|e| e.to_string())?;
    if touched == 0 {
        return Err("Élève introuvable".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    /// Les mots qui ne doivent apparaître dans aucun chemin d'impression.
    const MOTS: [&str; 3] = ["student_need_tags", "student_needs", "needs_note"];

    /// Les fichiers qui produisent un document remis à quelqu'un.
    const CHEMINS: [&str; 4] = [
        "src/commands/reports.rs",
        "src/commands/reports/scoring.rs",
        "src/commands/contracts.rs",
        "../src/lib/pdf.ts",
    ];

    /// Garde-fou de la décision « Jamais » : aucun document imprimé ne porte
    /// un besoin particulier d'élève.
    ///
    /// Le test lit les SOURCES plutôt que d'exécuter quoi que ce soit : la
    /// règle porte sur ce que ces fichiers peuvent lire, pas sur ce qu'ils ont
    /// lu pendant un essai. Il couvre aussi `src/lib/pdf.ts`, parce que c'est
    /// lui qui dessine réellement les PDF — un garde-fou qui s'arrêterait à la
    /// frontière du Rust laisserait passer exactement l'erreur qu'il surveille.
    #[test]
    fn aucun_chemin_d_impression_ne_lit_les_besoins() {
        let racine = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        for relatif in CHEMINS {
            let source = std::fs::read_to_string(racine.join(relatif))
                .unwrap_or_else(|e| {
                    panic!(
                        "Le garde-fou des besoins particuliers ne trouve plus \
                         {relatif} ({e}). Si ce fichier a été déplacé, \
                         corrigez le chemin dans ce test : ne le retirez pas \
                         de la liste."
                    )
                });
            for mot in MOTS {
                assert!(
                    !source.contains(mot),
                    "{relatif} cite « {mot} ». Les besoins particuliers des \
                     élèves ne figurent sur AUCUN document imprimé — ce sont \
                     des données de santé concernant des mineurs, et c'est \
                     une décision explicite de l'auteur. Affichez-les à \
                     l'écran, jamais dans un export."
                );
            }
        }
    }
}
