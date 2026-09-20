import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  BookOpen,
  CalendarDays,
  GraduationCap,
  Lock,
  Settings,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useDrafts } from "@/hooks/useDrafts";
import { useIdleTimer } from "@/hooks/useIdleTimer";
import { useLock } from "@/hooks/useLock";
import { api } from "@/lib/api";
import type { AppSettings } from "@/types";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// « Classes » reste en tête : c'est toujours l'écran d'accueil, `/` y redirige.
// L'emploi du temps ne prend pas cette place au palier 004 — la question se
// tranchera après une semaine d'usage réel, pas dans le palier qui le crée.
const NAV_ITEMS = [
  { to: "/classes", label: "Classes", icon: Users },
  { to: "/emploi-du-temps", label: "Emploi du temps", icon: CalendarDays },
  { to: "/referentiel", label: "Référentiel", icon: BookOpen },
  { to: "/parametres", label: "Réglages", icon: Settings },
];

/** Préavis, en secondes, avant le verrouillage par inactivité. Le verrou ne
 *  doit jamais tomber sans prévenir : l'enseignant relève la tête et son écran
 *  a disparu sans qu'il sache pourquoi. */
const WARN_SECONDS = 30;

/** Émis par la page Réglages après un enregistrement réussi. */
export const SETTINGS_UPDATED_EVENT = "sgpa:settings-updated";

/** Suspend le verrouillage par inactivité tant qu'un écran affiche quelque
 *  chose d'irrécupérable — aujourd'hui la phrase de récupération régénérée, que
 *  le démontage de l'arbre effacerait sans qu'elle ait été notée. `detail` vaut
 *  `true` pour suspendre, `false` pour rendre la main. */
export const LOCK_INHIBIT_EVENT = "sgpa:lock-inhibit";

function messageOf(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Une erreur inattendue est survenue.";
}

