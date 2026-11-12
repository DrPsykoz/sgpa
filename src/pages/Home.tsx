/**
 * Accueil.
 *
 * **C'est d'ici qu'on ouvre un cours ou un rendez-vous.** L'emploi du temps ne
 * sert qu'à définir l'emploi du temps — les créneaux de chaque semaine, les
 * rendez-vous datés — et il n'ouvre plus rien. Le partage est celui de l'usage :
 * on règle sa grille deux fois par an, on ouvre ses cours tous les jours.
 *
 * Deux moitiés, dans cet ordre, parce que c'est l'ordre dans lequel on ouvre
 * l'application : **ce qui vient** d'abord — aujourd'hui, puis les jours
 * ouvrés suivants — et **ce qui manque** ensuite.
 *
 * La première moitié est **un seul calendrier** : aujourd'hui en première
 * colonne, à gauche, les jours ouvrés suivants à sa droite, tous sur le même
 * axe horaire. C'est ce partage de l'axe qui fait le calendrier plutôt que six
 * calendriers côte à côte : 10h tombe à la même hauteur partout, donc deux
 * journées se comparent d'un coup d'œil, et un trou d'une heure le mardi
 * après-midi se voit. Une liste ne montre ni l'un ni l'autre.
 *
 * Trois choses que cet écran ne fait pas, délibérément :
 *
 *   * **il n'écrit jamais sans qu'on l'ait nommé.** Trois gestes écrivent ici,
 *     et les trois passent par un bouton ou un dialogue qui dit ce qu'il fait :
 *     « Sauvegarder maintenant », et les deux formes d'une occurrence de cours
 *     — « Créer la séance et l'ouvrir », « ce cours n'a pas lieu ». Aucun n'est
 *     déduit de la navigation : un tableau de bord qui crée une séance au
 *     premier clic de curiosité abîme le dénominateur d'assiduité d'un bilan
 *     remis aux familles ;
 *   * il ne relit pas une journée à sa façon : `buildRows` et
 *     `motifDeFermeture` viennent de `journee.ts`, donc d'une seule règle. Un
 *     accueil qui annonce un cours que l'emploi du temps ne montre pas est
 *     pire qu'un accueil vide ;
 *   * il ne recalcule ni trimestre ni jours restants : `get_home_overview` les
 *     rend, et le front les met en forme.
 *
 * Où mène un clic, donc : une séance qui existe s'ouvre **dans sa classe**,
 * parce que c'est là que vivent son appel, ses notes et son cahier de texte ;
 * un cours dont la séance n'existe pas encore ouvre le dialogue qui nomme les
 * deux gestes ; un rendez-vous ouvre son compte rendu, ici même, l'accueil
 * étant le seul écran qui les ouvre désormais.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CalendarOff,
  CheckCircle2,
  ClipboardList,
  HardDriveDownload,
  ListChecks,
  Loader2,
  PencilLine,
  type LucideIcon,
} from "lucide-react";

import { AgendaEntryEditor } from "@/components/AgendaEntryEditor";
import { DataState } from "@/components/DataState";
import { OccurrenceDialog } from "@/components/OccurrenceDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CancelReasonDialog } from "@/pages/Timetable/CancelReasonDialog";
import { DaysCalendar } from "@/pages/Timetable/DaysCalendar";
import {
  adresseDeLaSeance,
  bandeauDeAbsence,
  motifDeFermeture,
  type Row,
} from "@/pages/Timetable/journee";
import { api } from "@/lib/api";
import { styleTeinte, tableDesTeintes } from "@/lib/teintes";
import { cn } from "@/lib/utils";
import type {
  AppSettings,
  DaySchedule,
  HomeOverview,
  ReminderGroup,
  ReminderItem,
  ReminderKind,
  Session,
  TimetableSlot,
} from "@/types";
import { LEVEL_LABELS, schoolYearLabel } from "@/types";

/**
 * Jours ouvrés demandés : aujourd'hui et les cinq suivants.
 *
 * Six jours ouvrés couvrent toujours la fin de la semaine en cours ET le début
 * de la suivante, quel que soit le jour où l'on ouvre l'application — c'est la
 * demande : « pouvoir préparer la semaine ». Le backend saute le samedi et le
 * dimanche, et borne lui-même ce nombre à dix.
 */
const DAYS_WANTED = 6;

