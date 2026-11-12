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
	/** L'établissement où la classe se tient, ou `null` — palier 025.
	 *
	 *  `null` veut dire « comme avant le palier » : aucune compétence retirée
	 *  des menus de saisie, et l'en-tête des PDF reste le nom saisi dans
	 *  Réglages. C'est l'état de toute base migrée. */
	establishment_id: string | null;
	/** Son nom, relu à chaque lecture — donc un renommage se voit partout.
	 *  Ce n'est PAS un libellé figé comme celui d'une fiche contrat : rien
	 *  de ceci ne s'imprime. */
	establishment_name: string | null;
}

// ---- Établissements (palier 025) ----

/** Un établissement, avec ce qu'une suppression coûterait.
 *
 *  `session_count` est rendu par la lecture parce que la suppression **ne
 *  refuse jamais** : les classes reviennent à « aucun établissement », ce qui
 *  est leur état d'avant le palier. L'écran doit donc annoncer le prix
 *  lui-même — personne d'autre ne l'arrêtera. Même geste que `activity_count`
 *  pour un domaine de progression. */
export interface Establishment {
	id: string;
	name: string;
	position: number;
	session_count: number;
	disabled_count: number;
}

/** Combien d'établissements désactivent une compétence donnée.
 *
 *  Le revers du compte précédent : une compétence disparue des menus doit
 *  pouvoir dire pourquoi, sinon l'enseignant la croit perdue. Seules les
 *  compétences désactivées au moins une fois y figurent. */
export interface DisabledCompetencyCount {
	competency_id: string;
	establishment_count: number;
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
	/** Le groupe où l'élève est rangé, `null` s'il ne l'est nulle part.
	 *
	 *  **Ne s'écrit pas par `updateStudent`** mais par `setStudentGroup` : deux
	 *  écritures qui ne concernent pas les mêmes colonnes sont deux commandes,
	 *  et l'écran qui répartit la classe n'a aucun prénom à faire transiter. */
	group_id: string | null;
	/** Le nom du groupe, joint à la lecture. **Dérivé, jamais écrit.** */
	group_name: string | null;
}

// ---- Groupes (palier 023) ----

/** Un groupe d'élèves dans une classe : « Groupe 1 », « Atelier bois »…
 *
 *  **Autant de groupes que voulu, nommés librement, et un élève n'appartient
 *  qu'à un seul** — choix de l'enseignant du 2026-11-12. Ce n'est pas une
 *  sous-classe : le groupe vit dans sa classe, les bilans restent par classe,
 *  et un élève en 4ᵉ puis en 3ᵉ est toujours deux lignes de `students`.
 *
 *  **Un élève sans groupe est convoqué partout**, y compris aux séances d'un
 *  groupe nommé. C'est voulu : un élève non rangé est presque toujours un
 *  oubli, et le faire disparaître des appels serait invisible. Le risque est
 *  donc une ligne en trop à l'appel, qui se voit, et non une absence qui ne se
 *  compte nulle part. */
export interface StudentGroup {
	id: string;
	session_id: string;
	name: string;
	position: number;
	/** Combien d'élèves y sont rangés — l'écran montre du même coup ceux qui ne
	 *  le sont pas. */
	student_count: number;
	/** Séances tenues avec ce groupe, et évaluations qui le visent.
	 *
	 *  Rendus par la lecture pour que l'écran sache **avant** de proposer le
	 *  bouton : les clés étrangères sont en RESTRICT, donc le refus viendrait de
	 *  toute façon, mais dans les mots de SQLite. Même geste qu'`activity_count`
	 *  pour les domaines de progression. */
	seance_count: number;
	evaluation_count: number;
}

/** Plafond de saisie du nom d'un groupe.
 *
 *  Le refus vient du backend (`clean_group_name`), seule implémentation de la
 *  règle : ce nombre n'alimente qu'un `maxLength`. */
