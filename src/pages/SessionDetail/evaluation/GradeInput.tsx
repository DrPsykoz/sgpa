import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Ban } from "lucide-react";
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
  /** La note enregistrée. `null` = case vierge — ce n'est ni une note basse,
   *  ni zéro, et depuis le palier 022 ce n'est plus **un seul** état : la case
   *  vide est **en attente** tant que `waived` est faux. */
  value: number | null;
  /** La case est déclarée « cet élève ne sera pas évalué sur cette
   *  compétence ». Elle n'a pas de note et n'en aura pas : la saisie est
   *  fermée, et c'est la déclaration qu'il faut retirer pour la rouvrir. */
  waived: boolean;
  /** Identifie le couple noté, p. ex. « DUPONT Léa — Lire à voix haute ». */
  label: string;
  /** Appelé avec une note entière valide, et seulement si elle change. */
  onChange: (mark: number) => void;
  /** Appelé quand l'enseignant vide la case : la note est effacée. */
  onClear: () => void;
  /** Pose (`true`) ou retire (`false`) la déclaration « ne sera pas évaluée ».
   *  Geste réversible d'un clic, dans les deux sens. */
  onWaive: (waived: boolean) => void;
  /** Remonte un refus de saisie à la barre d'erreur de l'écran. Il n'y en a
   *  qu'une pour toute la grille : un message par cellule déplacerait les
   *  quatre-vingt-dix lignes du tableau à chaque frappe. */
  onRefus: (message: string) => void;
}

/**
 * La saisie d'une note sur 20, dans une cellule de la grille, avec son libellé
 * de maîtrise affiché à côté.
 *
 * **Trois états, et non deux** (palier 022). Une case porte une note, ou elle
 * est **en attente**, ou elle est déclarée **« ne sera pas évaluée »**. Les
 * deux derniers n'ont pas de note et sortent tous deux de la moyenne — ce qui
 * les sépare n'est pas un calcul mais une intention, et c'est exactement ce
 * que l'enseignant a demandé de pouvoir dire : « différencier une évaluation
 * en attente d'une qui ne sera jamais faite ». Le mot à côté du champ est donc
 * la seule chose qui distingue deux cases identiquement vides.
 *
 * **Les deux sens du geste n'ont pas la même forme, et c'est voulu.** « En
 * attente » était un bouton dont le libellé nommait l'**état** et non
 * l'action : rien ne disait qu'on pouvait cliquer, son filet n'apparaissait
 * qu'au survol, et l'enseignant l'a signalé le 2026-11-12 — « on ne voit pas
 * vraiment qu'on peut cliquer ». Le mot est redevenu du **texte**, et l'action
 * a son propre **bouton visible au repos**, avec son icône barrée. Dans
 * l'autre sens il n'y a rien à ajouter : une case déjà déclarée porte un
 * cartouche à filet pointillé qui, lui, se voit, et c'est lui qui défait la
 * déclaration. Un second bouton à côté aurait élargi toutes les colonnes de la
 * grille pour redire ce que le cartouche dit déjà.
 *
 * **La note l'emporte toujours.** Une case notée n'affiche pas le geste de
 * déclaration : son libellé de maîtrise n'est pas un bouton, et le backend
 * refuserait de toute façon (`set_grade_waiver`). Pour déclarer, il faut
 * d'abord effacer — un geste conscient, qui ne peut pas arriver par un clic
 * à côté.
 *
 * **Un seul arrêt de tabulation par cellule**, dans les trois états : le champ
 * quand il est ouvert, le cartouche quand le champ est fermé. Une grille de
 * trente élèves sur huit compétences en compte déjà deux cent quarante — les
 * doubler rendrait le clavier inutilisable. Le bouton barré est donc hors
 * tabulation (`tabIndex={-1}`), et c'est la touche **N** qui le remplace au
 * clavier : elle déclare depuis le champ vide, là où les doigts sont déjà.
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
  waived,
  label,
  onChange,
  onClear,
  onWaive,
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
    // « N » comme « ne sera pas évaluée », et seulement sur une case vide de
    // tout : le champ ne garde que des chiffres, donc cette lettre n'y a aucun
    // autre sens, et elle ne peut pas écraser une saisie en cours.
    if (
      (event.key === "n" || event.key === "N") &&
      value === null &&
      texte.trim() === ""
    ) {
      event.preventDefault();
      onWaive(true);
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
        disabled={waived}
        title={
          waived
            ? "Cette case est déclarée « ne sera pas évaluée ». Retirez la déclaration pour saisir une note."
            : undefined
        }
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
          waived && "cursor-not-allowed border-dashed opacity-60",
        )}
      />
      {niveau === null ? (
        // Pas de couleur ici — un état « rien à noter » n'est ni bon ni
        // mauvais, et les quatre aplats de l'échelle ne parlent que de
        // maîtrise. Le filet pointillé est le seul signe, et il suit la même
        // règle que les cartes de calendrier : franc quand la chose existe,
        // pointillé quand elle est seulement déclarée.
        waived ? (
          // La déclaration se défait d'un clic sur son propre cartouche, qui
          // porte déjà un filet visible au repos. C'est l'unique arrêt de
          // tabulation de la cellule, le champ étant fermé.
          <button
            type="button"
            tabIndex={0}
            aria-label={
              label + " — ne sera pas évaluée ; revenir à « en attente »"
            }
            title="Déclarée « ne sera pas évaluée » : elle ne compte pas dans la moyenne et s'imprime ainsi sur la feuille. Cliquez pour revenir à « en attente »."
            onClick={() => onWaive(false)}
            className={cn(
              "whitespace-nowrap rounded border border-dashed border-border px-1.5 py-0.5",
              "text-[10px] font-medium leading-tight text-muted-foreground",
              "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            ne sera pas évaluée
          </button>
        ) : (
          <>
            {/* L'état se lit, il ne se clique pas : nommer l'état sur un
                bouton revenait à demander à l'enseignant de deviner que
                cliquer « en attente » déclare le contraire. */}
            <span className="whitespace-nowrap px-0.5 text-[10px] leading-tight text-muted-foreground">
              en attente
            </span>
            {/* L'action, elle, a son bouton, visible au repos. Hors
                tabulation : la touche N le remplace au clavier. */}
            <button
              type="button"
              tabIndex={-1}
              aria-label={label + " — déclarer « ne sera pas évaluée »"}
              title="Déclarer que cet élève ne sera pas évalué sur cette compétence (touche N). La case sort de sa moyenne et la feuille remise à l'élève imprimera « non évalué »."
              onClick={() => onWaive(true)}
              className={cn(
                "grid h-6 w-6 shrink-0 place-items-center rounded",
                "border border-border bg-background text-muted-foreground",
                "hover:bg-muted hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <Ban className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </>
        )
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
