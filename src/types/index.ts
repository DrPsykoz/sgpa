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
	/** Vrai si CE poste peut ouvrir CETTE base par un code PIN : il y faut
	 *  l'enveloppe sur la clé USB **et** le secret du poste dans le profil
	 *  Windows. Faux sur tout autre ordinateur, et l'écran de déverrouillage n'y
	 *  propose alors même pas le champ. */
	pin_available: boolean;
}

/** Retour de `setup_lock`. La phrase n'est PAS relisible ensuite : elle n'existe
 *  nulle part en clair, seule l'enveloppe qu'elle ouvre est conservée. */
export interface SetupResult {
	status: LockStatus;
	recovery_phrase: string;
}

export type OverallAverageRule = "unweighted_mean" | "weighted_by_count";
export type RemovedCompetencyPolicy = "keep" | "ignore";

/** Les deux règles de calcul, dites en français.
 *
 *  Elles vivent ici et non dans l'écran qui les affiche, parce que trois écrans
 *  les nomment : le sélecteur des Réglages, le pied des bilans et celui des PDF.
 *  Recopiées, la même règle finissait par porter trois noms — et depuis qu'elle
 *  est modifiable, l'enseignant peut faire apparaître l'écart en un clic.
 *
 *  Deux registres, parce que ce sont deux usages et non deux formulations :
 *  `_LABELS` est une entrée de menu, autonome et capitalisée ; `_PHRASES` est un
 *  fragment de phrase, qui se lit après « Moyenne générale : ». */
export const AVERAGE_RULE_LABELS: Record<OverallAverageRule, string> = {
	unweighted_mean: "Moyenne non pondérée des moyennes par compétence",
	weighted_by_count: "Moyenne pondérée par le nombre de notes",
};

export const AVERAGE_RULE_PHRASES: Record<OverallAverageRule, string> = {
	unweighted_mean: "moyenne non pondérée des compétences",
	weighted_by_count: "moyenne pondérée par le nombre de notes",
};

export const REMOVED_POLICY_LABELS: Record<RemovedCompetencyPolicy, string> = {
	keep: "Conserver les notes des compétences retirées d'une évaluation",
	ignore: "Ignorer les notes des compétences retirées d'une évaluation",
};

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
	/** Quand l'enseignant a déclaré qu'il n'y avait **rien à écrire** au cahier de
	 *  texte, `null` s'il n'a rien déclaré.
	 *
	 *  Ce n'est pas une annulation : la séance a eu lieu, l'appel y compte. Elle
	 *  sort seulement de « À reprendre » sur l'accueil, qui autrement réclamerait
	 *  sans fin le compte rendu d'une évaluation surveillée ou d'une sortie. */
	content_waived_at: string | null;

	/** Vrai si la séance porte au moins une pièce jointe. **Dérivé, jamais
	 *  écrit** : aucune commande ne le reçoit, il est recalculé à chaque lecture.
	 *  Ne pas le lire seul — une séance est réglée de trois façons : passer par
	 *  `renduDeLaSeance` de `lib/contenu.ts`. */
	has_attachment: boolean;
}

// ---- Besoins particuliers des élèves ----

/** Une étiquette du vocabulaire de l'enseignant : « Dysorthographie », « AESH »,
 *  « PAP »… L'application n'en fournit AUCUNE, et c'est délibéré : les libellés
 *  exacts viennent des notifications MDPH et des PAP de son établissement. */
export interface NeedTag {
	id: string;
	label: string;
	/** Abréviation pour les écrans denses. `""` = aucune, et l'affichage retombe
	 *  sur le libellé complet. **Ne jamais tronquer côté front** : « Dys »
	 *  conviendrait autant à « Dyscalculie » qu'à « Dysorthographie », qui ne
	 *  demandent pas les mêmes aménagements. */
	short_label: string;
	position: number;
	/** Nombre d'élèves qui la portent, toutes classes et années confondues. Sert à
	 *  dire ce qu'une suppression va emporter AVANT de la proposer. */
	student_count: number;
}

/** Les besoins d'un élève. Un élève sans étiquette ni note n'a pas de ligne :
 *  `get_session_needs` est une table d'appoint, pas une projection de classe. */
export interface StudentNeeds {
	student_id: string;
	tag_ids: string[];
	/** `""` = rien à signaler. */
	note: string;
}