export const GROUP_NAME_MAX = 40;

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

	/** Le groupe que ce cours a réuni, `null` = toute la classe (palier 023).
	 *
	 *  **C'est un fait et non un réglage** : il décide qui a été appelé, et il
	 *  retire la séance du dénominateur d'assiduité des élèves de l'autre
	 *  groupe. Il est **recopié du créneau** à la naissance de l'occurrence et
	 *  jamais relu de lui ensuite — corriger la semaine A de l'emploi du temps
	 *  ne réécrit pas les appels déjà faits.
	 *
	 *  ⚠ `updateSeanceMeta` l'écrit **sans condition** : tout appelant le fait
	 *  transiter inchangé, même piège que l'horaire et que le motif. */
	group_id: string | null;
	/** Le nom du groupe. **Dérivé, jamais écrit.** */
	group_name: string | null;
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
	/** Le groupe convoqué par ce créneau, `null` = toute la classe.
	 *
	 *  **C'est un réglage, pas un fait** : supprimer le groupe le remet à `null`
	 *  et le créneau redevient un cours de classe entière, exactement l'inverse
	 *  du `RESTRICT` que porte `Seance.group_id`.
	 *
	 *  C'est aussi ce qui fait la **semaine A / semaine B par groupe** sans rien
	 *  ajouter au schéma : deux créneaux au même horaire, de parités
	 *  complémentaires, l'un au groupe 1 et l'autre au groupe 2. La porte est
	 *  « Un autre cours à cet horaire » dans `SlotDialog`. */
	group_id: string | null;
	/** Le nom du groupe. **Dérivé, jamais écrit.** */
	group_name: string | null;
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
	/** `null` = toute la classe. Un créneau sans classe ne peut pas porter de
	 *  groupe : le backend le refuse en français, un groupe appartenant à une
	 *  classe. */
	group_id: string | null;
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
	/** Le nom du groupe réuni, `null` = toute la classe. Les deux compteurs
	 *  ci-dessus sont déjà bornés à ce groupe par le backend : un atelier de six
	 *  élèves tous pointés affiche « 6/6 » et non « 6/14 ». */
	group_name: string | null;
	/** Le groupe réuni, pour **comparer** — le nom ci-dessus sert à écrire.
	 *
	 *  C'est le groupe de la SÉANCE et non celui de son créneau, et les deux
	 *  peuvent différer : l'occurrence recopie le groupe du créneau à sa
	 *  naissance, et changer le créneau ensuite ne réécrit aucune séance passée.
	 *  C'est lui que `absenceDuCreneau` compare, pour que la carte s'estompe
	 *  d'après le même groupe que celui dont elle affiche le nom. */
	group_id: string | null;
}

/** Un créneau du jour, et l'occurrence qui lui correspond si elle existe. */
export interface DaySlot {
	slot: TimetableSlot;
	seance: DaySeance | null;
}

/** Plafond de saisie de la catégorie d'un rendez-vous (palier 020).
 *
 *  Le refus vient du backend (`clean_entry_category`), seule implémentation de
 *  la règle : ce nombre n'alimente qu'un `maxLength`, pour éviter un
 *  aller-retour dont on connaît déjà l'issue. Il vit ici parce que **deux
 *  écrans** le lisent — le dialogue de création et l'éditeur —, et que deux
 *  constantes recopiées divergent au premier ajustement. */
export const MAX_ENTRY_CATEGORY_CHARS = 30;

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
	/** Catégorie, en texte libre et `""` par défaut (palier 020).
	 *
	 *  S'affiche en **pastille**, à côté de l'intitulé, sur les deux calendriers :
	 *  « Exercice PPMS — alerte à la bombe » disait deux choses dans un seul
	 *  intitulé, dont une que l'enseignant voulait voir d'un coup d'œil sans
	 *  relire la phrase. Trente caractères au plus, bornés par le backend
	 *  (`clean_entry_category`) — pas par un CHECK, une limite d'affichage
	 *  n'étant pas une règle de données. */
	category: string;
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
	/** Catégorie, en texte libre et `""` par défaut (palier 020).
	 *
	 *  S'affiche en **pastille**, à côté de l'intitulé, sur les deux calendriers :
	 *  « Exercice PPMS — alerte à la bombe » disait deux choses dans un seul
	 *  intitulé, dont une que l'enseignant voulait voir d'un coup d'œil sans
	 *  relire la phrase. Trente caractères au plus, bornés par le backend
	 *  (`clean_entry_category`) — pas par un CHECK, une limite d'affichage
	 *  n'étant pas une règle de données. */
	category: string;
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
	/** Classes hors cours — un stage —, et depuis le palier 023 les **groupes**
	 *  hors cours de ces classes.
	 *
	 *  Une période nominative n'y figure jamais : la classe est là, un élève
	 *  manque. Les confondre referait, à l'envers, le défaut que le palier 006 a
	 *  corrigé. Un groupe, lui, y figure **avec son `group_id`** : c'est une
	 *  demi-classe qui part, et l'autre moitié a cours. */
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

/** Une classe — ou un seul de ses groupes — hors cours, et pourquoi.
 *
 *  Trois cas, et ils ne se dessinent pas pareil — c'est `absenceDuCreneau`
 *  (`pages/Timetable/journee.ts`) qui les départage, et les deux calendriers qui
 *  le lisent :
 *
 *  - ni l'un ni l'autre : la classe est ailleurs, son cours n'a pas lieu. Sa
 *    carte reste en place, **estompée et inerte**, le motif écrit dessus. Elle
 *    disparaissait entièrement jusqu'au palier 020 ; ce que le palier 006
 *    cherchait tient autrement — la carte n'ouvre plus rien, donc elle ne
 *    propose plus de créer la séance d'un cours qui n'a pas eu lieu ;
 *  - `attendance_expected` : sortie scolaire, séjour, CDI — la classe est
 *    ailleurs mais **l'appel se fait**, donc le créneau ne change pas d'aspect.
 *    L'estomper ferait reculer à l'œil la séance dont on attend justement
 *    l'appel. Seul le bandeau de la journée la nomme ;
 *  - `teacher_absent` : c'est le professeur qui manquait. La carte s'estompe
 *    comme au premier cas, et les mots changent — « Professeur absent », jamais
 *    « classe absente » : la classe était là. */
