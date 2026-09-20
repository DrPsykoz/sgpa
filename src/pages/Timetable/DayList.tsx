import type { ReactElement, ReactNode } from "react";
import { BookOpen, CircleDot, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  AgendaEntrySummary,
  DaySchedule,
  DaySeance,
  TimetableSlot,
} from "@/types";
import { WEEK_PARITY_LABELS } from "@/types";

export interface DayListProps {
  day: DaySchedule;
  /** Ouvre une séance qui existe déjà : appel et cahier de texte. */
  onOpenSeance: (seance: DaySeance) => void;
  /** Fabrique l'occurrence du créneau, puis l'ouvre. */
  onCreateAndOpen: (slot: TimetableSlot) => void;
  /** Fabrique l'occurrence déjà annulée — « Ce cours n'a pas lieu ». */
  onCancelSlot: (slot: TimetableSlot) => void;
  /** Ouvre un rendez-vous sur son compte rendu. */
  onOpenEntry: (entry: AgendaEntrySummary) => void;
  /** Ligne dont l'écriture est en cours : ses actions sont suspendues le temps
   *  de l'aller-retour, sans quoi un double clic lance deux créations. */
  busyId: string | null;
}

/**
 * Les quatre formes de ligne de la journée.
 *
 * `cours` et `occupation` viennent toutes deux d'un créneau : c'est
 * `session_id` qui les sépare, et rien d'autre — il n'existe aucune colonne
 * `kind` dans le schéma, justement pour qu'une seconde source de vérité ne
 * puisse pas contredire la première.
 */
type Row =
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

