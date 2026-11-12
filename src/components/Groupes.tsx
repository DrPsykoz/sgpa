import type { ReactElement, ReactNode } from "react";
import { Users } from "lucide-react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { StudentGroup } from "@/types";

/**
 * Sentinelle « toute la classe » pour les sélecteurs.
 *
 * Radix refuse la chaîne vide comme valeur d'un `SelectItem`, et `null` ne
 * traverse pas un `<Select>`. Elle vit **ici et pas dans chaque écran** : sept
 * dialogues posent la même question, et sept sentinelles écrites séparément
 * auraient fini par diverger — c'est la raison qui fait déjà partager
 * `journee.ts` entre les deux calendriers. Elle ne quitte jamais le front :
 * `group_id` part toujours à `null`.
 */
export const TOUTE_LA_CLASSE = "toute-la-classe";

/** La valeur du sélecteur depuis un `group_id`, et l'inverse. */
export function valeurDeGroupe(groupId: string | null): string {
  return groupId ?? TOUTE_LA_CLASSE;
}

export function groupeDeValeur(valeur: string): string | null {
  return valeur === TOUTE_LA_CLASSE ? null : valeur;
}

/**
 * « Cet élève est-il concerné ? » — le prédicat de groupe du backend, en
 * TypeScript.
 *
 * ⚠ **C'est le sixième exemplaire d'une même règle**, et il doit dire
 * exactement ce que disent les cinq requêtes SQL (`reports.rs`, `timetable.rs`,
 * `home.rs`, `seances.rs`, `absences.rs`) : `porteur IS NULL OR élève IS NULL
 * OR porteur = élève`. Un écran qui filtrerait autrement que le bilan donnerait
 * deux vérités sur la même absence, ou noterait un élève que la moyenne ne
 * compte pas.
 *
 * Ses deux `null` ne disent pas la même chose, et c'est voulu : une séance ou
 * une évaluation **sans groupe** concerne la classe entière ; un élève **sans
 * groupe** n'est rangé nulle part, donc il est partout — un oubli de
 * répartition se voit ainsi à l'appel, au lieu de disparaître des calculs.
 *
 * Il ne remplace pas le filtre du backend, qui reste la seule implémentation
 * qui compte : il sert aux écrans qui tiennent déjà la liste complète des
 * élèves en mémoire et n'ont pas à la redemander.
 */
export function concerneLeGroupe(
  porteur: string | null,
  eleve: string | null,
): boolean {
  return porteur === null || eleve === null || porteur === eleve;
}

/**
 * Le nom du groupe en pastille, sur une carte de calendrier ou dans une liste.
 *
 * **Pâle et non pleine, à l'inverse de `PastilleDeCategorie`** : une catégorie
 * de rendez-vous doit se lire avant l'intitulé qu'elle porte — « alerte à la
 * bombe » n'apporte rien si on la lit en dernier —, alors qu'un groupe précise
 * un cours sans le remplacer. Et c'est aussi ce qui tient la règle « un seul
 * aplat de couleur dans l'application » : la pastille de catégorie reste la
 * seule, celle-ci n'est qu'un filet.
 *
 * Elle rend `null` sur `null` et sur `""` — « toute la classe » est le cas
 * normal, et l'écrire sur chaque carte ferait du bruit sur les quatre
 * cinquièmes de la grille. L'appelant n'a donc rien à tester avant d'appeler.
 */
export function PastilleDeGroupe({
  groupName,
  className,
}: {
  groupName: string | null;
  className?: string;
}): ReactElement | null {
  if (!groupName) return null;
  return (
    <span
      className={cn(
        // `max-w-full` + `truncate` : quarante caractères ne tiennent pas dans
        // une case de calendrier, et une pastille qui déborde peindrait
        // par-dessus le jour suivant.
        "inline-block max-w-full truncate rounded-sm border border-current/40 px-1 py-px text-[10px] font-medium leading-snug",
        className,
      )}
    >
      {groupName}
    </span>
  );
}

/**
 * Les entrées d'un sélecteur de groupe : « Toute la classe », puis les groupes.
 *
 * Extraites parce que deux formes du même choix cohabitent — le champ de
 * formulaire ci-dessous, et le sélecteur nu d'une cellule de tableau, qui n'a
 * de place ni pour un libellé ni pour une phrase d'aide. Une seule liste
 * d'options pour les deux : sans cela, l'entrée « Groupe supprimé » n'existerait
 * que d'un côté, et le tableau afficherait une case vide là où le formulaire
 * explique.
 */
