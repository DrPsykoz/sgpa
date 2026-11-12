/**
 * Les quatre règles de saisie que les **deux** référentiels partagent.
 *
 * Il y en a deux depuis le palier 024 : celui des **compétences** (cycle →
 * domaine → champ → compétence) et celui des **activités professionnelles**
 * (champ → domaine d'activité → activités de référence et métiers). Ils se
 * remplissent exactement de la même façon — on colle une liste prise dans un
 * document officiel, on renomme, on réordonne —, et ces fonctions-là sont
 * celles qui doivent dire la même chose des deux côtés.
 *
 * C'est la raison qui fait déjà partager `journee.ts` entre `WeekGrid` et
 * `DaysCalendar`, et `FriseEntetes.tsx` entre les deux frises : deux
 * implémentations divergeraient au premier détail, et ici le détail est
 * invisible — un espace insécable laissé en place crée un doublon que
 * l'enseignant voit comme une ligne en double sans comprendre pourquoi
 * l'application ne l'a pas vu.
 */

/** « 3 compétences », « 1 compétence ». Le français met le pluriel à partir
 *  de deux : `n > 1`, et non `n !== 1` — « 0 compétence » s'écrit au
 *  singulier. */
export const plural = (n: number, one: string, many: string) =>
  `${n} ${n > 1 ? many : one}`;

/**
 * Word, les PDF et les tableurs collent des espaces insécables (U+00A0,
 * U+202F) et des tabulations. Sans cette normalisation, `trim()` laisse le
 * blanc invisible en place et la déduplication échoue dessus : on obtient deux
 * entrées visuellement identiques.
 */
export function normalizeNames(lines: string[]): string[] {
  return lines
    .map((line) =>
      line
        .replace(/[\u00a0\u202f]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => line.length > 0);
}

/** Le backend ne dédoublonne que contre l'existant ; le texte collé peut, lui,
 *  se répéter (colonne de tableur recopiée). On filtre donc aussi la liste. */
export function dedupeNames(names: string[]): {
  unique: string[];
  duplicates: string[];
} {
  const seen = new Set<string>();
  const unique: string[] = [];
  const duplicates: string[] = [];
  for (const name of names) {
    const key = name.toLocaleLowerCase("fr-FR");
    if (seen.has(key)) duplicates.push(name);
    else {
      seen.add(key);
      unique.push(name);
    }
  }
  return { unique, duplicates };
}

/**
 * Échange le nœud avec son voisin *visible*, mais renvoie l'ordre complet du
 * niveau : `reorder_nodes` comme `reorder_activity_nodes` réécrivent toutes
 * les positions, et une liste amputée des compétences archivées les
 * repousserait en fin de liste.
 */
export function reorderIds(
  all: { id: string }[],
  visible: { id: string }[],
  id: string,
  direction: -1 | 1,
): string[] | null {
  const from = visible.findIndex((n) => n.id === id);
  if (from === -1) return null;
  const neighbour: { id: string } | undefined = visible[from + direction];
  if (!neighbour) return null;
  const next = all.map((n) => n.id);
  const a = next.indexOf(id);
  const b = next.indexOf(neighbour.id);
  if (a === -1 || b === -1) return null;
  next[a] = neighbour.id;
  next[b] = id;
  return next;
}
