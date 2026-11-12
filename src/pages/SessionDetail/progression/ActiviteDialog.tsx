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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MOTS_DE_NATURE, NATURES_DACTIVITE } from "@/types";
import type {
  NatureDActivite,
  ProgressionActivite,
  ProgressionEtape,
} from "@/types";

export interface ActiviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = création. Dérivée de la liste par le parent (règle 1). */
  activite: ProgressionActivite | null;
  /** Étape d'accueil d'une création : celle dont on a cliqué le bouton. */
  etapeParDefaut: string;
  /** Les étapes de CETTE progression. Le backend refuse l'étape d'une autre
   *  progression ; elle n'est donc pas proposée. */
  etapes: ProgressionEtape[];
  onSubmit: (champs: {
    libelle: string;
    domaineId: string | null;
    etapeId: string;
    /** La sorte de ligne (palier 026). */
    nature: NatureDActivite;
    /** L'objectif de la ligne (palier 026). */
    objectif: string;
    /** Les compétences évaluées par CETTE ligne (palier 026). */
    competencyIds: string[];
  }) => Promise<void>;
  /** La classe, pour que le sélecteur écarte les compétences que son
   *  établissement n'emploie pas (palier 025). Même rôle que dans
   *  `EtapeDialog`. */
  sessionId: string;
}

/**
 * Une ligne de progression : ce qu'on fait, rattaché à une étape et,
 * facultativement, à un domaine.
 *
 * **Trois choses sont arrivées au palier 026**, et toutes les trois viennent de
 * la forme des documents de l'auteur :
 *
 * - la **nature** de la ligne, close à trois valeurs parce que c'est du code
 *   qui la lit pour composer le préfixe imprimé — et non un vocabulaire
 *   d'établissement, qui resterait libre comme la catégorie d'un rendez-vous ;
 * - son **objectif**, une phrase ;
 * - ses **compétences**, cochées dans le même référentiel que celles de
 *   l'étape. L'activité les **gagne**, elle ne les **prend pas** à l'étape : la
 *   décision du 2026-11-07 tient, les deux niveaux coexistent, et une
 *   progression saisie avant ce palier se relit exactement comme la veille.
 *
 * Le sélecteur d'étape sert à **déplacer** l'activité, et un déplacement
 * recolorie la frise : la couleur d'une activité vient de son rang dans
 * l'année, qui est le parcours des étapes puis de leurs activités. C'est dit
 * sous le champ, parce qu'une couleur qui change sans qu'on l'ait demandée
 * passe pour un défaut.
 */
export function ActiviteDialog({
  open,
  onOpenChange,
  activite,
  etapeParDefaut,
  etapes,
  onSubmit,
  sessionId,
}: ActiviteDialogProps): ReactElement {
  const [libelle, setLibelle] = useState("");
  const [etapeId, setEtapeId] = useState("");
  const [nature, setNature] = useState<NatureDActivite>("activite");
  const [objectif, setObjectif] = useState("");
  const [competencyIds, setCompetencyIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Le dialogue reste monté d'une activité à l'autre : sans cette
  // réinitialisation, on enregistrerait l'intitulé de la première sous
  // l'identifiant de la seconde.
  useEffect(() => {
    if (!open) return;
    setLibelle(activite?.libelle ?? "");
    setEtapeId(activite?.etape_id ?? etapeParDefaut);
    // « activité » par défaut à la création : c'est la nature de loin la plus
    // fréquente dans les deux documents, et celle de toute ligne d'avant ce
    // palier.
    setNature(activite?.nature ?? "activite");
    setObjectif(activite?.objectif ?? "");
    setCompetencyIds((activite?.competences_ref ?? []).map((c) => c.id));
    setError(null);
    setPending(false);
  }, [open, activite, etapeParDefaut]);

  const handleSubmit = async () => {
    if (libelle.trim() === "") {
      setError(
        "Donnez un nom à l'activité : c'est lui qui s'écrit sur la frise.",
      );
      return;
    }
    if (objectif.trim() === "") {
      setError("Donnez un objectif à l'activité : ce qu'elle cherche à obtenir.");
      return;
    }
    if (competencyIds.length === 0) {
      setError("Choisissez au moins une compétence évaluée par l'activité.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit({
        libelle,
        // Le domaine n'existe plus à l'écran, mais celui d'une activité
        // d'avant reste en base : il transite inchangé.
        domaineId: activite?.domaine_id ?? null,
        etapeId,
        nature,
        objectif,
        competencyIds,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const changeDEtape = activite !== null && activite.etape_id !== etapeId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {activite === null ? "Nouvelle activité" : "Modifier l'activité"}
          </DialogTitle>
          <DialogDescription>
            L'activité est ce qui se pose sur la frise. Son domaine dit ce
            qu'elle explore ; il reste facultatif tant que vous n'avez pas
            tranché.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="activite-libelle">Nom</Label>
            <Input
              id="activite-libelle"
              value={libelle}
              placeholder="Fabrication d'un banc"
              disabled={pending}
              onChange={(event) => setLibelle(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="activite-nature">Nature de la ligne</Label>
            <Select
              value={nature}
              disabled={pending}
              onValueChange={(valeur) => setNature(valeur as NatureDActivite)}
            >
              <SelectTrigger id="activite-nature">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NATURES_DACTIVITE.map((valeur) => (
                  <SelectItem key={valeur} value={valeur}>
                    {MOTS_DE_NATURE[valeur]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Ce mot s'imprime devant l'intitulé, sur l'écran comme sur le
              document. Les trois sont celles de vos progressions : on analyse
              la situation, on mène des activités, on met en œuvre en TP.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="activite-objectif">Objectif *</Label>
            <Textarea
              id="activite-objectif"
              value={objectif}
              rows={2}
              placeholder="Savoir repérer les différentes vues d'un ouvrage"
              disabled={pending}
              onChange={(event) => setObjectif(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>
              Compétences évaluées * ({competencyIds.length} sélectionnée
              {competencyIds.length > 1 ? "s" : ""})
            </Label>
            <CompetencyPicker
              selected={competencyIds}
              onChange={setCompetencyIds}
              sessionId={sessionId}
            />
            <p className="text-xs text-muted-foreground">
              Au moins une, prise dans le référentiel : c'est ici que se
              choisissent les compétences, pour chaque activité.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="activite-etape">Étape</Label>
            <Select
              value={etapeId}
              disabled={pending}
              onValueChange={setEtapeId}
            >
              <SelectTrigger id="activite-etape">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {etapes.map((etape) => (
                  <SelectItem key={etape.id} value={etape.id}>
                    {etape.libelle}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {changeDEtape && (
              <p className="text-xs text-muted-foreground">
                Déplacer l'activité change son rang dans l'année, donc sa
                couleur sur la frise. Les semaines où elle est posée ne bougent
                pas.
              </p>
            )}
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
