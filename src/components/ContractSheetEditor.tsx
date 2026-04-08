import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import type { ContractSheet, ContractSheetRow } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ArrowLeft, Save, Plus, Trash2 } from "lucide-react";

interface ContractSheetEditorProps {
  evaluationId: string;
  evaluationTitle: string;
  onBack: () => void;
}

interface RowData {
  studentActivity: string;
  trainingActivity: string;
  socleDomainText: string;
  socleCompetencyText: string;
}

export function ContractSheetEditor({
  evaluationId,
  evaluationTitle,
  onBack,
}: ContractSheetEditorProps) {
  const { user } = useAuth();
  const [projectTitle, setProjectTitle] = useState("");
  const [professionalField, setProfessionalField] = useState("");
  const [socleDomain, setSocleDomain] = useState("");
  const [referenceActivities, setReferenceActivities] = useState("");
  const [targetCareers, setTargetCareers] = useState("");
  const [givenText, setGivenText] = useState("");
  const [askedText, setAskedText] = useState("");
  const [requiredText, setRequiredText] = useState("");
  const [rows, setRows] = useState<RowData[]>([]);
  const [professionalFields, setProfessionalFields] = useState<
    [string, string][]
  >([]);
  const [newFieldName, setNewFieldName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [sheet, fields] = await Promise.all([
        api.getContractSheet(evaluationId),
        api.getProfessionalFields(user.id),
      ]);
      setProfessionalFields(fields);

      if (sheet) {
        setProjectTitle(sheet.project_title);
        setProfessionalField(sheet.professional_field);
        setSocleDomain(sheet.socle_domain);
        setReferenceActivities(sheet.reference_activities);
        setTargetCareers(sheet.target_careers);
        setGivenText(sheet.given_text);
        setAskedText(sheet.asked_text);
        setRequiredText(sheet.required_text);
        if ((sheet as ContractSheet & { rows?: ContractSheetRow[] }).rows) {
          setRows(
            (sheet as ContractSheet & { rows: ContractSheetRow[] }).rows.map(
              (r) => ({
                studentActivity: r.student_activity,
                trainingActivity: r.training_activity,
                socleDomainText: r.socle_domain_text,
                socleCompetencyText: r.socle_competency_text,
              })
            )
          );
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [evaluationId, user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await api.saveContractSheet(
        evaluationId,
        projectTitle,
        professionalField,
        socleDomain,
        referenceActivities,
        targetCareers,
        givenText,
        askedText,
        requiredText,
        rows.map((r) => [
          r.studentActivity,
          r.trainingActivity,
          r.socleDomainText,
          r.socleCompetencyText,
        ])
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const addRow = () => {
    setRows([
      ...rows,
      {
        studentActivity: "",
        trainingActivity: "",
        socleDomainText: "",
        socleCompetencyText: "",
      },
    ]);
  };

  const removeRow = (index: number) => {
    setRows(rows.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, field: keyof RowData, value: string) => {
    setRows(rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const handleAddField = async () => {
    if (!user || !newFieldName.trim()) return;
    try {
      const field = await api.createProfessionalField(
        user.id,
        newFieldName.trim()
      );
      setProfessionalFields((prev) => [...prev, field]);
      setProfessionalField(newFieldName.trim());
      setNewFieldName("");
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h3 className="text-lg font-semibold">Fiche Contrat</h3>
        </div>
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">Chargement...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h3 className="text-lg font-semibold">Fiche Contrat</h3>
            <p className="text-sm text-muted-foreground">{evaluationTitle}</p>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Enregistrement..." : saved ? "Enregistré !" : "Enregistrer"}
        </Button>
      </div>

      {/* Header fields */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Informations générales</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Titre du projet</Label>
              <Input
                value={projectTitle}
                onChange={(e) => setProjectTitle(e.target.value)}
                placeholder="Ex: Réalisation d'un objet technique"
              />
            </div>
            <div className="space-y-2">
              <Label>Champ professionnel</Label>
              <div className="flex gap-2">
                <Select
                  value={professionalField}
                  onValueChange={setProfessionalField}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Sélectionner..." />
                  </SelectTrigger>
                  <SelectContent>
                    {professionalFields.map(([id, name]) => (
                      <SelectItem key={id} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Input
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  placeholder="Nouveau champ..."
                  className="h-8 text-xs"
                  onKeyDown={(e) => e.key === "Enter" && handleAddField()}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={handleAddField}
                  disabled={!newFieldName.trim()}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Domaine du socle</Label>
              <Input
                value={socleDomain}
                onChange={(e) => setSocleDomain(e.target.value)}
                placeholder="Ex: Domaine 4 - Systèmes techniques"
              />
            </div>
            <div className="space-y-2">
              <Label>Métiers visés</Label>
              <Input
                value={targetCareers}
                onChange={(e) => setTargetCareers(e.target.value)}
                placeholder="Ex: Électricien, Plombier..."
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Activités de référence</Label>
            <textarea
              className="w-full text-sm border rounded-md p-2 min-h-[60px] bg-background"
              value={referenceActivities}
              onChange={(e) => setReferenceActivities(e.target.value)}
              placeholder="Activités de référence du champ professionnel..."
            />
          </div>
        </CardContent>
      </Card>

      {/* On donne / On demande / On exige */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Consignes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-green-700 font-semibold">On donne</Label>
            <textarea
              className="w-full text-sm border rounded-md p-2 min-h-[50px] bg-background border-green-200"
              value={givenText}
              onChange={(e) => setGivenText(e.target.value)}
              placeholder="Ce qui est donné à l'élève..."
            />
          </div>
          <div className="space-y-2">
            <Label className="text-blue-700 font-semibold">On demande</Label>
            <textarea
              className="w-full text-sm border rounded-md p-2 min-h-[50px] bg-background border-blue-200"
              value={askedText}
              onChange={(e) => setAskedText(e.target.value)}
              placeholder="Ce qui est demandé à l'élève..."
            />
          </div>
          <div className="space-y-2">
            <Label className="text-red-700 font-semibold">On exige</Label>
            <textarea
              className="w-full text-sm border rounded-md p-2 min-h-[50px] bg-background border-red-200"
              value={requiredText}
              onChange={(e) => setRequiredText(e.target.value)}
              placeholder="Ce qui est exigé..."
            />
          </div>
        </CardContent>
      </Card>

      {/* Activity rows table */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Activités ({rows.length})
          </CardTitle>
          <Button size="sm" variant="outline" onClick={addRow}>
            <Plus className="h-4 w-4 mr-1" />
            Ajouter une ligne
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Aucune activité. Cliquez sur « Ajouter une ligne » pour commencer.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[180px]">
                      Activité de l'élève
                    </TableHead>
                    <TableHead className="min-w-[180px]">
                      Activité de formation
                    </TableHead>
                    <TableHead className="min-w-[150px]">
                      Domaine du socle
                    </TableHead>
                    <TableHead className="min-w-[150px]">
                      Compétence du socle
                    </TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="p-1">
                        <textarea
                          className="w-full text-xs border rounded p-1.5 min-h-[40px] bg-background resize-y"
                          value={row.studentActivity}
                          onChange={(e) =>
                            updateRow(i, "studentActivity", e.target.value)
                          }
                        />
                      </TableCell>
                      <TableCell className="p-1">
                        <textarea
                          className="w-full text-xs border rounded p-1.5 min-h-[40px] bg-background resize-y"
                          value={row.trainingActivity}
                          onChange={(e) =>
                            updateRow(i, "trainingActivity", e.target.value)
                          }
                        />
                      </TableCell>
                      <TableCell className="p-1">
                        <textarea
                          className="w-full text-xs border rounded p-1.5 min-h-[40px] bg-background resize-y"
                          value={row.socleDomainText}
                          onChange={(e) =>
                            updateRow(i, "socleDomainText", e.target.value)
                          }
                        />
                      </TableCell>
                      <TableCell className="p-1">
                        <textarea
                          className="w-full text-xs border rounded p-1.5 min-h-[40px] bg-background resize-y"
                          value={row.socleCompetencyText}
                          onChange={(e) =>
                            updateRow(i, "socleCompetencyText", e.target.value)
                          }
                        />
                      </TableCell>
                      <TableCell className="p-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => removeRow(i)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
