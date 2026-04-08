import { invoke } from "@tauri-apps/api/core";
import type {
	User,
	Session,
	Student,
	Cycle,
	Domain,
	Field,
	Competency,
	Seance,
	AttendanceWithStudent,
	Evaluation,
	CompetencyInfo,
	Grade,
	ContractSheet,
	StudentReport,
} from "@/types";

// ---- Auth ----
export const api = {
	// Auth
	login: (username: string, password: string) =>
		invoke<User>("login", { username, password }),

	register: (username: string, password: string, displayName: string) =>
		invoke<User>("register", { username, password, displayName }),

	getUsers: () => invoke<User[]>("get_users"),

	// Sessions
	getSessions: (userId: string) =>
		invoke<Session[]>("get_sessions", { userId }),

	createSession: (userId: string, name: string) =>
		invoke<Session>("create_session", { userId, name }),

	updateSession: (id: string, name: string) =>
		invoke<void>("update_session", { id, name }),

	deleteSession: (id: string) => invoke<void>("delete_session", { id }),

	// Students
	getStudents: (sessionId: string) =>
		invoke<Student[]>("get_students", { sessionId }),

	createStudent: (sessionId: string, firstName: string, lastName: string) =>
		invoke<Student>("create_student", { sessionId, firstName, lastName }),

	updateStudent: (id: string, firstName: string, lastName: string) =>
		invoke<void>("update_student", { id, firstName, lastName }),

	deleteStudent: (id: string) => invoke<void>("delete_student", { id }),

	// Cycles
	getCycles: (userId: string) => invoke<Cycle[]>("get_cycles", { userId }),

	createCycle: (userId: string, name: string) =>
		invoke<Cycle>("create_cycle", { userId, name }),

	updateCycle: (id: string, name: string) =>
		invoke<void>("update_cycle", { id, name }),

	deleteCycle: (id: string) => invoke<void>("delete_cycle", { id }),

	// Domains
	getDomains: (cycleId: string) =>
		invoke<Domain[]>("get_domains", { cycleId }),

	createDomain: (cycleId: string, name: string) =>
		invoke<Domain>("create_domain", { cycleId, name }),

	updateDomain: (id: string, name: string) =>
		invoke<void>("update_domain", { id, name }),

	deleteDomain: (id: string) => invoke<void>("delete_domain", { id }),

	// Fields
	getFields: (domainId: string) =>
		invoke<Field[]>("get_fields", { domainId }),

	createField: (domainId: string, name: string) =>
		invoke<Field>("create_field", { domainId, name }),

	updateField: (id: string, name: string) =>
		invoke<void>("update_field", { id, name }),

	deleteField: (id: string) => invoke<void>("delete_field", { id }),

	// Competencies
	getCompetencies: (fieldId: string) =>
		invoke<Competency[]>("get_competencies", { fieldId }),

	createCompetency: (fieldId: string, name: string) =>
		invoke<Competency>("create_competency", { fieldId, name }),

	updateCompetency: (id: string, name: string) =>
		invoke<void>("update_competency", { id, name }),

	deleteCompetency: (id: string) => invoke<void>("delete_competency", { id }),

	// Séances
	getSeances: (sessionId: string) =>
		invoke<Seance[]>("get_seances", { sessionId }),

	createSeance: (
		sessionId: string,
		title: string,
		startDate: string | null,
		endDate: string | null,
	) =>
		invoke<Seance>("create_seance", {
			sessionId,
			title,
			startDate,
			endDate,
		}),

	updateSeance: (
		id: string,
		title: string,
		startDate: string | null,
		endDate: string | null,
		contentHtml: string,
	) =>
		invoke<void>("update_seance", {
			id,
			title,
			startDate,
			endDate,
			contentHtml,
		}),

	deleteSeance: (id: string) => invoke<void>("delete_seance", { id }),

	// Attendance
	getAttendance: (seanceId: string) =>
		invoke<AttendanceWithStudent[]>("get_attendance", { seanceId }),

	setAttendance: (seanceId: string, studentId: string, status: string) =>
		invoke<void>("set_attendance", { seanceId, studentId, status }),

	setBulkAttendance: (seanceId: string, records: [string, string][]) =>
		invoke<void>("set_bulk_attendance", { seanceId, records }),

	// Evaluations
	getEvaluations: (sessionId: string) =>
		invoke<Evaluation[]>("get_evaluations", { sessionId }),

	createEvaluation: (
		sessionId: string,
		title: string,
		schoolYear: string,
		trimester: number,
		competencyIds: string[],
	) =>
		invoke<Evaluation>("create_evaluation", {
			sessionId,
			title,
			schoolYear,
			trimester,
			competencyIds,
		}),

	updateEvaluation: (
		id: string,
		title: string,
		schoolYear: string,
		trimester: number,
		competencyIds: string[],
	) =>
		invoke<void>("update_evaluation", {
			id,
			title,
			schoolYear,
			trimester,
			competencyIds,
		}),

	deleteEvaluation: (id: string) => invoke<void>("delete_evaluation", { id }),

	getEvaluationCompetencies: (evaluationId: string) =>
		invoke<CompetencyInfo[]>("get_evaluation_competencies", {
			evaluationId,
		}),

	// Grades
	getGrades: (evaluationId: string) =>
		invoke<Grade[]>("get_grades", { evaluationId }),

	setGrade: (
		evaluationId: string,
		studentId: string,
		competencyId: string,
		level: number,
	) =>
		invoke<void>("set_grade", {
			evaluationId,
			studentId,
			competencyId,
			level,
		}),

	// Contract Sheets
	getContractSheet: (evaluationId: string) =>
		invoke<ContractSheet | null>("get_contract_sheet", { evaluationId }),

	saveContractSheet: (
		evaluationId: string,
		projectTitle: string,
		professionalField: string,
		socleDomain: string,
		referenceActivities: string,
		targetCareers: string,
		givenText: string,
		askedText: string,
		requiredText: string,
		rows: [string, string, string, string][],
	) =>
		invoke<ContractSheet>("save_contract_sheet", {
			evaluationId,
			projectTitle,
			professionalField,
			socleDomain,
			referenceActivities,
			targetCareers,
			givenText,
			askedText,
			requiredText,
			rows,
		}),

	getProfessionalFields: (userId: string) =>
		invoke<[string, string][]>("get_professional_fields", { userId }),

	createProfessionalField: (userId: string, name: string) =>
		invoke<[string, string]>("create_professional_field", { userId, name }),

	// Reports
	getReport: (sessionId: string, schoolYear: string, trimester: number) =>
		invoke<StudentReport[]>("get_report", {
			sessionId,
			schoolYear,
			trimester,
		}),

	saveReportComment: (
		studentId: string,
		schoolYear: string,
		trimester: number,
		teacherComment: string,
	) =>
		invoke<void>("save_report_comment", {
			studentId,
			schoolYear,
			trimester,
			teacherComment,
		}),
};
