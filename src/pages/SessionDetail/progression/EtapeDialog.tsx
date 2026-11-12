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
    /** Le texte libre d'avant le palier 021, transité inchangé — vide seulement
     *  si l'enseignant a cliqué « Effacer ce texte ». */
    competences: string;
    connaissances: string;
    priorites: string;
    /** Les objectifs de la séquence (palier 026). */
    objectifs: string;
    /** Le métier et le CAP découverts (palier 026). */
    metierCap: string;
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
 * **Les objectifs et le métier sont arrivés au palier 026**, parce que les
 * deux documents de l'auteur ouvrent chaque séquence par ces deux lignes et
 * qu'aucune colonne ne pouvait les accueillir : un but n'est pas une
 * connaissance, et un métier à découvrir n'est pas une priorité de passage.
 * Les loger dans l'un des deux les aurait imprimés sous un intitulé faux.
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
  const [objectifs, setObjectifs] = useState("");
  const [metierCap, setMetierCap] = useState("");
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
    setObjectifs(etape?.objectifs ?? "");
    setMetierCap(etape?.metier_cap ?? "");
    setCompetencyIds((etape?.competences_ref ?? []).map((c) => c.id));
    setError(null);
    setPending(false);
  }, [open, etape]);

  const handleSubmit = async () => {
    if (libelle.trim() === "") {
      setError(
        "Donnez un nom à la séquence : c'est lui qui la nomme dans la liste " +
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
        objectifs,
        metierCap,
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
            <Label htmlFor="etape-libelle">Séquence</Label>
            <Input
              id="etape-libelle"
              value={libelle}
              placeholder="SEQUENCE 1 : La boîte en bois"
              disabled={pending}
              onChange={(event) => setLibelle(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="etape-objectifs">Objectifs</Label>
            <Textarea
              id="etape-objectifs"
              value={objectifs}
              rows={2}
              placeholder="Réaliser une boîte en bois"
              disabled={pending}
              onChange={(event) => setObjectifs(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Ce que la séquence vise.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="etape-metier">Métier et CAP découverts</Label>
            <Input
              id="etape-metier"
              value={metierCap}
              placeholder="Découvrir le métier et le CAP de menuisier"
              disabled={pending}
              onChange={(event) => setMetierCap(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Du texte libre, et non une entrée du référentiel : la découverte
              d'un métier en séquence n'est pas le projet d'un élève. Le
              référentiel, lui, se cite dans la fiche contrat.
            </p>
          </div>

          {/* Les compétences se choisissent désormais dans chaque activité.
              Celles que l'étape portait déjà ne sont ni perdues ni
              modifiables ici : elles restent lisibles, et imprimées, jusqu'à
              ce que l'enseignant les retire d'un bouton. */}
          {competencyIds.length > 0 && (
            <div className="space-y-2 rounded-lg border border-dashed px-3 py-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Compétences rattachées à la séquence
              </p>
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {(etape?.competences_ref ?? [])
                  .filter((c) => competencyIds.includes(c.id))
                  .map((c) => (
                    <li key={c.id}>{c.name}</li>
                  ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Les compétences se choisissent maintenant dans chaque activité.
                Celles-ci ont été rattachées à la séquence avant ce changement :
                elles restent affichées et imprimées tant que vous ne les retirez
                pas. Le retrait s'enregistre avec le reste du formulaire.
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setCompetencyIds([])}
              >
                Retirer ces compétences
              </Button>
            </div>
          )}

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

          {connaissances.trim() !== "" && (
            <div className="space-y-2 rounded-lg border border-dashed px-3 py-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Connaissances saisies avant
              </p>
              <p className="whitespace-pre-line text-sm">{connaissances}</p>
              <p className="text-xs text-muted-foreground">
                Ce champ n'est plus proposé. Le texte reste affiché et imprimé
                tant que vous ne l'effacez pas. L'effacement s'enregistre avec
                le reste du formulaire.
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setConnaissances("")}
              >
                Effacer ce texte
              </Button>
            </div>
          )}

          {priorites.trim() !== "" && (
            <div className="space-y-2 rounded-lg border border-dashed px-3 py-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Priorités saisies avant
              </p>
              <p className="whitespace-pre-line text-sm">{priorites}</p>
              <p className="text-xs text-muted-foreground">
                Ce champ n'est plus proposé. Le texte reste affiché et imprimé
                tant que vous ne l'effacez pas. L'effacement s'enregistre avec
                le reste du formulaire.
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setPriorites("")}
              >
                Effacer ce texte
              </Button>
            </div>
          )}
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
