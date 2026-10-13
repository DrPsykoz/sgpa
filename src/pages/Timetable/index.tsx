import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
} from "lucide-react";

import { AgendaEntryEditor } from "@/components/AgendaEntryEditor";
import { DataState } from "@/components/DataState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { ConfirmDialog } from "@/pages/SessionDetail/dialogs/ConfirmDialog";
import { SeanceDetail } from "@/pages/SessionDetail/seance/SeanceDetail";
import { DayList } from "@/pages/Timetable/DayList";
import { CancelReasonDialog } from "@/pages/Timetable/CancelReasonDialog";
import { NewPlanningDialog } from "@/pages/Timetable/NewPlanningDialog";
import { SlotDialog } from "@/pages/Timetable/SlotDialog";
import { WeekGrid } from "@/pages/Timetable/WeekGrid";
import { api } from "@/lib/api";
import { schoolYearLabel } from "@/types";
import type {
  AgendaEntry,
  AgendaEntrySummary,
  DaySchedule,
  DaySeance,
  Seance,
  Session,
  Student,
  TimetableSlot,
  TimetableSlotInput,
  WeekSchedule,
} from "@/types";

type Vue = "jour" | "semaine";

/** Séance ouverte : sa classe, et son identifiant. Jamais l'entité elle-même —
 *  c'est la liste rechargée qui la redonne à chaque rendu (règle 1). */
interface SeanceOuverte {
  sessionId: string;
  seanceId: string;
}

/** Ce qu'un clic — ou un tracé — sur une bande vide de la grille a déjà dit.
 *
 *  Le jour ISO sert aux formes hebdomadaires, la date aux formes datées. Les
 *  deux voyagent ensemble jusqu'au sélecteur, qui ne sait pas encore laquelle
 *  des deux comptera : c'est le type choisi ensuite qui tranche. */
interface AjoutPrefill {
  weekday: number;
  startTime: string;
  endTime: string;
  date: string;
}

/** Création en attente de confirmation : le créneau **et la date** visée.
 *  Les deux voyagent ensemble jusqu'au texte du dialogue — c'est la seule
 *  façon d'être certain que la date annoncée est celle qui sera écrite. */
interface CreationConfirmee {
  slot: TimetableSlot;
  date: string;
}

/** Date du jour en heure locale. `toISOString()` daterait une journée ouverte
 *  le 1er décembre à 00h30 au 30 novembre, donc au mauvais trimestre. */
function today(): string {
  return new Date().toLocaleDateString("sv-SE");
}

/** Décalage en jours, en heure locale : l'aller-retour par `Date` passe les
 *  changements d'heure sans glisser d'un jour. */
function shiftDate(iso: string, delta: number): string {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + delta);
  return date.toLocaleDateString("sv-SE");
}

function longDate(iso: string): string {
  const texte = new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR");
}

/**
 * « Lundi 16 → dimanche 22 novembre 2026 ».
 *
 * Les deux bornes viennent du backend, jamais d'un calcul de lundi fait ici :
 * `get_week_schedule` ramène elle-même n'importe quelle date au lundi ISO, et
 * une seconde implémentation de cette règle divergerait au premier écart. Le
 * mois et l'année ne se répètent à gauche que s'ils diffèrent à droite.
 */
function libelleSemaine(debutIso: string, finIso: string): string {
  const debut = new Date(`${debutIso}T00:00:00`);
  const fin = new Date(`${finIso}T00:00:00`);
  const memeAnnee = debut.getFullYear() === fin.getFullYear();
  const memeMois = memeAnnee && debut.getMonth() === fin.getMonth();

  const optionsGauche: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
  };
  if (!memeMois) optionsGauche.month = "long";
  if (!memeAnnee) optionsGauche.year = "numeric";

  const gauche = debut.toLocaleDateString("fr-FR", optionsGauche);
  const droite = fin.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const texte = `${gauche} → ${droite}`;
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

function messageOf(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Une erreur inattendue est survenue.";
}

/**
 * L'emploi du temps : la journée telle qu'elle se lit debout entre deux cours,
 * et la grille hebdomadaire telle qu'elle se règle une fois par an.
 *
 * Le créneau y reste un **modèle** : aucune séance n'est engendrée d'office, ni
 * par la navigation, ni par un clic isolé. Une séance qui existe compte au
 * dénominateur d'assiduité du bilan remis aux familles — c'est pour cela que
 * l'occurrence naît d'un geste, et que ce geste se confirme sur une date
 * passée.
 *
 * Deux gestes, et deux seulement, écrivent dans `seances` depuis cet écran :
 * « Créer et ouvrir » l'occurrence d'un créneau, et le **cours ponctuel** du
 * sélecteur d'ajout — un remplacement, une séance exceptionnelle. Les deux
 * naissent d'un geste nommé, jamais de la navigation : le cours ponctuel de son
 * formulaire et de son bouton d'enregistrement, l'occurrence du bouton « Créer
 * et ouvrir » de la journée — ou d'un clic sur sa rangée, qui fait la même
 * chose. Sur une date passée, les deux le disent en plus : l'occurrence par sa
 * confirmation, le cours ponctuel par l'avertissement de son formulaire.
 *
 * Aucune règle de temps n'est recalculée ici : le trimestre, l'année scolaire,
 * le jour ISO et la parité de la semaine arrivent tout faits du backend.
 */
