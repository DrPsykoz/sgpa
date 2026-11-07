import { useCallback, useEffect, useRef, useState } from "react";
import {
  NavLink,
  Outlet,
  useMatch,
  useResolvedPath,
} from "react-router-dom";
import {
  BookOpen,
  CalendarDays,
  GraduationCap,
  Home,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { LucideIcon } from "lucide-react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useDrafts } from "@/hooks/useDrafts";
import { useIdleTimer } from "@/hooks/useIdleTimer";
import { useLock } from "@/hooks/useLock";
import { api } from "@/lib/api";
import type { AppSettings } from "@/types";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// « Accueil » passe en tête, et « Classes » lui cède la place : la question
// laissée ouverte au palier 004 est tranchée. Ce qu'on ouvre l'application pour
// savoir, c'est la journée du jour et ce qui reste à reprendre — la liste des
// classes, elle, ne change pas trois fois par an.
//
// L'accueil est à `/` et non à `/accueil` : c'est la racine qu'un lien
// « Retour » ou un `*` non résolu rejoint.
interface NavItemDef {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Vrai si le lien ne s'allume que sur SON chemin, exactement.
   *
   *  Indispensable pour « Accueil » : son chemin est `/`, et la règle par
   *  défaut (`end: false`, qui garde « Classes » allumé quand on ouvre une
   *  classe) ferait de `/` un préfixe de toutes les routes — les cinq liens
   *  s'allumeraient ensemble, partout. */
  exact?: boolean;
}

const NAV_ITEMS: NavItemDef[] = [
  { to: "/", label: "Accueil", icon: Home, exact: true },
  { to: "/classes", label: "Classes", icon: Users },
  { to: "/emploi-du-temps", label: "Emploi du temps", icon: CalendarDays },
  { to: "/referentiel", label: "Référentiel", icon: BookOpen },
  { to: "/parametres", label: "Réglages", icon: Settings },
];

/** La largeur du menu est une préférence d'affichage purement locale : elle
 *  n'a rien à faire dans la base chiffrée, et la perdre ne coûte rien. */
const NAV_REDUCED_KEY = "sgpa:nav-reduite";

/** Lecture volontairement défensive : `localStorage` peut contenir n'importe
 *  quoi, et son accès lui-même peut lever. Tout ce qui n'est pas exactement
 *  « 1 » vaut « menu déplié », l'affichage d'origine. */
function readNavReduced(): boolean {
  try {
    return window.localStorage.getItem(NAV_REDUCED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Un lien du menu. Replié, il ne montre que son icône : le libellé passe en
 *  infobulle et reste le nom accessible du lien, car une colonne d'icônes
 *  muettes ne se devine pas.
 *
 *  **L'état actif est calculé ici**, et non confié à la forme « fonction » de
 *  `className` que `NavLink` propose. Cette forme ne survit pas à
 *  `TooltipTrigger asChild` : Radix fusionne les `className` du parent et de
 *  l'enfant par `[parent, enfant].filter(Boolean).join(" ")`, et `join`
 *  transforme une fonction en son propre code source. Le lien replié recevait
 *  donc « ({ isActive }) => cn( … » comme liste de classes — aucune n'existe,
 *  d'où des icônes collées les unes aux autres, décalées à gauche et sans
 *  pastille d'écran courant. Déplié, le lien n'est pas enveloppé d'infobulle,
 *  la fonction était appelée normalement, et le défaut ne se voyait pas.
 *
 *  Règle générale qui en découle : sous `asChild`, un `className` est une
 *  chaîne, jamais une fonction.
 */
function NavItem({
  item,
  reduced,
}: {
  item: NavItemDef;
  reduced: boolean;
}) {
  // Même règle que `NavLink` sans `end` : la section reste allumée sur ses
  // écrans enfants, sinon « Classes » s'éteindrait dès qu'on ouvre une classe.
  // Sauf pour l'accueil, dont le chemin est préfixe de tous les autres.
  const { pathname } = useResolvedPath(item.to);
  const isActive =
    useMatch({ path: pathname, end: item.exact ?? false }) !== null;

  const link = (
    <NavLink
      to={item.to}
      aria-label={item.label}
      // Jetons `sidebar-*` et non `primary` / `muted` : la barre latérale est le
      // seul bloc sombre de l'application, elle a donc sa propre surface. Un lien
      // peint en `text-muted-foreground` y deviendrait illisible, et c'est
      // exactement ce que ces jetons évitent — sans un seul `dark:` ici.
      className={cn(
        "flex items-center rounded-lg py-2.5 text-sm font-medium transition-colors",
        reduced ? "justify-center px-0" : "gap-3 px-3",
        isActive
          ? "bg-sidebar-active text-sidebar-active-foreground"
          : "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground",
      )}
    >
      <item.icon className="h-5 w-5 shrink-0" />
      {!reduced && <span className="truncate">{item.label}</span>}
    </NavLink>
  );

  if (!reduced) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

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
  const [navReduced, setNavReduced] = useState(readNavReduced);
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

  // La préférence survit au rechargement de l'application. Un stockage
  // indisponible ne doit pas empêcher de replier le menu : le choix vaut alors
  // pour la session en cours, sans message d'erreur pour si peu.
  useEffect(() => {
    try {
      window.localStorage.setItem(NAV_REDUCED_KEY, navReduced ? "1" : "0");
    } catch {
      // Préférence non persistée : sans conséquence.
    }
  }, [navReduced]);

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

      {/* Un seul fournisseur, et il couvre la barre latérale ET le
          contenu. Quand il ne tenait que l'<aside>, toute infobulle posée
          dans un écran levait « Tooltip must be used within
          TooltipProvider » — Radix ne donne aucune valeur par défaut à ce
          contexte, l'écran blanchissait. */}
      <TooltipProvider delayDuration={200}>
        <aside
          className={cn(
            "flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
            // 4 rem replié : juste de quoi centrer une icône et sa zone
            // cliquable de 36 px.
            navReduced ? "w-16" : "w-64",
          )}
        >
          <div
            className={cn(
              "flex items-center",
              navReduced ? "flex-col gap-2 px-2 py-4" : "gap-3 p-6",
            )}
          >
            <div className="rounded-lg bg-sidebar-active p-1.5 shadow-carte">
              <GraduationCap className="h-6 w-6 text-sidebar-active-foreground" />
            </div>
            {!navReduced && (
              <span className="font-titre text-xl font-bold tracking-tight">
                SGPA
              </span>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "shrink-0 text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    !navReduced && "ml-auto",
                  )}
                  onClick={() => setNavReduced((value) => !value)}
                  aria-label={
                    navReduced
                      ? "Déplier le menu et afficher les libellés"
                      : "Réduire le menu aux icônes seules"
                  }
                  aria-expanded={!navReduced}
                  aria-controls="menu-principal"
                >
                  {navReduced ? (
                    <PanelLeftOpen className="h-5 w-5" />
                  ) : (
                    <PanelLeftClose className="h-5 w-5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {navReduced ? "Déplier le menu" : "Réduire le menu"}
              </TooltipContent>
            </Tooltip>
          </div>

          <Separator className="bg-sidebar-border" />

          <nav
            id="menu-principal"
            className={cn("flex-1 space-y-1", navReduced ? "p-2" : "p-4")}
          >
            {NAV_ITEMS.map((item) => (
              <NavItem key={item.to} item={item} reduced={navReduced} />
            ))}
          </nav>

          <Separator className="bg-sidebar-border" />

          {navReduced ? (
            // Le bloc d'identité disparaît avec les libellés : il n'y a pas la
            // place, et c'est ce que l'on demande en repliant le menu. Le
            // bouton, lui, reste — avec son infobulle, sinon il ne veut rien
            // dire.
            <div className="flex justify-center p-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    onClick={handleLock}
                    aria-label="Verrouiller SGPA (Ctrl+Maj+L)"
                  >
                    <Lock className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  Verrouiller SGPA (Ctrl+Maj+L)
                </TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <div className="space-y-3 p-4">
              <div className="px-3">
                {/* Le nom vient des réglages et non du statut du verrou : il vit
                    dans la base chiffrée, que `LockStatus` ne touche plus. */}
                <p className="truncate text-sm font-medium">
                  {settings?.teacher_display_name || "Enseignant"}
                </p>
                <p className="text-xs text-sidebar-muted">
                  Session déverrouillée
                </p>
                {settings !== null && (
                  <p className="text-xs text-sidebar-muted">
                    Verrouillage automatique après{" "}
                    {settings.lock_timeout_minutes} min d'inactivité
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
                onClick={handleLock}
                title="Verrouiller SGPA (Ctrl+Maj+L)"
                aria-label="Verrouiller SGPA (Ctrl+Maj+L)"
              >
                <Lock className="h-5 w-5" />
                Verrouiller
                <span className="ml-auto text-xs text-sidebar-muted">
                  Ctrl+Maj+L
                </span>
              </Button>
            </div>
          )}
        </aside>

        <main className="flex-1 overflow-auto bg-background">
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
      </TooltipProvider>
    </div>
  );
}

export default AppLayout;
