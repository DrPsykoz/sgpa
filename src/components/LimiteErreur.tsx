import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

import { journaliserErreurInterface } from "@/lib/journal";

interface LimiteErreurProps {
  children: ReactNode;
}

interface LimiteErreurState {
  erreur: Error | null;
}

/**
 * Le filet sous l'arbre React : une exception de rendu donne un écran lisible
 * et une ligne de journal, au lieu d'une fenêtre blanche.
 *
 * Sans limite d'erreur, React démonte tout l'arbre et laisse une page vide.
 * L'enseignant n'a alors ni message, ni console à ouvrir, ni moyen de dire ce
 * qui s'est passé : l'application a simplement disparu. C'est le pire des
 * défauts possibles, parce qu'il efface jusqu'à la trace de lui-même.
 *
 * **Monté au-dessus du garde de verrouillage**, comme
 * `interdireNavigationParDepot` et pour une raison voisine : l'écran de mot de
 * passe doit lui aussi être couvert. Une exception y laisserait une fenêtre
 * blanche sans aucun moyen d'entrer dans l'application.
 *
 * Elle ne rattrape que le **rendu**. Une exception dans un gestionnaire
 * d'événement ou une promesse rejetée passent par les filets globaux de
 * `lib/journal.ts` ; les erreurs de commande, par `DataState`. Les trois sont
 * nécessaires et aucun ne remplace les autres.
 *
 * Volontairement écrite en éléments nus, sans `Button` ni `Card` : c'est
 * l'écran qui s'affiche quand un composant vient de lever, et il ne doit rien
 * devoir à l'arbre qu'il remplace.
 */
export default class LimiteErreur extends Component<
  LimiteErreurProps,
  LimiteErreurState
> {
  state: LimiteErreurState = { erreur: null };

  static getDerivedStateFromError(erreur: Error): LimiteErreurState {
    return { erreur };
  }

  componentDidCatch(erreur: Error, info: ErrorInfo): void {
    // `componentStack` nomme la chaîne de composants traversée : c'est
    // l'information qui dit *quel écran* a cassé, et elle ne contient que des
    // noms de nos propres composants.
    journaliserErreurInterface(
      "rendu",
      `${erreur.name}: ${erreur.message} ⏎ ${erreur.stack ?? ""} ⏎ composants :${
        info.componentStack ?? ""
      }`,
    );
  }

  private recharger = (accueil: boolean): void => {
    // Revenir à l'accueil AVANT de recharger : si c'est l'écran courant qui
    // lève, recharger sur la même adresse rejoue la même panne.
    if (accueil) window.location.hash = "#/";
    window.location.reload();
  };

  render(): ReactNode {
    const { erreur } = this.state;
    if (!erreur) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <div className="flex max-w-xl flex-col gap-4 rounded-lg border border-destructive/30 bg-card px-6 py-8">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 shrink-0 text-destructive" />
            <p className="text-sm font-medium text-destructive">
              Un écran de SGPA s'est interrompu.
            </p>
          </div>

          <p className="text-sm text-muted-foreground">
            Aucune donnée n'a été perdue : rien n'est enregistré sans votre
            action, et la base n'a pas été touchée. Le détail technique a été
            inscrit dans le journal de diagnostic, que vous retrouverez dans{" "}
            <span className="font-mono">Réglages</span> — il ne contient aucun
            nom d'élève.
          </p>

          <pre className="max-h-40 overflow-auto rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            {erreur.name}: {erreur.message}
          </pre>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => this.recharger(true)}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Revenir à l'accueil
            </button>
            <button
              type="button"
              onClick={() => this.recharger(false)}
              className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Rouvrir cet écran
            </button>
          </div>
        </div>
      </div>
    );
  }
}
