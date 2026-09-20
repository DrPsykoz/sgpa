import { invoke } from "@tauri-apps/api/core";
import type {
	AbsencePeriod,
	AbsencePeriodInput,
	AgendaEntry,
	AgendaEntrySummary,
	AppSettings,
	AttendanceInput,
	AttendanceWithStudent,
	BackupInfo,
	BulkResult,
	CompetencyInfo,
	ContractSheet,
	ContractSheetInput,
	CycleNode,
	DaySchedule,
	Evaluation,
	Grade,
	LevelCode,
	LockStatus,
	NodeKind,
	ProfessionalField,
	RecomputePreview,
	RecomputeResult,
	Seance,
	Session,
	SessionReport,
	SetupResult,
	Student,
	StudentDeletionImpact,
	TimetableSlot,
	TimetableSlotInput,
	TrimesterBounds,
	WeekSchedule,
} from "@/types";

/**
 * Erreur normalisée de toute commande Tauri.
 *
 * Tauri rejette avec la chaîne de `Result::Err`, mais un échec de
 * désérialisation rejette avec autre chose. Sans cette normalisation, un
 * `catch (err) { setError(err as string) }` affiche « [object Object] ».
 */
export class ApiError extends Error {
	constructor(
		public readonly command: string,
		message: string,
	) {
		super(message);
		this.name = "ApiError";
	}
}

async function call<T>(
	command: string,
	args?: Record<string, unknown>,
): Promise<T> {
	try {
		return await invoke<T>(command, args);
	} catch (err) {
		throw new ApiError(command, typeof err === "string" ? err : String(err));
	}
}