export interface SessionAway {
	session_id: string;
	session_name: string;
	/** Le motif saisi sur la période — « Stage en entreprise », le plus souvent. */
	reason: string;
	/** L'appel se fait quand même : le créneau n'est pas masqué. */
	attendance_expected: boolean;
	/** C'est le professeur qui était absent, pas la classe. */
	teacher_absent: boolean;
	/** Le groupe visé, `null` = toute la classe (palier 023).
	 *
	 *  ⚠ **Le prédicat de l'écran n'est pas celui du bilan, et c'est voulu.**
	 *  Un cours de classe entière pendant le stage du groupe 1 **a lieu** :
	 *  l'autre moitié de l'atelier est là, l'appel se fait. L'estomper ferait
	 *  disparaître à l'œil une séance dont on attend justement l'appel. Un
	 *  créneau n'est donc écarté que si la période vise toute la classe, ou
	 *  vise exactement son groupe — c'est ce qu'écrit `absenceDuCreneau` :
	 *
	 *      away.group_id === null || away.group_id === groupe du créneau
	 *
	 *  Le bilan, lui, retire bien cette séance de classe entière du
	 *  dénominateur des élèves du groupe parti : `reports::ATTENDANCE_SQL`
	 *  teste le groupe de l'**élève**, pas celui de la séance. Deux règles qui
	 *  disent la même vérité depuis deux points de vue — les aligner en
	 *  casserait une. */
	group_id: string | null;
	/** Le nom du groupe visé. **Dérivé, jamais écrit.** */
	group_name: string | null;
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

/** Un élève absent de ses cours sur une période nominative (stage,
 *  hospitalisation). Distinct de `SessionAway` : la classe est là, un élève
 *  manque. */
export interface StudentAway {
	session_id: string;
	student_id: string;
	student_name: string;
	reason: string;
	attendance_expected: boolean;
}

/** Une semaine de l'année scolaire, telle que la vue annuelle la montre. */
export interface YearWeek {
	monday: string;
	iso_week: number;
	/** Mois auquel la semaine appartient : celui qui contient son **jeudi**.
	 *
	 *  C'est une partition — chaque semaine va dans un mois et un seul —, donc la
	 *  frise n'a ni colonne dédoublée ni semaine orpheline. Ne pas regrouper par
	 *  `monday.slice(5, 7)` : la semaine du 30 novembre est une semaine de
	 *  décembre, et deux règles de découpage dans la même page afficheraient une
	 *  semaine dans un mois et son trimestre dans l'autre. */
	month: number;
	/** Année civile du jeudi : décembre et janvier ne sont pas la même colonne. */
	year: number;
	/** Trimestre de la semaine, calculé par le backend depuis ce même jeudi. Le
	 *  front ne recalcule jamais un trimestre. */
	trimester: number;
	week_parity: "paires" | "impaires";
	/** Pourquoi on ne fait pas cours cette semaine-là. Vide = semaine ordinaire.
	 *
	 *  Un motif n'y figure qu'une fois, même s'il couvre les cinq jours : la
	 *  colonne écrit « Vacances de Noël », pas cinq fois le même mot. */
	closures: DayClosure[];
	/** Jours ouvrés restants, de 0 à 5.
	 *
	 *  **C'est le nombre que le document d'origine n'avait pas.** Ses quarante
	 *  colonnes supposaient quatre semaines par mois ; l'année 2026-2027 en compte
	 *  quarante-cinq, dont plusieurs ne sont pas entières. Une semaine à zéro est
	 *  une semaine où rien ne se place. */
	school_days: number;
	/** Classes dont la classe ENTIÈRE est hors cours cette semaine — un stage.
	 *  Jamais une période nominative : la classe est là, un élève manque. */
	sessions_away: SessionAway[];
	/** Les élèves en stage ou absents sur une période nominative cette semaine.
	 *  Écran seulement : jamais imprimé, jamais journalisé. */
	students_away: StudentAway[];
}

/** L'année scolaire entière, semaine par semaine.
 *
 *  **Cette vue montre et ne modifie rien.** La progression d'une classe s'écrit
 *  dans sa fiche, et nulle part ailleurs : deux écrans qui modifient la même
 *  chose finissent par ne pas en dire la même chose, et c'est exactement ce qui
 *  a fait supprimer l'onglet « Journée » de l'emploi du temps. */
export interface YearCalendar {
	year_start: number;
	/** Les bornes de trimestre de l'année, rendues AVEC les semaines et non
	 *  relues par un second appel : la frise dessine ses trois trimestres à partir
	 *  des mêmes bornes qui ont classé chaque semaine, donc la limite dessinée
	 *  tombe forcément là où le trimestre change. */
	bounds: TrimesterBounds;
	show_parity: boolean;
	calendar_until: string | null;
	weeks: YearWeek[];
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

