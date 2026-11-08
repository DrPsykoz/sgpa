import { useEffect, useState, type ReactElement } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";

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
import { api } from "@/lib/api";
import type { ProgressionDomaine } from "@/types";

export interface DomainesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Le parent détient la liste (règle 1) et la recharge après chaque écriture. */
  domaines: ProgressionDomaine[];
  onChanged: () => Promise<void>;
}

function phraseEmploi(count: number): string {
  if (count === 0) return "Employé par aucune activité";
  return count > 1 ? `${count} activités` : "1 activité";
}

/**
 * Le vocabulaire des domaines explorés dans l'année.
 *
 * **Livré vide**, comme les champs professionnels et les étiquettes de besoins :
 * ce sont les mots de l'enseignant, avec son orthographe, et l'application n'en
 * sème aucun — pas même les domaines du référentiel que son propre document
 * cite. Il est **global** et non rattaché à une année : le même domaine revient
 * d'une classe à l'autre et d'un septembre au suivant, et c'est le compte
 * d'activités affiché ici qui le dit.
 *
 * La suppression d'un domaine encore employé est refusée par le backend, qui
 * nomme le nombre d'activités concernées. Le compte est donc affiché **avant**
 * le geste : proposer un bouton dont on sait qu'il échouera vaut moins que
 * l'annoncer.
 */
export function DomainesDialog({
  open,
  onOpenChange,
  domaines,
  onChanged,
}: DomainesDialogProps): ReactElement {
  const [nouveau, setNouveau] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [brouillon, setBrouillon] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNouveau("");
    setEditingId(null);
    setBrouillon("");
    setError(null);
    setPending(false);
  }, [open]);

  /** Une écriture, un rechargement, une erreur montrée ici. Les refus du
   *  backend sont écrits en français et expliquent quoi faire : ils doivent
   *  atterrir sous les yeux de l'enseignant, pas dans la console. */
  const ecrire = async (action: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await action();
      await onChanged();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setPending(false);
    }
  };

  const ajouter = async () => {
    const nom = nouveau.trim();
    if (nom === "") {
      setError("Donnez un nom au domaine avant de l'ajouter.");
      return;
    }
    const ok = await ecrire(async () => {
      await api.createProgressionDomaine(nom);
    });
    if (ok) setNouveau("");
  };

  const renommer = async () => {
    if (editingId === null) return;
    const nom = brouillon.trim();
    if (nom === "") {
      setError("Un domaine sans nom ne se retrouverait plus dans la liste.");
      return;
    }
    const id = editingId;
    const ok = await ecrire(async () => {
      await api.renameProgressionDomaine(id, nom);
    });
    if (ok) setEditingId(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Domaines à explorer</DialogTitle>
          <DialogDescription>
            Vos mots, et vous seul les posez : l'application n'en propose aucun.
            Un domaine sert à toutes vos classes et à toutes les années — une
            activité s'y rattache pour dire ce qu'elle explore.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            value={nouveau}
            placeholder="Nouveau domaine"
            disabled={pending}
            onChange={(event) => setNouveau(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void ajouter();
              }
            }}
          />
          <Button
            className="shrink-0"
            disabled={pending}
            onClick={() => {
              void ajouter();
            }}
          >
            <Plus className="h-4 w-4" />
            Ajouter
          </Button>
        </div>

        {error && (
          <p className="text-sm font-medium text-destructive">{error}</p>
        )}

        {domaines.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Aucun domaine pour l'instant. Ajoutez-en un dès que vous savez
            comment vous nommez ce que la classe va explorer cette année.
          </p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {domaines.map((domaine) =>
              domaine.id === editingId ? (
                <li key={domaine.id} className="flex items-center gap-2">
                  <Input
                    value={brouillon}
                    autoFocus
                    disabled={pending}
                    onChange={(event) => setBrouillon(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void renommer();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setEditingId(null);
                      }
                    }}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    aria-label="Enregistrer le nom"
                    disabled={pending}
                    onClick={() => {
                      void renommer();
                    }}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    aria-label="Abandonner"
                    disabled={pending}
                    onClick={() => setEditingId(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ) : (
                <li
                  key={domaine.id}
                  className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {domaine.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {phraseEmploi(domaine.activity_count)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      aria-label={`Renommer « ${domaine.name} »`}
                      disabled={pending}
                      onClick={() => {
                        setEditingId(domaine.id);
                        setBrouillon(domaine.name);
                        setError(null);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      aria-label={`Supprimer « ${domaine.name} »`}
                      title={
                        domaine.activity_count > 0
                          ? "Ce domaine est encore employé : retirez-le d'abord des activités qui le citent."
                          : "Supprimer ce domaine"
                      }
                      disabled={pending}
                      onClick={() => {
                        void ecrire(async () => {
                          await api.deleteProgressionDomaine(domaine.id);
                        });
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
