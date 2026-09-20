import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";

import { DataState } from "@/components/DataState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useDraftGuard } from "@/hooks/useDrafts";
import { api } from "@/lib/api";
import type {
  ContractRow,
  ContractSheet,
  ContractSheetInput,
  ProfessionalField,
} from "@/types";

export interface ContractSheetEditorProps {
  evaluationId: string;
  /** Facultatif : rappelé sous le titre quand l'écran parent ne l'affiche pas. */
  evaluationTitle?: string;
  /** Facultatif : la flèche de retour n'est rendue que s'il est fourni. */
  onBack?: () => void;
}

/** Tout sauf les lignes, qui vivent dans leur propre état. */
type SheetHeader = Omit<ContractSheetInput, "rows">;

type RowTextField =
  | "student_activity"
  | "training_activity"
  | "socle_domain_label"
  | "socle_competency_label";

interface DraftRow extends ContractRow {
  /** Clé React locale : `id` reste nul tant que la ligne n'a pas été enregistrée. */
  key: string;
}

const EMPTY_HEADER: SheetHeader = {
  project_title: "",
  professional_field_id: null,
  professional_field_label: "",
  socle_domain: "",
  reference_activities: "",
  target_careers: "",
  given_text: "",
  asked_text: "",
  required_text: "",
};

// Radix refuse une valeur vide sur un SelectItem : d'où ces sentinelles pour
// « aucun champ » et pour un libellé dont le champ a été supprimé du référentiel.
const NO_FIELD = "__aucun__";
const ORPHAN_FIELD = "__conserve__";

let rowKeyCounter = 0;
const nextRowKey = () => `ligne-${++rowKeyCounter}`;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function headerOf(sheet: ContractSheet): SheetHeader {
  return {
    project_title: sheet.project_title,
    professional_field_id: sheet.professional_field_id,
    professional_field_label: sheet.professional_field_label,
    socle_domain: sheet.socle_domain,
    reference_activities: sheet.reference_activities,
    target_careers: sheet.target_careers,
    given_text: sheet.given_text,
    asked_text: sheet.asked_text,
    required_text: sheet.required_text,
  };
}

function draftRowsOf(rows: ContractRow[]): DraftRow[] {
  return [...rows]
    .sort((a, b) => a.position - b.position)
    .map((row) => ({ ...row, key: row.id ?? nextRowKey() }));
}

/** La position envoyée est toujours l'index affiché : ni trou, ni doublon. */
function toPayloadRows(rows: DraftRow[]): ContractRow[] {
  return rows.map((row, index) => ({
    id: row.id,
    position: index,
    student_activity: row.student_activity,
    training_activity: row.training_activity,
    socle_domain_label: row.socle_domain_label,
    socle_competency_label: row.socle_competency_label,
  }));
}

