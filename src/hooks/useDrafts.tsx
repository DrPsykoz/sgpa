import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";

/**
 * Registre des saisies non enregistrées.
 *
 * Verrouiller démonte tout l'arbre React — c'est voulu, l'état contenant noms
 * d'élèves et notes doit réellement disparaître, pas être masqué par un calque.
 * Sans ce registre, un verrouillage automatique emporterait le cahier de texte
 * en cours de frappe. Chaque composant qui détient un brouillon s'annonce ici,
 * et l'application fait tout enregistrer AVANT de verrouiller.
 */

export interface DraftHandle {
  /** Libellé affichable, pour un message d'erreur utile : « Cahier de texte — Séance du 14/09 ». */
  label: string;
  /** Doit enregistrer et résoudre. Rejette si l'enregistrement échoue. */
  flush: () => Promise<void>;
}

export interface DraftsContextValue {
  /** À appeler quand le brouillon devient sale ; renvoie une fonction de désinscription. */
  register: (id: string, handle: DraftHandle) => () => void;
  /** Enregistre tous les brouillons en attente. Renvoie les libellés de ceux qui ont échoué. */
  flushAll: () => Promise<string[]>;
  hasDrafts: () => boolean;
}

const DraftsContext = createContext<DraftsContextValue | null>(null);

export function DraftsProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  // Une `ref` et non un `useState` : un brouillon devient sale à chaque frappe,
  // et un état provoquerait un rendu de tout l'arbre authentifié à chaque
  // caractère tapé dans le cahier de texte.
  const handles = useRef(new Map<string, DraftHandle>());

  const register = useCallback((id: string, handle: DraftHandle) => {
    handles.current.set(id, handle);
    return () => {
      // Ne retirer que sa propre entrée : en mode strict (et au remontage d'un
      // composant sous le même identifiant), le nettoyage de l'ancien effet
      // passe APRÈS la réinscription du nouveau et effacerait un brouillon vif.
      if (handles.current.get(id) === handle) handles.current.delete(id);
    };
  }, []);

  const flushAll = useCallback(async (): Promise<string[]> => {
    const failed: string[] = [];
    // Séquentiel : le backend n'a qu'une `Connection` sous `Mutex`, et l'ordre
    // rend la liste des échecs reproductible.
    for (const handle of [...handles.current.values()]) {
      try {
        await handle.flush();
      } catch {
        // Le message d'origine est déjà affiché par le composant lui-même ;
        // ici on ne retient que de quoi nommer ce qui n'est pas parti.
        failed.push(handle.label);
      }
    }
    // Le registre n'est volontairement pas purgé : c'est le composant qui sait
    // s'il est encore sale (l'utilisateur a pu taper pendant l'enregistrement),
    // et sa désinscription passe par `useDraftGuard`.
    return failed;
  }, []);

  const hasDrafts = useCallback(() => handles.current.size > 0, []);

  const value = useMemo(
    () => ({ register, flushAll, hasDrafts }),
    [register, flushAll, hasDrafts],
  );

  return (
    <DraftsContext.Provider value={value}>{children}</DraftsContext.Provider>
  );
}

export function useDrafts(): DraftsContextValue {
  const ctx = useContext(DraftsContext);
  if (!ctx) {
    throw new Error(
      "useDrafts doit être utilisé à l'intérieur de <DraftsProvider>.",
    );
  }
  return ctx;
}

/** Inscrit le brouillon tant que `dirty` est vrai. Se désinscrit tout seul. */
export function useDraftGuard(
  id: string,
  dirty: boolean,
  handle: DraftHandle,
): void {
  const { register } = useDrafts();

  // `handle.flush` est une closure recréée à chaque rendu, sur l'état courant.
  // La garder dans une `ref` mise à jour à chaque rendu permet de n'avoir que
  // `id` et `dirty` en dépendances de l'effet : sans cela, chaque frappe
  // désinscrirait puis réinscrirait le brouillon en boucle.
  const handleRef = useRef(handle);
  handleRef.current = handle;

  useEffect(() => {
    if (!dirty) return;
    // Enveloppe stable qui délègue à la ref : le registre appelle toujours la
    // dernière closure, celle qui voit le texte réellement tapé.
    return register(id, {
      get label() {
        return handleRef.current.label;
      },
      flush: () => handleRef.current.flush(),
    });
  }, [id, dirty, register]);
}
