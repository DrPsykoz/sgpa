import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { AgendaEntryEditor } from "@/components/AgendaEntryEditor";
import { DataState } from "@/components/DataState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { NewPlanningDialog } from "@/pages/Timetable/NewPlanningDialog";
import { SlotDialog } from "@/pages/Timetable/SlotDialog";
import { WeekGrid } from "@/pages/Timetable/WeekGrid";
import { YearGrid } from "@/pages/Timetable/YearGrid";
import { api } from "@/lib/api";
import { tableDesTeintes } from "@/lib/teintes";
import { schoolYearLabel } from "@/types";
import type {
  AgendaEntry,
  AgendaEntrySummary,
  Seance,
  Session,
  TimetableSlot,
  TimetableSlotInput,
  WeekSchedule,
} from "@/types";

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
 * L'emploi du temps : **l'écran où l'on définit l'emploi du temps**, et rien
 * d'autre.
 *
 * C'est la ligne de partage, et elle vaut mieux que la commodité qu'elle
 * coûte : **ici on définit, à l'accueil on ouvre.** On règle ici la grille
 * hebdomadaire — une fois par an, puis au gré des changements —, on y pose un
 * rendez-vous daté ou un cours ponctuel. Mais l'appel, le cahier de texte et
 * l'occurrence d'un cours de chaque semaine se tiennent depuis l'accueil, qui
 * montre le jour même et les suivants, ou depuis la fiche de la classe, qui
 * liste toutes ses séances. Deux écrans qui ouvriraient la même séance
 * finiraient par ne pas en dire la même chose — c'est arrivé, et c'est ce qui
 * faisait réécrire un cahier de texte périmé par-dessus le texte frais.
 *
 * Le créneau reste donc un **modèle** : aucune séance n'est engendrée d'office,
 * ni par la navigation, ni par un clic. Une séance qui existe compte au
 * dénominateur d'assiduité du bilan remis aux familles.
 *
 * **Une seule chose écrit dans `seances` depuis cet écran** : le « cours
 * ponctuel » du sélecteur d'ajout — un remplacement, une séance
 * exceptionnelle. Il naît d'un formulaire et d'un bouton d'enregistrement,
 * jamais de la navigation, et il avertit lui-même sur une date passée. Rien ne
 * s'ouvre après : la séance vient de naître, la grille la montre, et c'est
 * l'accueil qui l'ouvrira le jour venu.
 *
 * **Une carte ouvre sa définition, jamais son contenu.** Un cours de chaque
 * semaine ouvre son dialogue de créneau ; un rendez-vous daté ouvre son compte
 * rendu, parce qu'un rendez-vous n'a pas d'autre définition que son texte et
 * qu'aucun autre écran ne le liste ; une séance datée, qui a sa fiche de classe
 * pour elle, n'ouvre rien ici.
 *
 * Aucune règle de temps n'est recalculée ici : le trimestre, l'année scolaire,
 * le jour ISO et la parité de la semaine arrivent tout faits du backend.
 */
