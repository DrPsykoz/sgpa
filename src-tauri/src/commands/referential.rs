use std::collections::{HashMap, HashSet};

use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::state::AppState;

// ---------------------------------------------------------------------------
// Types renvoyés au front
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct CompetencyNode {
    pub id: String,
    pub name: String,
    pub position: i32,
    pub archived: bool,
}

#[derive(Serialize)]
pub struct FieldNode {
    pub id: String,
    pub name: String,
    pub position: i32,
    pub competencies: Vec<CompetencyNode>,
}

#[derive(Serialize)]
pub struct DomainNode {
    pub id: String,
    pub name: String,
    pub position: i32,
    pub fields: Vec<FieldNode>,
}

#[derive(Serialize)]
pub struct CycleNode {
    pub id: String,
    pub name: String,
    pub position: i32,
    pub domains: Vec<DomainNode>,
}

#[derive(Serialize)]
pub struct NodeRef {
    pub id: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct BulkResult {
    pub created: Vec<NodeRef>,
    pub skipped: Vec<String>,
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Cycle,
    Domain,
    Field,
    Competency,
}

impl NodeKind {
    /// Nom de table. Il vient TOUJOURS d'ici, jamais d'une chaîne de l'appelant :
    /// un nom de table ne peut pas être passé en paramètre lié, donc c'est ce
    /// `match` qui tient lieu de protection contre l'injection SQL.
    fn table(self) -> &'static str {
        match self {
            NodeKind::Cycle => "cycles",
            NodeKind::Domain => "domains",
            NodeKind::Field => "fields",
            NodeKind::Competency => "competencies",
        }
    }

    fn parent_kind(self) -> Option<NodeKind> {
        match self {
            NodeKind::Cycle => None,
            NodeKind::Domain => Some(NodeKind::Cycle),
            NodeKind::Field => Some(NodeKind::Domain),
            NodeKind::Competency => Some(NodeKind::Field),
        }
    }

    /// Colonne portant l'identifiant du parent — même origine, même raison.
    fn parent_column(self) -> Option<&'static str> {
        match self {
            NodeKind::Cycle => None,
            NodeKind::Domain => Some("cycle_id"),
            NodeKind::Field => Some("domain_id"),
            NodeKind::Competency => Some("field_id"),
        }
    }

    fn label(self) -> &'static str {
        match self {
            NodeKind::Cycle => "cycle",
            NodeKind::Domain => "domaine",
            NodeKind::Field => "champ",
            NodeKind::Competency => "compétence",
        }
    }

    fn demonstrative(self) -> &'static str {
        match self {
            NodeKind::Cycle => "Ce cycle",
            NodeKind::Domain => "Ce domaine",
            NodeKind::Field => "Ce champ",
            NodeKind::Competency => "Cette compétence",
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers internes
// ---------------------------------------------------------------------------

/// Le libellé qui désigne un domaine du socle sans ambiguïté : son code, son
/// nom, son cycle — « D3 — La formation de la personne et du citoyen (cycle 3) ».
///
/// L'enseignant écrit sur sa fiche « D3 la formation de la personne et du
/// citoyen cycle 3 », et il a raison : les cinq domaines portent les mêmes noms
/// d'un cycle à l'autre, donc le nom seul ne permet pas de retrouver l'entrée
/// dans le référentiel — ce qui est pourtant tout ce que la colonne
/// « domaines » a à faire.
///
/// **Composé ici et nulle part ailleurs.** Même raison que `trimester_bounds` :
/// deux implémentations de la même règle divergeraient au premier changement de
/// forme, et le front imprimerait un libellé que la base ne connaît pas.
///
/// Le nom du cycle est repris tel quel, sans passage en minuscules : un cycle
/// renommé par l'enseignant n'est pas forcément « Cycle 3 », et abîmer sa
/// casse pour gagner une virgule de ressemblance avec sa fiche serait un mauvais
/// marché.
///
/// Chaque morceau peut manquer sans trouer le résultat : un domaine créé par
/// l'enseignant n'a pas de code au décret, et un cycle peut avoir été renommé
/// en chaîne vide. Sans nom, il n'y a rien à désigner et le libellé est vide —
/// un code tout seul ne dit rien à qui lit la fiche.
pub fn socle_reference(code: &str, domain: &str, cycle: &str) -> String {
    let code = code.trim();
    let domain = domain.trim();
    let cycle = cycle.trim();

    if domain.is_empty() {
        return String::new();
    }

    let mut libelle = String::new();
    if !code.is_empty() {
        libelle.push_str(code);
        libelle.push_str(" — ");
    }
    libelle.push_str(domain);
    if !cycle.is_empty() {
        libelle.push_str(" (");
        libelle.push_str(cycle);
        libelle.push(')');
    }
    libelle
}

/// Clé de comparaison des noms : casse ignorée, espaces normalisés.
///
/// « Lire une consigne » et « lire  une   Consigne » désignent la même
/// compétence pour un enseignant qui colle une liste depuis un document.
fn dedup_key(name: &str) -> String {
    name.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Condition de filtrage d'un niveau, sous une forme unique quel que soit le
/// niveau : un cycle n'a pas de colonne parente, mais `?1 IS NULL` reste vrai
/// pour toutes ses lignes quand on lie NULL. Une seule requête, un seul
/// paramètre, donc aucun branchement à maintenir en double.
fn level_filter(kind: NodeKind) -> String {
    match kind.parent_column() {
        Some(column) => format!("{column} = ?1"),
        None => "?1 IS NULL".to_string(),
    }
}

/// Normalise le parent reçu : `None` pour un cycle, identifiant non vide
/// obligatoire pour tous les autres niveaux.
fn resolve_parent(kind: NodeKind, parent_id: Option<String>) -> Result<Option<String>, String> {
    match kind.parent_kind() {
        None => Ok(None),
        Some(parent_kind) => {
            let id = parent_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    format!(
                        "Aucun {} parent n'a été indiqué : rechargez le référentiel.",
                        parent_kind.label()
                    )
                })?;
            Ok(Some(id))
        }
    }
}