	/** `true` = l'appel se fait quand même, et la période **ne retire rien** du
	 *  dénominateur (palier 020).
	 *
	 *  Une sortie scolaire, un séjour, une matinée au CDI sont des périodes où la
	 *  classe est ailleurs et bien présente : l'appel s'y fait, et il compte.
	 *  `false` est le comportement de toutes les périodes saisies avant le palier
	 *  020, et celui que l'écran propose par défaut.
	 *
	 *  La règle vit dans `reports::ATTENDANCE_SQL`, qui lit la colonne à ses deux
	 *  points symétriques. Le front ne recalcule aucune assiduité : il affiche ce
	 *  drapeau, et `seance_count` dit déjà combien de séances sont en jeu. */
	attendance_expected: boolean;

	/** `true` = c'est le **professeur** qui était absent, pas la classe.
	 *
	 *  Ne change **aucun calcul** — une période neutralise déjà. Il porte la
	 *  cause, pour que l'emploi du temps écrive « Professeur absent » plutôt que
	 *  de laisser deviner, et pour que les rappels de l'accueil se taisent sur
	 *  une séance que personne n'a assurée.
	 *
	 *  Écrit par `createTeacherAbsencePeriods` et par rien d'autre, jamais
	 *  modifiable ensuite : une absence du professeur se supprime et se repose. */
	teacher_absent: boolean;
	/** Le groupe visé, `null` = toute la classe (palier 023).
	 *
	 *  **Exclusif de `student_id`** : une période vise une classe, un groupe OU
	 *  un élève. Un stage du groupe 1 n'écarte que les séances du groupe 1, et
	 *  `seance_count` le dit déjà. Jamais posé sur une absence du professeur —
	 *  il n'est pas absent pour une moitié de classe. */
	group_id: string | null;
	/** Le nom du groupe. **Dérivé, jamais écrit.** */
	group_name: string | null;
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
	/** « L'appel se fait quand même ». `false` reproduit le comportement d'avant
	 *  le palier 020, et c'est ce que l'écran propose par défaut. */
	attendance_expected: boolean;
	/** `null` (ou `""`) = toute la classe. **Exclusif de `student_id`** : le
	 *  backend refuse les deux à la fois, en français. */
	group_id: string | null;
}

/** Saisie d'une **absence du professeur**, sur une ou plusieurs classes.
 *
 *  Une structure à part et une commande à part, et c'est tout l'intérêt : le
 *  backend écrit `teacher_absent = 1`, `attendance_expected = 0` et
 *  `student_id = NULL` en dur. Le couple contradictoire — absent *et* l'appel
 *  fait — est donc inécrivable, et une absence du professeur ne peut pas naître
 *  nominative : il n'est pas absent pour un élève en particulier.
 *
 *  Les classes sont une liste parce qu'il est rarement absent pour une seule :
 *  une journée de formation vide son emploi du temps entier, une réunion ne lui
 *  prend qu'une classe. Tout ou rien — si une classe cochée a déjà une période
 *  qui recouvre ces dates, rien n'est écrit et le message la nomme. */
export interface TeacherAbsenceInput {
	session_ids: string[];
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
	/** Le groupe évalué, `null` = toute la classe (palier 023).
	 *
	 *  **C'est un fait** : la grille ne montre que les élèves concernés, et le
	 *  compte de complétude de l'accueil se borne au même ensemble. Restreindre
	 *  une évaluation à un groupe est **refusé** tant qu'un élève hors de ce
	 *  groupe y porte une note ou un « non évalué » : une note que plus aucun
	 *  écran n'affiche mais qui reste en base est la panne qu'on ne voit pas.
	 *
	 *  ⚠ `updateEvaluation` l'écrit sans condition : tout appelant le fait
	 *  transiter inchangé. */
	group_id: string | null;
	/** Le nom du groupe. **Dérivé, jamais écrit.** */
	group_name: string | null;
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
 * Les quatre degrés de maîtrise. **Ils ne se saisissent plus, ils se lisent.**
 *
 * Jusqu'au palier 018, l'enseignant cliquait un degré et la note sur 20 en
 * était déduite. La chaîne est inversée : il saisit la note, et le degré n'est
 * plus qu'une façon de la nommer. Il n'y a donc plus de niveau `0` — « non
 * évalué » n'est pas un degré de maîtrise, c'est une case vide, et une case
 * vide n'a pas de libellé à porter.
 *
 * **Ils étaient cinq jusqu'au 2026-11-12.** « Presque maîtrisé » tenait le
 * milieu de l'échelle, hérité du classeur d'origine ; l'auteur l'a retiré, et
 * ce qui reste est mot pour mot l'échelle du LSU — celle que la famille lit
 * déjà sur le bulletin. Retirer un degré oblige à recouper les vingt points,
 * et c'est fait en tranches égales de cinq (décision du même jour, voir
 * `MASTERY_BANDS`).
 *
 * **Aucune note en base n'a bougé** : `grades.mark` est la donnée, le degré
 * n'en est que la lecture, et c'est précisément ce qui a rendu ce changement
 * possible sans migration. Mais un 9 qui se lisait « Presque maîtrisé » se lit
 * désormais « Maîtrise fragile » : un bilan imprimé avant cette date et le
 * même bilan réimprimé aujourd'hui peuvent porter deux libellés différents
 * pour la même note. C'est le prix du changement d'échelle, il a été dit, et
 * il n'y a pas de façon de l'éviter sans figer le libellé dans la base — ce
 * que le palier 018 a justement refusé de faire.
 */
export type MasteryLevel = 1 | 2 | 3 | 4;

export const MASTERY_LABELS: Record<MasteryLevel, string> = {
	1: "Maîtrise insuffisante",
	2: "Maîtrise fragile",
	3: "Maîtrise satisfaisante",
	4: "Très bonne maîtrise",
};

/** Forme courte des mêmes libellés, là où la colonne est trop étroite.
 *  Elle vit ici, collée à `MASTERY_LABELS` : une table d'abréviations rangée
 *  dans un composant divergerait le jour où un degré serait renommé. */
export const MASTERY_SHORT: Record<MasteryLevel, string> = {
	1: "MI",
	2: "MF",
	3: "MS",
	4: "TBM",
};

/** L'échelle dans l'ordre. Sert là où les quatre degrés se parcourent — une
 *  légende, l'axe d'un graphique, les colonnes à cocher d'un PDF.
 *  **Plus jamais une surface de saisie.**
 *
 *  Tout ce qui compte des colonnes les compte ici (`MASTERY_SCALE.length` dans
 *  `pdf.ts`), jamais en écrivant « 5 » : c'est ce qui a fait passer la grille
 *  imprimée de cinq colonnes à quatre sans qu'une seule largeur soit retouchée. */
export const MASTERY_LEVELS: MasteryLevel[] = [1, 2, 3, 4];

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
 * **Découpage choisi par l'auteur le 2026-11-12 : cinq points par degré.**
 *
 * ```text
 *    1 · 2 · 3 · 4 · 5   Maîtrise insuffisante
 *    6 · 7 · 8 · 9 · 10  Maîtrise fragile
 *   11 · 12 · 13 · 14 · 15  Maîtrise satisfaisante
 *   16 · 17 · 18 · 19 · 20  Très bonne maîtrise
 * ```
 *
 * Il y avait cinq tranches de quatre points jusqu'à cette date — découpage du
 * 2026-11-07, lui-même l'envers de la règle linéaire du 2026-10-13 où le degré
 * DONNAIT la note à raison de quatre points. Le retrait de « Presque
 * maîtrisé » a emporté ces bornes avec lui : quatre libellés ne se posent pas
 * sur un découpage taillé pour cinq. Les notes, elles, n'ont pas bougé d'un
 * point ; c'est leur lecture qui a changé, et elle seule.
 *
 * **C'EST LE SEUL ENDROIT OÙ CE DÉCOUPAGE EST ÉCRIT.** Ni le schéma, ni les
 * commandes Rust, ni un écran ne nomment un degré : le backend stocke et valide
 * un nombre, rien de plus. Deux découpages donneraient deux libellés pour la
 * même note sur deux écrans — et l'un des deux finirait imprimé.
 */
export const MASTERY_BANDS: Record<MasteryLevel, readonly [number, number]> = {
	1: [1, 5],
	2: [6, 10],
	3: [11, 15],
	4: [16, 20],
};

/**
 * Le degré de maîtrise d'une note : `plafond(note / 5)`, borné à l'échelle.
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
	const degre = Math.ceil(mark / 5);
	return Math.min(Math.max(degre, 1), 4) as MasteryLevel;
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
	3: "bg-green-100 text-green-700",
	4: "bg-emerald-100 text-emerald-800",
};

export interface Grade {
	evaluation_id: string;
	student_id: string;
	competency_id: string;
	/** Note entière de 1 à 20. Le libellé de maîtrise ne voyage pas avec elle :
	 *  il se lit par `labelDeNote`, et une seule fois. */
	mark: number;
}