/** Jamais imprimé. **Sur aucun document.**
 *
 *  Décision explicite de l'auteur : ce sont des données de santé concernant des
 *  mineurs, et un bilan trimestriel remis à une famille, une fiche contrat ou
 *  une liste d'appel oubliée en salle des profs n'ont aucune raison de les
 *  porter. `src/lib/pdf.ts` ne lit ni `NeedTag` ni `StudentNeeds` — ajouter
 *  l'un des deux à une génération de PDF serait un bug, pas une amélioration.
 *  Cette constante existe pour que la règle ait un nom qu'on puisse citer. */
export const BESOINS_JAMAIS_IMPRIMES = true;

// ---- Pièces jointes d'un compte rendu ----

/** Une pièce jointe **sans ses octets**.
 *
 *  C'est la forme que rend tout listage : le BLOB vit en dernière colonne
 *  de la table pour qu'afficher « 312 Ko » ne le lise pas. Les octets ne
 *  viennent que sur un geste explicite, par `readSeanceAttachment` ou
 *  `readEntryAttachment`. */
export interface Attachment {
	id: string;

	/** La séance **ou le rendez-vous** qui la porte. Nommé `owner_id` et non
	 *  `seance_id` depuis le palier 017 : les deux portent des pièces jointes,
	 *  par le même écran, et un champ qui mentirait sur la moitié des cas
	 *  aurait fini par être lu de travers. */
	owner_id: string;
	file_name: string;

	/** Type MIME annoncé par le navigateur à l'ajout. **Indicatif** : il ne
	 *  décide que du mode d'aperçu, jamais d'une autorisation. `""` = inconnu. */
	mime_type: string;

	/** Taille des octets stockés, après redimensionnement éventuel. */
	size_bytes: number;
	created_at: string;
}

/** Une pièce jointe **avec** ses octets, en base64 sans en-tête `data:`. */
export interface AttachmentContent {
	id: string;
	file_name: string;
	mime_type: string;
	size_bytes: number;
	content_base64: string;
}

/** Plafond par fichier, **le même nombre que `attachments::MAX_ATTACHMENT_BYTES`**.
 *
 *  Il est répété ici pour refuser le fichier avant de l'encoder en base64 et
 *  de le pousser dans l'IPC — faire 13 Mo de chaîne pour s'entendre dire non
 *  fige la fenêtre une seconde. Le refus qui compte reste celui du backend :
 *  celui-ci n'est qu'une politesse, et une divergence ne laisserait jamais
 *  passer un fichier trop gros. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

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

	/** Les deux sorties du palier 014, lues par `etatDuCompteRendu` et par rien
	 *  d'autre : « cahier vide » sous une séance dont l'enseignant a dit « rien à
	 *  écrire », ou qui porte la photo du tableau, réclamerait ce que l'accueil
	 *  ne demande plus. */
	content_waived: boolean;
	has_attachment: boolean;
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
	/** Classe concernée, quand le rendez-vous en nomme une. Déduite de l'élève
	 *  dès qu'il y en a un : un élève n'appartient qu'à une classe, donc les deux
	 *  champs ne peuvent pas se contredire. */
	session_id: string | null;
	session_name: string | null;
	student_id: string | null;
	student_first_name: string | null;
	student_last_name: string | null;
	has_content: boolean;

	/** Les deux sorties du palier 017, lues par `etatDuCompteRendu` et par rien
	 *  d'autre : un écran qui réclamerait un compte rendu déjà réglé
	 *  contredirait l'accueil, qui a cessé de le demander. */
	content_waived: boolean;
	has_attachment: boolean;
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
	session_id: string | null;
	session_name: string | null;
	student_id: string | null;
	student_first_name: string | null;
	student_last_name: string | null;
	content_html: string;

	/** Horodatage du « rien à écrire », `null` tant qu'il n'a pas été déclaré.
	 *
	 *  Même sens que sur une séance, et la même mise en garde : ce n'est **pas**
	 *  une annulation. Le rendez-vous a eu lieu ; il n'y a rien à en consigner,
	 *  donc l'accueil ne le réclame plus. */
	content_waived_at: string | null;
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
	 *  journée, et l'accueil proposerait de créer une occurrence déjà créée —
	 *  donc un second appel du même cours. */
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
	/** Le domaine désigné sans ambiguïté : « D3 — La formation de la personne et
	 *  du citoyen (Cycle 3) ». Composé par le backend, jamais ici — les cinq
	 *  domaines portent les mêmes noms d'un cycle à l'autre, et recomposer la
	 *  règle à deux endroits la ferait diverger du texte enregistré. */
	socle_reference: string;
	archived: boolean;
}

