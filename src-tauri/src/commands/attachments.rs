//! Pièces jointes d'un compte rendu : la photo du tableau, le PDF distribué,
//! l'énoncé en .docx, un enregistrement audio — et, depuis le palier 017, le
//! rapport de visite signé par le tuteur ou le relevé d'un conseil de classe.
//!
//! Le stockage et ses raisons sont documentés dans
//! `db/sql/012_pieces_jointes.sql` : les octets vivent **dans** la base, donc
//! `create_backup` les emporte et SQLCipher les chiffre sans une ligne de code
//! de plus. Ce module est la seule porte vers ces tables.
//!
//! **Deux tables, une logique.** Une séance et un rendez-vous ont chacun leur
//! table (`db/sql/017_rendez_vous_compte_rendu.sql` dit pourquoi : une clé
//! étrangère ne peut pas désigner deux tables, et une cascade écrite à la main
//! laisse des BLOB orphelins que rien ne montre). Mais le plafond, le nom
//! assaini, les refus nommés et l'export en clair sont écrits **une fois** :
//! c'est `Porteur` qui choisit où les lignes atterrissent, et rien d'autre.
//! Les deux tables ne peuvent donc pas se comporter différemment.
//!
//! **Les octets voyagent en base64, pas en `Vec<u8>`.** L'IPC de Tauri est du
//! JSON : un `Vec<u8>` de 10 Mo s'y écrit en tableau de nombres décimaux, soit
//! une trentaine de mégaoctets de texte à produire puis à relire. Le base64 en
//! fait 13,4, et c'est déjà la forme qu'emploient `keys.rs` et `device.rs`.
//!
//! **Le type MIME est indicatif, jamais une autorisation.** Il vient du
//! navigateur, ne décide que du mode d'aperçu, et aucune décision de sécurité
//! ne s'appuie dessus. L'ouverture dans une application du poste passe par
//! `save_export`, qui écrit dans `exports/` sous un nom assaini — SGPA
//! n'exécute jamais rien.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use uuid::Uuid;

use crate::state::AppState;

/// Plafond par fichier : 10 Mo.
///
/// Il vit ici et non en CHECK SQL parce qu'un CHECK violé dit « constraint
/// failed », là où il faut une phrase française qui nomme le fichier et sa
/// taille. Les images sont déjà réduites à 1600 px par le front : ce plafond
/// n'arrête donc pas une photo de téléphone, il arrête une vidéo.
pub const MAX_ATTACHMENT_BYTES: usize = 10 * 1024 * 1024;

/// Une pièce jointe **sans ses octets**.
///
/// C'est la forme que voient toutes les listes : afficher « 312 Ko » en face
/// d'une ligne ne doit pas traverser les pages de débordement du BLOB.
#[derive(Debug, Clone, Serialize)]
pub struct Attachment {
    pub id: String,
    /// La séance ou le rendez-vous qui la porte. Nommé `owner_id` et non
    /// `seance_id` depuis le palier 017 : l'écran de pièces jointes est le même
    /// des deux côtés, et un champ qui mentirait sur la moitié des cas aurait
    /// fini par être lu de travers.
    pub owner_id: String,
    pub file_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub created_at: String,
}

/// Une pièce jointe **avec** ses octets, en base64.
#[derive(Debug, Clone, Serialize)]
pub struct AttachmentContent {
    pub id: String,
    pub file_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    /// Les octets du fichier, encodés en base64 sans en-tête `data:`.
    pub content_base64: String,
}

/// Ce qui porte une pièce jointe.
#[derive(Debug, Clone, Copy)]
enum Porteur {
    Seance,
    RendezVous,
}

