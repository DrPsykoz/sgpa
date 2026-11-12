/**
 * Ce qu'une journée contient, lu d'une seule façon.
 *
 * Deux calendriers montrent la même journée sous deux formes — celui de
 * l'accueil (`DaysCalendar`), en colonnes de jours ouvrés, et la grille de la
 * semaine (`WeekGrid`), en sept colonnes datées. Les aides de ce fichier sont
 * leur règle commune : `buildRows` dit quelles lignes une journée porte,
 * `motifDeFermeture` dit pourquoi elle n'en porte pas, `absenceDuCreneau`,
 * `motsDeAbsence` et `motsDesAbsences` disent pourquoi un cours ne se tient
 * pas, `timeLabel`, `slotTitle`, `studentName` et `cibleDuRendezVous` disent
 * comment elles s'écrivent.
 *
 * Deux fonctions décidant chacune de son côté ce qu'une journée contient
 * auraient divergé au premier créneau à quinzaine, et l'accueil aurait annoncé
 * un cours que l'emploi du temps ne montre pas. Une seule règle, deux rendus.
 *
 * Deux aides ne disent pas ce qu'une journée CONTIENT mais ce qu'elle
 * MÈNE ou ce qu'elle EXPLIQUE, et elles sont ici pour la même raison que les
 * autres : `adresseDeLaSeance` est l'unique rédaction de l'adresse où une
 * séance se modifie — trois écrans y conduisent —, `absencesGroupees` et
 * `motsDeLegende` sont la légende des absences, que l'en-tête d'une colonne de
 * six caractères ne peut pas porter.
 *
 * La distinction entre les deux portées mérite une ligne à part : le JOUR
 * fermé pour tout le monde — vacances, férié — retire toutes ses cartes, parce
 * que l'en-tête de la colonne le dit une fois pour toutes et que vingt-quatre
 * cartes estompées le rediraient vingt-quatre fois ; la CLASSE hors cours, en
 * stage, **garde ses cartes** et les estompe, avec le motif écrit dessus. Les
 * confondre referait, à l'envers, le défaut que le palier 006 a corrigé.
 *
 * Le palier 023 en ajoute une troisième, et c'est la plus étroite : un GROUPE
 * hors cours n'estompe que les cartes de **son** groupe. Le cours de classe
 * entière, lui, se tient — l'autre moitié de l'atelier est là, et on attend
 * son appel.
 *
 * Le motif a cessé d'être une chaîne et devient l'enregistrement lui-même
 * (`absenceDuCreneau`) : depuis le palier 020 une période porte deux drapeaux
 * — l'appel se fait quand même, le professeur était absent — et un booléen
 * « masqué » ne pouvait plus les dire. Les mots, eux, restent ici et nulle part
 * ailleurs : trois rédactions dans trois fichiers auraient divergé.
 *
 * **Aucun rendu ici, et c'est le sens du nom.** Ce fichier s'appelait
 * `DayList.tsx` et portait en plus la liste de l'onglet « Journée » de l'emploi
 * du temps, avec ses pastilles et ses deux boutons d'écriture. Cet onglet a
 * disparu : l'emploi du temps ne sert qu'à **définir** l'emploi du temps, et
 * c'est l'accueil qui montre le jour même et les suivants. Les aides, elles,
 * servaient déjà les deux calendriers ; elles restent, seules, sous un nom qui
 * dit ce qu'elles font.
 */
import type {
  AgendaEntrySummary,
  DaySchedule,
  DaySeance,
  SessionAway,
  TimetableSlot,
} from "@/types";

/**
 * Pourquoi personne ne fait cours ce jour-là, ou `null`.
 *
 * Le férié passe AVANT les vacances quand les deux tombent : « Toussaint » est
 * plus précis que « Vacances de la Toussaint » sur la journée du 1er novembre,
 * et c'est ce que l'enseignant cherche à lire. Le backend rend les deux ; c'est
 * ici qu'on choisit.
 */
export function motifDeFermeture(day: DaySchedule): string | null {
  if (day.closures.length === 0) return null;
  const ferie = day.closures.find((c) => c.origin === "ferie");
  return (ferie ?? day.closures[0]).label;
}

