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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ProgressionActivite,
  ProgressionDomaine,
  ProgressionEtape,
} from "@/types";

/** Radix refuse la chaîne vide comme valeur d'un `SelectItem` : il faut une
 *  sentinelle pour « aucun domaine ». Elle ne quitte jamais ce fichier —
 *  `domaine_id` part à `null`. */
const AUCUN_DOMAINE = "aucun-domaine";

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
  domaines: ProgressionDomaine[];
  onSubmit: (champs: {
    libelle: string;
    domaineId: string | null;
    etapeId: string;
  }) => Promise<void>;
}

/**
 * Une activité : ce qu'on fait, rattaché à une étape et, facultativement, à un
 * domaine.
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
  domaines,
  onSubmit,
}: ActiviteDialogProps): ReactElement {
  const [libelle, setLibelle] = useState("");
  const [domaine, setDomaine] = useState(AUCUN_DOMAINE);
  const [etapeId, setEtapeId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Le dialogue reste monté d'une activité à l'autre : sans cette
  // réinitialisation, on enregistrerait l'intitulé de la première sous
  // l'identifiant de la seconde.
  useEffect(() => {
    if (!open) return;
    setLibelle(activite?.libelle ?? "");
    setDomaine(activite?.domaine_id ?? AUCUN_DOMAINE);
    setEtapeId(activite?.etape_id ?? etapeParDefaut);
    setError(null);
    setPending(false);
  }, [open, activite, etapeParDefaut]);

  const handleSubmit = async () => {
    if (libelle.trim() === "") {
      setError(
        "Donnez un intitulé à l'activité : c'est lui qui s'écrit sur la frise.",
      );
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit({
        libelle,
        domaineId: domaine === AUCUN_DOMAINE ? null : domaine,
        etapeId,
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
      <DialogContent className="sm:max-w-lg">
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
            <Label htmlFor="activite-libelle">Intitulé</Label>
            <Input
              id="activite-libelle"
              value={libelle}
              placeholder="Fabrication d'un banc"
              disabled={pending}
              onChange={(event) => setLibelle(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="activite-domaine">Domaine</Label>
            <Select
              value={domaine}
              disabled={pending}
              onValueChange={setDomaine}
            >
              <SelectTrigger id="activite-domaine">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUCUN_DOMAINE}>Aucun domaine</SelectItem>
                {domaines.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {domaines.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Aucun domaine n'est encore défini. Le bouton « Domaines », en
                tête de l'onglet, ouvre votre vocabulaire.
              </p>
            )}
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
