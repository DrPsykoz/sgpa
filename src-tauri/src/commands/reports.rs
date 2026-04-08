use crate::db;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StudentReport {
    pub student_id: String,
    pub student_first_name: String,
    pub student_last_name: String,
    pub competency_averages: Vec<CompetencyAverage>,
    pub overall_average: f64,
    pub attendance_stats: AttendanceStats,
    pub teacher_comment: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CompetencyAverage {
    pub competency_id: String,
    pub competency_name: String,
    pub field_name: String,
    pub domain_name: String,
    pub average_level: f64,
    pub grade_count: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AttendanceStats {
    pub total_seances: i32,
    pub present: i32,
    pub absent: i32,
    pub retard: i32,
    pub excuse: i32,
}

#[tauri::command]
pub fn get_report(
    session_id: String,
    school_year: String,
    trimester: i32,
) -> Result<Vec<StudentReport>, String> {
    let conn = db::init_db();

    // Get all students in this session
    let mut student_stmt = conn
        .prepare("SELECT id, first_name, last_name FROM students WHERE session_id = ?1 ORDER BY last_name, first_name")
        .map_err(|e| e.to_string())?;

    let students: Vec<(String, String, String)> = student_stmt
        .query_map(params![session_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut reports = Vec::new();

    for (student_id, first_name, last_name) in &students {
        // Get competency averages for this student in the given year/trimester
        let mut avg_stmt = conn
            .prepare(
                "SELECT c.id, c.name, f.name, d.name, AVG(g.level) as avg_level, COUNT(g.id) as cnt
                 FROM grades g
                 JOIN evaluations e ON e.id = g.evaluation_id
                 JOIN competencies c ON c.id = g.competency_id
                 JOIN fields f ON f.id = c.field_id
                 JOIN domains d ON d.id = f.domain_id
                 WHERE g.student_id = ?1 AND e.session_id = ?2
                   AND e.school_year = ?3 AND e.trimester = ?4
                   AND g.level > 0
                 GROUP BY c.id
                 ORDER BY d.name, f.name, c.name",
            )
            .map_err(|e| e.to_string())?;

        let averages: Vec<CompetencyAverage> = avg_stmt
            .query_map(params![student_id, session_id, school_year, trimester], |row| {
                Ok(CompetencyAverage {
                    competency_id: row.get(0)?,
                    competency_name: row.get(1)?,
                    field_name: row.get(2)?,
                    domain_name: row.get(3)?,
                    average_level: row.get(4)?,
                    grade_count: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let overall = if averages.is_empty() {
            0.0
        } else {
            averages.iter().map(|a| a.average_level).sum::<f64>() / averages.len() as f64
        };

        // Get attendance stats
        let attendance = conn
            .query_row(
                "SELECT
                    COUNT(DISTINCT se.id) as total,
                    COALESCE(SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN ar.status = 'retard' THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN ar.status = 'excuse' THEN 1 ELSE 0 END), 0)
                 FROM seances se
                 LEFT JOIN attendance_records ar ON ar.seance_id = se.id AND ar.student_id = ?1
                 WHERE se.session_id = ?2",
                params![student_id, session_id],
                |row| {
                    Ok(AttendanceStats {
                        total_seances: row.get(0)?,
                        present: row.get(1)?,
                        absent: row.get(2)?,
                        retard: row.get(3)?,
                        excuse: row.get(4)?,
                    })
                },
            )
            .unwrap_or(AttendanceStats {
                total_seances: 0,
                present: 0,
                absent: 0,
                retard: 0,
                excuse: 0,
            });

        // Get teacher comment
        let comment: String = conn
            .query_row(
                "SELECT teacher_comment FROM report_comments
                 WHERE student_id = ?1 AND school_year = ?2 AND trimester = ?3",
                params![student_id, school_year, trimester],
                |row| row.get(0),
            )
            .unwrap_or_default();

        reports.push(StudentReport {
            student_id: student_id.clone(),
            student_first_name: first_name.clone(),
            student_last_name: last_name.clone(),
            competency_averages: averages,
            overall_average: overall,
            attendance_stats: attendance,
            teacher_comment: comment,
        });
    }

    Ok(reports)
}

#[tauri::command]
pub fn save_report_comment(
    student_id: String,
    school_year: String,
    trimester: i32,
    teacher_comment: String,
) -> Result<(), String> {
    let conn = db::init_db();
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO report_comments (id, student_id, school_year, trimester, teacher_comment)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(student_id, school_year, trimester) DO UPDATE SET teacher_comment = ?5",
        params![id, student_id, school_year, trimester, teacher_comment],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