// ---- Notes ----

/**
 * Bornes de la note, **entière**, sur 20.
 *
 * **Il n'y a pas de note de 0** — décision de l'auteur du 2026-11-07. La note
 * la plus basse est 1, et « non évalué » n'est pas une note basse : c'est
 * l'absence de ligne dans `grades`, que `api.deleteGrade` rétablit. Même règle
 * que l'appel non fait, qui ne vaut pas « présent ».
 *
 * Doublées côté Rust (`MARK_MIN` / `MARK_MAX`) et par le CHECK du schéma, et ce
 * n'est pas une redondance oisive : le CHECK est le garde-fou, ces deux-ci sont
 * ce qui permet de refuser une saisie **avant** de l'envoyer, dans les mots de
 * l'enseignant.
 */
export const MARK_MIN = 1;
export const MARK_MAX = 20;

/**
 * Les cinq degrés de maîtrise. **Ils ne se saisissent plus, ils se lisent.**
 *
 * Jusqu'au palier 018, l'enseignant cliquait un degré et la note sur 20 en
 * était déduite. La chaîne est inversée : il saisit la note, et le degré n'est
 * plus qu'une façon de la nommer. Il n'y a donc plus de niveau `0` — « non
 * évalué » n'est pas un degré de maîtrise, c'est une case vide, et une case
 * vide n'a pas de libellé à porter.
 */
export type MasteryLevel = 1 | 2 | 3 | 4 | 5;

export const MASTERY_LABELS: Record<MasteryLevel, string> = {
	1: "Maîtrise insuffisante",
	2: "Maîtrise fragile",
	3: "Presque maîtrisé",
	4: "Maîtrise satisfaisante",
	5: "Très bonne maîtrise",
};

/** Forme courte des mêmes libellés, là où la colonne est trop étroite.
 *  Elle vit ici, collée à `MASTERY_LABELS` : une table d'abréviations rangée
 *  dans un composant divergerait le jour où un degré serait renommé. */
export const MASTERY_SHORT: Record<MasteryLevel, string> = {
	1: "MI",
	2: "MF",
	3: "PM",
	4: "MS",
	5: "TBM",
};

/** L'échelle dans l'ordre. Sert là où les cinq degrés se parcourent — une
 *  légende, l'axe d'un graphique. **Plus jamais une surface de saisie.** */
export const MASTERY_LEVELS: MasteryLevel[] = [1, 2, 3, 4, 5];

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
 * Les tranches de notes, et le degré de maîtrise que chacune porte.
 *
 * **Découpage choisi par l'auteur le 2026-11-07 : quatre points par degré.**
 *
 * ```text
 *       1 · 2 · 3 · 4   Maîtrise insuffisante
 *       5 · 6 · 7 · 8   Maîtrise fragile
 *    9 · 10 · 11 · 12   Presque maîtrisé
 *   13 · 14 · 15 · 16   Maîtrise satisfaisante
 *   17 · 18 · 19 · 20   Très bonne maîtrise
 * ```
 *
 * Ce tableau remplace `MASTERY_POINTS`, qui faisait le trajet inverse — niveau
 * × 4 ⇒ note — et dont la règle linéaire avait été retenue le 2026-10-13. Elle
 * n'est pas désavouée, elle est devenue l'autre sens du même barème : les cinq
 * valeurs qu'elle produisait (4, 8, 12, 16, 20) sont exactement les bornes
 * hautes des cinq tranches ci-dessus. C'est pour ça que le palier 018 a pu
 * convertir toute la base sans rien arbitrer.
 *
 * **C'EST LE SEUL ENDROIT OÙ CE DÉCOUPAGE EST ÉCRIT.** Ni le schéma, ni les
 * commandes Rust, ni un écran ne nomment un degré : le backend stocke et valide
 * un nombre, rien de plus. Deux découpages donneraient deux libellés pour la
 * même note sur deux écrans — et l'un des deux finirait imprimé.
 */
