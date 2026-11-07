import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import type { LockStatus } from "@/types";

export interface LockContextValue {
  status: LockStatus | null;
  loading: boolean;
  /** Échec de `get_lock_status`. Sans ce champ, une base illisible au démarrage
   *  donnerait un écran blanc muet au lieu d'un message. */
  error: string | null;
  refresh: () => Promise<void>;
  /** Remplace l'état du verrou par celui qu'une commande vient de renvoyer,
   *  **sans toucher `loading`**.
   *
   *  C'est toute la différence avec `refresh()`, qui le passe à vrai : l'écran
   *  appelant est alors démonté le temps de l'aller-retour, et il repart avec
   *  son message de confirmation et sa saisie en cours. Les réglages activent
   *  et retirent le code PIN sans quitter la page. */
  applyStatus: (next: LockStatus) => void;
  unlock: (password: string) => Promise<void>;
  /** Déverrouille par le code PIN de ce poste.
   *
   *  En cas d'échec, l'état du verrou est relu AVANT que l'erreur ne remonte :
   *  le dixième essai manqué désactive le PIN, et le champ doit disparaître de
   *  lui-même. Cette relecture ne touche pas `loading` — le passer à vrai
   *  démonterait l'écran de déverrouillage, donc le message d'erreur avec lui. */
  unlockWithPin: (pin: string) => Promise<void>;
  /** Crée le verrou et renvoie la phrase de récupération.
   *
   *  Elle NE met volontairement PAS le statut à jour : passer à « déverrouillé »
   *  ferait basculer l'application sur l'arbre authentifié et emporterait
   *  l'écran qui affiche la phrase — le seul où elle apparaîtra jamais. C'est
   *  `refresh()`, appelé après l'accusé de réception, qui ouvre l'application. */
  setup: (password: string, name: string, hint: string) => Promise<string>;
  /** Phrase de récupération + nouveau mot de passe. Ouvre la session dans la
   *  foulée : l'enseignant a prouvé qu'il peut déballer la clé maître. */
  recover: (phrase: string, newPassword: string) => Promise<void>;
  lock: () => Promise<void>;
  /** Libellés des brouillons qui n'ont pas pu être enregistrés au dernier
   *  verrouillage. Ils vivent ICI et non dans l'arbre authentifié : celui-ci
   *  est démonté par le verrouillage, le message doit lui survivre pour être
   *  affiché après le déverrouillage. Un échec silencieux serait pire que
   *  l'échec lui-même. */
  unsavedOnLock: string[];
  /** Remplace la liste. Appelée avec `[]`, elle efface un message obsolète. */
  reportUnsavedOnLock: (labels: string[]) => void;
  clearUnsavedOnLock: () => void;
}

const LockContext = createContext<LockContextValue | null>(null);

export function LockProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LockStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unsavedOnLock, setUnsavedOnLock] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await api.getLockStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const applyStatus = useCallback((next: LockStatus) => setStatus(next), []);

  // Ces écritures laissent volontairement remonter l'ApiError : c'est l'écran
  // appelant qui sait où afficher « Mot de passe incorrect », pas le contexte,
  // qui n'a aucun endroit sensé où le rendre.
  const unlock = useCallback(async (password: string) => {
    setStatus(await api.unlock(password));
  }, []);

  const unlockWithPin = useCallback(async (pin: string) => {
    try {
      setStatus(await api.unlockWithPin(pin));
    } catch (err) {
      // L'échec peut avoir désactivé le PIN de ce poste : on relit l'état pour
      // que le champ disparaisse, puis on laisse l'erreur remonter à l'écran
      // qui saura où l'afficher. Un `catch` vide ici serait exactement le
      // « catch qui ne fait que console.error » que le projet s'interdit — sauf
      // que celui-ci ne mange rien : l'erreur d'origine repart.
      try {
        setStatus(await api.getLockStatus());
      } catch {
        // Si même l'état du verrou est illisible, c'est le message du PIN qui
        // compte : il dit déjà d'utiliser le mot de passe.
      }
      throw err;
    }
  }, []);

  const setup = useCallback(
    async (password: string, name: string, hint: string) => {
      const created = await api.setupLock(password, name, hint);
      return created.recovery_phrase;
    },
    [],
  );

  const recover = useCallback(async (phrase: string, newPassword: string) => {
    setStatus(await api.recover(phrase, newPassword));
  }, []);

  const lock = useCallback(async () => {
    await api.lock();
    // Mise à jour locale plutôt qu'un aller-retour : `lock` ne peut pas
    // échouer côté backend et l'arbre authentifié doit disparaître aussitôt.
    setStatus((current) => (current ? { ...current, unlocked: false } : current));
  }, []);

  const reportUnsavedOnLock = useCallback((labels: string[]) => {
    setUnsavedOnLock(labels);
  }, []);

  const clearUnsavedOnLock = useCallback(() => setUnsavedOnLock([]), []);

  return (
    <LockContext.Provider
      value={{
        status,
        loading,
        error,
        refresh,
        applyStatus,
        unlock,
        unlockWithPin,
        setup,
        recover,
        lock,
        unsavedOnLock,
        reportUnsavedOnLock,
        clearUnsavedOnLock,
      }}
    >
      {children}
    </LockContext.Provider>
  );
}

export function useLock(): LockContextValue {
  const ctx = useContext(LockContext);
  if (!ctx) {
    throw new Error("useLock doit être utilisé à l'intérieur de <LockProvider>.");
  }
  return ctx;
}