/// Sous-requête listant les compétences du sous-arbre d'un nœud.
///
/// Pour une compétence, ce sous-arbre se réduit à elle-même : `SELECT ?1` évite
/// d'écrire une seconde fois la requête de comptage d'impact.
fn subtree_competencies(kind: NodeKind) -> &'static str {
    match kind {
        NodeKind::Competency => "SELECT ?1",
        NodeKind::Field => "SELECT c.id FROM competencies c WHERE c.field_id = ?1",
        NodeKind::Domain => {
            "SELECT c.id FROM competencies c \
             JOIN fields f ON f.id = c.field_id \
             WHERE f.domain_id = ?1"
        }
        NodeKind::Cycle => {
            "SELECT c.id FROM competencies c \
             JOIN fields f ON f.id = c.field_id \
             JOIN domains d ON d.id = f.domain_id \
             WHERE d.cycle_id = ?1"
        }
    }
}

/// Traduit une violation de contrainte en message actionnable.
///
/// L'impact est compté AVANT la suppression ; ce filet ne sert que si la base a
/// changé entre-temps. On ne peut pas en dire plus : une erreur de clé étrangère
/// ne nomme jamais les lignes en cause — elle ne dit même pas laquelle des
/// trois tables en RESTRICT a parlé.
fn delete_error(err: rusqlite::Error) -> String {
    if let rusqlite::Error::SqliteFailure(inner, _) = &err {
        if inner.code == rusqlite::ErrorCode::ConstraintViolation {
            return "La suppression a été refusée : des évaluations, des notes ou des \
                    progressions en dépendent encore. Rechargez le référentiel puis \
                    réessayez."
                .to_string();
        }
    }
    err.to_string()
}

// ---------------------------------------------------------------------------
// Lecture de l'arbre
// ---------------------------------------------------------------------------

