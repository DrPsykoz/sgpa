import {
  useEffect,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
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
import type { Student } from "@/types";

export interface StudentFormValues {
  firstName: string;
  lastName: string;
  enrolledOn: string;
  leftOn: string | null;
}

export interface StudentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = création */
  student: Student | null;
  /** Pré-remplissage de « inscrit depuis le » en création : début de l'année scolaire. */
  defaultEnrolledOn: string;
  onSubmit: (values: StudentFormValues) => Promise<void>;
}

/**
 * Dialogue unique d'ajout et de modification d'un élève.
 *
 * La période d'inscription est éditable dans les deux cas : c'est elle qui
 * borne l'appel et le dénominateur de l'assiduité, un élève arrivé en janvier
 * ne doit pas être compté absent de septembre à décembre.
 */
export function StudentFormDialog({
  open,
  onOpenChange,
  student,
  defaultEnrolledOn,
  onSubmit,
}: StudentFormDialogProps): ReactElement {
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [enrolledOn, setEnrolledOn] = useState(defaultEnrolledOn);
  const [leftOn, setLeftOn] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Le dialogue reste monté entre deux élèves : sans cette réinitialisation à
  // chaque ouverture, on modifierait Martin avec les champs de Dupont.
  useEffect(() => {
    if (!open) return;
    setLastName(student?.last_name ?? "");
    setFirstName(student?.first_name ?? "");
    setEnrolledOn(student?.enrolled_on ?? defaultEnrolledOn);
    setLeftOn(student?.left_on ?? "");
    setError(null);
    setPending(false);
  }, [open, student, defaultEnrolledOn]);

  const handleSubmit = async () => {
    const values: StudentFormValues = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      enrolledOn,
      leftOn: leftOn.trim() === "" ? null : leftOn,
    };

    if (values.lastName === "") {
      setError("Le nom de l'élève est obligatoire.");
      return;
    }
    if (values.enrolledOn === "") {
      setError("La date d'inscription est obligatoire.");
      return;
    }
    if (values.leftOn !== null && values.leftOn < values.enrolledOn) {
      setError("La date de sortie ne peut pas précéder la date d'inscription.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      await onSubmit(values);
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
            {student ? "Modifier l'élève" : "Ajouter un élève"}
          </DialogTitle>
          <DialogDescription>
            Le nom suffit ; la période d'inscription borne l'appel et l'assiduité.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="student-last-name">Nom</Label>
              <Input
                id="student-last-name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                onKeyDown={submitOnEnter}
                placeholder="Nom de famille"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="student-first-name">Prénom</Label>
              <Input
                id="student-first-name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                onKeyDown={submitOnEnter}
                placeholder="Prénom"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="student-enrolled-on">Inscrit depuis le</Label>
              <Input
                id="student-enrolled-on"
                type="date"
                value={enrolledOn}
                onChange={(event) => setEnrolledOn(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="student-left-on">Sorti le</Label>
              <Input
                id="student-left-on"
                type="date"
                value={leftOn}
                onChange={(event) => setLeftOn(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Laisser vide si l'élève est toujours dans la classe.
              </p>
            </div>
          </div>

          {error && (
            <p className="whitespace-pre-line rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
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
              : student
                ? "Enregistrer"
                : "Ajouter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
