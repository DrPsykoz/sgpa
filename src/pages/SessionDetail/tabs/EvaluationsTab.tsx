import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { schoolYearLabel } from "@/types";
import type { Evaluation, Session, Student, TrimesterBounds } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { CompetencyPicker } from "@/components/CompetencyPicker";
import { DataState } from "@/components/DataState";
import { ConfirmDialog } from "@/pages/SessionDetail/dialogs/ConfirmDialog";
import { EvaluationDetail } from "@/pages/SessionDetail/evaluation/EvaluationDetail";

interface EvaluationsTabProps {
  session: Session;
  students: Student[];
}

const TRIMESTERS = [1, 2, 3];

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("fr-FR");
}

/** `toISOString()` daterait une évaluation créée le 1er décembre à 00h30 au
 *  30 novembre, donc au mauvais trimestre. */
function todayISO(): string {
  return new Date().toLocaleDateString("sv-SE");
}

/** Même règle que `db::trimester_for` côté Rust : les dates AAAA-MM-JJ se
 *  comparent comme des chaînes. Sert seulement à afficher le trimestre que le
 *  backend déduira — c'est lui qui tranche à l'enregistrement. */
function deduceTrimester(
  date: string,
  bounds: TrimesterBounds | null,
): number | null {
  if (!bounds || !date) return null;
  if (date < bounds.t2_start) return 1;
  if (date < bounds.t3_start) return 2;
  return 3;
}