/**
 * La période qui met cette classe hors cours ce jour-là, ou `null`.
 *
 * **C'est l'enregistrement brut, et c'est fait pour PEINDRE.** Les deux
 * calendriers ne retirent plus la carte d'un cours dont la classe est ailleurs :
 * ils la laissent en place et l'estompent, exactement comme un créneau de
 * quinzaine qui ne tombe pas cette semaine — « une case disparue passerait pour
 * un créneau perdu », et c'est le même raisonnement. Ils ont donc besoin du
 * motif, pas d'un booléen.
 *
 * `attendance_expected` rend `null`, et ce n'est pas un oubli : la classe est
 * ailleurs mais **l'appel se fait** — sortie scolaire, séjour, CDI. Le cours a
 * lieu, sa carte ne change pas, et l'estomper ferait disparaître à l'œil la
 * séance dont on attend justement l'appel.
 *
 * Une période nominative n'entre jamais ici (le backend ne la rend pas) : la
 * classe est là, un élève manque. Les confondre referait, à l'envers, le défaut
 * que le palier 006 a corrigé.
 *
 * ⚠ **Le prédicat de l'écran n'est pas celui du bilan, et c'est voulu.** Une
 * période qui vise un groupe n'écarte que les créneaux de ce groupe : un cours
 * de classe entière pendant le stage du groupe 1 **a lieu**, l'autre moitié de
 * l'atelier est là, et l'estomper ferait disparaître à l'œil la séance dont on
 * attend justement l'appel. D'où un prédicat qui n'est pas symétrique :
 *
 *     away.group_id === null || away.group_id === groupId
 *
 * Le bilan, lui, retire bien cette séance de classe entière du dénominateur
 * des élèves du groupe parti — `reports::ATTENDANCE_SQL` teste le groupe de
 * l'**élève**, pas celui de la séance. Les deux disent la même vérité depuis
 * deux points de vue : la carte parle du cours, le bilan parle de l'élève. Les
 * aligner en casserait une.
 */
export function absenceDuCreneau(
  day: DaySchedule,
  sessionId: string | null,
  groupId: string | null,
): SessionAway | null {
  if (sessionId === null) return null;
  const candidates = day.sessions_away.filter(
    (c) =>
      c.session_id === sessionId &&
      (c.group_id === null || c.group_id === groupId),
  );
  // Deux périodes peuvent couvrir le même créneau depuis le palier 023 — le
  // groupe 1 en stage pendant que la classe entière est au CDI —, et c'est
  // celle qui écarte le cours qui décide du dessin : chercher la première
  // venue aurait rendu `null` une fois sur deux, au gré de l'ordre des lignes.
  return candidates.find((c) => !c.attendance_expected) ?? null;
}

/** « 4ᵉ A », ou « 4ᵉ A · Groupe 1 » quand la période ne vise qu'un groupe.
 *
 *  Un seul endroit : la ligne de la colonne, le bandeau et l'infobulle doivent
 *  nommer la même chose, et trois concaténations auraient fini par écrire trois
 *  formes du même couple. */
function cibleDeAbsence(away: SessionAway): string {
  return away.group_name
    ? `${away.session_name} · ${away.group_name}`
    : away.session_name;
}

/**
 * Le groupe que porte un cours : **le fait avant le réglage**.
 *
 * Celui de la SÉANCE quand elle existe, celui du créneau sinon. Les deux
 * peuvent différer sans que rien ne soit cassé : l'occurrence recopie le
 * groupe du créneau à sa naissance, et changer le créneau ensuite ne réécrit
 * aucune séance passée — un fait ne suit pas un réglage, c'est la même règle
 * qui met `seances.group_id` en RESTRICT et `timetable_slots.group_id` en SET
 * NULL.
 *
 * Partagé par les deux calendriers, parce qu'il sert **deux fois sur la même
 * carte** : le nom qu'elle affiche et le groupe qu'`absenceDuCreneau` compare.
 * Deux rédactions auraient fini par estomper la carte d'après un groupe et en
 * écrire un autre dessus.
 */
export function groupeDuCours(
  slot: TimetableSlot,
  seance: DaySeance | null,
): { id: string | null; nom: string | null } {
  return seance === null
    ? { id: slot.group_id, nom: slot.group_name }
    : { id: seance.group_id, nom: seance.group_name };
}

/**
 * Les mots d'une classe hors cours — un vocabulaire, trois longueurs.
 *
 * Même doctrine que `motsDuCahier` : la carte n'a la place que de deux mots, le
 * bandeau d'une ligne, l'infobulle d'une phrase, et les trois doivent dire la
 * même chose. Trois rédactions dans trois fichiers auraient divergé au premier
 * ajustement.
 *
 * **Le professeur absent ne se dit pas « classe absente ».** La classe était
 * là ; c'est le cours qui n'a pas eu lieu. Nommer la classe à sa place serait
 * faux, et l'enseignant qui relit son année ne retrouverait pas pourquoi la
 * semaine est vide.
 */
