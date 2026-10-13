// Miroir exact des structs Rust sérialisées (snake_case, aucun serde rename).
// Toute divergence avec src-tauri/src/commands/*.rs est un bug.

// ---- Verrou & réglages ----

/** État du verrou, lisible SANS la base : `configured` vient de la présence de
 *  `data/sgpa.keys` et l'indice de ce même fichier, le seul lisible tant que la
 *  clé maître n'est pas déballée.
 *
 *  Le nom de l'enseignant n'y figure volontairement pas : il vit dans la base
 *  chiffrée, et une clé USB trouvée ne doit pas dire à qui elle appartient. */
export interface LockStatus {
	configured: boolean;
	unlocked: boolean;
	password_hint: string;
}

/** Retour de `setup_lock`. La phrase n'est PAS relisible ensuite : elle n'existe
 *  nulle part en clair, seule l'enveloppe qu'elle ouvre est conservée. */
export interface SetupResult {
	status: LockStatus;
	recovery_phrase: string;
}

export type OverallAverageRule = "unweighted_mean" | "weighted_by_count";
export type RemovedCompetencyPolicy = "keep" | "ignore";

/** `password_hint` n'en fait plus partie : l'indice a quitté la base pour
 *  `data/sgpa.keys`, afin d'être lisible avant tout déverrouillage. Il se lit
 *  dans `LockStatus` et s'écrit par `api.setPasswordHint`. */
export interface AppSettings {
	teacher_display_name: string;
	school_name: string;
	lock_timeout_minutes: number;
	lock_on_minimize: boolean;
	overall_average_rule: OverallAverageRule;
	removed_competency_policy: RemovedCompetencyPolicy;
	/** Académie de l'enseignant. `""` = non renseignée, et c'est le défaut : le
	 *  calendrier n'affiche alors AUCUNE vacance plutôt que celles d'une
	 *  académie au hasard — des dates fausses seraient pires que pas de dates. */
	academie: string;
	last_backup_at: string | null;
}

// ---- Classes (sessions) ----
export type LevelCode = "6eme" | "5eme" | "4eme" | "3eme" | "3eme_prepa";

export const LEVEL_CODES: LevelCode[] = [
	"6eme",
	"5eme",
	"4eme",
	"3eme",
	"3eme_prepa",
];

export const LEVEL_LABELS: Record<LevelCode, string> = {
	"6eme": "6ème",
	"5eme": "5ème",
	"4eme": "4ème",
	"3eme": "3ème",
	"3eme_prepa": "3ème prépa-métiers",
};

/** Une année scolaire commençant en 2021 s'affiche « 2021-2022 ». */
export const schoolYearLabel = (yearStart: number) =>
	`${yearStart}-${yearStart + 1}`;

export interface Session {
	id: string;
	name: string;
	level_code: LevelCode;
	year_start: number;
	created_at: string;
	student_count: number;
}

// ---- Élèves ----
export interface Student {
	id: string;
	session_id: string;
	first_name: string;
	last_name: string;
	enrolled_on: string;
	left_on: string | null;
	created_at: string;
}

/** Ce que la suppression d'un élève détruit réellement, compté AVANT le
 *  `DELETE` : tout part en cascade, et jusqu'ici rien ne l'annonçait.
 *
 *  `written_agenda_entries` est un sous-ensemble d'`agenda_entries` — ce sont
 *  les seules irremplaçables, et c'est ce qu'il faut dire avant de détruire. */
export interface StudentDeletionImpact {
	grades: number;
	attendance_records: number;
	report_comments: number;
	contract_sheets: number;
	agenda_entries: number;
	written_agenda_entries: number;
}

// ---- Référentiel ----
export type NodeKind = "cycle" | "domain" | "field" | "competency";

export const NODE_LABELS: Record<NodeKind, { one: string; many: string }> = {
	cycle: { one: "cycle", many: "cycles" },
	domain: { one: "domaine", many: "domaines" },
	field: { one: "champ", many: "champs" },
	competency: { one: "compétence", many: "compétences" },
};

