import { useState, type FormEvent } from "react";
import { GraduationCap, Loader2, ShieldAlert } from "lucide-react";
import { useLock } from "@/hooks/useLock";
import {
  MIN_PASSWORD_LENGTH,
  passwordLength,
  passwordStrength,
} from "@/lib/password";
import { cn } from "@/lib/utils";
import { RecoveryPhrase } from "@/components/RecoveryPhrase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Jauge indicative : elle n'interdit rien au-delà du minimum. */
function StrengthMeter({ password }: { password: string }) {
  if (password.length === 0) return null;
  const { score, label, barClass, textClass } = passwordStrength(password);
  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              step <= score ? barClass : "bg-muted",
            )}
          />
        ))}
      </div>
      <p className={cn("text-xs", textClass)}>
        {label}
        {score <= 1 && " — un mot de passe long vaut mieux qu'un mot compliqué."}
      </p>
    </div>
  );
}

export default function FirstRun() {
  const { setup, refresh } = useLock();
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [hint, setHint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** Non nulle = le verrou est créé et la phrase attend d'être notée. */
  const [phrase, setPhrase] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    const name = displayName.trim();
    if (name.length === 0) {
      setError("Indiquez le nom qui s'affichera dans l'application.");
      return;
    }
    // Le mot de passe n'est volontairement pas « trimé » : c'est lui qui dérive
    // la clé, un espace de fin en fait partie et devra être retapé.
    if (passwordLength(password) < MIN_PASSWORD_LENGTH) {
      setError(
        `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`,
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
      setPhrase(await setup(password, name, hint.trim()));
      // Les champs sont vidés dès que la clé est créée : rien ne justifie de
      // garder le mot de passe dans l'état React une fois l'enveloppe écrite.
      setPassword("");
      setConfirmation("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAcknowledge = () => {
    setOpening(true);
    // `refresh()` relit l'état du verrou : il devient « configuré, déverrouillé »
    // et l'application s'ouvre. C'est cet appel, et non `setup`, qui fait
    // disparaître cet écran — la phrase reste affichée jusqu'à l'accusé.
    void refresh();
  };

  if (phrase !== null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 py-10">
        <Card className="mx-4 w-full max-w-2xl">
          <CardHeader className="space-y-2 text-center">
            <CardTitle className="text-2xl font-bold tracking-tight">
              Votre phrase de récupération
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Le verrou est créé et vos données sont désormais chiffrées. Il
              reste une chose à faire, et elle ne se représentera pas.
            </p>
          </CardHeader>
          <CardContent>
            <RecoveryPhrase
              phrase={phrase}
              confirmLabel="J'ai noté la phrase — ouvrir SGPA"
              confirming={opening}
              onConfirm={handleAcknowledge}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 py-10">
      <Card className="mx-4 w-full max-w-lg">
        <CardHeader className="space-y-4 text-center">
          <div className="flex items-center justify-center gap-3">
            <div className="rounded-lg bg-primary p-2">
              <GraduationCap className="h-7 w-7 text-primary-foreground" />
            </div>
            <CardTitle className="text-3xl font-bold tracking-tight">
              SGPA
            </CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            Premier lancement : choisissez le mot de passe qui chiffrera vos
            données.
          </p>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="space-y-1">
              <p>
                Ce mot de passe chiffre la base de données : sans lui, le fichier{" "}
                <span className="font-mono">data/sgpa.db</span> n'est plus qu'un
                bloc illisible, même avec un logiciel SQLite.
              </p>
              <p>
                Deux choses restent en clair sur la clé : les PDF que vous
                exportez dans <span className="font-mono">exports/</span> et
                l'historique de navigation de{" "}
                <span className="font-mono">data/webview/</span>. Activez
                BitLocker To Go sur la clé pour les couvrir aussi.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Nom affiché</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Prénom Nom"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Il vit dans la base chiffrée et sert d'en-tête à vos bilans. Il
                n'apparaît jamais sur l'écran de déverrouillage : une clé USB
                trouvée ne doit pas dire à qui elle appartient.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="password">Mot de passe</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={`${MIN_PASSWORD_LENGTH} caractères minimum`}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmation">Confirmation</Label>
                <Input
                  id="confirmation"
                  type="password"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder="Ressaisissez le mot de passe"
                  autoComplete="new-password"
                />
              </div>
            </div>

            <StrengthMeter password={password} />

            <div className="space-y-2">
              <Label htmlFor="hint">Indice (facultatif)</Label>
              <Input
                id="hint"
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="Affiché après trois essais infructueux"
              />
              <p className="text-xs text-muted-foreground">
                Cet indice reste lisible hors de la base chiffrée, c'est sa
                raison d'être : n'y écrivez pas le mot de passe.
              </p>
            </div>

            {error && (
              <p className="whitespace-pre-line rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Chiffrer mes données et ouvrir SGPA
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              La création de la clé prend quelques secondes : elle est
              volontairement lente à calculer, pour l'être aussi pour qui
              essaierait des millions de mots de passe.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
