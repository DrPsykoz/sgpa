/**
 * Ce qu'une journée contient, lu d'une seule façon.
 *
 * Deux calendriers montrent la même journée sous deux formes — celui de
 * l'accueil (`DaysCalendar`), en colonnes de jours ouvrés, et la grille de la
 * semaine (`WeekGrid`), en sept colonnes datées. Les aides de ce fichier sont
 * leur règle commune : `buildRows` dit quelles lignes une journée porte,
 * `motifDeFermeture` et `motifDuCreneau` disent pourquoi elle n'en porte pas,
 * `timeLabel`, `slotTitle` et `studentName` disent comment elles s'écrivent.
 *
 * Deux fonctions décidant chacune de son côté ce qu'une journée contient
 * auraient divergé au premier créneau à quinzaine, et l'accueil aurait annoncé
 * un cours que l'emploi du temps ne montre pas. Une seule règle, deux rendus.
 *
 * `motifDuCreneau` mérite une ligne à part : c'est la règle qui distingue le
 * JOUR fermé pour tout le monde — vacances, férié — de la CLASSE absente, en
 * stage, dont les seuls créneaux disparaissent. Les deux calendriers s'en
 * servent pour masquer un créneau. Les confondre referait, à l'envers, le
 * défaut que le palier 006 a corrigé.
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
 * Pourquoi ce créneau-là n'a pas lieu aujourd'hui, ou `null`.
 *
 * Deux portées différentes, et il faut les distinguer : les vacances et les
 * fériés ferment le JOUR pour tout le monde ; un stage ne retire que les
 * créneaux de SA classe — les autres classes travaillent. Une période
 * nominative n'entre jamais ici (le backend ne la rend pas) : la classe est là,
 * un élève manque. Les confondre referait, à l'envers, le défaut que le palier
 * 006 a corrigé.
 */
export function motifDuCreneau(
  day: DaySchedule,
  sessionId: string | null,
): string | null {
  const jour = motifDeFermeture(day);
  if (jour !== null) return jour;
  if (sessionId === null) return null;
  const absente = day.sessions_away.find((c) => c.session_id === sessionId);
  return absente ? `${absente.session_name} — ${absente.reason}` : null;
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
