import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";

import { api } from "@/lib/api";
import {
  evaluationRowIsPrintable,
  exportEvaluationSheetsPDF,
  socleMergeKey,
  type ContractSheetContext,
  type EvaluationSheetInput,
} from "@/lib/pdf";
import {
  formatMark20,
  type CompetencyInfo,
  type ContractRow,
  type MasteryLevel,
} from "@/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataState } from "@/components/DataState";

/**
 * Un élève tel qu'il arrivera sur sa fiche.
 *
 * Tout est **composé par le parent**, et c'est volontaire : l'écran de notation
 * affiche déjà le nom, le rappel d'inscription et la note /20 de chaque élève.
 * Les recomposer ici ferait deux formulations du nom, deux phrasés du rappel et
 * — le seul qui compte vraiment — deux notes /20 pour le même élève, l'une à
 * l'écran et l'autre sur le papier remis à la famille.
 */
export interface EvaluationSheetCandidate {
  id: string;
  /** « BERNARD Léa », dans l'ordre de la grille de notation. */
  full_name: string;
  /** « inscrit le 10/01/2027 » quand l'élève n'était pas dans la classe le jour
   *  de l'évaluation, `null` sinon. Informe, n'interdit pas : c'est
   *  l'enseignant qui sait s'il veut lui remettre la feuille. */
  note: string | null;
  /** Niveau obtenu par compétence. Vide = aucune note saisie. */
  levels: Record<string, MasteryLevel>;
  mark20: number | null;
}

