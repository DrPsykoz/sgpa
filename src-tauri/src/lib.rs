mod commands;
mod db;
mod device;
mod journal;
mod keys;
mod portable;
#[cfg(test)]
mod sql_smoke;
mod state;

use commands::{
    absences, attachments, contracts, diagnostics, evaluations, home, lock, maintenance, needs,
    referential, reports, seances, sessions, students, timetable, trimesters,
};
use state::AppState;

/// Le libellé d'un domaine du socle, pour les outils de `examples/`.
///
/// Réexporté nommément plutôt qu'en ouvrant `commands` : un semis qui
/// recomposerait le libellé à sa façon produirait une fiche de démonstration
/// différente de celle que l'application écrit, donc un PDF qui ne vérifie
/// rien.
pub use commands::referential::socle_reference;

/// Année scolaire d'une date — la règle de l'emploi du temps, pas une copie.
///
/// Réexportée pour `examples/seed_demo`, qui doit poser son jeu de
/// démonstration sur l'année que la grille regarde. Un semis qui recalculerait
/// la bascule du 1er août de son côté produirait, au premier déplacement de
/// cette bascule, une classe invisible depuis l'emploi du temps : exactement le
/// défaut que ce semis vient de corriger.
pub use commands::timetable::year_start_for;

/// Ouvre la base chiffrée pour les outils de développement de `examples/`.
///
/// Seule porte publique vers la base : le socle cryptographique reste privé, et
/// l'application elle-même ne passe pas par ici. Elle exige le mot de passe,
/// comme n'importe quel accès.
pub fn open_for_tools(
    data_dir: &std::path::Path,
    password: &str,
) -> Result<rusqlite::Connection, String> {
    let key = keys::unwrap_with_password(data_dir, password).map_err(|e| e.to_string())?;
    db::open_encrypted(&data_dir.join("sgpa.db"), &key).map_err(|e| e.to_string())
}

