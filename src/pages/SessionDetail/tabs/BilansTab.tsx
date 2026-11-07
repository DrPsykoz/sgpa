import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, Pencil, Save, X } from "lucide-react";

import { DataState } from "@/components/DataState";
import { NeedsChips } from "@/components/NeedsChips";
import { NeedsLoadError, useNeeds } from "@/hooks/useNeeds";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useDraftGuard } from "@/hooks/useDrafts";
import { api } from "@/lib/api";
import { exportReportPDF } from "@/lib/pdf";
import { cn } from "@/lib/utils";
import {
  AVERAGE_RULE_PHRASES,
  LEVEL_LABELS,
  MASTERY_COLORS,
  MASTERY_LABELS,
  schoolYearLabel,
  type MasteryLevel,
  type NeedTag,
  type Session,
  type SessionReport,
  type StudentNeeds,
  type StudentReport,
  type TrimesterBounds,
} from "@/types";

interface BilansTabProps {
  session: Session;
}

const TRIMESTERS = [1, 2, 3] as const;

/** Barres pleines : MASTERY_COLORS est prévu pour des pastilles de texte et
 *  reste illisible en aplat de 8 px de haut. */
const MASTERY_BARS: Record<MasteryLevel, string> = {
  0: "bg-gray-300",
  1: "bg-red-400",
  2: "bg-orange-400",
  3: "bg-yellow-400",
  4: "bg-green-500",
  5: "bg-emerald-600",
};

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("fr-FR");
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

