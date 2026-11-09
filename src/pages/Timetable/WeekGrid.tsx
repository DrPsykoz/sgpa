import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";

import { Link } from "react-router-dom";

import { TriangleAlert } from "lucide-react";

import { PastilleDeCategorie } from "@/components/PastilleCategorie";

import {
  absenceDuCreneau,
  absencesGroupees,
  adresseDeLaSeance,
  cibleDuRendezVous,
  motifDeFermeture as fermetureDuJour,
  motsDeAbsence,
  motsDeLegende,
  motsDesAbsences,
  studentName,
  type AbsenceDeSemaine,
} from "@/pages/Timetable/journee";
import {
  amplitudeDe,
  estPlacable,
  fromMinutes,
  HAUTEUR_DEMIE,
  HAUTEUR_PAS,
  heureFinDe,
  libelleHeure,
  libelleHoraire,
  PAS,
  placer,
  type Candidat as CandidatBrut,
  type Place as PlaceBrute,
} from "@/pages/Timetable/geometry";
import {
  compteRenduRegle,
  motsDuCahier,
  motsDuCompteRendu,
} from "@/lib/contenu";
import { styleTeinte, type TableTeintes } from "@/lib/teintes";
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
  SessionAway,
  TimetableSlot,
  WeekSchedule,
} from "@/types";

// ---------------------------------------------------------------------------
// Lecture d'une journée — propre à la grille
//
// L'arithmétique du temps, elle, vit dans `geometry.ts` : la grille de la
// semaine et le calendrier de l'accueil placent 9h25 au même endroit parce
// qu'ils partagent le même module, pas parce qu'on a recopié la même formule
// deux fois.
//
// Aucune arithmétique de calendrier ici non plus : les sept dates, le numéro de
// semaine et la parité arrivent tout faits du backend (`WeekSchedule`). Un
// `getDay()` posé ici rendrait 0 le dimanche et contredirait le jour ISO de
// tout le reste du projet.
// ---------------------------------------------------------------------------

/** Quantième du mois, lu dans la chaîne ISO. Passer par `Date` pour ça
 *  rouvrirait le décalage UTC que tout l'écran évite déjà. */
function quantieme(iso: string): string {
  return String(Number(iso.slice(8, 10)));
}

/**
 * Pourquoi personne ne fait cours ce jour-là, et pourquoi tel créneau n'a pas
 * lieu : la règle est celle de `journee.ts`, pas une seconde écriture d'elle.
 *
 * La grille y ajoute une seule chose, et c'est la raison de ces deux lignes :
 * elle dessine aussi des colonnes dont le backend ne lui a rendu aucune journée
 * — samedi et dimanche portés par un seul rendez-vous. `null` n'y vaut ni
 * « fermé » ni « masqué » : on ne sait pas, donc on ne retire rien.
 */
function motifDeFermeture(journee: DaySchedule | null): string | null {
  return journee === null ? null : fermetureDuJour(journee);
}

/** « 27/05/2029 ». */
function dateCourte(iso: string | null): string {
  return iso === null ? "" : new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR");
}

/** Six mois avant une date ISO, en heure locale. Sert de seuil d'alerte. */
function reculDeSixMois(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setMonth(d.getMonth() - 6);
  return d.toLocaleDateString("sv-SE");
}

/** Date du jour en heure locale, comme partout ailleurs dans l'écran. */
function aujourdhui(): string {
  return new Date().toLocaleDateString("sv-SE");
}

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
      /** La période qui met la classe hors cours ce jour-là, ou `null`.
       *
       *  Portée par le contenu et non relue au rendu : la carte s'estompe,
       *  écrit le motif et le porte dans son `title=`, soit trois endroits qui
       *  doivent lire le même enregistrement. */
      absence: SessionAway | null;
    }
  | { nature: "seanceLibre"; seance: DaySeance }
  | { nature: "entree"; entry: AgendaEntrySummary };

/** La géométrie ne sait pas ce qu'elle place : on la spécialise ici pour que
 *  tout le fichier continue d'écrire `Place` et `Candidat` tout court. */
type Candidat = CandidatBrut<Contenu>;
type Place = PlaceBrute<Contenu>;

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
   *  rendu. Absent : la carte reste inerte.
   *
   *  **Il n'y a pas de pendant pour la séance datée, et c'est voulu.** Une
   *  séance ne se modifie pas d'ici : la grille sert à définir l'emploi du
   *  temps, pas à tenir un appel. Le cours ponctuel y est un **lien** vers sa
   *  fiche de classe (`adresseDe`), ce qui ne demande aucun rappel à l'hôte —
   *  et c'est bien pour cela que c'est un lien : rien de nouveau ne s'ouvre
   *  dans cet écran. Un rendez-vous, lui, n'est listé par aucun autre écran —
   *  pas même par la fiche de la classe qu'il nomme. */
  onOpenEntry?: (entry: AgendaEntrySummary) => void;
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
  /** Classe → teinte, telle que `tableDesTeintes()` la rend. Absente, toutes
   *  les cartes retombent sur le bleu : le repli d'`index.css` est le bleu de
   *  l'application. */
  teintes?: TableTeintes;
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
 * **Une carte n'écrit rien non plus : elle ouvre, ou elle mène.** Le modèle
 * hebdomadaire ouvre son dialogue de créneau, dont la portée est toutes les
 * semaines ; le rendez-vous daté ouvre son compte rendu. La séance datée sans
 * créneau — le cours ponctuel — n'ouvre toujours rien **ici**, mais elle
 * **mène** à l'écran qui la modifie, celui de sa classe : elle était inerte, et
 * une carte inerte se lit « ce cours n'est pas modifiable », ce que
 * l'enseignant a signalé mot pour mot. Mener n'est pas héberger : il n'y a
 * toujours qu'un seul écran de séance, et c'est ce que la règle interdisait de
 * dédoubler. Aucune création au passage, dans aucun des cas.
 */