/// Les requêtes d'un porteur, et le nom qu'il porte dans un refus.
///
/// Chaque requête est un littéral **complet**, et ce n'est pas du remplissage :
/// `sql_smoke` saute toute requête qui contient une accolade, donc une requête
/// assemblée par `format!` perd sa vérification contre le schéma réel. Écrites
/// en entier, les deux familles sont préparées par le test — c'est ce qui
/// attrape une colonne renommée dans une table et pas dans l'autre.
struct Requetes {
    lister: &'static str,
    porteur_existe: &'static str,
    /// Le refus quand le porteur n'existe pas. La clé étrangère le refuserait
    /// aussi, mais en anglais : ce test existe pour la phrase.
    porteur_absent: &'static str,
    inserer: &'static str,
    relire: &'static str,
    lire: &'static str,
    exporter: &'static str,
    supprimer: &'static str,
}

/// Projection commune aux listages : **`content` n'y figure pas**, et c'est
/// tout le point. La colonne est déclarée en dernier dans les deux tables pour
/// que le BLOB parte seul en pages annexes, et sélectionner ces six colonnes ne
/// les lit pas.
const SEANCE: Requetes = Requetes {
    lister: "SELECT id, seance_id, file_name, mime_type, size_bytes, created_at \
             FROM seance_attachments \
             WHERE seance_id = ?1 ORDER BY created_at, file_name",
    porteur_existe: "SELECT 1 FROM seances WHERE id = ?1",
    porteur_absent: "Séance introuvable",
    inserer: "INSERT INTO seance_attachments \
                  (id, seance_id, file_name, mime_type, size_bytes, content) \
              VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    relire: "SELECT id, seance_id, file_name, mime_type, size_bytes, created_at \
             FROM seance_attachments WHERE id = ?1",
    lire: "SELECT id, file_name, mime_type, size_bytes, content \
           FROM seance_attachments WHERE id = ?1",
    exporter: "SELECT file_name, content FROM seance_attachments WHERE id = ?1",
    supprimer: "DELETE FROM seance_attachments WHERE id = ?1",
};

const RENDEZ_VOUS: Requetes = Requetes {
    lister: "SELECT id, entry_id, file_name, mime_type, size_bytes, created_at \
             FROM agenda_entry_attachments \
             WHERE entry_id = ?1 ORDER BY created_at, file_name",
    porteur_existe: "SELECT 1 FROM agenda_entries WHERE id = ?1",
    porteur_absent: "Rendez-vous introuvable",
    inserer: "INSERT INTO agenda_entry_attachments \
                  (id, entry_id, file_name, mime_type, size_bytes, content) \
              VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    relire: "SELECT id, entry_id, file_name, mime_type, size_bytes, created_at \
             FROM agenda_entry_attachments WHERE id = ?1",
    lire: "SELECT id, file_name, mime_type, size_bytes, content \
           FROM agenda_entry_attachments WHERE id = ?1",
    exporter: "SELECT file_name, content FROM agenda_entry_attachments WHERE id = ?1",
    supprimer: "DELETE FROM agenda_entry_attachments WHERE id = ?1",
};

impl Porteur {
    fn requetes(self) -> &'static Requetes {
        match self {
            Porteur::Seance => &SEANCE,
            Porteur::RendezVous => &RENDEZ_VOUS,
        }
    }
}

fn map_attachment(row: &rusqlite::Row<'_>) -> rusqlite::Result<Attachment> {
    Ok(Attachment {
        id: row.get(0)?,
        owner_id: row.get(1)?,
        file_name: row.get(2)?,
        mime_type: row.get(3)?,
        size_bytes: row.get(4)?,
        created_at: row.get(5)?,
    })
}

/// Taille lisible pour un **message d'erreur**, pas pour l'écran.
///
/// Le front a sa propre fonction d'affichage, et ce n'est pas un doublon de
/// règle : un message d'erreur doit se suffire à lui-même, parce qu'il peut
/// remonter d'un appel que le front n'a pas formaté.
fn human_size(bytes: usize) -> String {
    const KO: usize = 1024;
    const MO: usize = 1024 * 1024;
    if bytes < KO {
        format!("{bytes} o")
    } else if bytes < MO {
        format!("{} Ko", bytes / KO)
    } else {
        // Virgule décimale, pas le point : c'est une interface française.
        format!("{},{} Mo", bytes / MO, (bytes % MO) * 10 / MO)
    }
}

