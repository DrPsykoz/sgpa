/**
 * Arithmétique du temps et placement en voies — l'unique géométrie des
 * calendriers de l'application.
 *
 * Deux écrans dessinent une journée, et ils ne la dessinent pas pareil :
 * `WeekGrid` en grille de sept colonnes datées sur l'emploi du temps,
 * `DaysCalendar` en colonnes de jours ouvrés sur l'accueil. Les deux sont des
 * **calendriers** : ils posent chaque contenu à sa place exacte, à la minute,
 * et doivent répartir en voies ce qui se chevauche.
 *
 * Ce module existe parce que cette arithmétique-là était écrite dans
 * `WeekGrid`. La recopier sur l'accueil aurait donné deux calendriers qui
 * placent 9h25 à deux endroits différents, et qui divergeraient au premier
 * ajustement d'amplitude. Une seule règle, deux rendus — même raison que les
 * aides de lecture exportées par `journee.ts`.
 *
 * Aucune arithmétique de CALENDRIER ici : pas de `getDay()`, pas de date. Les
 * dates, le jour ISO, le numéro de semaine et la parité arrivent tout faits du
 * backend. On ne manipule que des minutes depuis minuit.
 */

// ---------------------------------------------------------------------------
// Heures
// ---------------------------------------------------------------------------

/** « 08:30 » → 510. `null` si l'heure est vide ou mal formée : une séance
 *  antérieure au palier 004 porte `''`, et elle n'a rien à faire dans la
 *  géométrie. */
export function toMinutes(time: string): number | null {
  if (time.length !== 5 || time[2] !== ":") return null;
  const heures = Number(time.slice(0, 2));
  const minutes = Number(time.slice(3));
  if (!Number.isInteger(heures) || !Number.isInteger(minutes)) return null;
  if (heures < 0 || heures > 23 || minutes < 0 || minutes > 59) return null;
  return heures * 60 + minutes;
}

export function fromMinutes(total: number): string {
  const heures = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(heures).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Dernière heure de fin qui existe vraiment.
 *
 *  La grille s'étire jusqu'à minuit pour loger un rendez-vous tardif : une
 *  entrée d'agenda 22:00–23:15 pousse l'amplitude à 1440, la dernière bande
 *  commence à 23:30, et sa fin retombe sur « 24:00 ». Cette chaîne n'est pas
 *  une heure : `toMinutes` la refuse, et l'`<input type="time">` du dialogue
 *  laisse le champ de fin vide sans rien dire. L'amplitude peut atteindre
 *  minuit ; l'heure qu'on en tire, non. */
export const FIN_MAX = 23 * 60 + 55;

export function heureFinDe(total: number): string {
  return fromMinutes(Math.min(total, FIN_MAX));
}

/** Repère de la colonne des heures : « 08h ». */
export function libelleHeure(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}h`;
}

/** Horaire lisible, y compris quand une borne manque. Même règle que
 *  `journee.timeLabel` — les deux écrans écrivent « 08:30 – 09:25 ». */
export function libelleHoraire(debut: string, fin: string): string {
  if (!debut && !fin) return "";
  if (!fin) return debut;
  if (!debut) return `jusqu'à ${fin}`;
  return `${debut} – ${fin}`;
}

// ---------------------------------------------------------------------------
// Géométrie
// ---------------------------------------------------------------------------

/** Pas de 5 minutes : seule granularité qui encaisse à la fois un cours de
 *  55 minutes et un atelier de 3 h, et qui tombe juste sur 9h25. */
export const PAS = 5;

/** Hauteur d'un pas, en pixels — une heure occupe donc 48 px. */
export const HAUTEUR_PAS = 4;

/** Hauteur d'une bande d'une demi-heure, en pixels : 24. C'est le quadrillage
 *  que l'enseignant voit, donc l'unité sur laquelle le tracé à la souris
 *  s'aligne. Elle se déduit des deux constantes au-dessus, elle ne se recopie
 *  pas à la main. */
export const HAUTEUR_DEMIE = (30 / PAS) * HAUTEUR_PAS;

/**
 * Amplitude plancher : 8h → 20h.
 *
 * La grille s'étire pour accueillir les créneaux réels, mais ne se rétrécit
 * jamais en deçà : sinon supprimer le dernier cours de l'après-midi ferait
 * sauter la grille d'une taille à l'autre sous les yeux.
 *
 * Le plancher n'est pas qu'un confort d'affichage, c'est ce qui rend un horaire
 * SAISISSABLE : on ne peut tracer une plage que sur une bande dessinée. Avec un
 * plancher à 17h, un atelier de 18h à 19h n'avait aucun geste pour naître — et
 * rien à l'écran ne disait pourquoi. 20h couvre l'étude, la réunion
 * parents-professeurs et le conseil de classe ; au-delà, un rendez-vous tardif
 * reste saisissable au dialogue et la grille s'étire pour le montrer.
 */
export const AMPLITUDE_MIN = 8 * 60;
export const AMPLITUDE_MAX = 20 * 60;

/** Un plancher d'amplitude : la tranche toujours dessinée, même vide. */
export interface Plancher {
  debut: number;
  fin: number;
}

/** Le plancher des grilles où l'on SAISIT un horaire — 8h à 20h, pour la raison
 *  donnée ci-dessus. C'est la valeur par défaut d'`amplitudeDe`. */
