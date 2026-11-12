import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ClipboardPaste,
  HeartHandshake,
  NotebookPen,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { AgendaEntryEditor } from "@/components/AgendaEntryEditor";
import { DataState } from "@/components/DataState";
import { NeedsChips } from "@/components/NeedsChips";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  OptionsDeGroupe,
  groupeDeValeur,
  valeurDeGroupe,
} from "@/components/Groupes";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GroupsDialog } from "@/pages/SessionDetail/dialogs/GroupsDialog";
import {
  StudentFormDialog,
  type StudentFormValues,
} from "@/pages/SessionDetail/dialogs/StudentFormDialog";
import { StudentNeedsDialog } from "@/pages/SessionDetail/dialogs/StudentNeedsDialog";
import { AgendaEntryDialog } from "@/pages/Timetable/AgendaEntryDialog";
import { useNeeds } from "@/hooks/useNeeds";
import { api } from "@/lib/api";
import { compteRenduRegle, motsDuCompteRendu } from "@/lib/contenu";
import { cn } from "@/lib/utils";
import type {
  AgendaEntrySummary,
  Session,
  Student,
  StudentDeletionImpact,
  StudentGroup,
} from "@/types";

/**
 * Ce que la suppression d'un rendez-vous emporte, nommé.
 *
 * Le `ON DELETE CASCADE` du palier 017 emporte les pièces jointes avec
 * l'entrée : la convention scannée part avec elle, et le dire est le minimum
 * avant de demander confirmation. Taire les fichiers pour ne citer que le
 * texte serait exactement le genre de demi-phrase qui fait cliquer « Oui ».
 */
function cequiPart(entry: AgendaEntrySummary | null): string {
  if (entry === null) return ".";
  const morceaux: string[] = [];
  if (entry.has_content) morceaux.push("le texte qui y est rédigé");
  if (entry.has_attachment) morceaux.push("ses pièces jointes");
  if (morceaux.length === 0) return ".";
  return `, avec ${morceaux.join(" et ")}.`;
}

interface StudentsTabProps {
  session: Session;
  students: Student[];
  /** Les groupes de la classe. Détenus par le parent (règle 1) : la colonne
   *  « Groupe » écrit puis demande le rechargement, elle ne garde pas de copie. */
  groups: StudentGroup[];
  reload: () => Promise<void>;
}

/**
 * Espace insécable, écrit par son code plutôt qu'en toutes lettres : dans le
 * source, il est indiscernable d'une espace ordinaire et le premier
 * reformatage le perdrait.
 */
const NBSP = String.fromCharCode(0xa0);

/** Affichage français d'une date stockée en AAAA-MM-JJ. */
function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR");
}

/** Les deux heures vides = heure à caler : l'entrée existe sans horaire. */
function formatSchedule(start: string, end: string): string {
  if (!start) return "heure à caler";
  return end ? `${start} – ${end}` : `à partir de ${start}`;
}

function messageOf(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Une erreur inattendue est survenue.";
}

function fullName(student: Student): string {
  return `${student.last_name} ${student.first_name}`.trim();
}

function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count > 1 ? many : one}`;
}

/** Énumération française : « a, b et c ». */
function enumerate(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} et ${parts[parts.length - 1]}`;
}

/**
 * Ce que la suppression emporte, compté par le backend avant l'ordre de
 * destruction. Les compteurs nuls ne sont pas listés : « 0 fiche contrat » dans
 * une confirmation n'apprend rien et noie ce qui compte.
 */
function impactParts(impact: StudentDeletionImpact): string[] {
  const parts: string[] = [];
  if (impact.grades > 0) {
    parts.push(countLabel(impact.grades, "note", "notes"));
  }
  if (impact.attendance_records > 0) {
    parts.push(countLabel(impact.attendance_records, "appel", "appels"));
  }
  if (impact.report_comments > 0) {
    parts.push(
      countLabel(
        impact.report_comments,
        "appréciation de bulletin",
        "appréciations de bulletin",
      ),
    );
  }
  if (impact.contract_sheets > 0) {
    parts.push(
      countLabel(impact.contract_sheets, "fiche contrat", "fiches contrat"),
    );
  }
  if (impact.agenda_entries > 0) {
    const base = countLabel(
      impact.agenda_entries,
      "entrée d'agenda",
      "entrées d'agenda",
    );
    const written = impact.written_agenda_entries;
    parts.push(
      written > 0
        ? `${base} dont ${countLabel(written, "rédigée", "rédigées")}`
        : base,
    );
  }
  return parts;
}

