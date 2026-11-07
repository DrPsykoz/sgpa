import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound, Loader2, Lock } from "lucide-react";
import { useLock } from "@/hooks/useLock";
import { PIN_LENGTH } from "@/lib/password";
import { PinInput } from "@/components/PinInput";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Nombre d'échecs à partir duquel l'indice est proposé. */
const HINT_AFTER_FAILURES = 3;

export interface UnlockProps {
  /** Bascule vers l'écran de récupération par phrase. */
  onForgotPassword: () => void;
}

export default function Unlock({ onForgotPassword }: UnlockProps) {
  const { status, unlock, unlockWithPin } = useLock();
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Le PIN n'est proposé que si ce poste ET cette base le connaissent tous les
  // deux ; le backend l'a déjà vérifié, c'est tout ce que `pin_available` dit.
  const pinAvailable = status?.pin_available ?? false;
  const [usePin, setUsePin] = useState(pinAvailable);

  // Le dixième essai manqué désactive le PIN de ce poste : le champ doit alors
  // disparaître sous les doigts de l'enseignant, sans qu'il ait à comprendre
  // pourquoi sa saisie n'aboutit plus. C'est ce que fait cet effet, et c'est la
  // raison pour laquelle `unlockWithPin` relit l'état du verrou avant de
  // laisser remonter l'erreur.
  useEffect(() => {
    if (!pinAvailable) {
      setUsePin(false);
      setPin("");
    }
  }, [pinAvailable]);

  // L'indice vient de `data/sgpa.keys`, le seul fichier lisible avant que la
  // clé maître ne soit déballée. Rien d'autre de cette base n'est affichable
  // ici : ni le nom de l'enseignant, ni le nom de l'établissement.
  const hint = status?.password_hint?.trim() ?? "";
  // L'indice porte sur le mot de passe : l'afficher pendant une saisie de PIN
  // n'aiderait personne, et ne ferait que l'exposer un peu plus. Les essais de
  // PIN, eux, sont comptés par le backend — c'est son message qui dit combien
  // il en reste.
  const showHint =
    !usePin && failures >= HINT_AFTER_FAILURES && hint.length > 0;

  const fail = (err: unknown) => {
    setError(err instanceof Error ? err.message : String(err));
  };

  const submitPassword = async () => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      // Le mot de passe n'est jamais « trimé » : c'est lui qui dérive la clé,
      // un espace de fin en fait partie.
      await unlock(password);
    } catch (err) {
      fail(err);
      setFailures((n) => n + 1);
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  };

  const submitPin = async (code: string) => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await unlockWithPin(code);
    } catch (err) {
      fail(err);
      // Vidé sans faute : le champ se valide tout seul au sixième chiffre, et
      // un code resté en place relancerait aussitôt le même essai manqué.
      setPin("");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (usePin) {
      if (pin.length === PIN_LENGTH) void submitPin(pin);
      return;
    }
    void submitPassword();
  };

  const switchMode = (toPin: boolean) => {
    setUsePin(toPin);
    setError(null);
    setPin("");
    setPassword("");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 py-10">
      <Card className="mx-4 w-full max-w-md">
        <CardHeader className="space-y-4 text-center">
          <div className="flex items-center justify-center gap-3">
            <div className="rounded-lg bg-primary p-2">
              <Lock className="h-7 w-7 text-primary-foreground" />
            </div>
            <CardTitle className="text-3xl font-bold tracking-tight">
              SGPA
            </CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            Base chiffrée. Le mot de passe en est la clé.
          </p>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {usePin ? (
              // `key` pour que React remonte le champ au changement de mode :
              // sans elle il réutilise le même <input>, et `autoFocus` ne
              // rejoue pas — basculer vers le PIN laisserait le curseur sur le
              // bouton qu'on vient de cliquer.
              <div key="pin" className="space-y-3">
                <Label htmlFor="pin" className="block text-center">
                  Code PIN
                </Label>
                <PinInput
                  id="pin"
                  value={pin}
                  onChange={setPin}
                  onComplete={(code) => void submitPin(code)}
                  masked={!reveal}
                  // Rouge seulement tant que rien n'est retapé : le
                  // message, lui, reste — c'est lui qui annonce combien
                  // d'essais restent avant que le PIN de ce poste ne saute.
                  invalid={error !== null && pin.length === 0}
                  autoFocus
                  disabled={submitting}
                  label={`Code PIN à ${PIN_LENGTH} chiffres`}
                  className="mx-auto"
                />
                <button
                  type="button"
                  onClick={() => setReveal((v) => !v)}
                  className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  {reveal ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                  {reveal ? "Masquer les chiffres" : "Afficher les chiffres"}
                </button>
                <p className="text-xs text-muted-foreground">
                  Ce code ne vaut que sur cet ordinateur et sous votre compte
                  Windows : la moitié de son secret y est restée, elle ne suit
                  pas la clé USB.
                </p>
              </div>
            ) : (
              <div key="password" className="space-y-2">
                <Label htmlFor="password">Mot de passe</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={reveal ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Saisissez votre mot de passe"
                    className="pr-10"
                    autoFocus
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setReveal((v) => !v)}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                    aria-label={
                      reveal
                        ? "Masquer le mot de passe"
                        : "Afficher le mot de passe"
                    }
                  >
                    {reveal ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <p className="whitespace-pre-line rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            {showHint && (
              <p className="flex items-start gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <span className="font-medium text-foreground">Indice : </span>
                  {hint}
                </span>
              </p>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={
                submitting ||
                (usePin ? pin.length < PIN_LENGTH : password.length === 0)
              }
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Déverrouiller
            </Button>

            <div className="flex flex-col items-center gap-1.5">
              {pinAvailable && (
                <button
                  type="button"
                  onClick={() => switchMode(!usePin)}
                  className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  {usePin
                    ? "Utiliser le mot de passe"
                    : "Utiliser le code PIN de ce poste"}
                </button>
              )}
              <button
                type="button"
                onClick={onForgotPassword}
                className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Mot de passe oublié ?
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
