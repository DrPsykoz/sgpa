import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  BookDashed,
  BookOpen,
  Check,
  CheckCheck,
  Circle,
  Clock,
  Paperclip,
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
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PastilleDeGroupe, SelecteurDeGroupe } from "@/components/Groupes";
import { Attachments } from "@/components/Attachments";
import type { AttachmentsHandle } from "@/components/Attachments";
import { useDraftGuard } from "@/hooks/useDrafts";
import { NeedsChips } from "@/components/NeedsChips";
import { NeedsLoadError, useNeeds } from "@/hooks/useNeeds";
import { api } from "@/lib/api";
import { useZoneDepot } from "@/hooks/useZoneDepot";
import { aDuContenu } from "@/lib/contenu";
// Le même libellé d'horaire que les deux calendriers et l'accueil : « 8h – 9h »
// s'écrit à un seul endroit, sinon la fiche de la séance et la carte qui y mène
// finissent par ne pas afficher la même heure. `Home.tsx` puise déjà là.
import { timeLabel } from "@/pages/Timetable/journee";
import { cn } from "@/lib/utils";
import { CANCEL_REASON_SUGGESTIONS } from "@/types";
import type {
  AttendanceStatus,
  AttendanceWithStudent,
  Seance,
  Student,
  StudentGroup,
} from "@/types";

