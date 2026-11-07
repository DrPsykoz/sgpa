import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  Plus,
  Save,
  Trash2,
  Wand2,
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
import {
  exportContractSheetPDF,
  socleMergeKey,
  type ContractSheetContext,
} from "@/lib/pdf";
import type {
  CompetencyInfo,
  ContractRequirement,
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

/** Tout sauf les deux tableaux, qui vivent dans leur propre état. */
type SheetHeader = Omit<ContractSheetInput, "rows" | "requirements">;

type RowTextField =
  | "student_activity"
  | "training_activity"
  | "socle_domain_label"
  | "socle_competency_label"
  | "required_text";

type RequirementField = "given_text" | "asked_text" | "required_text";

interface DraftRow extends ContractRow {
  /** Clé React locale : `id` reste nul tant que la ligne n'a pas été enregistrée. */
  key: string;
}

interface DraftRequirement extends ContractRequirement {
  key: string;
}

/** Un bloc du socle : les activités consécutives qui s'imprimeront sous une
 *  seule cellule fusionnée.
 *
 *  C'est l'unité de la fiche, et c'était le défaut de la première version de
 *  cet écran : une grille de six colonnes où la compétence se répétait à chaque
 *  ligne, avec un avertissement en orange pour signaler la fusion. L'éditeur
 *  expliquait un regroupement au lieu de le montrer — et il fallait faire
 *  défiler horizontalement pour voir la colonne des actions. */
interface DraftBlock {
  /** Clé React : celle de sa première ligne, stable tant que le bloc existe. */
  key: string;
  /** La clé de fusion du PDF. `null` = ce bloc ne peut pas en accueillir
   *  d'autres : son socle est vide, donc chaque activité imprimerait sa propre
   *  cellule. */
  mergeKey: string | null;
  competencyId: string | null;
  domainLabel: string;
  competencyLabel: string;
  /** Index de sa première ligne dans la liste plate — les lignes d'un bloc y
   *  sont contiguës, ce qui suffit à le déplacer d'un seul tenant. */
  start: number;
  rows: DraftRow[];
}

/** Découpe la liste plate en blocs, avec `socleMergeKey` — LA fonction du PDF.
 *
 *  Pas une seconde règle écrite ici : ce que l'écran montre comme un bloc est
 *  alors, par construction, ce que l'impression fusionne. */
function groupBlocks(rows: DraftRow[]): DraftBlock[] {
  const blocks: DraftBlock[] = [];
  rows.forEach((row, index) => {
    const mergeKey = socleMergeKey(row);
    const last = blocks[blocks.length - 1];
    if (last !== undefined && mergeKey !== null && mergeKey === last.mergeKey) {
      last.rows.push(row);
      return;
    }
    blocks.push({
      key: row.key,
      mergeKey,
      competencyId: row.competency_id,
      domainLabel: row.socle_domain_label,
      competencyLabel: row.socle_competency_label,
      start: index,
      rows: [row],
    });
  });
  return blocks;
}

const EMPTY_HEADER: SheetHeader = {
  project_title: "",
  professional_field_id: null,
  professional_field_label: "",
  professional_subset: "",
  reference_activities: "",
  target_careers: "",
};

// Radix refuse une valeur vide sur un SelectItem : d'où ces sentinelles pour
// « aucun champ » et pour un libellé dont le champ a été supprimé du référentiel.
const NO_FIELD = "__aucun__";
const ORPHAN_FIELD = "__conserve__";
/** Ligne dont le socle est saisi à la main, sans lien vers le référentiel. */
const FREE_TEXT = "__libre__";

let localKeyCounter = 0;
const nextKey = () => `l-${++localKeyCounter}`;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function headerOf(sheet: ContractSheet): SheetHeader {
  return {
    project_title: sheet.project_title,
    professional_field_id: sheet.professional_field_id,
    professional_field_label: sheet.professional_field_label,
    professional_subset: sheet.professional_subset,
    reference_activities: sheet.reference_activities,
    target_careers: sheet.target_careers,
  };
}

function draftRowsOf(rows: ContractRow[]): DraftRow[] {
  return [...rows]
    .sort((a, b) => a.position - b.position)
    .map((row) => ({ ...row, key: row.id ?? nextKey() }));
}

function draftRequirementsOf(
  lines: ContractRequirement[],
): DraftRequirement[] {
  return [...lines]
    .sort((a, b) => a.position - b.position)
    .map((line) => ({ ...line, key: line.id ?? nextKey() }));
}

/** La position envoyée est toujours l'index affiché : ni trou, ni doublon. */
function toPayloadRows(rows: DraftRow[]): ContractRow[] {
  return rows.map((row, index) => ({
    id: row.id,
    position: index,
    student_activity: row.student_activity,
    training_activity: row.training_activity,
    competency_id: row.competency_id,
    socle_domain_label: row.socle_domain_label,
    socle_competency_label: row.socle_competency_label,
    required_text: row.required_text,
  }));
}

function toPayloadRequirements(
  lines: DraftRequirement[],
): ContractRequirement[] {
  return lines.map((line, index) => ({
    id: line.id,
    position: index,
    given_text: line.given_text,
    asked_text: line.asked_text,
    required_text: line.required_text,
  }));
}

function competencyOptionLabel(competency: CompetencyInfo): string {
  const suffix = competency.archived ? " (archivée)" : "";
  const reference = competency.socle_reference || competency.domain_name;
  return `${reference} — ${competency.name}${suffix}`;
}

export function ContractSheetEditor({
  evaluationId,
  evaluationTitle,
  onBack,
}: ContractSheetEditorProps) {
  const [header, setHeader] = useState<SheetHeader>(EMPTY_HEADER);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [requirements, setRequirements] = useState<DraftRequirement[]>([]);
  const [fields, setFields] = useState<ProfessionalField[]>([]);
  const [sheetExists, setSheetExists] = useState(false);

  /** Proposition composée par le backend depuis l'évaluation. Elle n'écrit
   *  rien : c'est de la matière pour le bouton « Composer », et c'est aussi
   *  d'où viennent la classe et l'année imprimées en tête du PDF. */
  const [suggestion, setSuggestion] = useState<ContractRow[]>([]);
  const [context, setContext] = useState<ContractSheetContext | null>(null);
  const [schoolName, setSchoolName] = useState("");

  const [baseline, setBaseline] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [openAfterExport, setOpenAfterExport] = useState(false);

  const [newFieldName, setNewFieldName] = useState("");
  const [creatingField, setCreatingField] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [sheet, professionalFields, proposal, settings] = await Promise.all([
        api.getContractSheet(evaluationId),
        api.getProfessionalFields(),
        api.suggestContractSheet(evaluationId),
        api.getSettings(),
      ]);
      const nextHeader = sheet ? headerOf(sheet) : EMPTY_HEADER;
      const nextRows = sheet ? draftRowsOf(sheet.rows) : [];
      const nextRequirements = sheet
        ? draftRequirementsOf(sheet.requirements)
        : [];
      setFields(professionalFields);
      setHeader(nextHeader);
      setRows(nextRows);
      setRequirements(nextRequirements);
      setSheetExists(sheet !== null);
      setSuggestion(proposal.rows);
      setContext({
        session_name: proposal.session_name,
        level_code: proposal.level_code,
        year_start: proposal.year_start,
        evaluation_title: proposal.project_title,
      });
      setSchoolName(settings.school_name);
      setBaseline(
        JSON.stringify({
          header: nextHeader,
          rows: toPayloadRows(nextRows),
          requirements: toPayloadRequirements(nextRequirements),
        }),
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
    () =>
      JSON.stringify({
        header,
        rows: toPayloadRows(rows),
        requirements: toPayloadRequirements(requirements),
      }),
    [header, rows, requirements],
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

  // ---- Composition depuis l'évaluation ----

  /** Compétences de l'évaluation, telles que la proposition les a rangées :
   *  dans l'ordre où l'enseignant les a cochées, pas dans celui du décret.
   *
   *  La proposition ne porte que des libellés, pas l'arbre du référentiel :
   *  `socle_domain_label` y est déjà le libellé composé par le backend, donc il
   *  va dans `socle_reference` et non dans `domain_name`, qui est le nom nu. */
  const competencyChoices = useMemo<CompetencyInfo[]>(
    () =>
      suggestion.flatMap((row) =>
        row.competency_id
          ? [
              {
                id: row.competency_id,
                name: row.socle_competency_label,
                field_name: "",
                domain_name: "",
                cycle_name: "",
                socle_reference: row.socle_domain_label,
                archived: false,
              },
            ]
          : [],
      ),
    [suggestion],
  );

  const linkedIds = useMemo(
    () =>
      new Set(
        rows.flatMap((row) => (row.competency_id ? [row.competency_id] : [])),
      ),
    [rows],
  );

  const missingFromSheet = useMemo(
    () =>
      suggestion.filter(
        (row) => row.competency_id && !linkedIds.has(row.competency_id),
      ),
    [suggestion, linkedIds],
  );

  /** Verse dans la fiche les compétences de l'évaluation qui n'y sont pas
   *  encore, une ligne chacune.
   *
   *  Volontairement un clic, et non un pré-remplissage à l'ouverture : la fiche
   *  se serait affichée « modifiée » sans que personne n'ait rien touché, et
   *  consulter une évaluation aurait suffi à fabriquer une fiche vide. */
  const composeFromEvaluation = () => {
    if (missingFromSheet.length === 0) return;
    setRows((current) => [
      ...current,
      ...missingFromSheet.map((row, offset) => ({
        ...row,
        id: null,
        position: current.length + offset,
        key: nextKey(),
      })),
    ]);
    if (header.project_title.trim() === "" && context) {
      patchHeader({ project_title: context.evaluation_title });
    }
  };

  /** Les blocs, redérivés à chaque rendu depuis `rows`, qui reste la seule
   *  source de vérité : aucun état de regroupement à maintenir en parallèle,
   *  donc rien qui puisse se désynchroniser de ce qui sera enregistré. */
  const blocks = useMemo(() => groupBlocks(rows), [rows]);

  // ---- Lignes d'activités ----

  const addRow = () =>
    setRows((current) => [
      ...current,
      {
        id: null,
        position: current.length,
        student_activity: "",
        training_activity: "",
        competency_id: null,
        socle_domain_label: "",
        socle_competency_label: "",
        required_text: "",
        key: nextKey(),
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

  // ---- Blocs du socle ----
  //
  // Un bloc n'existe pas en base : c'est une suite de lignes contiguës. Toutes
  // les opérations ci-dessous se ramènent donc à des écritures sur la liste
  // plate, et le backend ne change pas d'un octet.

  /** Les lignes d'un bloc, par leurs clés, pour l'écriture groupée. */
  const blockRowKeys = (current: DraftRow[], blockKey: string) => {
    const block = groupBlocks(current).find(
      (candidate) => candidate.key === blockKey,
    );
    return block === undefined
      ? null
      : { block, keys: new Set(block.rows.map((row) => row.key)) };
  };

  /** Rattache un bloc à une compétence du référentiel.
   *
   *  Choisir une compétence écrase les deux libellés : c'est un choix explicite
   *  de l'enseignant. Choisir « texte libre » ne coupe que le lien et **garde**
   *  le texte — sinon un clic de trop effacerait une formulation écrite à la
   *  main, que rien ne pourrait rendre.
   *
   *  Écrit sur TOUTES les lignes du bloc : ne toucher que la première le
   *  scinderait, et la fiche imprimerait une cellule par activité. */
  const linkBlock = (blockKey: string, value: string) =>
    setRows((current) => {
      const found = blockRowKeys(current, blockKey);
      if (found === null) return current;
      const competency =
        value === FREE_TEXT
          ? undefined
          : competencyChoices.find((candidate) => candidate.id === value);
      return current.map((row) => {
        if (!found.keys.has(row.key)) return row;
        if (value === FREE_TEXT) return { ...row, competency_id: null };
        if (competency === undefined) return { ...row, competency_id: value };
        return {
          ...row,
          competency_id: value,
          socle_domain_label: competency.socle_reference,
          socle_competency_label: competency.name,
        };
      });
    });

  /** Un libellé saisi à la main, écrit sur tout le bloc — même raison que
   *  ci-dessus : c'est le couple de libellés qui tient le bloc ensemble quand
   *  aucune compétence ne le fait. */
  const updateBlockLabel = (
    blockKey: string,
    field: RowTextField,
    value: string,
  ) =>
    setRows((current) => {
      const found = blockRowKeys(current, blockKey);
      if (found === null) return current;
      return current.map((row) => {
        if (!found.keys.has(row.key)) return row;
        const next: DraftRow = { ...row };
        next[field] = value;
        return next;
      });
    });

  /** Ajoute une activité au bloc : même socle, textes vides.
   *
   *  Insérée à la suite de la dernière ligne du bloc, et pas à la fin de la
   *  fiche : elle doit rester contiguë, sinon elle n'appartient plus au bloc et
   *  la cellule du socle se dédouble. */
  const addLineToBlock = (blockKey: string) =>
    setRows((current) => {
      const found = blockRowKeys(current, blockKey);
      if (found === null) return current;
      const { block } = found;
      const at = block.start + block.rows.length;
      const line: DraftRow = {
        id: null,
        position: at,
        student_activity: "",
        training_activity: "",
        competency_id: block.competencyId,
        socle_domain_label: block.domainLabel,
        socle_competency_label: block.competencyLabel,
        required_text: "",
        key: nextKey(),
      };
      return [...current.slice(0, at), line, ...current.slice(at)];
    });

  const removeBlock = (blockKey: string) =>
    setRows((current) => {
      const found = blockRowKeys(current, blockKey);
      if (found === null) return current;
      return current.filter((row) => !found.keys.has(row.key));
    });

  /** Déplace un bloc entier. Deux blocs voisins sont deux tranches contiguës de
   *  la liste : les réécrire en ordre inverse suffit, et les positions sont de
   *  toute façon renumérotées à l'enregistrement. */
  const moveBlock = (blockIndex: number, delta: number) =>
    setRows((current) => {
      const all = groupBlocks(current);
      const target = blockIndex + delta;
      if (target < 0 || target >= all.length) return current;
      const first = all[Math.min(blockIndex, target)];
      const second = all[Math.max(blockIndex, target)];
      return [
        ...current.slice(0, first.start),
        ...second.rows,
        ...first.rows,
        ...current.slice(second.start + second.rows.length),
      ];
    });

  // ---- Consignes : on donne / on demande / on exige ----

  const addRequirement = () =>
    setRequirements((current) => [
      ...current,
      {
        id: null,
        position: current.length,
        given_text: "",
        asked_text: "",
        required_text: "",
        key: nextKey(),
      },
    ]);

  const removeRequirement = (key: string) =>
    setRequirements((current) => current.filter((line) => line.key !== key));

  const moveRequirement = (index: number, delta: number) =>
    setRequirements((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const updateRequirement = (
    key: string,
    field: RequirementField,
    value: string,
  ) =>
    setRequirements((current) =>
      current.map((line) =>
        line.key === key ? { ...line, [field]: value } : line,
      ),
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
        requirements: toPayloadRequirements(requirements),
      });
      // On réadopte la fiche relue par le backend : sans ses identifiants de
      // lignes, l'enregistrement suivant réinsérerait les lignes créées ici au
      // lieu de les mettre à jour.
      const nextHeader = headerOf(saved);
      const nextRows = draftRowsOf(saved.rows);
      const nextRequirements = draftRequirementsOf(saved.requirements);
      setHeader(nextHeader);
      setRows(nextRows);
      setRequirements(nextRequirements);
      setSheetExists(true);
      setBaseline(
        JSON.stringify({
          header: nextHeader,
          rows: toPayloadRows(nextRows),
          requirements: toPayloadRequirements(nextRequirements),
        }),
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

  // ---- Export PDF ----

  /** Exporte ce qui est à l'écran, enregistré ou non : le PDF est une copie de
   *  la fiche telle qu'elle se lit, et le badge « modifications non
   *  enregistrées » reste affiché à côté du bouton. */
  const handleExport = async () => {
    if (!context || exporting) return;
    setExporting(true);
    setExportError(null);
    setExportNotice(null);
    try {
      const path = await exportContractSheetPDF(
        {
          ...header,
          rows: toPayloadRows(rows),
          requirements: toPayloadRequirements(requirements),
        },
        context,
        schoolName,
        openAfterExport,
      );
      setExportNotice(`Fiche enregistrée : ${path}`);
    } catch (err) {
      setExportError(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const nothingToPrint =
    rows.length === 0 &&
    requirements.length === 0 &&
    header.project_title.trim() === "";

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
          <div className="flex flex-wrap items-center gap-3">
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
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={openAfterExport}
                onChange={(event) => setOpenAfterExport(event.target.checked)}
                disabled={exporting}
              />
              Ouvrir le PDF après l'export
            </label>
            <Button
              variant="outline"
              onClick={() => void handleExport()}
              disabled={exporting || nothingToPrint || context === null}
            >
              {exporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {exporting ? "Export en cours…" : "Exporter en PDF"}
            </Button>
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

          {exportError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              L'export PDF a échoué : {exportError}
            </div>
          )}

          {exportNotice && !exportError && (
            <p className="break-all rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
              {exportNotice}
            </p>
          )}

          {/* Les deux documents sortent du même tableau : c'est la règle que le
              palier 010 a posée dans le schéma, et « on exige » n'existe que
              pour le second. Sans ce rappel, le champ se remplit sans qu'on
              sache où il s'imprime. */}
          <p className="text-sm text-muted-foreground">
            La fiche d'évaluation du même projet — une page par élève, avec « on
            exige » et les cinq niveaux de maîtrise à cocher — se télécharge
            depuis l'onglet « Fiche d'évaluation », à côté de celui-ci.
          </p>

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
                  <Label htmlFor="fiche-sous-ensemble">
                    Sous-ensemble du champ
                  </Label>
                  <Input
                    id="fiche-sous-ensemble"
                    value={header.professional_subset}
                    onChange={(e) =>
                      patchHeader({ professional_subset: e.target.value })
                    }
                    placeholder="Ex. : aménagement, agencement, finition"
                  />
                  {/* L'en-tête « domaine du socle » du classeur d'origine
                      désignait en réalité cette subdivision du champ : les
                      domaines du socle sont dans les lignes, pas ici. */}
                  <p className="text-xs text-muted-foreground">
                    Subdivision du champ professionnel. Les domaines du socle se
                    saisissent ligne par ligne, dans le tableau ci-dessous.
                  </p>
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
            <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-2 pb-3">
              <div className="space-y-0.5">
                <CardTitle className="text-base">
                  Activités et socle commun
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {rows.length === 0
                    ? "Un bloc du socle par cellule fusionnée à l'impression."
                    : `${blocks.length} bloc${blocks.length > 1 ? "s" : ""} du socle · ${rows.length} activité${rows.length > 1 ? "s" : ""}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={composeFromEvaluation}
                  disabled={missingFromSheet.length === 0}
                >
                  <Wand2 className="mr-1 h-4 w-4" />
                  {rows.length === 0
                    ? "Composer depuis l'évaluation"
                    : `Compléter (${missingFromSheet.length})`}
                </Button>
                <Button size="sm" variant="outline" onClick={addRow}>
                  <Plus className="mr-1 h-4 w-4" />
                  Ajouter un bloc
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {competencyChoices.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Aucune compétence n'est rattachée à cette évaluation : la fiche
                  ne peut pas être composée automatiquement. Cochez des
                  compétences dans l'onglet « Compétences évaluées », ou
                  saisissez le socle à la main.
                </p>
              )}
              {blocks.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Aucune activité pour l'instant.
                </p>
              ) : (
                blocks.map((block, blockIndex) => (
                  <section
                    key={block.key}
                    className="rounded-lg border bg-card shadow-sm"
                    aria-label={`Bloc du socle ${blockIndex + 1}`}
                  >
                    {/* L'en-tête porte le socle UNE fois pour tout le bloc, et
                        c'est lui qui sépare : bandeau plein, intitulé « BLOC N »,
                        filet net en dessous. Les activités, elles, n'ont plus de
                        cadre à elles — un cadre dans un cadre se perdait, et
                        avec beaucoup de lignes on ne voyait plus où un bloc
                        finissait. */}
                    <header className="space-y-1.5 rounded-t-lg border-b bg-muted px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold uppercase tracking-widest">
                          Bloc {blockIndex + 1}
                          <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground">
                            {block.rows.length} activité
                            {block.rows.length > 1 ? "s" : ""} sous une seule
                            cellule
                          </span>
                        </p>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            disabled={blockIndex === 0}
                            onClick={() => moveBlock(blockIndex, -1)}
                            aria-label={`Monter le bloc ${blockIndex + 1}`}
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            disabled={blockIndex === blocks.length - 1}
                            onClick={() => moveBlock(blockIndex, 1)}
                            aria-label={`Descendre le bloc ${blockIndex + 1}`}
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive hover:text-destructive"
                            onClick={() => removeBlock(block.key)}
                            aria-label={`Supprimer le bloc ${blockIndex + 1}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <Select
                        value={block.competencyId ?? FREE_TEXT}
                        onValueChange={(value) => linkBlock(block.key, value)}
                      >
                        <SelectTrigger
                          className="h-auto min-h-8 bg-background py-1 text-xs"
                          aria-label={`Compétence du socle, bloc ${blockIndex + 1}`}
                        >
                          <SelectValue placeholder="Choisir une compétence…" />
                        </SelectTrigger>
                        <SelectContent>
                          {competencyChoices.map((competency) => (
                            <SelectItem
                              key={competency.id}
                              value={competency.id}
                            >
                              {competencyOptionLabel(competency)}
                            </SelectItem>
                          ))}
                          {block.competencyId !== null &&
                            !competencyChoices.some(
                              (candidate) => candidate.id === block.competencyId,
                            ) && (
                              <SelectItem value={block.competencyId}>
                                {block.competencyLabel || "Compétence inconnue"}{" "}
                                (hors évaluation)
                              </SelectItem>
                            )}
                          <SelectItem value={FREE_TEXT}>
                            Texte libre (aucun lien)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {block.competencyId === null ? (
                        <div className="grid gap-1 sm:grid-cols-2">
                          <Input
                            className="h-7 bg-background p-1.5 text-xs"
                            value={block.domainLabel}
                            onChange={(e) =>
                              updateBlockLabel(
                                block.key,
                                "socle_domain_label",
                                e.target.value,
                              )
                            }
                            placeholder="Domaine…"
                            aria-label={`Domaine du socle, bloc ${blockIndex + 1}`}
                          />
                          <Input
                            className="h-7 bg-background p-1.5 text-xs"
                            value={block.competencyLabel}
                            onChange={(e) =>
                              updateBlockLabel(
                                block.key,
                                "socle_competency_label",
                                e.target.value,
                              )
                            }
                            placeholder="Compétence…"
                            aria-label={`Libellé de compétence, bloc ${blockIndex + 1}`}
                          />
                        </div>
                      ) : (
                        <p className="text-[11px] leading-snug text-muted-foreground">
                          {block.domainLabel}
                        </p>
                      )}
                    </header>

                    <div className="divide-y">
                      {block.rows.map((row, lineIndex) => {
                        const numero = `${blockIndex + 1}.${lineIndex + 1}`;
                        return (
                          <div key={row.key} className="p-3">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="text-[11px] font-medium text-muted-foreground">
                                Activité {numero}
                              </span>
                              <div className="flex items-center gap-0.5">
                                {block.rows.length > 1 && (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6"
                                      disabled={lineIndex === 0}
                                      onClick={() =>
                                        moveRow(block.start + lineIndex, -1)
                                      }
                                      aria-label={`Monter l'activité ${numero}`}
                                    >
                                      <ChevronUp className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6"
                                      disabled={
                                        lineIndex === block.rows.length - 1
                                      }
                                      onClick={() =>
                                        moveRow(block.start + lineIndex, 1)
                                      }
                                      aria-label={`Descendre l'activité ${numero}`}
                                    >
                                      <ChevronDown className="h-3.5 w-3.5" />
                                    </Button>
                                  </>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-destructive hover:text-destructive"
                                  onClick={() => removeRow(row.key)}
                                  aria-label={`Supprimer l'activité ${numero}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>

                            {/* Les deux activités se font face, comme sur la
                                fiche. Grille fluide, sans largeur minimale :
                                c'est ce qui fait qu'il n'y a plus rien à faire
                                défiler horizontalement. */}
                            <div className="grid gap-2 md:grid-cols-2">
                              <div className="space-y-1">
                                <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                  Activité de l'élève
                                </span>
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
                                  aria-label={`Activité de l'élève, activité ${numero}`}
                                />
                              </div>
                              <div className="space-y-1">
                                <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                  Activité de formation
                                </span>
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
                                  aria-label={`Activité de formation, activité ${numero}`}
                                />
                              </div>
                            </div>

                            <div className="mt-2 space-y-1">
                              <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                On exige{" "}
                                <span className="normal-case tracking-normal opacity-80">
                                  — fiche d'évaluation, pas la fiche contrat
                                </span>
                              </span>
                              <Textarea
                                className="min-h-[38px] resize-y p-1.5 text-xs"
                                value={row.required_text}
                                onChange={(e) =>
                                  updateRow(
                                    row.key,
                                    "required_text",
                                    e.target.value,
                                  )
                                }
                                aria-label={`On exige, activité ${numero}`}
                              />
                            </div>
                          </div>
                        );
                      })}

                      <div className="p-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-full justify-start text-xs text-muted-foreground"
                          onClick={() => addLineToBlock(block.key)}
                          disabled={block.mergeKey === null}
                        >
                          <Plus className="mr-1 h-3.5 w-3.5" />
                          Ajouter une activité à ce bloc
                        </Button>
                        {block.mergeKey === null && (
                          <p className="px-2 pb-1 text-[11px] leading-snug text-muted-foreground">
                            Renseignez d'abord le socle : c'est lui qui réunit
                            plusieurs activités sous une seule cellule. Sans lui,
                            chacune imprimerait la sienne.
                          </p>
                        )}
                      </div>
                    </div>
                  </section>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
              <CardTitle className="text-base">
                Consignes ({requirements.length})
              </CardTitle>
              <Button size="sm" variant="outline" onClick={addRequirement}>
                <Plus className="mr-1 h-4 w-4" />
                Ajouter une ligne
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {/* Trois colonnes alignées, et non trois paragraphes : « les
                  plans » répond à « identifier et interpréter un document » et
                  à rien d'autre. L'alignement est l'information. */}
              {requirements.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Aucune consigne pour l'instant. Chaque ligne aligne ce qui est
                  donné, ce qui est demandé et ce qui est exigé.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10 text-center">#</TableHead>
                        <TableHead className="min-w-[140px] text-green-700">
                          On donne
                        </TableHead>
                        <TableHead className="min-w-[140px] text-blue-700">
                          On demande
                        </TableHead>
                        <TableHead className="min-w-[140px] text-red-700">
                          On exige
                        </TableHead>
                        <TableHead className="w-28 text-right">
                          Actions
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {requirements.map((line, index) => (
                        <TableRow key={line.key}>
                          <TableCell className="text-center text-xs text-muted-foreground">
                            {index + 1}
                          </TableCell>
                          <TableCell className="p-1 align-top">
                            <Textarea
                              className="min-h-[56px] resize-y border-green-200 p-1.5 text-xs"
                              value={line.given_text}
                              onChange={(e) =>
                                updateRequirement(
                                  line.key,
                                  "given_text",
                                  e.target.value,
                                )
                              }
                              aria-label={`On donne, ligne ${index + 1}`}
                            />
                          </TableCell>
                          <TableCell className="p-1 align-top">
                            <Textarea
                              className="min-h-[56px] resize-y border-blue-200 p-1.5 text-xs"
                              value={line.asked_text}
                              onChange={(e) =>
                                updateRequirement(
                                  line.key,
                                  "asked_text",
                                  e.target.value,
                                )
                              }
                              aria-label={`On demande, ligne ${index + 1}`}
                            />
                          </TableCell>
                          <TableCell className="p-1 align-top">
                            <Textarea
                              className="min-h-[56px] resize-y border-red-200 p-1.5 text-xs"
                              value={line.required_text}
                              onChange={(e) =>
                                updateRequirement(
                                  line.key,
                                  "required_text",
                                  e.target.value,
                                )
                              }
                              aria-label={`On exige, ligne ${index + 1}`}
                            />
                          </TableCell>
                          <TableCell className="p-1 align-top">
                            <div className="flex items-center justify-end gap-0.5">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={index === 0}
                                onClick={() => moveRequirement(index, -1)}
                                aria-label="Monter la ligne"
                              >
                                <ChevronUp className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={index === requirements.length - 1}
                                onClick={() => moveRequirement(index, 1)}
                                aria-label="Descendre la ligne"
                              >
                                <ChevronDown className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => removeRequirement(line.key)}
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
            enregistrement. La colonne « On exige » du tableau des activités est
            conservée pour la fiche d'évaluation ; elle ne s'imprime pas sur la
            fiche contrat.
          </p>
        </div>
      </DataState>
    </div>
  );
}
