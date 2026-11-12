import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { StudentGroup } from "@/types";

export interface GroupesDeClasse {
  /** Vide tant que rien n'est chargé, et vide aussi quand la classe n'a aucun
   *  groupe : les deux cas se peignent pareil, un sélecteur qui ne s'affiche
   *  pas. */
  groupes: StudentGroup[];
  /** Non nul = la lecture a échoué. À afficher, jamais à avaler : sans ce
   *  message, un sélecteur manquant se lirait « cette classe n'a pas de
   *  groupe », et l'enseignant en recréerait un qui existe déjà. */
  erreur: string | null;
}

/**
 * Les groupes d'**une** classe, chargés à la demande.
 *
 * **Pourquoi un crochet et non une prop**, à l'inverse de la fiche de classe :
 * l'emploi du temps n'a pas de classe courante. Il montre la semaine de toutes
 * les classes à la fois, et c'est le dialogue ouvert qui désigne celle dont les
 * groupes comptent — elle change d'une ouverture à l'autre, et même pendant,
 * puisque le sélecteur de classe est dans le dialogue. Charger les groupes de
 * toutes les classes au montage de l'écran aurait fait une lecture par classe
 * pour une liste que l'enseignant n'ouvre pas une fois sur dix.
 *
 * Dans la fiche de classe, c'est l'inverse : la classe est fixe, plusieurs
 * onglets ont besoin de la même liste, et c'est le parent qui la détient
 * (règle 1). Les deux formes coexistent pour cette raison, pas par hésitation.
 *
 * `null` rend une liste vide sans aucune lecture — c'est le cas « aucune
 * classe » du créneau de coordination.
 */
export function useGroupesDeClasse(sessionId: string | null): GroupesDeClasse {
  const [groupes, setGroupes] = useState<StudentGroup[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (sessionId === null) {
      setGroupes([]);
      setErreur(null);
      return;
    }
    // Le jeton d'annulation : deux changements de classe rapprochés rendent
    // leurs réponses dans l'ordre qu'elles veulent, et sans lui la première
    // arrivée en dernier écraserait la bonne.
    let vivant = true;
    api
      .getStudentGroups(sessionId)
      .then((lus) => {
        if (!vivant) return;
        setGroupes(lus);
        setErreur(null);
      })
      .catch((err: unknown) => {
        if (!vivant) return;
        setGroupes([]);
        setErreur(
          err instanceof Error
            ? err.message
            : "Les groupes de cette classe n'ont pas pu être lus.",
        );
      });
    return () => {
      vivant = false;
    };
  }, [sessionId]);

  return { groupes, erreur };
}
