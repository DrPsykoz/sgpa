import type { ReactElement } from "react";
import { Info } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { NeedTag, StudentNeeds } from "@/types";

export interface NeedsChipsProps {
  /** Le vocabulaire complet, pour résoudre les identifiants en libellés. */
  tags: NeedTag[];
  /** Les besoins de cet élève, ou `null` s'il n'a rien à signaler. */
  needs: StudentNeeds | null | undefined;
  /** Pastilles abrégées, pour une cellule de tableau ou une grille de notation.
   *  Le libellé complet reste accessible en infobulle. */
  compact?: boolean;
  className?: string;
}

/**
 * Les besoins particuliers d'un élève, en pastilles.
 *
 * **Affichage seul, et sur écran seulement.** Ce composant n'est importé par
 * aucun chemin d'impression : les PDF sont produits par `src/lib/pdf.ts`, qui
 * ne connaît ni `NeedTag` ni `StudentNeeds`. Décision explicite de l'auteur —
 * données de santé concernant des mineurs. Voir `BESOINS_JAMAIS_IMPRIMES`.
 *
 * Les pastilles ne sont pas colorées, et c'est voulu : une couleur par type de
 * trouble demanderait une échelle de gravité que personne n'a définie, et la
 * teinte est déjà prise — c'est celle de la classe (`teintes.ts`). Un jeu de
 * couleurs de plus sur le même écran ne se lirait plus comme une information.
 */
export function NeedsChips({
  tags,
  needs,
  compact = false,
  className,
}: NeedsChipsProps): ReactElement | null {
  if (!needs) return null;

  // Les identifiants arrivent déjà dans l'ordre du vocabulaire (le backend trie
  // sur `position`), donc deux élèves aux mêmes besoins affichent leurs
  // pastilles dans le même ordre et la colonne se lit de haut en bas.
  const portees = needs.tag_ids
    .map((id) => tags.find((tag) => tag.id === id))
    .filter((tag): tag is NeedTag => tag !== undefined);

  if (portees.length === 0 && !needs.note) return null;

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {portees.map((tag) => {
        const court = compact && tag.short_label ? tag.short_label : tag.label;
        const chip = (
          <span
            className={cn(
              "inline-flex items-center rounded border border-border bg-muted px-1.5 font-medium text-muted-foreground",
              compact ? "text-[0.6875rem] leading-5" : "text-xs leading-5",
            )}
          >
            {court}
          </span>
        );
        // L'infobulle n'existe que si elle apporte quelque chose : poser un
        // `title` identique au texte affiché fabrique un délai au survol pour
        // relire ce qu'on lit déjà.
        return court === tag.label ? (
          <span key={tag.id}>{chip}</span>
        ) : (
          <Tooltip key={tag.id}>
            <TooltipTrigger asChild>{chip}</TooltipTrigger>
            <TooltipContent>{tag.label}</TooltipContent>
          </Tooltip>
        );
      })}

      {needs.note && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center text-muted-foreground">
              <Info className="h-3.5 w-3.5" />
              <span className="sr-only">Note sur cet élève</span>
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs whitespace-pre-line">
            {needs.note}
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}
