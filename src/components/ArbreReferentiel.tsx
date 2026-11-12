import { useRef, useState } from "react";
import type { ElementType, ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type { BulkResult } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dedupeNames, normalizeNames, plural } from "@/lib/referentiel";
import { cn } from "@/lib/utils";

/**
 * Les deux briques d'un écran de référentiel : la ligne qui se renomme, se
 * déplace et se supprime, et le champ où l'on colle une liste.
 *
 * **Partagées parce qu'il y a deux référentiels depuis le palier 024**, et que
 * l'enseignant les remplit du même geste : celui des compétences (cycle →
 * domaine → champ → compétence) et celui des activités professionnelles
 * (champ → domaine d'activité → activités de référence et métiers). Les écrire
 * deux fois aurait donné deux collages qui ne gèrent pas les mêmes blancs, et
 * deux réordonnancements qui ne comptent pas les lignes cachées pareil.
 *
 * Elles ne connaissent **aucun niveau** : ni `NodeKind`, ni `Ra16Kind`. Un
 * appelant passe l'icône, la graisse et le filet du niveau (`StyleDeNiveau`)
 * et la fonction d'écriture ; c'est ce qui permet au même composant de servir
 * un arbre à quatre étages et une paire de listes sœurs.
 */

/** La peau d'un niveau : ce qui change d'un étage à l'autre et que ces
 *  composants ne peuvent pas deviner. Aucune couleur écrite ici — l'appelant
 *  n'y met que des jetons (`border-l-border`, `text-primary`…). */
