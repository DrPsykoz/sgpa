import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { Plus, Trash2, User, UserX, Users } from "lucide-react";

import { DataState } from "@/components/DataState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AbsencePeriodDialog } from "@/pages/SessionDetail/dialogs/AbsencePeriodDialog";
import { TeacherAbsenceDialog } from "@/pages/SessionDetail/dialogs/TeacherAbsenceDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  AbsencePeriod,
  AbsencePeriodInput,
  Session,
  Student,
  StudentGroup,
  TeacherAbsenceInput,
} from "@/types";

export interface AbsencesTabProps {
  session: Session;
  students: Student[];
  /** Les groupes de la classe, détenus par le parent (règle 1) : une période
   *  peut viser un groupe entier depuis le palier 023. */
  groups: StudentGroup[];
}

function messageOf(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Une erreur inattendue est survenue.";
}

/** Affichage français d'une date stockée en AAAA-MM-JJ. */
function formatDate(iso: string): string {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR");
}

/** Une période d'un seul jour ne s'écrit pas « du 18/01 au 18/01 ». */
function formatFenetre(period: AbsencePeriod): string {
  return period.start_date === period.end_date
    ? `Le ${formatDate(period.start_date)}`
    : `Du ${formatDate(period.start_date)} au ${formatDate(period.end_date)}`;
}

/** Qui la période vise. `student_id` et `group_id` tous deux à `null` = toute
 *  la classe. Ils ne sont jamais posés ensemble — le backend le refuse. */
function formatCible(period: AbsencePeriod): string {
  if (period.teacher_absent) return "Professeur absent";
  if (period.student_id !== null) {
    return `${period.student_last_name ?? ""} ${period.student_first_name ?? ""}`.trim();
  }
  // Le nom du groupe et non « Groupe » : « Groupe 1 en stage » et « Atelier
  // bois en stage » ne se cherchent pas de la même façon dans une liste de
  // vingt lignes.
  if (period.group_name !== null) return period.group_name;
  return "Toute la classe";
}

/** La même cible au fil d'une phrase. Le nom d'un élève garde ses capitales :
 *  seules les mentions qui n'en sont pas un se mettent en minuscules. */
function formatCiblePhrase(period: AbsencePeriod): string {
  if (period.teacher_absent) return "toute la classe, le professeur étant absent";
  if (period.student_id !== null) return formatCible(period);
  if (period.group_name !== null) return `le groupe « ${period.group_name} »`;
  return "toute la classe";
}

/**
 * Le compte de séances, et ce qu'il leur arrive.
 *
 * Il prend la période entière et non son seul `seance_count`, parce que le même
 * chiffre se lit de deux façons : « écartées » quand la période retire du
 * dénominateur, « concernées » quand l'appel se fait quand même (palier 020).
 * Dire « 6 séances écartées » sur une sortie scolaire où l'appel compte serait
 * un mensonge sur le bilan, pas une approximation de vocabulaire.
 */
function formatSeances(period: AbsencePeriod): string {
  const count = period.seance_count;
  if (period.attendance_expected) {
    return count > 1
      ? `${count} séances concernées`
      : `${count} séance concernée`;
  }
  return count > 1 ? `${count} séances écartées` : `${count} séance écartée`;
}

/** L'infobulle du compte, qui dit l'effet sur le bilan en toutes lettres. */
function titreSeances(period: AbsencePeriod): string {
  if (period.attendance_expected) {
    return `Ces séances restent comptées pour ${formatCiblePhrase(period)} : la période ne retire rien du dénominateur du bilan, et l'appel est à faire comme d'habitude.`;
  }
  return `Ces séances ne comptent ni comme présence ni comme absence pour ${formatCiblePhrase(period)} : elles sortent du dénominateur du bilan.`;
}

/** Ce que la suppression change vraiment, dit avant de confirmer : les séances
 *  ne sont pas restituées — elles n'ont jamais bougé —, elles redeviennent
 *  comptées dans le dénominateur de l'assiduité. */