/**
 * Un cours de chaque semaine, et la date précise où on veut en faire quelque
 * chose.
 *
 * Les deux vont ensemble et ne se séparent jamais : l'accueil montre six
 * journées, donc le créneau seul ne dit pas quel jour écrire. Une séance créée
 * au mauvais jour compterait au dénominateur d'assiduité du bilan remis aux
 * familles, sans que rien à l'écran ne le signale.
 */
interface Occurrence {
  slot: TimetableSlot;
  date: string;
}

/** Au-delà de ce délai, la dernière sauvegarde passe en ambre. Une semaine :
 *  c'est la période au bout de laquelle une clé USB perdue coûterait un cahier
 *  de texte entier. */
const BACKUP_WARN_DAYS = 7;

// ---------------------------------------------------------------------------
// Dates — mise en forme seulement, aucune règle de calendrier
// ---------------------------------------------------------------------------

/** Le jour courant en heure LOCALE. Jamais `toISOString()` : en UTC, le
 *  1er décembre à 00h30 devient le 30 novembre, donc le trimestre précédent. */
function todayISO(): string {
  return new Date().toLocaleDateString("sv-SE");
}

/** Décalage en jours par aller-retour `Date` : passe les changements d'heure
 *  sans glisser d'un jour. */
function shiftDate(iso: string, delta: number): string {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + delta);
  return date.toLocaleDateString("sv-SE");
}

function capitalise(texte: string): string {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

function longDate(iso: string): string {
  return capitalise(
    new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
  );
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR");
}

/** L'en-tête d'une colonne : « Aujourd'hui », « Demain », sinon le seul nom du
 *  jour. Pas de numéro ici — il est sur la deuxième ligne de l'en-tête, qui a
 *  la place de l'écrire en entier. */
function columnHeading(iso: string, today: string): string {
  if (iso === today) return "Aujourd'hui";
  if (iso === shiftDate(today, 1)) return "Demain";
  return capitalise(
    new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR", {
      weekday: "long",
    }),
  );
}

/** Le quantième, seul : « 9 ». Il est mis en pastille dans l'en-tête de
 *  colonne, et une pastille ne contient qu'un nombre. */
function dayNumber(iso: string): string {
  return String(new Date(`${iso}T00:00:00`).getDate());
}

/** « nov. » — le mois abrégé, parce qu'une colonne de calendrier n'a pas la
 *  largeur de « novembre » et que l'année ne change jamais d'une colonne à
 *  l'autre sur six jours ouvrés. */
function monthShort(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR", {
    month: "short",
  });
}

/** SQLite rend « AAAA-MM-JJ HH:MM:SS » en UTC. Sans le « Z » explicite, le
 *  navigateur lirait cet horodatage comme une heure locale et l'afficherait
 *  décalé d'une à deux heures. */
