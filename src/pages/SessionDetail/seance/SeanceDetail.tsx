import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  BookOpen,
  Check,
  CheckCheck,
  Circle,
  Clock,
  Pencil,
  RotateCcw,
  Save,
  ShieldCheck,
  UserCheck,
  X,
} from "lucide-react";

import { DataState } from "@/components/DataState";
import { RichEditor } from "@/components/RichEditor";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/pages/SessionDetail/dialogs/ConfirmDialog";
import { useDraftGuard } from "@/hooks/useDrafts";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CANCEL_REASON_SUGGESTIONS } from "@/types";
import type {
  AttendanceStatus,
  AttendanceWithStudent,
  Seance,
  Student,
} from "@/types";

export interface SeanceDetailProps {
  seance: Seance;
  students: Student[];
  onBack: () => void;
  /** Recharge la liste du parent. À appeler après toute écriture. */
  onChanged: () => Promise<void>;
}

/** Ordre d'affichage des boutons d'appel : les cas courants d'abord. */
const STATUS_ORDER: AttendanceStatus[] = [
  "present",
  "absent",
  "retard",
  "excuse",
  "non_fait",
];

const STATUS_CONFIG: Record<
  AttendanceStatus,
  {
    label: string;
    one: string;
    many: string;
    icon: ComponentType<{ className?: string }>;
    /** Bouton sélectionné pour cet élève. */
    active: string;
    /** Pastille de comptage. */
    chip: string;
  }
> = {
  present: {
    label: "Présent",
    one: "présent",
    many: "présents",
    icon: Check,
    active: "bg-green-100 text-green-800 hover:bg-green-100",
    chip: "border-green-200 bg-green-50 text-green-700",
  },
  absent: {
    label: "Absent",
    one: "absent",
    many: "absents",
    icon: X,
    active: "bg-red-100 text-red-800 hover:bg-red-100",
    chip: "border-red-200 bg-red-50 text-red-700",
  },
  retard: {
    label: "Retard",
    one: "retard",
    many: "retards",
    icon: Clock,
    active: "bg-orange-100 text-orange-800 hover:bg-orange-100",
    chip: "border-orange-200 bg-orange-50 text-orange-700",
  },
  excuse: {
    label: "Excusé",
    one: "excusé",
    many: "excusés",
    icon: ShieldCheck,
    active: "bg-blue-100 text-blue-800 hover:bg-blue-100",
    chip: "border-blue-200 bg-blue-50 text-blue-700",
  },
  non_fait: {
    label: "Non fait",
    one: "non renseigné",
    many: "non renseignés",
    icon: Circle,
    active: "bg-amber-100 text-amber-900 hover:bg-amber-100",
    chip: "border-amber-200 bg-amber-50 text-amber-800",
  },
};

type TrimesterChoice = "auto" | "1" | "2" | "3";

