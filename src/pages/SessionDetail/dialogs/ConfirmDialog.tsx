import { useEffect, useState, type ReactElement, type ReactNode } from "react";
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
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

/**
 * Confirmation unique de toute l'application : suppressions d'élèves, de
 * séances, d'évaluations, de nœuds du référentiel, et confirmation des notes
 * orphelines côté évaluations.
 *
 * Elle porte elle-même l'erreur de `onConfirm` : le backend refuse certaines
 * suppressions avec un message qui explique quoi faire (« Archivez-la plutôt
 * que de la supprimer »), et ce message doit atterrir sous les yeux de
 * l'enseignant, pas dans la console.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Supprimer",
  destructive = true,
  onConfirm,
}: ConfirmDialogProps): ReactElement {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // L'échec de la confirmation précédente ne doit pas accueillir la suivante :
  // le même composant sert à confirmer des entités différentes l'une après
  // l'autre.
  useEffect(() => {
    if (open) {
      setError(null);
      setPending(false);
    }
  }, [open]);

  const handleConfirm = async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              {description}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <p className="whitespace-pre-line rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Annuler</AlertDialogCancel>
          <AlertDialogAction
            className={cn(
              destructive && buttonVariants({ variant: "destructive" }),
            )}
            disabled={pending}
            // Radix ferme le dialogue au clic sur l'action. Sans ce
            // `preventDefault`, la fermeture précède la fin de l'appel et une
            // erreur n'aurait plus nulle part où s'afficher.
            onClick={(event) => {
              event.preventDefault();
              void handleConfirm();
            }}
          >
            {pending ? "En cours…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