export function ContractSheetEditor({
  evaluationId,
  evaluationTitle,
  onBack,
}: ContractSheetEditorProps) {
  const [header, setHeader] = useState<SheetHeader>(EMPTY_HEADER);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [fields, setFields] = useState<ProfessionalField[]>([]);
  const [sheetExists, setSheetExists] = useState(false);

  const [baseline, setBaseline] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const [newFieldName, setNewFieldName] = useState("");
  const [creatingField, setCreatingField] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [sheet, professionalFields] = await Promise.all([
        api.getContractSheet(evaluationId),
        api.getProfessionalFields(),
      ]);
      const nextHeader = sheet ? headerOf(sheet) : EMPTY_HEADER;
      const nextRows = sheet ? draftRowsOf(sheet.rows) : [];
      setFields(professionalFields);
      setHeader(nextHeader);
      setRows(nextRows);
      setSheetExists(sheet !== null);
      setBaseline(
        JSON.stringify({ header: nextHeader, rows: toPayloadRows(nextRows) }),
      );
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [evaluationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!justSaved) return;
    const timer = window.setTimeout(() => setJustSaved(false), 3000);
    return () => window.clearTimeout(timer);
  }, [justSaved]);

  const snapshot = useMemo(
    () => JSON.stringify({ header, rows: toPayloadRows(rows) }),
    [header, rows],
  );
  const dirty = baseline !== "" && snapshot !== baseline;

  const patchHeader = (partial: Partial<SheetHeader>) =>
    setHeader((current) => ({ ...current, ...partial }));

  // ---- Champ professionnel ----

  const fieldOptions = useMemo(() => {
    const options = fields.map((field) => ({
      value: field.id,
      label: field.name,
    }));
    const id = header.professional_field_id;
    if (id && !fields.some((field) => field.id === id)) {
      options.push({
        value: id,
        label: `${header.professional_field_label || "Champ inconnu"} (hors liste)`,
      });
    } else if (!id && header.professional_field_label) {
      // Le backend met l'identifiant à NULL quand le champ est supprimé mais
      // conserve le libellé : on le laisse sélectionné pour ne pas l'effacer
      // au prochain enregistrement.
      options.push({
        value: ORPHAN_FIELD,
        label: `${header.professional_field_label} (supprimé du référentiel)`,
      });
    }
    return options;
  }, [fields, header.professional_field_id, header.professional_field_label]);

  const selectedFieldValue =
    header.professional_field_id ??
    (header.professional_field_label ? ORPHAN_FIELD : NO_FIELD);

  const handleFieldChange = (value: string) => {
    if (value === ORPHAN_FIELD) return;
    if (value === NO_FIELD) {
      patchHeader({ professional_field_id: null, professional_field_label: "" });
      return;
    }
    const field = fields.find((candidate) => candidate.id === value);
    patchHeader({
      professional_field_id: value,
      professional_field_label: field
        ? field.name
        : header.professional_field_label,
    });
  };

  const handleCreateField = async () => {
    const name = newFieldName.trim();
    if (!name || creatingField) return;
    setCreatingField(true);
    setFieldError(null);
    try {
      const created = await api.createProfessionalField(name);
      setFields((current) =>
        [...current, created].sort(
          (a, b) =>
            a.position - b.position || a.name.localeCompare(b.name, "fr"),
        ),
      );
      patchHeader({
        professional_field_id: created.id,
        professional_field_label: created.name,
      });
      setNewFieldName("");
    } catch (err) {
      setFieldError(errorMessage(err));
    } finally {
      setCreatingField(false);
    }
  };

  // ---- Lignes d'activités ----

  const addRow = () =>
    setRows((current) => [
      ...current,
      {
        id: null,
        position: current.length,
        student_activity: "",
        training_activity: "",
        socle_domain_label: "",
        socle_competency_label: "",
        key: nextRowKey(),
      },
    ]);

  const removeRow = (key: string) =>
    setRows((current) => current.filter((row) => row.key !== key));

  const moveRow = (index: number, delta: number) =>
    setRows((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const updateRow = (key: string, field: RowTextField, value: string) =>
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const next: DraftRow = { ...row };
        next[field] = value;
        return next;
      }),
    );

  // ---- Enregistrement ----

  /** Enregistre et laisse remonter l'échec : le registre des brouillons doit
   *  savoir si la fiche est réellement partie. */
  const persist = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await api.saveContractSheet(evaluationId, {
        ...header,
        rows: toPayloadRows(rows),
      });
      // On réadopte la fiche relue par le backend : sans ses identifiants de
      // lignes, l'enregistrement suivant réinsérerait les lignes créées ici au
      // lieu de les mettre à jour.
      const nextHeader = headerOf(saved);
      const nextRows = draftRowsOf(saved.rows);
      setHeader(nextHeader);
      setRows(nextRows);
      setSheetExists(true);
      setBaseline(
        JSON.stringify({ header: nextHeader, rows: toPayloadRows(nextRows) }),
      );
      setJustSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    try {
      await persist();
    } catch (err) {
      setSaveError(errorMessage(err));
    }
  };

  // Le badge « Modifications non enregistrées » dit déjà que la fiche est sale :
  // c'est exactement la condition d'inscription au registre des brouillons.
  useDraftGuard(`fiche-contrat:${evaluationId}`, dirty, {
    label: evaluationTitle
      ? `Fiche contrat — ${evaluationTitle}`
      : "Fiche contrat",
    flush: persist,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {onBack && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              aria-label="Retour"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div>
            <h3 className="text-lg font-semibold">Fiche contrat</h3>
            {evaluationTitle && (
              <p className="text-sm text-muted-foreground">{evaluationTitle}</p>
            )}
          </div>
        </div>

        {!loading && !loadError && (
          <div className="flex items-center gap-3">
            {dirty ? (
              <Badge
                variant="outline"
                className="border-amber-300 bg-amber-50 text-amber-800"
              >
                Modifications non enregistrées
              </Badge>
            ) : justSaved ? (
              <span className="text-sm text-green-700">Fiche enregistrée</span>
            ) : null}
            <Button
              onClick={() => void handleSave()}
              disabled={saving || !dirty}
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        )}
      </div>

      <DataState loading={loading} error={loadError} onRetry={() => void load()}>
        <div className="space-y-4">
          {saveError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              L'enregistrement a échoué : {saveError}
            </div>
          )}

          {!sheetExists && (
            <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              Aucune fiche contrat n'est encore enregistrée pour cette
              évaluation. Elle sera créée au premier enregistrement.
            </p>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Informations générales</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="fiche-titre">Titre du projet</Label>
                  <Input
                    id="fiche-titre"
                    value={header.project_title}
                    onChange={(e) =>
                      patchHeader({ project_title: e.target.value })
                    }
                    placeholder="Ex. : réalisation d'un objet technique"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fiche-champ-pro">Champ professionnel</Label>
                  <Select
                    value={selectedFieldValue}
                    onValueChange={handleFieldChange}
                  >
                    <SelectTrigger id="fiche-champ-pro">
                      <SelectValue placeholder="Sélectionner un champ…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_FIELD}>Aucun</SelectItem>
                      {fieldOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {fields.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Aucun champ professionnel n'est enregistré. Saisissez-en un
                      ci-dessous pour l'ajouter à la liste.
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Input
                      id="fiche-nouveau-champ"
                      value={newFieldName}
                      onChange={(e) => setNewFieldName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        void handleCreateField();
                      }}
                      placeholder="Nouveau champ professionnel…"
                      className="h-8 text-xs"
                      aria-label="Nouveau champ professionnel"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => void handleCreateField()}
                      disabled={creatingField || newFieldName.trim() === ""}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Créer
                    </Button>
                  </div>
                  {fieldError && (
                    <p className="text-xs text-destructive">{fieldError}</p>
                  )}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="fiche-socle">Domaine du socle</Label>
                  <Input
                    id="fiche-socle"
                    value={header.socle_domain}
                    onChange={(e) =>
                      patchHeader({ socle_domain: e.target.value })
                    }
                    placeholder="Ex. : domaine 4 — systèmes naturels et techniques"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fiche-metiers">Métiers visés</Label>
                  <Input
                    id="fiche-metiers"
                    value={header.target_careers}
                    onChange={(e) =>
                      patchHeader({ target_careers: e.target.value })
                    }
                    placeholder="Ex. : électricien, plombier…"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="fiche-activites-ref">
                  Activités de référence
                </Label>
                <Textarea
                  id="fiche-activites-ref"
                  className="min-h-[70px] text-sm"
                  value={header.reference_activities}
                  onChange={(e) =>
                    patchHeader({ reference_activities: e.target.value })
                  }
                  placeholder="Activités de référence du champ professionnel…"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Consignes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label
                  htmlFor="fiche-donne"
                  className="font-semibold text-green-700"
                >
                  On donne
                </Label>
                <Textarea
                  id="fiche-donne"
                  className="min-h-[60px] border-green-200 text-sm"
                  value={header.given_text}
                  onChange={(e) => patchHeader({ given_text: e.target.value })}
                  placeholder="Ce qui est fourni à l'élève…"
                />
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="fiche-demande"
                  className="font-semibold text-blue-700"
                >
                  On demande
                </Label>
                <Textarea
                  id="fiche-demande"
                  className="min-h-[60px] border-blue-200 text-sm"
                  value={header.asked_text}
                  onChange={(e) => patchHeader({ asked_text: e.target.value })}
                  placeholder="Ce qui est demandé à l'élève…"
                />
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="fiche-exige"
                  className="font-semibold text-red-700"
                >
                  On exige
                </Label>
                <Textarea
                  id="fiche-exige"
                  className="min-h-[60px] border-red-200 text-sm"
                  value={header.required_text}
                  onChange={(e) =>
                    patchHeader({ required_text: e.target.value })
                  }
                  placeholder="Ce qui est exigé pour valider…"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">
                Activités ({rows.length})
              </CardTitle>
              <Button size="sm" variant="outline" onClick={addRow}>
                <Plus className="mr-1 h-4 w-4" />
                Ajouter une ligne
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {rows.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Aucune activité pour l'instant. Cliquez sur « Ajouter une ligne
                  » pour commencer.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10 text-center">#</TableHead>
                        <TableHead className="min-w-[200px]">
                          Activité de l'élève
                        </TableHead>
                        <TableHead className="min-w-[200px]">
                          Activité de formation
                        </TableHead>
                        <TableHead className="min-w-[160px]">
                          Domaine du socle
                        </TableHead>
                        <TableHead className="min-w-[160px]">
                          Compétence du socle
                        </TableHead>
                        <TableHead className="w-28 text-right">
                          Actions
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row, index) => (
                        <TableRow key={row.key}>
                          <TableCell className="text-center text-xs text-muted-foreground">
                            {index + 1}
                          </TableCell>
                          <TableCell className="p-1">
                            <Textarea
                              className="min-h-[56px] resize-y p-1.5 text-xs"
                              value={row.student_activity}
                              onChange={(e) =>
                                updateRow(
                                  row.key,
                                  "student_activity",
                                  e.target.value,
                                )
                              }
                              aria-label={`Activité de l'élève, ligne ${index + 1}`}
                            />
                          </TableCell>
                          <TableCell className="p-1">
                            <Textarea
                              className="min-h-[56px] resize-y p-1.5 text-xs"
                              value={row.training_activity}
                              onChange={(e) =>
                                updateRow(
                                  row.key,
                                  "training_activity",
                                  e.target.value,
                                )
                              }
                              aria-label={`Activité de formation, ligne ${index + 1}`}
                            />
                          </TableCell>
                          <TableCell className="p-1">
                            <Textarea
                              className="min-h-[56px] resize-y p-1.5 text-xs"
                              value={row.socle_domain_label}
                              onChange={(e) =>
                                updateRow(
                                  row.key,
                                  "socle_domain_label",
                                  e.target.value,
                                )
                              }
                              aria-label={`Domaine du socle, ligne ${index + 1}`}
                            />
                          </TableCell>
                          <TableCell className="p-1">
                            <Textarea
                              className="min-h-[56px] resize-y p-1.5 text-xs"
                              value={row.socle_competency_label}
                              onChange={(e) =>
                                updateRow(
                                  row.key,
                                  "socle_competency_label",
                                  e.target.value,
                                )
                              }
                              aria-label={`Compétence du socle, ligne ${index + 1}`}
                            />
                          </TableCell>
                          <TableCell className="p-1">
                            <div className="flex items-center justify-end gap-0.5">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={index === 0}
                                onClick={() => moveRow(index, -1)}
                                aria-label="Monter la ligne"
                              >
                                <ChevronUp className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={index === rows.length - 1}
                                onClick={() => moveRow(index, 1)}
                                aria-label="Descendre la ligne"
                              >
                                <ChevronDown className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => removeRow(row.key)}
                                aria-label="Supprimer la ligne"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Les lignes supprimées ici ne le sont dans la base qu'au prochain
            enregistrement.
          </p>
        </div>
      </DataState>
    </div>
  );
}