export function WeekGrid({
  yearStart,
  slots,
  week,
  onSelectSlot,
  onOpenEntry,
  onCreateSlot,
  teintes,
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
          absence:
            journee === null ? null : absenceDuCreneau(journee, slot.session_id),
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

    const { debut, fin } = amplitudeDe(
      jours.flatMap((jour) => placesParJour.get(jour) ?? []),
    );

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

  /**
   * Le cœur du tracé, commun aux deux surfaces qui peuvent l'amorcer : une
   * bande vide du fond, et une carte déjà posée.
   *
   * `capture` est l'élément qui retient le pointeur — celui qu'on a pressé —,
   * `bande` celui dont on relit la géométrie à chaque déplacement. Les deux se
   * confondent sur le fond ; ils diffèrent quand le geste part d'une carte, et
   * c'est tout l'objet de la séparation : la carte peut couvrir quatre heures,
   * son bord haut ne dit donc pas où l'on a pressé.
   */
  const amorcerTrace = (
    event: ReactPointerEvent<HTMLElement>,
    capture: HTMLElement,
    bande: HTMLElement,
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
    // qui suit est redirigé vers cet élément — c'est exactement le cas que
    // `ignorerProchainClic` couvre.
    try {
      capture.setPointerCapture(event.pointerId);
    } catch {
      // Pointeur déjà relâché : le tracé se suivra quand même par `window`.
    }
    bandeRef.current = bande;
    majTrace({
      jour,
      colonne,
      date,
      // Le bord haut de la bande, pas le pixel pressé : voir `Trace.ancreY`.
      ancreY: bande.getBoundingClientRect().top,
      ancreDebut: minutes,
      courantDebut: minutes,
    });
  };

  /** Amorce depuis une bande vide du fond : la bande pressée est l'ancre. */
  const commencerTrace = (
    event: ReactPointerEvent<HTMLButtonElement>,
    jour: number,
    colonne: number,
    minutes: number,
    date: string,
  ) => {
    amorcerTrace(
      event,
      event.currentTarget,
      event.currentTarget,
      jour,
      colonne,
      minutes,
      date,
    );
  };

  /**
   * Amorce depuis une carte DÉJÀ POSÉE, et c'est ce qui rend possible le second
   * cours au même horaire sans passer par le dialogue.
   *
   * Une carte couvre sa bande : le `pointerdown` ne descend jamais jusqu'au
   * fond, et c'est pour cela que la case occupée renvoyait tous ses gestes vers
   * la modification du créneau existant. On retrouve donc la bande **sous le
   * curseur** — `elementsFromPoint` les rend empilées, la carte d'abord, la
   * bande ensuite — et le tracé reprend là, à l'identique : même géométrie,
   * même aperçu, même sélection inclusive.
   *
   * Le partage des gestes est celui du calendrier : **le clic ouvre, le glissé
   * ajoute.** Sans mouvement, `relacher` ne crée rien et le `click` qui suit
   * ouvre la carte comme avant — rien n'est retiré à qui ne glisse pas.
   *
   * Aucune bande sous le curseur (rangée « hors horaire », jour fermé où le
   * fond n'est plus cliquable) : on ne fait rien, et le clic garde son sens.
   */
  const commencerTraceSurCarte = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const bande = document
      .elementsFromPoint(event.clientX, event.clientY)
      .find(
        (element): element is HTMLElement =>
          element instanceof HTMLElement && element.dataset.bande !== undefined,
      );
    if (bande === undefined) return;
    const jour = Number(bande.dataset.jour);
    const colonne = Number(bande.dataset.colonne);
    const minutes = Number(bande.dataset.minutes);
    // Trois nombres relus d'attributs : un `NaN` poserait un créneau à une
    // heure impossible plutôt que de ne rien faire.
    if (
      !Number.isFinite(jour) ||
      !Number.isFinite(colonne) ||
      !Number.isFinite(minutes)
    ) {
      return;
    }
    amorcerTrace(
      event,
      event.currentTarget,
      bande,
      jour,
      colonne,
      minutes,
      bande.dataset.date ?? "",
    );
  };

  /**
   * Le clic qui suit un glissé, à avaler. Rendu `true` quand il faut l'ignorer.
   *
   * `detail === 0` : le clic vient d'Entrée ou d'Espace. Il ne peut pas être la
   * queue d'un glissé, et ne doit donc jamais être avalé — sinon un drapeau
   * resté en l'air rendrait le clavier muet. Le drapeau se remet à zéro à
   * chaque passage, d'où qu'on vienne : c'est ce qui le rend auto-réparant.
   */
  const consommerClic = (event: ReactMouseEvent): boolean => {
    const avaler = ignorerProchainClic.current && event.detail > 0;
    ignorerProchainClic.current = false;
    return avaler;
  };

  const selection = useMemo(() => {
    if (trace === null || trace.courantDebut === trace.ancreDebut) return null;
    const bas = Math.min(trace.ancreDebut, trace.courantDebut);
    const haut = Math.max(trace.ancreDebut, trace.courantDebut);
    return { colonne: trace.colonne, debut: bas, fin: Math.min(haut + 30, fin) };
  }, [trace, fin]);

  // ---- Rendu ----

  const jourCourant = aujourdhui();

  // La couverture du calendrier, et l'avertissement quand on s'en approche.
  // Le seuil est la dernière date couverte MOINS six mois : au-delà, une
  // préparation de rentrée tomberait dans le vide sans le dire.
  const calendrierJusquAu = week.days[0]?.calendar_until ?? null;
  const horizonProche =
    calendrierJusquAu !== null &&
    jours.some((jour) => {
      const date = journeeParJour.get(jour)?.date;
      return date !== undefined && date > reculDeSixMois(calendrierJusquAu);
    });

  // Les absences de la SEMAINE, une fois par période et non une fois par
  // journée couverte : le backend les rend journée par journée, donc un stage
  // d'une semaine arrive cinq fois.
  const absences = useMemo(() => absencesGroupees(week.days), [week.days]);

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
            const absences = journee === null ? null : motsDesAbsences(journee);
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
                {/* Le résumé de la journée reste, même depuis que les cartes
                    portent leur motif : une classe peut être hors cours un jour
                    où elle n'a aucun créneau, et une période « l'appel se fait
                    quand même » ne change aucune carte. Sans cette ligne, elles
                    ne seraient nulle part. */}
                {!fermeture && absences !== null && (
                  <span
                    className="mt-0.5 block truncate text-[10px] font-normal leading-tight text-muted-foreground"
                    title={absences.detail}
                  >
                    {absences.ligne}
                  </span>
                )}
              </div>
            );
          })}

          {/* Rangée « hors horaire », en tête de grille : un rendez-vous dont
              l'heure reste à caler (`start_time = ''`) n'a aucune place dans la
              grille horaire, et il ne doit pas pour autant disparaître. Même
              doctrine qu'à l'accueil, qui ouvre la journée par ces lignes-là.
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
                    teintes={teintes}
                    onSelect={onSelectSlot}
                    onOpenEntry={onOpenEntry}
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
              // Un créneau dont le JOUR est fermé n'est pas dessiné : l'en-tête
              // de la colonne dit « Vacances de la Toussaint » une fois, et
              // vingt-quatre cartes estompées le rediraient vingt-quatre fois.
              // C'est le SEUL objet qu'on retire, et il le supporte : un créneau
              // est un modèle, il n'existe pas.
              //
              // La classe hors cours, elle, GARDE sa carte depuis le palier 020
              // — estompée, le motif écrit dessus. C'est la question posée par
              // « améliorer le visuel quand la classe est absente » : une
              // colonne nue ne disait pas si l'emploi du temps était saisi, et
              // le petit mot gris de l'en-tête était tout ce qui en restait.
              // Rien ne se crée pour autant depuis cet écran : une carte y
              // ouvre sa définition, jamais son contenu.
              .filter(
                (place) =>
                  place.contenu.nature !== "creneau" ||
                  motifDeFermeture(journeeParJour.get(jour) ?? null) === null,
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
                teintes={teintes}
                onSelect={onSelectSlot}
                onOpenEntry={onOpenEntry}
                // Les deux vont ensemble : sans l'avaleur, le glissé créerait
                // la plage ET ouvrirait la carte de départ par-dessus.
                onDebutTrace={onCreateSlot ? commencerTraceSurCarte : undefined}
                clicAAvaler={onCreateSlot ? consommerClic : undefined}
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
                  // La bande se décrit pour qu'on la retrouve SOUS une carte :
                  // `commencerTraceSurCarte` n'a que des coordonnées écran, et
                  // il lui faut le jour, la colonne, la minute et la date de ce
                  // qu'il a trouvé. Des attributs et non une carte d'index
                  // parallèle : la source est l'élément lui-même, donc elle ne
                  // peut pas se désynchroniser de ce qui est dessiné.
                  data-bande=""
                  data-jour={jour}
                  data-colonne={index + 2}
                  data-minutes={t}
                  data-date={dateDuJour}
                  onPointerDown={(event) =>
                    commencerTrace(event, jour, index + 2, t, dateDuJour)
                  }
                  onClick={(event) => {
                    if (consommerClic(event)) return;
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

      <LegendeDesAbsences absences={absences} teintes={teintes} />

      {/* LA LIGNE D'HORIZON, et elle est obligatoire.
          Passé la dernière date couverte, la fonctionnalité ne s'éteint pas :
          elle se met à mentir dans l'autre sens — des créneaux redessinés
          pendant des vacances qu'on ne connaît plus. En septembre 2029
          l'enseignant sera dans la grille, pas dans les réglages, et ce qu'il
          verra n'aura l'air de rien d'anormal.

          Elle n'apparaît qu'une fois la semaine dépassée les trois quarts de la
          couverture : l'afficher en permanence serait un avertissement qu'on
          cesse de lire, donc un avertissement inutile le jour où il compte. */}
      {horizonProche && (
        <p className="flex items-start justify-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-center text-xs text-amber-900">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Le calendrier scolaire embarqué s'arrête au{" "}
            <span className="font-medium">{dateCourte(calendrierJusquAu)}</span>.
            Au-delà, les vacances ne sont plus connues et les créneaux seront
            redessinés comme des jours de cours. Mettez SGPA à jour.
          </span>
        </p>
      )}

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

