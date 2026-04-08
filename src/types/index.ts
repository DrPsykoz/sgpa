// ---- Auth ----
export interface User {
	id: string;
	username: string;
	display_name: string;
	created_at: string;
}

// ---- Sessions ----
export interface Session {
	id: string;
	user_id: string;
	name: string;
	created_at: string;
	student_count: number;
}

// ---- Students ----
export interface Student {
	id: string;
	session_id: string;
	first_name: string;
	last_name: string;
	created_at: string;
}

// ---- Cycles / Domaines / Champs / Compétences ----
export interface Cycle {
	id: string;
	user_id: string;
	name: string;
}

export interface Domain {
	id: string;
	cycle_id: string;
	name: string;
}

export interface Field {
	id: string;
	domain_id: string;
	name: string;
}

export interface Competency {
	id: string;
	field_id: string;
	name: string;
}

// ---- Séances ----
export interface Seance {
	id: string;
	session_id: string;
	title: string;
	start_date: string | null;
	end_date: string | null;
	content_html: string;
	created_at: string;
}

// ---- Présences ----
export type AttendanceStatus = "present" | "absent" | "retard" | "excuse";

export interface AttendanceRecord {
	id: string;
	seance_id: string;
	student_id: string;
	status: AttendanceStatus;
}

export interface AttendanceWithStudent {
	id: string | null;
	seance_id: string;
	student_id: string;
	student_first_name: string;
	student_last_name: string;
	status: AttendanceStatus;
}

// ---- Évaluations ----
export type SchoolYear = "4eme" | "3eme";

export interface Evaluation {
	id: string;
	session_id: string;
	title: string;
	school_year: SchoolYear;
	trimester: 1 | 2 | 3;
	created_at: string;
	competency_ids: string[];
}

export interface CompetencyInfo {
	id: string;
	name: string;
	field_name: string;
	domain_name: string;
	cycle_name: string;
}

// ---- Notes ----
export type MasteryLevel = 0 | 1 | 2 | 3 | 4 | 5;

export const MASTERY_LABELS: Record<MasteryLevel, string> = {
	0: "Non évalué",
	1: "Maîtrise insuffisante",
	2: "Maîtrise fragile",
	3: "Presque maîtrisé",
	4: "Maîtrise satisfaisante",
	5: "Très bonne maîtrise",
};

export const MASTERY_COLORS: Record<MasteryLevel, string> = {
	0: "bg-gray-200 text-gray-600",
	1: "bg-red-100 text-red-700",
	2: "bg-orange-100 text-orange-700",
	3: "bg-yellow-100 text-yellow-700",
	4: "bg-green-100 text-green-700",
	5: "bg-emerald-100 text-emerald-800",
};

export interface Grade {
	id: string;
	evaluation_id: string;
	student_id: string;
	competency_id: string;
	level: MasteryLevel;
	comment: string;
}

// ---- Fiches Contrat ----
export interface ContractSheet {
	id: string;
	evaluation_id: string;
	project_title: string;
	professional_field: string;
	socle_domain: string;
	reference_activities: string;
	target_careers: string;
	given_text: string;
	asked_text: string;
	required_text: string;
}

export interface ContractSheetRow {
	id: string;
	contract_sheet_id: string;
	row_order: number;
	student_activity: string;
	training_activity: string;
	socle_domain_text: string;
	socle_competency_text: string;
}

// ---- Bilans ----
export interface ReportComment {
	id: string;
	student_id: string;
	school_year: string;
	trimester: number;
	teacher_comment: string;
}

export interface StudentReport {
	student_id: string;
	student_first_name: string;
	student_last_name: string;
	competency_averages: CompetencyAverage[];
	overall_average: number;
	attendance_stats: AttendanceStats;
	teacher_comment: string;
}

export interface CompetencyAverage {
	competency_id: string;
	competency_name: string;
	field_name: string;
	domain_name: string;
	average_level: number;
	grade_count: number;
}

export interface AttendanceStats {
	total_seances: number;
	present: number;
	absent: number;
	retard: number;
	excuse: number;
}
