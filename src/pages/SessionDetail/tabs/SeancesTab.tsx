import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import {
  AlertTriangle,
  BookDashed,
  BookOpen,
  Calendar,
  Plus,
  Trash2,
} from "lucide-react";

import { DataState } from "@/components/DataState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SeanceDetail } from "@/pages/SessionDetail/seance/SeanceDetail";
import { api } from "@/lib/api";
import {
  compteRenduRegle,
  etatDuCompteRendu,
  motsDuCahier,
  renduDeLaSeance,
} from "@/lib/contenu";
import { cn } from "@/lib/utils";
import type { Seance, Session, Student } from "@/types";

export /**
 * L'icône d'état du cahier de texte, dans la liste d'une classe.
 *
 * Quatre états et non deux. Une séance déclarée « rien à écrire » n'est pas un
 * cahier en retard : sans un signe à elle, elle se lisait dans cette liste
 * exactement comme un oubli, et l'enseignant rouvrait une séance qu'il avait
 * déjà traitée. Le pointillé dit « volontairement vide ». Et une séance dont la
 * photo du tableau EST le compte rendu est réglée elle aussi — l'accueil a
 * cessé de la réclamer au palier 014, cette liste le dit depuis le 017.
 *
 * Les mots viennent de `motsDuCahier`, comme ceux des deux calendriers : la
 * liste a la place d'une phrase, donc le registre long, capitalisé parce qu'il
 * est seul dans l'infobulle.
 */
function IconeDuCahier({ seance }: { seance: Seance }): ReactElement {
  const rendu = renduDeLaSeance(seance);
  const mots = motsDuCahier(rendu).infobulle;
  return (
    <div
      className={cn(
        "rounded-lg p-2",
        compteRenduRegle(rendu)
          ? "bg-primary/10 text-primary"
          : "bg-muted text-muted-foreground",
      )}
      title={`${mots.charAt(0).toUpperCase()}${mots.slice(1)}`}
    >
      {etatDuCompteRendu(rendu) === "renonce" ? (
        <BookDashed className="h-4 w-4" />
      ) : (
        <BookOpen className="h-4 w-4" />
      )}
    </div>
  );
}

interface SeancesTabProps {
  session: Session;
  students: Student[];
  /** Séance à ouvrir d'emblée, quand on arrive depuis un rappel de l'accueil.
   *  Lu une seule fois, à la construction de l'état : le parent remonte
   *  l'instance (`key`) quand la cible change, donc une prop figée suffit et
   *  rien ne vient réouvrir ce que l'enseignant a refermé. */
  openId?: string | null;
}

type TrimesterChoice = "auto" | "1" | "2" | "3";

/** Date du jour en heure locale. `toISOString()` daterait une séance créée le
 *  1er décembre à 00h30 au 30 novembre, donc au mauvais trimestre. */
function today(): string {
  return new Date().toLocaleDateString("sv-SE");
}

function formatDate(iso: string): string {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR");
}