/** La classe à laquelle la carte appartient, ou `null` — une occupation sans
 *  classe, un rendez-vous. C'est elle qui donne sa teinte à la carte. */
function sessionDe(contenu: Contenu): string | null {
  switch (contenu.nature) {
    case "creneau":
      return contenu.slot.session_id;
    case "seanceLibre":
      return contenu.seance.session_id;
    case "entree":
      return null;
  }
}

/**
 * Les quatre états de carte, aucun signe nouveau : filet pâle = cours prévu et
 * rien d'écrit, filet tireté = occupation sans classe, **filet franc et fond
 * d'un cran plus soutenu = une séance existe à cette date**, `opacity-40` =
 * **ce cours ne se tient pas cette semaine-là** — estompé, jamais masqué : une
 * case disparue passerait pour un créneau perdu.
 *
 * Ce dernier état a deux causes et un seul dessin, et c'est voulu : le créneau
 * de quinzaine qui ne tombe pas cette semaine, et la classe hors cours — stage,
 * ou professeur absent. Un second dessin aurait demandé une légende ; la carte,
 * elle, écrit le motif en toutes lettres à la place de la mention de quinzaine
 * (`CorpsCarte`), donc le même estompage ne peut pas se lire de deux façons.
 *
 * Le troisième état était une barre épaisse le long du bord gauche. Elle
 * disait juste, mais c'était un ornement posé à côté de la carte, là où la
 * carte pouvait le dire elle-même ; `teinte-appui` ne fait que l'appuyer d'un
 * cran, donc rien n'est devenu plus pâle qu'avant.
 *
 * Le cours porte en plus la **teinte de sa classe** : `teinte-carte` lit
 * `--classe-h`, posée en style en ligne par `styleTeinte()`. Sans table de
 * teintes, le repli d'`index.css` vaut le bleu, c'est-à-dire exactement
 * l'aspect d'avant — un appelant qui ne passe pas `teintes` ne casse rien.
 *
 * Aucune classe utilitaire de couleur sur les branches teintées : la couche
 * `utilities` de Tailwind passe après `components`, donc un `border-primary/30`
 * emporterait `teinte-carte` en silence.
 */