/** Une case déclarée « cet élève ne sera pas évalué sur cette compétence »
 *  (palier 022).
 *
 *  **Le second sens de la ligne absente de `grades`.** Cette absence disait
 *  deux choses que rien ne distinguait : « je n'ai pas encore noté » et « je
 *  ne noterai jamais ». La première reste l'absence pure — la case est **en
 *  attente** ; la seconde est maintenant une ligne ici.
 *
 *  Pas de champ « motif » : la déclaration dit qu'il n'y aura pas de note,
 *  elle n'a pas à dire pourquoi. Et pas de note non plus — une case déclarée
 *  sort de la moyenne précisément parce qu'elle n'en porte aucune. */
export interface GradeWaiver {
	evaluation_id: string;
	student_id: string;
	competency_id: string;
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

/** Une entrée du référentiel professionnel : activité de référence, ou métier.
 *  Les deux ont la même forme et le même parent. */
export interface ReferentialItem {
	id: string;
	name: string;
	position: number;
}

/** Un domaine d'activité du référentiel RA16, et tout ce qui en dépend.
 *
 *  `getActivityReferential` rend l'arbre entier d'un champ professionnel en une
 *  fois — il tient en quelques dizaines de lignes —, donc changer de domaine
 *  dans l'écran ne recharge rien : on filtre sur place.
 *
 *  **Une liste vide n'est pas une panne.** Seul Habitat est semé (palier 024) ;
 *  les quatre autres champs du palier 009 n'ont pas de référentiel, et l'écran
 *  y garde ses champs de saisie libre. */
export interface ActivityDomain {
	id: string;
	name: string;
	position: number;
	activities: ReferentialItem[];
	careers: ReferentialItem[];
}

/** Les trois niveaux du référentiel RA16 que l'enseignant peut modifier.
 *
 *  Le **champ professionnel** n'en fait pas partie, et c'est une décision :
 *  sa liste appartient à l'auteur (« ne pas en ajouter ni en retirer sans
 *  l'auteur »), parce qu'une fiche contrat garde le libellé **figé** du champ
 *  qu'elle cite — renommer ou supprimer un champ se verrait sur des documents
 *  déjà remis. L'écran les affiche donc en en-têtes, sans geste d'écriture.
 *
 *  Les trois valeurs voyagent telles quelles vers Rust (`Ra16Kind`, sérialisé
 *  en `snake_case`) : ne pas les traduire ici. */
export type Ra16Kind = "domain" | "activity" | "career";

export const RA16_LABELS: Record<Ra16Kind, { one: string; many: string }> = {
	domain: { one: "domaine d'activité", many: "domaines d'activité" },
	activity: { one: "activité de référence", many: "activités de référence" },
	career: { one: "métier", many: "métiers" },
};

/** Une entrée du référentiel RA16, vue de l'écran qui le règle.
 *
 *  `sheet_count` est **rendu à la lecture** et non demandé au moment du clic.
 *  La suppression d'une entrée citée par une fiche contrat **réussit
 *  toujours** — `ON DELETE SET NULL` à côté d'un libellé figé, donc rien
 *  d'imprimé ne change —, et c'est exactement pourquoi il faut l'annoncer
 *  avant : un bouton qui échoue se comprend, un bouton qui réussit en
 *  silence laisse l'enseignant découvrir plus tard qu'une fiche a perdu son
 *  lien. */
export interface Ra16Item {
	id: string;
	name: string;
	position: number;
	sheet_count: number;
}

/** Un domaine d'activité et ses **deux listes sœurs**. Elles ne sont pas
 *  imbriquées l'une dans l'autre : un métier n'appartient pas à une activité
 *  de référence, les deux pendent du domaine. */
export interface Ra16Domain extends Ra16Item {
	activities: Ra16Item[];
	careers: Ra16Item[];
}

/** Un champ professionnel et ses domaines. **Les cinq champs sortent**, y
 *  compris les quatre que le palier 024 n'a pas semés : un champ sans domaine
 *  n'est pas une panne, c'est l'endroit où en ajouter. */
export interface Ra16Field {
	id: string;
	name: string;
	position: number;
	domains: Ra16Domain[];
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
	/** Les trois couples (clé, libellé figé) du palier 024, sur le modèle de
	 *  `professional_field_id` / `professional_field_label` : le libellé est ce
	 *  qui s'imprime, et il survit au retrait de l'entrée du référentiel.
	 *
	 *  Ils ne remplacent pas les trois champs libres ci-dessus, ils s'y
	 *  ajoutent : un champ professionnel sans référentiel continue de se saisir
	 *  à la main, et ce qui a déjà été tapé reste affiché et imprimé jusqu'à ce
	 *  que l'enseignant l'efface lui-même. */
	activity_domain_id: string | null;
	activity_domain_label: string;
	reference_activity_id: string | null;
	reference_activity_label: string;
	career_id: string | null;
	career_label: string;
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
	/** Séances tenues avec un **autre groupe** de la classe (palier 023).
	 *
	 *  Quatrième compteur, et il devait l'être pour la raison exacte qui avait
	 *  séparé le troisième du deuxième : une séance de l'atelier bois n'est ni
	 *  « hors de la période d'inscription » d'un élève inscrit depuis
	 *  septembre, ni une « absence justifiée » d'un élève qui n'était pas
	 *  absent — elle ne lui était pas destinée. Ces deux phrases s'impriment
	 *  telles quelles sur un document remis à une famille, donc l'y ranger
	 *  aurait fait mentir le bilan.
	 *
	 *  Vaut 0 tant qu'aucun groupe n'existe, c'est-à-dire sur toute base
	 *  migrée : la ligne ne s'affiche que lorsqu'elle a quelque chose à dire. */
	seances_autre_groupe: number;
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

// ---- Progression annuelle ----

/** Les trois sortes de lignes d'une progression.
 *
 *  Closes, à la différence de la catégorie d'un rendez-vous : ce n'est pas un
 *  vocabulaire d'établissement, c'est la forme des documents de l'auteur, et
 *  du code la lit pour composer le préfixe imprimé. Le backend refuse en
 *  français toute autre valeur, et le CHECK du schéma le redit. */
export type NatureDActivite = "analyse" | "activite" | "tp";

/** Le mot imprimé devant l'intitulé d'une ligne, par nature.
 *
 *  **Un seul endroit**, partagé par l'écran de la progression et le PDF : deux
 *  rédactions auraient fini par imprimer deux mots pour la même ligne. Ce
 *  n'est pas une pastille de couleur — `PastilleCategorie` reste le seul aplat
 *  de l'application. */
export const MOTS_DE_NATURE: Record<NatureDActivite, string> = {
	analyse: "Analyse de la situation",
	activite: "Activité",
	tp: "TP",
};

/** Les trois natures **dans l'ordre d'une séquence** : on analyse la situation,
 *  on mène des activités, on met en œuvre. C'est l'ordre des documents, et
 *  c'est celui du sélecteur — un menu rangé autrement se lirait comme une
 *  liste alphabétique et ferait chercher. */
export const NATURES_DACTIVITE: NatureDActivite[] = [
	"analyse",
	"activite",
	"tp",
];

/** Un domaine à explorer dans l'année — « Réaliser le clos », « Recyclage de
 *  palettes ».
 *
 *  **Livré vide**, comme les champs professionnels et les étiquettes de besoins :
 *  c'est le vocabulaire de l'enseignant, avec ses mots et son orthographe. Ne
 *  rien y semer. Global et non rattaché à une année : le même domaine revient
 *  d'une classe à l'autre et d'un septembre au suivant. */
export interface ProgressionDomaine {
	id: string;
	name: string;
	position: number;
	/** Combien d'activités s'y rattachent, toutes classes confondues.
	 *
	 *  Rendu par la lecture parce que l'écran en a besoin AVANT de proposer la
	 *  suppression : le backend refuse de supprimer un domaine employé, et
	 *  présenter un bouton qui échoue vaut moins que l'annoncer. */
	activity_count: number;
}

/** Une ligne de progression : ce qu'on fait, rattaché à une étape et à un
 *  domaine.
 *
 *  **Trois natures depuis le palier 026**, et elles ne sont pas le vocabulaire
 *  de l'enseignant : ce sont les trois sortes de lignes de ses deux documents,
 *  répétées à l'identique de la première séquence à la dernière. C'est pour
 *  cela qu'elles sont closes là où une catégorie de rendez-vous est libre —
 *  l'écran et le PDF en tirent le préfixe imprimé de la ligne. */
export interface ProgressionActivite {
	id: string;
	etape_id: string;
	/** Domaine, facultatif : une activité peut n'en relever d'aucun tant que
	 *  l'enseignant n'a pas tranché. */
	domaine_id: string | null;
	position: number;
	libelle: string;
	/** La sorte de ligne : `'analyse'` (« Analyse de la situation »),
	 *  `'activite'` (« Activité n »), `'tp'` (« TP : … »).
	 *
	 *  **`'activite'` est la valeur de toute ligne d'avant le palier 026** —
	 *  c'est ce qu'elles étaient, le modèle ne connaissait rien d'autre —, donc
	 *  une progression migrée s'imprime exactement comme la veille. */
	nature: NatureDActivite;
	/** L'objectif de la ligne, une phrase. Toujours introduit par
	 *  « Objectif : » dans les documents. Vide est le cas normal. */
	objectif: string;
	/** Les compétences évaluées par CETTE ligne, **dans l'ordre du
	 *  référentiel**.
	 *
	 *  L'activité les **gagne** au palier 026, elle ne les **prend pas** à
	 *  l'étape : les deux niveaux coexistent, parce que la colonne
	 *  « Compétences évaluées » des documents est remplie ligne par ligne alors
	 *  que l'auteur avait rattaché les compétences à l'étape le 2026-11-07. Une
	 *  progression saisie avant ce palier a donc toutes ses compétences à
	 *  l'étape et aucune ici, et c'est une lecture valide, pas un trou. */
	competences_ref: CompetencyInfo[];
	/** Rang de l'activité dans l'ANNÉE, calculé par le backend en parcourant les
	 *  étapes puis les activités de chacune.
	 *
	 *  **C'est lui, et rien d'autre, qui donne sa couleur à l'activité**
	 *  (`styleTeinteActivite`). Calculé une fois côté Rust pour que l'écran et le
	 *  PDF ne puissent pas colorier différemment la même activité. Ne pas le
	 *  recalculer ici à partir de l'index d'un `map` : un filtre d'affichage
	 *  changerait les couleurs sans rien changer à l'année. */
	rang: number;
}

/** Une étape de l'année : l'échelon entre l'année et l'activité.
 *
 *  Elle porte les compétences, les connaissances et les priorités. Les
 *  **compétences viennent du référentiel** depuis le palier 021 : l'auteur a
 *  rouvert le 2026-11-09 sa propre décision du 2026-11-07 (« en texte libre, il
 *  écrit des phrases »), et c'était cohérent — les compétences semées viennent
 *  de son tableau, donc il retapait à la main ce que la base avait déjà. */
export interface ProgressionEtape {
	id: string;
	position: number;
	libelle: string;
	/** Les compétences cochées, **dans l'ordre du référentiel** — celui que
	 *  Réglages fixe, pas celui des clics : la table de rattachement ne porte
	 *  aucune position, pour qu'une compétence déplacée là-bas se déplace du même
	 *  coup dans toutes les progressions déjà écrites. */
	competences_ref: CompetencyInfo[];
	/** Le texte libre d'avant le palier 021, **gardé tel quel**.
	 *
	 *  Il s'affiche en lecture seule tant qu'il n'est pas vide, et seul un geste
	 *  de l'enseignant l'efface. Ne pas le vider à sa place, et le faire
	 *  **transiter** à chaque `updateProgressionEtape` : l'omettre l'enverrait
	 *  vide, et un simple renommage d'étape effacerait ses phrases. */
	competences: string;
	connaissances: string;
	priorites: string;
	/** Les objectifs de la séquence — « réaliser une boîte ».
	 *
	 *  Palier 026, et volontairement **à part de `connaissances`** : un but n'est
	 *  pas un savoir, et les loger ensemble les ferait imprimer sous un intitulé
	 *  faux sur un document punaisé au mur. */
	objectifs: string;
	/** Le métier et le CAP découverts pendant la séquence — « Découvrir le métier
	 *  et le CAP de dessinateur industriel ».
	 *
	 *  **Du texte libre, et non une clé vers le référentiel des métiers** : les
	 *  vingt-et-un métiers semés au palier 024 sont ceux de la roue du champ
	 *  Habitat, et la séquence qui a motivé la colonne nomme « dessinateur
	 *  industriel », qui n'en est pas. Le lien au référentiel a sa place dans la
	 *  fiche contrat, qui est nominative ; une étape est un plan de classe. */
	metier_cap: string;
	/** Ses activités, dans l'ordre. L'étape détient les activités, **pas les
	 *  semaines** : une activité peut revenir en janvier sans que l'étape se
	 *  dédouble. */
	activites: ProgressionActivite[];
}

/** Une case de la frise : telle activité, telle semaine, telle bande.
 *
 *  La semaine se désigne par son **lundi**, une date, jamais par un numéro ISO —
 *  un numéro n'a pas d'année et la semaine 1 de 2027 suit la 53 de 2026. */
export interface ProgressionPlage {
	week_monday: string;
	/** La bande : 0 ou 1, et rien d'autre. La frise n'en a que deux. */
	voie: 0 | 1;
	activite_id: string;
}

/** La progression annuelle d'une classe. **Une seule par classe.** */
export interface Progression {
	id: string;
	session_id: string;
	titre: string;
	/** L'intitulé de groupe imprimé en tête du document — « Gr 2 ».
	 *
	 *  Un **libellé**, pas une entité : il n'existe pas d'objet « groupe » dans le
	 *  modèle, et rien ne s'y rattache. */
	intitule_groupe: string;
	devise: string;
	etapes: ProgressionEtape[];
	/** Toutes les cases posées, à plat. L'écran les indexe par `(lundi, voie)` ;
	 *  les garder à plat évite une structure creuse de quarante-cinq semaines dont
	 *  la plupart sont vides. */
	plages: ProgressionPlage[];
}
