import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { api } from "@/lib/api";
import type { NeedTag, StudentNeeds } from "@/types";

/**
 * Les besoins particuliers de la classe ouverte, chargés une fois.
 *
 * Un contexte et non des props, pour la même raison que `useDrafts` : cette
 * information traverse quatre écrans sans rapport entre eux — la liste des
 * élèves, la feuille d'appel, la grille de notation, les bilans — dont deux
 * sont à deux niveaux de profondeur. La faire descendre en props imposerait à
 * `EvaluationsTab` et `SeancesTab` de transporter deux valeurs qu'elles
 * n'utilisent pas. Ce n'est pas un état global : le fournisseur est monté par
 * l'écran d'une classe et meurt avec lui.
 *
 * **Les étiquettes et les besoins sont lus séparément, et c'est voulu.** Le
 * vocabulaire est global à l'application, les besoins appartiennent à une
 * classe ; `StudentNeeds` ne porte que des identifiants. Une étiquette renommée
 * a donc exactement une source, et la renommer rafraîchit les quatre écrans
 * sans toucher une ligne de `student_needs`.
 *
 * **Rien de ceci ne s'imprime.** Voir `BESOINS_JAMAIS_IMPRIMES` dans
 * `src/types/index.ts` et l'en-tête de `db/sql/013_besoins_particuliers.sql`.
 */
export interface NeedsContextValue {
  /** Le vocabulaire de l'enseignant, dans son ordre d'affichage. */
  tags: NeedTag[];
  /** Les besoins par identifiant d'élève. **Absent = rien à signaler.** */
  parEleve: Map<string, StudentNeeds>;
  /** Vrai au tout premier chargement seulement : un rechargement est silencieux. */
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const NeedsContext = createContext<NeedsContextValue | null>(null);

function messageOf(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Une erreur inattendue est survenue.";
}

export function NeedsProvider({
  sessionId,
  children,
}: {
  sessionId: string;
  children: ReactNode;
}): ReactElement {
  const [tags, setTags] = useState<NeedTag[]>([]);
  const [needs, setNeeds] = useState<StudentNeeds[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [nextTags, nextNeeds] = await Promise.all([
        api.getNeedTags(),
        api.getSessionNeeds(sessionId),
      ]);
      setTags(nextTags);
      setNeeds(nextNeeds);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      // Après le premier passage, les rechargements n'affichent plus de
      // chargement : un `loading` à vrai pendant qu'on coche une étiquette
      // ferait clignoter les pastilles de toute la classe.
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const parEleve = useMemo(() => {
    const index = new Map<string, StudentNeeds>();
    for (const entry of needs) index.set(entry.student_id, entry);
    return index;
  }, [needs]);

  const value = useMemo(
    () => ({ tags, parEleve, loading, error, reload }),
    [tags, parEleve, loading, error, reload],
  );

  return (
    <NeedsContext.Provider value={value}>{children}</NeedsContext.Provider>
  );
}

export function useNeeds(): NeedsContextValue {
  const ctx = useContext(NeedsContext);
  if (!ctx) {
    throw new Error(
      "useNeeds doit être utilisé à l'intérieur de <NeedsProvider>.",
    );
  }
  return ctx;
}

/**
 * La ligne d'erreur, à poser dans les écrans qui ne font qu'afficher les
 * pastilles.
 *
 * Un échec de chargement ne doit **rien** bloquer : on note une évaluation, on
 * fait l'appel, et les besoins particuliers sont une aide à la lecture, pas une
 * donnée dont dépend la saisie. Mais il ne doit pas non plus être avalé — sans
 * cette ligne, un élève accompagné d'une AESH s'afficherait exactement comme un
 * élève sans aménagement, et personne ne saurait que l'information manque.
 */
export function NeedsLoadError(): ReactElement | null {
  const { error } = useNeeds();
  if (!error) return null;
  return (
    <p className="text-xs text-destructive">
      Les besoins particuliers des élèves n'ont pas pu être chargés ({error}).
      Les pastilles sont donc absentes de cet écran.
    </p>
  );
}