/// Le refus commun à `lire`, `exporter` et `supprimer` : la pièce a disparu
/// entre l'affichage de la liste et le clic.
fn piece_introuvable() -> String {
    "Pièce jointe introuvable : elle a peut-être été supprimée depuis \
     l'affichage de ce compte rendu."
        .to_string()
}

// ---------------------------------------------------------------------------
// La logique, écrite une seule fois
// ---------------------------------------------------------------------------

fn lister(
    state: &AppState,
    porteur: Porteur,
    owner_id: &str,
) -> Result<Vec<Attachment>, String> {
    let conn = state.conn()?;
    let mut stmt = conn
        .prepare(porteur.requetes().lister)
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![owner_id], map_attachment)
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn ajouter(
    state: &AppState,
    porteur: Porteur,
    owner_id: &str,
    file_name: &str,
    mime_type: &str,
    content_base64: &str,
) -> Result<Attachment, String> {
    let requetes = porteur.requetes();

    // Le nom est assaini AVANT le décodage : il sert au message d'erreur de
    // taille, et un nom refusé ne doit pas coûter le décodage de 10 Mo.
    let safe_name = super::maintenance::sanitize_file_name(file_name)?;

    let bytes = B64.decode(content_base64.as_bytes()).map_err(|_| {
        format!(
            "Le fichier « {safe_name} » n'a pas pu être lu : son contenu est \
             arrivé abîmé. Réessayez de le joindre."
        )
    })?;

    if bytes.is_empty() {
        return Err(format!(
            "Le fichier « {safe_name} » est vide : rien n'a été joint."
        ));
    }
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(format!(
            "Le fichier « {safe_name} » fait {} : la limite est de {} par \
             pièce jointe.\n\
             Les pièces jointes vivent dans la base chiffrée, que chaque \
             sauvegarde recopie en entier — un fichier trop gros ralentirait \
             toutes les sauvegardes suivantes.",
            human_size(bytes.len()),
            human_size(MAX_ATTACHMENT_BYTES),
        ));
    }

    let conn = state.conn()?;

    let exists: Option<i64> = conn
        .query_row(requetes.porteur_existe, params![owner_id], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    if exists.is_none() {
        return Err(requetes.porteur_absent.to_string());
    }

    let id = Uuid::new_v4().to_string();
    let size = bytes.len() as i64;

    conn.execute(
        requetes.inserer,
        params![id, owner_id, safe_name, mime_type, size, bytes],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(requetes.relire, params![id], map_attachment)
        .map_err(|e| e.to_string())
}

fn lire(state: &AppState, porteur: Porteur, id: &str) -> Result<AttachmentContent, String> {
    let conn = state.conn()?;
    let found = conn
        .query_row(porteur.requetes().lire, params![id], |row| {
            let bytes: Vec<u8> = row.get(4)?;
            Ok(AttachmentContent {
                id: row.get(0)?,
                file_name: row.get(1)?,
                mime_type: row.get(2)?,
                size_bytes: row.get(3)?,
                content_base64: B64.encode(&bytes),
            })
        })
        .optional()
        .map_err(|e| e.to_string())?;

    found.ok_or_else(piece_introuvable)
}

fn supprimer(state: &AppState, porteur: Porteur, id: &str) -> Result<(), String> {
    let conn = state.conn()?;
    let touched = conn
        .execute(porteur.requetes().supprimer, params![id])
        .map_err(|e| e.to_string())?;
    if touched == 0 {
        return Err("Pièce jointe introuvable".to_string());
    }
    Ok(())
}

fn exporter(
    state: &AppState,
    porteur: Porteur,
    id: &str,
    open_after: bool,
) -> Result<String, String> {
    let conn = state.conn()?;
    let found: Option<(String, Vec<u8>)> = conn
        .query_row(porteur.requetes().exporter, params![id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .optional()
        .map_err(|e| e.to_string())?;

    let (file_name, bytes) = found.ok_or_else(piece_introuvable)?;

    // La connexion est relâchée avant d'écrire et d'ouvrir : `open_path` rend la
    // main dès que l'application tierce est lancée, mais garder le Mutex de la
    // base pendant une écriture sur clé USB bloquerait tout le reste de
    // l'application pour rien.
    drop(conn);

    super::maintenance::write_export(
        &state.layout.exports_dir,
        &file_name,
        &bytes,
        open_after,
    )
}

// ---------------------------------------------------------------------------
// Les commandes : deux familles, aucune logique
// ---------------------------------------------------------------------------
//
// Dix enveloppes plutôt que cinq commandes prenant un « type de porteur » en
// chaîne : le porteur est connu à l'écriture du code, et le faire voyager par
// l'IPC aurait ajouté un refus (« porteur inconnu ») que seule une faute de
// frappe du front pourrait déclencher. Le nom de la commande le dit, et le
// compilateur le vérifie.

#[tauri::command]
pub fn get_seance_attachments(
    state: tauri::State<'_, AppState>,
    seance_id: String,
) -> Result<Vec<Attachment>, String> {
    lister(&state, Porteur::Seance, &seance_id)
}

/// Joint un fichier à une séance.
///
/// Rend la pièce créée : l'appelant n'a pas à relire la liste pour connaître
/// l'identifiant, la date et la taille réellement stockée.
#[tauri::command]
pub fn add_seance_attachment(
    state: tauri::State<'_, AppState>,
    seance_id: String,
    file_name: String,
    mime_type: String,
    content_base64: String,
) -> Result<Attachment, String> {
    ajouter(
        &state,
        Porteur::Seance,
        &seance_id,
        &file_name,
        &mime_type,
        &content_base64,
    )
}

/// Rend les octets d'UNE pièce jointe.
///
/// Une commande à part, et non un champ des listages : c'est le seul endroit où
/// un BLOB traverse l'IPC, et il le fait sur un geste explicite de
/// l'enseignant — ouvrir ou prévisualiser une pièce précise.
#[tauri::command]
pub fn read_seance_attachment(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<AttachmentContent, String> {
    lire(&state, Porteur::Seance, &id)
}

#[tauri::command]
pub fn delete_seance_attachment(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    supprimer(&state, Porteur::Seance, &id)
}

/// Recopie une pièce jointe dans `exports/` et, si demandé, l'ouvre avec
/// l'application du poste.
///
/// **Les octets ne traversent pas l'IPC** : ils vont de la base au fichier sans
/// passer par le front. Un PDF de 9 Mo encodé en JSON pour revenir se faire
/// écrire serait 30 Mo de texte produits puis relus pour rien.
///
/// **La copie écrite est en clair**, et c'est inévitable : aucune application du
/// poste ne sait lire dans une base SQLCipher. C'est pourquoi le chemin est rendu
/// — l'écran doit pouvoir dire où la copie a été posée, pour que l'enseignant
/// sache qu'il y a quelque chose à effacer dans `exports/`. Tout ce qui se lit
/// sans écrire de copie — image, audio, PDF — passe par `read_seance_attachment`
/// et reste dans la fenêtre.
#[tauri::command]
pub fn export_seance_attachment(
    state: tauri::State<'_, AppState>,
    id: String,
    open_after: bool,
) -> Result<String, String> {
    exporter(&state, Porteur::Seance, &id, open_after)
}

#[tauri::command]
pub fn get_entry_attachments(
    state: tauri::State<'_, AppState>,
    entry_id: String,
) -> Result<Vec<Attachment>, String> {
    lister(&state, Porteur::RendezVous, &entry_id)
}

/// Joint un fichier à un rendez-vous — le rapport de visite signé, d'abord.
///
/// Même plafond, même réduction d'image côté front, même nom assaini qu'une
/// séance : un document reçu est un document reçu.
#[tauri::command]
pub fn add_entry_attachment(
    state: tauri::State<'_, AppState>,
    entry_id: String,
    file_name: String,
    mime_type: String,
    content_base64: String,
) -> Result<Attachment, String> {
    ajouter(
        &state,
        Porteur::RendezVous,
        &entry_id,
        &file_name,
        &mime_type,
        &content_base64,
    )
}

#[tauri::command]
pub fn read_entry_attachment(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<AttachmentContent, String> {
    lire(&state, Porteur::RendezVous, &id)
}

#[tauri::command]
pub fn delete_entry_attachment(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    supprimer(&state, Porteur::RendezVous, &id)
}

#[tauri::command]
pub fn export_entry_attachment(
    state: tauri::State<'_, AppState>,
    id: String,
    open_after: bool,
) -> Result<String, String> {
    exporter(&state, Porteur::RendezVous, &id, open_after)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn taille_lisible_en_francais() {
        assert_eq!(human_size(0), "0 o");
        assert_eq!(human_size(512), "512 o");
        assert_eq!(human_size(2048), "2 Ko");
        assert_eq!(human_size(MAX_ATTACHMENT_BYTES), "10,0 Mo");
        // Virgule décimale et non point : interface française.
        assert!(human_size(1024 * 1024 * 3 / 2).contains(','));
    }

    /// Le plafond se compare aux octets DÉCODÉS, pas à la chaîne base64 reçue :
    /// le base64 pèse un tiers de plus, et mesurer la chaîne refuserait un
    /// fichier de 7,5 Mo en annonçant une limite de 10.
    #[test]
    fn le_plafond_porte_sur_les_octets_decodes() {
        let octets = vec![0u8; MAX_ATTACHMENT_BYTES];
        let encode = B64.encode(&octets);
        assert!(encode.len() > MAX_ATTACHMENT_BYTES);
        assert_eq!(
            B64.decode(encode.as_bytes()).unwrap().len(),
            MAX_ATTACHMENT_BYTES
        );
    }

    /// Les deux familles de requêtes doivent rester **jumelles** : même nombre
    /// de paramètres, mêmes colonnes dans le même ordre. Un `?2` oublié d'un
    /// côté ne se verrait qu'à l'exécution, et seulement sur l'écran des
    /// rendez-vous — celui qui est essayé le moins souvent.
    ///
    /// `sql_smoke` prépare déjà chaque requête contre le schéma ; ce test
    /// compare les deux familles entre elles, ce qu'il ne fait pas.
    #[test]
    fn les_deux_porteurs_ont_des_requetes_jumelles() {
        let paires: [(&str, &str); 8] = [
            (SEANCE.lister, RENDEZ_VOUS.lister),
            (SEANCE.porteur_existe, RENDEZ_VOUS.porteur_existe),
            (SEANCE.porteur_absent, RENDEZ_VOUS.porteur_absent),
            (SEANCE.inserer, RENDEZ_VOUS.inserer),
            (SEANCE.relire, RENDEZ_VOUS.relire),
            (SEANCE.lire, RENDEZ_VOUS.lire),
            (SEANCE.exporter, RENDEZ_VOUS.exporter),
            (SEANCE.supprimer, RENDEZ_VOUS.supprimer),
        ];
        for (seance, rendez_vous) in paires {
            assert_eq!(
                seance.matches('?').count(),
                rendez_vous.matches('?').count(),
                "autant de paramètres d'un côté que de l'autre : {seance}"
            );
        }
        // Et le porteur n'est jamais nommé pareil : une table copiée sans que
        // la colonne change serait passée inaperçue ici.
        assert!(SEANCE.inserer.contains("seance_id"));
        assert!(RENDEZ_VOUS.inserer.contains("entry_id"));
    }
}