function apparenceDe(contenu: Contenu): string {
  switch (contenu.nature) {
    case "creneau":
      return cn(
        contenu.slot.session_id
          ? cn("teinte-carte", contenu.seance && "teinte-appui")
          : "border-dashed border-border bg-muted text-muted-foreground",
        (contenu.horsSemaine || contenu.absence !== null) && "opacity-40",
      );
    case "seanceLibre":
      return "teinte-carte teinte-appui";
    case "entree":
      return "border-agenda bg-agenda-fond text-agenda-encre";
  }
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
  parts.push(motsDuCahier(seance).infobulle);
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
    const { slot, seance, horsSemaine, absence } = contenu;
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
    // Avant l'état de la séance, et non à sa place : la séance peut très bien
    // exister à cette date — elle a été préparée avant que le stage ne soit
    // saisi —, et l'infobulle doit alors dire les deux.
    if (absence !== null) lignes.push(motsDeAbsence(absence).infobulle);
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
  lignes.push(
    entry.category ? `${entry.title} — ${entry.category}` : entry.title,
  );
  lignes.push(libelleHoraire(entry.start_time, entry.end_time));
  // L'infobulle a la place de dire les deux, là où la carte doit choisir :
  // « MARTIN Hugo » puis « 4ème A » sur deux lignes.
  const eleve = studentName(entry);
  if (eleve) lignes.push(eleve);
  if (entry.session_name) lignes.push(entry.session_name);
  lignes.push(`Rendez-vous · ${motsDuCompteRendu(entry).infobulle}.`);
  // Phrase à part, et non accrochée au seul cas vide : un rendez-vous n'a pas
  // d'appel, qu'il porte un compte rendu ou non. La coller à « compte rendu
  // vide » laissait croire que le remplir le ferait compter.
  lignes.push("N'entre dans aucun calcul d'assiduité.");
  return lignes.filter((ligne) => ligne).join("\n");
}