/// Crée un verrou et une base chiffrée vide, hors de l'application.
///
/// Réservé à `examples/` : c'est ce qui permet de fabriquer une base de
/// démonstration d'un seul coup, sans passer par l'écran de premier lancement.
/// Renvoie la phrase de récupération, exactement comme `setup_lock`.
///
/// Refuse si un verrou existe déjà : écraser `sgpa.keys` rendrait la base
/// correspondante définitivement illisible.
pub fn create_for_tools(
    data_dir: &std::path::Path,
    password: &str,
) -> Result<(rusqlite::Connection, String), String> {
    let (key, phrase) = keys::create(data_dir, password).map_err(|e| e.to_string())?;
    let mut conn =
        db::open_encrypted(&data_dir.join("sgpa.db"), &key).map_err(|e| e.to_string())?;
    // La base sort vierge d'`open_encrypted` : sans les paliers, elle n'a aucune
    // table et `PRAGMA user_version` vaut 0.
    db::migrations::run(&mut conn, &data_dir.join("backups")).map_err(|e| e.to_string())?;
    Ok((conn, phrase.as_str().to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // La base est ouverte une seule fois ici, et partagée ensuite via AppState.
    let state = match start() {
        Ok(state) => state,
        Err(message) => {
            fatal(&message);
            std::process::exit(1);
        }
    };

    // La fenêtre est construite ici, et non déclarée dans tauri.conf.json, parce que
    // `data_directory` n'existe pas dans la configuration JSON. Sans elle, WebView2
    // range localStorage, cookies et cache dans le %LOCALAPPDATA% du poste hôte :
    // l'application laisserait des traces sur chaque PC du collège et ne serait pas
    // réellement portable.
    let webview_dir = state.layout.webview_dir.clone();

    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let window =
                tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
                    .title("SGPA — Gestion de classes SEGPA")
                    .inner_size(1280.0, 800.0)
                    .min_inner_size(1024.0, 700.0)
                    .data_directory(webview_dir.clone())
                    // Sans cet appel, Tauri intercepte lui-même les fichiers lâchés sur
                    // la fenêtre et n'émet qu'un événement portant des CHEMINS : le DOM
                    // ne voit rien, et `DataTransfer.files` reste vide sous Windows.
                    //
                    // Des chemins auraient obligé à lire le fichier en Rust, donc à
                    // sauter la réduction à 1600 px que fait le front — une photo de
                    // téléphone déposée aurait été refusée à 8 Mo quand la même, choisie
                    // au bouton, passe à 300 Ko. Le même geste doit donner le même
                    // résultat, donc le dépôt passe par le DOM comme le bouton.
                    //
                    // Contrepartie, tenue côté front par `interdire_navigation_par_depot`
                    // (`src/lib/depot.ts`) : privé du gestionnaire de Tauri, WebView2
                    // applique son comportement par défaut et NAVIGUE vers le fichier
                    // lâché. L'application disparaîtrait derrière un PDF, sans barre
                    // d'adresse pour revenir.
                    .disable_drag_drop_handler()
                    .build()?;
            couper_suggestions_de_saisie(&window);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Verrou, récupération & réglages
            lock::get_lock_status,
            lock::setup_lock,
            lock::unlock,
            lock::unlock_with_pin,
            lock::enable_pin,
            lock::disable_pin,
            lock::recover,
            lock::lock,
            lock::change_password,
            lock::regenerate_recovery,
            lock::set_password_hint,
            lock::get_settings,
            lock::update_settings,
            // Classes
            sessions::get_sessions,
            sessions::get_session,
            sessions::create_session,
            sessions::update_session,
            sessions::delete_session,
            // Élèves
            students::get_students,
            students::create_student,
            students::create_students_bulk,
            students::update_student,
            students::get_student_deletion_impact,
            students::delete_student,
            // Besoins particuliers des élèves — JAMAIS imprimés, voir needs.rs
            needs::get_need_tags,
            needs::create_need_tag,
            needs::update_need_tag,
            needs::delete_need_tag,
            needs::get_session_needs,
            needs::set_student_needs,
            needs::update_student_needs_note,
            // Référentiel de compétences
            referential::get_referential_tree,
            referential::create_nodes_bulk,
            referential::rename_node,
            referential::delete_node,
            referential::reorder_nodes,
            referential::archive_competency,
            // Séances & présences
            seances::get_seances,
            seances::create_seance,
            seances::update_seance_meta,
            seances::update_seance_content,
            seances::set_seance_content_waived,
            seances::delete_seance,
            seances::get_attendance,
            seances::set_attendance,
            seances::set_bulk_attendance,
            seances::reset_attendance,
            seances::create_seance_from_slot,
            // Pièces jointes du cahier de texte
            attachments::get_seance_attachments,
            attachments::add_seance_attachment,
            attachments::read_seance_attachment,
            attachments::export_seance_attachment,
            attachments::delete_seance_attachment,
            attachments::get_entry_attachments,
            attachments::add_entry_attachment,
            attachments::read_entry_attachment,
            attachments::export_entry_attachment,
            attachments::delete_entry_attachment,
            // Évaluations & notes
            evaluations::get_evaluations,
            evaluations::create_evaluation,
            evaluations::update_evaluation,
            evaluations::delete_evaluation,
            evaluations::get_evaluation_competencies,
            evaluations::get_grades,
            evaluations::set_grade,
            // Accueil
            home::get_upcoming_days,
            home::get_home_overview,
            // Emploi du temps & entrées datées
            timetable::get_available_academies,
            timetable::get_day_schedule,
            timetable::get_week_schedule,
            timetable::get_timetable_slots,
            timetable::create_timetable_slot,
            timetable::update_timetable_slot,
            timetable::delete_timetable_slot,
            timetable::create_agenda_entry,
            timetable::get_agenda_entry,
            timetable::update_agenda_entry_meta,
            timetable::update_agenda_entry_content,
            timetable::set_agenda_entry_content_waived,
            timetable::delete_agenda_entry,
            timetable::get_student_agenda_entries,
            // Périodes d'absence justifiée
            absences::get_absence_periods,
            absences::create_absence_period,
            absences::update_absence_period,
            absences::delete_absence_period,
            // Trimestres
            trimesters::get_trimester_bounds,
            trimesters::preview_trimester_recompute,
            trimesters::update_trimester_bounds,
            // Fiches contrat
            contracts::get_contract_sheet,
            contracts::suggest_contract_sheet,
            contracts::save_contract_sheet,
            contracts::get_professional_fields,
            contracts::create_professional_field,
            // Bilans
            reports::get_report,
            reports::save_report_comment,
            // Journal de diagnostic — voir `src/journal.rs`
            diagnostics::get_journal_info,
            diagnostics::reveal_logs_dir,
            diagnostics::log_command_failure,
            diagnostics::log_ui_error,
            // Maintenance
            maintenance::create_backup,
            maintenance::list_backups,
            maintenance::reveal_data_dir,
            maintenance::save_export,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Ce que le démarrage fait, et ce qu'il ne fait plus.
///
/// La base n'est **pas** ouverte ici : elle est chiffrée, et sa clé n'existe
/// qu'une fois le mot de passe déballé, donc après la fenêtre. Ne restent avant
/// la fenêtre que les échecs qu'aucune interface ne pourrait rattraper — un
/// dossier de données inaccessible, une seconde instance — et qui passent par
/// `fatal()`.
fn start() -> Result<AppState, String> {
    let layout = portable::resolve().map_err(|e| e.to_string())?;

    // Au plus tôt : tout ce qui échoue après cette ligne laisse une trace
    // dans `data/logs`, y compris une panique — que le sous-système fenêtré
    // ferait autrement disparaître sans un mot en release. Un échec de
    // `resolve` lui-même n'est pas journalisable : il n'y a alors aucun
    // dossier où écrire, et c'est `fatal()` qui le dit.
    journal::init(&layout.logs_dir);
    journal::installer_capture_de_panique();
    // Avant que WebView2 ne rouvre son profil : une fois le processus Edge
    // démarré, ces bases sont verrouillées et la purge échouerait en silence.
    portable::purge_traces_webview(&layout.webview_dir);
    // Ne demande aucune clé : le critère est « sgpa.db sans sgpa.keys ».
    db::move_legacy_aside(&layout).map_err(|e| e.to_string())?;

    // Le verrou remplace le `locking_mode = EXCLUSIVE` d'avant, qui ne pouvait
    // plus jouer ce rôle : il aurait fallu ouvrir la base pour détecter la
    // seconde instance, donc répondre « SGPA est déjà ouvert » à l'enseignant
    // seulement après qu'il ait tapé son mot de passe.
    let lock = portable::acquire_lock(&layout.root).map_err(|e| {
        // Le détail technique au journal, le message compréhensible à
        // l'enseignant : « SGPA est déjà ouvert » ne dit pas quel fichier de
        // verrou a résisté, et c'est pourtant cela qu'on cherche ensuite.
        journal::erreur("démarrage/verrou", &e.to_string());
        db::DbError::AlreadyOpen.to_string()
    })?;

    Ok(AppState::new(layout, lock))
}

/// Coupe les « suggestions de saisie » et l'enregistrement des mots de passe
/// d'Edge dans le WebView.
///
/// Sans cela, WebView2 recopie dans `data/webview/EBWebView/Default/Web Data`,
/// une base SQLite ordinaire et non chiffrée, la valeur de chaque champ de
/// formulaire nommé — nom de l'enseignant, nom de l'établissement, nom de
/// classe. `autocomplete="off"` ne suffit pas : Edge ne l'honore pas
/// systématiquement. L'application étant portable et manipulant des données
/// d'élèves mineurs, ce dépôt est une fuite, pas une commodité.
///
/// Tauri n'expose pas ce réglage : on descend jusqu'à `ICoreWebView2Settings4`.
/// Un échec n'est pas remonté — il dégraderait la confidentialité, pas le
/// fonctionnement, et une fenêtre qui ne s'ouvre pas serait bien pire. La purge
/// de `portable::purge_traces_webview` reste le filet au lancement suivant.
#[cfg(windows)]
fn couper_suggestions_de_saisie(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings4;
    use windows_core::Interface;

    let _ = window.with_webview(|webview| {
        // SAFETY : `controller()` rend un pointeur COM vivant, détenu par le
        // WebView ; la fermeture s'exécute sur le fil du WebView, seul fil
        // autorisé à l'appeler. Chaque appel est faillible et traité comme tel.
        unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else {
                return;
            };
            let Ok(settings) = core.Settings() else {
                return;
            };
            // ICoreWebView2Settings4 date de la version 89 du runtime : sur un
            // poste plus ancien, le transtypage échoue et on n'a rien coupé.
            let Ok(settings) = settings.cast::<ICoreWebView2Settings4>() else {
                return;
            };
            let _ = settings.SetIsGeneralAutofillEnabled(false);
            let _ = settings.SetIsPasswordAutosaveEnabled(false);
        }
    });
}

#[cfg(not(windows))]
fn couper_suggestions_de_saisie(_window: &tauri::WebviewWindow) {
    // Réglage propre à WebView2 ; les autres moteurs n'ont pas d'équivalent ici.
}

/// Signale une erreur fatale survenue **avant** la création de la fenêtre.
///
/// En release, `windows_subsystem = "windows"` supprime la console : sans boîte de
/// dialogue native, l'application disparaîtrait sans le moindre message. On ne peut
/// pas utiliser une page d'erreur HTML ici — la panne à couvrir inclut précisément
/// le cas où le WebView ne démarre pas.
fn fatal(message: &str) {
    // Journalisé d'abord : la boîte de dialogue se ferme et son texte est
    // perdu, alors que c'est le seul message qu'ait vu l'enseignant. Si
    // l'échec vient de `portable::resolve`, le journal n'a pas de dossier et
    // cet appel ne fait rien — la boîte reste alors la seule trace.
    journal::erreur("démarrage", message);
    eprintln!("SGPA — démarrage impossible\n\n{message}");
    show_dialog(message);
}

#[cfg(windows)]
fn show_dialog(message: &str) {
    use std::ffi::OsStr;
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(once(0)).collect()
    }

    let text = wide(message);
    let title = wide("SGPA — démarrage impossible");
    // SAFETY : les deux chaînes sont terminées par un zéro et vivent jusqu'au retour
    // de l'appel ; un HWND nul est valide et donne une boîte sans fenêtre parente.
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

#[cfg(not(windows))]
fn show_dialog(_message: &str) {
    // Sur les autres plateformes, stderr suffit : elles n'ont pas d'équivalent de
    // windows_subsystem="windows" qui masquerait la sortie.
}
