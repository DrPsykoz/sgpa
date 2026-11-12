import { useEffect, useState, type KeyboardEvent, type ReactElement } from "react";
import { AlertTriangle, Check, Pencil, Plus, Trash2, Users, X } from "lucide-react";

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
import { GROUP_NAME_MAX, type StudentGroup } from "@/types";

function messageOf(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Une erreur inattendue est survenue.";
}

/** « 3 élèves », « 1 élève », « aucun élève ». */
function compteDEleves(n: number): string {
  if (n === 0) return "aucun élève";
  return `${n} ${n > 1 ? "élèves" : "élève"}`;
}

/**
 * Ce qu'une suppression heurterait, dit **avant** de proposer le bouton.
 *
 * Les clés étrangères de `seances` et `evaluations` sont en RESTRICT : le refus
 * viendrait de toute façon, mais dans les mots de SQLite. Le backend rend donc
 * les deux comptes à la lecture, exactement comme `activity_count` pour les
 * domaines de progression, et l'écran s'en sert pour désactiver le bouton et
 * dire pourquoi.
 */
function raisonDeNePasSupprimer(group: StudentGroup): string | null {
  const parts: string[] = [];
  if (group.seance_count > 0) {
    parts.push(
      `${group.seance_count} séance${group.seance_count > 1 ? "s" : ""}`,
    );
  }
  if (group.evaluation_count > 0) {
    parts.push(
      `${group.evaluation_count} évaluation${group.evaluation_count > 1 ? "s" : ""}`,
    );
  }
  if (parts.length === 0) return null;
  return (
    `Ce groupe porte ${parts.join(" et ")} : les supprimer changerait des ` +
    "bilans déjà établis. Renommez-le plutôt."
  );
}

export interface GroupsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  /** Le parent détient la liste (règle 1) : le dialogue ne garde aucune copie
   *  figée, il écrit puis demande le rechargement. */
  groups: StudentGroup[];
  reload: () => Promise<void>;
}

/**
 * Créer, renommer et supprimer les groupes d'une classe.
 *
 * **Autant de groupes que voulu, nommés librement** — décision de l'enseignant
 * du 2026-11-12. L'application n'en sème aucun et ne propose pas « Groupe 1 /
 * Groupe 2 » d'office : le vocabulaire appartient à l'atelier, comme les
 * champs professionnels et les domaines de progression. Un enseignant qui veut
 * « Bois » et « Métal » ne doit pas commencer par effacer deux noms.
 *
 * La répartition, elle, ne se fait pas ici mais dans la colonne « Groupe » du
 * tableau des élèves : y mettre aussi les cases à cocher aurait fait deux
 * écrans pour un seul geste, et surtout obligé à rouvrir ce dialogue à chaque
 * nouvel élève inscrit en cours d'année.
 */
