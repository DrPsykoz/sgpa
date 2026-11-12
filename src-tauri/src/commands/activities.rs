//! Le référentiel des activités professionnelles : domaines d'activité,
//! activités de référence, métiers. Les trois tables du palier 024, prises par
//! le bout de l'écriture.
//!
//! **Pourquoi un module et pas trois commandes dans `contracts.rs`.** Ce
//! module-là *lit* le référentiel pour remplir l'en-tête d'une fiche
//! (`get_activity_referential`), et c'est son seul rapport avec lui. Écrire le
//! référentiel est un autre métier, celui de l'écran Référentiel : mêmes
//! gestes qu'un arbre de compétences — ajouter, renommer, déplacer, supprimer
//! — sur d'autres tables. Les mélanger aurait mis dans un module de fiche
//! contrat des commandes dont une fiche contrat n'a jamais besoin.
//!
//! **Le semis n'est pas sacré.** Le palier 024 sème le champ Habitat tel que
//! le document national le nomme, mais rien n'interdit à l'enseignant de le
//! corriger, de l'étendre, ou d'en poser un pour un autre champ : c'est
//! exactement ce qu'il a demandé le 2026-11-12, « pouvoir modifier les valeurs
//! et en ajouter comme pour les compétences ». Une liste livrée qu'on ne peut
//! pas corriger est une liste fausse pour toujours.
//!
//! **Les requêtes sont des littéraux choisis par un `match`**, comme les
//! `Porteur` de `commands/attachments.rs` et pour la même raison : `sql_smoke`
//! les extrait du source et les fait préparer par SQLite. Une requête bâtie au
//! `format!` à partir du nom de table — ce que fait `referential.rs`, écrit
//! avant que ce garde-fou n'existe — échappe à cette vérification, et une
//! colonne renommée ne se verrait qu'à l'exécution.
//!
//! **Supprimer ne refuse pas, ici.** Une compétence employée se refuse puis
//! s'archive, parce que ses notes sont des faits. Un domaine d'activité cité
//! par une fiche contrat, lui, part en `ON DELETE SET NULL` : la fiche garde
//! son **libellé figé** et perd seulement le lien. La suppression est donc
//! toujours possible, et ce qui compte est de l'**annoncer** — d'où le
//! `sheet_count` rendu à la lecture, pour que l'écran puisse dire « 3 fiches
//! citent ce domaine » avant que le bouton ne soit pressé. Même raison que
//! l'`activity_count` des domaines de progression, conclusion inverse.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use uuid::Uuid;

use crate::commands::referential::{dedup_key, BulkResult, NodeRef};
use crate::state::AppState;

/// Borne du nom. Elle existe pour la même raison que celle de
/// `clean_entry_category` : un intitulé est affiché dans un menu déroulant et
/// imprimé dans une cellule de tableau. Et elle vit **ici**, pas dans un
/// CHECK — un CHECK refuserait en anglais ce que la commande refuse en
/// français, et une limite d'affichage n'est pas une règle de données.
const MAX_NAME_LEN: usize = 200;

/// Les trois niveaux écrivables. Le champ professionnel n'en fait pas partie :
/// il a déjà sa commande (`contracts::create_professional_field`), et les cinq
/// champs SEGPA sont une liste réglementaire que l'enseignant n'arbitre pas
/// seul — voir « Décisions en attente » du README.
#[derive(Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Ra16Kind {
    /// Un domaine d'activité, sous un champ professionnel.
    Domain,
    /// Une activité de référence, sous un domaine d'activité.
    Activity,
    /// Un métier, sous un domaine d'activité.
    Career,
}

/// Un niveau du référentiel, vu de l'écriture. Huit requêtes, aucune bâtie à
/// l'exécution.
struct Requetes {
    /// La fratrie sous ce parent, `(id, nom)`.
    ///
    /// **L'identifiant est lu, et ce n'est pas du zèle** : le refus du doublon
    /// doit exempter la ligne qu'on est en train de renommer, et l'exempter par
    /// son **nom** la laisserait renommer en le nom exact d'une voisine — le
    /// doublon passerait le contrôle français pour aller heurter l'index
    /// `UNIQUE`, et l'enseignant lirait une phrase SQLite en anglais.
    fratrie: &'static str,
    /// La position à donner au prochain enfant.
    position_suivante: &'static str,
    inserer: &'static str,
    renommer: &'static str,
    supprimer: &'static str,
    /// Le parent d'une ligne, pour vérifier qu'un renommage ou un déplacement
    /// reste dans sa fratrie.
    parent_de: &'static str,
    /// Le parent existe-t-il ? La clé étrangère le dirait aussi, mais en
    /// anglais : ce test existe pour la phrase.
    parent_existe: &'static str,
    repositionner: &'static str,
}