export interface EvaluationSheetPanelProps {
  evaluationId: string;
  candidates: EvaluationSheetCandidate[];
  /** Les compétences de l'évaluation, dans l'ordre où le parent les affiche.
   *
   *  Ce sont elles qui portent les notes : leurs identifiants sont exactement
   *  les clés de `levels`. La fiche contrat, elle, peut très bien n'en citer
   *  aucune — d'où leur présence ici, qui garantit qu'aucune compétence notée
   *  ne manque à la feuille imprimée. */
  competencies: CompetencyInfo[];
  /** Ouvre l'onglet « Fiche contrat ». Le tableau imprimé vient de là, et sans
   *  ce chemin l'enseignant devant une grille vide n'a pas d'issue. */
  onOpenContractSheet: () => void;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Télécharger la fiche d'évaluation de chaque élève — le second rendu du
 * tableau saisi dans la fiche contrat.
 *
 * **Cet écran n'écrit rien.** Il lit la fiche contrat enregistrée, compose un
 * PDF d'une page par élève et le dépose dans `exports/`. Rien de ce qu'on y
 * coche ne part en base : la sélection ne sert qu'à l'impression en cours.
 *
 * **Il lit la fiche ENREGISTRÉE**, pas le brouillon de l'éditeur, qui vit dans
 * un autre composant. Le bouton d'export de l'éditeur, lui, imprime ce qui est
 * à l'écran : chacun imprime ce qu'il a sous les yeux, et aucun des deux ne
 * prétend connaître l'état de l'autre.
 */
export function EvaluationSheetPanel({
  evaluationId,
  candidates,
  competencies,
  onOpenContractSheet,
}: EvaluationSheetPanelProps) {
  const [sheet, setSheet] = useState<EvaluationSheetInput | null>(null);
  const [sheetExists, setSheetExists] = useState(false);
  const [context, setContext] = useState<ContractSheetContext | null>(null);
  const [schoolName, setSchoolName] = useState("");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [openAfterExport, setOpenAfterExport] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [saved, proposal, settings] = await Promise.all([
        api.getContractSheet(evaluationId),
        api.suggestContractSheet(evaluationId),
        api.getSettings(),
      ]);
      // Sans fiche contrat, la grille se compose depuis les compétences de
      // l'évaluation : « on demande » et « on exige » restent vides, et la
      // feuille s'imprime quand même. C'est exactement ce que son classeur
      // contient — huit onglets vierges, remplis au stylo pendant la séquence.
      setSheet(
        saved !== null
          ? {
              project_title: saved.project_title,
              professional_field_label: saved.professional_field_label,
              professional_subset: saved.professional_subset,
              rows: saved.rows,
            }
          : {
              project_title: "",
              professional_field_label: "",
              professional_subset: "",
              rows: proposal.rows,
            },
      );
      setSheetExists(saved !== null);
      setContext({
        session_name: proposal.session_name,
        level_code: proposal.level_code,
        year_start: proposal.year_start,
        evaluation_title: proposal.project_title,
      });
      setSchoolName(settings.school_name);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [evaluationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Tout le monde est coché au départ : imprimer la classe entière est le geste
  // courant, et décocher trois élèves est plus rapide que d'en cocher vingt.
  // Les élèves qui n'étaient pas inscrits le jour de l'évaluation sont écartés
  // — leur rappel reste affiché, et leur case reste cochable.
  useEffect(() => {
    setSelected(
      new Set(
        candidates.filter((who) => who.note === null).map((who) => who.id),
      ),
    );
  }, [candidates]);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const retained = useMemo(
    () => candidates.filter((who) => selected.has(who.id)),
    [candidates, selected],
  );

  /** La grille **réellement imprimée** : les lignes de la fiche contrat, puis
   *  une ligne par compétence de l'évaluation qu'aucune d'elles ne rattache.
   *
   *  Ce complément n'est pas une commodité, il répare un document faux. Une
   *  croix ne peut se poser que sur une ligne liée au référentiel, alors que la
   *  note /20 est la moyenne de TOUTES les compétences notées. Or l'éditeur de
   *  fiche contrat s'ouvre vide et « Ajouter une ligne » ne rattache rien :
   *  une fiche saisie à la main — le geste normal — imprimait donc ses cinq
   *  colonnes de maîtrise désespérément vides, sous une moyenne de niveaux qui
   *  n'apparaissaient nulle part. Les compétences absentes sont ajoutées en fin
   *  de tableau, avec les libellés du référentiel ; les lignes de l'enseignant
   *  ne sont ni déplacées, ni modifiées, ni dédoublées.
   *
   *  Les compétences non notées en font partie : la feuille se remplit aussi au
   *  stylo pendant la séquence, et une compétence évaluée sans ligne pour elle
   *  serait impossible à cocher. */
  const printed = useMemo<{
    sheet: EvaluationSheetInput;
    added: number;
  } | null>(() => {
    if (sheet === null) return null;

    const linked = new Set(
      sheet.rows
        .filter(evaluationRowIsPrintable)
        .flatMap((row) => (row.competency_id ? [row.competency_id] : [])),
    );
    const missing = competencies.filter((comp) => !linked.has(comp.id));
    if (missing.length === 0) return { sheet, added: 0 };

    // Après la dernière ligne, quelle que soit sa position : les positions
    // viennent de la base et rien ne promet qu'elles soient contiguës.
    const after = sheet.rows.reduce(
      (last, row) => Math.max(last, row.position + 1),
      0,
    );
    const extra: ContractRow[] = missing.map((comp, offset) => ({
      id: null,
      position: after + offset,
      student_activity: "",
      training_activity: "",
      competency_id: comp.id,
      // `socle_reference` est le libellé composé par le backend — « D3 — La
      // formation de la personne et du citoyen (Cycle 3) ». Jamais recomposé
      // ici : deux formulations du même domaine sur le même papier.
      socle_domain_label: comp.socle_reference,
      socle_competency_label: comp.name,
      required_text: "",
    }));

    return {
      sheet: { ...sheet, rows: [...sheet.rows, ...extra] },
      added: extra.length,
    };
  }, [sheet, competencies]);

  /** Lignes et compétences que la feuille portera. Le compte des compétences
   *  est celui des BLOCS fusionnés, pas des lignes : c'est le nombre de croix
   *  à poser, et c'est ce qui dit à l'enseignant si sa grille est prête.
   *
   *  Compté sur la grille complétée, et avec la règle de lisibilité du PDF
   *  lui-même : ce nombre doit être celui des lignes qui sortiront. */
  const grid = useMemo(() => {
    const printable = (printed?.sheet.rows ?? []).filter(
      evaluationRowIsPrintable,
    );
    const blocks = new Set<string>();
    for (const row of printable) {
      const key = socleMergeKey(row);
      if (key !== null) blocks.add(key);
    }
    // `socleMergeKey` préfixe d'`id:` ce qui vient du référentiel et de `txt:`
    // ce qui n'est qu'un libellé saisi à la main. Les seconds n'ont aucune note
    // rattachable : leurs cinq cases sortiront vides, à cocher au stylo.
    let unlinked = 0;
    for (const key of blocks) {
      if (key.startsWith("txt:")) unlinked += 1;
    }
    return {
      lines: printable.length,
      blocks: blocks.size,
      unlinked,
      added: printed?.added ?? 0,
    };
  }, [printed]);

  const handleExport = async () => {
    if (!printed || !context || exporting) return;
    setExporting(true);
    setExportError(null);
    setExportNotice(null);
    try {
      const path = await exportEvaluationSheetsPDF(
        // `printed.sheet`, et non `sheet` : on imprime la grille complétée,
        // celle dont l'écran vient d'annoncer le nombre de lignes.
        printed.sheet,
        context,
        retained.map((who) => ({
          id: who.id,
          full_name: who.full_name,
          levels: who.levels,
          mark20: who.mark20,
        })),
        schoolName,
        openAfterExport,
      );
      setExportNotice(`Fiches enregistrées : ${path}`);
    } catch (err) {
      setExportError(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const allSelected = retained.length === candidates.length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Fiche d'évaluation</CardTitle>
        <p className="text-sm text-muted-foreground">
          Une page par élève : les activités de la fiche contrat, ce qu'on exige
          en face de chacune, les domaines et compétences du socle, et les cinq
          niveaux de maîtrise à cocher. Les croix et la note sur 20 sont déjà
          posées pour les compétences notées dans l'application ; le reste
          s'imprime vierge, à remplir au stylo.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <DataState
          loading={loading}
          error={loadError}
          onRetry={() => void load()}
        >
          {!sheetExists && (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p>
                Aucune fiche contrat n'est enregistrée pour cette évaluation. La
                grille sera composée depuis ses compétences, et les colonnes
                « on demande » et « on exige » resteront vides.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="border-amber-400 bg-white hover:bg-amber-100"
                onClick={onOpenContractSheet}
              >
                <FileSpreadsheet className="h-4 w-4" />
                Remplir la fiche contrat
              </Button>
            </div>
          )}

          {grid.lines === 0 ? (
            <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              La grille est vide : la feuille sortirait avec son seul en-tête.
              Ajoutez des activités dans la fiche contrat, ou des compétences à
              l'évaluation, et elles apparaîtront ici.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {grid.lines} ligne{grid.lines > 1 ? "s" : ""} d'activité,{" "}
              {grid.blocks} compétence{grid.blocks > 1 ? "s" : ""} à évaluer.
              {grid.unlinked > 0 && (
                <>
                  {" "}
                  {grid.unlinked > 1
                    ? `${grid.unlinked} blocs du socle sont saisis à la main, sans lien vers le référentiel : leurs cinq cases`
                    : "L'un des blocs du socle est saisi à la main, sans lien vers le référentiel : ses cinq cases"}{" "}
                  restent à cocher au stylo.
                </>
              )}
            </p>
          )}

          {/* Les compétences notées ne peuvent pas manquer à la feuille : la
              note /20 est leur moyenne, et une moyenne de niveaux absents du
              papier est un document faux. On le dit, parce qu'une ligne
              apparaît alors sur le PDF sans avoir été saisie dans la fiche. */}
          {grid.added > 0 && (
            <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              <p>
                {grid.added > 1
                  ? `${grid.added} compétences de l'évaluation ne figurent pas dans la fiche contrat`
                  : "Une compétence de l'évaluation ne figure pas dans la fiche contrat"}{" "}
                : {grid.added > 1 ? "elles seront ajoutées" : "elle sera ajoutée"}{" "}
                en fin de grille, avec {grid.added > 1 ? "leurs croix" : "sa croix"}.
                Sans {grid.added > 1 ? "ces lignes" : "cette ligne"}, la note sur
                20 serait la moyenne de niveaux n'apparaissant nulle part sur la
                feuille.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="border-blue-300 bg-white hover:bg-blue-100"
                onClick={onOpenContractSheet}
              >
                <FileSpreadsheet className="h-4 w-4" />
                Les placer moi-même dans la fiche contrat
              </Button>
            </div>
          )}

          {/* ---- Les élèves ---- */}
          {candidates.length === 0 ? (
            <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              Cette classe n'a aucun élève : il n'y a aucune fiche à imprimer.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">
                  Élèves ({retained.length} sur {candidates.length})
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setSelected(
                      allSelected
                        ? new Set()
                        : new Set(candidates.map((who) => who.id)),
                    )
                  }
                  disabled={exporting}
                >
                  {allSelected ? "Tout décocher" : "Tout cocher"}
                </Button>
              </div>

              <ul className="divide-y rounded-md border">
                {candidates.map((who) => (
                  <li key={who.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={selected.has(who.id)}
                        onChange={() => toggle(who.id)}
                        disabled={exporting}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {who.full_name}
                        </span>
                        {who.note && (
                          <span className="block text-xs text-muted-foreground">
                            {who.note}
                          </span>
                        )}
                      </span>
                      {/* Un tiret, et non « 0,0 » : une grille vierge n'est pas
                          un zéro. La case du PDF reste alors vide, à remplir. */}
                      <span
                        className={
                          who.mark20 === null
                            ? "font-mono text-sm tabular-nums text-muted-foreground"
                            : "font-mono text-sm tabular-nums"
                        }
                        title={
                          who.mark20 === null
                            ? "Aucune compétence évaluée : la case « note / 20 » s'imprimera vide."
                            : "Moyenne des compétences évaluées, chaque niveau valant 4 points."
                        }
                      >
                        {formatMark20(who.mark20)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ---- L'export ---- */}
          <div className="flex flex-wrap items-center gap-3 border-t pt-3">
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
              onClick={() => void handleExport()}
              disabled={
                exporting ||
                retained.length === 0 ||
                printed === null ||
                context === null
              }
            >
              {exporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {exporting
                ? "Export en cours…"
                : `Télécharger ${retained.length} fiche${
                    retained.length > 1 ? "s" : ""
                  }`}
            </Button>
          </div>

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
        </DataState>
      </CardContent>
    </Card>
  );
}
