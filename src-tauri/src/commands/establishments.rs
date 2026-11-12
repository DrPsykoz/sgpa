//! Les établissements, le rattachement d'une classe, et les compétences qu'un
//! établissement n'emploie pas.
//!
//! Le modèle et ses choix sont documentés dans `db/sql/025_etablissements.sql`.
//! Trois d'entre eux pèsent sur ce module :
//!
//! * **Le rattachement est sur la CLASSE.** La demande de l'auteur disait
//!   « lier une année scolaire à un établissement » puis « les classes seront
//!   donc liées à cet établissement » : il n'y a pas de contradiction à lever,
//!   parce qu'il n'y a pas d'entité « année scolaire » dans ce modèle — une
//!   session EST une classe pour une année. La colonne sur la classe est de
//!   plus la seule des deux formes qui sache exprimer l'autre : un enseignant
//!   partagé entre deux établissements la même année est le cas même où le
//!   réglage sert.
//!
//! * **`establishment_id IS NULL` veut dire « comme avant ».** C'est l'état de
//!   toute base migrée, et rien n'est deviné depuis `app_settings.school_name`.
//!   Conséquence directe ici : `get_disabled_competencies_for_session` rend une
//!   liste **vide** pour une classe non rattachée, et la saisie se comporte
//!   exactement comme la veille.
//!
//! * **La désactivation est un filtre de SAISIE, jamais un masque sur des
//!   faits.** Ce module écrit et lit `establishment_disabled_competencies`, et
//!   c'est tout : il ne touche ni à `grades`, ni à `evaluation_competencies`,
//!   ni à `progression_etape_competences`. Une compétence désactivée qui porte
//!   déjà une note continue de s'afficher avec sa note — une note qui existe
//!   encore mais que plus aucun écran ne montre est la panne qu'on ne voit pas.
//!   Ne jamais greffer ce filtre sur `get_evaluation_competencies` ni sur
//!   `COMPETENCES_DES_ETAPES` : ces deux-là lisent des faits.
//!
//! **La suppression ne refuse pas**, contrairement à `delete_student_group`, et
//! la raison est le partage habituel entre le fait et le réglage : un groupe
//! cité par une séance tenue est un fait imprimé, un établissement cité par une
//! classe n'est qu'un réglage. `sessions.establishment_id` est en
//! `ON DELETE SET NULL`, donc la classe revient à l'état d'avant le palier —
//! lisible, corrigible, et aucun chiffre ne bouge. C'est pourquoi le listage
//! rend `session_count` : l'écran doit pouvoir annoncer le prix de la
//! suppression, puisque rien ne l'arrêtera. Même geste qu'`activity_count` pour
//! les domaines de progression et que `sheet_count` pour le référentiel RA16.

use std::collections::HashSet;

use rusqlite::params;
use serde::Serialize;
use uuid::Uuid;

use crate::commands::referential::{dedup_key, BulkResult, NodeRef};
use crate::db::collect;
use crate::state::AppState;

/// Un nom d'établissement officiel est long — « Collège Jean Moulin » tient en
/// vingt signes, « Section d'enseignement général et professionnel adapté du
/// collège… » beaucoup moins. 120 et non 40 comme `student_groups.name`, qui
/// doit, lui, tenir sur la pastille d'une carte de calendrier.
///
/// La borne vit ici et dans la saisie, **jamais dans un CHECK** : c'est une
/// limite d'affichage et non une règle de données, et un CHECK refuserait en
/// anglais ce que cette commande refuse en français. Même arbitrage que
/// `clean_entry_category` au palier 020 et que `nom_propre` au palier 024.
const MAX_NAME_LEN: usize = 120;

/// Un établissement, avec ce qu'une suppression coûterait et ce qu'il règle.
#[derive(Debug, Clone, Serialize)]
pub struct Establishment {
    pub id: String,
    pub name: String,
    pub position: i32,
    /// Combien de classes y sont rattachées.
    ///
    /// Rendu par le listage parce que la suppression **ne refuse jamais** : les
    /// classes reviennent à « aucun établissement » par le `SET NULL` du
    /// palier. L'écran doit donc annoncer le prix lui-même — personne d'autre
    /// ne l'arrêtera, et une suppression silencieuse de trois rattachements se
    /// découvrirait au premier bilan.
    pub session_count: i64,
    /// Combien de compétences cet établissement n'emploie pas.
    pub disabled_count: i64,
}

