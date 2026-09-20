import { useEffect, useRef } from "react";

const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll"] as const;

/** Intervalle minimal entre deux réarmements, en millisecondes. Sans ce
 *  garde-fou, `mousemove` réarmerait le minuteur des centaines de fois par
 *  seconde pendant un simple déplacement de souris. */
const THROTTLE_MS = 1000;

export interface IdleTimerOptions {
  /** Secondes de préavis avant l'échéance. 0 ou absent : aucun préavis. */
  warnSeconds?: number;
  /** Appelé à l'entrée en préavis (`true`), puis à son annulation (`false`). */
  onWarnChange?: (warning: boolean) => void;
}

/**
 * Appelle `onIdle` après `minutes` sans activité de l'utilisateur.
 *
 * Le quatrième paramètre est facultatif : la signature à trois arguments reste
 * valable pour tout appelant qui n'a pas besoin de préavis.
 */
export function useIdleTimer(
  minutes: number,
  onIdle: () => void,
  enabled: boolean,
  options?: IdleTimerOptions,
): void {
  // Référence vive sur le callback : sans elle, une fonction recréée à chaque
  // rendu par l'appelant relancerait l'effet et remettrait le compteur à zéro
  // en permanence, donc le verrouillage n'arriverait jamais.
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  // Même raison pour le callback de préavis.
  const onWarnChangeRef = useRef(options?.onWarnChange);
  onWarnChangeRef.current = options?.onWarnChange;

  const warnSeconds = options?.warnSeconds ?? 0;

  useEffect(() => {
    if (!enabled || minutes <= 0) return;

    const delay = minutes * 60_000;
    // Un préavis plus long que le délai lui-même s'affiche d'emblée plutôt que
    // de partir en négatif : le réglage descend à 1 minute.
    const warnAt = warnSeconds > 0 ? Math.max(0, delay - warnSeconds * 1000) : -1;

    let idleTimer = 0;
    let warnTimer = 0;
    let warning = false;
    let lastArmedAt = 0;

    const setWarning = (next: boolean) => {
      if (warning === next) return;
      warning = next;
      onWarnChangeRef.current?.(next);
    };

    const arm = () => {
      lastArmedAt = Date.now();
      idleTimer = window.setTimeout(() => {
        setWarning(false);
        onIdleRef.current();
      }, delay);
      if (warnAt >= 0) {
        warnTimer = window.setTimeout(() => setWarning(true), warnAt);
      }
    };

    const disarm = () => {
      window.clearTimeout(idleTimer);
      window.clearTimeout(warnTimer);
    };

    arm();

    const handleActivity = () => {
      // Le bridage ne s'applique pas pendant le préavis : l'utilisateur qui
      // bouge la souris pour rester connecté doit être entendu tout de suite.
      if (!warning && Date.now() - lastArmedAt < THROTTLE_MS) return;
      disarm();
      setWarning(false);
      arm();
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handleActivity, { passive: true });
    }

    return () => {
      disarm();
      setWarning(false);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handleActivity);
      }
    };
  }, [enabled, minutes, warnSeconds]);
}
