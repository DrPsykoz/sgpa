import { useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import { DraftsProvider } from "@/hooks/useDrafts";
import { LockProvider, useLock } from "@/hooks/useLock";
import { interdireNavigationParDepot } from "@/lib/depot";
import AppLayout from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import Cycles from "@/pages/Cycles";
import FirstRun from "@/pages/FirstRun";
import Home from "@/pages/Home";
import Recover from "@/pages/Recover";
import Sessions from "@/pages/Sessions";
import SessionDetail from "@/pages/SessionDetail";
import SettingsPage from "@/pages/Settings";
import Timetable from "@/pages/Timetable";
import Unlock from "@/pages/Unlock";

/**
 * Garde de verrouillage. Elle vit SOUS le routeur : ainsi un verrouillage ne
 * détruit plus l'historique de navigation, et l'enseignant retrouve son écran
 * après déverrouillage.
 *
 * L'arbre authentifié est bien démonté, pas masqué par un calque flouté :
 * l'état React contenant noms d'élèves et notes doit réellement disparaître.
 */
function LockGate() {
  const { status, loading, error, refresh } = useLock();
  // L'écran de récupération n'est pas une route : il remplace le
  // déverrouillage, sous le même garde, et ne doit jamais apparaître dans
  // l'historique de navigation de la session ouverte.
  const [recovering, setRecovering] = useState(false);
  const unlocked = status?.unlocked ?? false;

  // Sans cette remise à zéro, un verrouillage ultérieur rouvrirait l'écran de
  // phrase au lieu de demander le mot de passe.
  useEffect(() => {
    if (unlocked) setRecovering(false);
  }, [unlocked]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Ouverture de SGPA…
        </div>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <div className="flex max-w-md flex-col items-center gap-4 rounded-lg border border-destructive/30 bg-card px-6 py-8 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" />
          <p className="text-sm font-medium text-destructive">
            SGPA n'a pas pu lire son fichier de données.
          </p>
          <p className="text-sm text-muted-foreground">
            {error ?? "État du verrou indisponible."}
          </p>
          <Button variant="outline" onClick={() => void refresh()}>
            Réessayer
          </Button>
        </div>
      </div>
    );
  }

  if (!status.configured) return <FirstRun />;
  if (!status.unlocked) {
    return recovering ? (
      <Recover onCancel={() => setRecovering(false)} />
    ) : (
      <Unlock onForgotPassword={() => setRecovering(true)} />
    );
  }

  // Le registre des brouillons vit À L'INTÉRIEUR de la branche déverrouillée :
  // un brouillon n'existe que là, et le verrouillage doit emporter le registre
  // avec l'arbre qu'il recense.
  return (
    <DraftsProvider>
      <Routes>
        <Route element={<AppLayout />}>
          {/* L'accueil n'est plus la liste des classes.
              Ce qu'on ouvre l'application pour savoir, c'est ce qu'on fait
              aujourd'hui et ce qu'on a laissé derrière soi — pas la liste de
              ses deux classes, qui ne change pas trois fois par an. */}
          <Route path="/" element={<Home />} />
          <Route path="/classes" element={<Sessions />} />
          <Route path="/classes/:sessionId" element={<SessionDetail />} />
          <Route path="/emploi-du-temps" element={<Timetable />} />
          <Route path="/referentiel" element={<Cycles />} />
          <Route path="/parametres" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </DraftsProvider>
  );
}

export default function App() {
  // Posé ici, donc au-dessus du garde de verrouillage : la fenêtre accepte le
  // glisser-déposer partout, y compris sur l'écran de mot de passe, et c'est
  // justement là qu'un fichier lâché ferait le plus de dégâts — WebView2
  // naviguerait vers lui et l'application disparaîtrait derrière. Voir
  // `src/lib/depot.ts` pour la raison pour laquelle Tauri ne s'en charge plus.
  useEffect(() => interdireNavigationParDepot(), []);

  // HashRouter et non BrowserRouter : en build packagé, Tauri sert la page par
  // un protocole personnalisé, et un rechargement sur une URL profonde
  // dépendrait alors de la résolution d'asset.
  return (
    <LockProvider>
      <HashRouter>
        <LockGate />
      </HashRouter>
    </LockProvider>
  );
}