/// Renvoie le référentiel complet en **exactement quatre requêtes**, une par
/// niveau, assemblées en mémoire.
///
/// L'ancien `CompetencyPicker` enchaînait jusqu'à 22 invocations imbriquées pour
/// afficher la même chose : un aller-retour par domaine, puis par champ.
#[tauri::command]
pub fn get_referential_tree(state: tauri::State<'_, AppState>) -> Result<Vec<CycleNode>, String> {
    let conn = state.conn()?;

    let mut cycles: Vec<CycleNode> = Vec::new();
    // Chaque index mémorise le chemin vers le nœud déjà inséré, pour que le
    // niveau suivant se raccroche en temps constant.
    let mut cycle_at: HashMap<String, usize> = HashMap::new();
    let mut domain_at: HashMap<String, (usize, usize)> = HashMap::new();
    let mut field_at: HashMap<String, (usize, usize, usize)> = HashMap::new();

    {
        let mut stmt = conn
            .prepare("SELECT id, name, position FROM cycles ORDER BY position, name")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i32>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (id, name, position) = row.map_err(|e| e.to_string())?;
            cycle_at.insert(id.clone(), cycles.len());
            cycles.push(CycleNode {
                id,
                name,
                position,
                domains: Vec::new(),
            });
        }
    }

    {
        let mut stmt = conn
            .prepare("SELECT id, cycle_id, name, position FROM domains ORDER BY position, name")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i32>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (id, cycle_id, name, position) = row.map_err(|e| e.to_string())?;
            let Some(&ci) = cycle_at.get(&cycle_id) else {
                continue;
            };
            domain_at.insert(id.clone(), (ci, cycles[ci].domains.len()));
            cycles[ci].domains.push(DomainNode {
                id,
                name,
                position,
                fields: Vec::new(),
            });
        }
    }

    {
        let mut stmt = conn
            .prepare("SELECT id, domain_id, name, position FROM fields ORDER BY position, name")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i32>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (id, domain_id, name, position) = row.map_err(|e| e.to_string())?;
            let Some(&(ci, di)) = domain_at.get(&domain_id) else {
                continue;
            };
            field_at.insert(id.clone(), (ci, di, cycles[ci].domains[di].fields.len()));
            cycles[ci].domains[di].fields.push(FieldNode {
                id,
                name,
                position,
                competencies: Vec::new(),
            });
        }
    }

    {
        let mut stmt = conn
            .prepare(
                "SELECT id, field_id, name, position, archived_at IS NOT NULL
                   FROM competencies
                  ORDER BY position, name",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i32>(3)?,
                    row.get::<_, bool>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (id, field_id, name, position, archived) = row.map_err(|e| e.to_string())?;
            let Some(&(ci, di, fi)) = field_at.get(&field_id) else {
                continue;
            };
            cycles[ci].domains[di].fields[fi]
                .competencies
                .push(CompetencyNode {
                    id,
                    name,
                    position,
                    archived,
                });
        }
    }

    Ok(cycles)
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