export interface SeanceDetailProps {
  seance: Seance;
  students: Student[];
  /** Les groupes de la classe. Le parent les détient (règle 1) : un groupe
   *  renommé dans l'onglet Élèves se relit ici au rechargement. */
  groups: StudentGroup[];
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

/** Un horodatage `datetime('now')` — « 2026-11-06 14:32:01 », en UTC. */
function formatStamp(stamp: string): string {
  // Le « Z » est ajouté explicitement : sans lui, la chaîne passe pour une heure
  // locale, et une décision prise à 00h30 s'afficherait la veille.
  const date = new Date(`${stamp.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("fr-FR");
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
  groups,
  onBack,
  onChanged,
}: SeanceDetailProps) {
  const [tab, setTab] = useState<"appel" | "cahier">("appel");

  // Les besoins particuliers, chargés une fois pour la classe par le
  // fournisseur de l'écran parent. Lecture seule ici : on les modifie dans
  // l'onglet « Élèves », pas pendant qu'on fait l'appel.
  const { tags: needTags, parEleve: besoins } = useNeeds();

  /**
   * Une séance **sans créneau** : un cours ponctuel, un remplacement, une
   * séance ajoutée à la main depuis l'emploi du temps.
   *
   * C'est la seule dont l'horaire s'édite ici, et c'est la raison même de cette
   * distinction : une séance née d'un créneau tient son heure du modèle
   * hebdomadaire, qui se corrige dans l'emploi du temps et pour toutes les
   * semaines à la fois. La corriger occurrence par occurrence ferait deux
   * vérités pour la même heure — c'est « l'emploi du temps définit » appliqué à
   * une colonne. Un cours ponctuel, lui, n'a aucun modèle derrière lui : sans
   * ce champ, un horaire saisi de travers restait faux pour toujours, et c'est
   * exactement ce que l'enseignant a signalé.
   */
  const ponctuelle = seance.slot_id === null;

  // ---- Bloc « informations » : titre, date, horaire, trimestre, annulation ----
  // Ces champs ne partent QUE par api.updateSeanceMeta.
  const [metaOpen, setMetaOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState(seance.title);
  const [dateDraft, setDateDraft] = useState(seance.date);
  const [startDraft, setStartDraft] = useState(seance.start_time);
  const [endDraft, setEndDraft] = useState(seance.end_time);
  const [choiceDraft, setChoiceDraft] = useState<TrimesterChoice>(
    choiceOf(seance),
  );
  const [cancelledDraft, setCancelledDraft] = useState(seance.cancelled);
  const [reasonDraft, setReasonDraft] = useState(seance.cancel_reason);
  // `null` = toute la classe. Changer le groupe d'une séance déjà pointée est
  // permis : le backend garde les pointages, l'appel se contente de ne plus
  // lister les élèves de l'autre groupe. Un refus aurait obligé à supprimer la
  // séance pour corriger une erreur de saisie.
  const [groupDraft, setGroupDraft] = useState<string | null>(seance.group_id);
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  const metaDirty =
    metaOpen &&
    (titleDraft !== seance.title ||
      dateDraft !== seance.date ||
      // L'horaire ne compte comme modification que là où il est saisissable :
      // sur une séance de créneau, les deux brouillons existent mais aucun
      // champ ne les touche, et les comparer n'aurait jamais rien rendu de vrai.
      (ponctuelle &&
        (startDraft !== seance.start_time || endDraft !== seance.end_time)) ||
      choiceDraft !== choiceOf(seance) ||
      cancelledDraft !== seance.cancelled ||
      // Le motif compte comme modification même s'il est le seul à bouger :
      // corriger « Sortie » en « Sortie scolaire » est une saisie à enregistrer.
      reasonDraft !== seance.cancel_reason ||
      groupDraft !== seance.group_id);

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

  // ---- « Rien à écrire » ----
  // Aucun état local pour la valeur : elle est lue sur la prop, donc dérivée de
  // la liste du parent (règle 1). Une copie figée ici aurait affiché « déclaré »
  // après un échec d'écriture.
  const waived = seance.content_waived_at !== null;
  const [waiveBusy, setWaiveBusy] = useState(false);
  const [waiveError, setWaiveError] = useState<string | null>(null);

  // ---- Glisser-déposer de pièces jointes ----
  // La zone couvre tout l'onglet, éditeur compris : c'est là que la main va.
  // Mais elle ne fait que TRANSMETTRE — `Attachments` garde la réduction, le
  // plafond et les refus, pour qu'un fichier déposé et le même fichier choisi
  // au bouton suivent exactement le même chemin.
  //
  // Les six pièges du glisser-déposer (capture, compteur de profondeur, filet
  // sur `document`, `dropEffect`, calque sans pointeur, test de contenu) vivent
  // dans `useZoneDepot`, partagé avec le compte rendu d'un rendez-vous.
  const piecesRef = useRef<AttachmentsHandle>(null);
  const zoneDepot = useZoneDepot((depot) => {
    void piecesRef.current?.deposer(depot);
  });

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
    startTime: string;
    endTime: string;
    choice: TrimesterChoice;
    cancelled: boolean;
    cancelReason: string;
    groupId: string | null;
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
        // Sur une séance de créneau, l'horaire transite **inchangé** : il
        // appartient au modèle hebdomadaire, et l'écraser par une chaîne vide
        // effacerait l'heure d'un cours au simple renommage. Sur un cours
        // ponctuel, c'est le brouillon qui part — l'ordre des deux heures et le
        // format sont vérifiés en Rust, seule implémentation de la règle.
        ponctuelle ? values.startTime : seance.start_time,
        ponctuelle ? values.endTime : seance.end_time,
        values.choice === "auto" ? null : Number(values.choice),
        values.cancelled,
        // Le backend le vide lui-même si `cancelled` est faux : on ne duplique
        // pas la règle ici, sinon les deux divergeraient au premier ajustement.
        values.cancelReason,
        values.groupId,
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
    setStartDraft(seance.start_time);
    setEndDraft(seance.end_time);
    setChoiceDraft(choiceOf(seance));
    setCancelledDraft(seance.cancelled);
    setReasonDraft(seance.cancel_reason);
    setGroupDraft(seance.group_id);
    setMetaError(null);
    setMetaOpen(true);
  };

  const cancelMeta = () => {
    setTitleDraft(seance.title);
    setDateDraft(seance.date);
    setStartDraft(seance.start_time);
    setEndDraft(seance.end_time);
    setChoiceDraft(choiceOf(seance));
    setCancelledDraft(seance.cancelled);
    setReasonDraft(seance.cancel_reason);
    setGroupDraft(seance.group_id);
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
      // L'horaire transite inchangé, pour la raison qui fait transiter le
      // motif : un reclassement de trimestre ne touche pas aux heures, et
      // omettre les deux champs les enverrait vides sur un cours ponctuel.
      startTime: seance.start_time,
      endTime: seance.end_time,
      choice,
      cancelled: seance.cancelled,
      // La puce de trimestre ne touche QU'au trimestre : on fait transiter le
      // motif inchangé. L'omettre l'effacerait au simple reclassement.
      cancelReason: seance.cancel_reason,
      // Même raison pour le groupe : un reclassement de trimestre ne doit pas
      // rendre à la classe entière une séance d'atelier.
      groupId: seance.group_id,
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

  /**
   * Déclare — ou retire — le « rien à écrire ».
   *
   * Ne touche pas au brouillon du cahier de texte, et n'enregistre pas à sa
   * place : les deux écritures sont deux commandes (règle 3). Cliquer ici avec
   * trois lignes tapées et non enregistrées ne les perd donc pas, mais ne les
   * enregistre pas non plus — le bouton « Enregistrer le cahier de texte »
   * reste le seul chemin du contenu, et il reste signalé comme non enregistré.
   */
  const handleWaive = async (next: boolean) => {
    setWaiveBusy(true);
    setWaiveError(null);
    try {
      await api.setSeanceContentWaived(seance.id, next);
      // `onChanged()` est indispensable ici, contrairement au cahier de texte :
      // l'affichage lit `seance.content_waived_at`, qui vient de la liste du
      // parent. Sans rechargement, le clic n'aurait aucun effet visible.
      await onChanged();
    } catch (err) {
      setWaiveError(messageOf(err));
    } finally {
      setWaiveBusy(false);
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
              <PastilleDeGroupe
                groupName={seance.group_name}
                className="text-muted-foreground"
              />
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
              {timeLabel(seance.start_time, seance.end_time) &&
                ` · ${timeLabel(seance.start_time, seance.end_time)}`}
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
              Ce bloc n'enregistre que le titre, la date,{" "}
              {ponctuelle ? "l'horaire, " : ""}le trimestre, le groupe et
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
              {ponctuelle ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="seance-debut">Heure de début</Label>
                    <Input
                      id="seance-debut"
                      type="time"
                      value={startDraft}
                      onChange={(e) => setStartDraft(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="seance-fin">Heure de fin</Label>
                    <Input
                      id="seance-fin"
                      type="time"
                      value={endDraft}
                      onChange={(e) => setEndDraft(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                /* Dire où l'heure se change vaut mieux que présenter un champ
                   grisé : le champ grisé laisse croire qu'elle ne se change
                   nulle part. */
                <div className="space-y-2 sm:col-span-2">
                  <Label>Horaire</Label>
                  <p className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {timeLabel(seance.start_time, seance.end_time) ||
                        "Sans horaire"}{" "}
                      — cette séance vient d'un créneau de l'emploi du temps.
                      Son heure s'y modifie, et pour toutes les semaines à la
                      fois.
                    </span>
                  </p>
                </div>
              )}

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
              <SelecteurDeGroupe
                id="seance-group"
                groups={groups}
                value={groupDraft}
                onChange={setGroupDraft}
                disabled={savingMeta}
                aide="L'appel ne convoque que ce groupe, et la séance sort de l'assiduité des autres élèves."
              />
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
                    startTime: startDraft,
                    endTime: endDraft,
                    choice: choiceDraft,
                    cancelled: cancelledDraft,
                    cancelReason: reasonDraft,
                    groupId: groupDraft,
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
          <NeedsLoadError />
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
                            <span className="flex flex-wrap items-center gap-2">
                              <span>
                                {record.student_last_name}{" "}
                                {record.student_first_name}
                              </span>
                              {/* Abrégées : la colonne fait 220 px et c'est le
                                  statut qu'on vient cliquer ici. Le libellé
                                  complet reste accessible au survol. */}
                              <NeedsChips
                                compact
                                tags={needTags}
                                needs={besoins.get(record.student_id)}
                              />
                            </span>
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

              {/* Deux raisons d'être absent de cet appel, et il faut les dire
                  toutes les deux : la période d'inscription, et — depuis le
                  palier 023 — l'appartenance à un autre groupe. Un seul des
                  deux motifs affiché laisserait l'enseignant chercher une
                  erreur de date là où c'est le groupe qui écarte. */}
              {!attLoading && !attLoadError && notConcerned > 0 && (
                <p className="text-xs text-muted-foreground">
                  {notConcerned}{" "}
                  {notConcerned > 1
                    ? "élèves de la classe n'apparaissent pas"
                    : "élève de la classe n'apparaît pas"}{" "}
                  dans cet appel :{" "}
                  {seance.group_name
                    ? `cette séance ne concerne que « ${seance.group_name} », ou leur période d'inscription ne couvre pas le ${formatShortDate(seance.date)}.`
                    : `leur période d'inscription ne couvre pas le ${formatShortDate(seance.date)}.`}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tout l'onglet est la zone de dépôt, éditeur compris : un enseignant
            qui glisse la photo du tableau vise le cahier de texte, pas une
            petite cible dans une carte en bas. Le calque dit alors clairement
            que le fichier sera JOINT et non inséré dans le texte — c'est la
            seule chose qu'on puisse honnêtement lui promettre, les octets
            vivant dans la base et non dans le HTML du compte rendu. */}
        <TabsContent
          value="cahier"
          className="relative mt-4 space-y-4"
          {...zoneDepot.props}
        >
          {zoneDepot.survol && (
            // `pointer-events-none` est vital : un calque qui capterait la
            // souris déclencherait `dragleave` sur la zone au moment où il
            // apparaît, donc disparaîtrait aussitôt, en boucle.
            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-primary bg-background/85 text-center">
              <span className="flex items-center gap-2 font-medium">
                <Paperclip className="h-4 w-4" />
                Déposez pour joindre à cette séance
              </span>
              <span className="px-6 text-sm text-muted-foreground">
                Les fichiers rejoignent «&nbsp;Pièces jointes&nbsp;». Ils ne
                sont pas insérés dans le texte du compte rendu.
              </span>
            </div>
          )}
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