function formatLongDate(iso: string): string {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function defaultTitle(iso: string): string {
  return `Séance du ${formatDate(iso)}`;
}

function messageOf(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Une erreur inattendue est survenue.";
}

export function SeancesTab({ session, students, openId }: SeancesTabProps) {
  const [seances, setSeances] = useState<Seance[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // L'écran de détail ne détient jamais la séance : le parent garde la liste et
  // l'identifiant sélectionné, et dérive l'entité. Un rechargement de la liste
  // rafraîchit donc l'enfant au lieu de le laisser sur une copie figée.
  const [selectedId, setSelectedId] = useState<string | null>(openId ?? null);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newDate, setNewDate] = useState(today);
  const [newTitle, setNewTitle] = useState(() => defaultTitle(today()));
  const [titleTouched, setTitleTouched] = useState(false);
  const [newChoice, setNewChoice] = useState<TrimesterChoice>("auto");

  const [toDelete, setToDelete] = useState<Seance | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setSeances(await api.getSeances(session.id));
    } catch (err) {
      setLoadError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, [session.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => seances.find((s) => s.id === selectedId) ?? null,
    [seances, selectedId],
  );

  const openCreate = () => {
    const iso = today();
    setNewDate(iso);
    setNewTitle(defaultTitle(iso));
    setTitleTouched(false);
    setNewChoice("auto");
    setCreateError(null);
    setCreateOpen(true);
  };

  const handleDateChange = (iso: string) => {
    setNewDate(iso);
    // Tant que l'enseignant n'a pas écrit son propre titre, il suit la date.
    if (!titleTouched) setNewTitle(defaultTitle(iso));
  };

  const handleCreate = async () => {
    const title = newTitle.trim() || defaultTitle(newDate);
    if (!newDate) {
      setCreateError("La date de la séance est obligatoire.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const created = await api.createSeance(
        session.id,
        title,
        newDate,
        newChoice === "auto" ? null : Number(newChoice),
      );
      setCreateOpen(false);
      await load();
      setSelectedId(created.id);
    } catch (err) {
      setCreateError(messageOf(err));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    setActionError(null);
    try {
      await api.deleteSeance(toDelete.id);
      if (selectedId === toDelete.id) setSelectedId(null);
      setToDelete(null);
      await load();
    } catch (err) {
      setToDelete(null);
      setActionError(messageOf(err));
    }
  };

  if (selected) {
    return (
      <SeanceDetail
        key={selected.id}
        seance={selected}
        students={students}
        onBack={() => setSelectedId(null)}
        onChanged={load}
      />
    );
  }

  return (
    <div className="space-y-4">
      {actionError && (
        <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {actionError}
        </p>
      )}

      {students.length === 0 && (
        <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Cette classe n'a encore aucun élève : l'appel des séances restera
          vide. Ajoutez-les depuis l'onglet Élèves.
        </p>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Séances</CardTitle>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Nouvelle séance
          </Button>
        </CardHeader>
        <CardContent>
          <DataState
            loading={loading}
            error={loadError}
            empty={seances.length === 0}
            emptyLabel="Aucune séance pour cette classe. Créez-en une pour faire l'appel et tenir le cahier de texte."
            onRetry={() => {
              void load();
            }}
          >
            <div className="space-y-2">
              {seances.map((seance) => (
                <div
                  key={seance.id}
                  role="button"
                  tabIndex={0}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50"
                  onClick={() => setSelectedId(seance.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedId(seance.id);
                    }
                  }}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <IconeDuCahier seance={seance} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p
                          className={cn(
                            "truncate text-sm font-medium",
                            seance.cancelled &&
                              "text-muted-foreground line-through",
                          )}
                        >
                          {seance.title}
                        </p>
                        {seance.cancelled && (
                          <span className="text-xs text-muted-foreground">
                            Annulée
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatLongDate(seance.date)}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {seance.attendance_taken_at === null &&
                      !seance.cancelled && (
                        <Badge
                          variant="outline"
                          className="border-amber-200 bg-amber-50 font-normal text-amber-800"
                        >
                          Appel non fait
                        </Badge>
                      )}
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        seance.trimester_is_manual
                          ? "bg-violet-100 text-violet-800"
                          : "bg-slate-100 text-slate-700",
                      )}
                      title={
                        seance.trimester_is_manual
                          ? "Trimestre forcé manuellement"
                          : "Trimestre déduit de la date"
                      }
                    >
                      T{seance.trimester} ·{" "}
                      {seance.trimester_is_manual ? "forcé" : "auto"}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      title="Supprimer la séance"
                      onClick={(e) => {
                        e.stopPropagation();
                        setToDelete(seance);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </DataState>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle séance</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-seance-date">Date</Label>
              {/* Bornes de l'année scolaire de la classe, bascule au 1er
                  août — les mêmes que `year_start_for` côté Rust. Confort
                  seulement : le refus, seule implémentation de la règle, est
                  dans `insert_seance`. Sans lui, un 2028 frappé à la place de
                  2026 se rangeait en silence dans un trimestre de cette
                  classe-ci et gonflait son dénominateur d'assiduité. */}
              <Input
                id="new-seance-date"
                type="date"
                min={`${session.year_start}-08-01`}
                max={`${session.year_start + 1}-07-31`}
                value={newDate}
                onChange={(e) => handleDateChange(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-seance-title">Titre</Label>
              <Input
                id="new-seance-title"
                value={newTitle}
                onChange={(e) => {
                  setNewTitle(e.target.value);
                  setTitleTouched(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !creating) void handleCreate();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-seance-trimester">Trimestre</Label>
              <Select
                value={newChoice}
                onValueChange={(value) =>
                  setNewChoice(value as TrimesterChoice)
                }
              >
                <SelectTrigger id="new-seance-trimester">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    Automatique (d'après la date)
                  </SelectItem>
                  <SelectItem value="1">Trimestre 1 (forcé)</SelectItem>
                  <SelectItem value="2">Trimestre 2 (forcé)</SelectItem>
                  <SelectItem value="3">Trimestre 3 (forcé)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {createError && (
              <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {createError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Annuler
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              <Calendar className="h-4 w-4" />
              {creating ? "Création…" : "Créer la séance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
        title="Supprimer cette séance ?"
        description={
          toDelete
            ? `« ${toDelete.title} » du ${formatDate(toDelete.date)} sera supprimée, ainsi que son appel et son cahier de texte. Cette action est définitive.`
            : ""
        }
        onConfirm={handleDelete}
      />
    </div>
  );
}
