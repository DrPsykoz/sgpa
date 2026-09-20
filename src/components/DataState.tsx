import type { ReactElement, ReactNode } from "react";
import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface DataStateProps {
  loading: boolean;
  error: string | null;
  empty?: boolean;
  emptyLabel?: string;
  onRetry?: () => void;
  children: ReactNode;
}

export function DataState({
  loading,
  error,
  empty,
  emptyLabel,
  onRetry,
  children,
}: DataStateProps): ReactElement {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement…
      </div>
    );
  }

  // L'erreur est testée AVANT l'état vide : sans cet ordre, un chargement en
  // échec s'affiche « Aucun élève dans cette classe » et l'enseignant croit à
  // une base vide au lieu d'une panne.
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
        <AlertTriangle className="h-5 w-5 text-destructive" />
        <p className="text-sm font-medium text-destructive">{error}</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Réessayer
          </Button>
        )}
      </div>
    );
  }

  if (empty) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
        <Inbox className="h-5 w-5" />
        {emptyLabel ?? "Aucun élément à afficher."}
      </div>
    );
  }

  return <>{children}</>;
}

export default DataState;