export interface StyleDeNiveau {
  icon: ElementType;
  /** Couleur du filet d'indentation, posé seulement quand `depth > 0`. C'est
   *  le guide de lecture de l'arbre, pas un ornement de carte : la règle « pas
   *  de barre d'accent » vise les cartes de calendrier et les listes, qui
   *  peuvent dire leur état elles-mêmes. */
  accent: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Champ d'ajout — le cœur de la saisie d'un référentiel
// ---------------------------------------------------------------------------

interface ChampDAjoutProps {
  /** Ce que le bouton annonce : « Ajouter une compétence », « Ajouter un
   *  métier ». Il nomme l'**action**, pas l'état. */
  libelle: string;
  /** Écrit la fratrie et rend ce qui a été créé et ce qui a été ignoré. Le
   *  parent est déjà capturé par la fermeture : ce composant n'a pas à savoir
   *  sous quoi il écrit. */
  onAjouter: (noms: string[]) => Promise<BulkResult>;
  className?: string;
}

export function ChampDAjout({
  libelle,
  onAjouter,
  className,
}: ChampDAjoutProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(0);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (rawNames: string[]) => {
    if (busy) return;
    const names = normalizeNames(rawNames);
    if (names.length === 0) return;
    const { unique, duplicates } = dedupeNames(names);
    setBusy(true);
    setError(null);
    try {
      const result = await onAjouter(unique);
      setAdded((n) => n + result.created.length);
      setSkipped([...duplicates, ...result.skipped]);
      setValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      // Le champ reste ouvert ET focalisé : le refermer après chaque ajout
      // rendait la saisie d'une centaine de nœuds intenable.
      inputRef.current?.focus();
    }
  };

  const close = () => {
    setOpen(false);
    setValue("");
    setAdded(0);
    setSkipped([]);
    setError(null);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex cursor-pointer items-center gap-1 py-1 text-xs font-medium text-primary hover:underline",
          className,
        )}
      >
        <Plus className="h-3 w-3" />
        {libelle}
      </button>
    );
  }

  return (
    <div className={cn("py-1", className)}>
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          autoFocus
          value={value}
          placeholder={`${libelle} — ou collez une liste`}
          className="h-7 max-w-[380px] text-sm"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit([value]);
            }
            if (e.key === "Escape") close();
          }}
          onPaste={(e) => {
            // Même dans un <input>, l'événement `paste` expose le texte AVEC
            // ses sauts de ligne : inutile de passer à un <textarea>.
            const text = e.clipboardData.getData("text");
            if (!text.includes("\n")) return; // un seul nom : collage natif
            e.preventDefault();
            void submit(text.split(/\r?\n/));
          }}
        />
        <Button
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={busy || value.trim().length === 0}
          onClick={() => void submit([value])}
        >
          {busy ? "Ajout…" : "Ajouter"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={close}
        >
          Fermer
        </Button>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {added > 0 && (
          <span className="font-medium text-emerald-700">
            {plural(added, "ajouté", "ajoutés")}
          </span>
        )}
        {skipped.length > 0 && (
          <span className="text-amber-700">
            {plural(skipped.length, "doublon ignoré", "doublons ignorés")} :{" "}
            {skipped.slice(0, 5).join(", ")}
            {skipped.length > 5 ? "…" : ""}
          </span>
        )}
        {error && <span className="text-destructive">{error}</span>}
        {added === 0 && skipped.length === 0 && !error && (
          <span className="text-muted-foreground">
            Collez une liste (une ligne par élément) pour tout créer d'un coup.
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ligne générique de l'arbre
// ---------------------------------------------------------------------------

interface LigneDArbreProps {
  style: StyleDeNiveau;
  name: string;
  depth: number;
  archived?: boolean;
  /** Ce que la ligne dit d'elle-même à droite de son nom : « 8 compétences »,
   *  « citée par 2 fiches ». Du texte, donc pas un bouton : l'action est dans
   *  la barre d'outils. */
  meta?: string;
  collapsible?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  /** Une action propre à ce niveau, posée à gauche de la barre d'outils
   *  et **toujours visible**, là où renommer, déplacer et supprimer ne
   *  paraissent qu'au survol.
   *
   *  La différence est voulue : les quatre gestes de la barre existent
   *  sur chaque ligne de chaque référentiel, donc les montrer en
   *  permanence ferait quatre icônes par ligne sur cent lignes. Une
   *  action passée ici est au contraire le geste principal de SON
   *  niveau — « les compétences que cet établissement n'emploie pas » —
   *  et un geste principal qu'il faut survoler pour découvrir est un
   *  geste que personne ne trouve. */
  actions?: ReactNode;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onToggleArchive?: () => void;
  children?: ReactNode;
}

export function LigneDArbre({
  style,
  name,
  depth,
  archived = false,
  meta,
  collapsible = false,
  expanded = true,
  onToggle,
  actions,
  canMoveUp,
  canMoveDown,
  onMove,
  onRename,
  onDelete,
  onToggleArchive,
  children,
}: LigneDArbreProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const Icon = style.icon;

  const startEdit = () => {
    setDraft(name);
    setEditing(true);
  };

  const commit = () => {
    const next = draft.trim();
    if (next && next !== name) onRename(next);
    setEditing(false);
  };

  return (
    <div className={cn(depth > 0 && "ml-3 border-l-2", style.accent)}>
      <div
        className={cn(
          "group flex items-center gap-2 rounded-r-md py-1.5 pr-2 transition-colors hover:bg-muted/50",
          depth > 0 ? "pl-3" : "pl-2",
        )}
      >
        {collapsible ? (
          <button
            type="button"
            onClick={onToggle}
            title={expanded ? "Replier" : "Déplier"}
            className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            archived ? "text-muted-foreground/60" : "text-muted-foreground",
          )}
        />

        {editing ? (
          <div className="flex flex-1 items-center gap-2">
            <Input
              value={draft}
              autoFocus
              className="h-7 max-w-[380px] text-sm"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                }
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <Button size="sm" className="h-7 px-2 text-xs" onClick={commit}>
              Renommer
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setEditing(false)}
            >
              Annuler
            </Button>
          </div>
        ) : (
          <>
            <span
              className={cn(
                "flex-1 truncate",
                style.text,
                archived && "text-muted-foreground line-through",
              )}
            >
              {name}
            </span>

            {archived && (
              <Badge
                variant="outline"
                className="shrink-0 text-[10px] font-normal text-muted-foreground"
              >
                archivée
              </Badge>
            )}

            {meta && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {meta}
              </span>
            )}

            {actions && (
              <div className="flex shrink-0 items-center gap-1">{actions}</div>
            )}

            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="Monter"
                disabled={!canMoveUp}
                onClick={() => onMove(-1)}
              >
                <ArrowUp className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="Descendre"
                disabled={!canMoveDown}
                onClick={() => onMove(1)}
              >
                <ArrowDown className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="Renommer"
                onClick={startEdit}
              >
                <Pencil className="h-3 w-3" />
              </Button>
              {onToggleArchive && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  title={archived ? "Désarchiver" : "Archiver"}
                  onClick={onToggleArchive}
                >
                  {archived ? (
                    <ArchiveRestore className="h-3 w-3" />
                  ) : (
                    <Archive className="h-3 w-3" />
                  )}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-destructive hover:text-destructive"
                title="Supprimer"
                onClick={onDelete}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </>
        )}
      </div>

      {expanded && children ? <div className="pb-1">{children}</div> : null}
    </div>
  );
}
