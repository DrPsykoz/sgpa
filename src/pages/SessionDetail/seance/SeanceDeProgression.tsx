import { useEffect, useState } from "react";
import { Route } from "lucide-react";

import { api } from "@/lib/api";
import {
  activitesParId,
  indexDesPlages,
  lundiDe,
  VOIES,
  cleDePlage,
} from "@/lib/progression";
import { styleTeinteActivite } from "@/lib/teintes";
import { MOTS_DE_NATURE } from "@/types";
import type { Progression, ProgressionActivite } from "@/types";

interface SeanceDeProgressionProps {
  sessionId: string;
  /** La date du cours, `AAAA-MM-JJ`. */
  date: string;
}

/**
 * Ce que la progression de la classe prévoit pour la semaine de ce cours : la
 * « séance » (unité de progression) posée sur la frise, avec son objectif et
 * sa séquence. **Lecture seule** — la progression s'écrit dans l'onglet
 * « Progression » de la fiche de classe, et nulle part ailleurs.
 *
 * Ne rend rien tant que la classe n'a pas de progression, ou que rien n'est
 * posé cette semaine-là : un cours sans séance prévue est le cas courant.
 * Une erreur de lecture ne bloque pas non plus l'appel — c'est une aide.
 */
export function SeanceDeProgression({
  sessionId,
  date,
}: SeanceDeProgressionProps) {
  const [progression, setProgression] = useState<Progression | null>(null);

  useEffect(() => {
    let annule = false;
    api
      .getProgression(sessionId)
      .then((p) => {
        if (!annule) setProgression(p);
      })
      .catch(() => {
        if (!annule) setProgression(null);
      });
    return () => {
      annule = true;
    };
  }, [sessionId]);

  if (!progression) return null;

  const lundi = lundiDe(date);
  const plages = indexDesPlages(progression);
  const parId = activitesParId(progression);
  const etapeDe = new Map<string, string>();
  for (const etape of progression.etapes) {
    for (const activite of etape.activites) etapeDe.set(activite.id, etape.libelle);
  }

  const prevues: ProgressionActivite[] = [];
  for (const voie of VOIES) {
    const id = plages.get(cleDePlage(lundi, voie));
    const activite = id ? parId.get(id) : undefined;
    if (activite && !prevues.some((a) => a.id === activite.id)) {
      prevues.push(activite);
    }
  }

  if (prevues.length === 0) return null;

  return (
    <div className="space-y-2">
      {prevues.map((activite) => {
        const sequence = etapeDe.get(activite.id);
        return (
          <div
            key={activite.id}
            style={styleTeinteActivite(activite.rang)}
            className="teinte-carte rounded-md border p-3 text-sm"
          >
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Route className="h-3.5 w-3.5" />
              Séance prévue cette semaine dans la progression
              {sequence ? ` · ${sequence}` : ""}
            </p>
            <p className="mt-1 font-medium">
              {MOTS_DE_NATURE[activite.nature as keyof typeof MOTS_DE_NATURE] ??
                ""}{" "}
              · {activite.libelle}
            </p>
            {activite.objectif && (
              <p className="text-muted-foreground">
                Objectif : {activite.objectif}
              </p>
            )}
            {activite.competences_ref.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {activite.competences_ref.length} compétence
                {activite.competences_ref.length > 1 ? "s" : ""} évaluée
                {activite.competences_ref.length > 1 ? "s" : ""}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