function phraseSuppression(period: AbsencePeriod): string {
  // Une période « avec appel » ne retirait rien : annoncer un retour au calcul
  // laisserait croire qu'un bilan va bouger, et aucun ne bougera.
  if (period.attendance_expected) {
    return "Cette période ne retirait rien du calcul d'assiduité : aucun bilan ne change. Seul son nom disparaît des listes.";
  }
  const count = period.seance_count;
  if (count === 0) {
    return "Aucune séance n'était écartée par cette période : aucun bilan ne change.";
  }
  return count > 1
    ? `Les ${count} séances qu'elle écartait redeviendront comptées dans l'assiduité.`
    : "La séance qu'elle écartait redeviendra comptée dans l'assiduité.";
}

/**
 * Périodes de stage et d'absence justifiée d'une classe.
 *
 * **Pourquoi un onglet, et pas une section de l'onglet Élèves** : une période
 * vise aussi souvent toute la classe qu'un seul élève, et l'onglet Élèves cède
 * déjà la place à l'écran d'un élève dès qu'on en ouvre un — un onglet nommé
 * est le seul endroit qui se retrouve sans chercher quand les dates de stage
 * arrivent, trois mois après.
 */
export function AbsencesTab({
  session,
  students,
  groups,
}: AbsencesTabProps): ReactElement {
  const [periods, setPeriods] = useState<AbsencePeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Ni le dialogue de saisie ni celui de suppression ne détiennent la période :
  // on garde son identifiant et on la dérive de la liste (règle 1), pour qu'un
  // rechargement la rafraîchisse au lieu de la laisser figée.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Le dialogue d'absence du professeur est à part : il écrit sur plusieurs
  // classes à la fois, donc il ne peut pas partager l'état d'un dialogue qui
  // modifie une période de celle-ci.
  const [profOpen, setProfOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setPeriods(await api.getAbsencePeriods(session.id));
    } catch (err) {
      setLoadError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, [session.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const editing = useMemo(
    () => periods.find((p) => p.id === editingId) ?? null,
    [periods, editingId],
  );

  const toDelete = useMemo(
    () => periods.find((p) => p.id === deletingId) ?? null,
    [periods, deletingId],
  );

  const openCreate = () => {
    setEditingId(null);
    setDialogOpen(true);
  };

  const openEdit = (id: string) => {
    setEditingId(id);
    setDialogOpen(true);
  };

  // Les erreurs d'écriture s'affichent dans le dialogue qui les a provoquées :
  // c'est là que se trouve le geste à corriger (dates qui se recouvrent, élève
  // d'une autre classe), et le backend les explique en français.
  const handleSubmit = async (input: AbsencePeriodInput) => {
    if (editing) {
      await api.updateAbsencePeriod(editing.id, input);
    } else {
      await api.createAbsencePeriod(session.id, input);
    }
    await load();
  };

  // Une absence du professeur peut naître ici et toucher d'autres classes que
  // celle-ci : on recharge quand même la liste de celle-ci, la seule que cet
  // onglet affiche. Les autres se verront en ouvrant leur fiche.
  const handleTeacherAbsence = async (input: TeacherAbsenceInput) => {
    await api.createTeacherAbsencePeriods(input);
    await load();
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    await api.deleteAbsencePeriod(toDelete.id);
    await load();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>
              Stages et absences
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {periods.length}
              </span>
            </CardTitle>
            <CardDescription>
              Une période retire les séances qu'elle couvre du calcul
              d'assiduité de qui elle vise : un élève parti trois semaines en
              stage n'apparaît plus à 20/26 sur son bilan, mais à 20/20. Aucune
              séance n'est créée ni supprimée, et le cours compte toujours pour
              le reste de la classe. Une sortie scolaire se note de la même
              façon, en cochant « l'appel se fait quand même » : elle nomme
              alors ces journées sans rien retirer du calcul.
            </CardDescription>
          </div>
          {/* Deux boutons et non un sélecteur : les deux gestes ne portent pas
              sur la même chose — l'un sur cette classe, l'autre sur autant de
              classes que la journée en a vidées. */}
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setProfOpen(true)}
            >
              <UserX className="h-4 w-4" />
              Absence de ma part
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Nouvelle période
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          <DataState
            loading={loading}
            error={loadError}
            empty={periods.length === 0}
            emptyLabel="Aucune période pour cette classe. Ajoutez-en une dès que les dates d'un stage sont connues : les séances qu'elle couvre sortiront du calcul d'assiduité. Les sorties scolaires et vos propres absences se notent au même endroit."
            onRetry={() => {
              void load();
            }}
          >
            <div className="space-y-2">
              {periods.map((period) => {
                // Trois sortes de ligne, trois icônes : le professeur absent
                // n'est pas « toute la classe » — la classe était là, et c'est
                // l'inverse qu'il faut lire d'un coup d'œil.
                const profAbsent = period.teacher_absent;
                const pourToute = period.student_id === null;
                const Icone = profAbsent ? UserX : pourToute ? Users : User;
                return (
                  <div
                    key={period.id}
                    role="button"
                    tabIndex={0}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50"
                    onClick={() => openEdit(period.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openEdit(period.id);
                      }
                    }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={cn(
                          "rounded-lg p-2",
                          profAbsent
                            ? "bg-destructive/10 text-destructive"
                            : pourToute
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground",
                        )}
                        title={
                          profAbsent
                            ? "Absence du professeur : toute la classe, sans appel"
                            : pourToute
                              ? "Période de toute la classe"
                              : "Période d'un seul élève"
                        }
                      >
                        <Icone className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {period.reason}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatFenetre(period)} · {formatCible(period)}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {/* L'appel est la seule chose que le compte de séances ne
                          dit pas : « 6 séances concernées » ne distingue pas
                          une sortie d'un stage. Le mot, lui, le dit. */}
                      {period.attendance_expected && (
                        <Badge
                          variant="outline"
                          className="font-normal"
                          title="L'appel de ces séances est à faire comme d'habitude : la classe était ailleurs, mais avec vous."
                        >
                          Avec appel
                        </Badge>
                      )}
                      {period.seance_count === 0 ? (
                        <Badge
                          variant="outline"
                          className="border-amber-200 bg-amber-50 font-normal text-amber-800"
                          title="Aucune séance de la classe n'est inscrite sur ces dates : cette période ne change encore aucun bilan. Elle écartera les séances qui y seront créées."
                        >
                          Aucune séance sur ces dates
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="font-normal"
                          title={titreSeances(period)}
                        >
                          {formatSeances(period)}
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        title="Supprimer la période"
                        aria-label={`Supprimer la période « ${period.reason} »`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeletingId(period.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </DataState>
        </CardContent>
      </Card>

      <AbsencePeriodDialog
        // Le dialogue tient un brouillon : sans cette clé, passer d'une période
        // à l'autre réutiliserait l'instance et l'on enregistrerait les dates de
        // la première sous l'identifiant de la seconde (règle 2).
        key={editingId ?? "nouvelle-periode"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        period={editing}
        students={students}
        groups={groups}
        onSubmit={handleSubmit}
      />

      {/* Pas de `key` ici : ce dialogue ne modifie aucune ligne existante, il
          n'a donc pas de brouillon à oublier entre deux ouvertures — il se
          réinitialise lui-même sur `open`. */}
      <TeacherAbsenceDialog
        open={profOpen}
        onOpenChange={setProfOpen}
        session={session}
        onSubmit={handleTeacherAbsence}
      />

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null);
        }}
        title="Supprimer cette période ?"
        description={
          toDelete && (
            <>
              <p>
                « {toDelete.reason} », {formatFenetre(toDelete).toLowerCase()},
                pour {formatCiblePhrase(toDelete)}.
              </p>
              <p>{phraseSuppression(toDelete)}</p>
              <p>
                Aucune séance, aucun appel et aucun cahier de texte n'est touché.
              </p>
            </>
          )
        }
        onConfirm={handleDelete}
      />
    </div>
  );
}
