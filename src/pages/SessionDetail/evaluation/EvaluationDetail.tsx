import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ClipboardCheck,
  ClipboardList,
  FileText,
  ListChecks,
  Save,
} from "lucide-react";
import { api } from "@/lib/api";
import type {
  CompetencyInfo,
  Evaluation,
  Grade,
  MasteryLevel,
  Student,
} from "@/types";
import {
  formatMark20,
  MASTERY_COLORS,
  MASTERY_LABELS,
  MASTERY_LEVELS,
  MASTERY_SHORT,
  masteryMark20,
} from "@/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { CompetencyPicker } from "@/components/CompetencyPicker";
import { ContractSheetEditor } from "@/components/ContractSheetEditor";
import { DataState } from "@/components/DataState";
import { NeedsChips } from "@/components/NeedsChips";
import { NeedsLoadError, useNeeds } from "@/hooks/useNeeds";
import {
  EvaluationSheetPanel,
  type EvaluationSheetCandidate,
} from "@/components/EvaluationSheetPanel";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { GradeScale } from "@/pages/SessionDetail/evaluation/GradeScale";

interface EvaluationDetailProps {
  evaluation: Evaluation;
  students: Student[];
  onBack: () => void;
  /** Recharge la liste du parent. À appeler après toute écriture. */
  onChanged: () => Promise<void>;
}

type View = "grades" | "competencies" | "contract" | "evaluation-sheet";

const TRIMESTERS = [1, 2, 3];

/** Fragment du message que le backend renvoie quand des notes deviendraient
 *  orphelines. On ne reconnaît que celui-là : toute autre erreur reste une
 *  erreur et ne doit jamais se transformer en invitation à supprimer des notes. */
const ORPHAN_MARKER = "portent déjà des notes";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("fr-FR");
}

/** `null` = trimestre calculé par le backend, un nombre = trimestre forcé. */
function forcedTrimester(evaluation: Evaluation): number | null {
  return evaluation.trimester_is_manual ? evaluation.trimester : null;
}