export interface CompetencyNode {
	id: string;
	name: string;
	position: number;
	archived: boolean;
}

export interface FieldNode {
	id: string;
	name: string;
	position: number;
	competencies: CompetencyNode[];
}

export interface DomainNode {
	id: string;
	name: string;
	position: number;
	fields: FieldNode[];
}

export interface CycleNode {
	id: string;
	name: string;
	position: number;
	domains: DomainNode[];
}

export interface NodeRef {
	id: string;
	name: string;
}

export interface BulkResult {
	created: NodeRef[];
	skipped: string[];
}

// ---- Séances ----
export interface Seance {
	id: string;
	session_id: string;
	title: string;
	date: string;
	trimester: number;
	trimester_is_manual: boolean;
	cancelled: boolean;
	/** Pourquoi ce cours n'a pas eu lieu. `""` = pas de motif.
	 *
	 *  Texte libre : aucun calcul ne s'appuie dessus, c'est `cancelled` seul qui
	 *  sort la séance du dénominateur d'assiduité. Ne s'imprime sur aucun bilan —
	 *  note de travail pour l'enseignant, pas information due aux familles. */
	cancel_reason: string;
	content_html: string;
	attendance_taken_at: string | null;
	created_at: string;
	/** Créneau d'origine, `null` pour une séance saisie à la main et pour toutes
	 *  celles antérieures au palier 004. Supprimer le créneau le remet à `null`
	 *  sans jamais toucher à l'appel. */
	slot_id: string | null;
	/** Horaire **recopié** du créneau à la création : il appartient au dossier
	 *  historique, pas au modèle. `""` = séance hors créneau. */
	start_time: string;
	end_time: string;
}

// ---- Emploi du temps ----

/** Parité de la semaine ISO d'un créneau.
 *
 *  **Jamais `"all"`** : la valeur est refusée par le CHECK de
 *  `timetable_slots.week_parity` et par la validation Rust, et un filtre qui
 *  divergerait de la colonne viderait la grille sans le moindre message. */
export type WeekParity = "toutes" | "paires" | "impaires";

export const WEEK_PARITIES: WeekParity[] = ["toutes", "paires", "impaires"];

export const WEEK_PARITY_LABELS: Record<WeekParity, string> = {
	toutes: "Toutes les semaines",
	paires: "Semaines paires",
	impaires: "Semaines impaires",
};

/** Jour ISO : 1 = lundi … 7 = dimanche. Même convention que `weekday` partout
 *  dans le backend — il n'existe aucun 0 = dimanche dans ce projet. */
export const WEEKDAY_LABELS: Record<number, string> = {
	1: "Lundi",
	2: "Mardi",
	3: "Mercredi",
	4: "Jeudi",
	5: "Vendredi",
	6: "Samedi",
	7: "Dimanche",
};

export const WEEKDAY_SHORT_LABELS: Record<number, string> = {
	1: "Lun",
	2: "Mar",
	3: "Mer",
	4: "Jeu",
	5: "Ven",
	6: "Sam",
	7: "Dim",
};

/** Le créneau est un **modèle hebdomadaire**, jamais un cours : aucune séance
 *  n'en est engendrée d'office.
 *
 *  Il n'y a pas de colonne `kind` : `session_id` renseigné = un cours ; `null` =
 *  une occupation sans classe (coordination, réunion), qui n'a rien à ouvrir. */
export interface TimetableSlot {
	id: string;
	year_start: number;
	session_id: string | null;
	session_name: string | null;
	label: string;
	room: string;
	/** ISO : 1 = lundi … 7 = dimanche. */
	weekday: number;
	start_time: string;
	end_time: string;
	week_parity: WeekParity;
	created_at: string;
	updated_at: string;
}

/** Saisie d'un créneau. Clés en snake_case **dans l'objet**, comme
 *  `AttendanceInput` : c'est la structure `TimetableSlotInput` du backend.
 *
 *  `year_start` n'en fait pas partie : il est donné à la création et devient
 *  immuable ensuite — déplacer un créneau d'une année à l'autre ferait bouger le
 *  calendrier de l'année en cours sans que rien ne le dise. */