export default function Timetable(): ReactElement {
  const [vue, setVue] = useState<Vue>("jour");
  const [date, setDate] = useState(today);

  const [day, setDay] = useState<DaySchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // La semaine affichée est celle de `date` : il n'existe qu'un seul état de
  // temps, et les flèches de semaine déplacent la même `date` que la journée.
  //
  // L'ANNÉE SCOLAIRE, elle, n'est pas la même des deux côtés, et c'est voulu :
  // le backend date la semaine par son LUNDI (`year_start_for(monday)`) alors
  // que la journée se date par elle-même. Sur la semaine qui enjambe le 1er
  // août — samedi 1er août 2026, donc lundi 27 juillet 2026 — la journée rend
  // 2026-2027 et la semaine 2025-2026. Voir `anneeEcran` plus bas : c'est elle,
  // et jamais `yearStart`, qui alimente la grille et l'écriture d'un créneau.
  const [week, setWeek] = useState<WeekSchedule | null>(null);
  const [weekLoading, setWeekLoading] = useState(false);
  const [weekError, setWeekError] = useState<string | null>(null);

  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);

  const [busySlotId, setBusySlotId] = useState<string | null>(null);
  // Le créneau **et la date** sur lesquels porte la confirmation. La date de
  // l'écran ne suffit pas : la grille de la semaine montre sept jours, et un
  // dialogue qui annoncerait une date pendant qu'une autre s'écrit serait pire
  // que pas de dialogue du tout.
  const [confirmSlot, setConfirmSlot] = useState<CreationConfirmee | null>(null);

  const [slotDialogOpen, setSlotDialogOpen] = useState(false);
  // L'identifiant seul, jamais l'entité : c'est la liste rechargée qui redonne
  // le créneau à chaque rendu (règle 1). Un créneau figé ici resterait tel quel
  // pendant que la liste se recharge sous lui.
  const [slotEnEditionId, setSlotEnEditionId] = useState<string | null>(null);
  // Le point d'entrée unique de « Ajouter… ». Il vit au-dessus des onglets :
  // le même bouton dans les deux vues, qui ne bouge pas quand on en change.
  const [ajoutOpen, setAjoutOpen] = useState(false);
  // Ce que le geste a déjà dit, quand il vient d'une case de la grille : le
  // jour, la plage tracée, et la date de la colonne. `null` quand l'ouverture
  // vient du bouton « Ajouter… », qui ne dit qu'une chose — la journée
  // affichée.
  const [ajoutPrefill, setAjoutPrefill] = useState<AjoutPrefill | null>(null);
  // « Ce cours n'a pas lieu » demande désormais pourquoi avant d'écrire. Le
  // couple porte le créneau ET la date : depuis une semaine sur laquelle on a
  // navigué, la date de la case n'est pas celle de l'onglet Journée, et c'est
  // celle de la case qui s'écrit.
  const [annulation, setAnnulation] = useState<{
    slot: TimetableSlot;
    date: string;
  } | null>(null);
  const [entryOuverte, setEntryOuverte] = useState<string | null>(null);

  // La séance ouverte est hébergée ici, comme `SeancesTab` héberge la sienne :
  // le parent garde la liste et l'identifiant, l'enfant reçoit l'entité dérivée.
  const [seanceOuverte, setSeanceOuverte] = useState<SeanceOuverte | null>(null);
  const [seances, setSeances] = useState<Seance[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [seanceLoading, setSeanceLoading] = useState(false);

  const yearStart = day?.year_start ?? null;

  /**
   * L'année scolaire **de ce qui est à l'écran**.
   *
   * En vue Journée c'est celle de la journée ; en vue Semaine, celle de la
   * semaine regardée, que le backend date par son lundi. Les deux ne diffèrent
   * que sur la semaine qui enjambe le 1er août, mais elles diffèrent vraiment :
   * la grille afficherait alors les créneaux de l'année suivante posés sur les
   * dates de la précédente, aucune séance ne pourrait plus s'apparier à son
   * créneau, et un créneau tracé là partirait dans l'année que l'en-tête ne
   * nomme pas. Tout ce qui lit ou écrit la grille passe par ici.
   */
  const anneeEcran =
    vue === "semaine" && week !== null ? week.year_start : yearStart;

  // ---- Lectures ----

  // Garde de génération : trois clics rapides sur les flèches lancent trois
  // lectures concurrentes, et rien ne garantit qu'elles reviennent dans
  // l'ordre. Sans ce jeton, une réponse en retard écraserait durablement la
  // journée ou la semaine réellement demandée — plus rien ne relance la
  // lecture tant que `date` ne bouge pas.
  const generationJour = useRef(0);
  const generationSemaine = useRef(0);

  const chargerJour = useCallback(async () => {
    const jeton = ++generationJour.current;
    setLoading(true);
    setLoadError(null);
    try {
      const lue = await api.getDaySchedule(date);
      if (jeton !== generationJour.current) return;
      setDay(lue);
    } catch (err) {
      if (jeton !== generationJour.current) return;
      setDay(null);
      setLoadError(messageOf(err));
    } finally {
      if (jeton === generationJour.current) setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void chargerJour();
  }, [chargerJour]);

  /** Relecture sans repasser par l'état de chargement : après une écriture, le
   *  squelette de `DataState` ferait clignoter la journée entière. */
  const rafraichirJour = useCallback(async () => {
    const jeton = ++generationJour.current;
    const lue = await api.getDaySchedule(date);
    // L'erreur, elle, remonte toujours : c'est l'appelant qui décide s'il
    // l'affiche. Seule la pose du résultat est conditionnelle.
    if (jeton === generationJour.current) setDay(lue);
  }, [date]);

  // Même garde que pour la journée : `anneeEcran` peut changer deux fois de
  // suite (entrée en vue Semaine sur la semaine du 1er août), et une liste de
  // créneaux en retard poserait l'autre année sous une grille qui n'est plus
  // la sienne.
  const generationCreneaux = useRef(0);

  const chargerCreneaux = useCallback(async (annee: number) => {
    const jeton = ++generationCreneaux.current;
    const lus = await api.getTimetableSlots(annee);
    if (jeton === generationCreneaux.current) setSlots(lus);
  }, []);

  // L'année n'est jamais figée sur « aujourd'hui » : elle vient de ce qui est
  // à l'écran, sinon la grille se viderait sans un mot au passage du 1er août.
  // `anneeEcran` et non `yearStart` : en vue Semaine, les créneaux chargés
  // doivent être ceux de l'année que l'en-tête annonce.
  useEffect(() => {
    if (anneeEcran === null) return;
    void chargerCreneaux(anneeEcran).catch((err: unknown) => {
      setActionError(messageOf(err));
    });
  }, [anneeEcran, chargerCreneaux]);

  useEffect(() => {
    void api
      .getSessions()
      .then(setSessions)
      .catch((err: unknown) => {
        setActionError(messageOf(err));
      });
  }, []);

  /**
   * La semaine de `date`, lundi → dimanche.
   *
   * `get_week_schedule` est une **lecture** : elle ne crée aucune séance, et
   * naviguer trente semaines n'écrit rien. C'est la condition pour que les
   * flèches existent.
   *
   * `weekLoading` ne conditionne pas l'affichage de la grille : on garde la
   * semaine précédente à l'écran jusqu'à l'arrivée de la nouvelle, sinon
   * chaque flèche ferait clignoter un squelette.
   */
  const chargerSemaine = useCallback(async () => {
    const jeton = ++generationSemaine.current;
    setWeekLoading(true);
    setWeekError(null);
    try {
      const lue = await api.getWeekSchedule(date);
      if (jeton !== generationSemaine.current) return;
      setWeek(lue);
    } catch (err) {
      if (jeton !== generationSemaine.current) return;
      setWeek(null);
      setWeekError(messageOf(err));
    } finally {
      if (jeton === generationSemaine.current) setWeekLoading(false);
    }
  }, [date]);

  // Lue seulement quand elle est à l'écran : c'est une requête de plus à chaque
  // flèche, et l'onglet Journée n'en a aucun usage.
  useEffect(() => {
    if (vue !== "semaine") return;
    void chargerSemaine();
  }, [vue, chargerSemaine]);

  /** Relecture d'après écriture, sans repasser par l'état de chargement. */
  const rafraichirSemaine = useCallback(async () => {
    if (vue !== "semaine") return;
    const jeton = ++generationSemaine.current;
    const lue = await api.getWeekSchedule(date);
    if (jeton === generationSemaine.current) setWeek(lue);
  }, [vue, date]);

  /** Rechargements d'après écriture. Leur échec s'affiche sur la page et n'est
   *  jamais renvoyé à l'appelant : une écriture réussie ne doit pas se signaler
   *  comme un échec dans le dialogue qui l'a déclenchée. */
  const rafraichirTout = useCallback(async () => {
    try {
      await rafraichirJour();
      if (anneeEcran !== null) await chargerCreneaux(anneeEcran);
      // La semaine porte les séances et les rendez-vous datés : sans cette
      // relecture, un créneau modifié depuis la grille y garderait l'ancienne
      // séance accrochée.
      await rafraichirSemaine();
    } catch (err) {
      setActionError(messageOf(err));
    }
  }, [rafraichirJour, chargerCreneaux, anneeEcran, rafraichirSemaine]);

  // ---- Séance hébergée ----

  const ouvrirSeance = useCallback(
    async (sessionId: string, seanceId: string) => {
      setActionError(null);
      setSeanceOuverte({ sessionId, seanceId });
      setSeanceLoading(true);
      try {
        const [liste, eleves] = await Promise.all([
          api.getSeances(sessionId),
          api.getStudents(sessionId),
        ]);
        setSeances(liste);
        setStudents(eleves);
      } catch (err) {
        setSeanceOuverte(null);
        setActionError(messageOf(err));
      } finally {
        setSeanceLoading(false);
      }
    },
    [],
  );

  const seanceDerivee = useMemo(
    () =>
      seanceOuverte
        ? (seances.find((s) => s.id === seanceOuverte.seanceId) ?? null)
        : null,
    [seances, seanceOuverte],
  );

  const rechargerSeance = useCallback(async () => {
    if (!seanceOuverte) return;
    try {
      setSeances(await api.getSeances(seanceOuverte.sessionId));
      // La journée ET la semaine portent l'appel et le cahier de texte en
      // pastilles (`○`, `●`, `▣`) : les deux doivent être à jour avant même le
      // retour en arrière. Ne relire que la journée laissait l'onglet Semaine
      // afficher « appel pas fait » sur un appel qu'on venait de terminer —
      // l'enseignant avait toutes les raisons de le refaire.
      await rafraichirTout();
    } catch (err) {
      setActionError(messageOf(err));
    }
  }, [seanceOuverte, rafraichirTout]);

  const fermerSeance = useCallback(() => {
    setSeanceOuverte(null);
    // Même raison que `rechargerSeance` : la grille de la semaine porte les
    // mêmes pastilles que la journée. `rafraichirTout` ne lève jamais.
    void rafraichirTout();
  }, [rafraichirTout]);

  // ---- Écritures depuis la journée ----

  /**
   * Crée l'occurrence du créneau **à la date reçue en paramètre**, puis l'ouvre.
   *
   * La date n'est surtout pas lue dans l'état de l'écran : la grille de la
   * semaine montre sept jours à la fois, et un appelant qui n'est pas la
   * journée affichée doit pouvoir dire lequel. Une séance créée au mauvais
   * jour compterait au dénominateur d'assiduité du bilan remis aux familles,
   * sans que rien à l'écran ne le signale. Ne pas « simplifier » en relisant
   * `date` ici — **y compris pour le rechargement** : `rafraichirJour` lit la
   * date de l'écran, il ne vaut donc que si c'est bien celle qu'on a écrite.
   */
  const creerEtOuvrir = useCallback(
    async (slot: TimetableSlot, dateCible: string) => {
      // Garde-fou : la forme « créneau sans classe » n'offre aucune action, et
      // le backend refuserait de toute façon d'ouvrir quoi que ce soit derrière
      // un modèle.
      if (slot.session_id === null) return;
      setBusySlotId(slot.id);
      setActionError(null);
      try {
        const creee = await api.createSeanceFromSlot(slot.id, dateCible, false);
        // La journée ne se recharge que si c'est bien elle qu'on vient
        // d'écrire ; la semaine, elle, porte les séances de sept jours et doit
        // se relire dans tous les cas.
        if (dateCible === date) await rafraichirJour();
        await rafraichirSemaine();
        await ouvrirSeance(slot.session_id, creee.id);
      } catch (err) {
        setActionError(messageOf(err));
      } finally {
        setBusySlotId(null);
      }
    },
    [date, rafraichirJour, rafraichirSemaine, ouvrirSeance],
  );

  /**
   * Sur une date passée, la création se confirme : la séance créée entrera au
   * dénominateur d'assiduité de tous les élèves de la classe.
   *
   * La date visée est un paramètre, et elle part entière dans `confirmSlot` :
   * le dialogue doit annoncer la date qu'il va écrire, pas celle de l'écran
   * qui l'a ouvert. Depuis la journée, l'appelant passe la date affichée —
   * rien ne change.
   */
  const demanderCreation = useCallback(
    (slot: TimetableSlot, dateCible: string) => {
      if (dateCible < today()) setConfirmSlot({ slot, date: dateCible });
      else void creerEtOuvrir(slot, dateCible);
    },
    [creerEtOuvrir],
  );

  /**
   * Marque « ce cours n'a pas lieu » **à la date reçue en paramètre**.
   *
   * Même raison que `creerEtOuvrir` : l'écriture porte sur une date précise,
   * et l'appelant est seul à savoir laquelle. Une annulation posée au mauvais
   * jour laisse le vrai jour au dénominateur et en retire un autre. Le
   * rechargement suit la même règle : `rafraichirJour` lit la date de l'écran.
   */
  const marquerSansCours = useCallback(
    async (slot: TimetableSlot, dateCible: string, motif: string) => {
      setBusySlotId(slot.id);
      setActionError(null);
      try {
        // `cancelled = true` : la séance naît annulée, donc hors du
        // dénominateur d'assiduité de toute la classe. Le motif part dans la
        // même écriture — c'est la même information vue de deux côtés, l'une
        // dit QUE, l'autre dit POURQUOI.
        await api.createSeanceFromSlot(slot.id, dateCible, true, motif);
        if (dateCible === date) await rafraichirJour();
        await rafraichirSemaine();
      } catch (err) {
        setActionError(messageOf(err));
      } finally {
        setBusySlotId(null);
      }
    },
    [date, rafraichirJour, rafraichirSemaine],
  );

  /**
   * Ouvre le cahier de texte d'une séance déjà existante.
   *
   * Appelé par les deux onglets : la liste de la journée, et désormais les
   * cartes datées de la grille. Le nom ne dit plus « depuis la journée », parce
   * que ce n'était plus vrai — et un nom faux se propage.
   *
   * C'est une **lecture** : rien n'est créé ici. La création d'une occurrence
   * de créneau reste `creerEtOuvrir`, qui exige une date explicite.
   */
  const ouvrirCahierDeTexte = useCallback(
    (seance: DaySeance) => {
      void ouvrirSeance(seance.session_id, seance.id);
    },
    [ouvrirSeance],
  );

  const ouvrirEntree = useCallback((entry: AgendaEntrySummary) => {
    setActionError(null);
    setEntryOuverte(entry.id);
  }, []);

  /**
   * Après la création d'un **cours ponctuel** — la seule séance que le
   * sélecteur d'ajout engendre.
   *
   * Deux gestes, et les deux comptent. `rafraichirTout()` d'abord : la séance
   * vient de naître, et sans relecture elle manquerait à la grille comme à la
   * journée tant qu'on n'aurait pas navigué ailleurs et fait demi-tour. Le
   * `setDate` ensuite, pour suivre la séance quand elle a été posée un autre
   * jour que celui affiché — même esprit qu'`apresCreationEntree`.
   *
   * On enchaîne enfin sur son cahier de texte, comme `creerEtOuvrir` le fait
   * pour l'occurrence d'un créneau : un cours qu'on vient de créer est un cours
   * qu'on s'apprête à écrire.
   */
  const apresCreationCoursPonctuel = useCallback(
    async (seance: Seance) => {
      await rafraichirTout();
      setDate(seance.date);
      await ouvrirSeance(seance.session_id, seance.id);
    },
    [rafraichirTout, ouvrirSeance],
  );

  const apresCreationEntree = useCallback((entry: AgendaEntry) => {
    // Un rendez-vous est créé pour être écrit : on enchaîne sur son compte
    // rendu plutôt que de laisser l'enseignant le retrouver dans la liste.
    // La date saisie peut ne pas être celle affichée ; on suit le rendez-vous,
    // et le rechargement de la journée vient au retour de l'éditeur.
    setDate(entry.date);
    // Aucune bascule d'onglet : depuis le lot 1, la grille de la semaine porte
    // elle aussi les rendez-vous datés. Revenir de force à la journée
    // renverrait sur un écran que l'enseignant n'avait pas demandé.
    setEntryOuverte(entry.id);
  }, []);

  // ---- Écritures sur la grille ----

  /**
   * Clic ou tracé sur une bande vide de la grille.
   *
   * Il ouvre le **sélecteur de forme**, pas le dialogue de cours. Le geste dit
   * un jour et une plage horaire ; il ne dit pas s'il s'agit d'un cours
   * hebdomadaire, d'une visite de stage ou d'un rendez-vous — et n'ayant aucun
   * autre moyen de le demander, la grille ne pouvait produire que des cours.
   *
   * La **date** de la case est retenue en plus du jour ISO : un créneau
   * hebdomadaire n'a que faire d'une date, mais une visite de stage ne se pose
   * nulle part ailleurs que sur celle-là. La perdre ici daterait la visite au
   * jour de l'onglet Journée, c'est-à-dire, depuis une semaine sur laquelle on
   * a navigué, n'importe où.
   */
  const ouvrirCreationCreneau = useCallback(
    (weekday: number, startTime: string, endTime: string, dateCible: string) => {
      setAjoutPrefill({ weekday, startTime, endTime, date: dateCible });
      setAjoutOpen(true);
    },
    [],
  );

  const ouvrirEditionCreneau = useCallback((slot: TimetableSlot) => {
    setSlotEnEditionId(slot.id);
    setSlotDialogOpen(true);
  }, []);

  /** Le créneau en cours de modification, dérivé de la liste à chaque rendu —
   *  jamais une copie retenue au moment du clic (règle 1), sur le modèle exact
   *  de `seanceDerivee`. */
  const slotEnEdition = useMemo(
    () =>
      slotEnEditionId !== null
        ? (slots.find((s) => s.id === slotEnEditionId) ?? null)
        : null,
    [slots, slotEnEditionId],
  );

  const enregistrerCreneau = useCallback(
    async (input: TimetableSlotInput) => {
      if (anneeEcran === null) {
        throw new Error(
          "L'année scolaire de cet écran n'a pas pu être lue : rechargez l'emploi du temps avant de modifier la grille.",
        );
      }
      // L'identifiant, pas l'entité dérivée : c'est lui qui désigne la ligne à
      // écrire, et il survit à un rechargement de la liste.
      if (slotEnEditionId !== null)
        await api.updateTimetableSlot(slotEnEditionId, input);
      // `anneeEcran` : le créneau s'écrit dans l'année que l'écran annonce,
      // pas dans celle de la journée ouverte dans l'autre onglet.
      else await api.createTimetableSlot(anneeEcran, input);
      await rafraichirTout();
    },
    [anneeEcran, slotEnEditionId, rafraichirTout],
  );

  /**
   * Création pure, pour le bouton « Ajouter… ».
   *
   * Volontairement distincte d'`enregistrerCreneau` : celle-ci consulte
   * `slotEnEditionId`, que le parent garde après la fermeture du dialogue
   * d'édition. Un chemin de création qui passerait par là écraserait en
   * silence le dernier créneau modifié au lieu d'en ajouter un.
   */
  const creerCreneau = useCallback(
    async (input: TimetableSlotInput) => {
      if (anneeEcran === null) {
        throw new Error(
          "L'année scolaire de cet écran n'a pas pu être lue : rechargez l'emploi du temps avant d'ajouter un créneau.",
        );
      }
      await api.createTimetableSlot(anneeEcran, input);
      await rafraichirTout();
    },
    [anneeEcran, rafraichirTout],
  );

  const supprimerCreneau = useCallback(
    async (slot: TimetableSlot) => {
      await api.deleteTimetableSlot(slot.id);
      await rafraichirTout();
    },
    [rafraichirTout],
  );

  // ---- Rendus hébergés ----

  if (entryOuverte !== null) {
    return (
      <div className="mx-auto max-w-5xl p-8">
        <AgendaEntryEditor
          key={entryOuverte}
          entryId={entryOuverte}
          // La journée ne suffit pas : une visite de stage dont on vient de
          // caler l'heure change de place dans la grille de la semaine —
          // elle quitte la rangée « hors horaire ». Sans cette relecture, rien
          // à l'écran ne disait que l'enregistrement avait réussi.
          onBack={() => {
            setEntryOuverte(null);
            void rafraichirTout();
          }}
          onChanged={rafraichirTout}
        />
      </div>
    );
  }

  if (seanceOuverte !== null) {
    return (
      <div className="mx-auto max-w-7xl p-8">
        {seanceDerivee ? (
          // `key` sur l'identifiant : sans elle, passer d'une séance à l'autre
          // réutiliserait l'instance et enregistrerait le brouillon de la
          // première sous l'identifiant de la seconde.
          <SeanceDetail
            key={seanceDerivee.id}
            seance={seanceDerivee}
            students={students}
            onBack={fermerSeance}
            onChanged={rechargerSeance}
          />
        ) : seanceLoading ? (
          <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Ouverture de la séance…
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-lg border px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Cette séance n'est plus disponible.
            </p>
            <Button variant="outline" onClick={fermerSeance}>
              Revenir à la journée
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ---- La page ----

  const estAujourdhui = date === today();
  // Les sept dates viennent du backend : la fin de semaine se lit dans la
  // réponse, elle ne se recalcule pas ici.
  const dimanche =
    week !== null && week.days.length === 7 ? week.days[6].date : null;
  const estCetteSemaine =
    week !== null &&
    dimanche !== null &&
    week.monday <= today() &&
    today() <= dimanche;
  const journeeVide =
    day !== null &&
    day.slots.length === 0 &&
    day.loose_seances.length === 0 &&
    day.entries.length === 0;

  return (
    <div className="mx-auto max-w-6xl p-8">
      {/* Un seul bouton d'ajout, posé sur la ligne du titre, AU-DESSUS des
          onglets : il est le même dans les deux vues et ne se déplace pas
          quand on passe de la journée à la semaine. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Emploi du temps</h1>
        <Button
          onClick={() => {
            setActionError(null);
            // Le bouton ne dit ni heure ni case : on efface ce qu'un clic
            // précédent dans la grille avait préréglé, sinon « Ajouter… »
            // rouvrirait la plage de la fois d'avant.
            setAjoutPrefill(null);
            setAjoutOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Ajouter…
        </Button>
      </div>

      {actionError && (
        <p className="mb-4 flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {actionError}
        </p>
      )}

      <Tabs value={vue} onValueChange={(value) => setVue(value as Vue)}>
        <TabsList>
          <TabsTrigger value="jour">Journée</TabsTrigger>
          <TabsTrigger value="semaine">Semaine</TabsTrigger>
        </TabsList>

        <TabsContent value="jour" className="mt-6 space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label="Jour précédent"
                onClick={() => setDate(shiftDate(date, -1))}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Button
                variant="outline"
                disabled={estAujourdhui}
                onClick={() => setDate(today())}
              >
                Aujourd'hui
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Jour suivant"
                onClick={() => setDate(shiftDate(date, 1))}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
              <Input
                type="date"
                aria-label="Aller à une date"
                className="w-auto"
                value={date}
                onChange={(event) => {
                  if (event.target.value) setDate(event.target.value);
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b pb-3">
            <h2 className="text-3xl font-bold tracking-tight">
              {longDate(date)}
            </h2>
            {day && (
              <div className="flex items-center gap-3 text-base text-muted-foreground">
                <Badge variant="secondary" title="Trimestre calculé par SGPA">
                  Trimestre {day.trimester}
                </Badge>
                {/* Le numéro de semaine ne s'affiche que si un créneau de
                    l'année porte une parité : tant que la quinzaine ne sert
                    pas, le mot « semaine » n'apparaît nulle part. */}
                {day.show_parity && (
                  <span>
                    semaine {day.iso_week} ·{" "}
                    {day.week_parity === "paires" ? "paire" : "impaire"}
                  </span>
                )}
              </div>
            )}
          </div>

          <DataState
            loading={loading}
            error={loadError}
            empty={journeeVide}
            emptyLabel="Rien ce jour-là : aucun cours, aucune occupation, aucun rendez-vous. Le bouton « Ajouter… », en haut de la page, propose aussi bien un cours de chaque semaine qu'une visite de stage ou une réunion à cette date — ou un cours ponctuel, pour un remplacement."
            onRetry={() => {
              void chargerJour();
            }}
          >
            {day && (
              <DayList
                day={day}
                busyId={busySlotId}
                onOpenSeance={ouvrirCahierDeTexte}
                // La journée passe la date qu'elle affiche : c'est la seule
                // qu'elle connaisse, et son comportement ne change pas.
                onCreateAndOpen={(slot) => {
                  demanderCreation(slot, date);
                }}
                // Le clic n'écrit plus : il demande pourquoi. Le bon moment
                // pour dire la raison d'une annulation est celui où on annule,
                // pas trois semaines plus tard en rouvrant la séance.
                onCancelSlot={(slot) => {
                  setAnnulation({ slot, date });
                }}
                onOpenEntry={ouvrirEntree}
              />
            )}
          </DataState>
        </TabsContent>

        <TabsContent value="semaine" className="mt-6 space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {/* ±7 jours sur la MÊME date que la journée : c'est le backend
                  qui ramène ensuite n'importe quel jour au lundi de sa semaine
                  ISO. Ces flèches ne sont que des lectures — elles n'écrivent
                  rien, pas même un trimestre. */}
              <Button
                variant="outline"
                size="icon"
                aria-label="Semaine précédente"
                onClick={() => setDate(shiftDate(date, -7))}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Button
                variant="outline"
                disabled={estCetteSemaine}
                onClick={() => setDate(today())}
              >
                Cette semaine
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Semaine suivante"
                onClick={() => setDate(shiftDate(date, 7))}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
              <Input
                type="date"
                aria-label="Aller à une semaine"
                className="w-auto"
                value={date}
                onChange={(event) => {
                  if (event.target.value) setDate(event.target.value);
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b pb-3">
            <h2 className="text-2xl font-bold tracking-tight">
              {week
                ? libelleSemaine(week.monday, dimanche ?? week.monday)
                : longDate(date)}
            </h2>
            {week && (
              <div className="flex items-center gap-3 text-base text-muted-foreground">
                <span>Année scolaire {schoolYearLabel(week.year_start)}</span>
                {/* Le numéro de semaine ne s'affiche que si un créneau de
                    l'année porte une parité, et la parité affichée est celle
                    de la semaine REGARDÉE — plus celle de la journée ouverte
                    dans l'autre onglet. */}
                {week.show_parity && (
                  <span>
                    semaine {week.iso_week} ·{" "}
                    {week.week_parity === "paires" ? "paire" : "impaire"}
                  </span>
                )}
              </div>
            )}
          </div>

          <p className="max-w-3xl text-sm text-muted-foreground">
            La grille montre la semaine avec ses vraies dates. Les cartes de
            cours sont l'emploi du temps type : les modifier vaut pour toutes
            les semaines. Une barre épaisse à gauche signale une séance qui
            existe déjà à cette date. Cliquez ou glissez dans une bande vide
            pour ajouter quelque chose à cet horaire — le même choix qu'avec le
            bouton « Ajouter… ». Une seule des six formes proposées crée une
            séance, « Cours ponctuel ». Un clic sur une carte ouvre, sans rien
            créer : le cours de chaque semaine sur sa modification, un
            rendez-vous daté — visite de stage comprise — sur son compte rendu,
            un cours ponctuel sur son cahier de texte. L'occurrence d'un cours
            de chaque semaine, avec son appel, se tient toujours depuis la
            journée.
          </p>

          <DataState
            // Le squelette ne revient pas à chaque flèche : tant qu'une semaine
            // est affichée, la suivante se charge sous elle.
            loading={week === null && (loading || weekLoading)}
            error={weekError ?? loadError}
            onRetry={() => {
              void chargerSemaine();
              void chargerJour();
            }}
          >
            {week !== null && (
              // L'année de la grille est celle de la SEMAINE regardée, la même
              // que l'en-tête ci-dessus et que les créneaux chargés : le pied
              // de grille ne peut plus contredire le titre.
              <WeekGrid
                yearStart={week.year_start}
                slots={slots}
                week={week}
                onSelectSlot={ouvrirEditionCreneau}
                // Le compte rendu d'une visite de stage s'ouvre depuis la
                // grille comme depuis la journée : c'est la même entrée, le
                // même éditeur, et l'enseignant la voit d'abord ici.
                onOpenEntry={ouvrirEntree}
                // Une séance datée — cours ponctuel, ou séance saisie depuis la
                // fiche de classe — ouvre son cahier de texte, comme depuis la
                // journée : même prop, même fonction, même écran.
                onOpenSeance={ouvrirCahierDeTexte}
                onCreateSlot={ouvrirCreationCreneau}
              />
            )}
          </DataState>
        </TabsContent>
      </Tabs>

      {/* Le créneau modifié n'est plus dans la liste (supprimé, ou liste
          rechargée sur une autre année) : le dialogue se retire au lieu de se
          transformer en silence en formulaire de création. */}
      {anneeEcran !== null &&
        (slotEnEditionId === null || slotEnEdition !== null) && (
        <SlotDialog
          open={slotDialogOpen}
          onOpenChange={setSlotDialogOpen}
          // La même année que la grille : sinon le dialogue proposerait des
          // classes d'une autre année scolaire, que `check_session_year`
          // refuserait côté backend sans que l'écran l'ait annoncé.
          yearStart={anneeEcran}
          slot={slotEnEdition}
          sessions={sessions}
          slots={slots}
          onSubmit={enregistrerCreneau}
          onDelete={supprimerCreneau}
        />
      )}

      {/* Le point d'entrée unique de tout ce qui s'ajoute à l'emploi du temps,
          bouton « Ajouter… » comme clic dans une bande vide de la grille. Il ne
          contient aucun formulaire : il monte `SlotDialog`,
          `AgendaEntryDialog` ou `OneOffSeanceDialog`, entiers, selon la forme
          choisie.

          Cinq de ses six formes n'engendrent aucune séance ; la sixième, « Cours
          ponctuel », en engendre une — et une seule — qui compte au dénominateur
          d'assiduité du bilan. */}
      {/* Il n'écrit rien lui-même : il rend un texte, et c'est
          `marquerSansCours` qui appelle la commande. `seances` garde une porte
          d'écriture unique. */}
      <CancelReasonDialog
        cible={
          annulation && {
            slotLabel: annulation.slot.label,
            date: annulation.date,
          }
        }
        onClose={() => setAnnulation(null)}
        busy={annulation !== null && busySlotId === annulation.slot.id}
        onConfirm={(motif) => {
          if (annulation === null) return;
          const { slot, date: dateCible } = annulation;
          setAnnulation(null);
          void marquerSansCours(slot, dateCible, motif);
        }}
      />

      <NewPlanningDialog
        open={ajoutOpen}
        onOpenChange={(ouvert) => {
          setAjoutOpen(ouvert);
          // Le préréglage ne survit pas à la fermeture : il appartient au
          // geste qui l'a produit, pas à l'écran.
          if (!ouvert) setAjoutPrefill(null);
        }}
        yearStart={anneeEcran}
        sessions={sessions}
        slots={slots}
        // Le dimanche n'a pas de colonne dans la grille : proposer un créneau
        // invisible serait pire qu'un créneau impossible. Ce repli ne sert que
        // le bouton « Ajouter… » — une case cliquée, elle, dit son jour.
        defaultWeekday={
          ajoutPrefill?.weekday ?? (day && day.weekday <= 6 ? day.weekday : 1)
        }
        // La date de la CASE quand le geste vient de la grille, celle de la
        // journée affichée sinon. C'est elle, et elle seule, qui datera une
        // visite de stage.
        defaultDate={ajoutPrefill?.date || date}
        defaultStartTime={ajoutPrefill?.startTime}
        defaultEndTime={ajoutPrefill?.endTime}
        onCreateSlot={creerCreneau}
        onCreatedEntry={apresCreationEntree}
        onCreatedSeance={apresCreationCoursPonctuel}
      />

      <ConfirmDialog
        open={confirmSlot !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmSlot(null);
        }}
        title="Créer une séance sur une date passée ?"
        destructive={false}
        confirmLabel="Créer et ouvrir"
        description={
          confirmSlot && (
            <>
              <p>
                «&nbsp;
                {confirmSlot.slot.label.trim() ||
                  confirmSlot.slot.session_name ||
                  "Ce créneau"}
                {/* La date du couple, jamais celle de l'écran : c'est
                    exactement celle que la confirmation va écrire. */}
                &nbsp;» du {shortDate(confirmSlot.date)} : cette date est déjà
                passée.
              </p>
              <p>
                Une séance qui existe compte au dénominateur d'assiduité. Tant
                que son appel n'est pas fait, chaque élève de la classe perd une
                séance de présence sur le bilan remis à sa famille.
              </p>
              <p>
                Si ce cours n'a pas eu lieu, choisissez plutôt «&nbsp;Ce cours
                n'a pas lieu&nbsp;» : la séance naît annulée et ne compte pour
                personne.
              </p>
            </>
          )
        }
        onConfirm={async () => {
          const cible = confirmSlot;
          setConfirmSlot(null);
          if (cible) await creerEtOuvrir(cible.slot, cible.date);
        }}
      />
    </div>
  );
}
