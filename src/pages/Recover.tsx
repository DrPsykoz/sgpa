import { useState, type FormEvent } from "react";
import { ArrowLeft, LifeBuoy, Loader2 } from "lucide-react";
import { useLock } from "@/hooks/useLock";
import {
  MIN_PASSWORD_LENGTH,
  passwordLength,
  passwordStrength,
} from "@/lib/password";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Miroir de `keys::ALPHABET` : base32 sans I, L, O ni U. */
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ0123456789";
const GROUP_LENGTH = 5;
const GROUP_COUNT = 8;
const PHRASE_LENGTH = GROUP_LENGTH * GROUP_COUNT;

/**
 * Met la saisie à la forme canonique : majuscules, groupes de 5 séparés par des
 * tirets, 40 symboles au plus.
 *
 * I, L, O et U sont relus 1, 1, 0 et V. Ces quatre lettres n'appartiennent
 * jamais à l'alphabet, la correction est donc sans ambiguïté et rattrape une
 * phrase recopiée à la main. Tout le reste — espaces, tirets, ponctuation d'un
 * copier-coller — est simplement ignoré.
 */
function formatPhrase(input: string): string {
  const symbols: string[] = [];
  for (const raw of input.toUpperCase()) {
    let c = raw;
    if (c === "I" || c === "L") c = "1";
    else if (c === "O") c = "0";
    else if (c === "U") c = "V";
    if (!ALPHABET.includes(c)) continue;
    symbols.push(c);
    if (symbols.length === PHRASE_LENGTH) break;
  }
  const groups: string[] = [];
  for (let i = 0; i < symbols.length; i += GROUP_LENGTH) {
    groups.push(symbols.slice(i, i + GROUP_LENGTH).join(""));
  }
  return groups.join("-");
}

const symbolCount = (formatted: string): number =>
  formatted.split("-").join("").length;

export interface RecoverProps {
  /** Retour à l'écran de déverrouillage. */
  onCancel: () => void;
}

export default function Recover({ onCancel }: RecoverProps) {
  const { recover } = useLock();
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const typed = symbolCount(phrase);
  const complete = typed === PHRASE_LENGTH;
  const strength = passwordStrength(password);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    if (!complete) {
      setError(
        `La phrase compte ${PHRASE_LENGTH} caractères en ${GROUP_COUNT} groupes de ${GROUP_LENGTH}. Il en manque ${PHRASE_LENGTH - typed}.`,
      );
      return;
    }
    if (passwordLength(password) < MIN_PASSWORD_LENGTH) {
      setError(
        `Le nouveau mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`,
      );
      return;
    }
    if (password !== confirmation) {
      setError("Les deux mots de passe saisis ne sont pas identiques.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await recover(phrase, password);
      // Succès : le statut passe à « déverrouillé » et l'application remplace
      // cet écran. Rien à nettoyer ici, le composant est démonté.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPassword("");
      setConfirmation("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 py-10">
      <Card className="mx-4 w-full max-w-xl">
        <CardHeader className="space-y-4 text-center">
          <div className="flex items-center justify-center gap-3">
            <div className="rounded-lg bg-primary p-2">
              <LifeBuoy className="h-7 w-7 text-primary-foreground" />
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">
              Mot de passe oublié
            </CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            Saisissez la phrase de récupération remise au premier lancement, puis
            choisissez un nouveau mot de passe.
          </p>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-1 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            <p>
              Vos données ne sont ni effacées ni déchiffrées : la clé qui ouvre
              la base ne change pas, seule la façon d'y accéder est réécrite.
            </p>
            <p>
              <span className="font-medium text-foreground">
                L'ancien mot de passe cessera de fonctionner.
              </span>{" "}
              La phrase de récupération, elle, reste la même et servira encore.
            </p>
            <p>
              Si vous n'avez plus la phrase non plus, rien ni personne ne peut
              ouvrir cette base : il n'existe aucune porte dérobée.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phrase">Phrase de récupération</Label>
              <Input
                id="phrase"
                value={phrase}
                onChange={(e) => setPhrase(formatPhrase(e.target.value))}
                placeholder="K7M2P-9XQTV-3HR8N-BZ4WY-6JFDS-2NKCG-VT5PX-A9M3Q"
                className="font-mono text-base tracking-wider"
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  Casse, tirets et espaces sans importance. I, L, O et U se
                  lisent 1, 1, 0 et V.
                </span>
                <span className={cn(complete && "font-medium text-foreground")}>
                  {typed} / {PHRASE_LENGTH} caractères
                </span>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-password">Nouveau mot de passe</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={`${MIN_PASSWORD_LENGTH} caractères minimum`}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-confirmation">Confirmation</Label>
                <Input
                  id="new-confirmation"
                  type="password"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder="Ressaisissez le mot de passe"
                  autoComplete="new-password"
                />
              </div>
            </div>

            {password.length > 0 && (
              <div className="space-y-1">
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map((step) => (
                    <span
                      key={step}
                      className={cn(
                        "h-1.5 flex-1 rounded-full",
                        step <= strength.score ? strength.barClass : "bg-muted",
                      )}
                    />
                  ))}
                </div>
                <p className={cn("text-xs", strength.textClass)}>
                  {strength.label}
                </p>
              </div>
            )}

            {error && (
              <p className="whitespace-pre-line rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Définir ce mot de passe et ouvrir SGPA
            </Button>

            <div className="text-center">
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Revenir à l'écran de déverrouillage
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