const DOMAINE: Requetes = Requetes {
    fratrie: "SELECT id, name FROM activity_domains WHERE professional_field_id = ?1",
    position_suivante: "SELECT COALESCE(MAX(position), -1) + 1 FROM activity_domains \
                        WHERE professional_field_id = ?1",
    inserer: "INSERT INTO activity_domains (id, professional_field_id, name, position) \
              VALUES (?1, ?2, ?3, ?4)",
    renommer: "UPDATE activity_domains SET name = ?1 WHERE id = ?2",
    supprimer: "DELETE FROM activity_domains WHERE id = ?1",
    parent_de: "SELECT professional_field_id FROM activity_domains WHERE id = ?1",
    parent_existe: "SELECT COUNT(*) FROM professional_fields WHERE id = ?1",
    repositionner: "UPDATE activity_domains SET position = ?1 \
                    WHERE id = ?2 AND professional_field_id = ?3",
};

const ACTIVITE: Requetes = Requetes {
    fratrie: "SELECT id, name FROM reference_activities WHERE activity_domain_id = ?1",
    position_suivante: "SELECT COALESCE(MAX(position), -1) + 1 FROM reference_activities \
                        WHERE activity_domain_id = ?1",
    inserer: "INSERT INTO reference_activities (id, activity_domain_id, name, position) \
              VALUES (?1, ?2, ?3, ?4)",
    renommer: "UPDATE reference_activities SET name = ?1 WHERE id = ?2",
    supprimer: "DELETE FROM reference_activities WHERE id = ?1",
    parent_de: "SELECT activity_domain_id FROM reference_activities WHERE id = ?1",
    parent_existe: "SELECT COUNT(*) FROM activity_domains WHERE id = ?1",
    repositionner: "UPDATE reference_activities SET position = ?1 \
                    WHERE id = ?2 AND activity_domain_id = ?3",
};

const METIER: Requetes = Requetes {
    fratrie: "SELECT id, name FROM careers WHERE activity_domain_id = ?1",
    position_suivante: "SELECT COALESCE(MAX(position), -1) + 1 FROM careers \
                        WHERE activity_domain_id = ?1",
    inserer: "INSERT INTO careers (id, activity_domain_id, name, position) \
              VALUES (?1, ?2, ?3, ?4)",
    renommer: "UPDATE careers SET name = ?1 WHERE id = ?2",
    supprimer: "DELETE FROM careers WHERE id = ?1",
    parent_de: "SELECT activity_domain_id FROM careers WHERE id = ?1",
    parent_existe: "SELECT COUNT(*) FROM activity_domains WHERE id = ?1",
    repositionner: "UPDATE careers SET position = ?1 \
                    WHERE id = ?2 AND activity_domain_id = ?3",
};

impl Ra16Kind {
    fn requetes(self) -> &'static Requetes {
        match self {
            Ra16Kind::Domain => &DOMAINE,
            Ra16Kind::Activity => &ACTIVITE,
            Ra16Kind::Career => &METIER,
        }
    }

    /// « le nom **du domaine d'activité** ne peut pas être vide ».
    fn article(self) -> &'static str {
        match self {
            Ra16Kind::Domain => "du domaine d'activité",
            Ra16Kind::Activity => "de l'activité de référence",
            Ra16Kind::Career => "du métier",
        }
    }

    /// « **Ce domaine d'activité** n'existe plus ». Démonstratif accordé : les
    /// trois genres diffèrent, et une phrase fausse grammaticalement se lit
    /// comme un défaut de l'application.
    fn demonstratif(self) -> &'static str {
        match self {
            Ra16Kind::Domain => "Ce domaine d'activité",
            Ra16Kind::Activity => "Cette activité de référence",
            Ra16Kind::Career => "Ce métier",
        }
    }

    /// Le parent, nommé pour le refus.
    fn demonstratif_du_parent(self) -> &'static str {
        match self {
            Ra16Kind::Domain => "Ce champ professionnel",
            Ra16Kind::Activity | Ra16Kind::Career => "Ce domaine d'activité",
        }
    }
}

