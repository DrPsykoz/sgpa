import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { labelDeNote, MARK_MAX, MARK_MIN, niveauDeNote } from "@/types";
import { MASTERY_COLORS } from "@/types";
import { cn } from "@/lib/utils";

/** Ce que l'enseignant lit quand il tape autre chose qu'un entier. Les deux
 *  messages vivent ici, à côté du filtre qui les déclenche. */
const REFUS_NON_ENTIER =
  "La note est un nombre entier : ni virgule, ni décimale.";
const refusHorsBareme = (saisie: string) =>
  `« ${saisie} » n'est pas une note : elle doit être comprise entre ${MARK_MIN} et ${MARK_MAX}.`;

interface GradeInputProps {
  /** La note enregistrée. `null` = case vierge, c'est-à-dire **non évaluée** —
   *  ce n'est pas une note basse, et ce n'est surtout pas zéro. */
  value: number | null;
  /** Identifie le couple noté, p. ex. « DUPONT Léa — Lire à voix haute ». */
  label: string;
  /** Appelé avec une note entière valide, et seulement si elle change. */
  onChange: (mark: number) => void;
  /** Appelé quand l'enseignant vide la case : la note est effacée. */
  onClear: () => void;
  /** Remonte un refus de saisie à la barre d'erreur de l'écran. Il n'y en a
   *  qu'une pour toute la grille : un message par cellule déplacerait les
   *  quatre-vingt-dix lignes du tableau à chaque frappe. */
  onRefus: (message: string) => void;
}

/**
 * La saisie d'une note sur 20, dans une cellule de la grille, avec son libellé
 * de maîtrise affiché à côté.
 *
 * **Elle remplace les six carrés de `GradeScale`, et le sens de lecture est
 * inversé.** L'enseignant cliquait un degré de maîtrise et la note s'en
 * déduisait ; il saisit maintenant la note, et c'est le degré qui s'en déduit
 * (palier 018). Le libellé n'est donc plus une entrée mais une **relecture** :
 * il confirme sur place ce que le chiffre veut dire, sans que l'enseignant ait
 * à retenir les bornes des tranches.
 *
 * Trois choses que la saisie libre impose, et qui sont traitées ici :
 *
 *   * **l'écriture part au `blur`, pas à la frappe.** Taper « 14 » passe par
 *     l'état « 1 » : écrire à chaque frappe enregistrerait d'abord 1/20, donc
 *     une note fausse — brièvement visible par un autre écran, et durablement
 *     en base si l'enseignant s'interrompt là. `Entrée` commet aussi, pour qui
 *     ne quitte pas le champ à la souris.
 *   * **une case vidée EFFACE la note**, par `onClear`, et non par une note
 *     conventionnelle. 0 n'existe pas, et « non évalué » est l'absence de
 *     ligne.
 *   * **le champ refuse tout ce qui n'est pas un chiffre**, virgule comprise
 *     (« entiers seulement », décision de l'auteur) — et il le DIT. Un
 *     caractère avalé en silence se relit comme une touche morte, et
 *     l'enseignant réessaie trois fois avant de comprendre.
 */
export function GradeInput({
  value,
  label,
  onChange,
  onClear,
  onRefus,
}: GradeInputProps) {
  const [texte, setTexte] = useState(value === null ? "" : String(value));
  const focus = useRef(false);

  /** Resynchronise sur la valeur du parent, mais **jamais pendant la frappe**.
   *  Le parent écrit de façon optimiste puis défait la case en cas d'échec :
   *  sans le garde de focus, ce retour en arrière réécrirait sous les doigts de
   *  l'enseignant le chiffre qu'il est en train de corriger. */
  useEffect(() => {
    if (focus.current) return;
    setTexte(value === null ? "" : String(value));
  }, [value]);

  const saisir = (brut: string) => {
    const chiffres = brut.replace(/\D/g, "");
    if (chiffres !== brut) onRefus(REFUS_NON_ENTIER);
    // Deux chiffres suffisent à 20 ; au-delà, c'est une faute de frappe qu'il
    // vaut mieux arrêter avant qu'elle ne devienne un refus.
    setTexte(chiffres.slice(0, 2));
  };

  const valider = () => {
    const brut = texte.trim();
    if (brut === "") {
      if (value !== null) onClear();
      return;
    }
    const note = Number(brut);
    if (!Number.isInteger(note) || note < MARK_MIN || note > MARK_MAX) {
      onRefus(refusHorsBareme(brut));
      // On rend la case à son contenu enregistré : la note refusée ne doit pas
      // rester affichée comme si elle avait été retenue.
      setTexte(value === null ? "" : String(value));
      return;
    }
    if (note !== value) onChange(note);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      valider();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setTexte(value === null ? "" : String(value));
    }
  };

  const niveau = value === null ? null : niveauDeNote(value);

  return (
    <div className="flex items-center justify-center gap-1.5">
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={label}
        value={texte}
        onChange={(event) => saisir(event.target.value)}
        onFocus={() => {
          focus.current = true;
        }}
        onBlur={() => {
          focus.current = false;
          valider();
        }}
        onKeyDown={handleKeyDown}
        // `select()` au focus : l'enseignant qui corrige une note tape le
        // nouveau chiffre par-dessus l'ancien, il n'efface pas d'abord.
        onClick={(event) => event.currentTarget.select()}
        className={cn(
          "h-7 w-10 shrink-0 rounded border border-border bg-background text-center",
          "text-sm font-semibold tabular-nums",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          value === null && "text-muted-foreground",
        )}
      />
      {niveau === null ? (
        // Un mot, pas un dessin : la case vierge dit en clair qu'elle n'est pas
        // une note basse.
        <span className="whitespace-nowrap text-[10px] leading-tight text-muted-foreground">
          non évaluée
        </span>
      ) : (
        <span
          className={cn(
            "whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight",
            MASTERY_COLORS[niveau],
          )}
        >
          {labelDeNote(value as number)}
        </span>
      )}
    </div>
  );
}