function buildRows(day: DaySchedule): Row[] {
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

function timeLabel(start: string, end: string): string {
  if (!start && !end) return "";
  if (!end) return start;
  if (!start) return `jusqu'à ${end}`;
  return `${start} – ${end}`;
}

/** Intitulé d'un créneau : le libellé porte le cours, la classe le situe. */
function slotTitle(slot: TimetableSlot): string {
  const label = slot.label.trim();
  const session = slot.session_name ?? "";
  if (label && session) return `${label} — ${session}`;
  return label || session || "Créneau sans intitulé";
}

function studentName(entry: AgendaEntrySummary): string | null {
  if (entry.student_id === null) return null;
  const name =
    `${entry.student_last_name ?? ""} ${entry.student_first_name ?? ""}`.trim();
  return name || null;
}

type ChipTone = "neutre" | "attention" | "ok" | "info";

const CHIP_TONES: Record<ChipTone, string> = {
  neutre: "border-border bg-muted text-muted-foreground",
  attention: "border-amber-200 bg-amber-50 text-amber-900",
  ok: "border-green-200 bg-green-50 text-green-800",
  info: "border-blue-200 bg-blue-50 text-blue-800",
};

function Chip({
  tone,
  title,
  children,
}: {
  tone: ChipTone;
  title?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-sm font-medium",
        CHIP_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Pastilles d'état d'une séance. L'appel s'affiche en « pointés/inscrits » et
 *  jamais en booléen : `attendance_taken_at` est posé dès le premier élève
 *  pointé, il ne dit donc pas qu'un appel soit terminé. */
function SeanceChips({ seance }: { seance: DaySeance }): ReactElement {
  if (seance.cancelled) {
    return (
      <Chip
        tone="neutre"
        title="Hors du dénominateur d'assiduité de toute la classe"
      >
        N'a pas lieu
      </Chip>
    );
  }

  const done = seance.attendance_done;
  const total = seance.attendance_total;
  const complet = total > 0 && done >= total;

  return (
    <>
      {total === 0 ? (
        <Chip
          tone="neutre"
          title="Aucun élève inscrit dans cette classe à cette date"
        >
          Aucun élève inscrit
        </Chip>
      ) : (
        <Chip
          tone={complet ? "ok" : "attention"}
          title={complet ? "Appel terminé" : "Appel incomplet"}
        >
          {complet ? "Appel fait" : "Appel"} {done}/{total}
        </Chip>
      )}
      {seance.has_content && (
        <Chip tone="info" title="Cahier de texte rempli">
          <BookOpen className="h-4 w-4" />
          Cahier rempli
        </Chip>
      )}
    </>
  );
}

interface RowShellProps {
  time: string;
  /** Ce qui est daté porte une barre verticale ; ce qui revient chaque semaine
   *  n'en a pas. C'est la seule différence visible entre un modèle et une
   *  occurrence, et elle se lit sans légende. */
  dated?: boolean;
  /** Ligne sans rien à ouvrir : elle ne prend ni le clic ni le clavier. */
  inerte?: boolean;
  busy?: boolean;
  onOpen?: () => void;
  ariaLabel?: string;
  children: ReactNode;
  actions: ReactNode;
}

function RowShell({
  time,
  dated,
  inerte,
  busy,
  onOpen,
  ariaLabel,
  children,
  actions,
}: RowShellProps): ReactElement {
  const clickable = onOpen !== undefined && busy !== true;

  return (
    // Une seule cible cliquable par ligne, et elle occupe toute la rangée :
    // cet écran se lit debout entre deux cours, pas à la souris posée.
    <div
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={ariaLabel}
      aria-disabled={busy ? true : undefined}
      onClick={clickable ? onOpen : undefined}
      onKeyDown={(event) => {
        if (!clickable) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen?.();
        }
      }}
      className={cn(
        "flex items-start gap-4 rounded-lg border bg-card p-4 transition-colors",
        dated && "border-l-4 border-l-primary",
        inerte && "border-dashed bg-muted/40",
        onOpen &&
          "cursor-pointer hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        busy && "pointer-events-none opacity-60",
      )}
    >
      <div
        className={cn(
          "w-36 shrink-0 tabular-nums",
          time
            ? "text-base font-semibold"
            : "text-sm text-muted-foreground",
        )}
      >
        {time || "heure à caler"}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">{children}</div>
      <div className="flex shrink-0 flex-col items-end gap-2">{actions}</div>
    </div>
  );
}

export function DayList({
  day,
  onOpenSeance,
  onCreateAndOpen,
  onCancelSlot,
  onOpenEntry,
  busyId,
}: DayListProps): ReactElement {
  const rows = buildRows(day);

  const aOccupation = day.slots.some(({ slot }) => slot.session_id === null);
  const aDate = day.loose_seances.length > 0 || day.entries.length > 0;

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        switch (row.kind) {
          // ---- 1 & 2 · Créneau rattaché à une classe ----
          case "cours": {
            const slot = row.slot;
            const seance = row.seance;
            const busy = busyId === slot.id;
            const parite =
              day.show_parity && slot.week_parity !== "toutes"
                ? WEEK_PARITY_LABELS[slot.week_parity]
                : null;
            const sousTitre = [slot.room.trim(), parite]
              .filter((part) => part)
              .join(" · ");

            // Forme 1 : l'occurrence existe, il n'y a plus qu'à l'ouvrir.
            if (seance) {
              return (
                <RowShell
                  key={row.key}
                  time={timeLabel(slot.start_time, slot.end_time)}
                  ariaLabel={`Ouvrir ${seance.title}`}
                  onOpen={() => onOpenSeance(seance)}
                  actions={<Button variant="outline">Ouvrir</Button>}
                >
                  {/* Le titre affiché est celui de la SÉANCE, pas celui du
                      créneau : une séance renommée (« Évaluation chapitre 3 »)
                      doit se reconnaître dans la journée où elle a lieu. */}
                  <p
                    className={cn(
                      "truncate text-lg font-semibold",
                      seance.cancelled && "text-muted-foreground line-through",
                    )}
                  >
                    {seance.title} — {seance.session_name}
                  </p>
                  {sousTitre && (
                    <p className="text-sm text-muted-foreground">{sousTitre}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <SeanceChips seance={seance} />
                  </div>
                </RowShell>
              );
            }

            // Forme 2 : le créneau n'est qu'un modèle, et rien n'en est
            // engendré d'office. Une séance qui existe compte au dénominateur
            // d'assiduité du bilan remis aux familles — c'est pour cela que
            // l'occurrence naît d'un geste, jamais du calendrier.
            return (
              <RowShell
                key={row.key}
                time={timeLabel(slot.start_time, slot.end_time)}
                busy={busy}
                ariaLabel={`Créer et ouvrir ${slotTitle(slot)}`}
                onOpen={() => onCreateAndOpen(slot)}
                actions={
                  <>
                    <Button
                      disabled={busy}
                      onClick={(event) => {
                        event.stopPropagation();
                        onCreateAndOpen(slot);
                      }}
                    >
                      Créer et ouvrir
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      title="Crée la séance déjà annulée : elle ne comptera dans le bilan d'aucun élève."
                      onClick={(event) => {
                        event.stopPropagation();
                        onCancelSlot(slot);
                      }}
                    >
                      Ce cours n'a pas lieu
                    </Button>
                  </>
                }
              >
                <p className="truncate text-lg font-semibold">
                  {slotTitle(slot)}
                </p>
                {sousTitre && (
                  <p className="text-sm text-muted-foreground">{sousTitre}</p>
                )}
              </RowShell>
            );
          }

          // ---- 3 · Créneau sans classe : il n'y a rien derrière un modèle ----
          case "occupation": {
            const slot = row.slot;
            return (
              <RowShell
                key={row.key}
                time={timeLabel(slot.start_time, slot.end_time)}
                inerte
                actions={
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Lock className="h-4 w-4" />
                    Pas d'action
                  </span>
                }
              >
                <p className="truncate text-lg font-semibold text-muted-foreground">
                  {slotTitle(slot)}
                </p>
                {slot.room.trim() && (
                  <p className="text-sm text-muted-foreground">
                    {slot.room.trim()}
                  </p>
                )}
              </RowShell>
            );
          }

          // ---- 4 · Séance du jour qui ne vient d'aucun créneau ----
          case "seance": {
            const seance = row.seance;
            return (
              <RowShell
                key={row.key}
                time={timeLabel(seance.start_time, seance.end_time)}
                dated
                ariaLabel={`Ouvrir ${seance.title}`}
                onOpen={() => onOpenSeance(seance)}
                actions={<Button variant="outline">Ouvrir</Button>}
              >
                <p
                  className={cn(
                    "truncate text-lg font-semibold",
                    seance.cancelled && "text-muted-foreground line-through",
                  )}
                >
                  {seance.title} — {seance.session_name}
                </p>
                <p className="text-sm text-muted-foreground">
                  Hors emploi du temps
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <SeanceChips seance={seance} />
                </div>
              </RowShell>
            );
          }

          // ---- 5 · Rendez-vous : il EST l'occurrence, donc toujours ouvrable ----
          case "entree": {
            const entry = row.entry;
            const eleve = studentName(entry);
            return (
              <RowShell
                key={row.key}
                time={timeLabel(entry.start_time, entry.end_time)}
                dated
                ariaLabel={`Ouvrir ${entry.title}`}
                onOpen={() => onOpenEntry(entry)}
                actions={<Button variant="outline">Ouvrir</Button>}
              >
                {/* L'élève tient dans le titre : c'est ainsi qu'une visite se
                    lit d'un coup d'œil dans la journée, sans seconde ligne. */}
                <p className="truncate text-lg font-semibold">
                  {entry.title}
                  {eleve ? ` — ${eleve}` : ""}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={entry.has_content ? "info" : "neutre"}>
                    <CircleDot className="h-4 w-4" />
                    {entry.has_content ? "Texte rédigé" : "Rien d'écrit"}
                  </Chip>
                </div>
              </RowShell>
            );
          }
        }
      })}

      {aOccupation && (
        <p className="pt-1 text-sm text-muted-foreground">
          Un créneau sans classe n'a rien à ouvrir : c'est un modèle, pas un
          cours. Pour écrire quelque chose ce jour-là, ajoutez une visite de
          stage ou une réunion.
        </p>
      )}

      {aDate && (
        <p className="text-sm text-muted-foreground">
          La barre verticale signale ce qui est daté — une séance hors emploi du
          temps, ou un rendez-vous de ce seul jour.
        </p>
      )}
    </div>
  );
}

export default DayList;