function trimesterChoiceOf(evaluation: Evaluation): string {
  return evaluation.trimester_is_manual ? String(evaluation.trimester) : "auto";
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export function EvaluationDetail({
  evaluation,
  students,
  onBack,
  onChanged,
}: EvaluationDetailProps) {
  const [competencies, setCompetencies] = useState<CompetencyInfo[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [view, setView] = useState<View>("grades");

  // C'est l'écran où l'enseignant l'a demandé en premier : on ne note pas de la
  // même façon un élève dysorthographique. Lecture seule — les étiquettes se
  // posent dans l'onglet « Élèves ».
  const { tags: needTags, parEleve: besoins } = useNeeds();

  const [draftIds, setDraftIds] = useState<string[]>(evaluation.competency_ids);
  const [savingComps, setSavingComps] = useState(false);
  /** Message du backend listant les notes qui seraient supprimées. Non nul =
   *  confirmation en attente ; `deleteOrphanGrades: true` ne part que d'ici. */
  const [orphanPrompt, setOrphanPrompt] = useState<string | null>(null);

  const [title, setTitle] = useState(evaluation.title);
  const [date, setDate] = useState(evaluation.date);
  const [trimesterChoice, setTrimesterChoice] = useState(
    trimesterChoiceOf(evaluation),
  );
  const [savingMeta, setSavingMeta] = useState(false);

  // Clés dérivées de l'entité fournie par le parent : elles changent quand le
  // serveur change, pas à chaque nouveau rendu de la liste.
  const linkedKey = evaluation.competency_ids.join(",");
  const metaKey = [
    evaluation.title,
    evaluation.date,
    String(evaluation.trimester),
    String(evaluation.trimester_is_manual),
  ].join("|");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [comps, grs] = await Promise.all([
        api.getEvaluationCompetencies(evaluation.id),
        api.getGrades(evaluation.id),
      ]);
      setCompetencies(comps);
      setGrades(grs);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [evaluation.id]);

  // `linkedKey` en dépendance : quand le parent recharge l'évaluation après un
  // enregistrement des compétences, la grille se remet à jour d'elle-même.
  useEffect(() => {
    void load();
  }, [load, linkedKey]);

  // Les brouillons se resynchronisent sur la valeur du serveur, et seulement
  // quand elle change : un simple rechargement de la liste du parent ne doit pas
  // effacer une saisie en cours.
  useEffect(() => {
    setDraftIds(evaluation.competency_ids);
  }, [linkedKey]);

  useEffect(() => {
    setTitle(evaluation.title);
    setDate(evaluation.date);
    setTrimesterChoice(trimesterChoiceOf(evaluation));
  }, [metaKey]);

  const gradeIndex = useMemo(() => {
    const map = new Map<string, MasteryLevel>();
    for (const grade of grades) {
      map.set(grade.student_id + "|" + grade.competency_id, grade.level);
    }
    return map;
  }, [grades]);

  const levelFor = (studentId: string, competencyId: string): MasteryLevel =>
    gradeIndex.get(studentId + "|" + competencyId) ?? 0;

  /** Compétences retirées du brouillon qui portent encore des notes. Sert à
   *  prévenir AVANT d'enregistrer ; le refus du backend reste le vrai garde-fou. */
  const removedWithGrades = useMemo(() => {
    const kept = new Set(draftIds);
    const counts = new Map<string, number>();
    for (const grade of grades) {
      if (kept.has(grade.competency_id)) continue;
      counts.set(
        grade.competency_id,
        (counts.get(grade.competency_id) ?? 0) + 1,
      );
    }
    return competencies
      .filter((comp) => counts.has(comp.id))
      .map((comp) => ({ name: comp.name, count: counts.get(comp.id) ?? 0 }));
  }, [competencies, draftIds, grades]);

  const filledCount = useMemo(() => {
    const studentIds = new Set(students.map((student) => student.id));
    const competencyIds = new Set(competencies.map((comp) => comp.id));
    return grades.filter(
      (grade) =>
        grade.level > 0 &&
        studentIds.has(grade.student_id) &&
        competencyIds.has(grade.competency_id),
    ).length;
  }, [competencies, grades, students]);

  const cellCount = students.length * competencies.length;

  const metaDirty =
    title.trim() !== evaluation.title ||
    date !== evaluation.date ||
    trimesterChoice !== trimesterChoiceOf(evaluation);

  const compsDirty = !sameIds(draftIds, evaluation.competency_ids);

  const handleGrade = async (
    studentId: string,
    competencyId: string,
    level: MasteryLevel,
  ) => {
    const viseCetteCase = (grade: Grade) =>
      grade.student_id === studentId && grade.competency_id === competencyId;

    // Le niveau d'AVANT, pour cette seule case — jamais le tableau entier.
    //
    // Restaurer tout le tableau en cas d'échec effaçait de l'écran les notes
    // saisies PENDANT l'écriture qui a échoué, et qui, elles, avaient abouti :
    // on clique « Maîtrise satisfaisante » sur Léa, puis aussitôt « Très bonne
    // maîtrise » sur Théo ; si la première échoue — session verrouillée sur
    // inactivité, le cas le plus courant — Théo repassait à « Non évalué » à
    // l'écran alors que la base portait sa note. Le message d'erreur parlait de
    // Léa, et rien ne signalait Théo. Six carrés se cliquent bien plus vite
    // qu'une liste déroulante : ce qui était improbable est devenu courant.
    const avant = grades.find(viseCetteCase) ?? null;

    // Optimiste : la grille se remplit colonne après colonne, attendre
    // l'aller-retour ferait clignoter chaque cellule.
    setGrades((current) => [
      ...current.filter((grade) => !viseCetteCase(grade)),
      {
        evaluation_id: evaluation.id,
        student_id: studentId,
        competency_id: competencyId,
        level,
      },
    ]);
    setActionError(null);
    try {
      await api.setGrade(evaluation.id, studentId, competencyId, level);
    } catch (err) {
      // Défait CETTE case et elle seule, sur l'état courant — donc sans toucher
      // aux écritures concurrentes qui ont réussi entre-temps.
      setGrades((current) => {
        const sansCetteCase = current.filter((grade) => !viseCetteCase(grade));
        return avant === null ? sansCetteCase : [...sansCetteCase, avant];
      });
      setActionError(errorMessage(err));
    }
  };

  const saveCompetencies = async (deleteOrphanGrades: boolean) => {
    setSavingComps(true);
    setActionError(null);
    try {
      await api.updateEvaluation(
        evaluation.id,
        evaluation.title,
        evaluation.date,
        forcedTrimester(evaluation),
        draftIds,
        deleteOrphanGrades,
      );
      setOrphanPrompt(null);
      await onChanged();
      setView("grades");
    } catch (err) {
      const message = errorMessage(err);
      if (!deleteOrphanGrades && message.includes(ORPHAN_MARKER)) {
        // Le backend a refusé pour protéger des notes : on demande, on ne
        // suppose pas.
        setOrphanPrompt(message);
      } else {
        setOrphanPrompt(null);
        setActionError(message);
      }
    } finally {
      setSavingComps(false);
    }
  };

  const saveMeta = async () => {
    if (!title.trim()) {
      setActionError("Le titre de l'évaluation est obligatoire.");
      return;
    }
    if (!date) {
      setActionError("La date de l'évaluation est obligatoire.");
      return;
    }
    setSavingMeta(true);
    setActionError(null);
    try {
      // Les compétences repartent telles que le serveur les connaît : cet
      // enregistrement ne touche jamais à la grille, donc jamais aux notes —
      // `deleteOrphanGrades` reste faux et ne peut rien supprimer.
      await api.updateEvaluation(
        evaluation.id,
        title.trim(),
        date,
        trimesterChoice === "auto" ? null : Number(trimesterChoice),
        evaluation.competency_ids,
        false,
      );
      await onChanged();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSavingMeta(false);
    }
  };

  /** Rappelle qu'un élève n'était pas inscrit le jour de l'évaluation, sans
   *  interdire la saisie : c'est l'enseignant qui sait. */
  const enrollmentNote = (student: Student): string | null => {
    if (student.left_on && student.left_on < evaluation.date) {
      return "sorti le " + formatDate(student.left_on);
    }
    if (student.enrolled_on > evaluation.date) {
      return "inscrit le " + formatDate(student.enrolled_on);
    }
    return null;
  };

  /** Ce que la fiche d'évaluation imprimera, un élève par entrée.
   *
   *  Composé ICI, et non dans le panneau, pour une raison précise : la note /20
   *  de la colonne de droite de la grille ci-dessous et celle de la case
   *  « NOTE / 20 » du papier doivent être le même calcul, pas deux. Même chose
   *  pour l'ordre du nom et pour le rappel d'inscription, qui sont déjà
   *  affichés deux colonnes plus loin.
   *
   *  `useMemo` n'est pas une optimisation : le panneau coche ses cases quand
   *  cette liste change, et un nouveau tableau à chaque rendu du parent
   *  remettrait la sélection à zéro sous les doigts de l'enseignant. */
  const sheetCandidates = useMemo<EvaluationSheetCandidate[]>(
    () =>
      students.map((student) => {
        const levels: Record<string, MasteryLevel> = {};
        for (const comp of competencies) {
          const level = levelFor(student.id, comp.id);
          if (level > 0) levels[comp.id] = level;
        }
        return {
          id: student.id,
          full_name: `${student.last_name} ${student.first_name}`.trim(),
          note: enrollmentNote(student),
          levels,
          mark20: masteryMark20(
            competencies.map((comp) => levelFor(student.id, comp.id)),
          ),
        };
      }),
    // `gradeIndex` porte déjà `grades`, et `enrollmentNote` ne lit que la date
    // de l'évaluation : ces quatre entrées sont toutes celles du calcul.
    [students, competencies, gradeIndex, evaluation.date],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Retour">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold">{evaluation.title}</h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{formatDate(evaluation.date)}</span>
            <Badge variant="outline" className="font-normal">
              T{evaluation.trimester}
              {" · "}
              {evaluation.trimester_is_manual ? "forcé" : "auto"}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            variant={view === "grades" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("grades")}
          >
            <ClipboardList className="h-4 w-4" />
            Notes
          </Button>
          <Button
            variant={view === "competencies" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("competencies")}
          >
            <ListChecks className="h-4 w-4" />
            Compétences
          </Button>
          <Button
            variant={view === "contract" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("contract")}
          >
            <FileText className="h-4 w-4" />
            Fiche contrat
          </Button>
          <Button
            variant={view === "evaluation-sheet" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("evaluation-sheet")}
          >
            <ClipboardCheck className="h-4 w-4" />
            Fiche d'évaluation
          </Button>
        </div>
      </div>

      {actionError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      )}

      {/* `key` obligatoire : l'éditeur détient un brouillon. Sans elle, passer
          d'une évaluation à l'autre réutilise la même instance React, son état
          initial n'est pas rejoué, et la fiche de la précédente serait
          enregistrée sous l'identifiant de la suivante. */}
      {view === "contract" && (
        <ContractSheetEditor
          key={evaluation.id}
          evaluationId={evaluation.id}
          evaluationTitle={evaluation.title}
        />
      )}

      {view === "evaluation-sheet" && (
        <EvaluationSheetPanel
          evaluationId={evaluation.id}
          candidates={sheetCandidates}
          competencies={competencies}
          onOpenContractSheet={() => setView("contract")}
        />
      )}

      {view === "competencies" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
            <CardTitle className="text-base">
              Compétences évaluées ({draftIds.length})
            </CardTitle>
            <div className="flex items-center gap-2">
              {compsDirty && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDraftIds(evaluation.competency_ids)}
                  disabled={savingComps}
                >
                  Annuler
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => void saveCompetencies(false)}
                disabled={savingComps || !compsDirty}
              >
                <Save className="h-4 w-4" />
                {savingComps ? "Enregistrement…" : "Enregistrer"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {removedWithGrades.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p className="font-medium">
                  Vous retirez {removedWithGrades.length} compétence
                  {removedWithGrades.length > 1 ? "s" : ""} déjà notée
                  {removedWithGrades.length > 1 ? "s" : ""} :
                </p>
                <ul className="mt-1 list-inside list-disc">
                  {removedWithGrades.map((item) => (
                    <li key={item.name}>
                      {item.name} — {item.count} note
                      {item.count > 1 ? "s" : ""}
                    </li>
                  ))}
                </ul>
                <p className="mt-1">
                  L'enregistrement demandera confirmation avant de supprimer ces
                  notes.
                </p>
              </div>
            )}
            <CompetencyPicker selected={draftIds} onChange={setDraftIds} />
          </CardContent>
        </Card>
      )}

      {view === "grades" && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Informations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end">
                <div className="space-y-2">
                  <Label htmlFor="evaluation-meta-title">Titre</Label>
                  <Input
                    id="evaluation-meta-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="evaluation-meta-date">Date</Label>
                  <Input
                    id="evaluation-meta-date"
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="evaluation-meta-trimester">Trimestre</Label>
                  <Select
                    value={trimesterChoice}
                    onValueChange={setTrimesterChoice}
                  >
                    <SelectTrigger id="evaluation-meta-trimester">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">
                        Automatique (selon la date)
                      </SelectItem>
                      {TRIMESTERS.map((trimester) => (
                        <SelectItem key={trimester} value={String(trimester)}>
                          Trimestre {trimester} (forcé)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={() => void saveMeta()}
                  disabled={savingMeta || !metaDirty}
                >
                  <Save className="h-4 w-4" />
                  {savingMeta ? "Enregistrement…" : "Enregistrer"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <NeedsLoadError />

          <DataState loading={loading} error={error} onRetry={load}>
            {competencies.length === 0 ? (
              <Card>
                <CardContent className="space-y-3 py-8 text-center">
                  <p className="text-muted-foreground">
                    Aucune compétence n'est rattachée à cette évaluation : il n'y
                    a rien à noter.
                  </p>
                  <Button size="sm" onClick={() => setView("competencies")}>
                    <ListChecks className="h-4 w-4" />
                    Choisir les compétences
                  </Button>
                </CardContent>
              </Card>
            ) : students.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <p className="text-muted-foreground">
                    Aucun élève dans cette classe. Ajoutez-en dans l'onglet
                    Élèves pour pouvoir noter.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                <Card>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="sticky left-0 z-20 min-w-[180px] bg-background">
                              Élève
                            </TableHead>
                            {competencies.map((comp) => (
                              <TableHead
                                key={comp.id}
                                className="min-w-[190px] text-center text-xs"
                              >
                                <div className="space-y-0.5">
                                  <p className="font-medium">{comp.name}</p>
                                  <p className="font-normal text-muted-foreground">
                                    {comp.field_name}
                                  </p>
                                  {comp.archived && (
                                    <Badge
                                      variant="outline"
                                      className="font-normal"
                                    >
                                      archivée
                                    </Badge>
                                  )}
                                </div>
                              </TableHead>
                            ))}
                            {/* La note globale est posée à DROITE des
                                compétences, parce qu'elle s'en déduit : on la
                                lit après avoir vu ce qui la produit. À gauche,
                                elle passerait pour une saisie. */}
                            <TableHead className="min-w-[88px] text-center text-xs">
                              <div className="space-y-0.5">
                                <p className="font-medium">Note</p>
                                <p className="font-normal text-muted-foreground">
                                  sur 20
                                </p>
                              </div>
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {students.map((student) => {
                            const note = enrollmentNote(student);
                            return (
                              <TableRow key={student.id}>
                                <TableCell className="sticky left-0 z-20 bg-background font-medium">
                                  <span className="block">
                                    {student.last_name} {student.first_name}
                                  </span>
                                  {note && (
                                    <span className="block text-xs font-normal text-muted-foreground">
                                      {note}
                                    </span>
                                  )}
                                  {/* `empty:hidden` : `NeedsChips` ne rend rien
                                      pour un élève sans besoin signalé, et une
                                      enveloppe vide garderait sa marge sur
                                      toutes les autres lignes. */}
                                  <span className="mt-1 block empty:hidden">
                                    <NeedsChips
                                      compact
                                      tags={needTags}
                                      needs={besoins.get(student.id)}
                                    />
                                  </span>
                                </TableCell>
                                {competencies.map((comp) => {
                                  const level = levelFor(student.id, comp.id);
                                  return (
                                    <TableCell
                                      key={comp.id}
                                      className="whitespace-nowrap p-1 text-center"
                                    >
                                      <GradeScale
                                        value={level}
                                        label={
                                          student.last_name +
                                          " " +
                                          student.first_name +
                                          " — " +
                                          comp.name
                                        }
                                        onChange={(next) =>
                                          void handleGrade(
                                            student.id,
                                            comp.id,
                                            next,
                                          )
                                        }
                                      />
                                    </TableCell>
                                  );
                                })}
                                {/* Calculée, jamais saisie : barème linéaire du
                                    niveau × 4, dans `MASTERY_POINTS`. Les
                                    compétences non évaluées sont ÉCARTÉES du
                                    calcul — elles ne valent pas zéro, pas plus
                                    qu'un appel oublié ne vaut « présent ». Une
                                    grille vierge n'affiche donc pas « 0,0 » mais
                                    un tiret : l'application n'affirme rien que
                                    l'enseignant n'ait saisi. */}
                                <TableCell className="text-center">
                                  {(() => {
                                    const note = masteryMark20(
                                      competencies.map((comp) =>
                                        levelFor(student.id, comp.id),
                                      ),
                                    );
                                    return (
                                      <span
                                        className={cn(
                                          "font-mono text-sm tabular-nums",
                                          note === null &&
                                            "text-muted-foreground",
                                        )}
                                        title={
                                          note === null
                                            ? "Aucune compétence évaluée : pas de note."
                                            : "Moyenne des compétences évaluées, chaque niveau valant 4 points."
                                        }
                                      >
                                        {formatMark20(note)}
                                      </span>
                                    );
                                  })()}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                {/* La légende porte l'abréviation ET le libellé : c'est elle
                    qui rend les carrés lisibles le premier jour. */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {MASTERY_LEVELS.map((level) => (
                    <span
                      key={level}
                      className="flex items-center gap-1.5 rounded border border-border py-1 pl-1 pr-2"
                    >
                      <span
                        className={cn(
                          "flex h-5 w-7 items-center justify-center rounded text-[10px] font-semibold",
                          MASTERY_COLORS[level],
                        )}
                      >
                        {MASTERY_SHORT[level]}
                      </span>
                      {MASTERY_LABELS[level]}
                    </span>
                  ))}
                  <span className="text-muted-foreground">
                    {filledCount} note{filledCount > 1 ? "s" : ""} saisie
                    {filledCount > 1 ? "s" : ""} sur {cellCount} case
                    {cellCount > 1 ? "s" : ""}
                  </span>
                </div>
              </>
            )}
          </DataState>
        </>
      )}

      <ConfirmDialog
        open={orphanPrompt !== null}
        onOpenChange={(open) => {
          if (!open) setOrphanPrompt(null);
        }}
        title="Des notes seront supprimées"
        description={
          <span className="block whitespace-pre-line">{orphanPrompt}</span>
        }
        confirmLabel="Supprimer ces notes et enregistrer"
        onConfirm={() => saveCompetencies(true)}
      />
    </div>
  );
}
