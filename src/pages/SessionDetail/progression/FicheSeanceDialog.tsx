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
import { api } from "@/lib/api";
import { exportFicheSeancePDF } from "@/lib/pdf";
import type { FicheSeance, ProgressionActivite } from "@/types";

export interface FicheSeanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dérivée de la liste par le parent (règle 1). */
  activite: ProgressionActivite;
  /** Le libellé de la séquence et de la classe, pour le sous-titre du PDF. */
  sequence: string;
  classe: string;
  schoolName: string;
}

const VIDE: FicheSeance = {
  domaine: "",
  duree: "",
  chantier: "",
  situation: "",
  epi: "",
  consigne_securite: "",
  outillage: "",
  materiaux: "",
  etapes: "",
  criteres: "",
};

/**
 * La fiche remise à l'élève pour une séance : domaine, durée, chantier,
 * situation, EPI, outillage, matériaux, étapes et critères d'auto-évaluation.
 *
 * Le parent la monte avec `key={activite.id}` (règle 2) : le brouillon est
 * celui d'une seule séance. Elle s'écrit par `save_fiche_seance`, commande
 * distincte de celle qui écrit la séance elle-même (règle 3).
 */
export function FicheSeanceDialog({
  open,
  onOpenChange,
  activite,
  sequence,
  classe,
  schoolName,
}: FicheSeanceDialogProps): ReactElement {
  const [fiche, setFiche] = useState<FicheSeance>(VIDE);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let annule = false;
    setError(null);
    setNotice(null);
    api
      .getFicheSeance(activite.id)
      .then((f) => {
        if (!annule) setFiche(f ?? VIDE);
      })
      .catch((err: unknown) => {
        if (!annule) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      annule = true;
    };
  }, [open, activite.id]);

  const champ = (cle: keyof FicheSeance, valeur: string) =>
    setFiche((precedente) => ({ ...precedente, [cle]: valeur }));

  const enregistrer = async (): Promise<boolean> => {
    setPending(true);
    setError(null);
    try {
      await api.saveFicheSeance(activite.id, fiche);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setPending(false);
    }
  };

  const exporter = async () => {
    if (!(await enregistrer())) return;
    setPending(true);
    try {
      const chemin = await exportFicheSeancePDF({
        titre: activite.libelle,
        sequence,
        classe,
        fiche,
        schoolName,
      });
      setNotice(`Fiche enregistrée : ${chemin}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const zone = (
    cle: keyof FicheSeance,
    etiquette: string,
    aide?: string,
    lignes = 3,
  ) => (
    <div className="space-y-2">
      <Label htmlFor={`fiche-${cle}`}>{etiquette}</Label>
      <Textarea
        id={`fiche-${cle}`}
        value={fiche[cle]}
        rows={lignes}
        disabled={pending}
        onChange={(event) => champ(cle, event.target.value)}
      />
      {aide && <p className="text-xs text-muted-foreground">{aide}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Fiche de la séance « {activite.libelle} »</DialogTitle>
          <DialogDescription>
            La fiche remise à l'élève. Le nom, la classe et la date s'écrivent au
            stylo, et l'élève coche Oui ou Non pour chaque critère : le tableau
            ne comporte ni colonne ni cadre pour le professeur.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="fiche-domaine">Domaine</Label>
              <Input
                id="fiche-domaine"
                value={fiche.domaine}
                disabled={pending}
                onChange={(event) => champ("domaine", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fiche-duree">Durée prévue</Label>
              <Input
                id="fiche-duree"
                value={fiche.duree}
                placeholder="2 heures"
                disabled={pending}
                onChange={(event) => champ("duree", event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fiche-chantier">Intitulé du chantier</Label>
            <Input
              id="fiche-chantier"
              value={fiche.chantier}
              placeholder={activite.libelle}
              disabled={pending}
              onChange={(event) => champ("chantier", event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Laissé vide, c'est le nom de la séance qui est imprimé.
            </p>
          </div>

          {zone("situation", "Situation professionnelle", "Ce qu'on demande à l'élève.")}
          {zone("epi", "EPI à porter", "Un équipement par ligne.")}
          {zone("consigne_securite", "Consigne de sécurité", undefined, 2)}
          {zone("outillage", "Outillage à prendre", "Un outil par ligne.")}
          {zone("materiaux", "Matériaux et consommables", "Un par ligne.")}
          {zone(
            "etapes",
            "Étapes de réalisation",
            "Une étape par ligne. Une ligne qui commence par « - » devient une sous-étape.",
            5,
          )}
          {zone(
            "criteres",
            "Critères d'auto-évaluation",
            "Un critère par ligne ; l'élève coche Oui ou Non.",
          )}
        </div>

        {error && (
          <p className="text-sm font-medium text-destructive">{error}</p>
        )}
        {notice && <p className="text-sm text-muted-foreground">{notice}</p>}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Fermer
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              void exporter();
            }}
          >
            Exporter le PDF
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              void (async () => {
                if (await enregistrer()) onOpenChange(false);
              })();
            }}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
