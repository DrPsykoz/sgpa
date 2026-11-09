import type { ReactElement } from "react";

import { cn } from "@/lib/utils";

/**
 * La catégorie d'un rendez-vous, en pastille (palier 020).
 *
 * Un composant partagé et non trois bouts de JSX : la pastille s'affiche sur
 * la grille de la semaine, sur les journées de l'accueil et dans le compte
 * rendu lui-même, et trois implémentations divergeraient au premier
 * ajustement — c'est la raison qui fait déjà partager `journee.ts` et
 * `geometry.ts` entre les deux calendriers.
 *
 * **Pleine et non pâle, à l'inverse de tout le reste de la carte** : la carte
 * d'un rendez-vous est déjà en teinte d'agenda, donc une pastille de la même
 * famille claire s'y serait fondue. C'est le seul endroit de l'application où
 * un fond soutenu sert à faire ressortir deux mots — « alerte à la bombe » doit
 * se lire avant l'intitulé qui la porte, sinon elle n'apporte rien que
 * l'intitulé ne disait déjà.
 *
 * Elle rend `null` sur une catégorie vide : `""` est la valeur de toutes les
 * entrées saisies avant le palier 020 et celle de toutes les suivantes qui s'en
 * passent, donc l'appelant n'a pas à tester avant d'appeler.
 */
export function PastilleDeCategorie({
  category,
  className,
}: {
  category: string;
  className?: string;
}): ReactElement | null {
  if (!category) return null;
  return (
    <span
      className={cn(
        // `max-w-full` + `truncate` : dans une case de calendrier large de
        // 7 rem, trente caractères ne tiennent pas, et une pastille qui
        // débordait peindrait par-dessus le jour suivant.
        "inline-block max-w-full truncate rounded-sm bg-agenda-encre px-1 py-px text-[10px] font-medium leading-snug text-agenda-fond",
        className,
      )}
    >
      {category}
    </span>
  );
}