export const api = {
	// ---- Verrou, récupération & réglages ----
	getLockStatus: () => call<LockStatus>("get_lock_status"),

	/** Crée `data/sgpa.keys` ET la base chiffrée. La phrase de récupération
	 *  renvoyée ici est la seule occasion de la lire : elle n'est stockée en
	 *  clair nulle part. */
	setupLock: (
		password: string,
		teacherDisplayName: string,
		passwordHint: string,
	) =>
		call<SetupResult>("setup_lock", {
			password,
			teacherDisplayName,
			passwordHint,
		}),

	unlock: (password: string) => call<LockStatus>("unlock", { password }),

	/** Déballe la clé maître par l'enveloppe de récupération, réécrit celle du
	 *  mot de passe, puis ouvre la session. L'ancien mot de passe cesse alors de
	 *  fonctionner ; la phrase, elle, reste valable. */
	recover: (recoveryPhrase: string, newPassword: string) =>
		call<LockStatus>("recover", { recoveryPhrase, newPassword }),

	lock: () => call<void>("lock"),

	changePassword: (current: string, next: string) =>
		call<void>("change_password", { current, next }),

	/** Réécrit l'enveloppe de récupération et renvoie la nouvelle phrase.
	 *  L'ancienne devient inutilisable. */
	regenerateRecovery: (password: string) =>
		call<string>("regenerate_recovery", { password }),

	/** L'indice vit dans `data/sgpa.keys`, hors de la base : il doit être
	 *  lisible alors que la session est encore verrouillée. */
	setPasswordHint: (hint: string) =>
		call<void>("set_password_hint", { hint }),

	getSettings: () => call<AppSettings>("get_settings"),

	updateSettings: (settings: AppSettings) =>
		call<AppSettings>("update_settings", { settings }),

	// ---- Classes ----
	getSessions: () => call<Session[]>("get_sessions"),

	getSession: (id: string) => call<Session>("get_session", { id }),

	createSession: (name: string, levelCode: LevelCode, yearStart: number) =>
		call<Session>("create_session", { name, levelCode, yearStart }),

	updateSession: (
		id: string,
		name: string,
		levelCode: LevelCode,
		yearStart: number,
	) => call<Session>("update_session", { id, name, levelCode, yearStart }),

	deleteSession: (id: string) => call<void>("delete_session", { id }),

	// ---- Élèves ----
	getStudents: (sessionId: string) =>
		call<Student[]>("get_students", { sessionId }),

	createStudent: (
		sessionId: string,
		firstName: string,
		lastName: string,
		enrolledOn: string | null,
	) =>
		call<Student>("create_student", {
			sessionId,
			firstName,
			lastName,
			enrolledOn,
		}),

	createStudentsBulk: (sessionId: string, names: string[]) =>
		call<Student[]>("create_students_bulk", { sessionId, names }),

	updateStudent: (
		id: string,
		firstName: string,
		lastName: string,
		enrolledOn: string,
		leftOn: string | null,
	) =>
		call<Student>("update_student", {
			id,
			firstName,
			lastName,
			enrolledOn,
			leftOn,
		}),

	/** À appeler AVANT `deleteStudent` : la suppression emporte notes, appels,
	 *  appréciations de bulletin, fiches contrat et entrées d'agenda, et la
	 *  confirmation doit le dire. */
	getStudentDeletionImpact: (id: string) =>
		call<StudentDeletionImpact>("get_student_deletion_impact", { id }),

	deleteStudent: (id: string) => call<void>("delete_student", { id }),

	/** Les entrées datées d'un élève, la plus récente d'abord : c'est là qu'on
	 *  cherche un rapport de visite six mois plus tard, pas dans l'emploi du
	 *  temps. */
	getStudentAgendaEntries: (studentId: string) =>
		call<AgendaEntrySummary[]>("get_student_agenda_entries", { studentId }),

	// ---- Référentiel ----
	getReferentialTree: () => call<CycleNode[]>("get_referential_tree"),

	createNodesBulk: (
		kind: NodeKind,
		parentId: string | null,
		names: string[],
	) => call<BulkResult>("create_nodes_bulk", { kind, parentId, names }),

	renameNode: (kind: NodeKind, id: string, name: string) =>
		call<void>("rename_node", { kind, id, name }),

	deleteNode: (kind: NodeKind, id: string) =>
		call<void>("delete_node", { kind, id }),

	reorderNodes: (
		kind: NodeKind,
		parentId: string | null,
		orderedIds: string[],
	) => call<void>("reorder_nodes", { kind, parentId, orderedIds }),

	archiveCompetency: (id: string, archived: boolean) =>
		call<void>("archive_competency", { id, archived }),

	// ---- Séances ----
	getSeances: (sessionId: string) =>
		call<Seance[]>("get_seances", { sessionId }),

	/** Crée une séance **saisie à la main** : celle de la fiche de classe, et le
	 *  cours ponctuel de l'emploi du temps. Elle n'est l'occurrence d'aucun
	 *  créneau (`slot_id` reste `null`), et elle compte, comme toute séance, au
	 *  dénominateur d'assiduité du bilan.
	 *
	 *  `startTime` / `endTime` sont facultatifs : `""` vaut « sans horaire »,
	 *  comme sur `updateSeanceMeta`. Le trimestre vient du backend, dérivé de la
	 *  date ; `trimester` ne sert qu'à le forcer. */
	createSeance: (
		sessionId: string,
		title: string,
		date: string,
		trimester: number | null,
		startTime = "",
		endTime = "",
	) =>
		call<Seance>("create_seance", {
			sessionId,
			title,
			date,
			startTime,
			endTime,
			trimester,
		}),

	/** Fabrique l'occurrence d'un créneau à une date. **Idempotente** : si la
	 *  séance existe déjà, elle est renvoyée telle quelle plutôt que dupliquée.
	 *
	 *  `cancelled = true` = « Ce cours n'a pas lieu » : la séance naît annulée,
	 *  donc hors du dénominateur d'assiduité de toute la classe.
	 *
	 *  Elle vit avec les autres écritures de séance, comme côté backend :
	 *  `seances` garde une porte d'écriture unique. */
	createSeanceFromSlot: (slotId: string, date: string, cancelled: boolean) =>
		call<Seance>("create_seance_from_slot", { slotId, date, cancelled }),

	/** Titre, date, horaire, trimestre, annulation — n'écrit JAMAIS le cahier de
	 *  texte, ni la classe.
	 *
	 *  `startTime` / `endTime` ont été ajoutés au palier 004 : `""` est accepté et
	 *  signifie « sans horaire ». */
	updateSeanceMeta: (
		id: string,
		title: string,
		date: string,
		startTime: string,
		endTime: string,
		trimester: number | null,
		cancelled: boolean,
	) =>
		call<Seance>("update_seance_meta", {
			id,
			title,
			date,
			startTime,
			endTime,
			trimester,
			cancelled,
		}),

	/** Cahier de texte seul — n'écrit JAMAIS le titre ni la date. */
	updateSeanceContent: (id: string, contentHtml: string) =>
		call<void>("update_seance_content", { id, contentHtml }),

	deleteSeance: (id: string) => call<void>("delete_seance", { id }),

	// ---- Emploi du temps ----

	/** Une journée : ses créneaux (avec la séance correspondante si elle existe),
	 *  les séances sans créneau, et les entrées datées.
	 *
	 *  `date` en `AAAA-MM-JJ`. Le trimestre, l'année scolaire, le jour ISO et la
	 *  parité de semaine sont calculés par le backend — ne jamais les recalculer
	 *  ici. */
	getDaySchedule: (date: string) =>
		call<DaySchedule>("get_day_schedule", { date }),

	/** Une semaine entière, lundi → dimanche. N'IMPORTE quelle date de la semaine
	 *  est acceptée : elle est ramenée au lundi ISO côté backend. */
	getWeekSchedule: (monday: string) =>
		call<WeekSchedule>("get_week_schedule", { monday }),

	/** Tous les créneaux d'une année, tous les jours, sans filtre de parité :
	 *  la grille telle qu'on la règle, pas telle qu'on la vit un jour donné. */
	getTimetableSlots: (yearStart: number) =>
		call<TimetableSlot[]>("get_timetable_slots", { yearStart }),

	createTimetableSlot: (yearStart: number, slot: TimetableSlotInput) =>
		call<TimetableSlot>("create_timetable_slot", { yearStart, slot }),

	/** L'année n'est pas modifiable : elle est relue sur la ligne existante. */
	updateTimetableSlot: (id: string, slot: TimetableSlotInput) =>
		call<TimetableSlot>("update_timetable_slot", { id, slot }),

	/** Les séances déjà tenues survivent : leur `slot_id` passe à `null` et leurs
	 *  appels restent intacts. */
	deleteTimetableSlot: (id: string) =>
		call<void>("delete_timetable_slot", { id }),

	/** `startTime` / `endTime` peuvent valoir `""` — « heure à caler » : l'entrée
	 *  s'affiche alors hors de la grille horaire. `studentId` peut être `null`. */
	createAgendaEntry: (
		date: string,
		startTime: string,
		endTime: string,
		title: string,
		studentId: string | null,
	) =>
		call<AgendaEntry>("create_agenda_entry", {
			date,
			startTime,
			endTime,
			title,
			studentId,
		}),

	getAgendaEntry: (id: string) => call<AgendaEntry>("get_agenda_entry", { id }),

	/** Date, horaire, intitulé — ne touche JAMAIS l'élève désigné ni le corps
	 *  rédigé. La cible est immuable après création : un rapport écrit sur Jean ne
	 *  doit pas pouvoir devenir un rapport sur Marie. */
	updateAgendaEntryMeta: (
		id: string,
		date: string,
		startTime: string,
		endTime: string,
		title: string,
	) =>
		call<AgendaEntry>("update_agenda_entry_meta", {
			id,
			date,
			startTime,
			endTime,
			title,
		}),

	/** Corps rédigé seul — n'écrit JAMAIS l'en-tête de l'entrée. */
	updateAgendaEntryContent: (id: string, contentHtml: string) =>
		call<void>("update_agenda_entry_content", { id, contentHtml }),

	deleteAgendaEntry: (id: string) =>
		call<void>("delete_agenda_entry", { id }),

	// ---- Présences ----
	getAttendance: (seanceId: string) =>
		call<AttendanceWithStudent[]>("get_attendance", { seanceId }),

	setAttendance: (seanceId: string, studentId: string, status: string) =>
		call<void>("set_attendance", { seanceId, studentId, status }),

	setBulkAttendance: (seanceId: string, records: AttendanceInput[]) =>
		call<void>("set_bulk_attendance", { seanceId, records }),

	resetAttendance: (seanceId: string) =>
		call<void>("reset_attendance", { seanceId }),

	// ---- Périodes d'absence ----

	/** Les périodes d'une classe, dans l'ordre du calendrier. Chaque ligne porte
	 *  déjà `seance_count`, le nombre de séances qu'elle écarte : l'afficher tel
	 *  quel, une seconde implémentation de la règle divergerait de celle qui
	 *  calcule les bilans. */
	getAbsencePeriods: (sessionId: string) =>
		call<AbsencePeriod[]>("get_absence_periods", { sessionId }),

	/** `period.student_id` à `null` vise toute la classe ; renseigné, il vise un
	 *  élève, qui doit appartenir à cette classe — sinon rien ne serait écarté. */
	createAbsencePeriod: (sessionId: string, period: AbsencePeriodInput) =>
		call<AbsencePeriod>("create_absence_period", { sessionId, period }),

	/** La classe n'est pas modifiable : elle est relue sur la ligne existante.
	 *  L'élève visé, lui, se corrige — c'est la saisie qu'on rate le plus. */
	updateAbsencePeriod: (id: string, period: AbsencePeriodInput) =>
		call<AbsencePeriod>("update_absence_period", { id, period }),

	/** Rétablit les séances écartées dans le dénominateur d'assiduité. Aucune
	 *  séance, aucun appel n'a jamais été touché : rien n'est perdu. */
	deleteAbsencePeriod: (id: string) =>
		call<void>("delete_absence_period", { id }),

	// ---- Évaluations ----
	getEvaluations: (sessionId: string) =>
		call<Evaluation[]>("get_evaluations", { sessionId }),

	createEvaluation: (
		sessionId: string,
		title: string,
		date: string,
		trimester: number | null,
		competencyIds: string[],
	) =>
		call<Evaluation>("create_evaluation", {
			sessionId,
			title,
			date,
			trimester,
			competencyIds,
		}),

	updateEvaluation: (
		id: string,
		title: string,
		date: string,
		trimester: number | null,
		competencyIds: string[],
		deleteOrphanGrades: boolean,
	) =>
		call<Evaluation>("update_evaluation", {
			id,
			title,
			date,
			trimester,
			competencyIds,
			deleteOrphanGrades,
		}),

	deleteEvaluation: (id: string) => call<void>("delete_evaluation", { id }),

	getEvaluationCompetencies: (evaluationId: string) =>
		call<CompetencyInfo[]>("get_evaluation_competencies", { evaluationId }),

	// ---- Notes ----
	getGrades: (evaluationId: string) =>
		call<Grade[]>("get_grades", { evaluationId }),

	setGrade: (
		evaluationId: string,
		studentId: string,
		competencyId: string,
		level: number,
	) =>
		call<void>("set_grade", {
			evaluationId,
			studentId,
			competencyId,
			level,
		}),

	// ---- Trimestres ----
	getTrimesterBounds: (yearStart: number) =>
		call<TrimesterBounds>("get_trimester_bounds", { yearStart }),

	previewTrimesterRecompute: (
		yearStart: number,
		t1Start: string,
		t2Start: string,
		t3Start: string,
		yearEnd: string,
	) =>
		call<RecomputePreview>("preview_trimester_recompute", {
			yearStart,
			t1Start,
			t2Start,
			t3Start,
			yearEnd,
		}),

	updateTrimesterBounds: (
		yearStart: number,
		t1Start: string,
		t2Start: string,
		t3Start: string,
		yearEnd: string,
	) =>
		call<RecomputeResult>("update_trimester_bounds", {
			yearStart,
			t1Start,
			t2Start,
			t3Start,
			yearEnd,
		}),

	// ---- Fiches contrat ----
	getContractSheet: (evaluationId: string) =>
		call<ContractSheet | null>("get_contract_sheet", { evaluationId }),

	saveContractSheet: (evaluationId: string, sheet: ContractSheetInput) =>
		call<ContractSheet>("save_contract_sheet", { evaluationId, sheet }),

	getProfessionalFields: () =>
		call<ProfessionalField[]>("get_professional_fields"),

	createProfessionalField: (name: string) =>
		call<ProfessionalField>("create_professional_field", { name }),

	// ---- Bilans ----
	getReport: (sessionId: string, trimester: number) =>
		call<SessionReport>("get_report", { sessionId, trimester }),

	saveReportComment: (
		studentId: string,
		trimester: number,
		teacherComment: string,
	) =>
		call<void>("save_report_comment", {
			studentId,
			trimester,
			teacherComment,
		}),

	// ---- Maintenance ----
	createBackup: () => call<BackupInfo>("create_backup"),

	listBackups: () => call<BackupInfo[]>("list_backups"),

	revealDataDir: () => call<void>("reveal_data_dir"),

	/** Écrit le fichier dans `<clé>/exports/` et renvoie son chemin complet. */
	saveExport: (fileName: string, bytes: number[], openAfter: boolean) =>
		call<string>("save_export", { fileName, bytes, openAfter }),
};