/// Une entrée du référentiel, et ce qu'elle coûterait à supprimer.
#[derive(Serialize)]
pub struct Ra16Item {
    pub id: String,
    pub name: String,
    pub position: i32,
    /// Combien de fiches contrat la citent. **Rendu à la lecture**, pour que
    /// l'écran puisse l'annoncer avant la suppression : elles garderont leur
    /// libellé imprimé et perdront le lien, ce qui n'est pas une perte de
    /// donnée mais doit être dit.
    pub sheet_count: i64,
}

#[derive(Serialize)]
pub struct Ra16Domain {
    pub id: String,
    pub name: String,
    pub position: i32,
    pub sheet_count: i64,
    pub activities: Vec<Ra16Item>,
    pub careers: Vec<Ra16Item>,
}

#[derive(Serialize)]
pub struct Ra16Field {
    pub id: String,
    pub name: String,
    pub position: i32,
    pub domains: Vec<Ra16Domain>,
}

const CHAMPS: &str = "SELECT id, name, position FROM professional_fields ORDER BY position, name";

const DOMAINES: &str = "SELECT d.id, d.professional_field_id, d.name, d.position, \
                               (SELECT COUNT(*) FROM contract_sheets s \
                                 WHERE s.activity_domain_id = d.id) \
                          FROM activity_domains d \
                         ORDER BY d.position, d.name";

const ACTIVITES: &str = "SELECT a.id, a.activity_domain_id, a.name, a.position, \
                                (SELECT COUNT(*) FROM contract_sheets s \
                                  WHERE s.reference_activity_id = a.id) \
                           FROM reference_activities a \
                          ORDER BY a.position, a.name";

const METIERS: &str = "SELECT c.id, c.activity_domain_id, c.name, c.position, \
                              (SELECT COUNT(*) FROM contract_sheets s \
                                WHERE s.career_id = c.id) \
                         FROM careers c \
                        ORDER BY c.position, c.name";

/// Lit (parent, item) pour les trois niveaux : même projection, un seul
/// lecteur.
fn lire_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<(String, Ra16Item)> {
    Ok((
        row.get(1)?,
        Ra16Item {
            id: row.get(0)?,
            name: row.get(2)?,
            position: row.get(3)?,
            sheet_count: row.get(4)?,
        },
    ))
}

fn items_par_parent(
    conn: &rusqlite::Connection,
    sql: &'static str,
) -> Result<Vec<(String, Ra16Item)>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], lire_item).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// L'arbre complet, pour l'écran Référentiel.
///
/// **Quatre requêtes et un regroupement en Rust**, et non une jointure : les
/// activités et les métiers sont deux listes **sœurs** sous un domaine, donc
/// une seule jointure les multiplierait l'une par l'autre — huit activités et
/// cinq métiers donneraient quarante lignes, qu'il faudrait dédoublonner pour
/// retrouver treize entrées.
///
/// **Tous les champs professionnels sortent, même sans domaine.** Un champ
/// vide n'est pas une anomalie à masquer : c'est le cas normal de quatre des
/// cinq, et c'est précisément là que l'enseignant voudra poser son premier
/// domaine. Les masquer aurait rendu l'écran incapable de créer ce qu'il ne
/// montre pas.
#[tauri::command]
pub fn get_activity_referential_tree(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Ra16Field>, String> {
    let conn = state.conn()?;
    arbre(&conn)
}

/// Le corps, pris par la connexion et non par l'état.
///
/// **C'est ce qui le rend testable** : `tauri::State` ne se construit pas hors
/// d'une application — le harnais `mock_builder` meurt au démarrage sur ce
/// projet (voir la section « Tests » du README) —, donc une logique écrite
/// dans la commande elle-même n'a aucun test possible. Même partage que
/// `check_group_belongs` dans `commands/groups.rs`.
fn arbre(conn: &rusqlite::Connection) -> Result<Vec<Ra16Field>, String> {
    let activites = items_par_parent(conn, ACTIVITES)?;
    let metiers = items_par_parent(conn, METIERS)?;
    let domaines = items_par_parent(conn, DOMAINES)?;

    let mut stmt = conn.prepare(CHAMPS).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Ra16Field {
                id: row.get(0)?,
                name: row.get(1)?,
                position: row.get(2)?,
                domains: Vec::new(),
            })
        })
        .map_err(|e| e.to_string())?;

    let mut champs: Vec<Ra16Field> = Vec::new();
    for row in rows {
        let mut champ = row.map_err(|e| e.to_string())?;
        champ.domains = domaines
            .iter()
            .filter(|(parent, _)| *parent == champ.id)
            .map(|(_, domaine)| Ra16Domain {
                id: domaine.id.clone(),
                name: domaine.name.clone(),
                position: domaine.position,
                sheet_count: domaine.sheet_count,
                activities: enfants(&activites, &domaine.id),
                careers: enfants(&metiers, &domaine.id),
            })
            .collect();
        champs.push(champ);
    }
    Ok(champs)
}