export interface TimetableSlotInput {
	session_id: string | null;
	label: string;
	room: string;
	weekday: number;
	start_time: string;
	end_time: string;
	week_parity: WeekParity;
}

/** Une séance telle que la journée l'affiche : assez pour décider quoi montrer,
 *  sans transporter le cahier de texte entier. */
export interface DaySeance {
	id: string;
	session_id: string;
	session_name: string;
	slot_id: string | null;
	title: string;
	date: string;
	start_time: string;
	end_time: string;
	trimester: number;
	cancelled: boolean;
	has_content: boolean;
	attendance_taken_at: string | null;
	/** Élèves inscrits ce jour-là dans la classe. */
	attendance_total: number;
	/** Élèves réellement pointés. Afficher « attendance_done/attendance_total »,
	 *  **pas** un booléen : `attendance_taken_at` est posé dès le premier élève
	 *  pointé, il ne prouve donc pas qu'un appel soit terminé. */
	attendance_done: number;
}

/** Un créneau du jour, et l'occurrence qui lui correspond si elle existe. */
export interface DaySlot {
	slot: TimetableSlot;
	seance: DaySeance | null;
}

/** Entrée datée sans son corps rédigé, pour les listes. */
export interface AgendaEntrySummary {
	id: string;
	date: string;
	/** `""` = heure à caler : l'entrée s'affiche hors de la grille horaire. */
	start_time: string;
	end_time: string;
	title: string;
	student_id: string | null;
	student_first_name: string | null;
	student_last_name: string | null;
	has_content: boolean;
	created_at: string;
	updated_at: string;
}

/** Entrée datée complète, corps compris. L'entrée datée **est** l'occurrence :
 *  elle est toujours ouvrable, contrairement au créneau. */
export interface AgendaEntry {
	id: string;
	date: string;
	start_time: string;
	end_time: string;
	title: string;
	student_id: string | null;
	student_first_name: string | null;
	student_last_name: string | null;
	content_html: string;
	created_at: string;
	updated_at: string;
}

export interface DaySchedule {
	date: string;
	/** ISO : 1 = lundi … 7 = dimanche. */
	weekday: number;
	iso_week: number;
	/** Parité **calculée** de cette semaine : jamais `"toutes"`, qui n'est qu'une
	 *  consigne de créneau. */
	week_parity: "paires" | "impaires";
	year_start: number;
	/** Trimestre de cette date, calculé par le backend. Le front ne recalcule
	 *  jamais un trimestre. */
	trimester: number;
	/** Vrai si au moins un créneau de l'année porte une parité. N'afficher le
	 *  numéro de semaine QUE si `show_parity` : tant que l'enseignant ne se sert
	 *  pas de la quinzaine, il n'en voit aucune trace. */
	show_parity: boolean;
	slots: DaySlot[];
	/** Séances du jour qui ne viennent d'aucun créneau affiché. Sans elles, une
	 *  séance créée depuis l'écran de la classe n'apparaîtrait pas dans la
	 *  journée, et « Créer et ouvrir » produirait un second appel du même cours. */
	loose_seances: DaySeance[];
	entries: AgendaEntrySummary[];
	/** Pourquoi personne ne fait cours ce jour-là. Vide = jour ordinaire.
	 *
	 *  Plusieurs raisons sont possibles le même jour — le 1er novembre est à la
	 *  fois la Toussaint et dans les vacances qui portent son nom. Le backend les
	 *  rend toutes ; c'est l'affichage qui choisit quoi montrer. */
	closures: DayClosure[];
	/** Classes dont la classe ENTIÈRE est hors cours — un stage.
	 *
	 *  Une période nominative n'y figure jamais : la classe est là, un élève
	 *  manque. Les confondre referait, à l'envers, le défaut que le palier 006 a
	 *  corrigé. */
	sessions_away: SessionAway[];
	/** Dernier jour que le calendrier embarqué couvre, `null` si illisible.
	 *
	 *  **À AFFICHER DANS LA GRILLE.** Passé cette date la fonctionnalité ne
	 *  s'éteint pas : elle se met à mentir dans l'autre sens — des créneaux
	 *  redessinés pendant des vacances qu'on ne connaît plus. */
	calendar_until: string | null;
}