              {waiveError && (
                <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {waiveError}
                </p>
              )}

              {/* Sous l'éditeur, et proposé seulement quand il n'y a rien
                  dedans : « rien à écrire » au-dessus d'un paragraphe déjà
                  tapé serait une question absurde. La proposition suit donc le
                  brouillon et non ce qui est enregistré — on la voit
                  disparaître en commençant à écrire, ce qui est la bonne
                  réponse à la question posée. */}
              {waived ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">
                  <span className="flex items-start gap-2">
                    <BookDashed className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Marqué «&nbsp;rien à écrire&nbsp;»
                      {seance.content_waived_at
                        ? ` le ${formatStamp(seance.content_waived_at)}`
                        : ""}
                      . Cette séance n'est plus réclamée dans «&nbsp;À
                      reprendre&nbsp;» sur l'accueil. L'appel, lui, compte
                      normalement.
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={waiveBusy}
                    onClick={() => handleWaive(false)}
                  >
                    <RotateCcw className="h-4 w-4" />
                    {waiveBusy ? "Retrait…" : "Retirer"}
                  </Button>
                </div>
              ) : (
                !aDuContenu(contentDraft) && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    <span>
                      Rien à écrire pour cette séance&nbsp;? Évaluation
                      surveillée, sortie, heure de vie de classe, séance confiée
                      à l'AESH… Dites-le, et l'accueil cessera d'en réclamer le
                      compte rendu.
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={waiveBusy}
                      onClick={() => handleWaive(true)}
                    >
                      <BookDashed className="h-4 w-4" />
                      {waiveBusy
                        ? "Enregistrement…"
                        : "Marquer « rien à écrire »"}
                    </Button>
                  </div>
                )
              )}
            </CardContent>
          </Card>

          {/* Carte distincte, et non une section de la précédente : les deux
              n'enregistrent pas au même moment. Le cahier de texte attend son
              bouton, une pièce jointe est écrite dès qu'elle est choisie —
              sous un même en-tête « Enregistrer », l'enseignant croirait
              perdre ses fichiers en quittant sans cliquer. */}
          <Card>
            <CardContent className="p-6">
              <Attachments
                ref={piecesRef}
                porteur={{ kind: "seance", id: seance.id }}
                onChanged={onChanged}
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
