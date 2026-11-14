import type { ReactElement } from "react";

import { EtablissementsCard } from "@/components/EtablissementsCard";

/**
 * La page « Établissements » — elle était une carte de Réglages jusqu'au
 * palier 028. Un établissement porte maintenant de quoi occuper un écran : ses
 * classes, son académie (donc le calendrier des vacances), les compétences
 * qu'on n'y emploie pas.
 *
 * La carte reste le seul composant qui charge et écrit : cette page n'est que
 * son cadre, comme `Cycles` l'est de ses deux onglets.
 */
export default function Etablissements(): ReactElement {
  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Établissements</h1>
        <p className="mt-1 text-muted-foreground">
          Vos établissements, leur académie et les compétences qu'on n'y
          emploie pas.
        </p>
      </div>
      <EtablissementsCard />
    </div>
  );
}