/// Combien d'établissements désactivent une compétence donnée.
///
/// Le revers du compte précédent, et c'est lui que sert `ix_edc_competency` :
/// l'écran du référentiel peut dire « désactivée dans 2 établissements » sur
/// une compétence qui a disparu de ses menus, au lieu de laisser l'enseignant
/// chercher pourquoi elle ne lui est plus proposée. Une compétence invisible
/// ici reste visible ailleurs, et c'est exactement ce qu'il faut pouvoir lire.
#[derive(Debug, Clone, Serialize)]
pub struct DisabledCompetencyCount {
    pub competency_id: String,
    pub establishment_count: i64,
}

// ---------------------------------------------------------------------------
// Requêtes littérales — jamais assemblées par `format!`, pour que `sql_smoke`
// les prépare contre le schéma migré. Une instruction par littéral.
// ---------------------------------------------------------------------------

const ETABLISSEMENTS: &str = "SELECT e.id, e.name, e.position,
       (SELECT COUNT(*) FROM sessions s
         WHERE s.establishment_id = e.id),
       (SELECT COUNT(*) FROM establishment_disabled_competencies d
         WHERE d.establishment_id = e.id)
  FROM establishments e
 ORDER BY e.position, e.name COLLATE NOCASE";

const NOMS_EXISTANTS: &str = "SELECT id, name FROM establishments";

const PROCHAINE_POSITION: &str = "SELECT COALESCE(MAX(position), 0) + 1 FROM establishments";

const INSERER: &str = "INSERT INTO establishments (id, name, position) VALUES (?1, ?2, ?3)";

const RENOMMER: &str = "UPDATE establishments SET name = ?2 WHERE id = ?1";

const SUPPRIMER: &str = "DELETE FROM establishments WHERE id = ?1";

const REPOSITIONNER: &str = "UPDATE establishments SET position = ?1 WHERE id = ?2";

const EXISTE: &str = "SELECT COUNT(*) FROM establishments WHERE id = ?1";

/// Les compétences désactivées, **dans l'ordre du référentiel**.
///
/// La table de rattachement n'a pas de colonne `position`, exactement comme
/// `progression_etape_competences` au palier 021 : l'ordre d'affichage est
/// celui que Réglages règle, donc une compétence déplacée là-bas se déplace
/// d'un coup dans tous les établissements. Une position recopiée ici aurait été
/// écrite à chaque enregistrement et lue par personne.
const DESACTIVEES: &str = "SELECT c.id FROM establishment_disabled_competencies d
       JOIN competencies c ON c.id = d.competency_id
       JOIN fields  f ON f.id = c.field_id
       JOIN domains dm ON dm.id = f.domain_id
       JOIN cycles  cy ON cy.id = dm.cycle_id
 WHERE d.establishment_id = ?1
 ORDER BY cy.position, dm.position, f.position, c.position";

/// Les compétences désactivées **pour une classe**, par son établissement.
///
/// Une seule requête et non deux appels enchaînés : une classe sans
/// établissement rend naturellement l'ensemble vide, sans que l'appelant ait à
/// distinguer les deux cas. C'est la lecture que fait tout écran de saisie.
const DESACTIVEES_DE_LA_CLASSE: &str = "SELECT c.id FROM sessions s
       JOIN establishment_disabled_competencies d
         ON d.establishment_id = s.establishment_id
       JOIN competencies c ON c.id = d.competency_id
       JOIN fields  f ON f.id = c.field_id
       JOIN domains dm ON dm.id = f.domain_id
       JOIN cycles  cy ON cy.id = dm.cycle_id
 WHERE s.id = ?1
 ORDER BY cy.position, dm.position, f.position, c.position";

const COMPTES_PAR_COMPETENCE: &str = "SELECT competency_id, COUNT(*)
  FROM establishment_disabled_competencies
 GROUP BY competency_id";