export function motsDeAbsence(away: SessionAway): {
  carte: string;
  bandeau: string;
  infobulle: string;
} {
  // Une période de groupe ne retire pas le cours de toute la classe, et la
  // phrase ne doit pas le dire : l'autre moitié de l'atelier a cours, et
  // l'enseignant qui relit sa semaine chercherait en vain pourquoi elle est
  // vide. Une absence du professeur ne porte jamais de groupe — il n'est pas
  // absent pour la moitié d'une classe —, donc elle lit toujours la première
  // phrase.
  const consequence = away.group_name
    ? `Le cours de ce groupe ne se tient pas : hors du dénominateur d'assiduité de « ${away.group_name} », les autres élèves de la classe ayant cours.`
    : "Le cours ne se tient pas : hors du dénominateur d'assiduité de toute la classe.";
  if (away.teacher_absent) {
    return {
      carte: "Professeur absent",
      bandeau: `Professeur absent — ${away.reason}`,
      infobulle: `Professeur absent — ${away.reason}. ${consequence}`,
    };
  }
  const cible = cibleDeAbsence(away);
  return {
    carte: away.reason,
    bandeau: `${cible} — ${away.reason}`,
    infobulle: `${cible} hors cours — ${away.reason}. ${consequence}`,
  };
}

/**
 * La ligne d'un bandeau pour une période, **les trois cas compris**.
 *
 * `motsDeAbsence` ne couvre que ce qui change l'emploi du temps ; une sortie
 * scolaire se dit autrement — la classe est ailleurs mais l'appel se fait,
 * donc « hors cours » serait faux. Les deux formulations vivent ici parce que
 * deux écrans les écrivent : le bandeau de l'accueil et le détail de l'en-tête
 * de colonne. Elles s'étaient déjà écartées une fois, l'accueil nommant la
 * classe là où la colonne nommait la cible complète.
 */
export function bandeauDeAbsence(away: SessionAway): string {
  return away.attendance_expected
    ? `${cibleDeAbsence(away)} — ${away.reason} (l'appel se fait)`
    : motsDeAbsence(away).bandeau;
}

/**
 * Ce que la journée dit de ses classes hors cours, en une seule ligne.
 *
 * L'en-tête d'une colonne de semaine fait six caractères de large : il ne peut
 * pas porter quatre motifs. La ligne dit donc **ce qui change** — le professeur
 * manquait, ou telle classe n'est pas là —, et le `detail` porte chaque période
 * avec son motif, pour le `title=`.
 *
 * Les périodes « l'appel se fait quand même » ne comptent pas dans la ligne et
 * figurent dans le détail : rien ne change à l'emploi du temps ce jour-là, donc
 * les annoncer comme une absence mentirait sur la carte restée vive. Et une
 * absence du professeur écrit une ligne par classe cochée — sans ce
 * dédoublonnage, un en-tête répéterait « Professeur absent » quatre fois.
 */
function ligneDesClasses(classes: readonly SessionAway[]): string | null {
  if (classes.length === 0) return null;
  if (classes.length === 1) return `${cibleDeAbsence(classes[0])} hors cours`;
  // Deux groupes de la même classe ne font pas deux classes absentes : le
  // compte porte sur les classes DISTINCTES, sans quoi un atelier dont les
  // deux groupes partent chacun leur tour afficherait « 2 classes hors cours »
  // là où il n'y en a qu'une.
  const noms = new Set(classes.map((a) => a.session_name));
  if (noms.size > 1) return `${noms.size} classes hors cours`;
  return classes.every((a) => a.group_name !== null)
    ? `${classes[0].session_name} — ${classes.length} groupes hors cours`
    : `${classes[0].session_name} hors cours`;
}

export function motsDesAbsences(
  day: DaySchedule,
): { ligne: string; detail: string } | null {
  if (day.sessions_away.length === 0) return null;

  const parts: string[] = [];
  if (day.sessions_away.some((a) => a.teacher_absent)) {
    parts.push("Professeur absent");
  }
  const classes = day.sessions_away.filter(
    (a) => !a.teacher_absent && !a.attendance_expected,
  );
  const ligneClasses = ligneDesClasses(classes);
  if (ligneClasses !== null) parts.push(ligneClasses);

  const detail = day.sessions_away.map(bandeauDeAbsence).join(" · ");

  // Rien qui change, mais quelque chose à dire : la ligne reprend alors le
  // détail plutôt que de rester vide, parce qu'une colonne muette laisserait
  // croire qu'aucune période n'a été saisie.
  return { ligne: parts.length > 0 ? parts.join(" · ") : detail, detail };
}

