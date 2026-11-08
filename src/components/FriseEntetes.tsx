import type { ReactElement } from "react";

import { cn } from "@/lib/utils";
import {
  MOTS_DE_SEMAINE,
  etatDeLaSemaine,
  motifDeLaSemaine,
  nomDuMois,
  tranchesParMois,
  tranchesParTrimestre,
} from "@/lib/progression";
import type { YearWeek } from "@/types";

/**
 * Les colonnes et les trois en-têtes d'une frise annuelle.
 *
 * **Partagés par les deux frises** : celle de la fiche de classe, qui se peint,
 * et la vue « Année » de l'emploi du temps, qui ne fait que montrer. Deux
 * implémentations divergeraient au premier détail — un mois groupé autrement,
 * une semaine de vacances pâlie d'un côté et pas de l'autre —, et la vue
 * annoncerait une semaine que la frise ne montre pas. C'est la même raison qui
 * fait partager `journee.ts` et `geometry.ts` entre `WeekGrid` et
 * `DaysCalendar`.
 *
 * Le découpage en mois et en trimestres vient de `lib/progression.ts`, qui le
 * tient du **jeudi** de chaque semaine, décidé en Rust : une partition, donc des
 * groupes qui couvrent exactement les semaines, sans trou ni recouvrement.
 */

/** Largeur d'une colonne de semaine, en pixels.
 *
 *  Elle est fixe et connue du code parce que l'intitulé d'une activité posée sur
 *  plusieurs semaines est écrit **une seule fois**, dans la première case, et
 *  débordé sur les suivantes : sa largeur se calcule donc en multipliant celle
 *  d'une colonne. Un `colSpan` aurait donné le même dessin mais une seule cible
 *  de clic pour huit semaines. */
export const LARGEUR_SEMAINE = 30;

/** Affichage français d'une date stockée en AAAA-MM-JJ. */
export function formatDateDeFrise(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR");
}

/** L'infobulle d'une colonne : son numéro, son lundi, son état, son motif. */
export function infobulleDeSemaine(week: YearWeek): string {
  const motif = motifDeLaSemaine(week);
  const etat = MOTS_DE_SEMAINE[etatDeLaSemaine(week)];
  return (
    `Semaine ${week.iso_week} — lundi ${formatDateDeFrise(week.monday)}\n` +
    `${etat}${motif === "" ? "" : ` — ${motif}`}`
  );
}

export interface ColonnesDeFriseProps {
  weeks: readonly YearWeek[];
  /** Largeur de la colonne des en-têtes de ligne, à gauche. Elle diffère d'une
   *  frise à l'autre : « Bande parallèle » et un nom de classe ne tiennent pas
   *  dans la même place. */
  largeurLegende: number;
}

export function ColonnesDeFrise({
  weeks,
  largeurLegende,
}: ColonnesDeFriseProps): ReactElement {
  return (
    <colgroup>
      <col style={{ width: largeurLegende }} />
      {weeks.map((week) => (
        <col key={week.monday} style={{ width: LARGEUR_SEMAINE }} />
      ))}
    </colgroup>
  );
}

export interface EntetesDeFriseProps {
  weeks: readonly YearWeek[];
}

export function EntetesDeFrise({ weeks }: EntetesDeFriseProps): ReactElement {
  const mois = tranchesParMois(weeks);
  const trimestres = tranchesParTrimestre(weeks);

  return (
    <thead>
      <tr>
        <th className="border-b border-r px-2 py-1 text-left font-medium text-muted-foreground">
          Trimestre
        </th>
        {trimestres.map((tranche) => (
          <th
            key={`t${tranche.debut}`}
            colSpan={tranche.taille}
            className="border-b border-r px-1 py-1 font-medium"
          >
            T{tranche.cle}
          </th>
        ))}
      </tr>
      <tr>
        <th className="border-b border-r px-2 py-1 text-left font-medium text-muted-foreground">
          Mois
        </th>
        {mois.map((tranche) => (
          <th
            key={`m${tranche.debut}`}
            colSpan={tranche.taille}
            className="border-b border-r px-1 py-1 font-medium"
          >
            {nomDuMois(tranche.cle)}
          </th>
        ))}
      </tr>
      <tr>
        <th className="border-b border-r px-2 py-1 text-left font-medium text-muted-foreground">
          Semaine
        </th>
        {weeks.map((week) => {
          const etat = etatDeLaSemaine(week);
          return (
            <th
              key={week.monday}
              title={infobulleDeSemaine(week)}
              className={cn(
                "border-b border-r py-1 text-center font-normal",
                // Une semaine sans cours est pâle, une semaine écourtée est
                // soulignée en pointillé : deux signes pour deux états, et le
                // motif est dans l'infobulle. Les colonnes font trente pixels —
                // il n'y a pas la place d'un mot de plus.
                etat === "fermee" && "bg-muted text-muted-foreground",
                etat === "ecourtee" && "underline decoration-dotted",
              )}
            >
              {week.iso_week}
            </th>
          );
        })}
      </tr>
    </thead>
  );
}
