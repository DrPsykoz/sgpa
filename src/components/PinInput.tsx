import { useRef, useState } from "react";
import { digitsOnly, PIN_LENGTH } from "@/lib/password";
import { cn } from "@/lib/utils";

export interface PinInputProps {
  /** Repris par le `<label htmlFor>` de l'appelant. */
  id?: string;
  value: string;
  /** Reçoit toujours des chiffres, et jamais plus de `PIN_LENGTH` : le filtrage
   *  vit ici pour qu'aucun appelant ne puisse l'oublier. */
  onChange: (value: string) => void;
  /** Appelé au dernier chiffre. Sur l'écran de déverrouillage, c'est lui qui
   *  valide : personne ne cherche la touche Entrée après six chiffres tapés sur
   *  un pavé numérique. */
  onComplete?: (value: string) => void;
  /** Affiche des points au lieu des chiffres. */
  masked?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Teinte les cases en rouge après un refus. */
  invalid?: boolean;
  /** Nom du champ pour les lecteurs d'écran : les cases, elles, sont masquées. */
  label: string;
  className?: string;
}

/**
 * Six cases, **un seul champ**.
 *
 * Les cases ne sont que du décor : l'`<input>` réel est posé par-dessus,
 * transparent, et tient la valeur entière. Six champs séparés obligeraient à
 * déplacer le focus de l'un à l'autre à chaque frappe, et c'est cette
 * gymnastique qui casse — le collage d'un code copié, la touche Retour arrière
 * qui doit reculer d'une case, la saisie vocale, les lecteurs d'écran qui
 * annoncent six champs sans nom. Un champ unique n'a aucun de ces problèmes et
 * garde exactement le même rendu.
 */
export function PinInput({
  id,
  value,
  onChange,
  onComplete,
  masked = true,
  autoFocus,
  disabled,
  invalid,
  label,
  className,
}: PinInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  // La case « en cours » : la première vide, ou la dernière quand le code est
  // complet — le trait clignotant ne doit pas sortir de la rangée.
  const caret = Math.min(value.length, PIN_LENGTH - 1);

  /** Le curseur revient en fin de saisie. Dans un champ invisible, un caret
   *  laissé au milieu par un clic ferait insérer le chiffre suivant là où
   *  personne ne l'a demandé, et les cases afficheraient autre chose que ce que
   *  l'enseignant croit avoir tapé. */
  const toEnd = () => {
    const el = inputRef.current;
    if (el) el.setSelectionRange(el.value.length, el.value.length);
  };

  const handleChange = (raw: string) => {
    const code = digitsOnly(raw);
    onChange(code);
    if (code.length === PIN_LENGTH) onComplete?.(code);
  };

  return (
    <div className={cn("relative w-fit", className)}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => {
          setFocused(true);
          toEnd();
        }}
        onBlur={() => setFocused(false)}
        onClick={toEnd}
        inputMode="numeric"
        autoComplete="off"
        maxLength={PIN_LENGTH}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={label}
        aria-invalid={invalid || undefined}
        className="absolute inset-0 z-10 h-full w-full cursor-default rounded-md opacity-0 outline-none disabled:cursor-not-allowed"
      />
      <div className="flex gap-2" aria-hidden="true">
        {Array.from({ length: PIN_LENGTH }, (_, index) => {
          const filled = index < value.length;
          const active = focused && !disabled && index === caret;
          return (
            <div
              key={index}
              className={cn(
                "flex h-12 w-10 items-center justify-center rounded-md border bg-background font-mono text-xl transition-colors",
                invalid
                  ? "border-destructive text-destructive"
                  : active
                    ? "border-primary ring-2 ring-primary/25"
                    : "border-input",
                disabled && "opacity-50",
              )}
            >
              {filled ? (
                masked ? (
                  <span className="text-2xl leading-none">•</span>
                ) : (
                  value[index]
                )
              ) : active ? (
                <span className="h-5 w-px animate-pulse bg-foreground" />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