export const PLANCHER_SAISIE: Plancher = {
  debut: AMPLITUDE_MIN,
  fin: AMPLITUDE_MAX,
};

/**
 * Le plancher des calendriers en LECTURE SEULE — 8h à 12h.
 *
 * L'argument du plancher à 20h est celui de la saisie : on ne peut tracer une
 * plage que sur une bande dessinée. Un calendrier qui n'ouvre aucun dialogue
 * n'a pas ce besoin, et garder douze heures de bandes dont les trois quarts
 * sont vides lui coûte six cents pixels pour rien. Quatre heures suffisent à ce
 * qu'une journée sans cours ressemble encore à une matinée ; au-delà, le
 * contenu réel étire la grille comme partout ailleurs — un atelier de 18h à 19h
 * s'y dessine donc en entier.
 */
export const PLANCHER_LECTURE: Plancher = {
  debut: AMPLITUDE_MIN,
  fin: AMPLITUDE_MIN + 4 * 60,
};

/**
 * Amplitude à dessiner pour un lot de contenus déjà placés.
 *
 * Arrondie à l'heure pleine des deux côtés, pour que la colonne des heures
 * tombe juste : un cours de 7h45 descend le début à 7h, un conseil qui finit à
 * 20h30 monte la fin à 21h.
 *
 * Le plancher est la tranche dessinée en l'absence de contenu. Il ne se
 * rétrécit jamais sous les pieds de l'utilisateur : sans lui, supprimer le
 * dernier cours de l'après-midi ferait sauter la grille d'une taille à l'autre
 * sous les yeux.
 */
export function amplitudeDe(
  bornes: readonly { debut: number; fin: number }[],
  plancher: Plancher = PLANCHER_SAISIE,
): { debut: number; fin: number } {
  let debut = plancher.debut;
  let fin = plancher.fin;
  for (const borne of bornes) {
    debut = Math.min(debut, Math.floor(borne.debut / 60) * 60);
    fin = Math.max(fin, Math.ceil(borne.fin / 60) * 60);
  }
  return { debut, fin };
}

/** Un contenu a-t-il une position défendable dans la grille horaire ? Sinon il
 *  part dans la rangée « hors horaire » plutôt que d'être posé quelque part au
 *  jugé : `start_time = ''` est un cas encouragé par le dialogue des
 *  rendez-vous, pas une donnée abîmée. */
export function estPlacable(debut: string, fin: string): boolean {
  const d = toMinutes(debut);
  const f = toMinutes(fin);
  return d !== null && f !== null && f > d;
}

// ---------------------------------------------------------------------------
// Voies
// ---------------------------------------------------------------------------

/** Un contenu candidat au placement, avec ses deux horaires bruts. Le type du
 *  contenu reste celui de l'appelant : la géométrie ne sait pas, et n'a pas à
 *  savoir, si elle place un créneau, une séance ou un rendez-vous. */
export interface Candidat<T> {
  cle: string;
  contenu: T;
  debut: string;
  fin: string;
}

/** Un contenu replacé dans la grille : bornes en minutes, et la voie qu'il
 *  occupe quand plusieurs contenus se chevauchent le même jour. */
export interface Place<T> {
  cle: string;
  contenu: T;
  debut: number;
  fin: number;
  voie: number;
  voies: number;
}

/**
 * Répartit en voies les contenus d'une même journée.
 *
 * Le chevauchement n'est pas une anomalie à signaler : une co-intervention ou
 * une barrette est légitime, et le plan a explicitement renoncé à l'avertir.
 * Il reste à le DESSINER — sans voies, deux contenus simultanés se recouvrent
 * et le second devient invisible. Une réunion datée par-dessus un cours du
 * modèle relève exactement du même dessin, d'où la liste commune.
 */
export function placer<T>(candidats: readonly Candidat<T>[]): Place<T>[] {
  const bornes = candidats
    .map((candidat) => {
      const debut = toMinutes(candidat.debut);
      const fin = toMinutes(candidat.fin);
      return debut === null || fin === null || fin <= debut
        ? null
        : { cle: candidat.cle, contenu: candidat.contenu, debut, fin };
    })
    .filter((b): b is Omit<Place<T>, "voie" | "voies"> => Boolean(b))
    .sort((a, b) => a.debut - b.debut || a.fin - b.fin);

  const places: Place<T>[] = [];
  // Un groupe = des contenus liés de proche en proche par un chevauchement ;
  // c'est lui qui fixe le nombre de voies, pas la journée entière.
  let groupe: Place<T>[] = [];
  let finsParVoie: number[] = [];

  const clore = () => {
    for (const place of groupe) place.voies = finsParVoie.length;
    places.push(...groupe);
    groupe = [];
    finsParVoie = [];
  };

  for (const borne of bornes) {
    if (groupe.length > 0 && finsParVoie.every((fin) => fin <= borne.debut)) {
      clore();
    }
    let voie = finsParVoie.findIndex((fin) => fin <= borne.debut);
    if (voie === -1) {
      voie = finsParVoie.length;
      finsParVoie.push(borne.fin);
    } else {
      finsParVoie[voie] = borne.fin;
    }
    groupe.push({ ...borne, voie, voies: 1 });
  }
  if (groupe.length > 0) clore();

  return places;
}
