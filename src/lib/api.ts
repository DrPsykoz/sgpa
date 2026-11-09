import { invoke } from "@tauri-apps/api/core";
import { journaliserEchecDeCommande } from "@/lib/journal";
import type {
	AbsencePeriod,
	AbsencePeriodInput,
	AgendaEntry,
	AgendaEntrySummary,
	AppSettings,
	Attachment,
	AttachmentContent,
	AttendanceInput,
	AttendanceWithStudent,
	BackupInfo,
	BulkResult,
	CompetencyInfo,
	ContractSheet,
	ContractSheetInput,
	ContractSuggestion,
	CycleNode,
	JournalInfo,
	DaySchedule,
	Evaluation,
	Grade,
	HomeOverview,
	LevelCode,
	LockStatus,
	NeedTag,
	NodeKind,
	ProfessionalField,
	Progression,
	ProgressionDomaine,
	ProgressionEtape,
	RecomputePreview,
	RecomputeResult,
	Seance,
	Session,
	SessionReport,
	SetupResult,
	Student,
	StudentDeletionImpact,
	StudentNeeds,
	TeacherAbsenceInput,
	TimetableSlot,
	TimetableSlotInput,
	TrimesterBounds,
	WeekSchedule,
	YearCalendar,
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
		// Seul le NOM de la commande part au journal, jamais le message : des
		// messages d'erreur du backend interpolent une valeur de la base, et
		// l'un d'eux nomme un élève. `log_command_failure` n'a d'ailleurs aucun
		// paramètre où un message pourrait se glisser. Voir `lib/journal.ts`.
		journaliserEchecDeCommande(command);
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

	/** Déverrouille par le code PIN de ce poste.
	 *
	 *  Ce n'est pas un second mot de passe : six chiffres ne protégeraient rien
	 *  seuls. L'autre moitié du secret est restée sur cet ordinateur, dans le
	 *  profil Windows, et ne suit pas la clé USB — d'où le `pin_available` de
	 *  `LockStatus`, qui vaut faux partout ailleurs. Dix essais manqués
	 *  désactivent le PIN de ce poste et renvoient au mot de passe. */
	unlockWithPin: (pin: string) => call<LockStatus>("unlock_with_pin", { pin }),

	/** Active le code PIN sur ce poste.
	 *
	 *  Le mot de passe est redemandé parce qu'il est le seul moyen d'atteindre
	 *  la clé maître : la session ouverte ne la garde pas en mémoire. */
	enablePin: (password: string, pin: string) =>
		call<LockStatus>("enable_pin", { password, pin }),

	/** « Oublier ce poste » : efface le secret rangé sur cet ordinateur, puis
	 *  l'enveloppe correspondante. Changer le mot de passe ne suffit PAS à
	 *  retirer un PIN — la clé maître ne bouge pas — c'est ici que ça se fait. */
	disablePin: () => call<LockStatus>("disable_pin"),

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
	createSeanceFromSlot: (
		slotId: string,
		date: string,
		cancelled: boolean,
		/** Motif de « ce cours n'a pas lieu ». Ignoré côté backend quand
		 *  `cancelled` est faux, et **non écrasé** si la séance existe déjà : le
		 *  `ON CONFLICT DO NOTHING` protège la ligne en place. */
		cancelReason = "",
	) =>
		call<Seance>("create_seance_from_slot", {
			slotId,
			date,
			cancelled,
			cancelReason,
		}),

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
		/** Motif d'annulation. Le backend le vide dès que `cancelled` est faux :
		 *  une séance qui a lieu n'a pas de raison de ne pas avoir eu lieu. */
		cancelReason = "",
	) =>
		call<Seance>("update_seance_meta", {
			id,
			title,
			date,
			startTime,
			endTime,
			trimester,
			cancelled,
			cancelReason,
		}),

	/** Cahier de texte seul — n'écrit JAMAIS le titre ni la date. */
	updateSeanceContent: (id: string, contentHtml: string) =>
		call<void>("update_seance_content", { id, contentHtml }),

	/** Déclarer — ou retirer — le « rien à écrire » d'une séance.
	 *
	 *  Troisième commande et non paramètre des deux autres : elle n'écrit QUE
	 *  `content_waived_at`. Passer par `updateSeanceContent` aurait fait réécrire
	 *  le brouillon affiché par-dessus la saisie en cours. */
	setSeanceContentWaived: (id: string, waived: boolean) =>
		call<void>("set_seance_content_waived", { id, waived }),

	deleteSeance: (id: string) => call<void>("delete_seance", { id }),

	// ---- Besoins particuliers des élèves ----

	/** Le vocabulaire de l'enseignant, avec le nombre d'élèves par étiquette. */
	getNeedTags: () => call<NeedTag[]>("get_need_tags"),

	/** Crée l'étiquette, ou rend celle qui porte déjà ce libellé (insensible à la
	 *  casse) : retaper « AESH » doit retrouver AESH, pas échouer. */
	createNeedTag: (label: string, shortLabel: string) =>
		call<NeedTag>("create_need_tag", { label, shortLabel }),

	updateNeedTag: (id: string, label: string, shortLabel: string) =>
		call<void>("update_need_tag", { id, label, shortLabel }),

	/** Retire l'étiquette du vocabulaire ET de tous les élèves qui la portent. */
	deleteNeedTag: (id: string) => call<void>("delete_need_tag", { id }),

	/** Les besoins de toute une classe, d'un seul appel. Les élèves sans
	 *  étiquette ni note n'y figurent pas : indexer par `student_id` et traiter
	 *  l'absence comme « rien à signaler ». */
	getSessionNeeds: (sessionId: string) =>
		call<StudentNeeds[]>("get_session_needs", { sessionId }),

	/** Remplace l'ensemble des étiquettes d'un élève. **N'écrit pas la note.** */
	setStudentNeeds: (studentId: string, tagIds: string[]) =>
		call<void>("set_student_needs", { studentId, tagIds }),

	/** Note libre seule — n'écrit JAMAIS les étiquettes. */
	updateStudentNeedsNote: (studentId: string, note: string) =>
		call<void>("update_student_needs_note", { studentId, note }),

	// ---- Pièces jointes d'un compte rendu ----
	//
	// Deux familles, une seule logique côté Rust (`commands/attachments.rs`) :
	// même plafond, même nom assaini, même export en clair. Dix enveloppes
	// plutôt qu'un paramètre « type de porteur » — le nom de l'appel dit ce
	// qu'il touche, et `Attachments` les choisit par son prop `porteur`.

	/** Liste les pièces d'une séance, **sans leurs octets**. */
	getSeanceAttachments: (seanceId: string) =>
		call<Attachment[]>("get_seance_attachments", { seanceId }),

	/** Joint un fichier et rend la pièce créée.
	 *
	 *  `contentBase64` sans en-tête `data:`. Le backend refuse au-delà de
	 *  `MAX_ATTACHMENT_BYTES` octets **décodés** : tester la taille du fichier
	 *  avant d'encoder évite d'en fabriquer 13 Mo de chaîne pour rien. */
	addSeanceAttachment: (
		seanceId: string,
		fileName: string,
		mimeType: string,
		contentBase64: string,
	) =>
		call<Attachment>("add_seance_attachment", {
			seanceId,
			fileName,
			mimeType,
			contentBase64,
		}),

	/** Rend les octets d'UNE pièce, en base64. Le seul appel qui traverse un
	 *  BLOB : à réserver à un geste de l'enseignant (aperçu, ouverture). */
	readSeanceAttachment: (id: string) =>
		call<AttachmentContent>("read_seance_attachment", { id }),

	/** Recopie la pièce dans `<clé>/exports/` et rend son chemin complet.
	 *
	 *  **Cette copie est en clair** : aucune application du poste ne sait lire
	 *  dans une base SQLCipher. Le chemin rendu est fait pour être affiché, pas
	 *  seulement pour confirmer le succès — il y a désormais un fichier à
	 *  effacer. Les octets ne traversent pas l'IPC : ils vont de la base au
	 *  fichier côté Rust. */
	exportSeanceAttachment: (id: string, openAfter: boolean) =>
		call<string>("export_seance_attachment", { id, openAfter }),

	deleteSeanceAttachment: (id: string) =>
		call<void>("delete_seance_attachment", { id }),

	/** Liste les pièces d'un rendez-vous, **sans leurs octets**. */
	getEntryAttachments: (entryId: string) =>
		call<Attachment[]>("get_entry_attachments", { entryId }),

	/** Joint un fichier à un rendez-vous — le rapport de visite signé, d'abord.
	 *
	 *  Mêmes règles qu'une séance : plafond sur les octets décodés, nom assaini
	 *  côté Rust, images déjà réduites à 1600 px par `Attachments`. */
	addEntryAttachment: (
		entryId: string,
		fileName: string,
		mimeType: string,
		contentBase64: string,
	) =>
		call<Attachment>("add_entry_attachment", {
			entryId,
			fileName,
			mimeType,
			contentBase64,
		}),

	readEntryAttachment: (id: string) =>
		call<AttachmentContent>("read_entry_attachment", { id }),

	exportEntryAttachment: (id: string, openAfter: boolean) =>
		call<string>("export_entry_attachment", { id, openAfter }),

	deleteEntryAttachment: (id: string) =>
		call<void>("delete_entry_attachment", { id }),

	// ---- Emploi du temps ----

	/** Une journée : ses créneaux (avec la séance correspondante si elle existe),
	 *  les séances sans créneau, et les entrées datées.
	 *
	 *  `date` en `AAAA-MM-JJ`. Le trimestre, l'année scolaire, le jour ISO et la
	 *  parité de semaine sont calculés par le backend — ne jamais les recalculer
	 *  ici. */
	/** Les académies pour lesquelles le calendrier embarqué porte des dates.
	 *
	 *  Lue DANS les données, jamais recopiée : une liste administrative
	 *  proposerait des académies sans dates, c'est-à-dire un réglage qui a l'air
	 *  de marcher et ne fait rien. */
	getAvailableAcademies: () => call<string[]>("get_available_academies"),

	// ---- Accueil ----

	/** Les `count` prochains jours **ouvrés** à partir de `from` inclus, samedi et
	 *  dimanche sautés. Un seul appel, et non `count` appels à `getDaySchedule`
	 *  enchaînés : l'appelant n'a pas à savoir quels jours sont ouvrés, ni que le
	 *  1er novembre est férié. Le backend borne `count` à dix. */
	getUpcomingDays: (from: string, count: number) =>
		call<DaySchedule[]>("get_upcoming_days", { from, count }),

	/** Le relevé de l'accueil : trimestre en cours et six groupes de rappels.
	 *
	 *  `today` est passé par le front, comme pour `getDaySchedule` : `date('now')`
	 *  est en UTC côté SQLite, et une consultation le 1er décembre à 00h30 aurait
	 *  relevé le trimestre du 30 novembre. */
	getHomeOverview: (today: string) =>
		call<HomeOverview>("get_home_overview", { today }),

	getDaySchedule: (date: string) =>
		call<DaySchedule>("get_day_schedule", { date }),

	/** Une semaine entière, lundi → dimanche. N'IMPORTE quelle date de la semaine
	 *  est acceptée : elle est ramenée au lundi ISO côté backend. */
	getWeekSchedule: (monday: string) =>
		call<WeekSchedule>("get_week_schedule", { monday }),

	/** L'année scolaire entière, semaine par semaine — la frise annuelle.
	 *
	 *  Les semaines sont les **vraies** : quarante-cinq pour 2026-2027, dont
	 *  plusieurs amputées par un férié et plusieurs vides. Les bornes viennent des
	 *  trimestres réglés, pas d'un septembre-juillet écrit dans le code.
	 *
	 *  **Aucune écriture ne se branche derrière cette lecture** : la vue annuelle
	 *  montre, la fiche de classe modifie. */
	getYearCalendar: (yearStart: number) =>
		call<YearCalendar>("get_year_calendar", { yearStart }),

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
	 *  s'affiche alors hors de la grille horaire.
	 *
	 *  `sessionId` et `studentId` sont tous deux facultatifs : un conseil de classe
	 *  nomme une classe sans élève, une réunion de secteur ne nomme ni l'un ni
	 *  l'autre. Quand un élève est désigné, le backend enregistre SA classe et
	 *  **refuse** un `sessionId` qui la contredirait — passer `null` est donc la
	 *  bonne façon de dire « celle de l'élève », et non une information perdue.
	 *
	 *  `category` est facultative au sens de « `""` est une valeur normale », pas
	 *  au sens TypeScript : le paramètre est obligatoire pour que l'oubli d'un
	 *  appelant soit une erreur de compilation et non une catégorie perdue en
	 *  silence. Trente caractères au plus, bornés par le backend. */
	createAgendaEntry: (
		date: string,
		startTime: string,
		endTime: string,
		title: string,
		category: string,
		sessionId: string | null,
		studentId: string | null,
	) =>
		call<AgendaEntry>("create_agenda_entry", {
			date,
			startTime,
			endTime,
			title,
			category,
			sessionId,
			studentId,
		}),

	getAgendaEntry: (id: string) => call<AgendaEntry>("get_agenda_entry", { id }),

	/** Date, horaire, intitulé, catégorie — ne touche JAMAIS la cible ni le corps
	 *  rédigé.
	 *
	 *  La cible, ce sont les deux : l'élève ET la classe. Immuables après
	 *  création — un rapport écrit sur Jean ne doit pas pouvoir devenir un rapport
	 *  sur Marie, ni le compte rendu du conseil de la 4ème A celui de la 3ème B. */
	updateAgendaEntryMeta: (
		id: string,
		date: string,
		startTime: string,
		endTime: string,
		title: string,
		category: string,
	) =>
		call<AgendaEntry>("update_agenda_entry_meta", {
			id,
			date,
			startTime,
			endTime,
			title,
			category,
		}),

	/** Corps rédigé seul — n'écrit JAMAIS l'en-tête de l'entrée. */
	updateAgendaEntryContent: (id: string, contentHtml: string) =>
		call<void>("update_agenda_entry_content", { id, contentHtml }),

	/** Déclarer — ou retirer — le « rien à écrire » d'un rendez-vous.
	 *
	 *  Troisième écriture, comme pour une séance : elle n'écrit QUE
	 *  `content_waived_at`, parce que l'écran du compte rendu détient un
	 *  brouillon et que passer par `updateAgendaEntryContent` l'aurait réécrit
	 *  par-dessus la saisie en cours. */
	setAgendaEntryContentWaived: (id: string, waived: boolean) =>
		call<void>("set_agenda_entry_content_waived", { id, waived }),

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

	/** Noter une **absence du professeur** sur une ou plusieurs classes à la fois.
	 *
	 *  Commande distincte de `createAbsencePeriod`, et pas un champ de plus : le
	 *  backend écrit `teacher_absent = 1`, `attendance_expected = 0` et
	 *  `student_id = NULL` en dur, si bien qu'aucun appelant ne peut produire une
	 *  absence du professeur « avec appel » ou visant un seul élève.
	 *
	 *  Tout ou rien, en une transaction : si une classe cochée a déjà une période
	 *  qui recouvre ces dates, rien n'est écrit et le message la nomme. Rend les
	 *  lignes créées, une par classe — il n'y a pas d'entité « absence groupée ». */
	createTeacherAbsencePeriods: (absence: TeacherAbsenceInput) =>
		call<AbsencePeriod[]>("create_teacher_absence_periods", { absence }),

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
		mark: number,
	) =>
		call<void>("set_grade", {
			evaluationId,
			studentId,
			competencyId,
			mark,
		}),

	/** Efface une note : la case redevient vierge, donc « non évaluée ».
	 *  Commande distincte de `setGrade` et non un `setGrade(…, 0)` — 0 n'est
	 *  plus une note, et effacer ne doit pas pouvoir arriver par débordement
	 *  d'une autre saisie. */
	deleteGrade: (
		evaluationId: string,
		studentId: string,
		competencyId: string,
	) =>
		call<void>("delete_grade", {
			evaluationId,
			studentId,
			competencyId,
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

	/** Compose une fiche depuis l'évaluation sans rien écrire : titre, classe et
	 *  une ligne par compétence notée. C'est à l'écran de l'adopter. */
	suggestContractSheet: (evaluationId: string) =>
		call<ContractSuggestion>("suggest_contract_sheet", { evaluationId }),

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

	// ---- Progression annuelle ----

	/** Le vocabulaire de l'enseignant, dans son ordre. **Livré vide.** */
	getProgressionDomaines: () =>
		call<ProgressionDomaine[]>("get_progression_domaines"),

	createProgressionDomaine: (name: string) =>
		call<ProgressionDomaine>("create_progression_domaine", { name }),

	renameProgressionDomaine: (id: string, name: string) =>
		call<void>("rename_progression_domaine", { id, name }),

	/** **Refuse** si le domaine est encore employé, en disant par combien
	 *  d'activités. Un domaine supprimé sous ses activités les laisserait sans
	 *  couleur ni colonne — mieux vaut un refus nommé qu'un détachement muet. */
	deleteProgressionDomaine: (id: string) =>
		call<void>("delete_progression_domaine", { id }),

	/** La progression de la classe, ou `null` si elle n'en a pas encore.
	 *
	 *  `null` n'est pas une erreur : c'est l'état d'une classe dont l'année n'est
	 *  pas encore plannifiée, et cette lecture n'en crée aucune — c'est à l'écran
	 *  de proposer `createProgression`. */
	getProgression: (sessionId: string) =>
		call<Progression | null>("get_progression", { sessionId }),

	/** Une seule progression par classe : un second appel échoue. */
	createProgression: (sessionId: string) =>
		call<Progression>("create_progression", { sessionId }),

	/** L'en-tête imprimé : titre, intitulé de groupe, devise. N'écrit ni étape ni
	 *  activité ni plage. */
	updateProgressionMeta: (
		id: string,
		titre: string,
		intituleGroupe: string,
		devise: string,
	) =>
		call<void>("update_progression_meta", {
			id,
			titre,
			intituleGroupe,
			devise,
		}),

	createProgressionEtape: (progressionId: string, libelle: string) =>
		call<ProgressionEtape>("create_progression_etape", {
			progressionId,
			libelle,
		}),

	/** Le formulaire d'une étape en entier : ses champs et ses compétences.
	 *
	 *  Ce n'est pas la règle « deux écritures sont deux commandes » qui plie : ce
	 *  sont les champs d'un seul formulaire, saisi d'un bloc par un seul écran.
	 *  La règle vise deux écrans qui écrivent chacun la moitié d'une ligne sans
	 *  avoir rafraîchi l'autre — il n'y en a qu'un ici. Le backend écrit la ligne
	 *  et les rattachements dans **une transaction**, donc une compétence
	 *  disparue du référentiel annule tout l'enregistrement au lieu de laisser
	 *  une étape renommée sans ses compétences.
	 *
	 *  **`competences` est le texte libre d'avant le palier 021, et il
	 *  transite** : tout appelant le fait passer inchangé, comme l'horaire dans
	 *  `updateSeanceMeta`. Seul le bouton qui l'efface envoie `""`. */
	updateProgressionEtape: (
		id: string,
		libelle: string,
		competences: string,
		connaissances: string,
		priorites: string,
		competencyIds: string[],
	) =>
		call<void>("update_progression_etape", {
			id,
			libelle,
			competences,
			connaissances,
			priorites,
			competencyIds,
		}),

	/** Emporte ses activités **et leurs plages** : la base tient la cascade, pas
	 *  l'écran. */
	deleteProgressionEtape: (id: string) =>
		call<void>("delete_progression_etape", { id }),

	/** L'ordre des étapes est l'ordre de l'année : le changer **recolorie** les
	 *  activités, dont le rang en dépend. Relire la progression après. */
	reorderProgressionEtapes: (progressionId: string, orderedIds: string[]) =>
		call<void>("reorder_progression_etapes", { progressionId, orderedIds }),

	/** Ne rend rien, exprès : ajouter une activité change le rang de toutes celles
	 *  qui suivent, donc leur couleur. L'écran relit la progression entière. */
	createProgressionActivite: (
		etapeId: string,
		libelle: string,
		domaineId: string | null,
	) =>
		call<void>("create_progression_activite", {
			etapeId,
			libelle,
			domaineId,
		}),

	updateProgressionActivite: (
		id: string,
		libelle: string,
		domaineId: string | null,
	) =>
		call<void>("update_progression_activite", { id, libelle, domaineId }),

	/** Emporte ses plages : une case de frise sans activité ne s'afficherait
	 *  nulle part et ne se retirerait donc jamais. */
	deleteProgressionActivite: (id: string) =>
		call<void>("delete_progression_activite", { id }),

	reorderProgressionActivites: (etapeId: string, orderedIds: string[]) =>
		call<void>("reorder_progression_activites", { etapeId, orderedIds }),

	/** Déplace une activité d'une étape à l'autre. **Refuse** une étape d'une
	 *  autre progression : le couple contradictoire n'est pas rectifié en
	 *  silence, parce qu'une rectification muette masquerait le défaut d'écran qui
	 *  l'a produit. */
	setProgressionActiviteEtape: (id: string, etapeId: string) =>
		call<void>("set_progression_activite_etape", { id, etapeId }),

	/** Pose une activité sur PLUSIEURS semaines d'un coup, sur une bande.
	 *
	 *  Au pluriel et en une transaction : peindre huit semaines à la souris est un
	 *  seul geste, et huit appels auraient laissé une frise à moitié peinte en cas
	 *  d'échec au cinquième. Chaque semaine se désigne par son **lundi** — une
	 *  autre date est refusée, pas arrondie. */
	setProgressionPlages: (
		progressionId: string,
		weekMondays: string[],
		voie: 0 | 1,
		activiteId: string,
	) =>
		call<void>("set_progression_plages", {
			progressionId,
			weekMondays,
			voie,
			activiteId,
		}),

	/** Efface ces semaines sur cette bande, quelle qu'y soit l'activité. */
	clearProgressionPlages: (
		progressionId: string,
		weekMondays: string[],
		voie: 0 | 1,
	) =>
		call<void>("clear_progression_plages", {
			progressionId,
			weekMondays,
			voie,
		}),

	// ---- Maintenance ----
	createBackup: () => call<BackupInfo>("create_backup"),

	listBackups: () => call<BackupInfo[]>("list_backups"),

	revealDataDir: () => call<void>("reveal_data_dir"),

	/** Écrit le fichier dans `<clé>/exports/` et renvoie son chemin complet. */
	saveExport: (fileName: string, bytes: number[], openAfter: boolean) =>
		call<string>("save_export", { fileName, bytes, openAfter }),

	// ---- Journal de diagnostic ----

	getJournalInfo: () => call<JournalInfo>("get_journal_info"),

	revealLogsDir: () => call<void>("reveal_logs_dir"),
};