export const MASTERY_BANDS: Record<MasteryLevel, readonly [number, number]> = {
	1: [1, 4],
	2: [5, 8],
	3: [9, 12],
	4: [13, 16],
	5: [17, 20],
};

/**
 * Le degré de maîtrise d'une note : `plafond(note / 4)`, borné à l'échelle.
 *
 * Accepte une note **fractionnaire** à dessein : une moyenne de 13,5 se lit
 * « Maîtrise satisfaisante » comme 14 le fait, et le bilan trimestriel n'a que
 * des moyennes à nommer.
 *
 * Elle **borne** au lieu de rendre `null` hors barème. Les deux seules façons
 * d'arriver ici hors des bornes sont une note écrite par un autre chemin que
 * `set_grade` — donc un défaut à corriger, pas un cas à afficher — et un
 * arrondi flottant sur une borne. Un libellé manquant au milieu d'un bilan
 * serait une panne plus difficile à lire qu'un libellé de bord.
 */
export function niveauDeNote(mark: number): MasteryLevel {
	const degre = Math.ceil(mark / 4);
	return Math.min(Math.max(degre, 1), 5) as MasteryLevel;
}

/** Le libellé d'une note : « 14 » ⇒ « Maîtrise satisfaisante ». */
export function labelDeNote(mark: number): string {
	return MASTERY_LABELS[niveauDeNote(mark)];
}

/** La forme courte du même libellé, là où la colonne est trop étroite. */
export function shortDeNote(mark: number): string {
	return MASTERY_SHORT[niveauDeNote(mark)];
}

/**
 * Moyenne sur 20 d'un élève, à partir de ses notes sur une évaluation.
 *
 * `null` quand aucune compétence n'est notée — **jamais `0`**. Un élève dont la
 * grille est vierge n'a pas zéro, il n'a pas de note : afficher « 0,0 / 20 »
 * serait une affirmation que personne n'a faite, et c'est exactement le piège
 * que `scoring::overall_average` évite déjà côté Rust. Depuis le palier 018 ce
 * serait doublement faux — 0 n'est même plus une note saisissable.
 */
export function moyenneDesNotes(marks: number[]): number | null {
	if (marks.length === 0) return null;
	return marks.reduce((a, b) => a + b, 0) / marks.length;
}

/** « 12,5 » — virgule décimale, une décimale, comme partout en français. */
export function formatMark20(mark: number | null): string {
	return mark === null ? "—" : mark.toFixed(1).replace(".", ",");
}

export const MASTERY_COLORS: Record<MasteryLevel, string> = {
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
	/** Note entière de 1 à 20. Le libellé de maîtrise ne voyage pas avec elle :
	 *  il se lit par `labelDeNote`, et une seule fois. */
	mark: number;
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
	/** « activités des élèves » sur la fiche contrat, « ON DEMANDE » sur la fiche
	 *  d'évaluation : c'est le même texte dans ses deux documents. */
	student_activity: string;
	training_activity: string;
	/** Lien vers le référentiel. Deux lignes VOISINES qui portent le même
	 *  identifiant s'affichent et s'impriment sous une seule cellule fusionnée —
	 *  c'est ce qui évite de recopier une compétence, donc de la compter
	 *  plusieurs fois dans une note. */
	competency_id: string | null;
	/** Libellés figés : le référentiel les remplit s'ils sont vides, et ne
	 *  réécrit jamais une formulation saisie. */
	socle_domain_label: string;
	socle_competency_label: string;
	/** « ON EXIGE » de la fiche d'évaluation, en face de cette activité. */
	required_text: string;
}

/** Une ligne du tableau ON DONNE / ON DEMANDE / ON EXIGE. Trois colonnes
 *  alignées : l'alignement EST l'information, « les plans » répond à
 *  « identifier et interpréter un document » et à rien d'autre. */
export interface ContractRequirement {
	id: string | null;
	position: number;
	given_text: string;
	asked_text: string;
	required_text: string;
}

export interface ContractSheet {
	id: string;
	evaluation_id: string;
	project_title: string;
	professional_field_id: string | null;
	professional_field_label: string;
	/** Sous-ensemble du champ professionnel — « AMENAGEMENT AGENCEMENT FINITION »
	 *  sur sa fiche. Son classeur intitule cette colonne « domaine du socle », à
	 *  tort : les domaines du socle sont dans les lignes. */
	professional_subset: string;
	reference_activities: string;
	target_careers: string;
	rows: ContractRow[];
	requirements: ContractRequirement[];
}

