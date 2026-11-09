import { useEffect, useState, type ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { CompetencyPicker } from "@/components/CompetencyPicker";
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
    /** Le texte libre d'avant le palier 021, transité inchangé — vide seulement
     *  si l'enseignant a cliqué « Effacer ce texte ». */
    competences: string;
    connaissances: string;
    priorites: string;
    competencyIds: string[];
  }) => Promise<void>;
}

/**
 * Une étape de l'année : l'échelon entre l'année et l'activité.
 *
 * C'est elle qui porte les compétences, les connaissances et les priorités. Les
 * **compétences se cochent dans le référentiel** depuis le palier 021 : le même
 * `CompetencyPicker` que les évaluations, pour que la même compétence s'écrive
 * du même mot dans le plan de l'année et dans le bulletin. L'auteur a rouvert
 * le 2026-11-09 sa décision de texte libre du 2026-11-07 — ne pas la refermer
 * sans lui.
 *
 * **Le texte libre d'avant n'a pas disparu de la base**, et ce dialogue est le
 * seul endroit qui l'efface : il le montre en lecture seule, explique d'où il
 * vient, et attend un clic. Tant qu'il est là il est réécrit tel quel à chaque
 * enregistrement — c'est la raison du champ `competences` dans `onSubmit`, et
 * l'omettre effacerait les phrases d'un enseignant au premier renommage.
 *
 * Tout part en une seule commande, et ce n'est pas la règle « deux écritures
 * sont deux commandes » qui plie : ce sont les champs d'un seul formulaire,
 * saisis d'un bloc par un seul écran. La règle vise deux écrans qui écrivent
 * chacun la moitié d'une ligne sans avoir rafraîchi l'autre.
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
  const [competencyIds, setCompetencyIds] = useState<string[]>([]);
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
    setCompetencyIds((etape?.competences_ref ?? []).map((c) => c.id));
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
      await onSubmit({
        libelle,
        competences,
        connaissances,
        priorites,
        competencyIds,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
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
            <Label>
              Compétences ({competencyIds.length} sélectionnée
              {competencyIds.length > 1 ? "s" : ""})
            </Label>
            <CompetencyPicker
              selected={competencyIds}
              onChange={setCompetencyIds}
            />
            <p className="text-xs text-muted-foreground">
              Elles viennent du référentiel, celui de Réglages : une compétence
              renommée là-bas se renomme ici et sur le document imprimé.
            </p>
          </div>

          {/* Le texte d'avant le sélecteur. Il n'est pas modifiable : le
              remettre en saisie rouvrirait les deux façons de dire la même
              chose, et c'est justement ce que le palier 021 referme. Il reste
              lisible, et imprimé, jusqu'à ce que l'enseignant l'efface. */}
          {competences.trim() !== "" && (
            <div className="space-y-2 rounded-lg border border-dashed px-3 py-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Compétences saisies à la main
              </p>
              <p className="whitespace-pre-line text-sm">{competences}</p>
              <p className="text-xs text-muted-foreground">
                Ce texte a été écrit avant que le sélecteur n'existe. Il reste
                affiché et imprimé tant que vous ne l'effacez pas : retrouvez
                ces compétences dans le référentiel ci-dessus, puis effacez-le.
                L'effacement s'enregistre avec le reste du formulaire.
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setCompetences("")}
              >
                Effacer ce texte
              </Button>
            </div>
          )}

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
