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
import { Textarea } from "@/components/ui/textarea";
import type { ProgressionEtape } from "@/types";

export interface EtapeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = création. Dérivée de la liste par le parent (règle 1). */
  etape: ProgressionEtape | null;
  onSubmit: (champs: {
    libelle: string;
    competences: string;
    connaissances: string;
    priorites: string;
  }) => Promise<void>;
}

/**
 * Une étape de l'année : l'échelon entre l'année et l'activité.
 *
 * C'est elle qui porte les compétences, les connaissances et les priorités — en
 * **texte libre**, et non des identifiants du référentiel. Décision de l'auteur :
 * ce sont ses mots, pas des cases à cocher, et une étape qui citerait le
 * référentiel se figerait au jour de sa saisie.
 *
 * Les quatre champs partent en une seule commande, et ce n'est pas la règle
 * « deux écritures sont deux commandes » qui plie : ce sont les quatre champs
 * d'un seul formulaire, saisis d'un bloc par un seul écran. La règle vise deux
 * écrans qui écrivent chacun la moitié d'une ligne sans avoir rafraîchi l'autre.
 */
export function EtapeDialog({
  open,
  onOpenChange,
  etape,
  onSubmit,
}: EtapeDialogProps): ReactElement {
  const [libelle, setLibelle] = useState("");
  const [competences, setCompetences] = useState("");
  const [connaissances, setConnaissances] = useState("");
  const [priorites, setPriorites] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Le dialogue reste monté entre deux étapes : sans cette réinitialisation à
  // chaque ouverture, on écrirait les compétences de la première sous
  // l'identifiant de la seconde.
  useEffect(() => {
    if (!open) return;
    setLibelle(etape?.libelle ?? "");
    setCompetences(etape?.competences ?? "");
    setConnaissances(etape?.connaissances ?? "");
    setPriorites(etape?.priorites ?? "");
    setError(null);
    setPending(false);
  }, [open, etape]);

  const handleSubmit = async () => {
    if (libelle.trim() === "") {
      setError(
        "Donnez un intitulé à l'étape : c'est lui qui la nomme dans la liste " +
          "et sur le document imprimé.",
      );
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit({ libelle, competences, connaissances, priorites });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {etape === null ? "Nouvelle étape" : "Modifier l'étape"}
          </DialogTitle>
          <DialogDescription>
            Une étape regroupe les activités d'une même avancée de l'année. Elle
            ne tient pas de semaines : la frise s'en charge, et une activité peut
            revenir en janvier sans que l'étape se dédouble.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="etape-libelle">Intitulé</Label>
            <Input
              id="etape-libelle"
              value={libelle}
              placeholder="Découverte des matériaux"
              disabled={pending}
              onChange={(event) => setLibelle(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="etape-competences">Compétences</Label>
            <Textarea
              id="etape-competences"
              value={competences}
              rows={3}
              placeholder="Une par ligne, avec vos mots."
              disabled={pending}
              onChange={(event) => setCompetences(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="etape-connaissances">Connaissances</Label>
            <Textarea
              id="etape-connaissances"
              value={connaissances}
              rows={3}
              disabled={pending}
              onChange={(event) => setConnaissances(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="etape-priorites">Priorités</Label>
            <Textarea
              id="etape-priorites"
              value={priorites}
              rows={2}
              disabled={pending}
              onChange={(event) => setPriorites(event.target.value)}
            />
          </div>
        </div>

        {error && (
          <p className="text-sm font-medium text-destructive">{error}</p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Annuler
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              void handleSubmit();
            }}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