function parseTimestamp(value: string): Date | null {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** « il y a 3 jours », « aujourd'hui », « hier ». Compté en jours de calendrier
 *  et non en tranches de 24 h : une sauvegarde faite hier à 23 h n'est pas
 *  « il y a 0 jour ». */
function ageEnJours(value: string, today: string): number | null {
  const date = parseTimestamp(value);
  if (!date) return null;
  const jour = date.toLocaleDateString("sv-SE");
  const diff =
    new Date(`${today}T00:00:00`).getTime() -
    new Date(`${jour}T00:00:00`).getTime();
  return Math.round(diff / 86_400_000);
}

function pluriel(n: number, singulier: string, pluriel: string): string {
  return n > 1 ? pluriel : singulier;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Les six rappels — titre, icône, et où le cas se traite
// ---------------------------------------------------------------------------

interface ReminderMeta {
  /** Titre de la carte, au pluriel : une carte n'apparaît qu'avec au moins un
   *  cas, et son compte est écrit juste dessous. */
  title: string;
  /** Nom de la chose, pour la ligne « À jour : appels, cahiers de texte… ».
   *  Dire ce qui a été vérifié vaut mieux que ne rien dire : c'est la
   *  différence entre « tout va bien » et « j'ai regardé 91 séances ». */
  verified: string;
  icon: LucideIcon;
  /** Onglet de la classe où le cas se traite. `null` = emploi du temps. */
  tab: "seances" | "evaluations" | null;
  /** Précision affichée au pied de la carte, quand le groupe en demande une. */
  note?: string;
}

const REMINDERS: Record<ReminderKind, ReminderMeta> = {
  appel_incomplet: {
    title: "Appels à terminer",
    verified: "appels",
    icon: ListChecks,
    tab: "seances",
  },
  cahier_vide: {
    title: "Cahiers de texte à écrire",
    verified: "cahiers de texte",
    icon: BookOpen,
    tab: "seances",
    note: "Une séance qui n'a rien à consigner — évaluation surveillée, sortie, heure de vie de classe — se déclare « rien à écrire » depuis son cahier de texte, et quitte cette liste. Une pièce jointe suffit aussi : la photo du tableau est un compte rendu.",
  },
  annulee_sans_motif: {
    title: "Annulations sans motif",
    verified: "motifs d'annulation",
    icon: CalendarOff,
    tab: "seances",
    note: "Le motif est ce qui distingue un cours supprimé d'un cours oublié, des mois plus tard devant un bilan.",
  },
  evaluation_incomplete: {
    title: "Notes manquantes",
    verified: "évaluations notées",
    icon: PencilLine,
    tab: "evaluations",
    note: "Le compte attendu est le nombre de compétences rattachées multiplié par celui des élèves inscrits le jour de l'évaluation. Une case qui ne sera jamais notée — cet élève n'est pas évalué sur cette compétence — se déclare depuis la grille et compte comme réglée : une évaluation volontairement partielle quitte ainsi cette liste, sans qu'il faille inventer des notes.",
  },
  evaluation_sans_competence: {
    title: "Évaluations sans compétence",
    verified: "évaluations outillées",
    icon: AlertTriangle,
    tab: "evaluations",
    note: "Aucune note ne peut être saisie tant qu'aucune compétence n'est rattachée : la grille n'a pas de colonne.",
  },
  compte_rendu_manquant: {
    title: "Comptes rendus à écrire",
    verified: "comptes rendus",
    icon: ClipboardList,
    tab: null,
    note: "Réunions, ESS, rendez-vous. Les visites de stage viendront s'y ranger le jour où l'application saura enregistrer un stage : ce sont des rendez-vous comme les autres, avec un compte rendu à écrire.",
  },
};

/** Où mène un cas, ou `null` quand il s'ouvre **ici** — c'est celui du compte
 *  rendu d'un rendez-vous, que l'accueil est désormais seul à ouvrir.
 *
 *  Les autres mènent dans la classe : c'est là que vivent l'appel, les notes et
 *  le cahier de texte, et l'accueil n'a pas à les redessiner. */
function reminderHref(
  group: ReminderGroup,
  item: ReminderItem,
): string | null {
  const { tab } = REMINDERS[group.kind];
  if (tab === null || item.session_id === null) return null;
  return `/classes/${item.session_id}?onglet=${tab}&ouvrir=${item.id}`;
}

// ---------------------------------------------------------------------------
// Une journée, en lecture seule
// ---------------------------------------------------------------------------

/** Vers où une carte du calendrier NAVIGUE, ou `null` quand il n'y a nulle part
 *  à aller — soit qu'elle agisse sur place (`actionDeLigne`), soit qu'elle
 *  n'ouvre rien du tout.
 *
 *  Une séance qui existe s'ouvre dans sa classe, et c'est tout ce que cette
 *  fonction sait faire : l'accueil ne redessine ni l'appel ni le cahier de
 *  texte, ils ont leur écran. Les deux autres cas — le cours dont la séance
 *  n'existe pas encore, le rendez-vous et son compte rendu — se traitent ici
 *  sans quitter l'accueil, et c'est `actionDeLigne` qui les porte. */
function rowHref(row: Row): string | null {
  switch (row.kind) {
    case "cours":
      // L'adresse vient de `journee.ts` et non d'un gabarit écrit ici : la
      // grille de la semaine mène au même endroit depuis que le cours ponctuel
      // y est cliquable, et deux rédactions auraient divergé.
      return row.seance ? adresseDeLaSeance(row.seance) : null;
    case "seance":
      return adresseDeLaSeance(row.seance);
    case "entree":
      // Le compte rendu s'ouvre ici même. Il n'a pas d'autre écran : aucune
      // fiche de classe ne liste les rendez-vous, même ceux qui la nomment.
      return null;
    case "occupation":
      // Un créneau sans classe est un modèle, pas un cours : il n'a rien à
      // ouvrir, et le dire par l'absence de lien est plus clair qu'un message.
      return null;
  }
}

/**
 * L'en-tête d'une colonne du calendrier : le nom du jour, puis son quantième
 * en pastille.
 *
 * Deux lignes et non une : « Lundi 9 novembre » ne tient pas dans une colonne
 * de huit rem, et tronqué il donne « Lundi 9 nov… ». Le nom du jour suffit sur
 * la première ligne, puisque le numéro est juste en dessous.
 *
 * **La pastille pleine est le repère d'aujourd'hui**, et elle double la
 * couleur du libellé plutôt que de la remplacer : un repère qui n'existe qu'en
 * teinte n'existe pas pour qui distingue mal les couleurs, et c'est le repère
 * le plus utilisé de l'écran.
 */
function EnteteJour({
  day,
  today,
}: {
  day: DaySchedule;
  today: string;
}): ReactElement {
  const estAujourdhui = day.date === today;
  return (
    <>
      <span
        className={cn(
          "block truncate text-[11px] font-medium",
          estAujourdhui ? "text-primary" : "text-muted-foreground",
        )}
      >
        {columnHeading(day.date, today)}
      </span>
      <span className="mt-0.5 flex items-center gap-1.5">
        <span
          className={cn(
            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
            estAujourdhui
              ? "bg-primary text-primary-foreground shadow-carte"
              : "text-foreground",
          )}
        >
          {dayNumber(day.date)}
        </span>
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
          {monthShort(day.date)}
          {/* Le numéro de semaine ne s'affiche QUE si des créneaux à quinzaine
              existent : tant que l'enseignant ne s'en sert pas, il n'en voit
              aucune trace. */}
          {day.show_parity && ` · sem. ${day.iso_week} (${day.week_parity})`}
        </span>
      </span>
    </>
  );
}

/** Un bandeau de colonne. `line-clamp-2` et non `truncate` : « Vacances de la
 *  Toussaint » tient en deux lignes et serait illisible en une. Le `title`
 *  porte le texte entier dans les deux cas. */
function Bandeau({ texte }: { texte: string }): ReactElement {
  return (
    <p
      title={texte}
      className="flex items-start gap-1 rounded-sm border border-border bg-muted px-1 py-0.5 text-[10px] leading-tight text-muted-foreground"
    >
      <CalendarOff className="mt-px h-3 w-3 shrink-0" />
      <span className="line-clamp-2 min-w-0 flex-1">{texte}</span>
    </p>
  );
}

/**
 * Pourquoi la journée est vide, dit AVANT son contenu.
 *
 * Sans ce bandeau, un jour de vacances ressemble à un emploi du temps non
 * saisi — et c'est d'autant plus vrai en calendrier, où les créneaux masqués
 * laissent une colonne nue.
 */
function DayBanners({ day }: { day: DaySchedule }): ReactElement | null {
  const fermeture = motifDeFermeture(day);

  if (fermeture) return <Bandeau texte={fermeture} />;
  if (day.sessions_away.length === 0) return null;

  return (
    <>
      {day.sessions_away.map((classe) => (
        // Les mots viennent de `journee.ts`, comme ceux des cartes : un
        // professeur absent ne se dit pas « 3ème A — Formation », la classe
        // était là. Une période « l'appel se fait quand même » garde ce bandeau
        // alors que ses cartes ne changent pas : c'est le seul endroit qui la
        // nomme, et une sortie scolaire mérite d'être annoncée.
        //
        // La clé porte le groupe : depuis le palier 023, les deux groupes d'une
        // même classe peuvent partir le même jour, et deux bandeaux de même clé
        // n'en laisseraient qu'un.
        <Bandeau
          key={`${classe.session_id}:${classe.group_id ?? ""}`}
          texte={bandeauDeAbsence(classe)}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Les rappels
// ---------------------------------------------------------------------------

function ReminderCard({
  group,
  onOuvrirEntree,
}: {
  group: ReminderGroup;
  /** Pour les cas que l'accueil ouvre lui-même : le compte rendu d'un
   *  rendez-vous, qui n'a pas d'autre écran. */
  onOuvrirEntree: (entryId: string) => void;
}): ReactElement {
  const meta = REMINDERS[group.kind];
  const Icon = meta.icon;
  const reste = group.count - group.items.length;

  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 shrink-0 text-amber-700" />
          {meta.title}
        </CardTitle>
        <CardDescription>
          <span className="text-base font-semibold text-foreground tabular-nums">
            {group.count}
          </span>{" "}
          {/* Le dénominateur change tout : « 7 » inquiète, « 7 sur 180 »
              informe. Il n'est omis que s'il n'existe pas. */}
          {group.scope > 0 && <span>sur {group.scope} </span>}
          {pluriel(group.count, "à traiter", "à traiter")}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-1.5">
        {group.items.map((item) => {
          const href = reminderHref(group, item);
          const corps = (
            <>
              <span className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">
                {shortDate(item.date)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {item.title}
                {/* L'élève passe devant la classe, parce qu'il la contient :
                    un élève n'appartient qu'à une classe. Les rappels de
                    séance et d'évaluation n'ont jamais d'élève, ils montrent
                    donc toujours leur classe. */}
                {item.student_name ? (
                  <span className="text-muted-foreground">
                    {" "}
                    — {item.student_name}
                  </span>
                ) : item.session_name ? (
                  <span className="text-muted-foreground">
                    {" "}
                    — {item.session_name}
                  </span>
                ) : null}
              </span>
              {item.done !== null && item.total !== null && (
                <span className="shrink-0 text-xs font-medium tabular-nums text-amber-800">
                  {item.done}/{item.total}
                </span>
              )}
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </>
          );
          const classes =
            "flex w-full items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

          // Un lien quand le cas mène dans une classe — il doit s'ouvrir au
          // clic du milieu. Un `<button>` quand il s'ouvre ici : il n'y a pas
          // d'adresse derrière, et un lien l'inventerait.
          return href ? (
            <Link key={item.id} to={href} className={classes}>
              {corps}
            </Link>
          ) : (
            <button
              key={item.id}
              type="button"
              className={classes}
              onClick={() => onOuvrirEntree(item.id)}
            >
              {corps}
            </button>
          );
        })}

        {reste > 0 && (
          <p className="pt-0.5 text-xs text-muted-foreground">
            et {reste} {pluriel(reste, "autre", "autres")} — la liste s'arrête à
            cinq, le compte non.
          </p>
        )}

        {meta.note && (
          <p className="pt-1 text-xs text-muted-foreground">{meta.note}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// L'écran
// ---------------------------------------------------------------------------

export default function Home(): ReactElement {
  // Le jour est figé au montage, et c'est volontaire : il est passé au backend,
  // puis comparé aux dates qui en reviennent. Le relire à chaque rendu ferait,
  // une fois l'an à minuit, afficher les rappels d'un jour et les journées d'un
  // autre.
  const [today] = useState(todayISO);

  const [days, setDays] = useState<DaySchedule[]>([]);
  const [overview, setOverview] = useState<HomeOverview | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ---- Ce que l'accueil ouvre ----

  /** Le compte rendu d'un rendez-vous, ouvert en plein écran par-dessus
   *  l'accueil. Son identifiant, jamais l'entité : l'éditeur relit l'entrée
   *  complète, et une entité passée en prop se figerait (règle 1). */
  const [entryOuverte, setEntryOuverte] = useState<string | null>(null);

  /** Le cours dont la séance n'existe pas encore, et la date visée. Le
   *  dialogue nomme alors les deux gestes possibles. */
  const [occurrence, setOccurrence] = useState<Occurrence | null>(null);

  /** La même cible, passée à la demande de motif. Deux états et non un seul
   *  avec un drapeau : ce sont deux dialogues, et l'un enchaîne sur l'autre. */
  const [annulation, setAnnulation] = useState<Occurrence | null>(null);

  const [busySlotId, setBusySlotId] = useState<string | null>(null);

  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [jours, releve, classes, reglages] = await Promise.all([
        api.getUpcomingDays(today, DAYS_WANTED),
        api.getHomeOverview(today),
        api.getSessions(),
        api.getSettings(),
      ]);
      setDays(jours);
      setOverview(releve);
      setSessions(classes);
      setSettings(reglages);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => {
    void load();
  }, [load]);

  const sauvegarder = useCallback(async () => {
    setActionError(null);
    setSaving(true);
    try {
      const info = await api.createBackup();
      setSettings((prev) =>
        prev ? { ...prev, last_backup_at: info.created_at } : prev,
      );
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }, []);

  // ---- Les deux écritures d'une occurrence ----

  /**
   * Crée l'occurrence du créneau **à la date reçue en paramètre**, puis l'ouvre
   * dans sa classe.
   *
   * La date vient de la cible, jamais de `today` : l'accueil montre six
   * journées, et le clic a désigné l'une d'elles. Ne pas « simplifier » en
   * relisant le jour courant — une séance posée au mauvais jour compterait au
   * dénominateur d'assiduité du bilan remis aux familles.
   *
   * On navigue ensuite vers la classe plutôt que d'héberger l'appel ici : une
   * séance a son écran, et deux écrans qui l'affichent finiraient par ne pas
   * dire la même chose.
   */
  const creerEtOuvrir = useCallback(
    async (cible: Occurrence) => {
      const { slot, date } = cible;
      // Garde-fou : un créneau sans classe est un modèle, il n'offre aucune
      // action, et le backend refuserait de toute façon.
      if (slot.session_id === null) return;
      setBusySlotId(slot.id);
      setActionError(null);
      try {
        const creee = await api.createSeanceFromSlot(slot.id, date, false);
        setOccurrence(null);
        navigate(
          `/classes/${slot.session_id}?onglet=seances&ouvrir=${creee.id}`,
        );
      } catch (err) {
        setActionError(errorMessage(err));
      } finally {
        setBusySlotId(null);
      }
    },
    [navigate],
  );

  /**
   * Marque « ce cours n'a pas lieu » à la date de la cible.
   *
   * `cancelled = true` : la séance naît annulée, donc hors du dénominateur
   * d'assiduité de toute la classe. Le motif part dans la même écriture —
   * c'est la même information vue de deux côtés, l'une dit QUE, l'autre dit
   * POURQUOI.
   *
   * On reste sur l'accueil, qui doit donc se relire : la carte passe en barré
   * et le rappel « annulation sans motif » se met à jour.
   */
  const marquerSansCours = useCallback(
    async (cible: Occurrence, motif: string) => {
      const { slot, date } = cible;
      setBusySlotId(slot.id);
      setActionError(null);
      try {
        await api.createSeanceFromSlot(slot.id, date, true, motif);
        setAnnulation(null);
        setOccurrence(null);
        await load();
      } catch (err) {
        setActionError(errorMessage(err));
      } finally {
        setBusySlotId(null);
      }
    },
    [load],
  );

  /**
   * Ce qu'un clic fait quand il n'y a nulle part à aller.
   *
   * Deux cas, et deux seulement : le rendez-vous ouvre son compte rendu ici
   * même, et le cours dont la séance n'existe pas encore ouvre le dialogue qui
   * nomme les deux gestes. Tout le reste navigue (`rowHref`) ou reste inerte.
   *
   * Aucune branche n'écrit : celle du cours ne fait qu'ouvrir un dialogue.
   */
  const actionDeLigne = useCallback(
    (row: Row, day: DaySchedule): (() => void) | null => {
      if (row.kind === "entree") {
        const { entry } = row;
        return () => {
          setActionError(null);
          setEntryOuverte(entry.id);
        };
      }
      if (row.kind === "cours" && row.seance === null) {
        const { slot } = row;
        const { date } = day;
        return () => {
          setActionError(null);
          setOccurrence({ slot, date });
        };
      }
      return null;
    },
    [],
  );

  const aujourdhui = useMemo(
    () => days.find((day) => day.date === today) ?? null,
    [days, today],
  );

  /** La teinte de chaque classe, assignée par position dans l'année — voir
   *  `lib/teintes.ts`. Calculée ici parce que cet écran charge déjà toutes les
   *  classes : un contexte React pour la porter serait un état global, et il
   *  n'y en a pas dans cette application. */
  const teintes = useMemo(() => tableDesTeintes(sessions), [sessions]);

  /** Les classes de l'année en cours. L'année vient du relevé, jamais d'un
   *  calcul refait ici : `year_start_for` bascule le 1er août, et une seconde
   *  implémentation de cette bascule se tromperait tout le mois d'août. */
  const classesDeLAnnee = useMemo(() => {
    if (!overview) return [];
    return sessions.filter((s) => s.year_start === overview.year_start);
  }, [sessions, overview]);

  const aTraiter = useMemo(
    () => (overview?.groups ?? []).filter((g) => g.count > 0),
    [overview],
  );
  const aJour = useMemo(
    () => (overview?.groups ?? []).filter((g) => g.count === 0),
    [overview],
  );

  /** Le calendrier des vacances est embarqué et fini. Passé sa dernière date,
   *  la fonctionnalité ne s'éteint pas : elle se met à mentir dans l'autre sens
   *  — des créneaux redessinés pendant des vacances qu'on ne connaît plus.
   *  L'accueil doit donc le dire, puisque c'est lui qu'on ouvre. */
  const calendrierDepasse = useMemo(() => {
    const limite = days[0]?.calendar_until ?? null;
    if (limite === null || days.length === 0) return null;
    const dernier = days[days.length - 1].date;
    return dernier > limite ? limite : null;
  }, [days]);

  const sauvegardeAge =
    settings?.last_backup_at != null
      ? ageEnJours(settings.last_backup_at, today)
      : null;

  // ---- Rendu hébergé : le compte rendu d'un rendez-vous ----
  //
  // En plein écran par-dessus l'accueil, et non dans un dialogue : c'est un
  // texte qu'on vient écrire au retour d'une visite ou d'une réunion, pas un
  // champ qu'on remplit en passant. L'accueil est le seul écran qui l'ouvre —
  // l'emploi du temps ne sert qu'à définir l'emploi du temps.
  if (entryOuverte !== null) {
    return (
      <div className="mx-auto max-w-5xl p-8">
        <AgendaEntryEditor
          key={entryOuverte}
          entryId={entryOuverte}
          onBack={() => {
            setEntryOuverte(null);
            // L'intitulé, la date et la pastille « texte rédigé » changent dans
            // le calendrier comme dans les rappels : sans relecture, rien à
            // l'écran ne dirait que l'enregistrement a réussi.
            void load();
          }}
          onChanged={load}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{longDate(today)}</h1>
          {overview && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">
                Trimestre {overview.trimester}
              </Badge>
              <span>{schoolYearLabel(overview.year_start)}</span>
              <span aria-hidden="true">·</span>
              {/* Négatif = trimestre déjà clos : les bornes par défaut arrêtent
                  l'année au 7 juillet, et un rattrapage de la mi-juillet reste
                  en T3. On le dit, on ne le cache pas. */}
              {overview.trimester_days_left === null ? (
                <span>jusqu'au {shortDate(overview.trimester_end)}</span>
              ) : overview.trimester_days_left <= 0 ? (
                <span>terminé depuis le {shortDate(overview.trimester_end)}</span>
              ) : (
                <span>
                  jusqu'au {shortDate(overview.trimester_end)}, soit{" "}
                  {overview.trimester_days_left}{" "}
                  {pluriel(overview.trimester_days_left, "jour", "jours")}
                </span>
              )}
            </p>
          )}
        </div>

        {/* La sauvegarde est le seul bouton de cet écran qui écrit, et il le
            dit. Elle est ici et non dans les réglages parce que personne
            n'ouvre les réglages pour sauvegarder : on sauvegarde quand on y
            pense, et on y pense en ouvrant l'application. */}
        <div className="flex flex-col items-end gap-1.5">
          <Button
            variant={
              sauvegardeAge === null || sauvegardeAge > BACKUP_WARN_DAYS
                ? "default"
                : "outline"
            }
            size="sm"
            disabled={saving}
            onClick={() => void sauvegarder()}
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <HardDriveDownload className="mr-2 h-4 w-4" />
            )}
            Sauvegarder maintenant
          </Button>
          <p
            className={cn(
              "text-xs",
              sauvegardeAge === null || sauvegardeAge > BACKUP_WARN_DAYS
                ? "font-medium text-amber-700"
                : "text-muted-foreground",
            )}
          >
            {settings?.last_backup_at == null
              ? "Aucune sauvegarde pour l'instant"
              : sauvegardeAge === null
                ? `Dernière sauvegarde : ${settings.last_backup_at}`
                : sauvegardeAge <= 0
                  ? "Dernière sauvegarde : aujourd'hui"
                  : sauvegardeAge === 1
                    ? "Dernière sauvegarde : hier"
                    : `Dernière sauvegarde : il y a ${sauvegardeAge} jours`}
          </p>
        </div>
      </header>

      {actionError && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {actionError}
        </p>
      )}

      <DataState
        loading={loading}
        error={error}
        onRetry={() => {
          void load();
        }}
      >
        <div className="space-y-8">
          {calendrierDepasse && (
            <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Le calendrier des vacances embarqué s'arrête au{" "}
                {shortDate(calendrierDepasse)}. Au-delà, les créneaux
                s'affichent même pendant des vacances que l'application ne
                connaît plus : vérifiez les journées à la main.
              </span>
            </p>
          )}

          {/* ---- La semaine, en UN calendrier ----

              Aujourd'hui en première colonne — c'est l'ordre que rend le
              backend, l'écran ne retrie rien —, les jours suivants à sa droite,
              sur l'axe horaire partagé.

              Le calendrier DÉBORDE horizontalement plutôt que de se rétrécir :
              six journées dans la largeur d'un portable donneraient des
              colonnes de dix rem, où « Atelier cuisine » se tronque. Le
              `min-w-` pose le plancher, le conteneur défile, et aucune carte ne
              devient illisible pour tenir dans l'écran. */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">La semaine</CardTitle>
              <CardDescription>
                {aujourdhui
                  ? "Aujourd'hui et les prochains jours de cours, sur le même axe horaire."
                  : `Nous sommes ${longDate(today).toLowerCase()} : l'accueil n'affiche ni le samedi ni le dimanche, et ouvre donc sur les prochains jours de cours.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {days.length === 0 ? (
                <p className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
                  Aucun jour de cours à montrer.
                </p>
              ) : (
                <div className="overflow-x-auto pb-1">
                  <DaysCalendar
                    days={days}
                    today={today}
                    teintes={teintes}
                    hrefOf={rowHref}
                    actionDe={actionDeLigne}
                    enteteDe={(day) => <EnteteJour day={day} today={today} />}
                    bandeauDe={(day) => <DayBanners day={day} />}
                    className="min-w-[58rem]"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* ---- Rappels ---- */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">À reprendre</h2>

            {aTraiter.length === 0 ? (
              <p className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-900">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Rien à reprendre sur l'année en cours : appels, cahiers de
                  texte, motifs d'annulation, notes et comptes rendus sont à
                  jour.
                </span>
              </p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {aTraiter.map((group) => (
                  <ReminderCard
                    key={group.kind}
                    group={group}
                    onOuvrirEntree={(entryId) => {
                      setActionError(null);
                      setEntryOuverte(entryId);
                    }}
                  />
                ))}
              </div>
            )}

            {/* Dire ce qui a été vérifié et trouvé bon : un groupe silencieux
                laisserait croire que l'application n'a pas regardé. */}
            {aTraiter.length > 0 && aJour.length > 0 && (
              <p className="text-xs text-muted-foreground">
                À jour :{" "}
                {aJour
                  .map((g) => {
                    const nom = REMINDERS[g.kind].verified;
                    return g.scope > 0 ? `${nom} (${g.scope})` : nom;
                  })
                  .join(", ")}
                .
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              Seul le passé est relevé : une séance d'aujourd'hui dont l'appel
              n'est pas fait n'est pas un oubli.
            </p>
          </section>

          {/* ---- Les classes ---- */}
          {classesDeLAnnee.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Vos classes</h2>
              <div className="flex flex-wrap gap-3">
                {classesDeLAnnee.map((session) => (
                  // Carte blanche, couleur réduite à une pastille. Une carte
                  // entièrement teintée tenait ici aussi, mais quatre pavés de
                  // couleur côte à côte pèsent plus que les cartes du
                  // calendrier au-dessus, qu'ils sont censés rappeler — c'est
                  // la même teinte, à une dose près.
                  //
                  // La pastille porte toute la couleur, et c'est assez : elle
                  // est posée juste à côté du nom qu'elle qualifie, là où une
                  // barre d'accent le long du bord gauche restait à distance de
                  // ce qu'elle désignait.
                  <Link
                    key={session.id}
                    to={`/classes/${session.id}`}
                    style={styleTeinte(teintes, session.id)}
                    className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-carte transition-shadow hover:shadow-relief focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <span
                      aria-hidden
                      className="teinte-plein h-2.5 w-2.5 shrink-0 rounded-full"
                    />
                    <span>
                      <span className="block font-medium">{session.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {LEVEL_LABELS[session.level_code]} ·{" "}
                        {session.student_count}{" "}
                        {pluriel(session.student_count, "élève", "élèves")}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </DataState>

      {/* Le cours de chaque semaine qui n'a pas encore de séance : le dialogue
          nomme les deux gestes, et c'est l'accueil qui écrit ensuite. */}
      <OccurrenceDialog
        cible={
          occurrence && {
            slotLabel:
              occurrence.slot.label.trim() ||
              occurrence.slot.session_name ||
              "Cours",
            sessionName: occurrence.slot.session_name,
            date: occurrence.date,
            passee: occurrence.date < today,
          }
        }
        onClose={() => setOccurrence(null)}
        onCreerEtOuvrir={() => {
          if (occurrence) void creerEtOuvrir(occurrence);
        }}
        // Le premier dialogue se retire et le second prend la MÊME cible : la
        // date ne se relit pas entre les deux, elle se passe.
        onSansCours={() => {
          if (!occurrence) return;
          setAnnulation(occurrence);
          setOccurrence(null);
        }}
        busy={occurrence !== null && busySlotId === occurrence.slot.id}
      />

      <CancelReasonDialog
        cible={
          annulation && {
            slotLabel:
              annulation.slot.label.trim() ||
              annulation.slot.session_name ||
              "Cours",
            date: annulation.date,
          }
        }
        onClose={() => setAnnulation(null)}
        onConfirm={(motif) => {
          if (annulation) void marquerSansCours(annulation, motif);
        }}
        busy={annulation !== null && busySlotId === annulation.slot.id}
      />
    </div>
  );
}
