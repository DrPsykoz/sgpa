import { useMemo, useState, type ReactElement } from "react";
import { Check, Plus } from "lucide-react";

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
import { useDraftGuard } from "@/hooks/useDrafts";
import { useNeeds } from "@/hooks/useNeeds";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Student } from "@/types";

export interface StudentNeedsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * L'élève, dérivé de la liste par le parent — jamais une copie figée gardée
   * au moment du clic (règle 1).
   *
   * **Le parent doit poser `key={student.id}`** : ce dialogue détient un
   * brouillon (la note libre), et sans la clé, passer d'un élève à l'autre
   * réutiliserait l'instance React et enregistrerait la note du premier sous
   * l'identifiant du second (règle 2).
   */
  student: Student;
}

function messageOf(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Une erreur inattendue est survenue.";
}

/**
 * Les besoins particuliers d'un élève : ses étiquettes et sa note libre.
 *
 * **Tout se valide d'un coup.** Cocher une étiquette n'écrit rien tant que
 * « Enregistrer » n'est pas cliqué, exactement comme les champs d'identité de
 * l'élève à côté. Un enregistrement à chaque clic aurait paru plus vif et
 * aurait rendu « Annuler » menteur : la moitié du dialogue serait déjà partie
 * en base.
 *
 * **Deux écritures, deux commandes** (règle 3) : `set_student_needs` touche la
 * table de liaison, `update_student_needs_note` touche une colonne de
 * `students`. Seule celle qui a changé est appelée.
 *
 * La création d'une étiquette, elle, est immédiate — et c'est un autre geste :
 * elle crée du vocabulaire pour **toute** l'application, pas un lien avec cet
 * élève. On la coche dans la foulée, parce qu'on ne crée pas une étiquette pour
 * la regarder.
 */