export default function Timetable(): ReactElement {
  const [date, setDate] = useState(() => today());

  // La semaine affichée est celle de `date`, et le backend la ramène lui-même
  // à son lundi ISO. Son ANNÉE SCOLAIRE est celle de ce lundi
  // (`year_start_for(monday)`) : sur la semaine qui enjambe le 1er août —
  // samedi 1er août 2026, donc lundi 27 juillet 2026 — elle vaut 2025-2026 et
  // non l'année du samedi. Voir `anneeEcran` : c'est elle, et elle seule, qui
  // alimente la grille et l'écriture d'un créneau.
  const [week, setWeek] = useState<WeekSchedule | null>(null);
  const [weekLoading, setWeekLoading] = useState(true);
  const [weekError, setWeekError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);

  const [slotDialogOpen, setSlotDialogOpen] = useState(false);
  // L'identifiant seul, jamais l'entité : c'est la liste rechargée qui redonne
  // le créneau à chaque rendu (règle 1). Un créneau figé ici resterait tel quel
  // pendant que la liste se recharge sous lui.
  const [slotEnEditionId, setSlotEnEditionId] = useState<string | null>(null);
  // Le point d'entrée unique de « Ajouter… », posé sur la ligne du titre.
  const [ajoutOpen, setAjoutOpen] = useState(false);
  // Ce que le geste a déjà dit, quand il vient d'une case de la grille : le
  // jour, la plage tracée, et la date de la colonne. `null` quand l'ouverture
  // vient du bouton « Ajouter… », qui ne dit qu'une chose — la semaine
  // affichée.
  const [ajoutPrefill, setAjoutPrefill] = useState<AjoutPrefill | null>(null);
  // Le compte rendu d'un rendez-vous, hébergé en plein écran. Son identifiant,
  // jamais l'entité (règle 1).
  const [entryOuverte, setEntryOuverte] = useState<string | null>(null);

  /**
   * L'année scolaire **de ce qui est à l'écran** : celle de la semaine
   * regardée, que le backend date par son lundi.
   *
   * Tout ce qui lit ou écrit la grille passe par ici. La prendre ailleurs — sur
   * « aujourd'hui », par exemple — afficherait sur la semaine du 1er août les
   * créneaux de l'autre année posés sur ces dates : aucune séance ne pourrait
   * plus s'apparier à son créneau, et un créneau tracé là partirait dans
   * l'année que l'en-tête ne nomme pas.
   */
  const anneeEcran = week?.year_start ?? null;

  /**
   * La vue regardée, dans l'adresse plutôt que dans un état local.
   *
   * « Semaine » par défaut : c'est elle qu'on ouvre pour régler l'emploi du
   * temps. « Année » devient ainsi adressable — `?vue=annee` —, ce qui permet
   * d'y renvoyer depuis ailleurs sans dupliquer la frise. Rien à nettoyer au
   * passage, contrairement au relais `?ouvrir=` de la fiche de classe : ce
   * paramètre décrit ce qu'on regarde, pas un geste à jouer une fois.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const vue = searchParams.get("vue") === "annee" ? "annee" : "semaine";

  // ---- Lectures ----

  // Garde de génération : trois clics rapides sur les flèches lancent trois
  // lectures concurrentes, et rien ne garantit qu'elles reviennent dans
  // l'ordre. Sans ce jeton, une réponse en retard écraserait durablement la
  // semaine réellement demandée — plus rien ne relance la lecture tant que
  // `date` ne bouge pas.
  const generationSemaine = useRef(0);

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

  useEffect(() => {
    void chargerSemaine();
  }, [chargerSemaine]);

  /** Relecture d'après écriture, sans repasser par l'état de chargement : le
   *  squelette de `DataState` ferait clignoter la grille entière. */
  const rafraichirSemaine = useCallback(async () => {
    const jeton = ++generationSemaine.current;
    const lue = await api.getWeekSchedule(date);
    // L'erreur, elle, remonte toujours : c'est l'appelant qui décide s'il
    // l'affiche. Seule la pose du résultat est conditionnelle.
    if (jeton === generationSemaine.current) setWeek(lue);
  }, [date]);

  // Même garde pour les créneaux : `anneeEcran` peut changer deux fois de
  // suite au passage du 1er août, et une liste en retard poserait l'autre
  // année sous une grille qui n'est plus la sienne.
  const generationCreneaux = useRef(0);

  const chargerCreneaux = useCallback(async (annee: number) => {
    const jeton = ++generationCreneaux.current;
    const lus = await api.getTimetableSlots(annee);
    if (jeton === generationCreneaux.current) setSlots(lus);
  }, []);

  // L'année n'est jamais figée sur « aujourd'hui » : elle vient de ce qui est
  // à l'écran, sinon la grille se viderait sans un mot au passage du 1er août.
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

  /** Rechargements d'après écriture. Leur échec s'affiche sur la page et n'est
   *  jamais renvoyé à l'appelant : une écriture réussie ne doit pas se signaler
   *  comme un échec dans le dialogue qui l'a déclenchée. */
  const rafraichirTout = useCallback(async () => {
    try {
      if (anneeEcran !== null) await chargerCreneaux(anneeEcran);
      // La semaine porte les séances et les rendez-vous datés : sans cette
      // relecture, un créneau modifié depuis la grille y garderait l'ancienne
      // séance accrochée.
      await rafraichirSemaine();
    } catch (err) {
      setActionError(messageOf(err));
    }
  }, [chargerCreneaux, anneeEcran, rafraichirSemaine]);

  /** La teinte de chaque classe. Dérivée de TOUTES les classes, et pas des
   *  seules classes de l'année regardée : la table est positionnelle par année
   *  scolaire, et la restreindre ici donnerait à une même classe une couleur
   *  différente de l'accueil. */
  const teintes = useMemo(() => tableDesTeintes(sessions), [sessions]);

  // ---- Ce que la grille ouvre ----

  /**
   * Le compte rendu d'un rendez-vous daté.
   *
   * **La seule exception à « l'emploi du temps n'ouvre rien ».** Elle est
   * assumée : **aucun autre écran ne liste les rendez-vous.** Nommer une classe
   * ne les y fait pas entrer — la fiche de classe liste ses séances et ses
   * évaluations, pas ses rendez-vous —, et un rendez-vous peut n'en nommer
   * aucune. L'accueil, lui, ne montre que six journées ouvrées ; sans cette
   * porte, un rendez-vous posé dans trois semaines ne pourrait plus être ni
   * corrigé ni supprimé.
   */
  const ouvrirEntree = useCallback((entry: AgendaEntrySummary) => {
    setActionError(null);
    setEntryOuverte(entry.id);
  }, []);

  // ---- Écritures ----

  /**
   * Après la création d'un **cours ponctuel** — la seule séance que cet écran
   * engendre.
   *
   * On reste sur l'emploi du temps, et on ne l'ouvre pas : il vient d'être
   * défini, pas d'avoir lieu. `rafraichirTout()` parce que sans relecture la
   * séance manquerait à la grille tant qu'on n'aurait pas navigué ailleurs et
   * fait demi-tour ; `setDate` ensuite, pour amener la semaine sur la date
   * saisie quand elle n'est pas celle affichée — sinon la séance naîtrait
   * invisible, et rien ne dirait qu'elle existe.
   */
  const apresCreationCoursPonctuel = useCallback(
    async (seance: Seance) => {
      await rafraichirTout();
      setDate(seance.date);
    },
    [rafraichirTout],
  );

  /**
   * Après la création d'un rendez-vous daté.
   *
   * Lui, on l'ouvre : un rendez-vous est créé pour être écrit, et son compte
   * rendu est tout ce qu'il a. `setDate` d'abord, pour que le retour de
   * l'éditeur se fasse sur la semaine qui le porte — la date saisie peut ne pas
   * être celle affichée.
   */
  const apresCreationEntree = useCallback((entry: AgendaEntry) => {
    setDate(entry.date);
    setEntryOuverte(entry.id);
  }, []);

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
   * nulle part ailleurs que sur celle-là.
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
   *  jamais une copie retenue au moment du clic (règle 1). */
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
      // `anneeEcran` : le créneau s'écrit dans l'année que l'écran annonce.
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

  // ---- Rendu hébergé : le compte rendu d'un rendez-vous ----

  if (entryOuverte !== null) {
    return (
      <div className="mx-auto max-w-5xl p-8">
        <AgendaEntryEditor
          key={entryOuverte}
          entryId={entryOuverte}
          // Une visite de stage dont on vient de caler l'heure change de place
          // dans la grille — elle quitte la rangée « hors horaire ». Sans cette
          // relecture, rien à l'écran ne dirait que l'enregistrement a réussi.
          onBack={() => {
            setEntryOuverte(null);
            void rafraichirTout();
          }}
          onChanged={rafraichirTout}
        />
      </div>
    );
  }

  // ---- La page ----

  // Les sept dates viennent du backend : la fin de semaine se lit dans la
  // réponse, elle ne se recalcule pas ici.
  const dimanche =
    week !== null && week.days.length === 7 ? week.days[6].date : null;
  const estCetteSemaine =
    week !== null &&
    dimanche !== null &&
    week.monday <= today() &&
    today() <= dimanche;
  // Le jour affiché **dans la semaine lue** : c'est le backend qui donne son
  // jour ISO, le front ne le recalcule pas. Sert au repli du sélecteur
  // d'ajout, qui doit proposer un jour plutôt qu'un autre.
  const jourAffiche = week?.days.find((j) => j.date === date) ?? null;

  return (
    <div className="mx-auto max-w-6xl p-8">
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

      <Tabs
        value={vue}
        onValueChange={(valeur) => {
          setSearchParams(
            valeur === "annee" ? { vue: "annee" } : {},
            { replace: true },
          );
        }}
      >
        <TabsList className="mb-6">
          <TabsTrigger value="semaine">Semaine</TabsTrigger>
          {/* La vue annuelle ne modifie rien — voir `YearGrid`. */}
          <TabsTrigger value="annee">Année</TabsTrigger>
        </TabsList>

        <TabsContent value="semaine" className="mt-0">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              {/* ±7 jours : c'est le backend qui ramène ensuite n'importe quel jour
                  au lundi de sa semaine ISO. Ces flèches ne sont que des lectures —
                  elles n'écrivent rien, pas même un trimestre. */}
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

            <div className="flex flex-wrap items-baseline justify-between gap-3 border-b pb-3">
              <h2 className="text-2xl font-bold tracking-tight">
                {week
                  ? libelleSemaine(week.monday, dimanche ?? week.monday)
                  : longDate(date)}
              </h2>
              {week && (
                <div className="flex items-center gap-3 text-base text-muted-foreground">
                  <span>Année scolaire {schoolYearLabel(week.year_start)}</span>
                  {/* Le numéro de semaine ne s'affiche que si un créneau de l'année
                      porte une parité : tant que la quinzaine ne sert pas, le mot
                      « semaine » n'apparaît nulle part. */}
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
              Cet écran sert à <strong>définir</strong> l'emploi du temps. Les cartes
              de cours sont l'emploi du temps type : les modifier vaut pour toutes
              les semaines. Un fond d'un cran plus soutenu signale une séance qui
              existe déjà à cette date. Cliquez ou glissez dans une bande vide pour
              ajouter quelque chose à cet horaire — le même choix qu'avec le bouton
              « Ajouter… ». Une seule des six formes proposées crée une séance,
              « Cours ponctuel ». Un clic sur une carte ouvre sa définition, sans
              rien créer : le cours de chaque semaine sur sa modification, un
              rendez-vous daté — visite de stage comprise — sur son compte rendu.
              L'appel et le cahier de texte, eux, se tiennent{" "}
              <strong>depuis l'accueil</strong>, qui montre le jour même et les
              suivants, ou depuis la fiche de la classe.
            </p>

            <DataState
              // Le squelette ne revient pas à chaque flèche : tant qu'une semaine
              // est affichée, la suivante se charge sous elle.
              loading={week === null && weekLoading}
              error={weekError}
              onRetry={() => {
                void chargerSemaine();
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
                  // La seule carte qui ouvre autre chose qu'un créneau : un
                  // rendez-vous daté n'a pas d'autre écran que son compte rendu.
                  // Aucune séance ne s'ouvre d'ici — `onOpenSeance` n'existe plus.
                  onOpenEntry={ouvrirEntree}
                  onCreateSlot={ouvrirCreationCreneau}
                  // Chaque classe sa teinte, assignée par position dans l'année
                  // — voir `lib/teintes.ts`. La table est dérivée des classes que
                  // cet écran charge déjà : aucun état global, et la même couleur
                  // qu'à l'accueil, qui la dérive des mêmes classes.
                  teintes={teintes}
                />
              )}
            </DataState>
          </div>
        </TabsContent>

        <TabsContent value="annee" className="mt-0">
          <div className="space-y-5">
            <div className="border-b pb-3">
              <h2 className="text-2xl font-bold tracking-tight">
                Progression de l'année
              </h2>
            </div>

            <p className="max-w-3xl text-sm text-muted-foreground">
              L'année entière, une ligne par classe, en vraies semaines. Cette
              vue <strong>montre</strong> : la progression d'une classe s'écrit
              dans sa fiche, onglet « Progression », et le nom de la classe y
              mène. Ce qu'on voit ici et nulle part ailleurs, c'est la
              comparaison — la semaine où trois classes font la même chose,
              celle où rien n'est prévu, et les trous du calendrier.
            </p>

            {anneeEcran === null ? (
              <p className="rounded-lg border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
                L'année scolaire se déduit de la semaine regardée, qui n'est pas
                encore chargée.
              </p>
            ) : (
              <YearGrid
                // La même année que l'onglet « Semaine » et que les créneaux
                // déjà chargés : les deux vues ne peuvent pas parler de deux
                // années scolaires différentes.
                yearStart={anneeEcran}
                sessions={sessions}
                teintes={teintes}
              />
            )}
          </div>
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
          ajoutPrefill?.weekday ??
          (jourAffiche && jourAffiche.weekday <= 6 ? jourAffiche.weekday : 1)
        }
        // La date de la CASE quand le geste vient de la grille, celle du jour
        // affiché sinon. C'est elle, et elle seule, qui datera une visite de
        // stage.
        defaultDate={ajoutPrefill?.date || date}
        defaultStartTime={ajoutPrefill?.startTime}
        defaultEndTime={ajoutPrefill?.endTime}
        onCreateSlot={creerCreneau}
        onCreatedEntry={apresCreationEntree}
        onCreatedSeance={apresCreationCoursPonctuel}
      />
    </div>
  );
}
