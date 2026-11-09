import { useCallback, useEffect, useState, type ReactElement } from "react";
import { AlertTriangle, UserX } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import type { Session, TeacherAbsenceInput } from "@/types";
import { schoolYearLabel } from "@/types";

function messageOf(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Une erreur inattendue est survenue.";
}

export interface TeacherAbsenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** La classe depuis laquelle on ouvre : cochée d'emblée, et c'est son année
   *  scolaire qui borne la liste. */
  session: Session;
  /** Le parent écrit et recharge sa liste ; le dialogue affiche l'erreur. */
  onSubmit: (input: TeacherAbsenceInput) => Promise<void>;
}

/**
 * Saisie d'une **absence du professeur**, sur une ou plusieurs classes.
 *
 * Un dialogue à part et non une case de plus dans `AbsencePeriodDialog`, pour
 * la même raison qui en fait une commande à part côté Rust : la saisie porte
 * sur **plusieurs classes à la fois**, là où une période ordinaire appartient à
 * la classe qu'on a sous les yeux. Une journée de formation vide l'emploi du
 * temps entier ; la ressaisir quatre fois, une fois par fiche de classe, c'est
 * quatre occasions de se tromper d'une date.
 *
 * Les trois drapeaux — « professeur absent », « sans appel », « toute la
 * classe » — ne sont pas des champs : le backend les écrit en dur
 * (`create_teacher_absence`). Il n'y a donc rien à cocher ici qui pourrait
 * produire une absence du professeur « avec appel » ou visant un élève.
 *
 * **Aucune validation locale.** Le motif vide, la fin avant le début, le
 * chevauchement avec une période déjà saisie : tout vient du backend, qui les
 * dit en français et nomme la classe à décocher. Une seconde implémentation des
 * mêmes règles divergerait au premier ajustement — et c'est d'autant plus vrai
 * ici que le refus le plus utile, le chevauchement, n'est connu que de lui.
 *
 * **Tout ou rien** : si une classe cochée a déjà une période sur ces dates,
 * rien n'est écrit. L'enseignant décoche la classe nommée et réessaie, au lieu
 * de deviner lesquelles sont passées.
 */
export function TeacherAbsenceDialog({
  open,
  onOpenChange,
  session,
  onSubmit,
}: TeacherAbsenceDialogProps): ReactElement {
  const [reason, setReason] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTouched, setEndTouched] = useState(false);
  const [cochees, setCochees] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Les classes de l'année, chargées une fois puis conservées : rouvrir le
  // dialogue ne doit pas rejouer la requête.
  const [classes, setClasses] = useState<Session[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const toutes = await api.getSessions();
      // L'année de la classe d'où l'on vient, et elle seule : une absence de
      // mars 2027 ne touche pas une classe de l'an dernier, et la proposer
      // inviterait à cocher une ligne dont le bilan est clos.
      setClasses(toutes.filter((c) => c.year_start === session.year_start));
    } catch (err) {
      setListError(messageOf(err));
      // La classe d'où l'on vient, à défaut de la liste : c'est la seule qu'on
      // connaisse sans requête, et elle suffit à noter l'absence du jour. Une
      // liste vide aurait fermé le dialogue sur lui-même.
      setClasses([session]);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!open || classes !== null || loading) return;
    void load();
  }, [open, classes, loading, load]);

  // Le dialogue reste monté entre deux ouvertures : sans cette
  // réinitialisation, on noterait l'absence de mars avec les dates de janvier.
  // La classe d'où l'on vient est cochée d'emblée — c'est le cas le plus
  // courant, et le seul qu'on puisse deviner sans se tromper.
  useEffect(() => {
    if (!open) return;
    setReason("");
    setStartDate("");
    setEndDate("");
    setEndTouched(false);
    setCochees([session.id]);
    setError(null);
    setPending(false);
  }, [open, session.id]);

  /** Une absence d'une seule journée est le cas courant : tant que l'enseignant
   *  n'a pas fixé sa propre date de fin, elle suit la date de début. */
  const handleStartChange = (iso: string) => {
    setStartDate(iso);
    if (!endTouched) setEndDate(iso);
  };

  const basculer = (id: string, coche: boolean) => {
    setCochees((actuelles) =>
      coche
        ? actuelles.includes(id)
          ? actuelles
          : [...actuelles, id]
        : actuelles.filter((autre) => autre !== id),
    );
  };

  const handleSubmit = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit({
        session_ids: cochees,
        reason,
        start_date: startDate,
        end_date: endDate,
      });
      onOpenChange(false);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPending(false);
    }
  };

  const liste = classes ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Noter une absence de votre part</DialogTitle>
          <DialogDescription>
            Une journée de formation, un arrêt, une réunion : les séances de ces
            dates sortent du dénominateur d'assiduité de toute la classe. Aucune
            séance n'est créée ni supprimée, et l'appel n'est pas à faire — vous
            n'étiez pas là pour le faire.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="prof-absent-motif">Motif</Label>
            <Input
              id="prof-absent-motif"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Formation"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="prof-absent-debut">Du</Label>
              <Input
                id="prof-absent-debut"
                type="date"
                value={startDate}
                onChange={(event) => handleStartChange(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prof-absent-fin">Au (inclus)</Label>
              <Input
                id="prof-absent-fin"
                type="date"
                value={endDate}
                onChange={(event) => {
                  setEndDate(event.target.value);
                  setEndTouched(true);
                }}
              />
            </div>
          </div>

          {/* Des cases et non un sélecteur multiple : il faut voir d'un coup
              d'œil quelles classes sont touchées, et une absence qui n'en
              touche qu'une est aussi fréquente qu'une qui les touche toutes. */}
          <div className="space-y-2">
            <p className="text-sm font-medium">
              Classes concernées
              <span className="ml-2 font-normal text-muted-foreground">
                {schoolYearLabel(session.year_start)}
              </span>
            </p>
            <div className="space-y-1.5 rounded-md border p-3">
              {loading && liste.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Chargement des classes…
                </p>
              ) : (
                liste.map((classe) => (
                  <label
                    key={classe.id}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={cochees.includes(classe.id)}
                      onChange={(event) =>
                        basculer(classe.id, event.target.checked)
                      }
                      className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
                    />
                    <span>{classe.name}</span>
                    {classe.id === session.id && (
                      <span className="text-xs text-muted-foreground">
                        (la classe ouverte)
                      </span>
                    )}
                  </label>
                ))
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Une ligne est écrite par classe cochée : il n'y a pas d'absence
              groupée, et chacune se corrige ou se supprime depuis la fiche de sa
              classe.
            </p>
            {listError && (
              <p className="text-xs text-destructive">
                La liste des classes n'a pas pu être chargée ({listError}). Seule
                la classe ouverte est proposée ; les autres se notent depuis leur
                propre fiche.
              </p>
            )}
          </div>

          {error && (
            <p className="flex items-start gap-2 whitespace-pre-line rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Annuler
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={pending}>
            <UserX className="h-4 w-4" />
            {pending ? "Enregistrement…" : "Noter l'absence"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
