import { useCallback, useEffect, useState } from "react";
import { Eye, LoaderCircle, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { schoolYearLabel } from "@/types";
import type { RecomputePreview, RecomputeResult } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface TrimesterBoundsDialogProps {
  yearStart: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved?: () => void;
}

interface BoundsForm {
  t1_start: string;
  t2_start: string;
  t3_start: string;
  year_end: string;
}

const EMPTY_FORM: BoundsForm = {
  t1_start: "",
  t2_start: "",
  t3_start: "",
  year_end: "",
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("fr-FR");
}

/** « 0 séance », « 1 séance », « 3 séances ». */
function count(n: number, singular: string, plural: string): string {
  return `${n} ${n > 1 ? plural : singular}`;
}

/** Les dates étant au format AAAA-MM-JJ, la comparaison de chaînes suffit. */
function validate(form: BoundsForm): string | null {
  if (!form.t1_start || !form.t2_start || !form.t3_start || !form.year_end) {
    return "Les quatre dates sont obligatoires.";
  }
  if (form.t1_start >= form.t2_start) {
    return "Le trimestre 2 doit commencer après le début du trimestre 1.";
  }
  if (form.t2_start >= form.t3_start) {
    return "Le trimestre 3 doit commencer après le début du trimestre 2.";
  }
  if (form.t3_start > form.year_end) {
    return "La fin de l'année ne peut pas précéder le début du trimestre 3.";
  }
  return null;
}

export function TrimesterBoundsDialog({
  yearStart,
  open,
  onOpenChange,
  onSaved,
}: TrimesterBoundsDialogProps) {
  const [form, setForm] = useState<BoundsForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RecomputePreview | null>(null);
  const [result, setResult] = useState<RecomputeResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPreview(null);
    setResult(null);
    api
      .getTrimesterBounds(yearStart)
      .then((b) => {
        if (cancelled) return;
        setForm({
          t1_start: b.t1_start,
          t2_start: b.t2_start,
          t3_start: b.t3_start,
          year_end: b.year_end,
        });
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, yearStart]);

  // Toute modification d'une date périme l'aperçu : appliquer un aperçu calculé
  // sur d'autres bornes déplacerait des séances que l'enseignant n'a pas vues.
  const setField = useCallback((field: keyof BoundsForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setPreview(null);
    setError(null);
  }, []);

  const handlePreview = async () => {
    const invalid = validate(form);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const p = await api.previewTrimesterRecompute(
        yearStart,
        form.t1_start,
        form.t2_start,
        form.t3_start,
        form.year_end,
      );
      setPreview(p);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleApply = async () => {
    const invalid = validate(form);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.updateTrimesterBounds(
        yearStart,
        form.t1_start,
        form.t2_start,
        form.t3_start,
        form.year_end,
      );
      setResult(r);
      setPreview(null);
      onSaved?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const fields: Array<{ key: keyof BoundsForm; label: string }> = [
    { key: "t1_start", label: "Début du trimestre 1" },
    { key: "t2_start", label: "Début du trimestre 2" },
    { key: "t3_start", label: "Début du trimestre 3" },
    { key: "year_end", label: "Fin de l'année scolaire" },
  ];

  const changing = preview
    ? preview.seances_changing + preview.evaluations_changing
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Bornes des trimestres — {schoolYearLabel(yearStart)}
          </DialogTitle>
          <DialogDescription>
            Ces dates déterminent le trimestre des séances et des évaluations
            dont le trimestre n'a pas été forcé à la main.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Chargement des bornes…
          </div>
        ) : result ? (
          <div className="space-y-4 py-2">
            <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">
              <p className="font-medium">Bornes enregistrées.</p>
              <p className="mt-1">
                {count(result.reclassed, "élément reclassé", "éléments reclassés")}
                {" — "}
                {count(
                  result.kept_manual,
                  "élément laissé au trimestre forcé",
                  "éléments laissés au trimestre forcé",
                )}
                .
              </p>
            </div>
            <div className="text-sm text-muted-foreground">
              Trimestre 1 : à partir du {formatDate(form.t1_start)} · Trimestre 2
              : à partir du {formatDate(form.t2_start)} · Trimestre 3 : à partir
              du {formatDate(form.t3_start)} · fin le {formatDate(form.year_end)}
              .
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={`bounds-${f.key}`}>{f.label}</Label>
                  <Input
                    id={`bounds-${f.key}`}
                    type="date"
                    value={form[f.key]}
                    onChange={(e) => setField(f.key, e.target.value)}
                  />
                </div>
              ))}
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {preview ? (
              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-medium">
                  {changing === 0
                    ? "Aucune séance ni évaluation ne changerait de trimestre."
                    : `${count(preview.seances_changing, "séance", "séances")} et ${count(
                        preview.evaluations_changing,
                        "évaluation",
                        "évaluations",
                      )} ${changing > 1 ? "changeraient" : "changerait"} de trimestre, ${count(
                        preview.kept_manual,
                        "resterait",
                        "resteraient",
                      )} au trimestre forcé.`}
                </p>
                {preview.samples.length > 0 && (
                  <ul className="max-h-40 space-y-1 overflow-y-auto pl-4 text-xs">
                    {preview.samples.map((s, i) => (
                      <li key={i} className="list-disc">
                        {s}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs">
                  Rien n'est encore enregistré. Cliquez sur « Appliquer » pour
                  confirmer ce changement.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Lancez d'abord un aperçu : modifier ces dates peut déplacer des
                séances et des évaluations déjà saisies.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Fermer</Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                Annuler
              </Button>
              <Button
                variant="secondary"
                onClick={handlePreview}
                disabled={busy || loading}
              >
                {busy && !preview ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
                Aperçu
              </Button>
              <Button onClick={handleApply} disabled={busy || loading || !preview}>
                Appliquer
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
