import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";

import { cn } from "@/lib/utils";
import {
  schoolYearLabel,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT_LABELS,
} from "@/types";
import type {
  AgendaEntrySummary,
  DaySchedule,
  DaySeance,
  TimetableSlot,
  WeekSchedule,
} from "@/types";

// ---------------------------------------------------------------------------
// Arithmétique du temps — privée à la grille
//
// Les horaires s'affichent en `HH:MM`, comme partout ailleurs dans l'écran
// (`DayList`) : deux façons d'écrire la même heure sur la même page se lisent
// comme deux heures différentes. Seule la colonne de gauche abrège en « 08h »,
// parce qu'elle ne porte jamais de minutes.
//
// Aucune arithmétique de calendrier ici : les sept dates, le numéro de semaine
// et la parité arrivent tout faits du backend (`WeekSchedule`). Un `getDay()`
// posé ici rendrait 0 le dimanche et contredirait le jour ISO de tout le reste
// du projet.
// ---------------------------------------------------------------------------

/** « 08:30 » → 510. `null` si l'heure est vide ou mal formée : une séance
 *  antérieure au palier 004 porte `''`, et elle n'a rien à faire dans la
 *  géométrie. */
function toMinutes(time: string): number | null {
  if (time.length !== 5 || time[2] !== ":") return null;
  const heures = Number(time.slice(0, 2));
  const minutes = Number(time.slice(3));
  if (!Number.isInteger(heures) || !Number.isInteger(minutes)) return null;
  if (heures < 0 || heures > 23 || minutes < 0 || minutes > 59) return null;
  return heures * 60 + minutes;
}