export function StudentNeedsDialog({
  open,
  onOpenChange,
  student,
}: StudentNeedsDialogProps): ReactElement {
  const { tags, parEleve, reload } = useNeeds();

  const initial = parEleve.get(student.id);
  const initialTagIds = useMemo(
    () => initial?.tag_ids ?? [],
    [initial?.tag_ids],
  );
  const initialNote = initial?.note ?? "";

  // L'état initial est lu une fois : le dialogue est monté sous
  // `key={student.id}`, donc une nouvelle instance naît à chaque élève.
  const [coches, setCoches] = useState<Set<string>>(
    () => new Set(initialTagIds),
  );
  const [note, setNote] = useState(initialNote);

  const [nouvelle, setNouvelle] = useState("");
  const [abrege, setAbrege] = useState("");
  const [creating, setCreating] = useState(false);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tagsDirty = useMemo(() => {
    if (coches.size !== initialTagIds.length) return true;
    return initialTagIds.some((id) => !coches.has(id));
  }, [coches, initialTagIds]);
  const noteDirty = note !== initialNote;
  const dirty = tagsDirty || noteDirty;

  const nomComplet = `${student.last_name} ${student.first_name}`.trim();

  /**
   * Écrit ce qui a changé, et **rien de plus** — pas de rechargement.
   *
   * Extrait de `handleSubmit` pour que le registre des brouillons puisse
   * l'appeler aussi : un verrouillage automatique démonte l'arbre, et la note
   * tapée il y a dix secondes partirait avec lui. C'est aussi pourquoi le
   * rechargement reste dehors : il relit la base juste avant que la connexion
   * ne se ferme, et son échec ferait passer une écriture réussie pour une
   * saisie perdue.
   */
  const ecrire = async () => {
    // L'ordre compte peu, mais les étiquettes d'abord : c'est ce qu'on voit à
    // l'écran, donc ce dont l'absence se remarquerait si la seconde échouait.
    if (tagsDirty) {
      // Dans l'ordre du vocabulaire plutôt que dans l'ordre des clics : le
      // backend retrie à la lecture, autant que ce qui part soit déjà lisible.
      const ordonnes = tags
        .filter((tag) => coches.has(tag.id))
        .map((tag) => tag.id);
      await api.setStudentNeeds(student.id, ordonnes);
    }
    if (noteDirty) {
      await api.updateStudentNeedsNote(student.id, note);
    }
  };

  useDraftGuard(`besoins-eleve:${student.id}`, dirty, {
    label: `Besoins particuliers — ${nomComplet}`,
    flush: ecrire,
  });

  const handleSubmit = async () => {
    setPending(true);
    setError(null);
    try {
      await ecrire();
      await reload();
      onOpenChange(false);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPending(false);
    }
  };

  const handleCreate = async () => {
    const label = nouvelle.trim();
    if (label === "") return;
    setCreating(true);
    setError(null);
    try {
      // La commande est idempotente sur le libellé, casse ignorée : retaper une
      // étiquette existante la retrouve au lieu d'échouer, et on la coche.
      const tag = await api.createNeedTag(label, abrege.trim());
      await reload();
      setCoches((avant) => new Set(avant).add(tag.id));
      setNouvelle("");
      setAbrege("");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setCreating(false);
    }
  };

  const toggle = (id: string) => {
    setCoches((avant) => {
      const apres = new Set(avant);
      if (apres.has(id)) apres.delete(id);
      else apres.add(id);
      return apres;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Besoins particuliers — {nomComplet}</DialogTitle>
          <DialogDescription>
            Ces informations s'affichent sur vos écrans : appel, grille de
            notation, liste de la classe, bilans. Elles ne figurent sur{" "}
            <span className="font-medium text-foreground">
              aucun document imprimé
            </span>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Étiquettes</Label>
            {tags.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucune étiquette pour l'instant. Créez la première ci-dessous :
                SGPA n'en propose aucune d'avance, parce que les libellés
                exacts sont ceux des PAP et des notifications de votre
                établissement. Elles resserviront ensuite pour tous vos élèves.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => {
                  const actif = coches.has(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      aria-pressed={actif}
                      onClick={() => toggle(tag.id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        actif
                          ? "border-foreground/20 bg-foreground/10 font-medium text-foreground"
                          : "border-border bg-card text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {actif && <Check className="h-3.5 w-3.5" />}
                      {tag.label}
                      {tag.short_label && (
                        <span className="text-xs text-muted-foreground">
                          ({tag.short_label})
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-md border border-dashed p-3">
            <Label htmlFor="besoin-nouvelle">Créer une étiquette</Label>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-40 flex-1 space-y-1">
                <Input
                  id="besoin-nouvelle"
                  value={nouvelle}
                  onChange={(event) => setNouvelle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleCreate();
                    }
                  }}
                  placeholder="Dysorthographie"
                />
                <p className="text-xs text-muted-foreground">Libellé complet</p>
              </div>
              <div className="w-28 space-y-1">
                <Input
                  value={abrege}
                  onChange={(event) => setAbrege(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleCreate();
                    }
                  }}
                  placeholder="Dys-o"
                  aria-label="Abréviation de l'étiquette"
                />
                <p className="text-xs text-muted-foreground">
                  Abrégé (facultatif)
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleCreate()}
                disabled={creating || nouvelle.trim() === ""}
              >
                <Plus className="h-4 w-4" />
                {creating ? "Création…" : "Créer"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              L'abrégé est ce qui s'affiche dans une grille de notation, où la
              place manque. Le libellé complet reste visible au survol.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="besoin-note">Note</Label>
            <Textarea
              id="besoin-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              placeholder="Tiers temps sur les évaluations écrites. Lit mieux en Arial 14."
            />
            <p className="text-xs text-muted-foreground">
              Pour ce qui ne se range pas dans une étiquette. S'affiche au
              survol du{" "}
              <span aria-hidden="true">ⓘ</span> à côté du nom de l'élève.
            </p>
          </div>

          {error && (
            <p className="whitespace-pre-line rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Annuler
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={pending || !dirty}
          >
            {pending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