const VIDER_DESACTIVATIONS: &str =
    "DELETE FROM establishment_disabled_competencies WHERE establishment_id = ?1";

const DESACTIVER: &str =
    "INSERT INTO establishment_disabled_competencies (establishment_id, competency_id)
          VALUES (?1, ?2)";

const COMPETENCE_EXISTE: &str = "SELECT COUNT(*) FROM competencies WHERE id = ?1";

// ---------------------------------------------------------------------------
// Le vocabulaire
// ---------------------------------------------------------------------------

/// Un nom d'établissement tel qu'il sera rangé : rogné, blancs normalisés, non
/// vide, borné.
///
/// La normalisation des blancs n'est pas de la coquetterie : un nom
/// d'établissement se colle depuis un courriel ou un en-tête de document, qui
/// sèment des espaces insécables. Sans elle, « Collège Jean Moulin » collé de
/// deux endroits différents donnerait deux établissements que l'œil ne
/// distingue pas, et l'enseignant désactiverait des compétences dans l'un en
/// croyant les désactiver dans l'autre.
fn nom_propre(name: &str) -> Result<String, String> {
    let nom = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if nom.is_empty() {
        return Err("Le nom de l'établissement est obligatoire.".to_string());
    }
    if nom.chars().count() > MAX_NAME_LEN {
        return Err(format!(
            "Le nom de l'établissement ne peut pas dépasser {MAX_NAME_LEN} caractères."
        ));
    }
    Ok(nom)
}

