use rusqlite::Connection;
use std::path::PathBuf;

/// Get the portable database path relative to the executable.
/// This ensures the DB lives next to the .exe for USB portability.
pub fn get_db_path() -> PathBuf {
    let exe_path = std::env::current_exe().expect("Failed to get executable path");
    let exe_dir = exe_path
        .parent()
        .expect("Failed to get executable directory");
    let data_dir = exe_dir.join("data");
    std::fs::create_dir_all(&data_dir).expect("Failed to create data directory");
    data_dir.join("sgpa.db")
}

/// Open (or create) the SQLite database and apply migrations.
pub fn init_db() -> Connection {
    let db_path = get_db_path();
    let conn = Connection::open(&db_path).expect("Failed to open database");

    // Enable WAL mode for better concurrent access
    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .expect("Failed to set WAL mode");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("Failed to enable foreign keys");

    run_migrations(&conn);
    conn
}

fn run_migrations(conn: &Connection) {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            display_name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS cycles (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS domains (
            id TEXT PRIMARY KEY,
            cycle_id TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS fields (
            id TEXT PRIMARY KEY,
            domain_id TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS competencies (
            id TEXT PRIMARY KEY,
            field_id TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS students (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS seances (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            title TEXT NOT NULL,
            start_date TEXT,
            end_date TEXT,
            content_html TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS attendance_records (
            id TEXT PRIMARY KEY,
            seance_id TEXT NOT NULL,
            student_id TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('present', 'absent', 'retard', 'excuse')),
            FOREIGN KEY (seance_id) REFERENCES seances(id) ON DELETE CASCADE,
            FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
            UNIQUE(seance_id, student_id)
        );

        CREATE TABLE IF NOT EXISTS evaluations (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            title TEXT NOT NULL,
            school_year TEXT NOT NULL CHECK(school_year IN ('4eme', '3eme')),
            trimester INTEGER NOT NULL CHECK(trimester IN (1, 2, 3)),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS evaluation_competencies (
            evaluation_id TEXT NOT NULL,
            competency_id TEXT NOT NULL,
            PRIMARY KEY (evaluation_id, competency_id),
            FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE,
            FOREIGN KEY (competency_id) REFERENCES competencies(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS grades (
            id TEXT PRIMARY KEY,
            evaluation_id TEXT NOT NULL,
            student_id TEXT NOT NULL,
            competency_id TEXT NOT NULL,
            level INTEGER NOT NULL DEFAULT 0 CHECK(level >= 0 AND level <= 5),
            comment TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE,
            FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
            FOREIGN KEY (competency_id) REFERENCES competencies(id) ON DELETE CASCADE,
            UNIQUE(evaluation_id, student_id, competency_id)
        );

        CREATE TABLE IF NOT EXISTS contract_sheets (
            id TEXT PRIMARY KEY,
            evaluation_id TEXT NOT NULL UNIQUE,
            project_title TEXT NOT NULL DEFAULT '',
            professional_field TEXT NOT NULL DEFAULT '',
            socle_domain TEXT NOT NULL DEFAULT '',
            reference_activities TEXT NOT NULL DEFAULT '',
            target_careers TEXT NOT NULL DEFAULT '',
            given_text TEXT NOT NULL DEFAULT '',
            asked_text TEXT NOT NULL DEFAULT '',
            required_text TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS contract_sheet_rows (
            id TEXT PRIMARY KEY,
            contract_sheet_id TEXT NOT NULL,
            row_order INTEGER NOT NULL DEFAULT 0,
            student_activity TEXT NOT NULL DEFAULT '',
            training_activity TEXT NOT NULL DEFAULT '',
            socle_domain_text TEXT NOT NULL DEFAULT '',
            socle_competency_text TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (contract_sheet_id) REFERENCES contract_sheets(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS professional_fields (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS report_comments (
            id TEXT PRIMARY KEY,
            student_id TEXT NOT NULL,
            school_year TEXT NOT NULL,
            trimester INTEGER NOT NULL,
            teacher_comment TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
            UNIQUE(student_id, school_year, trimester)
        );
        ",
    )
    .expect("Failed to run migrations");
}