/// Crée plusieurs nœuds d'un coup, en ignorant les doublons plutôt qu'en
/// échouant en bloc.
///
/// Le schéma ne pose volontairement pas de UNIQUE sur les noms : un collage de
/// 30 lignes dont une seule existe déjà doit créer les 29 autres et dire laquelle
/// a été ignorée. La déduplication vit donc ici.
#[tauri::command]
pub fn create_nodes_bulk(
    state: tauri::State<'_, AppState>,
    kind: NodeKind,
    parent_id: Option<String>,
    names: Vec<String>,
) -> Result<BulkResult, String> {
    let parent = resolve_parent(kind, parent_id)?;
    let filter = level_filter(kind);

    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    if let (Some(parent_kind), Some(parent_id)) = (kind.parent_kind(), parent.as_ref()) {
        let exists: i64 = tx
            .query_row(
                &format!("SELECT COUNT(*) FROM {} WHERE id = ?1", parent_kind.table()),
                params![parent_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if exists == 0 {
            return Err(format!(
                "{} n'existe plus : rechargez le référentiel.",
                parent_kind.demonstrative()
            ));
        }
    }

    let mut seen: HashSet<String> = HashSet::new();
    {
        let sql = format!("SELECT name FROM {} WHERE {}", kind.table(), filter);
        let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![parent], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for row in rows {
            seen.insert(dedup_key(&row.map_err(|e| e.to_string())?));
        }
    }

    let mut position: i32 = tx
        .query_row(
            &format!(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM {} WHERE {}",
                kind.table(),
                filter
            ),
            params![parent],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let insert = match kind.parent_column() {
        Some(column) => format!(
            "INSERT INTO {} (id, name, position, {}) VALUES (?1, ?2, ?3, ?4)",
            kind.table(),
            column
        ),
        None => format!(
            "INSERT INTO {} (id, name, position) VALUES (?1, ?2, ?3)",
            kind.table()
        ),
    };

    let mut created: Vec<NodeRef> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    {
        let mut stmt = tx.prepare(&insert).map_err(|e| e.to_string())?;
        for raw in &names {
            let name = raw.trim();
            if name.is_empty() {
                continue;
            }
            // `insert` renvoie faux si la clé était déjà là : le même test couvre
            // les doublons avec la base ET ceux internes au collage.
            if !seen.insert(dedup_key(name)) {
                skipped.push(name.to_string());
                continue;
            }
            let id = Uuid::new_v4().to_string();
            match parent.as_ref() {
                Some(parent_id) => stmt.execute(params![id, name, position, parent_id]),
                None => stmt.execute(params![id, name, position]),
            }
            .map_err(|e| e.to_string())?;
            position += 1;
            created.push(NodeRef {
                id,
                name: name.to_string(),
            });
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(BulkResult { created, skipped })
}

#[tauri::command]
pub fn rename_node(
    state: tauri::State<'_, AppState>,
    kind: NodeKind,
    id: String,
    name: String,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(format!("Le nom {} ne peut pas être vide.", article(kind)));
    }

    let conn = state.conn()?;
    let affected = conn
        .execute(
            &format!("UPDATE {} SET name = ?1 WHERE id = ?2", kind.table()),
            params![name, id],
        )
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err(format!(
            "{} n'existe plus : rechargez le référentiel.",
            kind.demonstrative()
        ));
    }
    Ok(())
}

/// Article défini élidé pour les messages : « le nom du champ », « de la
/// compétence ».
fn article(kind: NodeKind) -> &'static str {
    match kind {
        NodeKind::Competency => "de la compétence",
        NodeKind::Cycle => "du cycle",
        NodeKind::Domain => "du domaine",
        NodeKind::Field => "du champ",
    }
}

/// Supprime un nœud, après avoir mesuré l'impact.
///
/// Le comptage est fait AVANT la tentative : le RESTRICT du schéma fait bien
/// échouer la suppression, mais une erreur de clé étrangère ne dit ni combien
/// d'évaluations, ni combien de notes, ni combien d'étapes de progression sont
/// concernées — c'est pourtant la seule information qui permette à l'enseignant
/// de décider d'archiver.
///
/// **Le troisième compte est arrivé avec le palier 021**, le jour où une étape
/// de progression a pu citer le référentiel. Ajouter une table en RESTRICT sans
/// l'ajouter ici aurait rendu le message faux par omission : « 0 évaluation,
/// 0 note » suivi d'un refus que rien n'explique.
#[tauri::command]
pub fn delete_node(
    state: tauri::State<'_, AppState>,
    kind: NodeKind,
    id: String,
) -> Result<(), String> {
    let conn = state.conn()?;

    let subtree = subtree_competencies(kind);
    let impact = format!(
        "SELECT (SELECT COUNT(*) FROM grades WHERE competency_id IN ({subtree})),
                (SELECT COUNT(DISTINCT evaluation_id) FROM evaluation_competencies
                  WHERE competency_id IN ({subtree})),
                (SELECT COUNT(DISTINCT etape_id) FROM progression_etape_competences
                  WHERE competency_id IN ({subtree}))"
    );
    let (grades, evaluations, etapes): (i64, i64, i64) = conn
        .query_row(&impact, params![id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|e| e.to_string())?;

    if grades > 0 || evaluations > 0 || etapes > 0 {
        return Err(match kind {
            NodeKind::Competency => format!(
                "Cette compétence est utilisée par {evaluations} évaluation(s), \
                 porte {grades} note(s) et figure dans {etapes} étape(s) de \
                 progression. Archivez-la plutôt que de la supprimer."
            ),
            // Cycle, domaine et champ sont tous masculins : « de le supprimer ».
            _ => format!(
                "{} contient des compétences utilisées par {evaluations} \
                 évaluation(s), portant {grades} note(s) et citées dans {etapes} \
                 étape(s) de progression. Archivez ces compétences, ou retirez-les \
                 des évaluations et des progressions, avant de le supprimer.",
                kind.demonstrative()
            ),
        });
    }

    let affected = conn
        .execute(
            &format!("DELETE FROM {} WHERE id = ?1", kind.table()),
            params![id],
        )
        .map_err(delete_error)?;
    if affected == 0 {
        return Err(format!(
            "{} n'existe plus : rechargez le référentiel.",
            kind.demonstrative()
        ));
    }
    Ok(())
}

/// Réécrit **toutes** les positions d'un niveau, de 0 à n-1.
///
/// Pas de position fractionnaire ni de trou : un ordre partiel finirait par
/// produire deux nœuds de même position, dont l'ordre d'affichage dépendrait
/// alors du seul `name` — un déplacement qui ne tient pas.
#[tauri::command]
pub fn reorder_nodes(
    state: tauri::State<'_, AppState>,
    kind: NodeKind,
    parent_id: Option<String>,
    ordered_ids: Vec<String>,
) -> Result<(), String> {
    let parent = resolve_parent(kind, parent_id)?;
    let filter = level_filter(kind);

    let unique: HashSet<&String> = ordered_ids.iter().collect();
    if unique.len() != ordered_ids.len() {
        return Err(
            "La liste de réorganisation contient deux fois le même élément : \
                    rechargez le référentiel."
                .to_string(),
        );
    }

    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let total: i64 = tx
        .query_row(
            &format!("SELECT COUNT(*) FROM {} WHERE {}", kind.table(), filter),
            params![parent],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if total != ordered_ids.len() as i64 {
        return Err(format!(
            "La réorganisation porte sur {} élément(s) alors que ce niveau en \
             contient {total} : rechargez le référentiel.",
            ordered_ids.len()
        ));
    }

    {
        let sql = format!(
            "UPDATE {} SET position = ?3 WHERE id = ?2 AND {}",
            kind.table(),
            filter
        );
        let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
        for (index, id) in ordered_ids.iter().enumerate() {
            let affected = stmt
                .execute(params![parent, id, index as i32])
                .map_err(|e| e.to_string())?;
            if affected == 0 {
                return Err(format!(
                    "Un {} de la liste n'appartient plus à ce niveau : rechargez le \
                     référentiel.",
                    kind.label()
                ));
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Archive ou désarchive une compétence.
///
/// C'est la réponse de repli à la suppression impossible : les notes déjà saisies
/// survivent, la compétence disparaît seulement des listes de saisie.
#[tauri::command]
pub fn archive_competency(
    state: tauri::State<'_, AppState>,
    id: String,
    archived: bool,
) -> Result<(), String> {
    let conn = state.conn()?;
    let sql = if archived {
        // COALESCE : ré-archiver ne doit pas réécrire la date d'archivage
        // d'origine, qui est la seule trace de quand la compétence est sortie.
        "UPDATE competencies SET archived_at = COALESCE(archived_at, datetime('now'))
          WHERE id = ?1"
    } else {
        "UPDATE competencies SET archived_at = NULL WHERE id = ?1"
    };

    let affected = conn.execute(sql, params![id]).map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("Cette compétence n'existe plus : rechargez le référentiel.".to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::socle_reference;

    #[test]
    fn libelle_complet() {
        assert_eq!(
            socle_reference("D3", "La formation de la personne et du citoyen", "Cycle 3"),
            "D3 — La formation de la personne et du citoyen (Cycle 3)"
        );
    }

    /// Un domaine créé par l'enseignant n'a pas de code au décret : la chaîne
    /// vide ne doit pas produire « — » en tête de cellule.
    #[test]
    fn sans_code_pas_de_tiret() {
        assert_eq!(
            socle_reference("", "Vie de classe", "Cycle 4"),
            "Vie de classe (Cycle 4)"
        );
    }

    #[test]
    fn sans_cycle_pas_de_parentheses() {
        assert_eq!(socle_reference("D1", "Les langages", ""), "D1 — Les langages");
    }

    /// Sans nom, il n'y a rien à désigner : un « D3 — » tout seul sur la fiche
    /// ne dit rien à qui la lit, et vaut moins qu'une cellule vide.
    #[test]
    fn sans_nom_rien() {
        assert_eq!(socle_reference("D3", "   ", "Cycle 3"), "");
    }

    /// Les espaces viennent d'une liste collée depuis un document.
    #[test]
    fn espaces_rognes() {
        assert_eq!(
            socle_reference(" D2 ", " Les méthodes et outils pour apprendre ", " Cycle 3 "),
            "D2 — Les méthodes et outils pour apprendre (Cycle 3)"
        );
    }
}