fn enfants(source: &[(String, Ra16Item)], parent: &str) -> Vec<Ra16Item> {
    source
        .iter()
        .filter(|(p, _)| p == parent)
        .map(|(_, item)| Ra16Item {
            id: item.id.clone(),
            name: item.name.clone(),
            position: item.position,
            sheet_count: item.sheet_count,
        })
        .collect()
}

/// Nom assaini, ou le refus en français.
///
/// Même normalisation que l'arbre de compétences : Word et les tableurs
/// collent des espaces insécables, et sans elle deux entrées visuellement
/// identiques cohabitent.
fn nom_propre(kind: Ra16Kind, brut: &str) -> Result<String, String> {
    let nom = brut
        .replace(['\u{00a0}', '\u{202f}'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if nom.is_empty() {
        return Err(format!("Le nom {} ne peut pas être vide.", kind.article()));
    }
    if nom.chars().count() > MAX_NAME_LEN {
        return Err(format!(
            "Le nom {} ne peut pas dépasser {MAX_NAME_LEN} caractères.",
            kind.article()
        ));
    }
    Ok(nom)
}

/// Crée une ou plusieurs entrées sous un parent, en une transaction.
///
/// **Un collage, pas une saisie** : l'écran Référentiel accepte depuis toujours
/// une liste collée dans son champ d'ajout, et les trente-quatre activités du
/// champ Habitat viennent d'un tableau. Les refuser une par une aurait obligé
/// l'enseignant à trente-quatre allers-retours.
///
/// Les doublons sont **sautés et rendus**, pas refusés : un collage qui
/// contient trois lignes déjà présentes doit créer les autres, et dire
/// lesquelles il a laissées. C'est le contrat de `BulkResult`, celui de
/// `create_nodes_bulk`.
#[tauri::command]
pub fn create_activity_nodes_bulk(
    state: tauri::State<'_, AppState>,
    kind: Ra16Kind,
    parent_id: String,
    names: Vec<String>,
) -> Result<BulkResult, String> {
    let mut conn = state.conn()?;
    creer(&mut conn, kind, &parent_id, &names)
}

fn creer(
    conn: &mut rusqlite::Connection,
    kind: Ra16Kind,
    parent_id: &str,
    names: &[String],
) -> Result<BulkResult, String> {
    let q = kind.requetes();

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let parent_existe: i64 = tx
        .query_row(q.parent_existe, params![parent_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if parent_existe == 0 {
        return Err(format!(
            "{} n'existe plus : rechargez le référentiel.",
            kind.demonstratif_du_parent()
        ));
    }

    let mut vus: HashSet<String> = HashSet::new();
    {
        let mut stmt = tx.prepare(q.fratrie).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![parent_id], |row| row.get::<_, String>(1))
            .map_err(|e| e.to_string())?;
        for row in rows {
            vus.insert(dedup_key(&row.map_err(|e| e.to_string())?));
        }
    }

    let mut position: i32 = tx
        .query_row(q.position_suivante, params![parent_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let mut created: Vec<NodeRef> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    {
        let mut stmt = tx.prepare(q.inserer).map_err(|e| e.to_string())?;
        for brut in names {
            // Une ligne vide dans un collage n'est pas une erreur de saisie,
            // c'est un saut de ligne de trop : on la passe sans rien dire.
            if brut.trim().is_empty() {
                continue;
            }
            let nom = nom_propre(kind, brut)?;
            if !vus.insert(dedup_key(&nom)) {
                skipped.push(nom);
                continue;
            }
            let id = Uuid::new_v4().to_string();
            stmt.execute(params![id, parent_id, nom, position])
                .map_err(|e| e.to_string())?;
            position += 1;
            created.push(NodeRef { id, name: nom });
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(BulkResult { created, skipped })
}

/// Renomme une entrée.
///
/// **Le renommage est le geste sûr**, et c'est pour cela qu'il refuse le
/// doublon au lieu de le laisser passer : une fiche contrat garde le libellé
/// **figé** du jour où elle a été remplie, donc renommer ne réécrit aucun
/// document déjà imprimé — mais deux entrées de même nom dans un menu
/// déroulant ne se distinguent plus, et l'enseignant choisirait au hasard.
#[tauri::command]
pub fn rename_activity_node(
    state: tauri::State<'_, AppState>,
    kind: Ra16Kind,
    id: String,
    name: String,
) -> Result<(), String> {
    let mut conn = state.conn()?;
    renommer(&mut conn, kind, &id, &name)
}

fn renommer(
    conn: &mut rusqlite::Connection,
    kind: Ra16Kind,
    id: &str,
    name: &str,
) -> Result<(), String> {
    let q = kind.requetes();
    let nom = nom_propre(kind, name)?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let parent: Option<String> = tx
        .query_row(q.parent_de, params![id], |row| row.get(0))
        .ok();
    let Some(parent) = parent else {
        return Err(format!(
            "{} n'existe plus : rechargez le référentiel.",
            kind.demonstratif()
        ));
    };

    {
        let mut stmt = tx.prepare(q.fratrie).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![parent], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        let cible = dedup_key(&nom);
        for row in rows {
            let (existant_id, existant) = row.map_err(|e| e.to_string())?;
            // Se renommer soi-même n'est pas un doublon : corriger la casse ou
            // un espace doublé est précisément ce qu'on vient faire. L'exemption
            // porte sur l'IDENTIFIANT et non sur le nom — exempter par le nom
            // aurait laissé passer le renommage vers le nom exact d'une
            // voisine, c'est-à-dire le doublon même que ce contrôle refuse.
            if dedup_key(&existant) == cible && existant_id != id {
                return Err(format!("« {existant} » existe déjà à ce niveau."));
            }
        }
    }

    tx.execute(q.renommer, params![nom, id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Supprime une entrée.
///
/// **Elle ne refuse pas**, et la raison est dans l'en-tête du module : les
/// fiches contrat sont en `ON DELETE SET NULL` avec leur libellé figé à côté,
/// donc rien de ce qui a été imprimé ne change. Un domaine emporte en revanche
/// ses activités et ses métiers (`CASCADE`), et c'est à l'écran de l'annoncer —
/// il a les comptes par `get_activity_referential_tree`.
#[tauri::command]
pub fn delete_activity_node(
    state: tauri::State<'_, AppState>,
    kind: Ra16Kind,
    id: String,
) -> Result<(), String> {
    let conn = state.conn()?;
    supprimer(&conn, kind, &id)
}

fn supprimer(conn: &rusqlite::Connection, kind: Ra16Kind, id: &str) -> Result<(), String> {
    let affected = conn
        .execute(kind.requetes().supprimer, params![id])
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err(format!(
            "{} n'existe plus : rechargez le référentiel.",
            kind.demonstratif()
        ));
    }
    Ok(())
}

/// Réécrit **toutes** les positions d'un niveau, de 0 à n-1.
///
/// Même contrat que `reorder_nodes` : pas de position fractionnaire, pas de
/// trou, et le `WHERE` cite le parent — un identifiant d'un autre domaine
/// n'écrit donc rien, et le compte final le dit.
#[tauri::command]
pub fn reorder_activity_nodes(
    state: tauri::State<'_, AppState>,
    kind: Ra16Kind,
    parent_id: String,
    ordered_ids: Vec<String>,
) -> Result<(), String> {
    let mut conn = state.conn()?;
    reordonner(&mut conn, kind, &parent_id, &ordered_ids)
}

fn reordonner(
    conn: &mut rusqlite::Connection,
    kind: Ra16Kind,
    parent_id: &str,
    ordered_ids: &[String],
) -> Result<(), String> {
    let q = kind.requetes();

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut ecrits = 0usize;
    {
        let mut stmt = tx.prepare(q.repositionner).map_err(|e| e.to_string())?;
        for (position, id) in ordered_ids.iter().enumerate() {
            ecrits += stmt
                .execute(params![position as i32, id, parent_id])
                .map_err(|e| e.to_string())?;
        }
    }
    if ecrits != ordered_ids.len() {
        return Err(
            "La liste à réordonner ne correspond plus au référentiel : rechargez l'écran."
                .to_string(),
        );
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn migrated_db(nom: &str) -> Connection {
        let dir = std::env::temp_dir().join(format!("sgpa-ra16-{nom}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = Connection::open(dir.join("sgpa.db")).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::db::migrations::run(&mut conn, &dir).unwrap();
        conn
    }

    /// Le nom est à l'enseignant, mais il doit pouvoir tenir dans un menu
    /// déroulant et dans une cellule de tableau imprimée.
    ///
    /// La normalisation des espaces n'est pas de la coquetterie : les libellés
    /// du référentiel arrivent par copier-coller depuis un PDF, qui sème des
    /// espaces insécables et des sauts de ligne au milieu des phrases. Sans
    /// elle, « Pose de cloisons » collé deux fois depuis deux endroits du
    /// document donnerait deux entrées que l'œil ne distingue pas.
    #[test]
    fn un_nom_est_rogne_normalise_non_vide_et_borne() {
        assert_eq!(
            nom_propre(Ra16Kind::Activity, "  Pose\u{00a0}de   cloisons \n").unwrap(),
            "Pose de cloisons"
        );
        assert!(nom_propre(Ra16Kind::Domain, "   ").is_err());
        assert!(nom_propre(Ra16Kind::Career, &"x".repeat(MAX_NAME_LEN)).is_ok());
        assert!(nom_propre(Ra16Kind::Career, &"x".repeat(MAX_NAME_LEN + 1)).is_err());
        // Compté en CARACTÈRES et non en octets : « é » en fait deux, et une
        // borne en octets aurait refusé un libellé plus court que la limite —
        // or « Équipements techniques » commence par un accent.
        assert!(nom_propre(Ra16Kind::Career, &"é".repeat(MAX_NAME_LEN)).is_ok());

        // Le refus nomme le niveau, et l'article s'accorde : trois genres,
        // trois phrases. Une phrase fausse grammaticalement se lit comme un
        // défaut de l'application.
        let err = nom_propre(Ra16Kind::Activity, "").unwrap_err();
        assert!(err.contains("de l'activité de référence"), "{err}");
    }

    /// Le geste normal de l'écran : coller une liste.
    ///
    /// Les trente-quatre activités du champ Habitat viennent d'un tableau, donc
    /// la porte d'entrée est un collage et non trente-quatre saisies. Ce test
    /// tient les trois comportements qui font qu'un collage ne se retourne pas
    /// contre l'enseignant : les lignes vides sont **passées sans rien dire**
    /// (un saut de ligne de trop n'est pas une erreur de saisie), les doublons
    /// sont **sautés et rendus** plutôt que de faire échouer le lot, et les
    /// positions se suivent — c'est l'ordre du menu, et c'est le seul ordre
    /// qu'il y ait.
    #[test]
    fn un_collage_passe_les_lignes_vides_et_rend_les_doublons() {
        let mut conn = migrated_db("collage");

        let res = creer(
            &mut conn,
            Ra16Kind::Career,
            "seed-ad-hab-construction",
            &[
                "Couvreur".to_string(),
                "   ".to_string(),
                // Déjà semé par le palier 024, à la casse et aux espaces près.
                "  maçon  ".to_string(),
                // Doublon à l'intérieur du collage lui-même.
                "Couvreur".to_string(),
                "Cordiste".to_string(),
            ],
        )
        .unwrap();

        assert_eq!(
            res.created
                .iter()
                .map(|n| n.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Couvreur", "Cordiste"]
        );
        assert_eq!(res.skipped, vec!["maçon", "Couvreur"]);

        // Les nouveaux se rangent À LA SUITE du semis, et non devant : l'ordre
        // du menu est celui que l'enseignant a sous les yeux, et insérer en
        // tête aurait fait bouger les métiers déjà là.
        let positions: Vec<(String, i32)> = {
            let mut stmt = conn
                .prepare(
                    "SELECT name, position FROM careers \
                     WHERE activity_domain_id = ?1 ORDER BY position",
                )
                .unwrap();
            let rows = stmt
                .query_map(params!["seed-ad-hab-construction"], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })
                .unwrap();
            rows.map(|r| r.unwrap()).collect()
        };
        assert_eq!(positions.last().unwrap().0, "Cordiste");
        for (rang, (_, position)) in positions.iter().enumerate() {
            assert_eq!(rang as i32, *position, "les positions se suivent sans trou");
        }

        // Un parent inconnu est refusé EN FRANÇAIS. La clé étrangère le dirait
        // aussi, mais en anglais et au premier `INSERT` seulement.
        let err = creer(
            &mut conn,
            Ra16Kind::Activity,
            "inconnu",
            &["Peu importe".to_string()],
        )
        .unwrap_err();
        assert!(err.contains("domaine d'activité"), "{err}");
        assert!(err.contains("rechargez"), "{err}");
    }

    /// Renommer est le geste sûr — une fiche contrat garde le libellé **figé**
    /// du jour où elle a été remplie, donc rien d'imprimé ne change. Mais deux
    /// entrées de même nom dans un menu ne se distinguent plus, et l'enseignant
    /// choisirait au hasard.
    ///
    /// Le cas qui compte est le second : corriger la casse ou un espace doublé
    /// de **sa propre** entrée ne doit pas être pris pour un doublon.
    #[test]
    fn un_renommage_refuse_le_doublon_mais_corrige_sa_propre_casse() {
        let mut conn = migrated_db("renommage");

        let id: String = conn
            .query_row(
                "SELECT id FROM careers WHERE activity_domain_id = ?1 ORDER BY position LIMIT 1",
                params!["seed-ad-hab-construction"],
                |r| r.get(0),
            )
            .unwrap();
        let voisin: String = conn
            .query_row(
                "SELECT name FROM careers WHERE activity_domain_id = ?1 AND id <> ?2 LIMIT 1",
                params!["seed-ad-hab-construction", id],
                |r| r.get(0),
            )
            .unwrap();

        let err = renommer(&mut conn, Ra16Kind::Career, &id, &voisin).unwrap_err();
        assert!(err.contains("existe déjà"), "{err}");

        assert!(renommer(&mut conn, Ra16Kind::Career, &id, "Cordiste").is_ok());
        assert!(renommer(&mut conn, Ra16Kind::Career, &id, "cordiste  ").is_ok());
        let nom: String = conn
            .query_row("SELECT name FROM careers WHERE id = ?1", params![id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(nom, "cordiste", "la casse de sa propre entrée se corrige");

        let err = renommer(&mut conn, Ra16Kind::Career, "inconnu", "Peu importe").unwrap_err();
        assert!(err.contains("Ce métier"), "{err}");
    }

    /// Ce que l'écran lit, et pourquoi il le lit comme ça.
    ///
    /// Deux choses tenues ici. **Les cinq champs sortent, même les quatre sans
    /// domaine** : un champ vide n'est pas une anomalie à masquer, c'est le cas
    /// normal de quatre sur cinq, et c'est précisément là que l'enseignant
    /// posera son premier domaine — les masquer rendrait l'écran incapable de
    /// créer ce qu'il ne montre pas. **Et `sheet_count` dit avant le geste ce
    /// que la suppression coûtera** : une fiche contrat perdra sa clé et
    /// gardera son libellé, ce qui n'est pas une perte de donnée mais doit être
    /// annoncé. Présenter un bouton sans le dire vaut moins que le dire.
    #[test]
    fn l_arbre_rend_les_champs_sans_domaine_et_compte_les_fiches() {
        let conn = migrated_db("arbre");
        // Une instruction par littéral : `sql_smoke` extrait du source toutes
        // les chaînes qui ressemblent à du SQL — tests compris — et les fait
        // préparer par SQLite, qui refuse un lot de plusieurs instructions.
        for instruction in [
            "INSERT INTO sessions (id, name, level_code, year_start)
                  VALUES ('s1', '3ème A', '3eme', 2026)",
            "INSERT INTO evaluations (id, session_id, title, date, trimester)
                  VALUES ('ev1', 's1', 'Séquence 1', '2026-10-05', 1)",
            "INSERT INTO contract_sheets (id, evaluation_id, activity_domain_id,
                                          activity_domain_label)
                  VALUES ('f1', 'ev1', 'seed-ad-hab-construction', 'Construction')",
        ] {
            conn.execute(instruction, []).unwrap();
        }

        let champs = arbre(&conn).unwrap();
        assert_eq!(champs.len(), 5, "les cinq champs semés au palier 009");
        let habitat = champs.iter().find(|c| c.id == "seed-pf-habitat").unwrap();
        assert_eq!(habitat.domains.len(), 3);
        assert!(
            champs
                .iter()
                .any(|c| c.id != "seed-pf-habitat" && c.domains.is_empty()),
            "un champ sans référentiel sort quand même, vide"
        );

        let construction = &habitat.domains[0];
        assert_eq!(construction.name, "Construction");
        assert_eq!(construction.sheet_count, 1, "la fiche qui le cite");
        assert_eq!(construction.activities.len(), 12);
        assert_eq!(
            habitat.domains[1].sheet_count, 0,
            "et seulement celui qui est cité"
        );

        // Les activités et les métiers sont deux listes SŒURS : une jointure
        // unique les aurait multipliées l'une par l'autre, et douze activités
        // par huit métiers donneraient quatre-vingt-seize lignes à dédoublonner
        // pour en retrouver vingt.
        assert_eq!(
            habitat.domains.iter().map(|d| d.activities.len()).sum::<usize>(),
            34
        );
        assert_eq!(
            habitat.domains.iter().map(|d| d.careers.len()).sum::<usize>(),
            21
        );
    }

    /// Réordonner écrit TOUTES les positions, et un identifiant étranger annule
    /// le geste entier.
    ///
    /// Le `WHERE` cite le parent, donc une ligne d'un autre domaine n'est pas
    /// déplacée — elle n'écrit rien, le compte final le voit, et la transaction
    /// ne commet pas. Sans ce compte, un glisser-déposer parti d'un écran
    /// périmé aurait laissé la moitié des positions réécrites et l'autre non,
    /// c'est-à-dire un ordre que l'enseignant n'a demandé nulle part.
    #[test]
    fn reordonner_refuse_une_liste_qui_ne_correspond_plus() {
        let mut conn = migrated_db("ordre");

        let ids: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT id FROM careers WHERE activity_domain_id = ?1 ORDER BY position")
                .unwrap();
            let rows = stmt
                .query_map(params!["seed-ad-hab-construction"], |r| r.get(0))
                .unwrap();
            rows.map(|r| r.unwrap()).collect()
        };
        let premier = ids[0].clone();
        let mut inverse = ids.clone();
        inverse.reverse();

        reordonner(
            &mut conn,
            Ra16Kind::Career,
            "seed-ad-hab-construction",
            &inverse,
        )
        .unwrap();
        let position: i32 = conn
            .query_row(
                "SELECT position FROM careers WHERE id = ?1",
                params![premier],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(position as usize, ids.len() - 1);

        // Un métier d'un AUTRE domaine glissé dans la liste : rien ne doit
        // bouger, pas même les identifiants corrects qui le précèdent.
        let etranger: String = conn
            .query_row(
                "SELECT id FROM careers WHERE activity_domain_id = ?1 LIMIT 1",
                params!["seed-ad-hab-equipements"],
                |r| r.get(0),
            )
            .unwrap();
        let mut melange = ids.clone();
        melange[0] = etranger;
        let err = reordonner(
            &mut conn,
            Ra16Kind::Career,
            "seed-ad-hab-construction",
            &melange,
        )
        .unwrap_err();
        assert!(err.contains("rechargez"), "{err}");

        let position: i32 = conn
            .query_row(
                "SELECT position FROM careers WHERE id = ?1",
                params![premier],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            position as usize,
            ids.len() - 1,
            "l'ordre d'avant est intact : la transaction n'a pas commis"
        );
    }
}
