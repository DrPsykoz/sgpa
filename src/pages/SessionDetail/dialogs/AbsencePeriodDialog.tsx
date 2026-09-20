import {
  useEffect,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { AlertTriangle } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AbsencePeriod, AbsencePeriodInput, Student } from "@/types";

/** Radix refuse la chaîne vide comme valeur d'un `SelectItem` : il faut une
 *  sentinelle pour « toute la classe ». Elle ne quitte jamais ce fichier —
 *  `student_id` part à `null`. */
const TOUTE_LA_CLASSE = "toute-la-classe";

/** Affichage français d'une date stockée en AAAA-MM-JJ. */
function formatDate(iso: string): string {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR");
}

function fullName(lastName: string, firstName: string): string {
  return `${lastName} ${firstName}`.trim();
}

export interface AbsencePeriodDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = création. */
  period: AbsencePeriod | null;
  /** Élèves de cette classe. Le parent détient la liste (règle 1) : un élève
   *  d'une autre classe serait refusé en Rust, il n'est donc pas proposé. */
  students: Student[];
  /** Le parent écrit et recharge sa liste ; le dialogue affiche l'erreur. */
  onSubmit: (input: AbsencePeriodInput) => Promise<void>;
}

/**
 * Saisie d'une période de stage ou d'absence justifiée.
 *
 * Le dialogue ne crée ni ne supprime aucune séance : il désigne une fenêtre de
 * dates, et les séances qu'elle couvre quittent le dénominateur d'assiduité de
 * qui elle vise. Le cahier de texte, l'appel et le bilan du reste de la classe
 * sont intacts — c'est ce que dit le sous-titre, et c'est ce qui distingue une
 * période d'une séance annulée.
 */
export function AbsencePeriodDialog({
  open,
  onOpenChange,
  period,
  students,
  onSubmit,
}: AbsencePeriodDialogProps): ReactElement {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTouched, setEndTouched] = useState(false);
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState(TOUTE_LA_CLASSE);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Le dialogue reste monté entre deux périodes : sans cette réinitialisation à
  // chaque ouverture, on modifierait le stage de janvier avec les dates de mars.
  useEffect(() => {
    if (!open) return;
    setStartDate(period?.start_date ?? "");
    setEndDate(period?.end_date ?? "");
    setEndTouched(period !== null);
    setReason(period?.reason ?? "");
    setTarget(period?.student_id ?? TOUTE_LA_CLASSE);
    setError(null);
    setPending(false);
  }, [open, period]);

  /** Une période d'un seul jour est le cas courant : tant que l'enseignant n'a
   *  pas fixé sa propre date de fin, elle suit la date de début. */
  const handleStartChange = (iso: string) => {
    setStartDate(iso);
    if (!endTouched) setEndDate(iso);
  };

  const handleSubmit = async () => {
    const motif = reason.trim();
    if (motif === "") {
      setError(
        "Indiquez le motif de cette période, par exemple « Stage en entreprise » " +
          "ou « Hospitalisation » : c'est lui qui la nomme dans la liste.",
      );
      return;
    }
    if (startDate === "" || endDate === "") {
      setError(
        "Indiquez la date de début et la date de fin. Pour une absence d'une " +
          "seule journée, saisissez deux fois la même date.",
      );
      return;
    }
    // Les dates sont en AAAA-MM-JJ : la comparaison de chaînes suffit.
    if (endDate < startDate) {
      setError(
        `La date de fin (${formatDate(endDate)}) précède la date de début ` +
          `(${formatDate(startDate)}).`,
      );
      return;
    }

    setPending(true);
    setError(null);
    try {
      await onSubmit({
        student_id: target === TOUTE_LA_CLASSE ? null : target,
        reason: motif,
        start_date: startDate,
        end_date: endDate,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {period ? "Modifier la période" : "Nouvelle période d'absence"}
          </DialogTitle>
          <DialogDescription>
            Les séances de la classe comprises dans ces dates cessent de compter
            dans l'assiduité de qui la période vise. Aucune séance n'est créée ni
            supprimée : le cours a eu lieu, et il compte toujours pour les autres.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="absence-reason">Motif</Label>
            <Input
              id="absence-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              onKeyDown={submitOnEnter}
              placeholder="Stage en entreprise"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="absence-start">Du</Label>
              <Input
                id="absence-start"
                type="date"
                value={startDate}
                onChange={(event) => handleStartChange(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="absence-end">Au (inclus)</Label>
              <Input
                id="absence-end"
                type="date"
                value={endDate}
                onChange={(event) => {
                  setEndDate(event.target.value);
                  setEndTouched(true);
                }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="absence-target">Concerne</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger id="absence-target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TOUTE_LA_CLASSE}>Toute la classe</SelectItem>
                {students.map((student) => (
                  <SelectItem key={student.id} value={student.id}>
                    {fullName(student.last_name, student.first_name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              « Toute la classe » pour un stage collectif ; un élève pour une
              hospitalisation ou un stage qui ne concerne que lui.
            </p>
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
            {pending
              ? "Enregistrement…"
              : period
                ? "Enregistrer"
                : "Ajouter la période"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