export type ContractSheetInput = Omit<ContractSheet, "id" | "evaluation_id">;

/** Proposition composée depuis l'évaluation, jamais écrite en base. */
export interface ContractSuggestion {
	project_title: string;
	session_name: string;
	level_code: LevelCode;
	year_start: number;
	rows: ContractRow[];
}

// ---- Bilans ----
export interface CompetencyAverage {
	competency_id: string;
	competency_name: string;
	field_name: string;
	domain_name: string;
	average_mark: number;
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

/** Ce que l'écran de réglages sait du journal de diagnostic.
 *
 *  `recent_lines` est du texte déjà mis en forme par Rust, dans l'ordre du
 *  fichier. Le front ne le réanalyse pas : un format de ligne redécoupé ici
 *  divergerait de celui qui s'écrit là-bas au premier changement.
 *
 *  Ces lignes ne contiennent **aucune donnée personnelle**, par construction
 *  et non par hasard — voir `src-tauri/src/journal.rs`. C'est ce qui permet de
 *  les afficher à l'écran, et à l'enseignant d'envoyer le fichier sans y
 *  regarder à deux fois. */
export interface JournalInfo {
	folder: string;
	today_file: string;
	today_bytes: number;
	file_count: number;
	recent_lines: string[];
}

// ---- Accueil ----

/** Les six natures de rappel de l'accueil.
 *
 *  Le backend les nomme (`commands/home.rs`), le front choisit la phrase et
 *  l'icône. L'union est FERMÉE pour une raison précise : un `kind` inconnu
 *  produirait une carte sans titre et sans lien, c'est-à-dire un rappel muet.
 *  Ajouter un groupe côté Rust doit donc casser la compilation ici. */
export type ReminderKind =
	| "appel_incomplet"
	| "cahier_vide"
	| "annulee_sans_motif"
	| "evaluation_incomplete"
	| "evaluation_sans_competence"
	| "compte_rendu_manquant";

/** Un cas précis à traiter. Aucune phrase ici, seulement des faits : le
 *  backend rend les nombres, l'affichage rend le français. */
export interface ReminderItem {
	id: string;
	title: string;
	date: string;
	/** Classe concernée, quand le rappel en a une. Un rendez-vous peut n'en
	 *  nommer aucune — réunion de secteur, médecine scolaire — et reste alors un
	 *  rappel sans classe.
	 *
	 *  Renseignée n'implique pas « cliquable » : `reminderHref` exige aussi un
	 *  onglet, et le compte rendu d'un rendez-vous n'en a pas. */
	session_id: string | null;
	session_name: string | null;
	/** Élève concerné, quand le rappel est nominatif. */
	student_name: string | null;
	/** Vrai si l'entrée d'agenda est rattachée à un placement de stage. Toujours
	 *  faux aujourd'hui : aucune commande ne sait encore créer un placement. */
	is_stage_visit: boolean;
	/** Avancement, quand le rappel en a un : 14 appels faits sur 18, 32 notes
	 *  saisies sur 45. `null` pour les rappels binaires. */
	done: number | null;
	total: number | null;
}

export interface ReminderGroup {
	kind: ReminderKind;
	/** Nombre total de cas. **Jamais `items.length`** : la liste est tronquée à
	 *  cinq par le backend, le compte ne l'est pas. */
	count: number;
	/** Dénominateur : combien d'objets de cette nature le passé contient. Zéro
	 *  veut dire « rien de comparable encore », pas « aucun problème ». */
	scope: number;
	items: ReminderItem[];
}

export interface HomeOverview {
	today: string;
	year_start: number;
	/** Trimestre du jour, calculé par le backend. */
	trimester: number;
	trimester_start: string;
	trimester_end: string;
	/** Jours restants, bornes comprises. **Peut être négatif** : les bornes par
	 *  défaut arrêtent l'année au 7 juillet, et un rattrapage du 15 juillet reste
	 *  en T3. `null` si la borne enregistrée n'est pas une date lisible. */
	trimester_days_left: number | null;
	/** Les six groupes, dans l'ordre d'affichage, **vides compris** : un groupe à
	 *  zéro affirme que l'application a regardé, un groupe absent laisse croire
	 *  qu'elle ne l'a pas fait. */
	groups: ReminderGroup[];
}
