import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Ban,
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
  GradeWaiver,
  MasteryLevel,
  Student,
  StudentGroup,
} from "@/types";
import {
  formatMark20,
  MASTERY_BANDS,
  MASTERY_COLORS,
  MASTERY_LABELS,
  MASTERY_LEVELS,
  moyenneDesNotes,
  niveauDeNote,
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
import {
  concerneLeGroupe,
  PastilleDeGroupe,
  SelecteurDeGroupe,
} from "@/components/Groupes";
import { ContractSheetEditor } from "@/components/ContractSheetEditor";
import { DataState } from "@/components/DataState";
import { NeedsChips } from "@/components/NeedsChips";
import { NeedsLoadError, useNeeds } from "@/hooks/useNeeds";
import {
  EvaluationSheetPanel,
  type EvaluationSheetCandidate,
} from "@/components/EvaluationSheetPanel";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { GradeInput } from "@/pages/SessionDetail/evaluation/GradeInput";

interface EvaluationDetailProps {
  evaluation: Evaluation;
  /** **Tous** les élèves de la classe. Le filtrage par groupe se fait ici, pas
   *  chez l'appelant : c'est cet écran qui connaît le groupe de l'évaluation,
   *  et il change sans que la liste des élèves bouge. */
  students: Student[];
  /** Les groupes de la classe, détenus par le parent (règle 1). */
  groups: StudentGroup[];
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
  students: tousLesEleves,
  groups,
  onBack,
  onChanged,
}: EvaluationDetailProps) {
  /**
   * Les élèves que cette évaluation concerne — et, sous ce nom, les seuls que
   * le reste de l'écran connaisse.
   *
   * Renommer la prop et redériver `students` plutôt que filtrer à chaque usage :
   * la grille, le compte de cases, la fiche d'évaluation et le message « aucun
   * élève » lisent tous cette liste, et un seul oubli aurait affiché une
   * colonne de notes pour un élève que le bilan ne compte pas. Le prédicat est
   * celui du backend, partagé (`concerneLeGroupe`).
   */
  const students = useMemo(
    () =>
      tousLesEleves.filter((student) =>
        concerneLeGroupe(evaluation.group_id, student.group_id),
      ),
    [tousLesEleves, evaluation.group_id],
  );
  const [competencies, setCompetencies] = useState<CompetencyInfo[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  /** Les cases déclarées « ne sera pas évaluée » (palier 022). Liste à part et
   *  non un champ de `Grade` : une case déclarée n'a pas de note, et les
   *  mélanger redemanderait à chaque lecture « celle-là en est-elle une ? ». */
  const [waivers, setWaivers] = useState<GradeWaiver[]>([]);
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
  /** `null` = toute la classe. Le changer retire ou rend des lignes à la
   *  grille ; **aucune note n'est touchée** — celles d'un élève sorti du
   *  groupe restent en base, comme les notes d'une compétence retirée (règle
   *  arrêtée le 2026-11-06), et reviennent si l'enseignant revient en arrière. */
  const [groupDraft, setGroupDraft] = useState<string | null>(
    evaluation.group_id,
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
    evaluation.group_id ?? "",
  ].join("|");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [comps, grs, sans] = await Promise.all([
        api.getEvaluationCompetencies(evaluation.id),
        api.getGrades(evaluation.id),
        api.getGradeWaivers(evaluation.id),
      ]);
      setCompetencies(comps);
      setGrades(grs);
      setWaivers(sans);
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
    setGroupDraft(evaluation.group_id);
  }, [metaKey]);

  const gradeIndex = useMemo(() => {
    const map = new Map<string, number>();
    for (const grade of grades) {
      map.set(grade.student_id + "|" + grade.competency_id, grade.mark);
    }
    return map;
  }, [grades]);

  /** La note d'une case, ou `null` si elle est vierge. **`null`, et jamais 0** :
   *  depuis le palier 018, l'absence de note est l'absence de ligne, et 0 n'est
   *  plus une valeur que l'enseignant puisse saisir.
   *
   *  `null` ne dit pas pourquoi : la case est soit **en attente**, soit
   *  déclarée **« ne sera pas évaluée »** — c'est `sansNote` qui tranche. */
  const noteDe = (studentId: string, competencyId: string): number | null =>
    gradeIndex.get(studentId + "|" + competencyId) ?? null;

  const waiverIndex = useMemo(() => {
    const set = new Set<string>();
    for (const waiver of waivers) {
      set.add(waiver.student_id + "|" + waiver.competency_id);
    }
    return set;
  }, [waivers]);

  /** La case est déclarée « cet élève ne sera pas évalué sur cette
   *  compétence ». Elle n'a jamais de note en même temps : `set_grade` lève la
   *  déclaration dans sa transaction, `set_grade_waiver` refuse tant qu'une
   *  note est là. */
  const sansNote = (studentId: string, competencyId: string): boolean =>
    waiverIndex.has(studentId + "|" + competencyId);

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
    // Plus de filtre sur la valeur : toute ligne de `grades` est une note.
    return grades.filter(
      (grade) =>
        studentIds.has(grade.student_id) &&
        competencyIds.has(grade.competency_id),
    ).length;
  }, [competencies, grades, students]);

  /** Les cases déclarées « ne sera pas évaluée », limitées à la grille
   *  affichée. Même filtre que `filledCount`, et pour la même raison : une
   *  déclaration survit au retrait de sa compétence de l'évaluation, mais elle
   *  ne décrit plus une case de l'écran tant que celle-ci n'est pas revenue. */
  const waivedCount = useMemo(() => {
    const studentIds = new Set(students.map((student) => student.id));
    const competencyIds = new Set(competencies.map((comp) => comp.id));
    return waivers.filter(
      (waiver) =>
        studentIds.has(waiver.student_id) &&
        competencyIds.has(waiver.competency_id),
    ).length;
  }, [competencies, waivers, students]);

  const cellCount = students.length * competencies.length;

  const metaDirty =
    title.trim() !== evaluation.title ||
    date !== evaluation.date ||
    trimesterChoice !== trimesterChoiceOf(evaluation) ||
    groupDraft !== evaluation.group_id;

  const compsDirty = !sameIds(draftIds, evaluation.competency_ids);

  /**
   * Écrit une note, ou l'efface de la base quand `mark` est `null`.
   *
   * Deux commandes derrière un seul geste d'écran, et c'est voulu : `set_grade`
   * et `delete_grade` ne touchent pas aux mêmes lignes, et effacer ne doit pas
   * pouvoir arriver par débordement d'une saisie. Ce qui est commun aux deux,
   * c'est le rattrapage optimiste ci-dessous, qui n'avait pas à être écrit
   * deux fois.
   */
  const handleGrade = async (
    studentId: string,
    competencyId: string,
    mark: number | null,
  ) => {
    const viseCetteCase = (grade: Grade) =>
      grade.student_id === studentId && grade.competency_id === competencyId;

    // La note d'AVANT, pour cette seule case — jamais le tableau entier.
    //
    // Restaurer tout le tableau en cas d'échec effaçait de l'écran les notes
    // saisies PENDANT l'écriture qui a échoué, et qui, elles, avaient abouti :
    // on pose 16 sur Léa, puis aussitôt 19 sur Théo ; si la première échoue —
    // session verrouillée sur inactivité, le cas le plus courant — la case de
    // Théo redevenait vierge à l'écran alors que la base portait sa note. Le
    // message d'erreur parlait de Léa, et rien ne signalait Théo.
    const avant = grades.find(viseCetteCase) ?? null;
    // `set_grade` efface la déclaration dans sa transaction — poser une note,
    // c'est évaluer. L'écran fait le même geste au même moment, sinon la case
    // afficherait un instant la note ET « ne sera pas évaluée ».
    const etaitSansNote = sansNote(studentId, competencyId);

    // Optimiste : la grille se remplit colonne après colonne, attendre
    // l'aller-retour ferait clignoter chaque cellule.
    setGrades((current) => {
      const sansCetteCase = current.filter((grade) => !viseCetteCase(grade));
      if (mark === null) return sansCetteCase;
      return [
        ...sansCetteCase,
        {
          evaluation_id: evaluation.id,
          student_id: studentId,
          competency_id: competencyId,
          mark,
        },
      ];
    });
    if (mark !== null && etaitSansNote) {
      setWaivers((current) =>
        current.filter(
          (waiver) =>
            waiver.student_id !== studentId ||
            waiver.competency_id !== competencyId,
        ),
      );
    }
    setActionError(null);
    try {
      if (mark === null) {
        await api.deleteGrade(evaluation.id, studentId, competencyId);
      } else {
        await api.setGrade(evaluation.id, studentId, competencyId, mark);
      }
    } catch (err) {
      // Défait CETTE case et elle seule, sur l'état courant — donc sans toucher
      // aux écritures concurrentes qui ont réussi entre-temps.
      setGrades((current) => {
        const sansCetteCase = current.filter((grade) => !viseCetteCase(grade));
        return avant === null ? sansCetteCase : [...sansCetteCase, avant];
      });
      if (mark !== null && etaitSansNote) {
        setWaivers((current) => [
          ...current,
          {
            evaluation_id: evaluation.id,
            student_id: studentId,
            competency_id: competencyId,
          },
        ]);
      }
      setActionError(errorMessage(err));
    }
  };

  /**
   * Pose ou retire la déclaration « cet élève ne sera pas évalué sur cette
   * compétence ».
   *
   * Deux commandes derrière un seul geste, comme `handleGrade` : poser et
   * retirer ne touchent pas à la même ligne, et le rattrapage optimiste est
   * le même — **cette case et elle seule**, sur l'état courant, pour ne pas
   * défaire les écritures voisines qui ont abouti entre-temps.
   */
  const handleWaiver = async (
    studentId: string,
    competencyId: string,
    waived: boolean,
  ) => {
    const viseCetteCase = (waiver: GradeWaiver) =>
      waiver.student_id === studentId && waiver.competency_id === competencyId;
    const avant = waivers.some(viseCetteCase);
    const ligne: GradeWaiver = {
      evaluation_id: evaluation.id,
      student_id: studentId,
      competency_id: competencyId,
    };

    setWaivers((current) => {
      const sansCetteCase = current.filter((waiver) => !viseCetteCase(waiver));
      return waived ? [...sansCetteCase, ligne] : sansCetteCase;
    });
    setActionError(null);
    try {
      if (waived) {
        await api.setGradeWaiver(evaluation.id, studentId, competencyId);
      } else {
        await api.deleteGradeWaiver(evaluation.id, studentId, competencyId);
      }
    } catch (err) {
      setWaivers((current) => {
        const sansCetteCase = current.filter(
          (waiver) => !viseCetteCase(waiver),
        );
        return avant ? [...sansCetteCase, ligne] : sansCetteCase;
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
        // Le groupe transite **inchangé** : cet enregistrement ne porte que
        // les compétences, et l'omettre rendrait une évaluation d'atelier à la
        // classe entière au premier ajout de compétence.
        evaluation.group_id,
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
        groupDraft,
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
   *  **La fiche reçoit les DEGRÉS, jamais les notes par compétence.** L'élève
   *  lit « Maîtrise fragile » et sa moyenne sur l'évaluation, pas le 9/20 qui
   *  a produit le premier — décision de l'auteur du 2026-11-07. La conversion
   *  est faite ici, à la source : ainsi la note par compétence n'arrive même
   *  pas jusqu'au papier, et aucune retouche future de `pdf.ts` ne peut
   *  l'imprimer par inadvertance. Une consigne tenue par la forme des données
   *  vaut mieux qu'une consigne tenue par la vigilance.
   *
   *  `useMemo` n'est pas une optimisation : le panneau coche ses cases quand
   *  cette liste change, et un nouveau tableau à chaque rendu du parent
   *  remettrait la sélection à zéro sous les doigts de l'enseignant. */
  const sheetCandidates = useMemo<EvaluationSheetCandidate[]>(
    () =>
      students.map((student) => {
        const levels: Record<string, MasteryLevel> = {};
        const waived: string[] = [];
        const notes: number[] = [];
        for (const comp of competencies) {
          const note = noteDe(student.id, comp.id);
          if (note === null) {
            // Une case en attente ne dit rien sur le papier — elle reste à
            // cocher au stylo. Une case déclarée, elle, s'imprime en toutes
            // lettres : c'est précisément la ligne vide qui se lisait comme un
            // oubli, et que l'auteur a demandé de distinguer.
            if (sansNote(student.id, comp.id)) waived.push(comp.id);
            continue;
          }
          levels[comp.id] = niveauDeNote(note);
          notes.push(note);
        }
        return {
          id: student.id,
          full_name: `${student.last_name} ${student.first_name}`.trim(),
          note: enrollmentNote(student),
          levels,
          waived,
          mark20: moyenneDesNotes(notes),
        };
      }),
    // `gradeIndex` porte déjà `grades` et `waiverIndex` porte `waivers` ;
    // `enrollmentNote` ne lit que la date de l'évaluation : ces cinq entrées
    // sont toutes celles du calcul.
    [students, competencies, gradeIndex, waiverIndex, evaluation.date],
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
            <PastilleDeGroupe groupName={evaluation.group_name} />
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
            {/* `sessionId` : l'établissement de la classe retire des
                propositions les compétences qu'il n'emploie pas. Celles
                déjà cochées restent là, notes comprises. */}
            <CompetencyPicker
              selected={draftIds}
              onChange={setDraftIds}
              sessionId={evaluation.session_id}
            />
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
                {/* Sur sa propre ligne et avant les trois autres champs : il
                    change la liste des élèves notés, ce qu'aucun d'eux ne
                    fait. Placé après, il renvoyait le bouton d'enregistrement
                    sur une troisième ligne. Il disparaît tout seul quand la
                    classe n'a aucun groupe, et la grille redevient alors celle
                    d'avant le palier 023. */}
                <div className="md:col-span-4">
                  <SelecteurDeGroupe
                    id="evaluation-meta-group"
                    groups={groups}
                    value={groupDraft}
                    onChange={setGroupDraft}
                    disabled={savingMeta}
                    aide="Seuls les élèves de ce groupe sont notés. Les notes déjà saisies pour les autres restent en base et réapparaissent si vous revenez en arrière."
                  />
                </div>
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
                    {evaluation.group_name
                      ? `Aucun élève n'est rangé dans « ${evaluation.group_name} » : répartissez-les dans l'onglet Élèves, ou rendez cette évaluation à toute la classe.`
                      : "Aucun élève dans cette classe. Ajoutez-en dans l'onglet Élèves pour pouvoir noter."}
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
                            {/* `bg-card` et non `bg-background` : une
                                colonne figée REPEINT ce qui défile
                                dessous, et ce qu'elle doit repeindre ici
                                est la carte — blanche —, pas la page —
                                grise. Avec le jeton de la page, la
                                colonne des élèves posait une bande grise
                                au milieu du tableau. */}
                            <TableHead className="sticky left-0 z-20 min-w-[180px] bg-card">
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
                                <TableCell className="sticky left-0 z-20 bg-card font-medium">
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
                                {competencies.map((comp) => (
                                  <TableCell
                                    key={comp.id}
                                    className="whitespace-nowrap p-1 text-center"
                                  >
                                    {/* `key` sur le composant et pas seulement
                                        sur la cellule : il détient un brouillon
                                        de saisie, et deux cases ne doivent
                                        jamais partager une instance. */}
                                    <GradeInput
                                      key={student.id + "|" + comp.id}
                                      value={noteDe(student.id, comp.id)}
                                      waived={sansNote(student.id, comp.id)}
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
                                      onClear={() =>
                                        void handleGrade(
                                          student.id,
                                          comp.id,
                                          null,
                                        )
                                      }
                                      onWaive={(next) =>
                                        void handleWaiver(
                                          student.id,
                                          comp.id,
                                          next,
                                        )
                                      }
                                      onRefus={setActionError}
                                    />
                                  </TableCell>
                                ))}
                                {/* Calculée, jamais saisie : la moyenne des
                                    notes posées. Les compétences non évaluées
                                    sont ÉCARTÉES du calcul — elles ne valent pas
                                    zéro, pas plus qu'un appel oublié ne vaut
                                    « présent ». Une grille vierge n'affiche donc
                                    pas « 0,0 » mais un tiret : l'application
                                    n'affirme rien que l'enseignant n'ait saisi.
                                    C'est la SEULE note que l'élève verra sur sa
                                    fiche. */}
                                <TableCell className="text-center">
                                  {(() => {
                                    const moyenne = moyenneDesNotes(
                                      competencies
                                        .map((comp) =>
                                          noteDe(student.id, comp.id),
                                        )
                                        .filter((n): n is number => n !== null),
                                    );
                                    return (
                                      <span
                                        className={cn(
                                          "font-mono text-sm tabular-nums",
                                          moyenne === null &&
                                            "text-muted-foreground",
                                        )}
                                        title={
                                          moyenne === null
                                            ? "Aucune compétence évaluée : pas de note."
                                            : "Moyenne des notes posées, les compétences non évaluées étant écartées."
                                        }
                                      >
                                        {formatMark20(moyenne)}
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

                {/* La légende porte la TRANCHE et son libellé. Elle ne
                    décode plus une abréviation — le libellé complet est déjà
                    dans chaque cellule —, elle dit où tombe une note avant
                    qu'on la tape. C'est la seule chose que l'enseignant ne
                    peut pas deviner de l'écran. */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {MASTERY_LEVELS.map((level) => {
                    const [bas, haut] = MASTERY_BANDS[level];
                    return (
                      <span
                        key={level}
                        className="flex items-center gap-1.5 rounded border border-border py-1 pl-1 pr-2"
                      >
                        <span
                          className={cn(
                            "flex h-5 min-w-10 items-center justify-center rounded px-1 text-[10px] font-semibold tabular-nums",
                            MASTERY_COLORS[level],
                          )}
                        >
                          {bas}–{haut}
                        </span>
                        {MASTERY_LABELS[level]}
                      </span>
                    );
                  })}
                  <span className="text-muted-foreground">
                    {filledCount} note{filledCount > 1 ? "s" : ""} saisie
                    {filledCount > 1 ? "s" : ""} sur {cellCount} case
                    {cellCount > 1 ? "s" : ""}
                    {waivedCount > 0 && (
                      <>
                        {" · "}
                        {waivedCount} ne sera
                        {waivedCount > 1 ? "nt" : ""} pas évaluée
                        {waivedCount > 1 ? "s" : ""}
                      </>
                    )}
                  </span>
                </div>

                {/* Le geste ne se devine pas : la phrase reste même depuis que
                    le bouton barré est visible au repos, parce qu'elle dit ce
                    que le bouton ne peut pas dire — l'effet sur la moyenne et
                    sur la feuille. Même doctrine que la légende des absences
                    sous l'emploi du temps : une infobulle ne se découvre pas. */}
                <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                  <span>
                    Une case vide est{" "}
                    <strong className="font-medium">en attente</strong> de sa
                    note. Si cet élève ne sera pas évalué sur cette compétence,
                    cliquez
                  </span>
                  <Ban
                    className="inline h-3.5 w-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span>
                    dans la case (ou tapez{" "}
                    <strong className="font-medium">N</strong>) : elle sort de
                    sa moyenne et la feuille remise à l'élève imprimera « non
                    évalué » au lieu d'une ligne vierge. Un clic sur le
                    cartouche « ne sera pas évaluée » revient en arrière.
                  </span>
                </p>
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
