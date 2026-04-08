import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import type { Student, Seance, AttendanceWithStudent, AttendanceStatus, Evaluation, CompetencyInfo, Grade, MasteryLevel, StudentReport } from "@/types";
import { MASTERY_LABELS, MASTERY_COLORS } from "@/types";
import { exportReportPDF } from "@/lib/pdf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RichEditor } from "@/components/RichEditor";
import { CompetencyPicker } from "@/components/CompetencyPicker";
import { ContractSheetEditor } from "@/components/ContractSheetEditor";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  UserPlus,
  Calendar,
  BookOpen,
  Save,
  Check,
  Clock,
  X,
  UserCheck,
  ClipboardList,
  FileText,
  BarChart3,
  Download,
  Settings2,
} from "lucide-react";

const ATTENDANCE_CONFIG: Record<
  AttendanceStatus,
  { label: string; color: string; icon: React.ElementType }
> = {
  present: { label: "Présent", color: "bg-green-100 text-green-700 hover:bg-green-200", icon: Check },
  absent: { label: "Absent", color: "bg-red-100 text-red-700 hover:bg-red-200", icon: X },
  retard: { label: "Retard", color: "bg-yellow-100 text-yellow-700 hover:bg-yellow-200", icon: Clock },
  excuse: { label: "Excusé", color: "bg-blue-100 text-blue-700 hover:bg-blue-200", icon: UserCheck },
};