export function AppLayout() {
  const { lock, unsavedOnLock, reportUnsavedOnLock, clearUnsavedOnLock } =
    useLock();
  const { flushAll } = useDrafts();

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [lockInhibited, setLockInhibited] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [warning, setWarning] = useState(false);
  const [remaining, setRemaining] = useState(WARN_SECONDS);

  // Rechargement sur événement plutôt qu'au retour sur la route : le nouveau
  // délai doit s'appliquer dès l'enregistrement, sans attendre une navigation
  // que l'enseignant peut très bien ne pas faire.
  const loadSettings = useCallback(async () => {
    try {
      setSettings(await api.getSettings());
      setLockError(null);
    } catch (err) {
      setSettings(null);
      setLockError(
        `Les réglages de verrouillage n'ont pas pu être lus (${messageOf(err)}). Le verrouillage automatique est inactif ; utilisez le bouton « Verrouiller ».`,
      );
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    const onUpdated = () => void loadSettings();
    window.addEventListener(SETTINGS_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, onUpdated);
  }, [loadSettings]);

  // Seul le minuteur d'inactivité est suspendu. Le bouton, le raccourci et la
  // réduction de fenêtre restent actifs : ce sont des gestes volontaires, et
  // l'enseignant qui les fait sait ce qu'il quitte.
  useEffect(() => {
    const onInhibit = (event: Event) => {
      setLockInhibited((event as CustomEvent<boolean>).detail === true);
    };
    window.addEventListener(LOCK_INHIBIT_EVENT, onInhibit);
    return () => window.removeEventListener(LOCK_INHIBIT_EVENT, onInhibit);
  }, []);

  // Le minuteur d'inactivité, la réduction de fenêtre, le bouton et le raccourci
  // passent tous par ici : sans ce garde, chacun perdrait le brouillon.
  const locking = useRef(false);

  const lockNow = useCallback(async () => {
    if (locking.current) return;
    locking.current = true;
    try {
      let failed: string[] = [];
      try {
        failed = await flushAll();
      } catch (err) {
        // `flushAll` isole déjà chaque brouillon : un rejet ici ne peut venir
        // que du registre lui-même, et ne doit surtout pas retenir le verrou.
        failed = [messageOf(err)];
      }
      // Même vide : cela efface l'avertissement d'un verrouillage précédent.
      reportUnsavedOnLock(failed);
      // On verrouille dans TOUS les cas, échec d'enregistrement compris : la
      // sécurité prime, et les libellés perdus sont affichés au déverrouillage.
      try {
        await lock();
      } catch (err) {
        setLockError(`Le verrouillage a échoué : ${messageOf(err)}`);
      }
    } finally {
      locking.current = false;
    }
  }, [flushAll, lock, reportUnsavedOnLock]);

  const handleLock = useCallback(() => {
    void lockNow();
  }, [lockNow]);

  // ---- Verrouillage par inactivité ----

  useIdleTimer(
    settings?.lock_timeout_minutes ?? 0,
    handleLock,
    settings !== null && !lockInhibited,
    { warnSeconds: WARN_SECONDS, onWarnChange: setWarning },
  );

  // Décompte purement visuel : le vrai minuteur est celui de `useIdleTimer`.
  useEffect(() => {
    if (!warning) return;
    setRemaining(WARN_SECONDS);
    const tick = window.setInterval(
      () => setRemaining((value) => (value > 0 ? value - 1 : 0)),
      1000,
    );
    return () => window.clearInterval(tick);
  }, [warning]);

  // ---- Verrouillage à la réduction de la fenêtre ----

  useEffect(() => {
    if (!settings?.lock_on_minimize) return;
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: UnlistenFn | null = null;

    appWindow
      .onResized(({ payload }) => {
        // Tauri 2.10 n'expose aucun événement de réduction : `tauri://resize`
        // est le seul signal. Sous Windows, une fenêtre réduite est notifiée en
        // 0 × 0 ; ce test évite un aller-retour IPC à chaque pixel d'un
        // redimensionnement à la souris.
        if (payload.width !== 0 || payload.height !== 0) return;
        // Confirmation par l'état réel de la fenêtre, et surtout pas par
        // `tauri://blur` : ouvrir un PDF ou consulter Pronote fait perdre le
        // focus sans rien réduire, et ne doit pas verrouiller.
        void appWindow.isMinimized().then((minimized) => {
          if (minimized) void lockNow();
        });
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((err: unknown) => {
        setLockError(
          `Le verrouillage à la réduction de la fenêtre n'a pas pu être activé (${messageOf(err)}).`,
        );
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [settings?.lock_on_minimize, lockNow]);

  // Raccourci posé sur `window`, surtout pas un raccourci global système : ce
  // dernier confisquerait Ctrl+Shift+L à tout le poste, y compris hors de SGPA.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        handleLock();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleLock]);

  return (
    <div className="flex h-screen overflow-hidden">
      {warning && (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-sm font-medium text-amber-900 shadow-sm"
        >
          <Lock className="h-4 w-4 shrink-0" />
          {remaining > 0
            ? `Verrouillage dans ${remaining} s — bougez la souris pour rester connecté.`
            : "Verrouillage en cours — enregistrement des saisies…"}
        </div>
      )}

      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
        <div className="flex items-center gap-3 p-6">
          <div className="rounded-lg bg-primary p-1.5">
            <GraduationCap className="h-6 w-6 text-primary-foreground" />
          </div>
          <span className="text-xl font-bold tracking-tight">SGPA</span>
        </div>

        <Separator />

        <nav className="flex-1 space-y-1 p-4">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )
              }
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <Separator />

        <div className="space-y-3 p-4">
          <div className="px-3">
            {/* Le nom vient des réglages et non du statut du verrou : il vit
                dans la base chiffrée, que `LockStatus` ne touche plus. */}
            <p className="truncate text-sm font-medium">
              {settings?.teacher_display_name || "Enseignant"}
            </p>
            <p className="text-xs text-muted-foreground">Session déverrouillée</p>
            {settings !== null && (
              <p className="text-xs text-muted-foreground">
                Verrouillage automatique après{" "}
                {settings.lock_timeout_minutes} min d'inactivité
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground"
            onClick={handleLock}
            title="Verrouiller SGPA (Ctrl+Maj+L)"
          >
            <Lock className="h-5 w-5" />
            Verrouiller
            <span className="ml-auto text-xs text-muted-foreground">
              Ctrl+Maj+L
            </span>
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-muted/30">
        {(unsavedOnLock.length > 0 || lockError) && (
          <div className="space-y-3 px-8 pt-6">
            {unsavedOnLock.length > 0 && (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">
                    Ces modifications n'ont pas pu être enregistrées avant le
                    verrouillage :
                  </p>
                  <ul className="mt-1 list-inside list-disc">
                    {unsavedOnLock.map((label) => (
                      <li key={label}>{label}</li>
                    ))}
                  </ul>
                  <p className="mt-1">
                    Rouvrez l'écran concerné : la saisie a été perdue et doit
                    être refaite.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={clearUnsavedOnLock}
                  aria-label="Masquer cet avertissement"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}

            {lockError && (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="flex-1">{lockError}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => setLockError(null)}
                  aria-label="Masquer ce message"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}

export default AppLayout;