/** Les signes d'état d'une séance, dans une carte de 7 rem : `●` appel
 *  terminé, `○` appel commencé ou non fait, `▣` cahier de texte **réglé**.
 *  Réglé et non rempli : l'enseignant a trois façons d'en avoir fini — écrire,
 *  dire « rien à écrire », joindre la photo du tableau — et un signe qui n'en
 *  reconnaîtrait qu'une réclamerait ce que l'accueil ne demande plus. Les mots
 *  correspondants sont dans le `title=` de la carte, d'où l'`aria-hidden` — un
 *  lecteur d'écran ne lit pas des ronds. */
function Signes({ seance }: { seance: DaySeance }): ReactElement | null {
  if (seance.cancelled) return null;
  const complet =
    seance.attendance_total > 0 &&
    seance.attendance_done >= seance.attendance_total;
  return (
    <span aria-hidden className="shrink-0 font-medium">
      {seance.attendance_total > 0 && (complet ? "●" : "○")}
      {compteRenduRegle(seance) && " ▣"}
    </span>
  );
}

function CorpsCarte({ contenu }: { contenu: Contenu }): ReactElement {
  if (contenu.nature === "creneau") {
    const { slot, seance, absence } = contenu;
    // La mention de la dernière ligne. Le motif de l'absence PASSE DEVANT la
    // quinzaine : les deux disent « ce cours ne se tient pas », et celui qui
    // compte est le plus fort — savoir que le créneau tombe les semaines paires
    // n'apprend rien un jour où la classe est en stage. Une cinquième ligne
    // aurait été rognée : une carte d'une heure ne fait que 48 px.
    const mention =
      absence !== null ? motsDeAbsence(absence).carte : abregerQuinzaine(slot);
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
            les signes d'état partagent donc la ligne de la mention plutôt que
            d'en ajouter une cinquième qui serait rognée. */}
        <span className="flex items-baseline justify-between gap-1 text-muted-foreground">
          <span className="min-w-0 truncate">
            {libelleHoraire(slot.start_time, slot.end_time)}
            {slot.room && ` · ${slot.room}`}
          </span>
          {!mention && seance && <Signes seance={seance} />}
        </span>
        {mention && (
          <span className="flex items-baseline justify-between gap-1 font-medium text-muted-foreground">
            <span className="min-w-0 truncate">{mention}</span>
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
  const cible = cibleDuRendezVous(entry);
  return (
    <>
      <span className="block truncate font-medium">{entry.title}</span>
      {/* Sous l'intitulé et au-dessus du reste : c'est la ligne de l'horaire
          qui est rognée la première si la carte manque de hauteur, et c'est
          la bonne victime — la position de la carte dans la grille dit déjà
          l'heure, le `title=` la redit en mots, et une catégorie invisible ne
          sert à rien. */}
      <PastilleDeCategorie category={entry.category} />
      {cible && <span className="block truncate">{cible}</span>}
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
 * **Une carte ouvre sa définition, jamais son contenu.** C'est la règle de
 * tout cet écran, et c'est elle qui décide des branches ci-dessous.
 *
 * Le **modèle** hebdomadaire s'ouvre sur son dialogue de créneau : la
 * modification vaut alors pour toutes les semaines, pas pour la case cliquée.
 * Le **rendez-vous daté** — une visite de stage d'abord — s'ouvre sur son
 * compte rendu, parce qu'il n'a pas d'autre définition que ce texte et
 * qu'aucun autre écran ne le liste.
 *
 * La **séance datée** n'ouvre rien ici, et c'est toujours vrai : son appel et
 * son cahier de texte sont son contenu, pas sa définition, et ils ont deux
 * écrans à eux — l'accueil, qui montre le jour même et les suivants, et la
 * fiche de sa classe, qui liste toutes ses séances. Ne pas rouvrir cette
 * porte : deux écrans qui modifient la même séance finissent par ne pas en
 * dire la même chose. Ce qu'elle fait depuis, c'est **y mener**
 * (`adresseDe`), ce qui ne dédouble rien.
 *
 * Une séance rattachée à un créneau n'a de toute façon pas de carte à elle :
 * elle est dessinée en surcouche de son modèle (`nature: "creneau"`, champ
 * `seance`), et cette carte-là ouvre donc le créneau — la grille n'ayant
 * qu'une carte pour ce cours, elle ne peut pas offrir deux destinations sans
 * faire deviner laquelle.
 *
 * Ouvrir est une **lecture** : aucune de ces branches n'écrit quoi que ce
 * soit, et une carte de créneau posée sur un jour sans séance n'en crée pas.
 */
function ouvertureDe(
  contenu: Contenu,
  onSelect?: (slot: TimetableSlot) => void,
  onOpenEntry?: (entry: AgendaEntrySummary) => void,
): (() => void) | null {
  if (contenu.nature === "creneau" && onSelect) {
    const { slot } = contenu;
    return () => onSelect(slot);
  }
  if (contenu.nature === "entree" && onOpenEntry) {
    const { entry } = contenu;
    return () => onOpenEntry(entry);
  }
  return null;
}

/**
 * Où la carte **mène**, ou `null` quand elle ne mène nulle part.
 *
 * Le pendant d'`ouvertureDe`, et la même doctrine qu'à l'accueil : une carte
 * qui conduit ailleurs est un **lien** et non un bouton, pour que le clic du
 * milieu, « ouvrir dans un nouvel onglet » et le clavier fassent ce qu'ils
 * promettent. Quand les deux répondent, c'est l'adresse qui gagne.
 *
 * Seule la **séance datée sans créneau** — le cours ponctuel — en a une. Elle
 * ne s'ouvre pas ici : elle mène à l'unique écran qui la modifie, celui de sa
 * classe, exactement là où l'accueil mène déjà, et par la même rédaction
 * d'adresse (`adresseDeLaSeance`). L'emploi du temps continue de ne rien
 * héberger ; il dit désormais où est l'écran, ce qu'une carte inerte ne savait
 * pas faire — « je ne peux pas cliquer dessus pour accéder à ses
 * informations » est exactement ce qui a été signalé.
 *
 * Une séance née d'un créneau n'entre pas ici : la grille n'a qu'une carte pour
 * ce cours, cette carte ouvre son modèle, et offrir deux destinations à la même
 * carte ferait deviner laquelle. Son horaire se corrige d'ailleurs dans le
 * modèle, et pour toutes les semaines à la fois.
 */
function adresseDe(contenu: Contenu): string | null {
  if (contenu.nature !== "seanceLibre") return null;
  return adresseDeLaSeance(contenu.seance);
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
    return `Ouvrir « ${seance.title} » — ${seance.session_name}, dans la fiche de sa classe`;
  }
  const { entry } = contenu;
  const cible = cibleDuRendezVous(entry);
  return `Ouvrir le compte rendu de « ${entry.title} »${cible ? ` — ${cible}` : ""}`;
}

/**
 * Le `title=` de la carte, augmenté de ce que le clic va faire — ou, pour la
 * seule carte qui ne clique pas, de l'endroit où elle se modifie.
 *
 * Le créneau n'en reçoit pas : ouvrir un créneau au clic est le geste que la
 * grille enseigne depuis le début. Le rendez-vous cache un écran qui ne se
 * devine pas d'une carte de 7 rem.
 *
 * La séance datée ne s'ouvre **pas ici** et ne s'y ouvrira pas : « l'emploi du
 * temps définit, l'accueil ouvre », et deux écrans qui modifient la même
 * séance finissent par ne pas en dire la même chose. Mais une carte inerte et
 * muette se lit « ce cours n'est pas modifiable » — c'est mot pour mot ce que
 * l'enseignant a signalé du cours ponctuel. La phrase annonce donc où le clic
 * mène : là où tout est déjà modifiable, horaire compris.
 */
function titreDeLaCarte(contenu: Contenu, ouvrable: boolean): string {
  const texte = titreDe(contenu);
  if (contenu.nature === "seanceLibre") {
    return `${texte}\nCliquez pour ouvrir cette séance dans la fiche de sa classe.`;
  }
  if (!ouvrable) return texte;
  if (contenu.nature === "entree") {
    return `${texte}\nCliquez pour ouvrir le compte rendu.`;
  }
  return texte;
}

/** Le survol reprend la couleur de la carte : un rendez-vous bleu qui virerait
 *  au ton des créneaux au passage de la souris se lirait comme un changement de
 *  nature. */
/**
 * Le survol d'une carte ouvrable.
 *
 * Il ne touche plus au FOND, et il ne peut plus : `teinte-carte` vit dans la
 * couche `components`, un `hover:bg-primary/20` est une utilitaire, et les
 * utilitaires passent après — la carte d'une classe verte serait devenue bleue
 * au passage de la souris. Le relief dit « ceci s'ouvre » sans rien promettre
 * sur la couleur.
 */
const SURVOL_CARTE = "cursor-pointer transition-shadow hover:shadow-relief";

interface CarteProps {
  place: Place;
  colonne: number;
  ligneDebut: number;
  ligneFin: number;
  teintes?: TableTeintes;
  onSelect?: (slot: TimetableSlot) => void;
  onOpenEntry?: (entry: AgendaEntrySummary) => void;
  /** Amorce d'un tracé SUR la carte : c'est par là qu'on ajoute un second cours
   *  à un horaire déjà occupé, la carte couvrant la bande du fond. Absent quand
   *  la grille ne crée rien. */
  onDebutTrace?: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Rend `true` quand le clic qui arrive est la queue d'un glissé : la carte
   *  ne doit alors pas s'ouvrir. */
  clicAAvaler?: (event: ReactMouseEvent) => boolean;
}

function Carte({
  place,
  colonne,
  ligneDebut,
  ligneFin,
  teintes,
  onSelect,
  onOpenEntry,
  onDebutTrace,
  clicAAvaler,
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
  //
  // `--classe-h` est posée ici, sur l'enveloppe, et non sur la carte : les
  // propriétés personnalisées s'héritent, et c'est l'enveloppe qui porte déjà
  // un style en ligne.
  const style: CSSProperties = {
    gridColumn: colonne,
    gridRow: `${ligneDebut} / ${ligneFin}`,
    width: `${100 / voies}%`,
    marginLeft: `${(voie * 100) / voies}%`,
    ...styleTeinte(teintes, sessionDe(contenu)),
  };

  // L'adresse d'abord, le geste ensuite : les deux ne répondent jamais pour la
  // même carte, mais l'ordre fixe la règle une fois pour toutes plutôt que de
  // la laisser dépendre des branches.
  const mene = adresseDe(contenu);
  const ouvrir =
    mene === null ? ouvertureDe(contenu, onSelect, onOpenEntry) : null;
  const cliquable = mene !== null || ouvrir !== null;
  // `px-0.5 pt-px` : les 2 px latéraux et le 1 px du haut d'autrefois, au pixel
  // près — mais à l'intérieur de la surface sensible, pas à côté.
  const enveloppe = cn("z-10 block px-0.5 pt-px", cliquable && "cursor-pointer");
  const classes = cn(
    CLASSES_CARTE,
    "h-full",
    apparenceDe(contenu),
    cliquable && SURVOL_CARTE,
  );

  // Un LIEN quand la carte mène ailleurs — le cours ponctuel, vers la fiche de
  // sa classe. Un `<button>` qui naviguerait serait un mensonge : clic du
  // milieu, « ouvrir dans un nouvel onglet » et copie de l'adresse n'auraient
  // rien à prendre.
  if (mene !== null) {
    return (
      <Link
        to={mene}
        className={enveloppe}
        style={style}
        title={titreDeLaCarte(contenu, true)}
        aria-label={libelleOuverture(contenu)}
        // Le navigateur sait glisser un lien tout seul : sans ce `false`, tirer
        // sur la carte d'un cours ponctuel décollerait le fantôme de l'ancre et
        // le tracé n'aurait jamais lieu — le seul horaire impossible à doubler
        // serait celui-là, et pour une raison invisible.
        draggable={false}
        onPointerDown={onDebutTrace}
        // Le clic mène, le glissé ajoute à côté. Quand le second a eu lieu, il
        // ne suffit pas de ne rien faire du `click` que le navigateur émet
        // encore : un lien part de lui-même, il faut le lui interdire — sans
        // quoi le glissé poserait la plage ET quitterait l'emploi du temps.
        onClick={(event) => {
          if (clicAAvaler?.(event)) event.preventDefault();
        }}
      >
        <div className={classes}>
          <CorpsCarte contenu={contenu} />
        </div>
      </Link>
    );
  }

  // La carte inerte couvre sa bande tout autant que les autres : elle reçoit
  // donc la même amorce. Sans elle, un horaire occupé resterait impossible à
  // doubler. Elle ne reste inerte que faute de rappel — une grille en lecture
  // seule — ou pour une occupation sans classe, qui est un modèle et n'a rien
  // derrière elle.
  if (ouvrir === null) {
    return (
      <div
        className={enveloppe}
        style={style}
        title={titreDeLaCarte(contenu, false)}
        onPointerDown={onDebutTrace}
      >
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
      onPointerDown={onDebutTrace}
      // Le clic ouvre, le glissé ajoute : quand le second a eu lieu, le `click`
      // que le navigateur émet encore sur la carte de départ est avalé.
      onClick={(event) => {
        if (clicAAvaler?.(event)) return;
        ouvrir();
      }}
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
 *  cours ponctuel saisi sans horaire. La visite s'y ouvre d'un clic — sa place
 *  dans la grille est précisément ce qu'on vient y définir ; le cours ponctuel
 *  **mène** à sa fiche de classe, et c'est ici que ce lien sert le plus : une
 *  séance sans horaire est justement celle dont l'heure reste à saisir, et
 *  cette rangée était le seul endroit où elle apparaissait. */
function CarteLibre({
  contenu,
  teintes,
  onSelect,
  onOpenEntry,
}: {
  contenu: Contenu;
  teintes?: TableTeintes;
  onSelect?: (slot: TimetableSlot) => void;
  onOpenEntry?: (entry: AgendaEntrySummary) => void;
}): ReactElement {
  const mene = adresseDe(contenu);
  const ouvrir =
    mene === null ? ouvertureDe(contenu, onSelect, onOpenEntry) : null;
  const cliquable = mene !== null || ouvrir !== null;
  // Ici la teinte va sur la carte elle-même : la rangée « hors horaire » n'a
  // pas d'enveloppe de grille pour la porter.
  const style = styleTeinte(teintes, sessionDe(contenu));
  // `z-10` est inerte ici — la rangée « hors horaire » n'empile rien — mais la
  // carte reste un vrai `<button>` ou un vrai lien, donc atteignable au clavier
  // en tête de grille.
  const classes = cn(
    CLASSES_CARTE,
    "block w-full",
    apparenceDe(contenu),
    cliquable && SURVOL_CARTE,
  );

  if (mene !== null) {
    return (
      <Link
        to={mene}
        className={classes}
        style={style}
        title={titreDeLaCarte(contenu, true)}
        aria-label={libelleOuverture(contenu)}
      >
        <CorpsCarte contenu={contenu} />
      </Link>
    );
  }

  if (ouvrir === null) {
    return (
      <div
        className={classes}
        style={style}
        title={titreDeLaCarte(contenu, false)}
      >
        <CorpsCarte contenu={contenu} />
      </div>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      style={style}
      title={titreDeLaCarte(contenu, true)}
      aria-label={libelleOuverture(contenu)}
      onClick={ouvrir}
    >
      <CorpsCarte contenu={contenu} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// La légende des absences
// ---------------------------------------------------------------------------

/** « Lun 9 ». Le nom du jour se déduit de la date — et `getDay()` compte le
 *  dimanche en 0 là où tout le reste de l'application numérote les jours de 1
 *  à 7, comme l'ISO et comme `timetable_slots.weekday`. */
function jourCourt(iso: string): string {
  const js = new Date(`${iso}T00:00:00`).getDay();
  return `${WEEKDAY_SHORT_LABELS[js === 0 ? 7 : js]} ${quantieme(iso)}`;
}

/** « Lun 9 », ou « Lun 9 → Ven 13 » quand la période couvre plusieurs jours de
 *  la semaine affichée.
 *
 *  Les jours intermédiaires ne sont pas écrits : une période peut sauter un
 *  jour — un mercredi sans cours —, et la légende dit la **portée**, pas le
 *  calendrier. Ce sont les colonnes de la grille qui disent le détail, et c'est
 *  précisément leur travail. */
function libelleDesJours(jours: string[]): string {
  const premier = jours[0];
  const dernier = jours[jours.length - 1];
  if (premier === undefined || dernier === undefined) return "";
  if (premier === dernier) return jourCourt(premier);
  return `${jourCourt(premier)} → ${jourCourt(dernier)}`;
}

/**
 * Les stages et absences de la semaine, en clair et sous la grille.
 *
 * **Elle répare un manque signalé, elle n'ornemente pas.** L'en-tête d'une
 * colonne fait six caractères : à deux classes hors cours le même jour il
 * écrit « 2 classes hors cours », ce qui est vrai et inutilisable — ni
 * laquelle, ni pourquoi, ni ce que l'assiduité en fait. Le détail existait,
 * mais dans un `title=`, et une infobulle ne se découvre pas.
 *
 * **Sous la grille et non dedans.** Une colonne n'a pas la place d'une phrase,
 * et la même période revient dans chaque journée qu'elle couvre : écrite dans
 * les colonnes, elle le serait cinq fois.
 *
 * La pastille de classe reprend la **teinte et le filet de la carte** qu'elle
 * explique — c'est ce qui en fait une légende plutôt qu'une seconde liste à
 * rapprocher à l'œil. Elle n'écrit aucune couleur : `teinte-carte` et
 * `styleTeinte` sont ceux de la grille.
 *
 * Les mots viennent de `journee.ts` (`motsDeLegende`), avec ceux des cartes :
 * deux rédactions finiraient par ne pas dire la même chose de la même période.
 */
function LegendeDesAbsences({
  absences,
  teintes,
}: {
  absences: AbsenceDeSemaine[];
  teintes?: TableTeintes;
}): ReactElement | null {
  // Aucune période, aucun bloc : une légende vide apprendrait qu'il existe des
  // absences là où il n'y en a pas.
  if (absences.length === 0) return null;

  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs">
      <p className="font-medium">Stages et absences de la semaine</p>
      <ul className="mt-1.5 space-y-1.5">
        {absences.map(({ cle, away, jours }) => {
          const mots = motsDeLegende(away);
          return (
            <li key={cle} className="flex flex-wrap items-baseline gap-x-2">
              <span
                className={cn(CLASSES_CARTE, "shrink-0 teinte-carte font-medium")}
                style={styleTeinte(teintes, away.session_id)}
              >
                {away.session_name}
              </span>
              <span className="font-medium">{mots.quoi}</span>
              <span className="text-muted-foreground">
                {libelleDesJours(jours)}
              </span>
              {/* `basis-full` : l'effet sur l'assiduité passe à la ligne. C'est
                  la phrase la plus longue et la moins scannée des trois — la
                  garder sur la même ligne repousserait les dates hors de vue
                  dès qu'une classe a un nom un peu long. */}
              <span className="basis-full text-muted-foreground">
                {mots.effet}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Alias par défaut : les deux formes d'import fonctionnent. */
export default WeekGrid;
