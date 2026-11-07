import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Pencil, Plus, Trash2, Users } from "lucide-react";

import { DataState } from "@/components/DataState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { api } from "@/lib/api";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LEVEL_CODES, LEVEL_LABELS, schoolYearLabel } from "@/types";
import type { LevelCode, Session } from "@/types";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Année scolaire en cours. La bascule est faite au 1er août : une classe créée
 * fin août appartient déjà à l'année qui commence, une classe créée en mai
 * appartient toujours à celle qui se termine.
 */
function currentYearStart(): number {
  const now = new Date();
  return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

/**
 * Cinq années passées, l'année courante et deux à venir. `keep` force la
 * présence de l'année d'une classe existante : sans elle, modifier une classe
 * antérieure à la fenêtre afficherait un sélecteur vide et l'enregistrer la
 * déplacerait d'année à l'insu de l'enseignant.
 */
function yearOptions(keep?: number): number[] {
  const base = currentYearStart();
  const years = new Set<number>();
  for (let offset = -5; offset <= 2; offset += 1) years.add(base + offset);
  if (keep !== undefined) years.add(keep);
  return [...years].sort((a, b) => b - a);
}

interface SessionFormValues {
  name: string;
  levelCode: LevelCode;
  yearStart: number;
}

interface SessionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = création. */
  session: Session | null;
  onSubmit: (values: SessionFormValues) => Promise<void>;
}

function SessionFormDialog({
  open,
  onOpenChange,
  session,
  onSubmit,
}: SessionFormDialogProps) {
  const [name, setName] = useState(session?.name ?? "");
  const [levelCode, setLevelCode] = useState<LevelCode>(
    session?.level_code ?? "6eme",
  );
  const [yearStart, setYearStart] = useState(
    session?.year_start ?? currentYearStart(),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const years = useMemo(() => yearOptions(session?.year_start), [session]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Le nom de la classe est obligatoire.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ name: trimmed, levelCode, yearStart });
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {session ? "Modifier la classe" : "Nouvelle classe"}
          </DialogTitle>
          <DialogDescription>
            Le niveau et l'année scolaire servent aux évaluations et aux bilans.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="classe-nom">Nom de la classe</Label>
            <Input
              id="classe-nom"
              placeholder="Par exemple : 4ème SEGPA"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="classe-niveau">Niveau</Label>
              <Select
                value={levelCode}
                onValueChange={(value) => setLevelCode(value as LevelCode)}
              >
                <SelectTrigger id="classe-niveau">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEVEL_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {LEVEL_LABELS[code]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="classe-annee">Année scolaire</Label>
              <Select
                value={String(yearStart)}
                onValueChange={(value) => setYearStart(Number(value))}
              >
                <SelectTrigger id="classe-annee">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {years.map((year) => (
                    <SelectItem key={year} value={String(year)}>
                      {schoolYearLabel(year)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Annuler
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving
              ? "Enregistrement…"
              : session
                ? "Enregistrer"
                : "Créer la classe"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Sessions() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Le formulaire et la confirmation ne retiennent qu'un identifiant : la
  // classe est dérivée de la liste, donc un rechargement les rafraîchit.
  const [formTarget, setFormTarget] = useState<"new" | string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setSessions(await api.getSessions());
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const editing =
    formTarget && formTarget !== "new"
      ? (sessions.find((s) => s.id === formTarget) ?? null)
      : null;
  const formOpen = formTarget === "new" || editing !== null;
  const pendingDelete = deleteId
    ? (sessions.find((s) => s.id === deleteId) ?? null)
    : null;

  const groups = useMemo(() => {
    const byYear = new Map<number, Session[]>();
    for (const session of sessions) {
      const bucket = byYear.get(session.year_start);
      if (bucket) bucket.push(session);
      else byYear.set(session.year_start, [session]);
    }
    return [...byYear.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([yearStart, items]) => ({
        yearStart,
        items: [...items].sort((a, b) => a.name.localeCompare(b.name, "fr")),
      }));
  }, [sessions]);

  const handleSubmit = async (values: SessionFormValues) => {
    if (editing) {
      await api.updateSession(
        editing.id,
        values.name,
        values.levelCode,
        values.yearStart,
      );
    } else {
      await api.createSession(values.name, values.levelCode, values.yearStart);
    }
    await load();
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    // L'erreur n'est volontairement pas attrapée ici : ConfirmDialog l'affiche
    // dans le dialogue, qui reste ouvert. Un refus du backend explique quoi
    // faire, il doit rester sous les yeux de l'enseignant.
    await api.deleteSession(pendingDelete.id);
    await load();
  };

  const openDetail = (session: Session) => navigate(`/classes/${session.id}`);

  return (
    <div className="mx-auto max-w-7xl p-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Classes</h1>
          <p className="mt-1 text-muted-foreground">
            Vos classes, groupées par année scolaire.
          </p>
        </div>
        <Button onClick={() => setFormTarget("new")}>
          <Plus className="h-4 w-4" />
          Nouvelle classe
        </Button>
      </div>

      <DataState
        loading={loading}
        error={loadError}
        empty={sessions.length === 0}
        emptyLabel="Aucune classe pour l'instant. Créez-en une pour commencer."
        onRetry={() => void load()}
      >
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.yearStart}>
              <div className="mb-3 flex items-baseline gap-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  <CalendarDays className="h-4 w-4" />
                  {schoolYearLabel(group.yearStart)}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {group.items.length} classe
                  {group.items.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((session) => (
                  <Card
                    key={session.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Ouvrir la classe ${session.name}`}
                    className="cursor-pointer transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    onClick={() => openDetail(session)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openDetail(session);
                      }
                    }}
                  >
                    <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
                      <div className="min-w-0 space-y-2">
                        <CardTitle className="truncate text-lg">
                          {session.name}
                        </CardTitle>
                        <Badge variant="secondary">
                          {LEVEL_LABELS[session.level_code]}
                        </Badge>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`Modifier ${session.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setFormTarget(session.id);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          aria-label={`Supprimer ${session.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteId(session.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Users className="h-4 w-4" />
                        {session.student_count} élève
                        {session.student_count === 1 ? "" : "s"}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DataState>

      {formOpen && (
        // Monté seulement à l'ouverture, et `key` par classe : sans ça, passer
        // d'une classe à l'autre réutiliserait l'instance React et le brouillon
        // de la précédente serait enregistré sous le mauvais identifiant.
        <SessionFormDialog
          key={editing?.id ?? "new"}
          open
          onOpenChange={(open) => {
            if (!open) setFormTarget(null);
          }}
          session={editing}
          onSubmit={handleSubmit}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteId(null);
          }}
          title={`Supprimer la classe « ${pendingDelete.name} » ?`}
          description={
            <>
              Tout le contenu de la classe part avec elle : les{" "}
              {pendingDelete.student_count} élève
              {pendingDelete.student_count === 1 ? "" : "s"}, les séances et
              leurs appels, les cahiers de texte, les évaluations et leurs notes,
              ainsi que les bilans. Cette suppression est définitive.
            </>
          }
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
