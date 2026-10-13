import { useState, type ReactElement } from "react";
import { Ban } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CANCEL_REASON_SUGGESTIONS } from "@/types";

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

export interface CancelReasonDialogProps {
  /** `null` = fermé. Le couple est porté par le parent : le créneau **et** la
   *  date, jamais la date de l'écran — depuis une semaine sur laquelle on a
   *  navigué, les deux diffèrent, et c'est celle de la case qui s'écrit. */
  cible: { slotLabel: string; date: string } | null;
  onClose: () => void;
  onConfirm: (motif: string) => void;
  busy?: boolean;
}

/**
 * « Ce cours n'a pas lieu » : demande pourquoi, avant d'écrire.
 *
 * Ce dialogue existe parce que le bon moment pour dire pourquoi un cours est
 * annulé est celui où on l'annule — pas trois semaines plus tard en rouvrant la
 * séance. Il coûte un clic de plus, et c'est tout l'objet de la demande.
 *
 * **Le motif est facultatif.** « Enregistrer sans motif » n'est pas un pis-aller
 * caché dans un coin : on annule souvent dans l'urgence, et exiger une
 * justification pour pouvoir avancer ferait écrire n'importe quoi.
 *
 * Ce dialogue n'écrit RIEN lui-même. Il rend un texte au parent, qui appelle la
 * commande — `seances` garde une porte d'écriture unique, et une séance créée
 * ici compte dans l'assiduité de la classe comme toutes les autres, annulée
 * seulement.
 */
export function CancelReasonDialog({
  cible,
  onClose,
  onConfirm,
  busy = false,
}: CancelReasonDialogProps): ReactElement {
  const [motif, setMotif] = useState("");

  const fermer = (ouvert: boolean) => {
    if (ouvert) return;
    setMotif("");
    onClose();
  };

  return (
    <Dialog open={cible !== null} onOpenChange={fermer}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-4 w-4 text-muted-foreground" />
            Ce cours n'a pas lieu
          </DialogTitle>
          <DialogDescription>
            {cible && (
              <>
                {cible.slotLabel} — {jourLong(cible.date)}. La séance sera créée
                annulée : elle garde sa place au cahier de texte et sort de
                l'assiduité de toute la classe.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="motif-annulation">Motif</Label>
          <Input
            id="motif-annulation"
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            placeholder="Facultatif"
            maxLength={200}
            autoFocus
          />
          {/* Des suggestions, pas une liste fermée : elles remplissent le champ
              et vous écrivez ensuite ce que vous voulez. Aucun calcul ne
              s'appuie sur ce texte. */}
          <div className="flex flex-wrap gap-1.5">
            {CANCEL_REASON_SUGGESTIONS.map((suggestion) => (
              <Button
                key={suggestion}
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs font-normal"
                onClick={() => setMotif(suggestion)}
              >
                {suggestion}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Ce motif ne figure sur aucun bilan : il est là pour vous rappeler ce
            qui s'est passé, pas pour être remis aux familles. Il reste
            modifiable depuis la séance.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => fermer(false)} disabled={busy}>
            Annuler
          </Button>
          <Button onClick={() => onConfirm(motif)} disabled={busy}>
            {busy ? "Enregistrement…" : "Ce cours n'a pas lieu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