// ---- Evaluation Detail Sub-component ----
function EvaluationDetail({
  evaluation,
  students,
  onBack,
}: {
  evaluation: Evaluation;
  students: Student[];
  onBack: () => void;
}) {
  const [competencies, setCompetencies] = useState<CompetencyInfo[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [view, setView] = useState<"grades" | "competencies" | "contract">("grades");
  const [selectedCompIds, setSelectedCompIds] = useState<string[]>([]);
  const [savingComps, setSavingComps] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [comps, grs] = await Promise.all([
          api.getEvaluationCompetencies(evaluation.id),
          api.getGrades(evaluation.id),
        ]);
        setCompetencies(comps);
        setGrades(grs);
        setSelectedCompIds(comps.map((c) => c.id));
      } catch (err) {
        console.error(err);
      }
    };
    load();
  }, [evaluation.id]);

  const handleSaveCompetencies = async () => {
    setSavingComps(true);
    try {
      await api.updateEvaluation(
        evaluation.id,
        evaluation.title,
        evaluation.school_year,
        evaluation.trimester,
        selectedCompIds
      );
      const comps = await api.getEvaluationCompetencies(evaluation.id);
      setCompetencies(comps);
      setView("grades");
    } catch (err) {
      console.error(err);
    } finally {
      setSavingComps(false);
    }
  };

  const getGradeLevel = (studentId: string, competencyId: string): MasteryLevel => {
    const grade = grades.find(
      (g) => g.student_id === studentId && g.competency_id === competencyId
    );
    return (grade?.level ?? 0) as MasteryLevel;
  };

  const handleGrade = async (studentId: string, competencyId: string, level: MasteryLevel) => {
    try {
      await api.setGrade(evaluation.id, studentId, competencyId, level);
      setGrades((prev) => {
        const idx = prev.findIndex(
          (g) => g.student_id === studentId && g.competency_id === competencyId
        );
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], level };
          return updated;
        }
        return [
          ...prev,
          {
            id: "",
            evaluation_id: evaluation.id,
            student_id: studentId,
            competency_id: competencyId,
            level,
            comment: "",
          },
        ];
      });
    } catch (err) {
      console.error(err);
    }
  };

  const cycleMasteryLevels: MasteryLevel[] = [0, 1, 2, 3, 4, 5];

  return (
    <div className="space-y-4 max-w-7xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h3 className="text-lg font-semibold">{evaluation.title}</h3>
          <p className="text-sm text-muted-foreground">
            {evaluation.school_year === "4eme" ? "4ème" : "3ème"} — Trimestre{" "}
            {evaluation.trimester}
          </p>
        </div>
        <div className="flex gap-1">
          <Button
            variant={view === "grades" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("grades")}
          >
            <ClipboardList className="h-4 w-4 mr-1" />
            Notes
          </Button>
          <Button
            variant={view === "competencies" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("competencies")}
          >
            <Settings2 className="h-4 w-4 mr-1" />
            Compétences
          </Button>
          <Button
            variant={view === "contract" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("contract")}
          >
            <FileText className="h-4 w-4 mr-1" />
            Fiche Contrat
          </Button>
        </div>
      </div>

      {view === "contract" && (
        <ContractSheetEditor
          evaluationId={evaluation.id}
          evaluationTitle={evaluation.title}
          onBack={() => setView("grades")}
        />
      )}

      {view === "competencies" && (
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              Compétences liées ({selectedCompIds.length})
            </CardTitle>
            <Button size="sm" onClick={handleSaveCompetencies} disabled={savingComps}>
              <Save className="h-4 w-4 mr-2" />
              {savingComps ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </CardHeader>
          <CardContent>
            <CompetencyPicker
              selectedIds={selectedCompIds}
              onChange={setSelectedCompIds}
            />
          </CardContent>
        </Card>
      )}

      {view === "grades" && (
        <>
          {competencies.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">
              Aucune compétence liée à cette évaluation
            </p>
          </CardContent>
        </Card>
      ) : students.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">
              Aucun élève dans cette session
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-background z-10 min-w-[180px]">
                      Élève
                    </TableHead>
                    {competencies.map((comp) => (
                      <TableHead
                        key={comp.id}
                        className="text-center min-w-[120px] text-xs"
                      >
                        <div className="space-y-0.5">
                          <p className="font-medium">{comp.name}</p>
                          <p className="text-muted-foreground font-normal">
                            {comp.field_name}
                          </p>
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {students.map((student) => (
                    <TableRow key={student.id}>
                      <TableCell className="sticky left-0 bg-background z-10 font-medium">
                        {student.last_name} {student.first_name}
                      </TableCell>
                      {competencies.map((comp) => {
                        const level = getGradeLevel(student.id, comp.id);
                        return (
                          <TableCell key={comp.id} className="text-center p-1">
                            <select
                              value={level}
                              onChange={(e) =>
                                handleGrade(
                                  student.id,
                                  comp.id,
                                  Number(e.target.value) as MasteryLevel
                                )
                              }
                              className={`w-full text-xs p-1.5 rounded border-0 cursor-pointer text-center ${MASTERY_COLORS[level]}`}
                            >
                              {cycleMasteryLevels.map((l) => (
                                <option key={l} value={l}>
                                  {MASTERY_LABELS[l]}
                                </option>
                              ))}
                            </select>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-2 text-xs">
        {cycleMasteryLevels.map((level) => (
          <span
            key={level}
            className={`px-2 py-1 rounded ${MASTERY_COLORS[level]}`}
          >
            {MASTERY_LABELS[level]}
          </span>
        ))}
      </div>
        </>
      )}
    </div>
  );
}

// ---- Séance Detail Sub-component ----
function SeanceDetail({
  seance,
  onBack,
  onUpdated,
}: {
  seance: Seance;
  onBack: () => void;
  onUpdated: () => void;
}) {
  const [attendance, setAttendance] = useState<AttendanceWithStudent[]>([]);
  const [contentHtml, setContentHtml] = useState(seance.content_html);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"attendance" | "cahier">("attendance");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(seance.title);
  const [dateDraft, setDateDraft] = useState(seance.start_date?.split("T")[0] || "");

  const loadAttendance = useCallback(async () => {
    try {
      const data = await api.getAttendance(seance.id);
      setAttendance(data);
    } catch (err) {
      console.error(err);
    }
  }, [seance.id]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  const handleStatusChange = async (studentId: string, status: AttendanceStatus) => {
    try {
      await api.setAttendance(seance.id, studentId, status);
      setAttendance((prev) =>
        prev.map((a) => (a.student_id === studentId ? { ...a, status } : a))
      );
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveCahier = async () => {
    setSaving(true);
    try {
      await api.updateSeance(
        seance.id,
        seance.title,
        seance.start_date,
        seance.end_date,
        contentHtml
      );
      onUpdated();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTitleDate = async () => {
    try {
      await api.updateSeance(
        seance.id,
        titleDraft.trim() || seance.title,
        dateDraft || null,
        seance.end_date,
        seance.content_html
      );
      setEditingTitle(false);
      onUpdated();
    } catch (err) {
      console.error(err);
    }
  };

  const absentCount = attendance.filter((a) => a.status === "absent").length;
  const retardCount = attendance.filter((a) => a.status === "retard").length;
  const excuseCount = attendance.filter((a) => a.status === "excuse").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {editingTitle ? (
          <div className="flex-1 flex items-center gap-2">
            <Input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveTitleDate(); if (e.key === "Escape") setEditingTitle(false); }}
              autoFocus
              className="h-8 text-base font-semibold max-w-[300px]"
            />
            <Input
              type="date"
              value={dateDraft}
              onChange={(e) => setDateDraft(e.target.value)}
              className="h-8 w-[160px]"
            />
            <Button size="sm" onClick={handleSaveTitleDate}>
              <Save className="h-3.5 w-3.5 mr-1" />
              OK
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditingTitle(false); setTitleDraft(seance.title); setDateDraft(seance.start_date?.split("T")[0] || ""); }}>
              Annuler
            </Button>
          </div>
        ) : (
          <div
            className="group flex items-center gap-2 cursor-pointer"
            onClick={() => { setTitleDraft(seance.title); setDateDraft(seance.start_date?.split("T")[0] || ""); setEditingTitle(true); }}
          >
            <div>
              <h3 className="text-lg font-semibold">{seance.title}</h3>
              {seance.start_date && (
                <p className="text-sm text-muted-foreground">
                  {new Date(seance.start_date).toLocaleDateString("fr-FR", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              )}
            </div>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          variant={tab === "attendance" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("attendance")}
        >
          <UserCheck className="h-4 w-4 mr-2" />
          Appel ({attendance.length})
        </Button>
        <Button
          variant={tab === "cahier" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("cahier")}
        >
          <BookOpen className="h-4 w-4 mr-2" />
          Cahier de texte
        </Button>
      </div>

      {tab === "attendance" && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Appel</CardTitle>
              <div className="flex gap-2 text-xs">
                {absentCount > 0 && (
                  <Badge variant="outline" className="bg-red-50 text-red-600">
                    {absentCount} absent{absentCount > 1 ? "s" : ""}
                  </Badge>
                )}
                {retardCount > 0 && (
                  <Badge variant="outline" className="bg-yellow-50 text-yellow-600">
                    {retardCount} retard{retardCount > 1 ? "s" : ""}
                  </Badge>
                )}
                {excuseCount > 0 && (
                  <Badge variant="outline" className="bg-blue-50 text-blue-600">
                    {excuseCount} excusé{excuseCount > 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {attendance.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Aucun élève dans cette session
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Élève</TableHead>
                    <TableHead>Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attendance.map((record) => (
                    <TableRow key={record.student_id}>
                      <TableCell className="font-medium w-[200px]">
                        {record.student_last_name} {record.student_first_name}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {(Object.keys(ATTENDANCE_CONFIG) as AttendanceStatus[]).map(
                            (status) => {
                              const config = ATTENDANCE_CONFIG[status];
                              const Icon = config.icon;
                              const isActive = record.status === status;
                              return (
                                <Button
                                  key={status}
                                  variant="ghost"
                                  size="sm"
                                  className={`h-8 px-2 text-xs gap-1 ${
                                    isActive ? config.color : "text-muted-foreground"
                                  }`}
                                  onClick={() =>
                                    handleStatusChange(record.student_id, status)
                                  }
                                >
                                  <Icon className="h-3.5 w-3.5" />
                                  <span className="hidden sm:inline">{config.label}</span>
                                </Button>
                              );
                            }
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "cahier" && (
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Cahier de texte</CardTitle>
            <Button size="sm" onClick={handleSaveCahier} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </CardHeader>
          <CardContent>
            <RichEditor content={contentHtml} onChange={setContentHtml} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---- Bilans Sub-component ----
function BilansTab({ sessionId }: { sessionId: string }) {
  const [schoolYear, setSchoolYear] = useState<string>("4eme");
  const [trimester, setTrimester] = useState<string>("1");
  const [reports, setReports] = useState<StudentReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getReport(sessionId, schoolYear, Number(trimester));
      setReports(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [sessionId, schoolYear, trimester]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleSaveComment = async (studentId: string) => {
    try {
      await api.saveReportComment(studentId, schoolYear, Number(trimester), commentText);
      setEditingComment(null);
      loadReport();
    } catch (err) {
      console.error(err);
    }
  };

  const getMasteryColor = (avg: number): string => {
    if (avg === 0) return "bg-gray-200";
    if (avg < 1.5) return "bg-red-200";
    if (avg < 2.5) return "bg-orange-200";
    if (avg < 3.5) return "bg-yellow-200";
    if (avg < 4.5) return "bg-green-200";
    return "bg-emerald-200";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Label className="text-sm">Année :</Label>
          <Select value={schoolYear} onValueChange={setSchoolYear}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="4eme">4ème</SelectItem>
              <SelectItem value="3eme">3ème</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm">Trimestre :</Label>
          <Select value={trimester} onValueChange={setTrimester}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Trimestre 1</SelectItem>
              <SelectItem value="2">Trimestre 2</SelectItem>
              <SelectItem value="3">Trimestre 3</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1" />
        {reports.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              exportReportPDF(reports, "Session", schoolYear, Number(trimester))
            }
          >
            <Download className="h-4 w-4 mr-2" />
            Exporter PDF
          </Button>
        )}
      </div>

      {loading ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">Chargement...</p>
          </CardContent>
        </Card>
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <BarChart3 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Aucun élève dans cette session</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {reports.map((report) => (
            <Card key={report.student_id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {report.student_last_name} {report.student_first_name}
                  </CardTitle>
                  <div className="flex items-center gap-3 text-xs">
                    <Badge variant="outline" className={`${getMasteryColor(report.overall_average)}`}>
                      Moyenne : {report.overall_average.toFixed(1)}/5
                    </Badge>
                    <span className="text-muted-foreground">
                      Présences : {report.attendance_stats.present}/{report.attendance_stats.total_seances}
                      {report.attendance_stats.absent > 0 && (
                        <span className="text-red-500 ml-1">
                          ({report.attendance_stats.absent} abs.)
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {report.competency_averages.length > 0 && (
                  <div className="space-y-1">
                    {report.competency_averages.map((ca) => (
                      <div key={ca.competency_id} className="flex items-center gap-2">
                        <div className="flex-1 text-xs">
                          <span className="text-muted-foreground">{ca.domain_name} › {ca.field_name} › </span>
                          <span className="font-medium">{ca.competency_name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div
                            className={`h-2 rounded-full ${getMasteryColor(ca.average_level)}`}
                            style={{ width: `${(ca.average_level / 5) * 80}px` }}
                          />
                          <span className="text-xs font-medium w-8 text-right">
                            {ca.average_level.toFixed(1)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Teacher comment */}
                <div className="border-t pt-3">
                  {editingComment === report.student_id ? (
                    <div className="space-y-2">
                      <textarea
                        className="w-full text-sm border rounded-md p-2 min-h-[60px] bg-background"
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder="Commentaire de l'enseignant..."
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleSaveComment(report.student_id)}>
                          <Save className="h-3 w-3 mr-1" />
                          Enregistrer
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingComment(null)}>
                          Annuler
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="flex items-start gap-2 cursor-pointer group"
                      onClick={() => {
                        setEditingComment(report.student_id);
                        setCommentText(report.teacher_comment);
                      }}
                    >
                      <p className="text-sm text-muted-foreground flex-1 italic">
                        {report.teacher_comment || "Cliquez pour ajouter un commentaire..."}
                      </p>
                      <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 mt-1" />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Main Component ----
export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [students, setStudents] = useState<Student[]>([]);
  const [seances, setSeances] = useState<Seance[]>([]);
  const [selectedSeance, setSelectedSeance] = useState<Seance | null>(null);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [selectedEvaluation, setSelectedEvaluation] = useState<Evaluation | null>(null);

  // Student dialogs
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [deleteStudent, setDeleteStudent] = useState<Student | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  
  // Séance dialogs
  const [editSeance, setEditSeance] = useState<Seance | null>(null);
  const [deleteSeance, setDeleteSeance] = useState<Seance | null>(null);
  const [seanceTitle, setSeanceTitle] = useState("");
  const [seanceDate, setSeanceDate] = useState("");

  // Evaluation dialogs
  const [showAddEval, setShowAddEval] = useState(false);
  const [deleteEval, setDeleteEval] = useState<Evaluation | null>(null);
  const [evalTitle, setEvalTitle] = useState("");
  const [evalYear, setEvalYear] = useState<string>("4eme");
  const [evalTrimester, setEvalTrimester] = useState<string>("1");
  const [evalCompIds, setEvalCompIds] = useState<string[]>([]);

  const [error, setError] = useState("");

  const loadStudents = useCallback(async () => {
    if (!sessionId) return;
    try {
      const data = await api.getStudents(sessionId);
      setStudents(data);
    } catch (err) {
      console.error(err);
    }
  }, [sessionId]);

  const loadSeances = useCallback(async () => {
    if (!sessionId) return;
    try {
      const data = await api.getSeances(sessionId);
      setSeances(data);
    } catch (err) {
      console.error(err);
    }
  }, [sessionId]);

  const loadEvaluations = useCallback(async () => {
    if (!sessionId) return;
    try {
      const data = await api.getEvaluations(sessionId);
      setEvaluations(data);
    } catch (err) {
      console.error(err);
    }
  }, [sessionId]);

  useEffect(() => {
    loadStudents();
    loadSeances();
    loadEvaluations();
  }, [loadStudents, loadSeances, loadEvaluations]);

  const handleAddStudent = async () => {
    if (!sessionId) return;
    setError("");
    try {
      await api.createStudent(sessionId, firstName, lastName);
      setShowAddStudent(false);
      setFirstName("");
      setLastName("");
      loadStudents();
    } catch (err) {
      setError(err as string);
    }
  };

  const handleEditStudent = async () => {
    if (!editStudent) return;
    setError("");
    try {
      await api.updateStudent(editStudent.id, firstName, lastName);
      setEditStudent(null);
      setFirstName("");
      setLastName("");
      loadStudents();
    } catch (err) {
      setError(err as string);
    }
  };

  const handleDeleteStudent = async () => {
    if (!deleteStudent) return;
    try {
      await api.deleteStudent(deleteStudent.id);
      setDeleteStudent(null);
      loadStudents();
    } catch (err) {
      console.error(err);
    }
  };

  // Séance handlers
  const handleAddSeance = async () => {
    if (!sessionId) return;
    try {
      const today = new Date().toISOString().split("T")[0];
      const defaultTitle = `Séance du ${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`;
      const seance = await api.createSeance(sessionId, defaultTitle, today, null);
      loadSeances();
      setSelectedSeance(seance);
    } catch (err) {
      console.error(err);
    }
  };

  const handleEditSeance = async () => {
    if (!editSeance) return;
    setError("");
    try {
      await api.updateSeance(
        editSeance.id,
        seanceTitle,
        seanceDate || null,
        editSeance.end_date,
        editSeance.content_html
      );
      setEditSeance(null);
      setSeanceTitle("");
      setSeanceDate("");
      loadSeances();
    } catch (err) {
      setError(err as string);
    }
  };

  const handleDeleteSeance = async () => {
    if (!deleteSeance) return;
    try {
      await api.deleteSeance(deleteSeance.id);
      setDeleteSeance(null);
      if (selectedSeance?.id === deleteSeance.id) setSelectedSeance(null);
      loadSeances();
    } catch (err) {
      console.error(err);
    }
  };

  // Evaluation handlers
  const handleAddEvaluation = async () => {
    if (!sessionId) return;
    setError("");
    try {
      await api.createEvaluation(
        sessionId,
        evalTitle,
        evalYear,
        Number(evalTrimester),
        evalCompIds
      );
      setShowAddEval(false);
      setEvalTitle("");
      setEvalCompIds([]);
      loadEvaluations();
    } catch (err) {
      setError(err as string);
    }
  };

  const handleDeleteEvaluation = async () => {
    if (!deleteEval) return;
    try {
      await api.deleteEvaluation(deleteEval.id);
      setDeleteEval(null);
      if (selectedEvaluation?.id === deleteEval.id) setSelectedEvaluation(null);
      loadEvaluations();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="p-8 max-w-7xl">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" onClick={() => navigate("/sessions")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Détail de la session</h1>
        </div>
      </div>

      <Tabs defaultValue="students">
        <TabsList>
          <TabsTrigger value="students">Élèves</TabsTrigger>
          <TabsTrigger value="evaluations">Évaluations</TabsTrigger>
          <TabsTrigger value="seances">Séances</TabsTrigger>
          <TabsTrigger value="reports">Bilans</TabsTrigger>
        </TabsList>

        <TabsContent value="students" className="mt-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Élèves</CardTitle>
              <Button
                size="sm"
                onClick={() => {
                  setShowAddStudent(true);
                  setFirstName("");
                  setLastName("");
                  setError("");
                }}
              >
                <Plus className="h-4 w-4" />
                Ajouter un élève
              </Button>
            </CardHeader>
            <CardContent>
              {students.length === 0 ? (
                <div className="py-8 text-center">
                  <UserPlus className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">Aucun élève dans cette session</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nom</TableHead>
                      <TableHead>Prénom</TableHead>
                      <TableHead className="w-24 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {students.map((student) => (
                      <TableRow key={student.id}>
                        <TableCell className="font-medium">
                          {student.last_name}
                        </TableCell>
                        <TableCell>{student.first_name}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => {
                                setEditStudent(student);
                                setFirstName(student.first_name);
                                setLastName(student.last_name);
                                setError("");
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => setDeleteStudent(student)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="evaluations" className="mt-6">
          {selectedEvaluation ? (
            <EvaluationDetail
              evaluation={selectedEvaluation}
              students={students}
              onBack={() => setSelectedEvaluation(null)}
            />
          ) : (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Évaluations</CardTitle>
                <Button
                  size="sm"
                  onClick={() => {
                    setShowAddEval(true);
                    setEvalTitle("");
                    setEvalYear("4eme");
                    setEvalTrimester("1");
                    setEvalCompIds([]);
                    setError("");
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Nouvelle évaluation
                </Button>
              </CardHeader>
              <CardContent>
                {evaluations.length === 0 ? (
                  <div className="py-8 text-center">
                    <ClipboardList className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">Aucune évaluation</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {evaluations.map((eval_) => (
                      <div
                        key={eval_.id}
                        className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 cursor-pointer transition-colors"
                        onClick={() => setSelectedEvaluation(eval_)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="bg-primary/10 text-primary rounded-lg p-2">
                            <FileText className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{eval_.title}</p>
                            <div className="flex gap-2 text-xs text-muted-foreground">
                              <Badge variant="outline" className="text-xs">
                                {eval_.school_year === "4eme" ? "4ème" : "3ème"}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                T{eval_.trimester}
                              </Badge>
                              <span>
                                {eval_.competency_ids.length} compétence
                                {eval_.competency_ids.length > 1 ? "s" : ""}
                              </span>
                            </div>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteEval(eval_);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="seances" className="mt-6">
          {selectedSeance ? (
            <SeanceDetail
              seance={selectedSeance}
              onBack={() => setSelectedSeance(null)}
              onUpdated={loadSeances}
            />
          ) : (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Séances</CardTitle>
                <Button size="sm" onClick={handleAddSeance}>
                  <Plus className="h-4 w-4" />
                  Nouvelle séance
                </Button>
              </CardHeader>
              <CardContent>
                {seances.length === 0 ? (
                  <div className="py-8 text-center">
                    <Calendar className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">Aucune séance</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {seances.map((seance) => (
                      <div
                        key={seance.id}
                        className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 cursor-pointer transition-colors"
                        onClick={() => setSelectedSeance(seance)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="bg-primary/10 text-primary rounded-lg p-2">
                            <BookOpen className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{seance.title}</p>
                            {seance.start_date && (
                              <p className="text-xs text-muted-foreground">
                                {new Date(seance.start_date).toLocaleDateString("fr-FR", {
                                  weekday: "short",
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                })}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditSeance(seance);
                              setSeanceTitle(seance.title);
                              setSeanceDate(seance.start_date?.split("T")[0] || "");
                              setError("");
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteSeance(seance);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="reports" className="mt-6">
          {sessionId && <BilansTab sessionId={sessionId} />}
        </TabsContent>
      </Tabs>

      {/* Add Student Dialog */}
      <Dialog open={showAddStudent} onOpenChange={setShowAddStudent}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajouter un élève</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nom</Label>
              <Input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Nom de famille"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Prénom</Label>
              <Input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Prénom"
                onKeyDown={(e) => e.key === "Enter" && handleAddStudent()}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddStudent(false)}>
              Annuler
            </Button>
            <Button onClick={handleAddStudent}>Ajouter</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Student Dialog */}
      <Dialog open={!!editStudent} onOpenChange={() => setEditStudent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier l'élève</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nom</Label>
              <Input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Nom de famille"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Prénom</Label>
              <Input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Prénom"
                onKeyDown={(e) => e.key === "Enter" && handleEditStudent()}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditStudent(null)}>
              Annuler
            </Button>
            <Button onClick={handleEditStudent}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Student Confirmation */}
      <AlertDialog open={!!deleteStudent} onOpenChange={() => setDeleteStudent(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer l'élève</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer {deleteStudent?.first_name} {deleteStudent?.last_name} ?
              Toutes les notes et présences associées seront supprimées.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteStudent}>
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Séance Dialog */}
      <Dialog open={!!editSeance} onOpenChange={() => setEditSeance(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier la séance</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Titre</Label>
              <Input
                value={seanceTitle}
                onChange={(e) => setSeanceTitle(e.target.value)}
                placeholder="Titre de la séance"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={seanceDate}
                onChange={(e) => setSeanceDate(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleEditSeance()}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSeance(null)}>
              Annuler
            </Button>
            <Button onClick={handleEditSeance}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Séance Confirmation */}
      <AlertDialog open={!!deleteSeance} onOpenChange={() => setDeleteSeance(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer la séance</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer « {deleteSeance?.title} » ?
              Toutes les présences associées seront supprimées.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSeance}>
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Evaluation Dialog */}
      <Dialog open={showAddEval} onOpenChange={setShowAddEval}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nouvelle évaluation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Titre</Label>
              <Input
                value={evalTitle}
                onChange={(e) => setEvalTitle(e.target.value)}
                placeholder="Titre de l'évaluation"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Année scolaire</Label>
                <Select value={evalYear} onValueChange={setEvalYear}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="4eme">4ème</SelectItem>
                    <SelectItem value="3eme">3ème</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Trimestre</Label>
                <Select value={evalTrimester} onValueChange={setEvalTrimester}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Trimestre 1</SelectItem>
                    <SelectItem value="2">Trimestre 2</SelectItem>
                    <SelectItem value="3">Trimestre 3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Compétences ({evalCompIds.length} sélectionnées)</Label>
              <CompetencyPicker
                selectedIds={evalCompIds}
                onChange={setEvalCompIds}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddEval(false)}>
              Annuler
            </Button>
            <Button onClick={handleAddEvaluation}>Créer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Evaluation Confirmation */}
      <AlertDialog open={!!deleteEval} onOpenChange={() => setDeleteEval(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer l'évaluation</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer « {deleteEval?.title} » ?
              Toutes les notes associées seront supprimées.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteEvaluation}>
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