/**
 * Les quatre formes de ligne de la journée.
 *
 * `cours` et `occupation` viennent toutes deux d'un créneau : c'est
 * `session_id` qui les sépare, et rien d'autre — il n'existe aucune colonne
 * `kind` dans le schéma, justement pour qu'une seconde source de vérité ne
 * puisse pas contredire la première.
 */
export type Row =
  | {
      key: string;
      time: string;
      kind: "cours";
      slot: TimetableSlot;
      seance: DaySeance | null;
    }
  | { key: string; time: string; kind: "occupation"; slot: TimetableSlot }
  | { key: string; time: string; kind: "seance"; seance: DaySeance }
  | { key: string; time: string; kind: "entree"; entry: AgendaEntrySummary };

export function buildRows(day: DaySchedule): Row[] {
  const rows: Row[] = [];

  for (const { slot, seance } of day.slots) {
    rows.push(
      slot.session_id === null
        ? {
            key: `slot:${slot.id}`,
            time: slot.start_time,
            kind: "occupation",
            slot,
          }
        : {
            key: `slot:${slot.id}`,
            time: slot.start_time,
            kind: "cours",
            slot,
            seance,
          },
    );
  }

  // Troisième source, et surtout pas du confort : sans elle, une séance créée
  // depuis l'écran de la classe n'apparaîtrait pas dans la journée, « Créer et
  // ouvrir » resterait proposé sur le créneau, et l'enseignant tiendrait deux
  // appels pour le même cours.
  for (const seance of day.loose_seances) {
    rows.push({
      key: `seance:${seance.id}`,
      time: seance.start_time,
      kind: "seance",
      seance,
    });
  }

  for (const entry of day.entries) {
    rows.push({
      key: `entry:${entry.id}`,
      time: entry.start_time,
      kind: "entree",
      entry,
    });
  }

  // Tri stable : les lignes sans horaire ouvrent la journée. `''` est l'« heure
  // à caler » d'une entrée saisie à la volée, et l'horaire absent des séances
  // antérieures au palier 004 : ni l'une ni l'autre n'a sa place dans la grille.
  return rows.sort((a, b) => {
    if (a.time === b.time) return 0;
    if (a.time === "") return -1;
    if (b.time === "") return 1;
    return a.time < b.time ? -1 : 1;
  });
}

export function timeLabel(start: string, end: string): string {
  if (!start && !end) return "";
  if (!end) return start;
  if (!start) return `jusqu'à ${end}`;
  return `${start} – ${end}`;
}

/** Intitulé d'un créneau : le libellé porte le cours, la classe le situe. */
export function slotTitle(slot: TimetableSlot): string {
  const label = slot.label.trim();
  const session = slot.session_name ?? "";
  if (label && session) return `${label} — ${session}`;
  return label || session || "Créneau sans intitulé";
}

export function studentName(entry: AgendaEntrySummary): string | null {
  if (entry.student_id === null) return null;
  const name =
    `${entry.student_last_name ?? ""} ${entry.student_first_name ?? ""}`.trim();
  return name || null;
}

/**
 * Qui ou quoi un rendez-vous concerne, en une ligne : l'élève s'il y en a un,
 * sinon la classe, sinon rien.
 *
 * L'élève passe devant la classe parce qu'il la contient — un élève
 * n'appartient qu'à une classe, donc nommer les deux sur une carte de 7 rem
 * répéterait une information pour en chasser une autre. Un conseil de classe,
 * lui, n'a que sa classe à dire.
 *
 * `null` est une réponse normale, pas un défaut : une réunion de secteur ne
 * concerne ni classe ni élève, et la carte n'affiche alors pas de seconde
 * ligne.
 */
export function cibleDuRendezVous(entry: AgendaEntrySummary): string | null {
  return studentName(entry) ?? entry.session_name ?? null;
}

/**
 * L'adresse où une séance se modifie : l'onglet « Séances » de sa classe,
 * ouvert sur elle.
 *
 * **Une seule rédaction pour trois appelants.** L'accueil y menait déjà par
 * deux gabarits écrits à la main, et la grille de la semaine en a eu besoin
 * d'un troisième le jour où le cours ponctuel a cessé d'être une carte inerte.
 * Trois `?onglet=seances&ouvrir=…` recopiés auraient divergé au premier
 * renommage de paramètre, et l'écran serait alors arrivé sur le bon onglet sans
 * ouvrir la séance — un défaut muet, puisque la page s'affiche.
 *
 * Ce n'est pas du rendu : c'est l'endroit où mène une ligne de journée, au même
 * titre que `motifDeFermeture` dit pourquoi elle n'en porte pas.
 */