export function StudentsTab({
  session,
  students,
  groups,
  reload,
}: StudentsTabProps): ReactElement {
  const [groupsOpen, setGroupsOpen] = useState(false);
  /** L'élève dont la répartition est en cours d'écriture : son sélecteur se
   *  fige le temps de l'aller-retour, les autres restent utilisables. */
  const [repartitionEnCours, setRepartitionEnCours] = useState<string | null>(
    null,
  );
  const [repartitionError, setRepartitionError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [deleting, setDeleting] = useState<Student | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // ---- Besoins particuliers ----
  // L'identifiant, pas l'élève : le dialogue reçoit l'entité dérivée de la
  // liste, pour qu'un rechargement la rafraîchisse au lieu de la figer.
  const [needsStudentId, setNeedsStudentId] = useState<string | null>(null);
  const { tags: needTags, parEleve: besoins, error: needsError } = useNeeds();

  // Ce que la suppression de l'élève en attente de confirmation emporterait.
  const [impact, setImpact] = useState<StudentDeletionImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);

  // ---- Rendez-vous de l'élève ----
  // Le parent garde la liste et l'identifiant sélectionné, et dérive l'entité :
  // un rechargement rafraîchit l'écran ouvert au lieu de le laisser sur une
  // copie figée.
  const [agendaStudentId, setAgendaStudentId] = useState<string | null>(null);
  const [entries, setEntries] = useState<AgendaEntrySummary[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [entryActionError, setEntryActionError] = useState<string | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [entryToDelete, setEntryToDelete] =
    useState<AgendaEntrySummary | null>(null);

  // Le backend inscrit par défaut au premier jour du T1 de l'année de la classe.
  // On lit les mêmes bornes pour que le champ pré-rempli affiche exactement ce
  // qui serait enregistré. En cas d'échec, le repli est la valeur par défaut du
  // backend lui-même et le champ reste éditable : rien ne justifie de bloquer
  // l'ajout d'un élève pour un pré-remplissage.
  const [defaultEnrolledOn, setDefaultEnrolledOn] = useState(
    `${session.year_start}-09-01`,
  );

  useEffect(() => {
    let cancelled = false;
    api
      .getTrimesterBounds(session.year_start)
      .then((bounds) => {
        if (!cancelled) setDefaultEnrolledOn(bounds.t1_start);
      })
      .catch(() => {
        if (!cancelled) setDefaultEnrolledOn(`${session.year_start}-09-01`);
      });
    return () => {
      cancelled = true;
    };
  }, [session.year_start]);

  // Le comptage est relancé à chaque ouverture de la confirmation : entre deux
  // suppressions, l'enseignant a pu saisir des notes ou un rapport de visite.
  useEffect(() => {
    if (!deleting) {
      setImpact(null);
      setImpactError(null);
      setImpactLoading(false);
      return;
    }
    let cancelled = false;
    setImpact(null);
    setImpactError(null);
    setImpactLoading(true);
    api
      .getStudentDeletionImpact(deleting.id)
      .then((counted) => {
        if (!cancelled) setImpact(counted);
      })
      .catch((err) => {
        if (!cancelled) setImpactError(messageOf(err));
      })
      .finally(() => {
        if (!cancelled) setImpactLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deleting]);

  const agendaStudent = useMemo(
    () => students.find((student) => student.id === agendaStudentId) ?? null,
    [students, agendaStudentId],
  );

  const needsStudent = useMemo(
    () => students.find((student) => student.id === needsStudentId) ?? null,
    [students, needsStudentId],
  );

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedEntryId) ?? null,
    [entries, selectedEntryId],
  );

  const loadEntries = useCallback(async () => {
    if (!agendaStudentId) return;
    setEntriesLoading(true);
    setEntriesError(null);
    try {
      setEntries(await api.getStudentAgendaEntries(agendaStudentId));
    } catch (err) {
      setEntriesError(messageOf(err));
    } finally {
      setEntriesLoading(false);
    }
  }, [agendaStudentId]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  // La normalisation U+00A0 → espace est indispensable : un collage depuis Word
  // laisse des espaces insécables invisibles que `trim()` ignore, et la ligne
  // « vide » qui en résulte créerait un élève sans nom.
  const bulkLines = useMemo(
    () =>
      bulkText
        .split(/\r?\n/)
        .map((line) => line.split(NBSP).join(" ").trim())
        .filter(Boolean),
    [bulkText],
  );

  /**
   * Ranger un élève dans un groupe, depuis le tableau.
   *
   * `setStudentGroup` et non un champ d'`updateStudent` : la troisième règle
   * d'architecture. Répartir une classe, c'est quatorze gestes à la suite, et
   * aucun d'eux n'a de prénom ni de date d'inscription à faire transiter —
   * donc aucun ne peut en écraser.
   */
  const rangerDansLeGroupe = async (
    student: Student,
    groupId: string | null,
  ) => {
    setNotice(null);
    setRepartitionError(null);
    setRepartitionEnCours(student.id);
    try {
      await api.setStudentGroup(student.id, groupId);
      await reload();
    } catch (err) {
      setRepartitionError(messageOf(err));
    } finally {
      setRepartitionEnCours(null);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setNotice(null);
    setFormOpen(true);
  };

  const openEdit = (student: Student) => {
    setEditing(student);
    setNotice(null);
    setFormOpen(true);
  };

  const openAgenda = (student: Student) => {
    setNotice(null);
    setEntries([]);
    setEntriesError(null);
    setEntryActionError(null);
    setSelectedEntryId(null);
    // Chargement affiché d'emblée : sans cela, la liste vide de l'élève
    // précédent s'afficherait un instant comme « Aucun rendez-vous ».
    setEntriesLoading(true);
    setAgendaStudentId(student.id);
  };

  const handleSubmit = async (values: StudentFormValues) => {
    if (editing) {
      await api.updateStudent(
        editing.id,
        values.firstName,
        values.lastName,
        values.enrolledOn,
        values.leftOn,
      );
    } else {
      await api.createStudent(
        session.id,
        values.firstName,
        values.lastName,
        values.enrolledOn,
      );
    }
    await reload();
  };

  const handleDelete = async () => {
    if (!deleting) return;
    await api.deleteStudent(deleting.id);
    if (agendaStudentId === deleting.id) setAgendaStudentId(null);
    await reload();
    setDeleting(null);
  };

  const handleDeleteEntry = async () => {
    if (!entryToDelete) return;
    setEntryActionError(null);
    try {
      await api.deleteAgendaEntry(entryToDelete.id);
      if (selectedEntryId === entryToDelete.id) setSelectedEntryId(null);
      setEntryToDelete(null);
      await loadEntries();
    } catch (err) {
      setEntryToDelete(null);
      setEntryActionError(messageOf(err));
    }
  };

  const handleBulk = async () => {
    setBulkPending(true);
    setBulkError(null);
    try {
      const created = await api.createStudentsBulk(session.id, bulkLines);
      await reload();
      setBulkText("");
      setBulkOpen(false);
      setNotice(
        created.length > 1
          ? `${created.length} élèves ajoutés.`
          : "1 élève ajouté.",
      );
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkPending(false);
    }
  };

  // ---- Fiche « rendez-vous » d'un élève ----
  // C'est ici qu'on cherche un rapport de visite six mois plus tard, pas dans
  // l'emploi du temps.
  if (agendaStudent) {
    if (selectedEntry) {
      return (
        <AgendaEntryEditor
          key={selectedEntry.id}
          entryId={selectedEntry.id}
          onBack={() => setSelectedEntryId(null)}
          onChanged={loadEntries}
        />
      );
    }

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setAgendaStudentId(null)}
              title="Retour à la liste des élèves"
              aria-label="Retour à la liste des élèves"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h3 className="text-lg font-semibold">
                {fullName(agendaStudent)}
              </h3>
              <p className="text-sm text-muted-foreground">
                Rendez-vous : visites de stage, réunions, entretiens. Rien de
                ce qui est écrit ici n'entre dans le calcul d'assiduité.
              </p>
            </div>
          </div>
          <Button size="sm" onClick={() => setEntryDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Nouveau rendez-vous
          </Button>
        </div>

        {entryActionError && (
          <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {entryActionError}
          </p>
        )}

        <Card>
          <CardContent className="pt-6">
            <DataState
              loading={entriesLoading}
              error={entriesError}
              empty={entries.length === 0}
              emptyLabel="Aucun rendez-vous pour cet élève. Créez-en un au retour d'une visite de stage."
              onRetry={() => {
                void loadEntries();
              }}
            >
              <div className="space-y-2">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    role="button"
                    tabIndex={0}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50"
                    onClick={() => setSelectedEntryId(entry.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedEntryId(entry.id);
                      }
                    }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={cn(
                          "rounded-lg p-2",
                          compteRenduRegle(entry)
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground",
                        )}
                        title={motsDuCompteRendu(entry).carte}
                      >
                        <NotebookPen className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {entry.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(entry.date)} ·{" "}
                          {formatSchedule(entry.start_time, entry.end_time)}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {!compteRenduRegle(entry) && (
                        <Badge
                          variant="outline"
                          className="border-amber-200 bg-amber-50 font-normal text-amber-800"
                        >
                          À rédiger
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        title="Supprimer le rendez-vous"
                        aria-label={`Supprimer le rendez-vous « ${entry.title} »`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setEntryToDelete(entry);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </DataState>
          </CardContent>
        </Card>

        <AgendaEntryDialog
          open={entryDialogOpen}
          onOpenChange={setEntryDialogOpen}
          student={agendaStudent}
          onCreated={async (created) => {
            await loadEntries();
            // On ouvre l'éditeur dans la foulée : on crée une entrée pour y
            // écrire, jamais pour la regarder dans une liste.
            setSelectedEntryId(created.id);
          }}
        />

        <ConfirmDialog
          open={entryToDelete !== null}
          onOpenChange={(open) => {
            if (!open) setEntryToDelete(null);
          }}
          title="Supprimer le rendez-vous"
          description={
            <>
              <p>
                « {entryToDelete?.title} » du{" "}
                {entryToDelete ? formatDate(entryToDelete.date) : ""} sera
                supprimé{cequiPart(entryToDelete)}
              </p>
              <p>Cette suppression ne change aucun bilan.</p>
            </>
          }
          onConfirm={handleDeleteEntry}
        />
      </div>
    );
  }

  const deletionParts = impact ? impactParts(impact) : [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>
          Élèves
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {students.length}
          </span>
        </CardTitle>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setNotice(null);
              setRepartitionError(null);
              setGroupsOpen(true);
            }}
          >
            <Users className="h-4 w-4" />
            Groupes
            {groups.length > 0 && (
              <span className="ml-1 text-xs text-muted-foreground">
                {groups.length}
              </span>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setBulkError(null);
              setNotice(null);
              setBulkOpen(true);
            }}
          >
            <ClipboardPaste className="h-4 w-4" />
            Coller une liste
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Ajouter un élève
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {notice && (
          <p className="mb-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            {notice}
          </p>
        )}

        {repartitionError && (
          <p className="mb-4 flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{repartitionError}</span>
          </p>
        )}

        {students.length === 0 ? (
          <div className="py-10 text-center">
            <UserPlus className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">
              Aucun élève dans cette classe.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ajoutez-les un par un, ou collez la liste de la classe d'un coup.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Prénom</TableHead>
                <TableHead>Inscrit depuis le</TableHead>
                <TableHead>Sorti le</TableHead>
                {/* La colonne n'apparaît qu'une fois un groupe créé : une
                    colonne qui ne peut dire que « — » sur quatorze lignes
                    rétrécit les cinq autres sans rien apprendre. */}
                {groups.length > 0 && <TableHead>Groupe</TableHead>}
                <TableHead>Besoins</TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((student) => (
                <TableRow
                  key={student.id}
                  className={cn(
                    student.left_on !== null && "text-muted-foreground",
                  )}
                >
                  <TableCell className="font-medium">
                    {student.last_name}
                  </TableCell>
                  <TableCell>{student.first_name}</TableCell>
                  <TableCell>{formatDate(student.enrolled_on)}</TableCell>
                  <TableCell>
                    {student.left_on ? (
                      <span className="italic">
                        {formatDate(student.left_on)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {groups.length > 0 && (
                    <TableCell>
                      <Select
                        value={valeurDeGroupe(student.group_id)}
                        onValueChange={(valeur) =>
                          void rangerDansLeGroupe(
                            student,
                            groupeDeValeur(valeur),
                          )
                        }
                        disabled={repartitionEnCours === student.id}
                      >
                        <SelectTrigger
                          className="h-8 w-40"
                          aria-label={`Groupe de ${fullName(student)}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <OptionsDeGroupe
                            groups={groups}
                            value={student.group_id}
                            // « Aucun » et non « Toute la classe » : ici on
                            // range un élève, on ne cible pas une séance. Un
                            // élève hors groupe est d'ailleurs convoqué
                            // partout, ce que le dialogue des groupes dit.
                            libelleToute="Aucun"
                          />
                        </SelectContent>
                      </Select>
                    </TableCell>
                  )}
                  <TableCell>
                    <NeedsChips
                      tags={needTags}
                      needs={besoins.get(student.id)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Besoins particuliers et aménagements"
                        aria-label={`Besoins particuliers de ${student.last_name} ${student.first_name}`}
                        onClick={() => {
                          setNotice(null);
                          setNeedsStudentId(student.id);
                        }}
                      >
                        <HeartHandshake className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Rendez-vous : visites de stage, réunions"
                        aria-label={`Rendez-vous de ${student.last_name} ${student.first_name}`}
                        onClick={() => openAgenda(student)}
                      >
                        <NotebookPen className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Modifier ${student.last_name} ${student.first_name}`}
                        onClick={() => openEdit(student)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        aria-label={`Supprimer ${student.last_name} ${student.first_name}`}
                        onClick={() => {
                          setNotice(null);
                          setDeleting(student);
                        }}
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

      <GroupsDialog
        open={groupsOpen}
        onOpenChange={setGroupsOpen}
        sessionId={session.id}
        groups={groups}
        reload={reload}
      />

      {needsError && (
        <CardContent className="pt-0">
          <p className="text-xs text-destructive">
            Les besoins particuliers n'ont pas pu être chargés ({needsError}).
            La colonne « Besoins » est donc vide, et ce n'est pas ce que dit la
            base.
          </p>
        </CardContent>
      )}

      {/* `key` sur l'élève : le dialogue détient le brouillon de la note libre
          (règle 2). Monté seulement quand un élève est choisi, pour que
          l'initialiseur de `useState` lise bien SES besoins. */}
      {needsStudent && (
        <StudentNeedsDialog
          key={needsStudent.id}
          open={true}
          onOpenChange={(ouvert) => {
            if (!ouvert) setNeedsStudentId(null);
          }}
          student={needsStudent}
        />
      )}

      <StudentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        student={editing}
        defaultEnrolledOn={defaultEnrolledOn}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Supprimer l'élève"
        description={
          <>
            {impactLoading && <p>Comptage de ce qui serait effacé…</p>}

            {!impactLoading && impact && deletionParts.length > 0 && (
              <p>
                <span className="font-medium text-foreground">
                  {deleting ? fullName(deleting) : ""}
                </span>{" "}
                : {enumerate(deletionParts)}. La suppression efface tout.
              </p>
            )}

            {!impactLoading && impact && deletionParts.length === 0 && (
              <p>
                Rien n'est encore rattaché à{" "}
                {deleting ? fullName(deleting) : "cet élève"} : la suppression
                n'efface que sa fiche.
              </p>
            )}

            {!impactLoading && impactError && (
              <p>
                Le détail n'a pas pu être compté ({impactError}). La suppression
                efface malgré tout les notes, les appels, les appréciations de
                bulletin, les fiches contrat et les entrées d'agenda de cet
                élève.
              </p>
            )}

            <p>
              Si l'élève a simplement quitté la classe, renseignez plutôt sa date
              de sortie : son travail reste dans les bilans passés.
            </p>
          </>
        }
        onConfirm={handleDelete}
      />

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Coller une liste d'élèves</DialogTitle>
            <DialogDescription>
              Une ligne par élève. Le dernier mot est pris comme prénom, tout ce
              qui précède comme nom : « LE GALL Marie » donne le nom « LE GALL »
              et le prénom « Marie ».
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bulk-students">Liste</Label>
              <Textarea
                id="bulk-students"
                value={bulkText}
                onChange={(event) => setBulkText(event.target.value)}
                placeholder={"DUPONT Marie\nLE GALL Yann\nMARTIN Lucas"}
                rows={10}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                {bulkLines.length === 0
                  ? "Aucune ligne pour l'instant."
                  : `${bulkLines.length} élève${bulkLines.length > 1 ? "s" : ""} à ajouter, inscrit${bulkLines.length > 1 ? "s" : ""} depuis le ${formatDate(defaultEnrolledOn)}.`}
              </p>
            </div>

            {bulkError && (
              <p className="whitespace-pre-line rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {bulkError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBulkOpen(false)}
              disabled={bulkPending}
            >
              Annuler
            </Button>
            <Button
              onClick={() => void handleBulk()}
              disabled={bulkPending || bulkLines.length === 0}
            >
              {bulkPending ? "Ajout…" : "Ajouter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
