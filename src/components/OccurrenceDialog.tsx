import type { ReactElement } from "react";
import { BookOpen, Ban } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** « mardi 17 novembre 2026 ». En heure locale : `toISOString()` daterait au
 *  30 novembre ce qui est ouvert le 1er décembre à 00h30. */
function jourLong(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export interface OccurrenceDialogProps {
  /** `null` = fermé. Le couple est porté par le parent : le créneau **et** la
   *  date, jamais la date du jour — l'accueil montre six journées, et c'est
   *  celle de la carte cliquée qui s'écrit. */
  cible: {
    slotLabel: string;
    sessionName: string | null;
    date: string;
    /** La date est déjà passée. La création se dit alors, parce que la séance
     *  entrera au dénominateur d'assiduité de tous les élèves de la classe. */
    passee: boolean;
  } | null;
  onClose: () => void;
  /** Créer l'occurrence, puis l'ouvrir dans sa classe. */
  onCreerEtOuvrir: () => void;
  /** Enchaîner sur la demande de motif, qui écrira la séance annulée. */
  onSansCours: () => void;
  busy?: boolean;
}

/**
 * Le cours de chaque semaine n'a pas encore de séance à cette date : que
 * veut-on en faire ?
 *
 * Ce dialogue existe parce qu'une carte ne peut pas mener à deux endroits sans
 * faire deviner lequel. Un cours de l'emploi du temps est un **modèle** : tant
 * qu'on n'a rien dit, il n'y a ni appel, ni cahier de texte, ni ligne dans
 * `seances` — donc rien à ouvrir. Il y a deux gestes possibles, et c'est le
 * dialogue qui les nomme plutôt qu'un clic qui en choisirait un en silence.
 *
 * **Les deux gestes écrivent, et les deux comptent.** « Créer la séance »
 * l'ajoute au dénominateur d'assiduité de toute la classe ; « ce cours n'a pas
 * lieu » la crée annulée, donc hors de ce dénominateur. C'est pour cela qu'ils
 * sont demandés et jamais déduits de la navigation : un tableau de bord qui
 * crée une séance au premier clic de curiosité abîme un bilan remis aux
 * familles.
 *
 * Ce dialogue n'écrit RIEN lui-même : il rend la main au parent, qui appelle la
 * commande. `seances` garde une porte d'écriture unique.
 */
export function OccurrenceDialog({
  cible,
  onClose,
  onCreerEtOuvrir,
  onSansCours,
  busy = false,
}: OccurrenceDialogProps): ReactElement {
  return (
    <Dialog open={cible !== null} onOpenChange={(ouvert) => !ouvert && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {cible?.slotLabel}
            {cible?.sessionName && (
              <span className="font-normal text-muted-foreground">
                {" "}
                — {cible.sessionName}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {cible && (
              <>
                {jourLong(cible.date)}. Ce cours revient chaque semaine, mais sa
                séance de ce jour-là n'existe pas encore : rien n'est écrit, ni
                appel ni cahier de texte.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Deux gestes de même poids, donc deux blocs de même forme : un bouton
            qui serait secondaire laisserait croire que son écriture compte
            moins, alors que les deux touchent l'assiduité de la classe. */}
        <div className="space-y-3">
          <div className="space-y-1.5 rounded-md border p-3">
            <Button
              className="w-full justify-start"
              disabled={busy}
              onClick={onCreerEtOuvrir}
            >
              <BookOpen className="mr-2 h-4 w-4" />
              {busy ? "Création…" : "Créer la séance et l'ouvrir"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Le cours a lieu. La séance s'ouvre dans sa classe, sur son appel et
              son cahier de texte, et elle compte dans l'assiduité de tous les
              élèves inscrits.
              {cible?.passee && (
                <>
                  {" "}
                  <span className="font-medium text-foreground">
                    Cette date est passée
                  </span>{" "}
                  : la séance entrera quand même dans l'assiduité, et les appels
                  non faits y apparaîtront comme tels.
                </>
              )}
            </p>
          </div>

          <div className="space-y-1.5 rounded-md border p-3">
            <Button
              variant="outline"
              className="w-full justify-start"
              disabled={busy}
              onClick={onSansCours}
            >
              <Ban className="mr-2 h-4 w-4" />
              Ce cours n'a pas lieu
            </Button>
            <p className="text-xs text-muted-foreground">
              Sortie, absence, jour banalisé. La séance sera créée annulée :
              elle garde sa place au cahier de texte et sort de l'assiduité de
              toute la classe. Le motif vous sera demandé juste après.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Ne rien faire
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default OccurrenceDialog;
