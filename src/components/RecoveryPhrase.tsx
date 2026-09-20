import { useState } from "react";
import { Check, Copy, KeyRound, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface RecoveryPhraseProps {
  /** Telle que renvoyée par le backend : 8 groupes de 5, séparés par des tirets. */
  phrase: string;
  confirmLabel: string;
  onConfirm: () => void;
  confirming?: boolean;
  /** Régénération depuis les réglages : la phrase précédente vient de mourir,
   *  et l'enseignant doit détruire la note qu'il en avait gardée. */
  regenerated?: boolean;
}

/**
 * Écran de remise de la phrase de récupération.
 *
 * Partagé par le premier lancement et par la régénération : une seconde
 * implémentation finirait par oublier un des avertissements, et c'est
 * précisément ce texte qui décide si l'enseignant note la phrase ou non.
 *
 * La case à cocher est obligatoire. Elle ne prouve rien, mais elle empêche le
 * clic réflexe sur « Continuer » qui ferme le seul écran où la phrase existe.
 */
export function RecoveryPhrase({
  phrase,
  confirmLabel,
  onConfirm,
  confirming = false,
  regenerated = false,
}: RecoveryPhraseProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");

  const groups = phrase.split("-");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(phrase);
      setCopy("done");
    } catch {
      // Surtout pas un échec muet : l'enseignant croirait la phrase dans son
      // presse-papiers et fermerait l'écran sans l'avoir nulle part.
      setCopy("failed");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="space-y-1">
          <p className="font-medium">
            Notez cette phrase maintenant : elle ne sera plus jamais affichée.
          </p>
          <p>
            Elle est votre unique second moyen d'ouvrir vos données. Elle n'est
            enregistrée en clair nulle part, pas même dans SGPA : personne — ni
            vous, ni l'auteur de l'application — ne peut la retrouver plus tard.
          </p>
        </div>
      </div>

      <div className="rounded-lg border-2 border-dashed border-border bg-muted/40 p-4">
        <div className="flex flex-wrap justify-center gap-2">
          {groups.map((group, index) => (
            <span
              key={`${index}-${group}`}
              className="rounded-md border border-border bg-background px-3 py-2 font-mono text-xl font-semibold tracking-[0.2em] tabular-nums"
            >
              {group}
            </span>
          ))}
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Les lettres I, L, O et U n'y figurent jamais : lisez 1, 1, 0 et V.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={() => void handleCopy()}>
          <Copy className="h-4 w-4" />
          Copier la phrase
        </Button>
        {copy === "done" && (
          <span className="flex items-center gap-1.5 text-sm text-green-700">
            <Check className="h-4 w-4" />
            Copiée. Collez-la dans un endroit sûr, puis videz le presse-papiers.
          </span>
        )}
        {copy === "failed" && (
          <span className="flex items-center gap-1.5 text-sm text-destructive">
            <TriangleAlert className="h-4 w-4" />
            La copie a échoué : recopiez la phrase à la main.
          </span>
        )}
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Où la ranger</p>
        <ul className="list-inside list-disc space-y-1">
          <li>
            Sur papier, chez vous — pas sur la clé USB : une phrase rangée à côté
            de la base qu'elle ouvre ne protège plus de rien.
          </li>
          <li>
            Ou dans votre gestionnaire de mots de passe, avec le mot de passe de
            SGPA.
          </li>
        </ul>
        {regenerated ? (
          <p className="text-foreground">
            La phrase précédente ne fonctionne plus. Détruisez la note qui la
            portait, elle n'ouvre plus rien.
          </p>
        ) : (
          <p className="text-foreground">
            Sans votre mot de passe <strong>ni</strong> cette phrase, vos
            classes, vos notes et vos bilans sont définitivement perdus. Aucune
            réinstallation ne les récupérera.
          </p>
        )}
      </div>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 cursor-pointer rounded border-input accent-primary"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
        <span className="font-medium">
          Je l'ai notée et rangée en lieu sûr.
        </span>
      </label>

      <Button
        type="button"
        className="w-full"
        disabled={!acknowledged || confirming}
        onClick={onConfirm}
      >
        {confirming && <Loader2 className="h-4 w-4 animate-spin" />}
        {confirmLabel}
      </Button>
    </div>
  );
}

export default RecoveryPhrase;