function formatLongDate(iso: string): string {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatShortDate(iso: string): string {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR");
}

function messageOf(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Une erreur inattendue est survenue.";
}

function choiceOf(seance: Seance): TrimesterChoice {
  return seance.trimester_is_manual
    ? (String(seance.trimester) as TrimesterChoice)
    : "auto";
}

export function SeanceDetail({
  seance,
  students,
  onBack,
  onChanged,
}: SeanceDetailProps) {
  const [tab, setTab] = useState<"appel" | "cahier">("appel");

  // ---- Bloc « informations » : titre, date, trimestre, annulation ----
  // Ces quatre champs ne partent QUE par api.updateSeanceMeta.
  const [metaOpen, setMetaOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState(seance.title);
  const [dateDraft, setDateDraft] = useState(seance.date);
  const [choiceDraft, setChoiceDraft] = useState<TrimesterChoice>(
    choiceOf(seance),
  );
  const [cancelledDraft, setCancelledDraft] = useState(seance.cancelled);
  const [reasonDraft, setReasonDraft] = useState(seance.cancel_reason);
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  const metaDirty =
    metaOpen &&
    (titleDraft !== seance.title ||
      dateDraft !== seance.date ||
      choiceDraft !== choiceOf(seance) ||
      cancelledDraft !== seance.cancelled ||
      // Le motif compte comme modification même s'il est le seul à bouger :
      // corriger « Sortie » en « Sortie scolaire » est une saisie à enregistrer.
      reasonDraft !== seance.cancel_reason);

  // ---- Cahier de texte ----
  // Ce brouillon ne part QUE par api.updateSeanceContent. Il est initialisé une
  // seule fois : le parent monte ce composant avec key={seance.id}, donc passer
  // d'une séance à l'autre remonte le composant et rejoue cet initialiseur.
  const [contentDraft, setContentDraft] = useState(seance.content_html);
  const [savedContent, setSavedContent] = useState(seance.content_html);
  // TipTap renormalise le HTML au chargement : sans ce drapeau, une séance
  // jamais modifiée s'afficherait d'emblée comme « non enregistrée ».
  const [contentTouched, setContentTouched] = useState(false);
  const [savingContent, setSavingContent] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  const contentDirty = contentTouched && contentDraft !== savedContent;

  // ---- Appel ----
  const [attendance, setAttendance] = useState<AttendanceWithStudent[]>([]);
  const [attLoading, setAttLoading] = useState(true);
  // Deux erreurs distinctes : celle du chargement remplace la liste (DataState),
  // celle d'une écriture s'affiche au-dessus sans faire disparaître l'appel déjà
  // saisi à l'écran.
  const [attLoadError, setAttLoadError] = useState<string | null>(null);
  const [attActionError, setAttActionError] = useState<string | null>(null);
  const [attBusy, setAttBusy] = useState(false);

  const [resetOpen, setResetOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const loadAttendance = useCallback(async () => {
    setAttLoading(true);
    setAttLoadError(null);
    try {
      setAttendance(await api.getAttendance(seance.id));
    } catch (err) {
      setAttLoadError(messageOf(err));
    } finally {
      setAttLoading(false);
    }
  }, [seance.id]);

  useEffect(() => {
    void loadAttendance();
  }, [loadAttendance]);

  const counts = useMemo(() => {
    const base: Record<AttendanceStatus, number> = {
      non_fait: 0,
      present: 0,
      absent: 0,
      retard: 0,
      excuse: 0,
    };
    for (const record of attendance) base[record.status] += 1;
    return base;
  }, [attendance]);

  const pending = counts.non_fait;
  const notConcerned = students.length - attendance.length;
  const hasUnsaved = metaDirty || contentDirty;

  /** Écrit uniquement les colonnes « méta » de la séance. */
  const persistMeta = async (values: {
    title: string;
    date: string;
    choice: TrimesterChoice;
    cancelled: boolean;
    cancelReason: string;
  }): Promise<boolean> => {
    const title = values.title.trim();
    if (!title) {
      setMetaError("Le titre de la séance ne peut pas être vide.");
      return false;
    }
    if (!values.date) {
      setMetaError("La date de la séance est obligatoire.");
      return false;
    }
    setSavingMeta(true);
    setMetaError(null);
    try {
      await api.updateSeanceMeta(
        seance.id,
        title,
        values.date,
        // L'horaire n'est pas éditable ici : il vient du créneau d'emploi du
        // temps et appartient au dossier historique de la séance. On le fait
        // transiter inchangé — l'écraser par une chaîne vide effacerait l'heure
        // d'un cours au simple renommage.
        seance.start_time,
        seance.end_time,
        values.choice === "auto" ? null : Number(values.choice),
        values.cancelled,
        // Le backend le vide lui-même si `cancelled` est faux : on ne duplique
        // pas la règle ici, sinon les deux divergeraient au premier ajustement.
        values.cancelReason,
      );
      await onChanged();
      setMetaOpen(false);
      return true;
    } catch (err) {
      setMetaError(messageOf(err));
      return false;
    } finally {
      setSavingMeta(false);
    }
  };

  const openMeta = () => {
    setTitleDraft(seance.title);
    setDateDraft(seance.date);
    setChoiceDraft(choiceOf(seance));
    setCancelledDraft(seance.cancelled);
    setReasonDraft(seance.cancel_reason);
    setMetaError(null);
    setMetaOpen(true);
  };

  const cancelMeta = () => {
    setTitleDraft(seance.title);
    setDateDraft(seance.date);
    setChoiceDraft(choiceOf(seance));
    setCancelledDraft(seance.cancelled);
    setReasonDraft(seance.cancel_reason);
    setMetaError(null);
    setMetaOpen(false);
  };

  /** Puce de trimestre. Fermée, elle écrit tout de suite ; ouverte, elle ne
   *  touche qu'au brouillon pour ne pas enregistrer à l'insu de l'utilisateur
   *  un titre ou une date en cours de saisie. */
  const handlePickTrimester = async (value: string) => {
    const choice = value as TrimesterChoice;
    setChoiceDraft(choice);
    if (metaOpen) return;
    const saved = await persistMeta({
      title: seance.title,
      date: seance.date,
      choice,
      cancelled: seance.cancelled,
      // La puce de trimestre ne touche QU'au trimestre : on fait transiter le
      // motif inchangé. L'omettre l'effacerait au simple reclassement.
      cancelReason: seance.cancel_reason,
    });
    // Échec : la puce doit retomber sur ce que la base contient vraiment.
    if (!saved) setChoiceDraft(choiceOf(seance));
  };

  const handleStatus = async (studentId: string, status: AttendanceStatus) => {
    const previous = attendance;
    setAttendance((prev) =>
      prev.map((record) =>
        record.student_id === studentId ? { ...record, status } : record,
      ),
    );
    setAttActionError(null);
    try {
      await api.setAttendance(seance.id, studentId, status);
      // Le premier pointage pose attendance_taken_at côté serveur : il faut
      // recharger la liste pour que le badge « Appel non fait » tombe.
      if (!seance.attendance_taken_at) await onChanged();
    } catch (err) {
      setAttendance(previous);
      setAttActionError(messageOf(err));
    }
  };

  /** Ne touche qu'aux élèves encore « non fait » : écraser un absent déjà
   *  pointé serait une perte de saisie. Pour tout effacer, il y a
   *  « Réinitialiser l'appel ». */
  const handleAllPresent = async () => {
    const records = attendance
      .filter((record) => record.status === "non_fait")
      .map((record) => ({
        student_id: record.student_id,
        status: "present" as const,
      }));
    if (records.length === 0) return;
    setAttBusy(true);
    setAttActionError(null);
    try {
      await api.setBulkAttendance(seance.id, records);
      await loadAttendance();
      await onChanged();
    } catch (err) {
      setAttActionError(messageOf(err));
    } finally {
      setAttBusy(false);
    }
  };

  const handleReset = async () => {
    setAttBusy(true);
    setAttActionError(null);
    try {
      await api.resetAttendance(seance.id);
      setResetOpen(false);
      await loadAttendance();
      await onChanged();
    } catch (err) {
      setAttActionError(messageOf(err));
    } finally {
      setAttBusy(false);
    }
  };

  /** Écrit le cahier de texte et laisse remonter l'échec : le registre des
   *  brouillons doit savoir si l'enregistrement est réellement passé. */
  const persistContent = async () => {
    setSavingContent(true);
    setContentError(null);
    try {
      await api.updateSeanceContent(seance.id, contentDraft);
      setSavedContent(contentDraft);
      setContentTouched(false);
    } finally {
      setSavingContent(false);
    }
  };

  const handleSaveContent = async () => {
    try {
      await persistContent();
      await onChanged();
    } catch (err) {
      setContentError(messageOf(err));
    }
  };

  // LE brouillon qui bloquait le verrouillage automatique : dix minutes de
  // frappe. Inscrit au registre, il part avant tout verrouillage — automatique,
  // bouton ou raccourci. `onChanged()` n'est volontairement pas rappelé ici :
  // l'arbre est démonté dans la foulée, et l'échec d'un rechargement de liste
  // se ferait passer pour une perte de saisie.
  useDraftGuard(`seance-contenu:${seance.id}`, contentDirty, {
    // La date n'est ajoutée que si le titre ne la porte pas déjà : le titre par
    // défaut est « Séance du 14/09/2025 », et « … du 14/09/2025 du 14/09/2025 »
    // ferait douter de ce que l'on a sous les yeux.
    label: seance.title.includes(formatShortDate(seance.date))
      ? `Cahier de texte — ${seance.title}`
      : `Cahier de texte — ${seance.title} du ${formatShortDate(seance.date)}`,
    flush: persistContent,
  });

  const handleBack = () => {
    if (hasUnsaved) {
      setLeaveOpen(true);
      return;
    }
    onBack();
  };

  const pillLabel =
    choiceDraft === "auto"
      ? `T${seance.trimester} · auto`
      : `T${choiceDraft} · forcé`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            title="Retour à la liste des séances"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3
                className={cn(
                  "text-lg font-semibold",
                  seance.cancelled && "text-muted-foreground line-through",
                )}
              >
                {seance.title}
              </h3>
              {seance.cancelled && (
                <Badge
                  variant="outline"
                  className="border-muted-foreground/30 text-muted-foreground"
                >
                  Annulée
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {formatLongDate(seance.date)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Select value={choiceDraft} onValueChange={handlePickTrimester}>
            <SelectTrigger
              className={cn(
                "h-7 w-auto gap-1 rounded-full border-transparent px-3 py-0 text-xs font-medium shadow-none",
                seance.trimester_is_manual
                  ? "bg-violet-100 text-violet-800"
                  : "bg-slate-100 text-slate-700",
              )}
              title="Trimestre de la séance"
              disabled={savingMeta}
            >
              <span>{pillLabel}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                Automatique (d'après la date)
              </SelectItem>
              <SelectItem value="1">Forcer le trimestre 1</SelectItem>
              <SelectItem value="2">Forcer le trimestre 2</SelectItem>
              <SelectItem value="3">Forcer le trimestre 3</SelectItem>
            </SelectContent>
          </Select>

          {!metaOpen && (
            <Button variant="outline" size="sm" onClick={openMeta}>
              <Pencil className="h-3.5 w-3.5" />
              Modifier la séance
            </Button>
          )}
        </div>
      </div>

      {/* Bloc d'édition fermé : l'échec vient forcément de la puce de trimestre,
          et son message n'aurait nulle part où s'afficher. */}
      {metaError && !metaOpen && (
        <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {metaError}
        </p>
      )}

      {metaOpen && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Informations de la séance</CardTitle>
            <p className="text-sm text-muted-foreground">
              Ce bloc n'enregistre que le titre, la date, le trimestre et
              l'annulation. Le cahier de texte a son propre bouton et n'est pas
              touché ici.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="seance-title">Titre</Label>
                <Input
                  id="seance-title"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="seance-date">Date</Label>
                <Input
                  id="seance-date"
                  type="date"
                  value={dateDraft}
                  onChange={(e) => setDateDraft(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="seance-trimester">Trimestre</Label>
                <Select
                  value={choiceDraft}
                  onValueChange={(value) =>
                    setChoiceDraft(value as TrimesterChoice)
                  }
                >
                  <SelectTrigger id="seance-trimester">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">
                      Automatique (d'après la date)
                    </SelectItem>
                    <SelectItem value="1">Trimestre 1 (forcé)</SelectItem>
                    <SelectItem value="2">Trimestre 2 (forcé)</SelectItem>
                    <SelectItem value="3">Trimestre 3 (forcé)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={cancelledDraft}
                    onChange={(e) => setCancelledDraft(e.target.checked)}
                    className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
                  />
                  <span className="flex items-center gap-1.5">
                    <Ban className="h-3.5 w-3.5 text-muted-foreground" />
                    Séance annulée (exclue de l'assiduité des bilans)
                  </span>
                </label>
              </div>
            </div>

            {/* Le motif n'apparaît que si la séance est annulée : un champ
                « pourquoi ce cours n'a pas eu lieu » sous un cours qui a bien eu
                lieu est une question sans objet. Le backend le vide de toute
                façon à la décoche, donc rien ne traîne. */}
            {cancelledDraft && (
              <div className="space-y-2">
                <Label htmlFor="seance-motif">
                  Pourquoi ce cours n'a pas eu lieu
                </Label>
                <Input
                  id="seance-motif"
                  value={reasonDraft}
                  onChange={(e) => setReasonDraft(e.target.value)}
                  placeholder="Facultatif — pour vous, pas pour les familles"
                  maxLength={200}
                />
                <div className="flex flex-wrap gap-1.5">
                  {CANCEL_REASON_SUGGESTIONS.map((motif) => (
                    <Button
                      key={motif}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs font-normal"
                      onClick={() => setReasonDraft(motif)}
                    >
                      {motif}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Ce motif ne figure sur aucun bilan : il est là pour vous
                  rappeler ce qui s'est passé, pas pour être remis aux familles.
                  C'est l'annulation seule qui retire la séance de l'assiduité.
                </p>
              </div>
            )}

            {metaError && (
              <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {metaError}
              </p>
            )}

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={!metaDirty || savingMeta}
                onClick={() =>
                  persistMeta({
                    title: titleDraft,
                    date: dateDraft,
                    choice: choiceDraft,
                    cancelled: cancelledDraft,
                    cancelReason: reasonDraft,
                  })
                }
              >
                <Save className="h-4 w-4" />
                {savingMeta
                  ? "Enregistrement…"
                  : "Enregistrer les informations"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={cancelMeta}
                disabled={savingMeta}
              >
                Annuler
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as "appel" | "cahier")}
      >
        <TabsList>
          <TabsTrigger value="appel">
            <UserCheck className="mr-2 h-4 w-4" />
            Appel
          </TabsTrigger>
          <TabsTrigger value="cahier">
            <BookOpen className="mr-2 h-4 w-4" />
            Cahier de texte
            {contentDirty && (
              <span className="ml-2 h-1.5 w-1.5 rounded-full bg-amber-500" />
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="appel" className="mt-4 space-y-3">
          {seance.cancelled ? (
            <p className="flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">
              <Ban className="mt-0.5 h-4 w-4 shrink-0" />
              Séance annulée
              {seance.cancel_reason && ` — ${seance.cancel_reason}`} : elle ne
              compte dans l'assiduité d'aucun bilan. L'appel reste modifiable si
              vous la rétablissez.
            </p>
          ) : (
            seance.attendance_taken_at === null && (
              <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                L'appel n'a pas encore été fait pour cette séance. Sans
                pointage, ces séances comptent comme « non renseignées » dans
                les bilans.
              </p>
            )
          )}

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Appel</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAllPresent}
                    disabled={attBusy || pending === 0}
                    title={
                      pending === 0
                        ? "Tous les élèves ont déjà un statut. Utilisez « Réinitialiser l'appel » pour tout effacer."
                        : "Marque présents les élèves encore non renseignés"
                    }
                  >
                    <CheckCheck className="h-4 w-4" />
                    Tout présent{pending > 0 ? ` (${pending})` : ""}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setResetOpen(true)}
                    disabled={attBusy || seance.attendance_taken_at === null}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Réinitialiser l'appel
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 pt-1">
                {STATUS_ORDER.map((status) => {
                  const config = STATUS_CONFIG[status];
                  const value = counts[status];
                  return (
                    <Badge
                      key={status}
                      variant="outline"
                      className={cn("font-normal", config.chip)}
                    >
                      {value} {value > 1 ? config.many : config.one}
                    </Badge>
                  );
                })}
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              {attActionError && (
                <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {attActionError}
                </p>
              )}

              <DataState
                loading={attLoading}
                error={attLoadError}
                empty={attendance.length === 0}
                emptyLabel={
                  students.length === 0
                    ? "Aucun élève dans cette classe. Ajoutez-en depuis l'onglet Élèves."
                    : "Aucun élève inscrit à la date de cette séance."
                }
                onRetry={() => {
                  void loadAttendance();
                }}
              >
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[220px]">Élève</TableHead>
                        <TableHead>Statut</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {attendance.map((record) => (
                        <TableRow key={record.student_id}>
                          <TableCell className="font-medium">
                            {record.student_last_name} {record.student_first_name}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {STATUS_ORDER.map((status) => {
                                const config = STATUS_CONFIG[status];
                                const Icon = config.icon;
                                const isActive = record.status === status;
                                return (
                                  <Button
                                    key={status}
                                    variant="ghost"
                                    size="sm"
                                    className={cn(
                                      "h-8 gap-1 px-2 text-xs",
                                      isActive
                                        ? config.active
                                        : "text-muted-foreground",
                                    )}
                                    aria-pressed={isActive}
                                    title={config.label}
                                    onClick={() =>
                                      handleStatus(record.student_id, status)
                                    }
                                  >
                                    <Icon className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline">
                                      {config.label}
                                    </span>
                                  </Button>
                                );
                              })}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </DataState>

              {!attLoading && !attLoadError && notConcerned > 0 && (
                <p className="text-xs text-muted-foreground">
                  {notConcerned}{" "}
                  {notConcerned > 1
                    ? "élèves de la classe n'apparaissent pas"
                    : "élève de la classe n'apparaît pas"}{" "}
                  dans cet appel : leur période d'inscription ne couvre pas le{" "}
                  {formatShortDate(seance.date)}.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cahier" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Cahier de texte</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Ce bouton n'enregistre que le cahier de texte.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {contentDirty && (
                    <span className="text-xs text-amber-700">
                      Modifications non enregistrées
                    </span>
                  )}
                  <Button
                    size="sm"
                    onClick={handleSaveContent}
                    disabled={savingContent || !contentDirty}
                  >
                    <Save className="h-4 w-4" />
                    {savingContent
                      ? "Enregistrement…"
                      : "Enregistrer le cahier de texte"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {contentError && (
                <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {contentError}
                </p>
              )}
              <RichEditor
                content={contentDraft}
                onChange={(html) => {
                  setContentDraft(html);
                  setContentTouched(true);
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Réinitialiser l'appel ?"
        description="Tous les statuts saisis pour cette séance seront effacés et la séance repassera en « appel non fait »."
        confirmLabel="Réinitialiser"
        onConfirm={handleReset}
      />

      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title="Quitter sans enregistrer ?"
        description={
          contentDirty
            ? "Le cahier de texte contient des modifications qui n'ont pas été enregistrées. Elles seront perdues."
            : "Les informations de la séance ont été modifiées sans être enregistrées. Elles seront perdues."
        }
        confirmLabel="Quitter sans enregistrer"
        onConfirm={() => {
          setLeaveOpen(false);
          onBack();
        }}
      />
    </div>
  );
}