/// Les établissements, avec ce que chacun règle et ce qu'il coûterait.
#[tauri::command]
pub fn get_establishments(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Establishment>, String> {
    let conn = state.conn()?;
    collect(&conn, ETABLISSEMENTS, [], |row| {
        Ok(Establishment {
            id: row.get(0)?,
            name: row.get(1)?,
            position: row.get(2)?,
            session_count: row.get(3)?,
            disabled_count: row.get(4)?,
        })
    })
}

/// Crée un ou plusieurs établissements, en une transaction.
///
/// **Un collage, pas une saisie**, pour la même raison qu'au palier 024 : la
/// liste des établissements d'un secteur se colle depuis un courriel. Les
/// doublons sont **sautés et rendus**, pas refusés — un collage qui contient
/// deux lignes déjà présentes doit créer les autres et dire lesquelles il a
/// laissées. C'est le contrat de `BulkResult`, et c'est ce qui permet à l'écran
/// de Réglages de réemployer `ChampDAjout` sans une ligne de code en plus.
#[tauri::command]
pub fn create_establishments_bulk(
    state: tauri::State<'_, AppState>,
    names: Vec<String>,
) -> Result<BulkResult, String> {
    let mut conn = state.conn()?;
    creer(&mut conn, &names)
}

fn creer(conn: &mut rusqlite::Connection, names: &[String]) -> Result<BulkResult, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut vus: HashSet<String> = HashSet::new();
    {
        let mut stmt = tx.prepare(NOMS_EXISTANTS).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| e.to_string())?;
        for row in rows {
            vus.insert(dedup_key(&row.map_err(|e| e.to_string())?));
        }
    }

    let mut position: i32 = tx
        .query_row(PROCHAINE_POSITION, [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let mut created: Vec<NodeRef> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    {
        let mut stmt = tx.prepare(INSERER).map_err(|e| e.to_string())?;
        for brut in names {
            // Une ligne vide dans un collage n'est pas une erreur de saisie,
            // c'est un saut de ligne de trop : on la passe sans rien dire.
            if brut.trim().is_empty() {
                continue;
            }
            let nom = nom_propre(brut)?;
            if !vus.insert(dedup_key(&nom)) {
                skipped.push(nom);
                continue;
            }
            let id = Uuid::new_v4().to_string();
            stmt.execute(params![id, nom, position])
                .map_err(|e| e.to_string())?;
            position += 1;
            created.push(NodeRef { id, name: nom });
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(BulkResult { created, skipped })
}

/// Renomme un établissement.
///
/// **Le renommage est le geste sûr** : il ne détache aucune classe et ne touche
/// à aucune désactivation. Il refuse pourtant le doublon, pour la raison même
/// qui justifie l'index unique — deux établissements de même nom dans une liste
/// ne se distinguent plus, et l'enseignant désactiverait des compétences dans
/// l'un en croyant les désactiver dans l'autre.
#[tauri::command]
pub fn rename_establishment(
    state: tauri::State<'_, AppState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let mut conn = state.conn()?;
    renommer(&mut conn, &id, &name)
}

fn renommer(conn: &mut rusqlite::Connection, id: &str, name: &str) -> Result<(), String> {
    let nom = nom_propre(name)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    {
        let mut stmt = tx.prepare(NOMS_EXISTANTS).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        let cible = dedup_key(&nom);
        for row in rows {
            let (existant_id, existant) = row.map_err(|e| e.to_string())?;
            // Se renommer soi-même n'est pas un doublon : corriger la casse ou
            // un espace doublé est précisément ce qu'on vient faire. L'exemption
            // porte sur l'IDENTIFIANT et non sur le nom — exempter par le nom
            // aurait laissé passer le renommage vers le nom exact d'un voisin,
            // c'est-à-dire le doublon même que ce contrôle refuse.
            if dedup_key(&existant) == cible && existant_id != id {
                return Err(format!("L'établissement « {existant} » existe déjà."));
            }
        }
    }

    let affected = tx
        .execute(RENOMMER, params![id, nom])
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("Établissement introuvable.".to_string());
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Supprime un établissement.
///
/// **Elle ne refuse pas**, et ce n'est pas un oubli : `delete_student_group`
/// refuse, celle-ci non, parce que les deux ne gardent pas la même sorte de
/// chose. Un groupe cité par une séance tenue est un **fait** dont un bilan
/// déjà imprimé dépend ; un établissement cité par une classe n'est qu'un
/// **réglage**, et le perdre rend la classe à l'état d'avant le palier — aucun
/// chiffre ne bouge, aucun document ne change, et un établissement supprimé par
/// erreur se recrée et se repose. L'écran annonce le prix par `session_count`,
/// puisque rien ne l'arrêtera.
#[tauri::command]
pub fn delete_establishment(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.conn()?;
    let affected = conn
        .execute(SUPPRIMER, params![id])
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("Établissement introuvable.".to_string());
    }
    Ok(())
}

/// Réécrit **toutes** les positions, de 0 à n-1.
///
/// Même contrat que `reorder_nodes` et `reorder_activity_nodes` : pas de
/// position fractionnaire, pas de trou, et une liste qui ne correspond plus à
/// la base est refusée au lieu d'être appliquée à moitié.
#[tauri::command]
pub fn reorder_establishments(
    state: tauri::State<'_, AppState>,
    ordered_ids: Vec<String>,
) -> Result<(), String> {
    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut ecrits = 0usize;
    {
        let mut stmt = tx.prepare(REPOSITIONNER).map_err(|e| e.to_string())?;
        for (position, id) in ordered_ids.iter().enumerate() {
            ecrits += stmt
                .execute(params![position as i32, id])
                .map_err(|e| e.to_string())?;
        }
    }
    if ecrits != ordered_ids.len() {
        return Err(
            "La liste à réordonner ne correspond plus aux établissements : rechargez l'écran."
                .to_string(),
        );
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Les compétences que l'établissement n'emploie pas
// ---------------------------------------------------------------------------

/// Les compétences désactivées dans un établissement, dans l'ordre du
/// référentiel.
#[tauri::command]
pub fn get_establishment_disabled_competencies(
    state: tauri::State<'_, AppState>,
    establishment_id: String,
) -> Result<Vec<String>, String> {
    let conn = state.conn()?;
    collect(&conn, DESACTIVEES, params![establishment_id], |row| {
        row.get(0)
    })
}

/// Remplace la liste des compétences désactivées, en une transaction.
///
/// **Une seule écriture pour tout le lot**, et pas une commande « désactiver
/// celle-ci » appelée en boucle : l'écran présente une arborescence entière à
/// cocher, et un enregistrement partiel laisserait un établissement dans un
/// état que l'enseignant n'a pas voulu. Une compétence inconnue annule donc
/// **tout** le geste, exactement comme au palier 021 pour les compétences d'une
/// étape de progression — refuser à moitié serait pire que refuser.
#[tauri::command]
pub fn set_establishment_disabled_competencies(
    state: tauri::State<'_, AppState>,
    establishment_id: String,
    competency_ids: Vec<String>,
) -> Result<(), String> {
    let mut conn = state.conn()?;
    desactiver(&mut conn, &establishment_id, &competency_ids)
}

fn desactiver(
    conn: &mut rusqlite::Connection,
    establishment_id: &str,
    competency_ids: &[String],
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let existe: i64 = tx
        .query_row(EXISTE, params![establishment_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if existe == 0 {
        return Err("Établissement introuvable : rechargez l'écran.".to_string());
    }

    tx.execute(VIDER_DESACTIVATIONS, params![establishment_id])
        .map_err(|e| e.to_string())?;

    let mut vues: HashSet<&str> = HashSet::new();
    {
        let mut verif = tx.prepare(COMPETENCE_EXISTE).map_err(|e| e.to_string())?;
        let mut stmt = tx.prepare(DESACTIVER).map_err(|e| e.to_string())?;
        for competency_id in competency_ids {
            // Deux fois la même compétence dans la liste n'est pas une erreur
            // de l'enseignant mais un écran qui a envoyé deux coches pour une :
            // on la passe, plutôt que de heurter la clé primaire.
            if !vues.insert(competency_id.as_str()) {
                continue;
            }
            let connue: i64 = verif
                .query_row(params![competency_id], |row| row.get(0))
                .map_err(|e| e.to_string())?;
            if connue == 0 {
                return Err(
                    "Une des compétences n'existe plus : rechargez le référentiel.".to_string(),
                );
            }
            stmt.execute(params![establishment_id, competency_id])
                .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Les compétences que la saisie ne doit plus proposer **dans cette classe**.
///
/// Rend une liste **vide** quand la classe n'est rattachée à aucun
/// établissement, et c'est le cas de toute base migrée : l'écran de saisie se
/// comporte alors exactement comme la veille, sans avoir à distinguer les deux
/// situations.
///
/// **Ce n'est pas un masque sur des faits.** L'appelant retire de ses MENUS ce
/// qui n'est pas encore choisi, et laisse voir, cochée et notée, toute
/// compétence déjà rattachée à une évaluation ou à une étape. Une note qui
/// existe encore mais que plus aucun écran n'affiche est la panne qu'on ne voit
/// pas ; c'est pourquoi `get_evaluation_competencies` et
/// `COMPETENCES_DES_ETAPES` ne consultent pas cette table.
#[tauri::command]
pub fn get_disabled_competencies_for_session(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Vec<String>, String> {
    let conn = state.conn()?;
    collect(
        &conn,
        DESACTIVEES_DE_LA_CLASSE,
        params![session_id],
        |row| row.get(0),
    )
}

/// Combien d'établissements désactivent chaque compétence.
///
/// Sert l'écran du référentiel : une compétence qui a disparu des menus doit
/// pouvoir dire pourquoi, sinon l'enseignant la croit perdue. Seules les
/// compétences désactivées au moins une fois figurent dans le résultat.
#[tauri::command]
pub fn get_disabled_competency_counts(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DisabledCompetencyCount>, String> {
    let conn = state.conn()?;
    collect(&conn, COMPTES_PAR_COMPETENCE, [], |row| {
        Ok(DisabledCompetencyCount {
            competency_id: row.get(0)?,
            establishment_count: row.get(1)?,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn migrated_db(nom: &str) -> Connection {
        let dir = std::env::temp_dir().join(format!("sgpa-etab-{nom}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = Connection::open(dir.join("sgpa.db")).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::db::migrations::run(&mut conn, &dir).unwrap();
        conn
    }

    /// Les deux premières compétences du référentiel, dans son ordre.
    fn deux_competences(conn: &Connection) -> (String, String) {
        let ids: Vec<String> = collect(
            conn,
            "SELECT c.id FROM competencies c
               JOIN fields  f  ON f.id = c.field_id
               JOIN domains dm ON dm.id = f.domain_id
               JOIN cycles  cy ON cy.id = dm.cycle_id
              ORDER BY cy.position, dm.position, f.position, c.position LIMIT 2",
            [],
            |row| row.get(0),
        )
        .unwrap();
        (ids[0].clone(), ids[1].clone())
    }

    /// Le nom est à l'enseignant, mais il doit pouvoir être désigné dans une
    /// liste : ni vide, ni plus long qu'une ligne d'écran.
    ///
    /// La normalisation des blancs n'est pas de la coquetterie : un nom
    /// d'établissement arrive par copier-coller depuis un courriel, qui sème
    /// des espaces insécables. Sans elle, le même collège collé de deux
    /// endroits donnerait deux établissements que l'œil ne distingue pas.
    #[test]
    fn un_nom_d_etablissement_est_rogne_normalise_non_vide_et_borne() {
        assert_eq!(
            nom_propre("  Collège\u{00a0}Jean   Moulin \n").unwrap(),
            "Collège Jean Moulin"
        );
        assert!(nom_propre("   ").is_err());
        assert!(nom_propre(&"x".repeat(MAX_NAME_LEN)).is_ok());
        assert!(nom_propre(&"x".repeat(MAX_NAME_LEN + 1)).is_err());
        // Compté en CARACTÈRES et non en octets : « è » en fait deux, et une
        // borne en octets aurait refusé un nom plus court que la limite — or
        // « Collège » commence presque toujours par là.
        assert!(nom_propre(&"è".repeat(MAX_NAME_LEN)).is_ok());
    }

    /// Le geste normal de l'écran : coller une liste. Les doublons sont sautés
    /// et rendus, jamais refusés — sinon un collage de cinq lignes dont une
    /// existe déjà ne créerait rien.
    #[test]
    fn un_collage_passe_les_lignes_vides_et_rend_les_doublons() {
        let mut conn = migrated_db("collage");
        let result = creer(
            &mut conn,
            &[
                "Collège Jean Moulin".to_string(),
                "   ".to_string(),
                "SEGPA Les Tilleuls".to_string(),
                "collège   jean moulin".to_string(),
            ],
        )
        .unwrap();

        assert_eq!(result.created.len(), 2, "deux noms distincts");
        assert_eq!(
            result.skipped,
            vec!["collège jean moulin".to_string()],
            "le doublon est rendu tel que l'enseignant l'a tapé, pas corrigé"
        );

        let noms: Vec<String> = collect(&conn, ETABLISSEMENTS, [], |row| row.get(1)).unwrap();
        assert_eq!(
            noms,
            vec![
                "Collège Jean Moulin".to_string(),
                "SEGPA Les Tilleuls".to_string()
            ],
            "l'ordre est celui de la saisie, par position, et non l'ordre alphabétique"
        );
    }

    /// Le renommage corrige sa propre casse mais refuse celle du voisin.
    ///
    /// L'exemption porte sur l'identifiant : exempter par le nom aurait laissé
    /// passer le renommage vers le nom exact d'un voisin, c'est-à-dire le
    /// doublon même que ce contrôle refuse — et l'enseignant désactiverait
    /// ensuite des compétences dans l'un en croyant les désactiver dans l'autre.
    #[test]
    fn un_renommage_refuse_le_doublon_mais_corrige_sa_propre_casse() {
        let mut conn = migrated_db("renommage");
        let cree = creer(
            &mut conn,
            &[
                "Collège Jean Moulin".to_string(),
                "SEGPA Les Tilleuls".to_string(),
            ],
        )
        .unwrap();
        let premier = cree.created[0].id.clone();

        let err = renommer(&mut conn, &premier, "segpa les tilleuls").unwrap_err();
        assert!(err.contains("existe déjà"), "{err}");

        renommer(&mut conn, &premier, "COLLÈGE JEAN MOULIN").unwrap();
        let nom: String = conn
            .query_row(
                "SELECT name FROM establishments WHERE id = ?1",
                params![premier],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(nom, "COLLÈGE JEAN MOULIN");

        assert!(renommer(&mut conn, "inconnu", "Ailleurs").is_err());
    }

    /// LE test du palier : désactiver une compétence ne touche **aucune** note.
    ///
    /// La désactivation est un filtre de saisie. Si elle retirait des notes, ou
    /// détachait la compétence d'une évaluation déjà composée, elle changerait
    /// des bilans déjà établis — et le ferait en silence, un trimestre après la
    /// saisie. Ce test est celui qui tient cette frontière.
    #[test]
    fn desactiver_une_competence_ne_touche_ni_note_ni_rattachement() {
        let mut conn = migrated_db("filtre");
        let (notee, autre) = deux_competences(&conn);
        let cree = creer(&mut conn, &["Collège Jean Moulin".to_string()]).unwrap();
        let etab = cree.created[0].id.clone();

        for instruction in [
            "INSERT INTO sessions (id, name, level_code, year_start)
                  VALUES ('s1', '4ème A', '4eme', 2026)",
            "INSERT INTO students (id, session_id, first_name, last_name, enrolled_on)
                  VALUES ('e1', 's1', 'Hugo', 'MARTIN', '2026-09-01')",
            "INSERT INTO evaluations (id, session_id, title, date, trimester)
                  VALUES ('ev1', 's1', 'Séquence 1', '2026-10-05', 1)",
            "UPDATE sessions SET establishment_id = (SELECT id FROM establishments LIMIT 1)
                  WHERE id = 's1'",
        ] {
            conn.execute(instruction, []).unwrap();
        }
        conn.execute(
            "INSERT INTO evaluation_competencies (evaluation_id, competency_id)
                  VALUES ('ev1', ?1)",
            params![notee],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO grades (evaluation_id, competency_id, student_id, mark)
                  VALUES ('ev1', ?1, 'e1', 14)",
            params![notee],
        )
        .unwrap();

        desactiver(&mut conn, &etab, &[notee.clone(), autre.clone()]).unwrap();

        let note: i64 = conn
            .query_row(
                "SELECT mark FROM grades WHERE evaluation_id = 'ev1' AND student_id = 'e1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(note, 14, "une désactivation ne touche jamais une note");
        let rattachees: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM evaluation_competencies WHERE evaluation_id = 'ev1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            rattachees, 1,
            "désactiver ne détache pas une compétence d'une évaluation déjà composée"
        );

        // La classe, elle, voit bien les deux désactivations — et dans l'ordre
        // du référentiel, pas dans celui des clics.
        let pour_la_classe: Vec<String> = collect(
            &conn,
            DESACTIVEES_DE_LA_CLASSE,
            params!["s1"],
            |row| row.get(0),
        )
        .unwrap();
        assert_eq!(pour_la_classe, vec![notee.clone(), autre.clone()]);
    }

    /// Une classe sans établissement se comporte **exactement comme avant le
    /// palier**, et c'est l'état de toute base migrée.
    ///
    /// Le filtre est donc inerte par défaut : aucun écran ne change tant que
    /// l'enseignant n'a rien posé. C'est la contrepartie de « rien n'est
    /// deviné depuis `school_name` ».
    #[test]
    fn une_classe_sans_etablissement_ne_filtre_rien() {
        let mut conn = migrated_db("sans-etab");
        let (une, _) = deux_competences(&conn);
        let cree = creer(&mut conn, &["Collège Jean Moulin".to_string()]).unwrap();
        let etab = cree.created[0].id.clone();
        desactiver(&mut conn, &etab, &[une]).unwrap();

        conn.execute(
            "INSERT INTO sessions (id, name, level_code, year_start)
                  VALUES ('s1', '4ème A', '4eme', 2026)",
            [],
        )
        .unwrap();

        let pour_la_classe: Vec<String> = collect(
            &conn,
            DESACTIVEES_DE_LA_CLASSE,
            params!["s1"],
            |row| row.get(0),
        )
        .unwrap();
        assert!(
            pour_la_classe.is_empty(),
            "une classe non rattachée ne voit aucune désactivation"
        );

        // Mais l'établissement, lui, la porte : le réglage existe, il n'est
        // simplement appliqué à personne.
        let siennes: Vec<String> =
            collect(&conn, DESACTIVEES, params![etab], |row| row.get(0)).unwrap();
        assert_eq!(siennes.len(), 1);
    }

    /// Une compétence inconnue annule **tout** l'enregistrement, et pas
    /// seulement sa propre ligne.
    ///
    /// L'écran envoie une arborescence entière de coches : un enregistrement
    /// partiel laisserait l'établissement dans un état que l'enseignant n'a pas
    /// voulu, et il le découvrirait à la première évaluation composée. Même
    /// règle qu'au palier 021.
    #[test]
    fn une_competence_inconnue_annule_tout_l_enregistrement() {
        let mut conn = migrated_db("inconnue");
        let (une, autre) = deux_competences(&conn);
        let cree = creer(&mut conn, &["Collège Jean Moulin".to_string()]).unwrap();
        let etab = cree.created[0].id.clone();

        desactiver(&mut conn, &etab, std::slice::from_ref(&une)).unwrap();

        let err = desactiver(
            &mut conn,
            &etab,
            &[autre.clone(), "fantôme".to_string()],
        )
        .unwrap_err();
        assert!(err.contains("n'existe plus"), "{err}");

        let siennes: Vec<String> =
            collect(&conn, DESACTIVEES, params![etab], |row| row.get(0)).unwrap();
        assert_eq!(
            siennes,
            vec![une],
            "l'état d'avant est intact : le vidage initial est dans la même transaction"
        );
        assert!(desactiver(&mut conn, "inconnu", &[autre]).is_err());
    }

    /// Le listage dit **avant** ce qu'une suppression coûterait, parce que rien
    /// ne l'arrêtera : la classe revient à « aucun établissement » (SET NULL)
    /// et les désactivations partent (CASCADE).
    #[test]
    fn la_suppression_ne_refuse_pas_et_rend_la_classe_a_l_etat_d_avant() {
        let mut conn = migrated_db("suppression");
        let (une, _) = deux_competences(&conn);
        let cree = creer(&mut conn, &["Collège Jean Moulin".to_string()]).unwrap();
        let etab = cree.created[0].id.clone();
        desactiver(&mut conn, &etab, &[une]).unwrap();
        conn.execute(
            "INSERT INTO sessions (id, name, level_code, year_start, establishment_id)
                  VALUES ('s1', '4ème A', '4eme', 2026, ?1)",
            params![etab],
        )
        .unwrap();

        let comptes: Vec<(i64, i64)> = collect(&conn, ETABLISSEMENTS, [], |row| {
            Ok((row.get(3)?, row.get(4)?))
        })
        .unwrap();
        assert_eq!(
            comptes,
            vec![(1, 1)],
            "une classe rattachée, une compétence désactivée — l'écran peut l'annoncer"
        );

        conn.execute(SUPPRIMER, params![etab]).unwrap();

        let classes: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions WHERE id = 's1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(classes, 1, "supprimer un établissement ne supprime JAMAIS une classe");
        let rattachees: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sessions WHERE establishment_id IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rattachees, 0, "la classe revient à l'état d'avant le palier");
        let desactivations: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM establishment_disabled_competencies",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(desactivations, 0, "aucune ligne orpheline derrière");
    }

    /// Le compte inverse : une compétence invisible dans une classe doit
    /// pouvoir dire qu'elle reste visible ailleurs.
    #[test]
    fn le_compte_inverse_dit_ou_une_competence_reste_employee() {
        let mut conn = migrated_db("compte-inverse");
        let (une, autre) = deux_competences(&conn);
        let cree = creer(
            &mut conn,
            &[
                "Collège Jean Moulin".to_string(),
                "SEGPA Les Tilleuls".to_string(),
            ],
        )
        .unwrap();
        desactiver(&mut conn, &cree.created[0].id, &[une.clone(), autre.clone()]).unwrap();
        desactiver(&mut conn, &cree.created[1].id, std::slice::from_ref(&une)).unwrap();

        let mut comptes: Vec<(String, i64)> =
            collect(&conn, COMPTES_PAR_COMPETENCE, [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        comptes.sort();
        let mut attendu = vec![(une, 2), (autre, 1)];
        attendu.sort();
        assert_eq!(comptes, attendu);
    }
}