/** Une raison de ne pas faire cours, un jour donné. */
export interface DayClosure {
	label: string;
	/** `ferie` (calculé, jamais en base), `officiel` (semé) ou `manuel` (saisi). */
	origin: "ferie" | "officiel" | "manuel";
}

/** Une classe entière hors cours, et pourquoi. */
export interface SessionAway {
	session_id: string;
	session_name: string;
	/** Le motif saisi sur la période — « Stage en entreprise », le plus souvent. */
	reason: string;
}

export interface WeekSchedule {
	monday: string;
	iso_week: number;
	week_parity: "paires" | "impaires";
	year_start: number;
	show_parity: boolean;
	/** Sept journées : `days[0]` = lundi … `days[6]` = dimanche. */
	days: DaySchedule[];
}

// ---- Présences ----
export type AttendanceStatus =
	| "non_fait"
	| "present"
	| "absent"
	| "retard"
	| "excuse";

export interface AttendanceWithStudent {
	student_id: string;
	student_first_name: string;
	student_last_name: string;
	status: AttendanceStatus;
}

export interface AttendanceInput {
	student_id: string;
	status: AttendanceStatus;
}

// ---- Périodes d'absence ----

/** Une fenêtre de dates pendant laquelle les séances de la classe sortent du
 *  **dénominateur** d'assiduité de qui elle vise — stage en entreprise,
 *  hospitalisation, exclusion temporaire.
 *
 *  Ce n'est pas `seances.cancelled`, qui retire la séance pour tout le monde :
 *  ici le cours a bien eu lieu, et il continue de compter pour les autres. Ce
 *  n'est pas non plus un `excuse` : là, l'élève est absent d'une séance qui,
 *  elle, compte toujours. */
export interface AbsencePeriod {
	id: string;
	session_id: string;
	/** `null` = toute la classe. */
	student_id: string | null;
	student_first_name: string | null;
	student_last_name: string | null;
	/** Texte libre qui nomme la période à l'écran. Aucun calcul ne s'y appuie. */
	reason: string;
	start_date: string;
	/** Incluse : une période du 18 au 18 est une journée. */
	end_date: string;
	/** Séances **non annulées de la classe** comprises dans la fenêtre, comptées
	 *  par le backend. C'est ce chiffre qui rend l'écran honnête — l'effet sur
	 *  les bilans se voit à la saisie, pas en juin. Ne jamais le recalculer ici :
	 *  le bilan, lui, recompte élève par élève et c'est lui qui fait foi. */
	seance_count: number;
	created_at: string;
	updated_at: string;
}

/** Saisie d'une période. Clés en snake_case **dans l'objet**, comme
 *  `AttendanceInput` : c'est la structure `AbsencePeriodInput` du backend.
 *
 *  `session_id` n'en fait pas partie : donné à la création, il est ensuite relu
 *  sur la ligne existante — déplacer une période d'une classe à l'autre
 *  changerait deux bilans d'un coup, dont un que l'enseignant n'a pas sous les
 *  yeux. `student_id` à `null` (ou `""`) vaut « toute la classe ». */
export interface AbsencePeriodInput {
	student_id: string | null;
	reason: string;
	start_date: string;
	end_date: string;
}

// ---- Évaluations ----
export interface Evaluation {
	id: string;
	session_id: string;
	title: string;
	date: string;
	trimester: number;
	trimester_is_manual: boolean;
	created_at: string;
	competency_ids: string[];
}

