/**
 * Une teinte par classe — et une par activité de progression.
 *
 * Deux roues, une seule maison : ce module décide QUI reçoit QUELLE teinte, et
 * les déclinaisons (clarté, saturation, filet) restent dans `src/index.css`.
 * La roue des classes est en tête de ce fichier, celle des activités en pied —
 * elle n'est pas bornée à dix et se calcule, pour la raison qui y est écrite.
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

// ---------------------------------------------------------------------------
// La teinte d'une activité de progression
// ---------------------------------------------------------------------------

/**
 * Le pas de la roue : l'angle d'or, 137,508°.
 *
 * **Et non `360 / nombre d'activités`.** Le découpage régulier a l'air plus
 * propre et il est faux à l'usage : ajouter une quinzième activité en février
 * recolorie les quatorze précédentes, donc la frise déjà imprimée et punaisée
 * au mur ne correspond plus à celle de l'écran. Avec un pas fixe, la teinte
 * d'une activité ne dépend que de son rang, et le rang ne bouge que si
 * l'enseignant réordonne lui-même l'année.
 *
 * L'angle d'or est le pas qui écarte le plus longtemps les voisins successifs :
 * les dix premières valeurs ne retombent jamais à moins de 25° l'une de l'autre.
 */
export const PAS_DE_TEINTE = 137.508;

/**
 * Où la roue commence.
 *
 * 45° est clair des dix teintes de classe de `index.css` (258, 70, 300, 155,
 * 25, 205, 340, 120, 278, 180) : la première activité ne reprend donc pas la
 * couleur d'une classe. Au-delà du premier tour, des rapprochements sont
 * inévitables — dix teintes couvrent déjà la roue — et sans conséquence : une
 * pastille d'activité et une carte de classe ne se comparent jamais, elles ne
 * vivent pas sur la même ligne.
 */
export const DEPART_DE_TEINTE = 45;

/**
 * Teinte d'une activité, en degrés, depuis son rang dans l'année.
 *
 * **Le rang vient du backend** (`ProgressionActivite.rang`), qui parcourt les
 * étapes puis leurs activités. Ne jamais le remplacer par l'index d'un `map`
 * d'affichage : un filtre, un replis d'étape ou un tri de colonne changerait
 * les couleurs sans que l'année ait bougé.
 */
export function teinteDeActivite(rang: number): number {
	const angle = (DEPART_DE_TEINTE + rang * PAS_DE_TEINTE) % 360;
	// Un rang négatif n'existe pas, mais `%` en JavaScript garde le signe.
	return angle < 0 ? angle + 360 : angle;
}

/**
 * Clarté et saturation du fond, du filet et de l'encre d'une pastille.
 *
 * **Recopiés de `index.css` — `--teinte-appui-fond-*`, `--teinte-appui-bord-*`,
 * `--teinte-texte-*` — et c'est la seule duplication assumée du projet.** jsPDF
 * ne lit pas de feuille de style : il veut trois octets. À l'écran rien n'est
 * recopié, `styleTeinteActivite` ne pose que la TEINTE et laisse les six autres
 * valeurs à la feuille de style, de sorte qu'un futur mode sombre les change
 * pour l'écran sans toucher au papier — qui, lui, reste blanc.
 */
const FOND_L = 0.918;
const FOND_C = 0.062;
const BORD_L = 0.705;
const BORD_C = 0.145;
const ENCRE_L = 0.355;
const ENCRE_C = 0.135;

/** Le fond pâle d'une pastille d'activité, en sRVB 0-255, pour le PDF. */
export function fondDeActivite(rang: number): [number, number, number] {
	return oklchVersRvb(FOND_L, FOND_C, teinteDeActivite(rang));
}

/** Le filet de la pastille, pour le PDF. */
export function filetDeActivite(rang: number): [number, number, number] {
	return oklchVersRvb(BORD_L, BORD_C, teinteDeActivite(rang));
}

/** L'encre du libellé posé sur le fond pâle, pour le PDF. */
export function encreDeActivite(rang: number): [number, number, number] {
	return oklchVersRvb(ENCRE_L, ENCRE_C, teinteDeActivite(rang));
}

/**
 * `oklch(L C H)` → trois octets sRVB.
 *
 * Les jetons de couleur du projet sont en OKLCH, parce que c'est la seule
 * notation où deux teintes de même clarté paraissent également claires — une
 * roue en HSL donne un jaune éclatant et un bleu sombre pour les mêmes
 * nombres, et la frise aurait eu des pastilles illisibles une fois sur quatre.
 * Le PDF veut du sRVB : c'est la conversion de la spécification CSS Color 4,
 * OKLab → sRVB linéaire → gamma.
 *
 * Le `clamp` final écrête, là où un navigateur désaturerait. Aux trois jeux de
 * valeurs ci-dessus l'écart est invisible — un fond à 0,918 de clarté dépasse
 * d'un ou deux niveaux sur un seul canal — et la bonne conversion coûterait
 * cinquante lignes de projection de gamut pour un fond pastel. Ne pas monter la
 * chroma de ces constantes sans refaire ce calcul : à 0,15 l'écrêtage se voit.
 */
function oklchVersRvb(
	l: number,
	c: number,
	hue: number,
): [number, number, number] {
	const h = (hue * Math.PI) / 180;
	const a = c * Math.cos(h);
	const b = c * Math.sin(h);

	const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

	const lineaire = [
		4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp,
		-1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp,
		-0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp,
	];

	const octets = lineaire.map((canal) => {
		const gamma =
			canal <= 0.0031308
				? 12.92 * canal
				: 1.055 * Math.abs(canal) ** (1 / 2.4) - 0.055;
		return Math.round(Math.min(1, Math.max(0, gamma)) * 255);
	});
	return [octets[0], octets[1], octets[2]];
}

/**
 * Le style en ligne qui porte la teinte d'une activité.
 *
 * Il pose la même propriété `--classe-h` que `styleTeinte()`, donc
 * `teinte-carte`, `teinte-appui`, `teinte-plein` et `teinte-encre`
 * fonctionnent sur une pastille d'activité exactement comme sur une carte de
 * cours. Seule la teinte vient d'ici ; la clarté et la saturation restent dans
 * `index.css`, donc rien ici n'écrit une couleur de plus.
 *
 * Et `--classe-h` plutôt qu'une variable dédiée : les quatre classes
 * utilitaires la lisent déjà, en ajouter une seconde aurait doublé chaque
 * règle de `index.css` pour ne rien dire de plus.
 */
export function styleTeinteActivite(rang: number): CSSProperties {
	return {
		"--classe-h": teinteDeActivite(rang).toFixed(3),
	} as CSSProperties;
}
