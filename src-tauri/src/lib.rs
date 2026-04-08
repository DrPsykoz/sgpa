mod commands;
mod db;

use commands::{auth, contracts, cycles, evaluations, reports, seances, sessions, students};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize the database on startup
    db::init_db();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            // Auth
            auth::login,
            auth::register,
            auth::get_users,
            // Sessions
            sessions::get_sessions,
            sessions::create_session,
            sessions::update_session,
            sessions::delete_session,
            // Students
            students::get_students,
            students::create_student,
            students::update_student,
            students::delete_student,
            // Cycles
            cycles::get_cycles,
            cycles::create_cycle,
            cycles::update_cycle,
            cycles::delete_cycle,
            // Domains
            cycles::get_domains,
            cycles::create_domain,
            cycles::update_domain,
            cycles::delete_domain,
            // Fields
            cycles::get_fields,
            cycles::create_field,
            cycles::update_field,
            cycles::delete_field,
            // Competencies
            cycles::get_competencies,
            cycles::create_competency,
            cycles::update_competency,
            cycles::delete_competency,
            // Séances
            seances::get_seances,
            seances::create_seance,
            seances::update_seance,
            seances::delete_seance,
            // Attendance
            seances::get_attendance,
            seances::set_attendance,
            seances::set_bulk_attendance,
            // Evaluations
            evaluations::get_evaluations,
            evaluations::create_evaluation,
            evaluations::update_evaluation,
            evaluations::delete_evaluation,
            evaluations::get_evaluation_competencies,
            evaluations::get_grades,
            evaluations::set_grade,
            // Contract Sheets
            contracts::get_contract_sheet,
            contracts::save_contract_sheet,
            contracts::get_professional_fields,
            contracts::create_professional_field,
            // Reports
            reports::get_report,
            reports::save_report_comment,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