export interface CompetencyInfo {
	id: string;
	name: string;
	field_name: string;
	domain_name: string;
	cycle_name: string;
	archived: boolean;
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

/** Forme courte des mêmes libellés, pour les carrés de la grille de notation.
 *  Elle vit ici, collée à `MASTERY_LABELS` : une table d'abréviations rangée
 *  dans un composant divergerait le jour où un niveau serait renommé. */
export const MASTERY_SHORT: Record<MasteryLevel, string> = {
	0: "NE",
	1: "MI",
	2: "MF",
	3: "PM",
	4: "MS",
	5: "TBM",
};

/** L'échelle dans l'ordre. Sert partout où les six niveaux se parcourent. */
export const MASTERY_LEVELS: MasteryLevel[] = [0, 1, 2, 3, 4, 5];

/**
 * Motifs d'annulation proposés en un clic, dans l'agenda comme sur la séance.
 *
 * Ce sont des **suggestions**, pas une liste fermée : elles remplissent le champ
 * et l'enseignant écrit ensuite ce qu'il veut. Aucun `CHECK` ne les impose, et
 * aucun calcul ne s'appuie sur le motif — un CHECK ne se retire pas en SQLite,
 * et figer du vocabulaire scolaire que personne n'a confirmé est la faute que ce
 * projet évite partout ailleurs.
 *
 * Les deux premières étaient déjà citées en exemple par le schéma, avant qu'une
 * colonne existe pour les porter (commentaire de `seances.cancelled`,
 * `001_initial.sql`).
 *
 * Elles vivent ici, et non dans l'un des deux écrans qui les affichent : deux
 * copies se mettraient à proposer deux listes différentes pour le même geste.
 *
 * Prix assumé, et il faut le savoir : aucune statistique ne sera possible.
 * « Combien de cours perdus pour sortie scolaire ? » n'a pas de réponse fiable
 * sur du texte libre. C'est le compromis retenu contre la liste fermée.
 */
export const CANCEL_REASON_SUGGESTIONS = [
	"Sortie scolaire",
	"Jour férié",
	"Absence du professeur",
	"Établissement fermé",
];

/**
 * Barème de conversion d'un niveau de maîtrise en points sur 20.
 *
 * **Règle choisie par l'auteur le 2026-10-13 : linéaire, le niveau × 4.**
 * L'échelle est traitée comme régulière, chaque échelon vaut quatre points.
 * C'est la règle la plus facile à expliquer à une famille, et la seule qui se
 * relise à l'envers — une note de 12/20 se lit « Presque maîtrisé en moyenne ».
 *
 * `0` (Non évalué) n'a **pas** de valeur et vaut `null` : une compétence non
 * notée est écartée du calcul, elle ne vaut pas zéro. C'est la même règle que
 * `AVERAGES_HEAD` côté Rust (`g.level > 0`) et que tout ce projet applique à
 * l'absence d'enregistrement — un appel oublié ne vaut pas « présent », une
 * compétence non notée ne vaut pas « insuffisant ».
 *
 * Il vit ici, à côté de `MASTERY_LABELS` et `MASTERY_SHORT`, et non dans l'écran
 * de notation : le jour où un niveau change de nom ou de rang, les trois se
 * corrigent sous les yeux l'un de l'autre. **Si la note /20 apparaît un jour sur
 * le bilan, elle doit lire CE tableau** — deux barèmes feraient deux chiffres
 * différents pour le même élève sur deux écrans.
 */
export const MASTERY_POINTS: Record<MasteryLevel, number | null> = {
	0: null,
	1: 4,
	2: 8,
	3: 12,
	4: 16,
	5: 20,
};

/**
 * Note sur 20 d'un élève, à partir de ses niveaux sur une évaluation.
 *
 * `null` quand aucune compétence n'est notée — **jamais `0`**. Un élève dont la
 * grille est vierge n'a pas zéro, il n'a pas de note : afficher « 0,0 / 20 »
 * serait une affirmation que personne n'a faite, et c'est exactement le piège
 * que `scoring::overall_average` évite déjà côté Rust.
 */
export function masteryMark20(levels: MasteryLevel[]): number | null {
	const points = levels
		.map((level) => MASTERY_POINTS[level])
		.filter((p): p is number => p !== null);
	if (points.length === 0) return null;
	return points.reduce((a, b) => a + b, 0) / points.length;
}

/** « 12,5 » — virgule décimale, une décimale, comme partout en français. */
export function formatMark20(mark: number | null): string {
	return mark === null ? "—" : mark.toFixed(1).replace(".", ",");
}

export const MASTERY_COLORS: Record<MasteryLevel, string> = {
	0: "bg-gray-200 text-gray-600",
	1: "bg-red-100 text-red-700",
	2: "bg-orange-100 text-orange-700",
	3: "bg-yellow-100 text-yellow-700",
	4: "bg-green-100 text-green-700",
	5: "bg-emerald-100 text-emerald-800",
};

export interface Grade {
	evaluation_id: string;
	student_id: string;
	competency_id: string;
	level: MasteryLevel;
}

// ---- Trimestres ----
export interface TrimesterBounds {
	year_start: number;
	t1_start: string;
	t2_start: string;
	t3_start: string;
	year_end: string;
}

export interface RecomputePreview {
	seances_changing: number;
	evaluations_changing: number;
	kept_manual: number;
	samples: string[];
}

export interface RecomputeResult {
	reclassed: number;
	kept_manual: number;
}

// ---- Fiches contrat ----
export interface ProfessionalField {
	id: string;
	name: string;
	position: number;
}

export interface ContractRow {
	/** `null` = ligne nouvelle. Les identifiants existants doivent être renvoyés
	 *  tels quels : c'est ce qui permet au backend de faire un diff plutôt que de
	 *  tout supprimer et réinsérer. */
	id: string | null;
	position: number;
	student_activity: string;
	training_activity: string;
	socle_domain_label: string;
	socle_competency_label: string;
}

export interface ContractSheet {
	id: string;
	evaluation_id: string;
	project_title: string;
	professional_field_id: string | null;
	professional_field_label: string;
	socle_domain: string;
	reference_activities: string;
	target_careers: string;
	given_text: string;
	asked_text: string;
	required_text: string;
	rows: ContractRow[];
}

export interface ContractSheetInput {
	project_title: string;
	professional_field_id: string | null;
	professional_field_label: string;
	socle_domain: string;
	reference_activities: string;
	target_careers: string;
	given_text: string;
	asked_text: string;
	required_text: string;
	rows: ContractRow[];
}

// ---- Bilans ----
export interface CompetencyAverage {
	competency_id: string;
	competency_name: string;
	field_name: string;
	domain_name: string;
	average_level: number;
	grade_count: number;
}

export interface AttendanceStats {
	/** Séances non annulées du trimestre, pour toute la classe. */
	seances_trimestre: number;
	/** Celles où cet élève était inscrit. */
	seances_applicables: number;
	hors_inscription: number;
	/** Séances écartées par une période d'absence justifiée (`absence_periods`).
	 *
	 *  Compteur **distinct** d'`hors_inscription` : un stage de janvier rangé là
	 *  ferait imprimer « hors de sa période d'inscription » sur le bilan d'un
	 *  élève inscrit depuis septembre, faux deux fois. Et distinct d'`excuse`,
	 *  qui est un élève absent d'une séance qui compte — ici, c'est la séance
	 *  elle-même qui sort du dénominateur. */
	seances_neutralisees: number;
	present: number;
	absent: number;
	retard: number;
	excuse: number;
	non_renseigne: number;
}

export interface StudentReport {
	student_id: string;
	student_first_name: string;
	student_last_name: string;
	competency_averages: CompetencyAverage[];
	/** `null` = aucune note. Jamais 0, qui se lirait comme une maîtrise nulle. */
	overall_average: number | null;
	attendance: AttendanceStats;
	teacher_comment: string;
}

export interface SessionReport {
	session_id: string;
	session_name: string;
	level_code: LevelCode;
	year_start: number;
	trimester: number;
	trimester_start: string;
	trimester_end: string;
	seance_count: number;
	cancelled_count: number;
	students: StudentReport[];
	average_rule: OverallAverageRule;
}

// ---- Maintenance ----
export interface BackupInfo {
	file_name: string;
	size_bytes: number;
	created_at: string;
}
