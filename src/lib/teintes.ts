/**
 * Une teinte par classe.
 *
 * Avec quatre classes dans la même semaine, la grille de l'emploi du temps
 * demandait de relire chaque intitulé pour savoir à qui appartient une case.
 * Une teinte par classe fait lire la semaine d'un coup d'œil. Les dix teintes
 * et leur déclinaison par thème vivent dans `src/index.css` ; ce module ne fait
 * qu'une chose : décider QUELLE classe reçoit QUELLE teinte.
 *
 * **L'attribution ne vient pas d'une empreinte de l'identifiant.** C'était la
 * solution la plus courte — un hachage de l'`id`, stable, sans état — et elle
 * est fausse : sur dix teintes, quatre classes tirées au hasard tombent sur une
 * couleur commune une fois sur deux (1 − 10·9·8·7/10⁴ ≈ 0,50). Or deux classes
 * de la même couleur ôtent au dispositif sa seule raison d'être.
 *
 * L'attribution est donc **positionnelle**, et numérotée par année scolaire :
 * les classes d'une même année sont triées, puis reçoivent 1, 2, 3… Les quatre
 * classes de l'enseignant reçoivent ainsi les quatre premières teintes, que la
 * roue de `index.css` a rangées pour être les plus éloignées possible — bleu,
 * ambre, violet, vert.
 *
 * Le tri est fait sur `level_code` puis `name` puis `id`, et non sur
 * `created_at` : une classe créée plus tard ne doit pas dépendre de l'ordre de
 * saisie, et le niveau est ce que l'enseignant a en tête. Conséquence assumée :
 * **créer une classe peut décaler la teinte des classes qui la suivent dans
 * l'ordre alphabétique** de la même année. Cela arrive une fois par an, à la
 * rentrée, pas en cours d'usage ; et stocker un numéro en base pour l'éviter
 * coûterait un palier et une colonne pour une préférence d'affichage.
 *
 * Les autres années gardent leur propre numérotation : une classe archivée
 * n'occupe pas une teinte au détriment d'une classe en cours.
 */

import type { CSSProperties } from "react";

import type { Session } from "@/types";

/** Nombre de teintes définies par `index.css` (`--classe-h-1` … `-10`). Une
 *  année à plus de dix classes recommence au début : deux teintes identiques
 *  valent mieux qu'une couleur absente. */
export const NB_TEINTES = 10;

/** Identifiant de classe → numéro de teinte, de 1 à `NB_TEINTES`. */
export type TableTeintes = ReadonlyMap<string, number>;

/** Table vide — aucune teinte attribuée. Les composants retombent alors sur le
 *  bleu, c'est-à-dire sur l'aspect d'avant les teintes. Exportée pour qu'un
 *  appelant qui n'a pas la liste des classes n'ait pas à fabriquer sa `Map`. */
export const SANS_TEINTES: TableTeintes = new Map();

export function tableDesTeintes(sessions: readonly Session[]): TableTeintes {
	const parAnnee = new Map<number, Session[]>();
	for (const session of sessions) {
		const annee = parAnnee.get(session.year_start);
		if (annee) annee.push(session);
		else parAnnee.set(session.year_start, [session]);
	}

	const table = new Map<string, number>();
	for (const classes of parAnnee.values()) {
		// `localeCompare` et non `<` : « 3A » et « 3a » doivent se suivre, et un
		// niveau accentué ne doit pas se retrouver rejeté en fin de liste.
		const triees = [...classes].sort(
			(a, b) =>
				a.level_code.localeCompare(b.level_code, "fr") ||
				a.name.localeCompare(b.name, "fr") ||
				a.id.localeCompare(b.id),
		);
		triees.forEach((session, index) => {
			table.set(session.id, (index % NB_TEINTES) + 1);
		});
	}
	return table;
}

/** Le numéro de teinte d'une classe, ou `null` si elle n'en a pas — classe
 *  absente de la table, ou créneau sans classe. */
export function numeroDeTeinte(
	table: TableTeintes | undefined,
	sessionId: string | null | undefined,
): number | null {
	if (!table || sessionId == null) return null;
	return table.get(sessionId) ?? null;
}

/**
 * Le style en ligne qui porte la teinte, à fusionner dans celui de l'élément.
 *
 * La valeur est `var(--classe-h-N)`, pas le nombre : la roue reste dans la
 * feuille de style, donc un thème peut encore la redéfinir, et le front n'a
 * aucune couleur écrite en dur.
 *
 * Renvoie toujours un objet, jamais `undefined` : il se répand
 * (`{ ...styleTeinte(…), gridColumn }`) sans que l'appelant ait à tester.
 */
export function styleTeinte(
	table: TableTeintes | undefined,
	sessionId: string | null | undefined,
): CSSProperties {
	const numero = numeroDeTeinte(table, sessionId);
	if (numero === null) return {};
	// Les propriétés personnalisées ne figurent pas dans `CSSProperties` : c'est
	// l'assertion d'usage côté React, et non un contournement de typage.
	return { "--classe-h": `var(--classe-h-${numero})` } as CSSProperties;
}
