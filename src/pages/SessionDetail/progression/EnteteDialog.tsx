import { useEffect, useState, type ReactElement } from "react";

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
import type { Progression } from "@/types";

export interface EnteteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  progression: Progression;
  /** Le parent écrit et recharge ; le dialogue affiche l'erreur. */
  onSubmit: (
    titre: string,
    intituleGroupe: string,
    devise: string,
  ) => Promise<void>;
}

/**
 * Les trois libellés de l'en-tête imprimé.
 *
 * Aucun des trois ne sert à l'écran : ils ne paraissent que sur le PDF, en tête
 * du document. C'est pourquoi ils vivent dans un dialogue et non dans la page —
 * trois champs vides en permanence au-dessus de la frise auraient donné à croire
 * qu'il faut les remplir pour planifier l'année.
 *
 * « Gr 2 » est un **libellé**, pas une entité : il n'existe pas d'objet
 * « groupe » dans le modèle, et rien ne s'y rattache. Une classe a une
 * progression, et cet intitulé dit simplement de quel groupe le document parle.
 */
export function EnteteDialog({
  open,
  onOpenChange,
  progression,
  onSubmit,
}: EnteteDialogProps): ReactElement {
  const [titre, setTitre] = useState("");
  const [intituleGroupe, setIntituleGroupe] = useState("");
  const [devise, setDevise] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Le dialogue reste monté : sans cette réinitialisation à chaque ouverture, un
  // abandon laisserait le brouillon de la fois précédente.
  useEffect(() => {
    if (!open) return;
    setTitre(progression.titre);
    setIntituleGroupe(progression.intitule_groupe);
    setDevise(progression.devise);
    setError(null);
    setPending(false);
  }, [open, progression]);

  const handleSubmit = async () => {
    setPending(true);
    setError(null);
    try {
      await onSubmit(titre, intituleGroupe, devise);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>En-tête du document</DialogTitle>
          <DialogDescription>
            Ces trois libellés ne paraissent que sur le PDF de la progression.
            Laissés vides, ils ne s'impriment pas : la page commence alors par la
            frise.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="progression-titre">Titre</Label>
            <Input
              id="progression-titre"
              value={titre}
              placeholder="Plan de progression"
              onChange={(event) => setTitre(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="progression-groupe">Intitulé de groupe</Label>
            <Input
              id="progression-groupe"
              value={intituleGroupe}
              placeholder="Gr 2"
              onChange={(event) => setIntituleGroupe(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Un libellé imprimé, et rien de plus : aucun élève ne s'y rattache
              et aucun calcul ne le lit.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="progression-devise">Devise</Label>
            <Input
              id="progression-devise"
              value={devise}
              placeholder="Apprendre en faisant"
              onChange={(event) => setDevise(event.target.value)}
            />
          </div>
        </div>

        {error && (
          <p className="text-sm font-medium text-destructive">{error}</p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Annuler
          </Button>
          <Button
            onClick={() => {
              void handleSubmit();
            }}
            disabled={pending}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
