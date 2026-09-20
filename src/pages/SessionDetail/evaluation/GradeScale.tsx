import { useRef, type KeyboardEvent } from "react";
import type { MasteryLevel } from "@/types";
import { MASTERY_COLORS, MASTERY_LABELS, MASTERY_LEVELS, MASTERY_SHORT } from "@/types";
import { cn } from "@/lib/utils";

/** Couleur du niveau au survol d'un carré non retenu : l'enseignant voit ce
 *  qu'il s'apprête à poser avant de cliquer. Les variantes `hover:` sont
 *  écrites en toutes lettres — Tailwind lit le code source et ne sait pas
 *  préfixer les classes de `MASTERY_COLORS` à la volée. */
const MASTERY_HOVER: Record<MasteryLevel, string> = {
  0: "hover:bg-gray-200 hover:text-gray-600",
  1: "hover:bg-red-100 hover:text-red-700",
  2: "hover:bg-orange-100 hover:text-orange-700",
  3: "hover:bg-yellow-100 hover:text-yellow-700",
  4: "hover:bg-green-100 hover:text-green-700",
  5: "hover:bg-emerald-100 hover:text-emerald-800",
};

interface GradeScaleProps {
  /** Niveau retenu. 0 (« non évalué ») est l'état d'une case vierge. */
  value: MasteryLevel;
  /** Identifie le couple noté, p. ex. « DUPONT Léa — Lire à voix haute ». */
  label: string;
  /** Appelé uniquement quand le niveau change réellement. */
  onChange: (level: MasteryLevel) => void;
}

/**
 * Les six niveaux de l'échelle, en carrés, dans une cellule de la grille.
 *
 * C'est la surface de saisie principale de l'écran de notation : elle remplace
 * un `<select>`, qui était nativement accessible. Six `<div>` cliquables
 * auraient été une régression, d'où un vrai groupe de boutons radio —
 * `role="radiogroup"`, `aria-checked`, flèches, et **un seul point d'entrée au
 * Tab par cellule** (`tabIndex` mouvant). Sans ce dernier, tabuler dans une
 * classe de quinze élèves sur six compétences demanderait 540 pressions.
 */
export function GradeScale({ value, label, onChange }: GradeScaleProps) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  /** Déplace le focus ET écrit : c'est le comportement attendu d'un groupe
   *  radio, où la sélection suit la flèche. */
  const selectAt = (index: number) => {
    const level = MASTERY_LEVELS[index];
    buttons.current[index]?.focus();
    if (level !== value) onChange(level);
  };

  /**
   * **L'échelle BUTE à ses extrémités, elle ne boucle pas.** Un groupe radio
   * boucle d'ordinaire ; ici, boucler efface une note.
   *
   * Mesuré : une case à « Maîtrise insuffisante », flèche droite maintenue pour
   * atteindre « Très bonne maîtrise ». L'auto-répétition du clavier envoie une
   * trentaine de pressions par seconde ; arrivé au dernier niveau, la suivante
   * repart sur le premier — c'est-à-dire sur « Non évalué », et
   * `api.setGrade(…, 0)` efface la note en base. Le `<select>` que ce composant
   * remplace ne pouvait pas faire ça : une liste déroulante s'arrête sur sa
   * dernière option.
   *
   * `Home` et `End` gardent leur comportement normal, y compris `Home` qui
   * ramène à « Non évalué » : on presse `Home` exprès, on ne l'atteint pas par
   * dépassement.
   */
  const moveBy = (delta: number) => {
    const current = MASTERY_LEVELS.indexOf(value);
    const vise = Math.min(
      Math.max(current + delta, 0),
      MASTERY_LEVELS.length - 1,
    );
    if (vise !== current) selectAt(vise);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        moveBy(-1);
        break;
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        moveBy(1);
        break;
      case "Home":
        event.preventDefault();
        selectAt(0);
        break;
      case "End":
        event.preventDefault();
        selectAt(MASTERY_LEVELS.length - 1);
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className="flex items-center justify-center gap-0.5"
    >
      {MASTERY_LEVELS.map((level, index) => {
        const selected = level === value;
        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={selected}
            // L'abréviation ne se devine pas : le libellé complet reste lisible
            // au lecteur d'écran comme à la souris.
            aria-label={MASTERY_LABELS[level]}
            title={MASTERY_LABELS[level]}
            tabIndex={selected ? 0 : -1}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            onClick={() => {
              if (!selected) onChange(level);
            }}
            className={cn(
              "relative h-7 w-7 shrink-0 cursor-pointer rounded border text-[10px] font-semibold leading-none transition-colors",
              // Focus visible, et distinct de la sélection : celle-ci est un
              // remplissage, celui-là un anneau. Le `z-10` évite que l'anneau
              // passe sous le carré voisin.
              "focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              // Seul le carré retenu porte sa couleur. Six carrés colorés par
              // cellule × quinze élèves × cinq compétences feraient 450 taches
              // de couleur sur le même écran, et l'enseignant n'y lirait plus
              // rien : la couleur signale le niveau RETENU, pas l'existence de
              // l'échelle. C'est ce qui garde au tableau sa seule vertu — voir
              // d'un coup d'œil qui est où.
              selected
                ? cn(
                    MASTERY_COLORS[level],
                    // « Non évalué » est l'état de toute case vierge : retenu,
                    // il reste un contour pointillé sur fond gris, pour ne
                    // jamais se lire comme une note saisie.
                    level === 0
                      ? "border-dashed border-gray-400/70"
                      : "border-transparent shadow-sm",
                  )
                : cn(
                    "border-border bg-transparent text-muted-foreground/70",
                    MASTERY_HOVER[level],
                  ),
            )}
          >
            {MASTERY_SHORT[level]}
          </button>
        );
      })}
    </div>
  );
}