export function GroupsDialog({
  open,
  onOpenChange,
  sessionId,
  groups,
  reload,
}: GroupsDialogProps): ReactElement {
  const [nouveau, setNouveau] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // L'identifiant, pas le groupe : le parent recharge sa liste, et un groupe
  // recopié dans un état se serait figé sur son ancien nom.
  const [renommeId, setRenommeId] = useState<string | null>(null);
  const [renomme, setRenomme] = useState("");

  useEffect(() => {
    if (!open) return;
    setNouveau("");
    setError(null);
    setPending(false);
    setRenommeId(null);
    setRenomme("");
  }, [open]);

  const executer = async (action: () => Promise<unknown>) => {
    setPending(true);
    setError(null);
    try {
      await action();
      await reload();
      return true;
    } catch (err) {
      setError(messageOf(err));
      return false;
    } finally {
      setPending(false);
    }
  };

  const creer = async () => {
    const nom = nouveau.trim();
    if (nom === "") {
      setError(
        "Donnez un nom à ce groupe : « Groupe 1 », « Atelier bois »… c'est " +
          "lui qui le désigne partout ailleurs.",
      );
      return;
    }
    if (await executer(() => api.createStudentGroup(sessionId, nom))) {
      setNouveau("");
    }
  };

  const enregistrerLeNom = async (id: string) => {
    const nom = renomme.trim();
    if (nom === "") {
      setError("Le nom d'un groupe ne peut pas être vide.");
      return;
    }
    if (await executer(() => api.renameStudentGroup(id, nom))) {
      setRenommeId(null);
      setRenomme("");
    }
  };

  const supprimer = (id: string) => {
    void executer(() => api.deleteStudentGroup(id));
  };

  const surEntree = (
    event: KeyboardEvent<HTMLInputElement>,
    action: () => void,
  ) => {
    if (event.key === "Enter") {
      event.preventDefault();
      action();
    }
    if (event.key === "Escape" && renommeId !== null) {
      event.preventDefault();
      setRenommeId(null);
    }
  };

  const sansGroupeNote =
    groups.length > 0
      ? "Un élève qu'aucun groupe ne réclame est convoqué à toutes les séances, y compris à celles d'un groupe nommé : un oubli de répartition se voit donc à l'appel, au lieu de disparaître des calculs."
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Groupes de la classe</DialogTitle>
          <DialogDescription>
            Un groupe sert à tenir une séance ou une évaluation avec une partie
            de la classe seulement. L'appel ne convoque alors que lui, et les
            autres élèves ne voient pas cette séance compter dans leur
            assiduité. Un élève n'appartient qu'à un seul groupe.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={nouveau}
              onChange={(event) => setNouveau(event.target.value)}
              onKeyDown={(event) => surEntree(event, () => void creer())}
              placeholder="Groupe 1"
              maxLength={GROUP_NAME_MAX}
              disabled={pending}
              aria-label="Nom du nouveau groupe"
              autoFocus
            />
            <Button onClick={() => void creer()} disabled={pending}>
              <Plus className="h-4 w-4" />
              Ajouter
            </Button>
          </div>

          {groups.length === 0 ? (
            <div className="rounded-md border border-dashed py-8 text-center">
              <Users className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Aucun groupe dans cette classe.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Tant qu'il n'y en a pas, rien ne change : chaque séance et
                chaque évaluation concerne la classe entière.
              </p>
            </div>
          ) : (
            <ul className="divide-y rounded-md border">
              {groups.map((group) => {
                const blocage = raisonDeNePasSupprimer(group);
                const enEdition = renommeId === group.id;
                return (
                  <li
                    key={group.id}
                    className="flex items-center gap-2 px-3 py-2"
                  >
                    {enEdition ? (
                      <>
                        <Input
                          value={renomme}
                          onChange={(event) => setRenomme(event.target.value)}
                          onKeyDown={(event) =>
                            surEntree(event, () =>
                              void enregistrerLeNom(group.id),
                            )
                          }
                          maxLength={GROUP_NAME_MAX}
                          disabled={pending}
                          aria-label={`Nouveau nom de ${group.name}`}
                          autoFocus
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          aria-label="Enregistrer le nom"
                          disabled={pending}
                          onClick={() => void enregistrerLeNom(group.id)}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          aria-label="Abandonner le renommage"
                          disabled={pending}
                          onClick={() => setRenommeId(null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{group.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {compteDEleves(group.student_count)}
                            {group.seance_count > 0 &&
                              ` · ${group.seance_count} séance${group.seance_count > 1 ? "s" : ""}`}
                            {group.evaluation_count > 0 &&
                              ` · ${group.evaluation_count} évaluation${group.evaluation_count > 1 ? "s" : ""}`}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          aria-label={`Renommer ${group.name}`}
                          disabled={pending}
                          onClick={() => {
                            setError(null);
                            setRenommeId(group.id);
                            setRenomme(group.name);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                          aria-label={`Supprimer ${group.name}`}
                          // Annoncé plutôt que tenté : un bouton qui échoue
                          // vaut moins qu'un bouton qui dit pourquoi.
                          title={blocage ?? "Supprimer ce groupe"}
                          disabled={pending || blocage !== null}
                          onClick={() => supprimer(group.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {sansGroupeNote && (
            <p className="text-xs text-muted-foreground">{sansGroupeNote}</p>
          )}

          {error && (
            <p className="flex items-start gap-2 whitespace-pre-line rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