export function OptionsDeGroupe({
  groups,
  value,
  libelleToute = "Toute la classe",
  nomDeSecours = null,
}: {
  groups: StudentGroup[];
  value: string | null;
  libelleToute?: string;
  nomDeSecours?: string | null;
}): ReactElement {
  return (
    <>
      <SelectItem value={TOUTE_LA_CLASSE}>{libelleToute}</SelectItem>
      {groups.map((group) => (
        <SelectItem key={group.id} value={group.id}>
          {group.name}
        </SelectItem>
      ))}
      {/* Le groupe choisi n'est pas dans la liste, pour l'une de deux raisons
          qui ne se ressemblent pas. Soit il a été supprimé depuis une autre
          fenêtre du même écran — et sans cette entrée, Radix afficherait un
          champ vide, puis l'enregistrement renverrait « Groupe introuvable »
          sans que rien ne dise lequel. Soit la liste n'est **pas encore
          arrivée** : les écrans qui la chargent à la demande (`useGroupesDeClasse`)
          passent par une liste vide d'une durée d'un battement, et écrire
          « Groupe supprimé » à ce moment-là aurait fait clignoter une fausse
          alarme à chaque ouverture d'un créneau d'atelier. D'où `nomDeSecours`,
          que ces écrans tiennent déjà (`slot.group_name`) : quand le nom est
          connu, on l'écrit, et la disparition n'est annoncée que si personne ne
          sait plus le nommer. */}
      {value !== null && !groups.some((group) => group.id === value) && (
        <SelectItem value={value}>
          {nomDeSecours ?? "Groupe supprimé"}
        </SelectItem>
      )}
    </>
  );
}

export interface SelecteurDeGroupeProps {
  /** Les groupes de CETTE classe. Le parent détient la liste (règle 1) : un
   *  groupe d'une autre classe serait refusé en Rust, il n'est pas proposé. */
  groups: StudentGroup[];
  /** `null` = toute la classe. */
  value: string | null;
  onChange: (groupId: string | null) => void;
  /** Identifiant du `<SelectTrigger>`, pour que le `<Label>` le désigne. */
  id: string;
  disabled?: boolean;
  /** Phrase d'aide sous le champ. Elle change d'un écran à l'autre parce que
   *  l'effet change : une séance de groupe retire les autres du dénominateur,
   *  un créneau ne fait que préparer les séances à venir. */
  aide?: ReactNode;
  label?: string;
  /** Le nom déjà connu de `value`, quand l'appelant le tient d'ailleurs que de
   *  `groups` — voir `OptionsDeGroupe`. */
  nomDeSecours?: string | null;
}

/**
 * « Quel groupe ? », partout où la question se pose.
 *
 * **Rend `null` quand la classe n'a aucun groupe et que rien n'est choisi** :
 * un champ qui ne peut répondre que « toute la classe » n'apprend rien et
 * allonge six formulaires. Dès qu'un groupe existe, il apparaît partout d'un
 * coup. Si une valeur est posée — cas d'un groupe supprimé entre-temps — le
 * champ reste affiché pour que l'enseignant puisse la retirer, jamais une
 * valeur invisible.
 */
export function SelecteurDeGroupe({
  groups,
  value,
  onChange,
  id,
  disabled = false,
  aide,
  label = "Groupe",
  nomDeSecours = null,
}: SelecteurDeGroupeProps): ReactElement | null {
  if (groups.length === 0 && value === null) return null;

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="flex items-center gap-1.5">
        <Users className="h-3.5 w-3.5 text-muted-foreground" />
        {label}
      </Label>
      <Select
        value={valeurDeGroupe(value)}
        onValueChange={(valeur) => onChange(groupeDeValeur(valeur))}
        disabled={disabled}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <OptionsDeGroupe
            groups={groups}
            value={value}
            nomDeSecours={nomDeSecours}
          />
        </SelectContent>
      </Select>
      {aide && <p className="text-xs text-muted-foreground">{aide}</p>}
    </div>
  );
}