export function adresseDeLaSeance(seance: DaySeance): string {
  return `/classes/${seance.session_id}?onglet=seances&ouvrir=${seance.id}`;
}

/** Une absence telle que la légende d'une semaine la présente : la période une
 *  seule fois, et les jours de la semaine affichée qu'elle couvre. */
export interface AbsenceDeSemaine {
  cle: string;
  away: SessionAway;
  /** Dates AAAA-MM-JJ, dans l'ordre d'affichage des journées reçues. */
  jours: string[];
}

/**
 * Les absences de plusieurs journées, regroupées **une fois par période**.
 *
 * Le backend rend `sessions_away` journée par journée : un stage d'une semaine
 * arrive donc cinq fois. Les recopier cinq fois dans une légende la rendrait
 * illisible précisément dans le cas qui la justifie — plusieurs classes
 * absentes la même semaine.
 *
 * Le regroupement se fait sur la **classe, le groupe, les deux drapeaux et le
 * motif**, et non sur un identifiant de période : `SessionAway` n'en porte pas,
 * parce que rien à l'écran n'en avait besoin jusqu'ici. Deux périodes distinctes
 * de même motif pour la même classe fusionneraient donc en une ligne ; c'est
 * sans conséquence, la légende disant ce qui se passe et non combien de lignes
 * la base contient. Le groupe, lui, est dans la clé : le stage du groupe 1 et
 * celui du groupe 2 portent le même motif sur la même classe, et les fondre
 * aurait effacé la moitié de la frise.
 */
export function absencesGroupees(
  days: readonly DaySchedule[],
): AbsenceDeSemaine[] {
  const parPeriode = new Map<string, AbsenceDeSemaine>();
  for (const day of days) {
    for (const away of day.sessions_away) {
      const cle = [
        away.session_id,
        away.group_id ?? "",
        away.teacher_absent ? "1" : "0",
        away.attendance_expected ? "1" : "0",
        away.reason,
      ].join("|");
      const deja = parPeriode.get(cle);
      if (deja === undefined) {
        parPeriode.set(cle, { cle, away, jours: [day.date] });
      } else {
        deja.jours.push(day.date);
      }
    }
  }
  // Par premier jour, puis par classe : l'ordre de la grille, qui se lit de
  // gauche à droite. Trier par classe d'abord mettrait en tête une absence du
  // vendredi au-dessus de celle du lundi.
  return [...parPeriode.values()].sort((a, b) => {
    const ja = a.jours[0] ?? "";
    const jb = b.jours[0] ?? "";
    if (ja !== jb) return ja < jb ? -1 : 1;
    return a.away.session_name.localeCompare(b.away.session_name, "fr");
  });
}

/**
 * Ce qu'une absence est, et ce qu'elle change : les deux lignes d'une légende.
 *
 * **C'est le manque que l'enseignant a signalé.** L'en-tête d'une colonne fait
 * six caractères : il écrit « 2 classes hors cours », ce qui est vrai et
 * inutilisable — ni laquelle, ni pourquoi, ni ce que l'assiduité en fait. Le
 * `title=` le disait, mais une infobulle ne se découvre pas.
 *
 * Les trois cas du palier 020 en trois effets, et c'est **ici** qu'ils
 * s'écrivent, comme `motsDeAbsence` écrit ceux de la carte : deux rédactions
 * finiraient par ne pas dire la même chose de la même période.
 */
export function motsDeLegende(away: SessionAway): {
  quoi: string;
  effet: string;
} {
  if (away.teacher_absent) {
    return {
      quoi: `Professeur absent — ${away.reason}`,
      effet:
        "Personne n'a assuré le cours : il sort de l'assiduité, et l'accueil ne réclame rien.",
    };
  }
  // Le groupe devant le motif, et non dans la pastille : celle-ci porte le nom
  // de la CLASSE et sa teinte, pour se lire comme la légende de la carte
  // qu'elle explique. Y glisser le groupe aurait fait deux pastilles, ou une
  // pastille qui ne ressemble plus à aucune carte.
  const quoi = away.group_name
    ? `${away.group_name} — ${away.reason}`
    : away.reason;
  if (away.attendance_expected) {
    return {
      quoi,
      effet: away.group_name
        ? "Ce groupe est ailleurs, mais l'appel se fait : manquer est une absence comme une autre."
        : "La classe est ailleurs, mais l'appel se fait : manquer est une absence comme une autre.",
    };
  }
  return {
    quoi,
    effet: away.group_name
      ? "Ce groupe est ailleurs : ses cours sortent de son calcul d'assiduité, et les autres élèves gardent les leurs."
      : "La classe est ailleurs : ses cours sortent du calcul d'assiduité.",
  };
}