function fromMinutes(total: number): string {
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
const FIN_MAX = 23 * 60 + 55;

function heureFinDe(total: number): string {
  return fromMinutes(Math.min(total, FIN_MAX));
}

/** Repère de la colonne des heures : « 08h ». */
function libelleHeure(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}h`;
}

/** Quantième du mois, lu dans la chaîne ISO. Passer par `Date` pour ça
 *  rouvrirait le décalage UTC que tout l'écran évite déjà. */
function quantieme(iso: string): string {
  return String(Number(iso.slice(8, 10)));
}

/**
 * Pourquoi personne ne fait cours ce jour-là, en une phrase, ou `null`.
 *
 * Le férié passe AVANT les vacances quand les deux tombent : « Toussaint » est
 * plus précis que « Vacances de la Toussaint » sur la journée du 1er novembre,
 * et c'est ce que l'enseignant cherche à lire. Les deux sont rendus par le
 * backend ; c'est ici qu'on choisit.
 */
function motifDeFermeture(journee: DaySchedule | null): string | null {
  if (journee === null || journee.closures.length === 0) return null;
  const ferie = journee.closures.find((c) => c.origin === "ferie");
  return (ferie ?? journee.closures[0]).label;
}

/**
 * Un créneau est-il à masquer ce jour-là ?
 *
 * Deux raisons, et elles ne portent pas sur le même périmètre :
 *
 * * le JOUR est fermé — vacances scolaires ou férié : personne ne fait cours,
 *   tous les créneaux disparaissent ;
 * * une CLASSE est absente — un stage : seuls les créneaux de CETTE classe
 *   disparaissent, les autres restent. Une période nominative n'entre jamais
 *   ici (le backend ne la rend pas) : la classe est là, un élève manque.
 *
 * On masque le créneau et non la journée entière parce qu'un créneau est un
 * MODÈLE : il n'existe pas, il est seulement projeté. Une séance réelle ou un
 * rendez-vous datés ce jour-là restent dessinés à pleine force — un rattrapage
 * pendant les vacances est un fait, et une faute de frappe sur la date doit se
 * voir.
 */
function creneauMasque(
  journee: DaySchedule | null,
  sessionId: string | null,
): boolean {
  if (journee === null) return false;
  if (journee.closures.length > 0) return true;
  if (sessionId === null) return false;
  return journee.sessions_away.some((c) => c.session_id === sessionId);
}

/** Date du jour en heure locale, comme partout ailleurs dans l'écran. */
function aujourdhui(): string {
  return new Date().toLocaleDateString("sv-SE");
}

/** Horaire lisible, y compris quand une borne manque — même règle que
 *  `DayList`, pour que les deux écrans écrivent la même heure pareil. */
function libelleHoraire(debut: string, fin: string): string {
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
const PAS = 5;

/** Hauteur d'un pas, en pixels — une heure occupe donc 48 px. */
const HAUTEUR_PAS = 4;

/** Hauteur d'une bande d'une demi-heure, en pixels : 24. C'est le quadrillage
 *  que l'enseignant voit, donc l'unité sur laquelle le tracé à la souris
 *  s'aligne. Elle se déduit des deux constantes au-dessus, elle ne se recopie
 *  pas à la main. */
const HAUTEUR_DEMIE = (30 / PAS) * HAUTEUR_PAS;

/** Amplitude plancher. La grille s'étire pour accueillir les créneaux réels,
 *  mais ne se rétrécit jamais en deçà : sinon supprimer le dernier cours de
 *  l'après-midi ferait sauter la grille d'une taille à l'autre sous les yeux. */
const AMPLITUDE_MIN = 8 * 60;
const AMPLITUDE_MAX = 17 * 60;

/** Durée proposée par défaut au clic sur une bande vide. L'enseignant corrige
 *  dans le dialogue : la grille ne devine pas un horaire, elle le préremplit. */
const DUREE_PAR_DEFAUT = 60;

// ---------------------------------------------------------------------------
// Ce qu'une case porte
// ---------------------------------------------------------------------------

/**
 * Trois natures, une seule géométrie.
 *
 * `creneau` est le **modèle** hebdomadaire ; il vient de `slots`, c'est-à-dire
 * de l'année entière et sans filtre de parité. La séance qui existe déjà à
 * cette date n'est qu'une **surcouche** posée sur sa carte, jamais une seconde
 * carte : deux cartes pour le même cours se liraient comme deux cours.
 *
 * `seanceLibre` et `entree` sont datés : ils n'existent que cette semaine-là.
 */
type Contenu =
  | {
      nature: "creneau";
      slot: TimetableSlot;
      seance: DaySeance | null;
      horsSemaine: boolean;
    }
  | { nature: "seanceLibre"; seance: DaySeance }
  | { nature: "entree"; entry: AgendaEntrySummary };

/** Un contenu replacé dans la grille : bornes en minutes, et la voie qu'il
 *  occupe quand plusieurs contenus se chevauchent le même jour. */
interface Place {
  cle: string;
  contenu: Contenu;
  debut: number;
  fin: number;
  voie: number;
  voies: number;
}

/** Un contenu candidat au placement, avec ses deux horaires bruts. */
interface Candidat {
  cle: string;
  contenu: Contenu;
  debut: string;
  fin: string;
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
function placer(candidats: Candidat[]): Place[] {
  const bornes = candidats
    .map((candidat) => {
      const debut = toMinutes(candidat.debut);
      const fin = toMinutes(candidat.fin);
      return debut === null || fin === null || fin <= debut
        ? null
        : { cle: candidat.cle, contenu: candidat.contenu, debut, fin };
    })
    .filter((b): b is Omit<Place, "voie" | "voies"> => Boolean(b))
    .sort((a, b) => a.debut - b.debut || a.fin - b.fin);

  const places: Place[] = [];
  // Un groupe = des contenus liés de proche en proche par un chevauchement ;
  // c'est lui qui fixe le nombre de voies, pas la journée entière.
  let groupe: Place[] = [];
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

/** Un contenu a-t-il une position défendable dans la grille horaire ? Sinon il
 *  part dans la rangée « hors horaire » plutôt que d'être posé quelque part au
 *  jugé : `start_time = ''` est un cas encouragé par le dialogue des
 *  rendez-vous, pas une donnée abîmée. */
function estPlacable(debut: string, fin: string): boolean {
  const d = toMinutes(debut);
  const f = toMinutes(fin);
  return d !== null && f !== null && f > d;
}

function cleDe(contenu: Contenu): string {
  switch (contenu.nature) {
    case "creneau":
      return `creneau:${contenu.slot.id}`;
    case "seanceLibre":
      return `seance:${contenu.seance.id}`;
    case "entree":
      return `entree:${contenu.entry.id}`;
  }
}

// ---------------------------------------------------------------------------
// Tracé d'une plage horaire à la souris
// ---------------------------------------------------------------------------

/**
 * Un glissé en cours.
 *
 * `ancreY` est le `clientY` du `pointerdown`, et tout le suivi se fait en
 * **pixels parcourus** depuis lui. On ne se repose surtout pas sur le
 * `pointerenter` des bandes voisines : dès que le curseur passe sous une carte
 * de créneau déjà posée, l'événement n'arrive plus à la bande, et la sélection
 * s'arrêterait en silence au milieu du geste. La géométrie, elle, est connue et
 * constante (`HAUTEUR_DEMIE`), donc elle ne peut pas être masquée.
 */
interface Trace {
  /** Jour du `pointerdown`. Un cours ne traverse pas deux jours : le mouvement
   *  horizontal est ignoré de bout en bout. */
  jour: number;
  /** Colonne du `pointerdown`, pour dessiner l'aperçu. */
  colonne: number;
  /** Date de la colonne pressée, AAAA-MM-JJ. Retenue **au début du geste**, et
   *  pas relue à la fin : le tracé n'ayant pas le droit de changer de jour, la
   *  date est acquise dès le `pointerdown`. La relire depuis la semaine à la
   *  fin du geste la ferait dépendre d'un rechargement qui peut tomber au
   *  milieu — et une visite de stage se poserait à la mauvaise date. */
  date: string;
  /** Bord SUPÉRIEUR de la bande pressée, en pixels écran — jamais le `clientY`
   *  du clic. Ancrer sur le pixel pressé ferait dépendre le résultat de
   *  l'endroit où l'on presse DANS la bande : presser près du bas puis
   *  descendre laisserait la sélection une bande en retard sur le curseur. */
  ancreY: number;
  /** Minutes du début de la bande pressée. */
  ancreDebut: number;
  /** Minutes du début de la bande atteinte. */
  courantDebut: number;
}

// ---------------------------------------------------------------------------
// Composant
// ---------------------------------------------------------------------------

export interface WeekGridProps {
  /** Année de la rentrée : sert au seul libellé sous la grille. */
  yearStart: number;
  /** Les créneaux de l'**année**, tous jours confondus et sans filtre de
   *  parité. C'est la seule source des modèles : la semaine, elle, ne renvoie
   *  que les créneaux qui y tombent, et brancher les cartes dessus ferait
   *  disparaître les créneaux de quinzaine une semaine sur deux au lieu de les
   *  estomper. */
  slots: TimetableSlot[];
  /** La semaine regardée : ses sept dates, sa parité réelle, ses séances et ses
   *  rendez-vous. Surcouche datée par-dessus les modèles, jamais un
   *  remplacement. */
  week: WeekSchedule;
  /** Clic sur un créneau. Absent : la grille est en lecture seule. */
  onSelectSlot?: (slot: TimetableSlot) => void;
  /** Clic sur un rendez-vous daté : la visite de stage s'ouvre sur son compte
   *  rendu, sans détour par l'onglet Journée. Absent : la carte reste inerte. */
  onOpenEntry?: (entry: AgendaEntrySummary) => void;
  /** Clic sur une séance datée — un cours ponctuel, ou une séance saisie
   *  depuis la fiche de classe : elle s'ouvre sur son cahier de texte. Même
   *  signature que `DayList.onOpenSeance`, parce que c'est exactement le même
   *  geste ; un second vocabulaire pour la même action se paierait au premier
   *  refactor. Absent : la carte reste inerte. */
  onOpenSeance?: (seance: DaySeance) => void;
  /** Clic ou glissé sur une bande vide, jour ISO et horaire préremplis. */
  /**
   * Clic ou tracé sur une bande vide. Le jour ISO sert aux formes
   * hebdomadaires, la **date** aux formes datées — une visite de stage se pose
   * un jour précis, pas « tous les mardis ». Les deux sont fournis parce que
   * c'est au dialogue, une fois le type choisi, de retenir celui qui le
   * concerne.
   */
  onCreateSlot?: (
    weekday: number,
    startTime: string,
    endTime: string,
    date: string,
  ) => void;
  className?: string;
}

/**
 * La semaine, en **un seul CSS grid** : l'alignement entre colonnes est alors
 * garanti par la grille elle-même, pas par des hauteurs recopiées d'une colonne
 * à l'autre.
 *
 * Aucune bibliothèque de calendrier, aucun glisser-déposer de carte : un emploi
 * du temps se saisit deux fois par an, et le dialogue reste de toute façon
 * nécessaire pour le clavier.
 *
 * **Aucun geste de la grille n'écrit quoi que ce soit par lui-même.** Naviguer
 * d'une semaine à l'autre est une lecture ; cliquer ou tracer dans une bande
 * vide ne fait qu'ouvrir le sélecteur de forme, et c'est le formulaire choisi
 * ensuite qui écrit, sur son bouton d'enregistrement.
 *
 * Des six formes de ce sélecteur, **cinq n'engendrent aucune séance** — deux
 * modèles hebdomadaires, trois rendez-vous datés. La sixième, « Cours ponctuel
 * », en engendre une, et une seule : un remplacement est un vrai cours, il
 * compte donc au dénominateur d'assiduité du bilan remis aux familles. Aucune
 * boucle, aucune semaine entière d'un coup.
 *
 * **Une carte n'écrit rien non plus : elle ouvre.** Le modèle hebdomadaire
 * ouvre son dialogue de créneau, dont la portée est toutes les semaines ; le
 * rendez-vous daté ouvre son compte rendu ; la séance datée ouvre son cahier de
 * texte. Trois natures, trois destinations, et aucune création au passage.
 */
export function WeekGrid({
  yearStart,
  slots,
  week,
  onSelectSlot,
  onOpenEntry,
  onOpenSeance,
  onCreateSlot,
  className,
}: WeekGridProps): ReactElement {
  const {
    debut,
    fin,
    jours,
    journeeParJour,
    placesParJour,
    horsHoraireParJour,
  } = useMemo(() => {
    const journeeParJour = new Map<number, DaySchedule>();
    for (const journee of week.days) journeeParJour.set(journee.weekday, journee);

    const placesParJour = new Map<number, Place[]>();
    const horsHoraireParJour = new Map<number, Contenu[]>();

    for (let jour = 1; jour <= 7; jour += 1) {
      const journee = journeeParJour.get(jour) ?? null;

      // La seule chose que la semaine apporte aux modèles : la séance qui
      // existe déjà pour ce créneau, à cette date-là.
      const seanceParSlot = new Map<string, DaySeance>();
      for (const { slot, seance } of journee?.slots ?? []) {
        if (seance) seanceParSlot.set(slot.id, seance);
      }

      const candidats: Candidat[] = [];
      const horsHoraire: Contenu[] = [];

      for (const slot of slots) {
        if (slot.weekday !== jour) continue;
        const contenu: Contenu = {
          nature: "creneau",
          slot,
          seance: seanceParSlot.get(slot.id) ?? null,
          // La parité est celle de la semaine REGARDÉE, et non plus celle
          // d'une journée affichée dans l'autre onglet.
          horsSemaine:
            week.show_parity &&
            slot.week_parity !== "toutes" &&
            slot.week_parity !== week.week_parity,
        };
        if (estPlacable(slot.start_time, slot.end_time)) {
          candidats.push({
            cle: cleDe(contenu),
            contenu,
            debut: slot.start_time,
            fin: slot.end_time,
          });
        } else {
          horsHoraire.push(contenu);
        }
      }

      for (const seance of journee?.loose_seances ?? []) {
        const contenu: Contenu = { nature: "seanceLibre", seance };
        if (estPlacable(seance.start_time, seance.end_time)) {
          candidats.push({
            cle: cleDe(contenu),
            contenu,
            debut: seance.start_time,
            fin: seance.end_time,
          });
        } else {
          horsHoraire.push(contenu);
        }
      }

      for (const entry of journee?.entries ?? []) {
        const contenu: Contenu = { nature: "entree", entry };
        if (estPlacable(entry.start_time, entry.end_time)) {
          candidats.push({
            cle: cleDe(contenu),
            contenu,
            debut: entry.start_time,
            fin: entry.end_time,
          });
        } else {
          horsHoraire.push(contenu);
        }
      }

      placesParJour.set(jour, placer(candidats));
      horsHoraireParJour.set(jour, horsHoraire);
    }

    // Lundi→vendredi toujours : une colonne vide se lit « rien ce jour-là »,
    // une colonne absente se lit « la grille est cassée ». Samedi et dimanche
    // n'apparaissent que s'ils portent quelque chose — et ce quelque chose
    // n'est pas que le modèle : une réunion parents-professeurs un samedi
    // matin serait sinon créée puis invisible.
    const jours = [1, 2, 3, 4, 5];
    for (const jour of [6, 7]) {
      const porte =
        (placesParJour.get(jour) ?? []).length > 0 ||
        (horsHoraireParJour.get(jour) ?? []).length > 0;
      if (porte) jours.push(jour);
    }

    let debut = AMPLITUDE_MIN;
    let fin = AMPLITUDE_MAX;
    for (const jour of jours) {
      for (const place of placesParJour.get(jour) ?? []) {
        debut = Math.min(debut, Math.floor(place.debut / 60) * 60);
        fin = Math.max(fin, Math.ceil(place.fin / 60) * 60);
      }
    }

    return {
      debut,
      fin,
      jours,
      journeeParJour,
      placesParJour,
      horsHoraireParJour,
    };
  }, [slots, week]);

  const lignes = (fin - debut) / PAS;

  /**
   * Ligne 1 = l'en-tête des jours, ligne 2 = la rangée « hors horaire » ; les
   * horaires commencent donc à 3.
   *
   * L'arrondi n'est pas cosmétique : le champ horaire n'a pas de `step`, donc
   * un cours peut commencer à 8h32. Sans lui, `gridRow` vaudrait « 8.4 », que
   * le navigateur ignore — et le créneau se poserait en haut de la grille.
   */
  const ligneDe = (minutes: number) => 3 + Math.round((minutes - debut) / PAS);

  const heures: number[] = [];
  for (let h = debut; h < fin; h += 60) heures.push(h);

  const demiHeures: number[] = [];
  for (let t = debut; t < fin; t += 30) demiHeures.push(t);

  const aHorsHoraire = jours.some(
    (jour) => (horsHoraireParJour.get(jour) ?? []).length > 0,
  );

  // ---- Tracé d'une plage ----

  const [trace, setTrace] = useState<Trace | null>(null);
  // Le même tracé, lisible depuis les écouteurs posés sur `window` : ils sont
  // installés une fois pour le geste entier, ils ne peuvent donc pas lire un
  // état qui change à chaque pixel.
  const traceRef = useRef<Trace | null>(null);
  // Après un glissé, le navigateur émet encore un `click` sur la bande de
  // départ. Sans ce drapeau, la plage tracée serait suivie d'un second créneau
  // à la durée par défaut.
  const ignorerProchainClic = useRef(false);
  // La bande pressée, pour relire son bord supérieur à chaque déplacement : un
  // coup de molette pendant le glissé décale `clientY` sans que le curseur
  // change de bande, et une géométrie lue une seule fois se décalerait d'autant.
  const bandeRef = useRef<HTMLElement | null>(null);

  const majTrace = useCallback((valeur: Trace | null) => {
    traceRef.current = valeur;
    setTrace(valeur);
  }, []);

  const enTrace = trace !== null;

  useEffect(() => {
    if (!enTrace) return;

    const bouger = (event: PointerEvent) => {
      const courante = traceRef.current;
      if (courante === null) return;
      // Écart au bord SUPÉRIEUR de la bande pressée, converti en bandes de 30
      // minutes. `floor` et non `trunc`, et le bord de la bande et non le
      // pixel cliqué : le quotient est alors, exactement, l'index de la bande
      // sous le curseur — vers le haut comme vers le bas, et quel que soit
      // l'endroit pressé dans la bande. Un tremblement de la main reste un
      // clic, puisque le curseur ne quitte pas la bande de départ.
      const haut =
        bandeRef.current?.getBoundingClientRect().top ?? courante.ancreY;
      const bandes = Math.floor((event.clientY - haut) / HAUTEUR_DEMIE);
      // Bornage à l'amplitude de la grille, vers le haut comme vers le bas.
      const vise = Math.min(
        Math.max(courante.ancreDebut + bandes * 30, debut),
        fin - 30,
      );
      if (vise === courante.courantDebut) return;
      majTrace({ ...courante, courantDebut: vise });
    };

    const relacher = () => {
      const courante = traceRef.current;
      majTrace(null);
      bandeRef.current = null;
      if (courante === null) return;
      // Pas une bande parcourue : c'est un clic, et le `click` qui suit fera
      // son travail avec la durée par défaut. Ne rien créer ici.
      if (courante.courantDebut === courante.ancreDebut) return;
      ignorerProchainClic.current = true;
      const [bas, haut] =
        courante.ancreDebut <= courante.courantDebut
          ? [courante.ancreDebut, courante.courantDebut]
          : [courante.courantDebut, courante.ancreDebut];
      // Sélection **inclusive** : elle couvre toutes les bandes survolées, la
      // dernière comprise — d'où le `+ 30`. Presser dans la bande de 8h00 et
      // relâcher dans celle de 9h30 donne donc 08:00 – 10:00. S'arrêter à 9h30
      // laisserait hors du cours la bande que l'aperçu vient de surligner.
      onCreateSlot?.(
        courante.jour,
        fromMinutes(bas),
        heureFinDe(haut + 30),
        courante.date,
      );
    };

    // `pointercancel` couvre le cas du doigt : sur un écran tactile, le
    // navigateur peut décider en cours de route que le geste est un
    // défilement, et il reprend alors le pointeur. Le tracé s'annule, rien
    // n'est créé, et le simple appui — donc le clic — continue de marcher.
    //
    // `blur` et `contextmenu` couvrent les deux autres façons de perdre le
    // `pointerup` : Alt-Tab en plein glissé, ou clic droit. Sans eux, le tracé
    // resterait accroché au curseur et le premier relâchement suivant, sur
    // n'importe quel bouton de la page, ouvrirait le dialogue avec une plage
    // que personne n'a voulue.
    const annuler = () => {
      if (traceRef.current === null) return;
      majTrace(null);
      bandeRef.current = null;
      // Le geste est abandonné : le `click` qui va suivre ne doit pas créer de
      // créneau à la durée par défaut. Rien n'est écrit.
      ignorerProchainClic.current = true;
    };

    const touche = (event: KeyboardEvent) => {
      if (event.key === "Escape") annuler();
    };

    window.addEventListener("pointermove", bouger);
    window.addEventListener("pointerup", relacher);
    window.addEventListener("pointercancel", annuler);
    window.addEventListener("blur", annuler);
    window.addEventListener("contextmenu", annuler);
    window.addEventListener("keydown", touche);
    return () => {
      window.removeEventListener("pointermove", bouger);
      window.removeEventListener("pointerup", relacher);
      window.removeEventListener("pointercancel", annuler);
      window.removeEventListener("blur", annuler);
      window.removeEventListener("contextmenu", annuler);
      window.removeEventListener("keydown", touche);
    };
  }, [enTrace, debut, fin, majTrace, onCreateSlot]);

  const commencerTrace = (
    event: ReactPointerEvent<HTMLButtonElement>,
    jour: number,
    colonne: number,
    minutes: number,
    date: string,
  ) => {
    // Bouton principal seulement : un clic droit n'ouvre aucune plage. Le
    // drapeau se remet à zéro ici, et nulle part ailleurs — ainsi un « clic à
    // ignorer » resté en l'air ne peut jamais avaler un vrai clic.
    if (event.button !== 0 || !event.isPrimary) return;
    ignorerProchainClic.current = false;
    // Capture du pointeur : sans elle, relâcher hors de la fenêtre ne renvoie
    // aucun `pointerup` et l'aperçu resterait accroché au curseur. Le `click`
    // qui suit est redirigé vers cette bande — c'est exactement le cas que
    // `ignorerProchainClic` couvre.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointeur déjà relâché : le tracé se suivra quand même par `window`.
    }
    bandeRef.current = event.currentTarget;
    majTrace({
      jour,
      colonne,
      date,
      // Le bord haut de la bande, pas le pixel pressé : voir `Trace.ancreY`.
      ancreY: event.currentTarget.getBoundingClientRect().top,
      ancreDebut: minutes,
      courantDebut: minutes,
    });
  };

  const selection = useMemo(() => {
    if (trace === null || trace.courantDebut === trace.ancreDebut) return null;
    const bas = Math.min(trace.ancreDebut, trace.courantDebut);
    const haut = Math.max(trace.ancreDebut, trace.courantDebut);
    return { colonne: trace.colonne, debut: bas, fin: Math.min(haut + 30, fin) };
  }, [trace, fin]);

  // ---- Rendu ----

  const jourCourant = aujourdhui();

  const style: CSSProperties = {
    gridTemplateColumns: `3.25rem repeat(${jours.length}, minmax(7rem, 1fr))`,
    gridTemplateRows: `auto auto repeat(${lignes}, ${HAUTEUR_PAS}px)`,
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="overflow-x-auto">
        <div className="grid min-w-[44rem] select-none" style={style}>
          {/* En-tête : coin vide au-dessus de la colonne des heures. */}
          <div style={{ gridColumn: 1, gridRow: 1 }} />
          {jours.map((jour, index) => {
            const journee = journeeParJour.get(jour) ?? null;
            const estCeJour = journee !== null && journee.date === jourCourant;
            const fermeture = motifDeFermeture(journee);
            const classesAbsentes = journee?.sessions_away ?? [];
            return (
              <div
                key={`jour-${jour}`}
                className={cn(
                  "border-l border-border px-2 pb-1.5 text-center text-xs font-medium",
                  index === jours.length - 1 && "border-r",
                  estCeJour && "text-primary",
                )}
                style={{ gridColumn: index + 2, gridRow: 1 }}
              >
                {WEEKDAY_SHORT_LABELS[jour]}
                {journee && (
                  <span className={cn("ml-1", estCeJour && "font-bold")}>
                    {quantieme(journee.date)}
                  </span>
                )}
                {/* Le motif sous la date, et non une pastille à côté : c'est une
                    phrase qu'on lit, pas un signe à décoder. */}
                {fermeture && (
                  <span className="mt-0.5 block truncate text-[10px] font-normal leading-tight text-muted-foreground">
                    {fermeture}
                  </span>
                )}
                {!fermeture && classesAbsentes.length > 0 && (
                  <span
                    className="mt-0.5 block truncate text-[10px] font-normal leading-tight text-muted-foreground"
                    title={classesAbsentes
                      .map((c) => `${c.session_name} — ${c.reason}`)
                      .join(" · ")}
                  >
                    {classesAbsentes.length === 1
                      ? `${classesAbsentes[0].session_name} absente`
                      : `${classesAbsentes.length} classes absentes`}
                  </span>
                )}
              </div>
            );
          })}

          {/* Rangée « hors horaire », en tête de grille : un rendez-vous dont
              l'heure reste à caler (`start_time = ''`) n'a aucune place dans la
              grille horaire, et il ne doit pas pour autant disparaître. Même
              doctrine que `DayList`, qui ouvre la journée par ces lignes-là.
              Vide, la rangée `auto` ne prend aucune hauteur. */}
          {aHorsHoraire && (
            <div
              className="pb-1 pr-2 text-right text-[10px] leading-tight text-muted-foreground"
              style={{ gridColumn: 1, gridRow: 2 }}
            >
              hors horaire
            </div>
          )}
          {aHorsHoraire &&
            jours.map((jour, index) => (
              <div
                key={`hors-${jour}`}
                className={cn(
                  "space-y-1 border-b border-l border-dashed border-border px-1 pb-1",
                  index === jours.length - 1 && "border-r",
                )}
                style={{ gridColumn: index + 2, gridRow: 2 }}
              >
                {(horsHoraireParJour.get(jour) ?? []).map((contenu) => (
                  <CarteLibre
                    key={cleDe(contenu)}
                    contenu={contenu}
                    onSelect={onSelectSlot}
                    onOpenEntry={onOpenEntry}
                    onOpenSeance={onOpenSeance}
                  />
                ))}
              </div>
            ))}

          {/* Colonne des heures. */}
          {heures.map((heure) => (
            <div
              key={`heure-${heure}`}
              className="pr-2 text-right text-[11px] leading-none text-muted-foreground"
              style={{ gridColumn: 1, gridRow: `${ligneDe(heure)} / span 12` }}
            >
              {libelleHeure(heure)}
            </div>
          ))}

          {/* Les cartes AVANT le fond dans le DOM, et c'est l'ordre du
              clavier qui le commande, pas l'empilement : `z-10` sur la carte
              suffit à la poser par-dessus les bandes, `z-index` s'appliquant
              aux éléments d'une grille CSS même sans `position`. Placées après,
              elles n'étaient atteintes qu'au bout de toutes les bandes du fond
              — sur l'amplitude plancher de 8h→17h et cinq jours, quatre-vingt-
              dix tabulations « Ajouter le lundi à 08:00 », « … à 08:30 »…
              avant la visite de stage qu'on voulait ouvrir. */}
          {jours.map((jour, index) =>
            (placesParJour.get(jour) ?? [])
              // Un créneau dont la classe n'est pas là, ou dont le jour est
              // fermé, n'est pas dessiné. C'est le SEUL objet qu'on retire, et
              // il le supporte : un créneau est un modèle, il n'existe pas.
              // L'en-tête de la colonne dit pourquoi — sans quoi une case
              // disparue passerait pour un créneau perdu.
              //
              // Effet de bord voulu : on ne peut plus créer une séance par
              // inadvertance un jour de vacances, puisque la carte n'est pas là.
              .filter(
                (place) =>
                  place.contenu.nature !== "creneau" ||
                  !creneauMasque(
                    journeeParJour.get(jour) ?? null,
                    place.contenu.slot.session_id,
                  ),
              )
              .map((place) => (
              <Carte
                key={place.cle}
                place={place}
                colonne={index + 2}
                ligneDebut={ligneDe(place.debut)}
                // Un contenu de moins de 5 minutes retomberait sur la même
                // ligne de départ et d'arrivée, donc sur une case invisible.
                ligneFin={Math.max(ligneDe(place.fin), ligneDe(place.debut) + 1)}
                onSelect={onSelectSlot}
                onOpenEntry={onOpenEntry}
                onOpenSeance={onOpenSeance}
              />
            )),
          )}

          {/* Fond cliquable, une bande par demi-heure et par jour. C'est lui
              qui dessine aussi le quadrillage. */}
          {jours.map((jour, index) => {
            const nomJour = WEEKDAY_LABELS[jour].toLowerCase();
            const jourFerme =
              (journeeParJour.get(jour)?.closures.length ?? 0) > 0;
            return demiHeures.map((t) => {
              const pleine = t % 60 === 0;
              const classes = cn(
                "border-l border-l-border border-t",
                index === jours.length - 1 && "border-r border-r-border",
                // Trait plein à l'heure, trait pâle à la demie : c'est le seul
                // repère de lecture verticale, la grille n'a pas de libellé
                // toutes les 30 minutes.
                pleine ? "border-t-border" : "border-t-border/30",
                onCreateSlot && "hover:bg-accent/40",
              );
              const position: CSSProperties = {
                gridColumn: index + 2,
                gridRow: `${ligneDe(t)} / ${ligneDe(t + 30)}`,
              };
              // Jour fermé : la bande redevient un simple fond, sans survol ni
              // clic. Le bouton n'est pas désactivé, il N'EXISTE PAS — un bouton
              // grisé invite à chercher pourquoi, une case inerte sous un
              // en-tête qui dit « Vacances de la Toussaint » ne pose aucune
              // question.
              //
              // Seule la fermeture du JOUR compte ici, pas l'absence d'une
              // classe : un créneau se crée pour une classe qu'on choisit
              // ensuite dans le dialogue, et rien ne dit que ce sera celle qui
              // est en stage.
              if (!onCreateSlot || jourFerme) {
                return (
                  <div
                    key={`fond-${jour}-${t}`}
                    className={classes}
                    style={position}
                  />
                );
              }
              const heureDebut = fromMinutes(t);
              const heureFin = heureFinDe(Math.min(t + DUREE_PAR_DEFAUT, fin));
              // La date de CETTE colonne. `week.days` couvre lundi→dimanche
              // sans trou, donc le repli n'arrive pas ; il est là pour que le
              // type reste honnête plutôt que pour couvrir un cas réel.
              const dateDuJour = journeeParJour.get(jour)?.date ?? "";
              return (
                <button
                  key={`fond-${jour}-${t}`}
                  type="button"
                  className={cn(classes, "cursor-pointer")}
                  style={position}
                  // Le chemin clavier reste entier — Entrée ou Espace
                  // déclenchent ce `onClick`, avec la durée par défaut,
                  // exactement comme avant. Le tracé à la souris s'ajoute, il
                  // ne remplace rien.
                  //
                  // « Ajouter » et non « Ajouter un créneau » : depuis que le
                  // clic ouvre le sélecteur de forme, ce geste peut aussi
                  // produire une visite de stage ou un rendez-vous. Promettre
                  // un créneau à un lecteur d'écran serait lui annoncer le
                  // mauvais formulaire.
                  aria-label={`Ajouter le ${nomJour} à ${heureDebut}`}
                  onPointerDown={(event) =>
                    commencerTrace(event, jour, index + 2, t, dateDuJour)
                  }
                  onClick={(event) => {
                    // `detail === 0` : le clic vient d'Entrée ou d'Espace. Il
                    // ne peut pas être la queue d'un glissé, et ne doit donc
                    // jamais être avalé — sinon un drapeau resté en l'air
                    // rendrait le clavier muet.
                    const avaler = ignorerProchainClic.current && event.detail > 0;
                    ignorerProchainClic.current = false;
                    if (avaler) return;
                    onCreateSlot(jour, heureDebut, heureFin, dateDuJour);
                  }}
                />
              );
            });
          })}

          {/* Aperçu du tracé. `pointer-events-none` : sans lui, il volerait les
              événements qu'il est censé illustrer dès qu'il passe sous le
              curseur. */}
          {selection && (
            <div
              className="pointer-events-none z-20 flex items-start justify-center rounded-md border-2 border-primary bg-primary/20 px-1 pt-0.5 text-[11px] font-medium text-primary"
              style={{
                gridColumn: selection.colonne,
                gridRow: `${ligneDe(selection.debut)} / ${ligneDe(selection.fin)}`,
              }}
            >
              {/* Le rectangle peut atteindre minuit ; l'étiquette annonce
                  l'heure qui sera réellement préremplie. */}
              {fromMinutes(selection.debut)} – {heureFinDe(selection.fin)}
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Emploi du temps type — année scolaire {schoolYearLabel(yearStart)}
        {/* L'état vide se calcule sur l'ANNÉE, jamais sur la semaine : une
            année qui ne porterait que des créneaux de quinzaine paire
            annoncerait « aucun créneau » une semaine sur deux. */}
        {onCreateSlot && slots.length === 0 && (
          <> · cliquez ou glissez dans la grille pour ajouter un créneau</>
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Les cartes
// ---------------------------------------------------------------------------

/** Abrégé plutôt que `WEEK_PARITY_LABELS` : dans une case d'une heure,
 *  « Semaines paires » se tronque à « Semaines pai… » et ne dit plus rien. */
function abregerQuinzaine(slot: TimetableSlot): string | null {
  if (slot.week_parity === "toutes") return null;
  return slot.week_parity === "paires" ? "sem. paires" : "sem. impaires";
}

/**
 * Les quatre états de carte, aucun signe nouveau : bord plein = cours prévu,
 * bord tireté = occupation sans classe, barre épaisse à gauche = une séance
 * existe à cette date (convention de `DayList`), `opacity-40` = créneau de
 * quinzaine qui ne tombe pas cette semaine — estompé, jamais masqué : une case
 * disparue passerait pour un créneau perdu.
 */
function apparenceDe(contenu: Contenu): string {
  switch (contenu.nature) {
    case "creneau":
      return cn(
        contenu.slot.session_id
          ? "border-primary/30 bg-primary/10 text-foreground"
          : "border-dashed border-border bg-muted text-muted-foreground",
        contenu.seance && "border-l-4 border-l-primary",
        contenu.horsSemaine && "opacity-40",
      );
    case "seanceLibre":
      return "border-primary/40 border-l-4 border-l-primary bg-primary/10 text-foreground";
    case "entree":
      return "border-blue-200 border-l-4 border-l-blue-500 bg-blue-50 text-blue-900";
  }
}

function nomEleve(entry: AgendaEntrySummary): string | null {
  if (entry.student_id === null) return null;
  const nom =
    `${entry.student_last_name ?? ""} ${entry.student_first_name ?? ""}`.trim();
  return nom || null;
}

/**
 * L'état d'une séance, en toutes lettres.
 *
 * Le mot « a eu lieu » n'y apparaît pas : l'application sait qu'une ligne
 * existe dans `seances`, pas qu'un cours s'est tenu — et sur une semaine
 * préparée à l'avance, une séance existe sans avoir eu lieu.
 */
function etatDeLaSeance(seance: DaySeance): string {
  if (seance.cancelled) {
    return "Séance annulée : hors du dénominateur d'assiduité de toute la classe.";
  }
  const parts: string[] = [];
  if (seance.attendance_total === 0) {
    parts.push("séance créée, aucun élève inscrit à cette date");
  } else {
    const complet = seance.attendance_done >= seance.attendance_total;
    parts.push(
      `séance créée, appel ${seance.attendance_done}/${seance.attendance_total}${
        complet ? " (terminé)" : ""
      }`,
    );
  }
  parts.push(
    seance.has_content ? "cahier de texte rempli" : "cahier de texte vide",
  );
  const texte = parts.join(" · ");
  return `${texte.charAt(0).toUpperCase()}${texte.slice(1)}.`;
}

/**
 * Le `title=` de la carte : les mots complets, là où la case n'a la place que
 * de signes. C'est lui qui porte tout ce que la grille ne peut pas écrire.
 */
function titreDe(contenu: Contenu): string {
  const lignes: string[] = [];

  if (contenu.nature === "creneau") {
    const { slot, seance, horsSemaine } = contenu;
    lignes.push(
      [slot.label.trim(), slot.session_name].filter((part) => part).join(" — ") ||
        "Créneau sans intitulé",
    );
    lignes.push(
      [
        libelleHoraire(slot.start_time, slot.end_time),
        slot.room.trim(),
        abregerQuinzaine(slot),
      ]
        .filter((part) => part)
        .join(" · "),
    );
    if (horsSemaine) lignes.push("Ce créneau ne tombe pas cette semaine-là.");
    if (seance === null) {
      lignes.push(
        slot.session_id === null
          ? "Occupation sans classe : il n'y a rien à ouvrir derrière un modèle."
          : "Aucune séance à cette date — le créneau revient chaque semaine.",
      );
    } else {
      lignes.push(etatDeLaSeance(seance));
    }
    return lignes.filter((ligne) => ligne).join("\n");
  }

  if (contenu.nature === "seanceLibre") {
    const { seance } = contenu;
    lignes.push(`${seance.title} — ${seance.session_name}`);
    lignes.push(libelleHoraire(seance.start_time, seance.end_time));
    lignes.push(etatDeLaSeance(seance));
    return lignes.filter((ligne) => ligne).join("\n");
  }

  const { entry } = contenu;
  lignes.push(entry.title);
  lignes.push(libelleHoraire(entry.start_time, entry.end_time));
  const eleve = nomEleve(entry);
  if (eleve) lignes.push(eleve);
  lignes.push(
    entry.has_content
      ? "Rendez-vous · compte rendu rédigé."
      : "Rendez-vous · compte rendu vide. N'entre dans aucun calcul d'assiduité.",
  );
  return lignes.filter((ligne) => ligne).join("\n");
}

/** Les signes d'état d'une séance, dans une carte de 7 rem : `●` appel
 *  terminé, `○` appel commencé ou non fait, `▣` cahier de texte rempli. Les
 *  mots correspondants sont dans le `title=` de la carte, d'où l'`aria-hidden`
 *  — un lecteur d'écran ne lit pas des ronds. */
function Signes({ seance }: { seance: DaySeance }): ReactElement | null {
  if (seance.cancelled) return null;
  const complet =
    seance.attendance_total > 0 &&
    seance.attendance_done >= seance.attendance_total;
  return (
    <span aria-hidden className="shrink-0 font-medium">
      {seance.attendance_total > 0 && (complet ? "●" : "○")}
      {seance.has_content && " ▣"}
    </span>
  );
}

function CorpsCarte({ contenu }: { contenu: Contenu }): ReactElement {
  if (contenu.nature === "creneau") {
    const { slot, seance } = contenu;
    const quinzaine = abregerQuinzaine(slot);
    return (
      <>
        <span
          className={cn(
            "block truncate font-medium",
            seance?.cancelled && "line-through",
          )}
        >
          {slot.label}
        </span>
        {slot.session_name && (
          <span className="block truncate">{slot.session_name}</span>
        )}
        {/* Quatre lignes au plus : une carte d'une heure ne fait que 48 px, et
            les signes d'état partagent donc la ligne de la quinzaine plutôt
            que d'en ajouter une cinquième qui serait rognée. */}
        <span className="flex items-baseline justify-between gap-1 text-muted-foreground">
          <span className="truncate">
            {libelleHoraire(slot.start_time, slot.end_time)}
            {slot.room && ` · ${slot.room}`}
          </span>
          {!quinzaine && seance && <Signes seance={seance} />}
        </span>
        {quinzaine && (
          <span className="flex items-baseline justify-between gap-1 font-medium text-muted-foreground">
            <span className="truncate">{quinzaine}</span>
            {seance && <Signes seance={seance} />}
          </span>
        )}
      </>
    );
  }

  if (contenu.nature === "seanceLibre") {
    const { seance } = contenu;
    return (
      <>
        <span
          className={cn(
            "block truncate font-medium",
            seance.cancelled && "line-through",
          )}
        >
          {seance.title}
        </span>
        <span className="block truncate">{seance.session_name}</span>
        <span className="flex items-baseline justify-between gap-1 text-muted-foreground">
          <span className="truncate">
            {libelleHoraire(seance.start_time, seance.end_time)}
          </span>
          <Signes seance={seance} />
        </span>
      </>
    );
  }

  const { entry } = contenu;
  const eleve = nomEleve(entry);
  return (
    <>
      <span className="block truncate font-medium">{entry.title}</span>
      {eleve && <span className="block truncate">{eleve}</span>}
      <span className="block truncate opacity-80">
        {libelleHoraire(entry.start_time, entry.end_time) || "heure à caler"}
      </span>
    </>
  );
}

/** Le **visuel** de la carte. Il ne porte ni la position ni la surface
 *  sensible : dans la grille horaire, celles-ci sont à l'enveloppe. */
const CLASSES_CARTE =
  "overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight";

/**
 * Ce qu'un clic sur la carte déclenche, ou `null` si elle n'est pas ouvrable.
 *
 * **Les trois natures s'ouvrent, chacune vers un écran différent**, et c'est
 * cette distinction-là qu'il ne faut pas perdre de vue.
 *
 * Le **modèle** hebdomadaire s'ouvre sur son dialogue de créneau : la
 * modification vaut alors pour toutes les semaines, pas pour la case cliquée.
 * Le **rendez-vous daté** — une visite de stage d'abord — s'ouvre sur son
 * compte rendu : c'est le texte qu'on vient écrire au retour de la visite, et
 * le chercher dans l'onglet Journée quand on l'a sous les yeux dans la semaine
 * n'avait pas de raison d'être. La **séance datée** s'ouvre sur son cahier de
 * texte, comme depuis la journée.
 *
 * Une séance rattachée à un créneau n'a pas de carte à elle : elle est dessinée
 * en surcouche de son modèle (`nature: "creneau"`, champ `seance`), et cette
 * carte-là ouvre donc le créneau. L'occurrence, avec son appel, se tient
 * toujours depuis la journée — la grille n'ayant qu'une carte pour ce cours,
 * elle ne peut pas offrir deux destinations sans faire deviner laquelle.
 *
 * Ouvrir est une **lecture** : aucune de ces trois branches n'écrit quoi que ce
 * soit, et une carte de créneau posée sur un jour sans séance n'en crée pas.
 */
function ouvertureDe(
  contenu: Contenu,
  onSelect?: (slot: TimetableSlot) => void,
  onOpenEntry?: (entry: AgendaEntrySummary) => void,
  onOpenSeance?: (seance: DaySeance) => void,
): (() => void) | null {
  if (contenu.nature === "creneau" && onSelect) {
    const { slot } = contenu;
    return () => onSelect(slot);
  }
  if (contenu.nature === "entree" && onOpenEntry) {
    const { entry } = contenu;
    return () => onOpenEntry(entry);
  }
  if (contenu.nature === "seanceLibre" && onOpenSeance) {
    const { seance } = contenu;
    return () => onOpenSeance(seance);
  }
  return null;
}

/**
 * L'étiquette lue par un lecteur d'écran, qui dit **ce qui va s'ouvrir**.
 *
 * Le titre seul ne suffirait pas : trois cartes voisines peuvent porter le même
 * intitulé et mener à trois écrans différents. Le `title=` sert la souris,
 * celle-ci sert le clavier — et le clavier atteint ces cartes par Tab, puisque
 * ce sont de vrais `<button>`.
 */
function libelleOuverture(contenu: Contenu): string {
  if (contenu.nature === "creneau") {
    const { slot } = contenu;
    // Même repli que `titreDe` : `clean_label` exige un libellé depuis le
    // palier 004, mais une base antérieure peut en porter un vide — et c'est
    // alors la seule information utile qui manquerait à un lecteur d'écran.
    const nom =
      slot.label.trim() || slot.session_name || "créneau sans intitulé";
    return `Modifier le créneau « ${nom} » — vaut pour toutes les semaines`;
  }
  if (contenu.nature === "seanceLibre") {
    const { seance } = contenu;
    return `Ouvrir le cahier de texte de « ${seance.title} » — ${seance.session_name}`;
  }
  const { entry } = contenu;
  const eleve = nomEleve(entry);
  return `Ouvrir le compte rendu de « ${entry.title} »${eleve ? ` — ${eleve}` : ""}`;
}

/**
 * Le `title=` de la carte, augmenté de ce que le clic va faire.
 *
 * Le créneau n'en reçoit pas : ouvrir un créneau au clic est le geste que la
 * grille enseigne depuis le début. Les deux cartes datées, elles, cachent
 * chacune un écran qui ne se devine pas d'une carte de 7 rem.
 */
function titreDeLaCarte(contenu: Contenu, ouvrable: boolean): string {
  const texte = titreDe(contenu);
  if (!ouvrable) return texte;
  if (contenu.nature === "entree") {
    return `${texte}\nCliquez pour ouvrir le compte rendu.`;
  }
  if (contenu.nature === "seanceLibre") {
    return `${texte}\nCliquez pour ouvrir le cahier de texte.`;
  }
  return texte;
}

/** Le survol reprend la couleur de la carte : un rendez-vous bleu qui virerait
 *  au ton des créneaux au passage de la souris se lirait comme un changement de
 *  nature. */
function survolDe(contenu: Contenu): string {
  return contenu.nature === "entree"
    ? "cursor-pointer transition-colors hover:border-blue-500 hover:bg-blue-100"
    : "cursor-pointer transition-colors hover:border-primary hover:bg-primary/20";
}

interface CarteProps {
  place: Place;
  colonne: number;
  ligneDebut: number;
  ligneFin: number;
  onSelect?: (slot: TimetableSlot) => void;
  onOpenEntry?: (entry: AgendaEntrySummary) => void;
  onOpenSeance?: (seance: DaySeance) => void;
}

function Carte({
  place,
  colonne,
  ligneDebut,
  ligneFin,
  onSelect,
  onOpenEntry,
  onOpenSeance,
}: CarteProps): ReactElement {
  const { contenu, voie, voies } = place;

  // Les pourcentages d'un élément de grille se résolvent sur sa zone : la
  // largeur et la marge répartissent donc les voies dans la seule colonne du
  // jour, sans positionnement absolu ni second conteneur.
  //
  // La voie est prise ENTIÈRE, et la gouttière qui fait respirer les cartes est
  // un `padding` de l'enveloppe. Prise auparavant sur la largeur — `- 4px` et
  // `+ 2px` —, elle laissait vivre une bande de 2 px de part et d'autre de
  // chaque carte : viser le bord d'une visite de stage, et sur une colonne
  // partagée en deux voies les cartes sont déjà étroites, ouvrait « Ajouter à
  // l'emploi du temps » au lieu du compte rendu. Le geste n'écrivait rien, mais
  // c'était un faux départ.
  const style: CSSProperties = {
    gridColumn: colonne,
    gridRow: `${ligneDebut} / ${ligneFin}`,
    width: `${100 / voies}%`,
    marginLeft: `${(voie * 100) / voies}%`,
  };

  const ouvrir = ouvertureDe(contenu, onSelect, onOpenEntry, onOpenSeance);
  // `px-0.5 pt-px` : les 2 px latéraux et le 1 px du haut d'autrefois, au pixel
  // près — mais à l'intérieur de la surface sensible, pas à côté.
  const enveloppe = cn("z-10 block px-0.5 pt-px", ouvrir && "cursor-pointer");
  const classes = cn(
    CLASSES_CARTE,
    "h-full",
    apparenceDe(contenu),
    ouvrir && survolDe(contenu),
  );

  if (ouvrir === null) {
    return (
      <div className={enveloppe} style={style} title={titreDeLaCarte(contenu, false)}>
        <div className={classes}>
          <CorpsCarte contenu={contenu} />
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={enveloppe}
      style={style}
      title={titreDeLaCarte(contenu, true)}
      aria-label={libelleOuverture(contenu)}
      onClick={ouvrir}
    >
      <div className={classes}>
        <CorpsCarte contenu={contenu} />
      </div>
    </button>
  );
}

/** La même carte, hors de la grille horaire : ni position ni voie.
 *
 *  C'est là que tombent la visite de stage dont l'heure reste à caler et le
 *  cours ponctuel saisi sans horaire — donc là aussi qu'ils doivent s'ouvrir
 *  d'un clic, sinon la seule carte que l'enseignant cherche est la seule qui
 *  ne répond pas. */
function CarteLibre({
  contenu,
  onSelect,
  onOpenEntry,
  onOpenSeance,
}: {
  contenu: Contenu;
  onSelect?: (slot: TimetableSlot) => void;
  onOpenEntry?: (entry: AgendaEntrySummary) => void;
  onOpenSeance?: (seance: DaySeance) => void;
}): ReactElement {
  const ouvrir = ouvertureDe(contenu, onSelect, onOpenEntry, onOpenSeance);
  // `z-10` est inerte ici — la rangée « hors horaire » n'empile rien — mais la
  // carte reste un vrai `<button>`, donc atteignable au clavier en tête de
  // grille.
  const classes = cn(
    CLASSES_CARTE,
    "block w-full",
    apparenceDe(contenu),
    ouvrir && survolDe(contenu),
  );

  if (ouvrir === null) {
    return (
      <div className={classes} title={titreDeLaCarte(contenu, false)}>
        <CorpsCarte contenu={contenu} />
      </div>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      title={titreDeLaCarte(contenu, true)}
      aria-label={libelleOuverture(contenu)}
      onClick={ouvrir}
    >
      <CorpsCarte contenu={contenu} />
    </button>
  );
}

/** Alias par défaut, comme `DayList` : les deux formes d'import fonctionnent. */
export default WeekGrid;
