//! Les commandes du journal de diagnostic (voir `src/journal.rs` pour la
//! doctrine, et notamment pourquoi ce fichier en clair ne doit porter aucune
//! donnée personnelle).
//!
//! Deux d'entre elles sont des **entrées** : le front y dépose ce que lui seul
//! voit — une exception JavaScript, une commande refusée. Les deux autres sont
//! des **sorties**, pour l'écran de réglages.
//!
//! Aucune n'exige la session déverrouillée, à rebours de tout le reste de
//! l'application. C'est volontaire : le moment où un diagnostic manque le plus
//! est celui où la base refuse de s'ouvrir, donc avant le mot de passe. Et
//! aucune ne touche à la base — elles ne liraient rien à cacher même si elles
//! essayaient.

use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::journal;
use crate::state::AppState;

/// Lignes du jour renvoyées à l'écran de réglages.
///
/// Assez pour lire un incident et son contexte, pas assez pour transformer une
/// carte de réglages en visionneuse de fichier : le dossier est à un clic pour
/// qui veut tout.
const LIGNES_RENDUES: usize = 40;

#[derive(Debug, Serialize)]
pub struct JournalInfo {
    /// Chemin complet du dossier, affiché tel quel : l'enseignant doit pouvoir
    /// le retrouver depuis l'explorateur sans nous.
    pub folder: String,
    pub today_file: String,
    pub today_bytes: u64,
    pub file_count: usize,
    /// Les dernières lignes du jour, les plus récentes en dernier — dans l'ordre
    /// du fichier, parce qu'un journal lu à l'envers ne se lit pas.
    pub recent_lines: Vec<String>,
}

/// Une commande a échoué côté interface.
///
/// **Elle ne prend que le nom de la commande, et c'est la raison d'être de cette
/// signature.** Le message d'erreur, lui, reste à l'écran et n'entre jamais
/// ici : plusieurs messages français interpolent une valeur de la base, et l'un
/// d'eux nomme un élève. Un paramètre `message` aurait suffi à écrire le prénom
/// d'un mineur en clair sur la clé USB, et il se serait ajouté un jour « juste
/// pour mieux diagnostiquer ». Il n'y en a donc pas.
///
/// Ce que le nom seul apporte : la liste ordonnée des commandes qui ont échoué,
/// avec leur heure. C'est ce qui dit où regarder.
#[tauri::command]
pub fn log_command_failure(command: String) {
    journal::erreur("commande", &command);
}

/// Une exception non rattrapée côté interface : erreur de rendu React, promesse
/// rejetée, script en défaut.
///
/// Sans ce chemin, une exception de rendu laisse une fenêtre blanche et rien
/// d'autre — la console de WebView2 n'est pas ouvrable par l'enseignant. Le
/// détail attendu est un artefact de **code** : un message d'exception et une
/// pile d'appels nommant nos propres fichiers.
#[tauri::command]
pub fn log_ui_error(origin: String, detail: String) {
    journal::erreur(&format!("interface/{origin}"), &detail);
}

/// Ce que l'écran de réglages affiche du journal.
#[tauri::command]
pub fn get_journal_info(state: tauri::State<'_, AppState>) -> Result<JournalInfo, String> {
    let dossier = &state.layout.logs_dir;
    let du_jour = journal::chemin_du_jour(dossier);

    Ok(JournalInfo {
        folder: dossier.display().to_string(),
        today_file: du_jour
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        today_bytes: fs::metadata(&du_jour).map(|m| m.len()).unwrap_or(0),
        file_count: compter(dossier),
        recent_lines: dernieres_lignes(&du_jour),
    })
}

/// Ouvre `data/logs` dans l'explorateur de fichiers.
///
/// Le geste utile est « envoyer ce fichier » : ouvrir le dossier le rend
/// saisissable à la souris, là où afficher un chemin obligerait à le recopier.
#[tauri::command]
pub fn reveal_logs_dir(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let dossier = &state.layout.logs_dir;
    // Le dossier peut ne pas exister encore si rien n'a jamais été journalisé ;
    // l'ouvrir alors échouerait sur un message bien plus obscur que l'absence.
    let _ = fs::create_dir_all(dossier);

    tauri_plugin_opener::open_path(dossier, None::<&str>).map_err(|e| {
        format!(
            "Le dossier des journaux n'a pas pu être ouvert.\n\
             Dossier : {}\n\
             Détail : {e}\n\
             Ouvrez-le à la main depuis l'explorateur de fichiers.",
            dossier.display()
        )
    })
}

fn compter(dossier: &Path) -> usize {
    let Ok(entrees) = fs::read_dir(dossier) else {
        return 0;
    };
    entrees
        .flatten()
        .filter(|e| {
            e.file_name()
                .to_str()
                .is_some_and(journal::est_un_journal)
        })
        .count()
}

/// Les `LIGNES_RENDUES` dernières lignes du fichier.
///
/// Lecture en une fois : le fichier est plafonné à 1 Mio par le journal
/// lui-même, et lire à l'envers un fichier de cette taille ne vaut pas le code
/// que cela demande. `from_utf8_lossy` plutôt qu'une erreur : un fichier abîmé
/// par un arrêt brutal doit encore livrer ce qu'il a d'intact — c'est
/// exactement le cas qu'on cherche à diagnostiquer.
fn dernieres_lignes(chemin: &Path) -> Vec<String> {
    let Ok(octets) = fs::read(chemin) else {
        return Vec::new();
    };
    let texte = String::from_utf8_lossy(&octets);
    let toutes: Vec<&str> = texte.lines().collect();
    let depart = toutes.len().saturating_sub(LIGNES_RENDUES);
    toutes[depart..].iter().map(|l| l.to_string()).collect()
}