/** « — » et jamais « 0,0/5 » : un élève sans note ne doit pas paraître en échec. */
function formatAverage(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1).replace(".", ",")}/5`;
}

function masteryStep(value: number): MasteryLevel {
  return Math.min(5, Math.max(0, Math.round(value))) as MasteryLevel;
}

/** Trimestre couvrant la date du jour, pour ouvrir l'onglet sur le bon bilan. */
function currentTrimester(bounds: TrimesterBounds): number {
  const today = new Date().toLocaleDateString("sv-SE");
  if (today >= bounds.t3_start) return 3;
  if (today >= bounds.t2_start) return 2;
  return 1;
}

export function BilansTab({ session }: BilansTabProps) {
  // Distribués en props aux cartes, comme `enrolledOn` juste à côté : la carte
  // d'un élève reste un composant d'affichage qui ne lit aucun contexte.
  const { tags: needTags, parEleve: besoins } = useNeeds();
  const [trimester, setTrimester] = useState<number | null>(null);
  const [boundsWarning, setBoundsWarning] = useState<string | null>(null);
  const [report, setReport] = useState<SessionReport | null>(null);
  const [enrolledOn, setEnrolledOn] = useState<Record<string, string>>({});
  const [schoolName, setSchoolName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  // Décoché par défaut : ouvrir le bilan le fait entrer dans les documents
  // récents du lecteur PDF du poste hôte, où le nom de la classe reste visible
  // bien après que la clé a été débranchée.
  const [openAfterExport, setOpenAfterExport] = useState(false);

  // Le trimestre ouvert par défaut dépend des bornes de l'année, qui sont
  // réglables : impossible de le déduire du seul calendrier.
  useEffect(() => {
    let abandoned = false;
    api
      .getTrimesterBounds(session.year_start)
      .then((bounds) => {
        if (abandoned) return;
        setBoundsWarning(null);
        setTrimester(currentTrimester(bounds));
      })
      .catch((err: unknown) => {
        if (abandoned) return;
        setBoundsWarning(messageOf(err));
        setTrimester(1);
      });
    return () => {
      abandoned = true;
    };
  }, [session.year_start]);

  // Un changement rapide de trimestre peut faire arriver une réponse tardive
  // après une plus récente : on ne garde que celle de la dernière demande.
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    if (trimester === null) return;
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const [nextReport, students, settings] = await Promise.all([
        api.getReport(session.id, trimester),
        api.getStudents(session.id),
        api.getSettings(),
      ]);
      if (requestRef.current !== requestId) return;
      setReport(nextReport);
      // `StudentReport` ne porte pas la date d'inscription, nécessaire à la
      // ligne « inscrit depuis le … » de l'assiduité.
      setEnrolledOn(
        Object.fromEntries(students.map((s) => [s.id, s.enrolled_on])),
      );
      setSchoolName(settings.school_name);
    } catch (err) {
      if (requestRef.current !== requestId) return;
      setReport(null);
      setError(messageOf(err));
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [session.id, trimester]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleExport = async () => {
    if (!report) return;
    setExporting(true);
    setExportError(null);
    setExportNotice(null);
    try {
      const path = await exportReportPDF(report, schoolName, openAfterExport);
      setExportNotice(`Bilan enregistré : ${path}`);
    } catch (err) {
      setExportError(messageOf(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-sm">Trimestre :</Label>
          <Select
            value={trimester === null ? "" : String(trimester)}
            onValueChange={(value) => setTrimester(Number(value))}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Trimestre" />
            </SelectTrigger>
            <SelectContent>
              {TRIMESTERS.map((t) => (
                <SelectItem key={t} value={String(t)}>
                  Trimestre {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1" />
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
          size="sm"
          disabled={!report || report.students.length === 0 || exporting}
          onClick={handleExport}
        >
          <Download />
          {exporting ? "Export en cours…" : "Exporter en PDF"}
        </Button>
      </div>

      {boundsWarning && (
        <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Bornes de trimestre illisibles ({boundsWarning}). Le trimestre 1 est
            affiché par défaut.
          </span>
        </p>
      )}

      {exportError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          L'export PDF a échoué : {exportError}
        </p>
      )}

      {exportNotice && !exportError && (
        <p className="break-all rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">
          {exportNotice}
        </p>
      )}

      <DataState
        loading={loading}
        error={error}
        empty={report !== null && report.students.length === 0}
        emptyLabel="Aucun élève dans cette classe : ajoutez-en dans l'onglet Élèves."
        onRetry={() => void load()}
      >
        {report && (
          <div className="space-y-4">
            <ReportHeader session={session} report={report} />
            <NeedsLoadError />
            {report.students.map((studentReport) => (
              // La clé porte le trimestre : d'un trimestre à l'autre les élèves
              // sont les mêmes, et sans lui React réutiliserait l'instance — le
              // brouillon de commentaire du T1 partirait sur le T2.
              <StudentReportCard
                key={`${report.trimester}:${studentReport.student_id}`}
                report={studentReport}
                trimester={report.trimester}
                enrolledOn={enrolledOn[studentReport.student_id] ?? null}
                needTags={needTags}
                needs={besoins.get(studentReport.student_id)}
                onSaved={load}
              />
            ))}
          </div>
        )}
      </DataState>
    </div>
  );
}

function ReportHeader({
  session,
  report,
}: {
  session: Session;
  report: SessionReport;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{report.session_name}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {LEVEL_LABELS[session.level_code]} ·{" "}
              {schoolYearLabel(report.year_start)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium">Trimestre {report.trimester}</p>
            <p className="text-xs text-muted-foreground">
              du {formatDate(report.trimester_start)} au{" "}
              {formatDate(report.trimester_end)}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-x-4 gap-y-1 pt-0 text-xs text-muted-foreground">
        <span>
          {plural(report.seance_count, "séance", "séances")} au trimestre
        </span>
        {report.cancelled_count > 0 && (
          <span>
            {plural(
              report.cancelled_count,
              "séance annulée",
              "séances annulées",
            )}
            , hors bilan
          </span>
        )}
        <span>{plural(report.students.length, "élève", "élèves")}</span>
        <span>Moyenne générale : {AVERAGE_RULE_PHRASES[report.average_rule]}</span>
      </CardContent>
    </Card>
  );
}

function StudentReportCard({
  report,
  trimester,
  enrolledOn,
  needTags,
  needs,
  onSaved,
}: {
  report: StudentReport;
  trimester: number;
  enrolledOn: string | null;
  needTags: NeedTag[];
  needs: StudentNeeds | undefined;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(report.teacher_comment);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const attendance = report.attendance;
  const attended = attendance.present + attendance.retard;
  const rate = useMemo(
    () =>
      attendance.seances_applicables > 0
        ? Math.round((attended / attendance.seances_applicables) * 100)
        : null,
    [attended, attendance.seances_applicables],
  );

  /** Écrit l'appréciation et laisse remonter l'échec : le registre des
   *  brouillons doit savoir si elle est réellement partie. */
  const persistComment = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await api.saveReportComment(report.student_id, trimester, draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    try {
      await persistComment();
      await onSaved();
    } catch (err) {
      setSaveError(messageOf(err));
    }
  };

  // Une appréciation est un paragraphe rédigé : la perdre au verrouillage
  // serait aussi pénible qu'un cahier de texte. `onSaved()` n'est pas rappelé
  // dans le `flush` : il recharge tout le bilan, juste avant que l'arbre ne
  // soit démonté, et son échec passerait pour une saisie perdue.
  useDraftGuard(
    `bilan-appreciation:${trimester}:${report.student_id}`,
    editing && draft !== report.teacher_comment,
    {
      label: `Appréciation de ${report.student_first_name} ${report.student_last_name} — trimestre ${trimester}`,
      flush: persistComment,
    },
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <span>
              {report.student_last_name} {report.student_first_name}
            </span>
            {/* À l'écran seulement. Le bouton « Exporter le bilan » un peu plus
                haut passe par `exportReportPDF`, qui ne reçoit que
                `TrimesterReport` — ces pastilles n'ont aucun chemin vers le
                PDF, et c'est la décision de l'auteur, pas un oubli. */}
            <NeedsChips tags={needTags} needs={needs} />
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "border-transparent",
                report.overall_average === null
                  ? "bg-muted text-muted-foreground"
                  : MASTERY_COLORS[masteryStep(report.overall_average)],
              )}
            >
              Moyenne générale : {formatAverage(report.overall_average)}
            </Badge>
            <span className="text-xs italic text-muted-foreground">
              moyenne indicative, règle à confirmer
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <section className="space-y-1">
          {report.competency_averages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune note sur ce trimestre.
            </p>
          ) : (
            report.competency_averages.map((competency) => (
              <div
                key={competency.competency_id}
                className="flex items-center gap-3"
              >
                <div className="min-w-0 flex-1 text-xs">
                  <span className="text-muted-foreground">
                    {competency.domain_name} › {competency.field_name} ›{" "}
                  </span>
                  <span className="font-medium">
                    {competency.competency_name}
                  </span>
                </div>
                <span className="hidden w-44 shrink-0 text-right text-xs text-muted-foreground sm:inline">
                  {MASTERY_LABELS[masteryStep(competency.average_level)]}
                </span>
                <div className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      MASTERY_BARS[masteryStep(competency.average_level)],
                    )}
                    style={{ width: `${(competency.average_level / 5) * 100}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right text-xs font-medium">
                  {competency.average_level.toFixed(1).replace(".", ",")}
                  <span className="ml-1 font-normal text-muted-foreground">
                    ({competency.grade_count})
                  </span>
                </span>
              </div>
            ))
          )}
        </section>

        <Separator />

        <section className="space-y-1 text-xs">
          <p className="text-sm">
            <span className="font-medium">Assiduité : </span>
            {attended} /{" "}
            {plural(attendance.seances_applicables, "séance", "séances")}
            {rate !== null && (
              <span className="text-muted-foreground"> ({rate} %)</span>
            )}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-green-700">
              Présent : {attendance.present}
            </span>
            <span className="text-orange-700">
              Retard : {attendance.retard}
            </span>
            <span className="text-red-700">Absent : {attendance.absent}</span>
            <span className="text-blue-700">Excusé : {attendance.excuse}</span>
          </div>
          {attendance.non_renseigne > 0 && (
            <p className="text-amber-700">
              {plural(
                attendance.non_renseigne,
                "séance non pointée",
                "séances non pointées",
              )}
            </p>
          )}
          {attendance.hors_inscription > 0 && (
            <p className="text-muted-foreground">
              {enrolledOn
                ? `Inscrit depuis le ${formatDate(enrolledOn)}, `
                : "Hors période d'inscription : "}
              {plural(
                attendance.hors_inscription,
                "séance antérieure non concernée",
                "séances antérieures non concernées",
              )}
            </p>
          )}
          {/* Sans cette ligne, la page ne s'additionne plus : l'en-tête annonce
              26 séances au trimestre et l'élève affiche 20/20. Elle vient après
              l'inscription parce que les compteurs se retranchent dans cet
              ordre — séances du trimestre, moins les séances hors inscription,
              moins celles-ci — et les trois sont disjoints côté backend. */}
          {attendance.seances_neutralisees > 0 && (
            <p className="text-muted-foreground">
              {plural(
                attendance.seances_neutralisees,
                "séance pendant une absence justifiée, non comptabilisée",
                "séances pendant une absence justifiée, non comptabilisées",
              )}
            </p>
          )}
        </section>

        <Separator />

        <section className="space-y-2">
          {editing ? (
            <>
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Commentaire de l'enseignant…"
                className="min-h-[80px] text-sm"
              />
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  <Save />
                  {saving ? "Enregistrement…" : "Enregistrer"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={saving}
                  onClick={() => {
                    setDraft(report.teacher_comment);
                    setSaveError(null);
                    setEditing(false);
                  }}
                >
                  <X />
                  Annuler
                </Button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="group flex w-full items-start gap-2 text-left"
              onClick={() => {
                setDraft(report.teacher_comment);
                setEditing(true);
              }}
            >
              <span
                className={cn(
                  "flex-1 text-sm",
                  report.teacher_comment
                    ? "whitespace-pre-wrap"
                    : "italic text-muted-foreground",
                )}
              >
                {report.teacher_comment || "Ajouter un commentaire…"}
              </span>
              <Pencil className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
          {saveError && (
            <p className="text-xs text-destructive">
              Le commentaire n'a pas pu être enregistré : {saveError}
            </p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