export function EvaluationsTab({ session, students }: EvaluationsTabProps) {
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [selectedEvaluationId, setSelectedEvaluationId] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [bounds, setBounds] = useState<TrimesterBounds | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayISO());
  const [trimesterChoice, setTrimesterChoice] = useState("auto");
  const [competencyIds, setCompetencyIds] = useState<string[]>([]);

  const [toDelete, setToDelete] = useState<Evaluation | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEvaluations(await api.getEvaluations(session.id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [session.id]);

  /** Rechargement silencieux après écriture : repasser par l'état « chargement »
   *  démonterait EvaluationDetail et l'enseignant perdrait sa vue en cours. */
  const reload = useCallback(async () => {
    try {
      setEvaluations(await api.getEvaluations(session.id));
      setError(null);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }, [session.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    api
      .getTrimesterBounds(session.year_start)
      .then((value) => {
        if (!cancelled) setBounds(value);
      })
      .catch(() => {
        // Sans les bornes, le choix affiche « Automatique » au lieu de
        // « Automatique (T2) » : c'est une dégradation d'affichage, la création
        // reste possible et c'est le backend qui résout le trimestre.
        if (!cancelled) setBounds(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session.year_start]);

  const selected = useMemo(
    () => evaluations.find((item) => item.id === selectedEvaluationId) ?? null,
    [evaluations, selectedEvaluationId],
  );

  const groups = useMemo(
    () =>
      TRIMESTERS.map((trimester) => ({
        trimester,
        items: evaluations.filter((item) => item.trimester === trimester),
      })).filter((group) => group.items.length > 0),
    [evaluations],
  );

  const deduced = deduceTrimester(date, bounds);

  const openCreate = () => {
    setTitle("");
    setDate(todayISO());
    setTrimesterChoice("auto");
    setCompetencyIds([]);
    setFormError(null);
    setActionError(null);
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!title.trim()) {
      setFormError("Le titre de l'évaluation est obligatoire.");
      return;
    }
    if (!date) {
      setFormError("La date de l'évaluation est obligatoire.");
      return;
    }
    setCreating(true);
    setFormError(null);
    try {
      const created = await api.createEvaluation(
        session.id,
        title.trim(),
        date,
        trimesterChoice === "auto" ? null : Number(trimesterChoice),
        competencyIds,
      );
      setCreateOpen(false);
      await reload();
      setSelectedEvaluationId(created.id);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    const target = toDelete;
    setToDelete(null);
    setActionError(null);
    try {
      await api.deleteEvaluation(target.id);
      if (selectedEvaluationId === target.id) setSelectedEvaluationId(null);
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      {actionError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      )}

      {selected ? (
        <EvaluationDetail
          key={selected.id}
          evaluation={selected}
          students={students}
          onBack={() => setSelectedEvaluationId(null)}
          onChanged={reload}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">Évaluations</h3>
              <p className="text-sm text-muted-foreground">
                {evaluations.length} évaluation
                {evaluations.length > 1 ? "s" : ""} dans cette classe
              </p>
            </div>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Nouvelle évaluation
            </Button>
          </div>

          <DataState
            loading={loading}
            error={error}
            empty={evaluations.length === 0}
            emptyLabel="Aucune évaluation dans cette classe. Créez-en une pour commencer à noter."
            onRetry={load}
          >
            <div className="space-y-6">
              {groups.map((group) => (
                <div key={group.trimester} className="space-y-2">
                  {/* L'année scolaire AVANT le trimestre. Une classe n'en
                      couvre qu'une, donc l'année est la même partout dans cet
                      onglet — et c'est précisément pourquoi elle manquait :
                      « Trimestre 1 » tout seul ne dit pas de quelle année il
                      s'agit dès qu'on travaille sur plusieurs classes, et
                      l'ordre chronologique n'était lisible que si on le savait
                      déjà. Elle se lit sur la classe, elle n'est pas calculée
                      ici — le niveau et l'année ne vivent que sur la session. */}
                  <h4 className="text-sm font-semibold text-muted-foreground">
                    {schoolYearLabel(session.year_start)} · Trimestre{" "}
                    {group.trimester} — {group.items.length} évaluation
                    {group.items.length > 1 ? "s" : ""}
                  </h4>
                  {group.items.map((evaluation) => {
                    const count = evaluation.competency_ids.length;
                    return (
                      <div
                        key={evaluation.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedEvaluationId(evaluation.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedEvaluationId(evaluation.id);
                          }
                        }}
                        className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="rounded-lg bg-primary/10 p-2 text-primary">
                            <ClipboardList className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {evaluation.title}
                            </p>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span>{formatDate(evaluation.date)}</span>
                              <Badge variant="outline" className="font-normal">
                                T{evaluation.trimester}
                                {" · "}
                                {evaluation.trimester_is_manual
                                  ? "forcé"
                                  : "auto"}
                              </Badge>
                              <span>
                                {count === 0
                                  ? "aucune compétence"
                                  : count + " compétence" + (count > 1 ? "s" : "")}
                              </span>
                            </div>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={"Supprimer " + evaluation.title}
                          className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                          onClick={(event) => {
                            event.stopPropagation();
                            setToDelete(evaluation);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </DataState>
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nouvelle évaluation</DialogTitle>
            <DialogDescription>
              Le niveau et l'année scolaire viennent de la classe : il n'y a rien
              à choisir ici.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="evaluation-title">Titre</Label>
              <Input
                id="evaluation-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Évaluation de fin de séquence"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="evaluation-date">Date</Label>
                <Input
                  id="evaluation-date"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="evaluation-trimester">Trimestre</Label>
                <Select
                  value={trimesterChoice}
                  onValueChange={setTrimesterChoice}
                >
                  <SelectTrigger id="evaluation-trimester">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">
                      {deduced
                        ? "Automatique (T" + deduced + ")"
                        : "Automatique"}
                    </SelectItem>
                    {TRIMESTERS.map((trimester) => (
                      <SelectItem key={trimester} value={String(trimester)}>
                        Trimestre {trimester} (forcé)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>
                Compétences évaluées ({competencyIds.length} sélectionnée
                {competencyIds.length > 1 ? "s" : ""})
              </Label>
              <CompetencyPicker
                selected={competencyIds}
                onChange={setCompetencyIds}
              />
              <p className="text-xs text-muted-foreground">
                Les compétences restent modifiables après la création.
              </p>
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Annuler
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "Création…" : "Créer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
        title="Supprimer l'évaluation"
        description={
          <>
            L'évaluation « {toDelete?.title} » du{" "}
            {toDelete ? formatDate(toDelete.date) : ""} sera supprimée, ainsi que
            toutes les notes qu'elle porte et sa fiche contrat. Cette action est
            définitive.
          </>
        }
        onConfirm={handleDelete}
      />
    </div>
  );
}
