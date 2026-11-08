/**
 * La progression annuelle, côté front : les mots de la frise, ses en-têtes
 * groupés, et les index que l'écran et le PDF se partagent.
 *
 * La COULEUR d'une activité n'est pas ici : elle est dans `teintes.ts`, avec
 * celle des classes. Un seul module décide qui reçoit quelle teinte.
 *
 * **Même raison d'être que `contenu.ts`** : l'écran et le papier doivent dire
 * la même chose. Le document d'origine de l'enseignant portait une frise en
 * haut et un tableau en bas, tenus à la main — et ils avaient divergé : une
 * activité colorée d'un côté, absente de l'autre. Ici les deux lisent la même
 * progression, et ce qui s'y décide — le mot d'une semaine fermée, le mois
 * d'une colonne, la case d'une plage — se décide une fois.
 */

import type { Progression, ProgressionActivite, YearWeek } from "@/types";

// ---------------------------------------------------------------------------
// Les mots d'une semaine
// ---------------------------------------------------------------------------

/** Les deux bandes de la frise, et il n'y en a que deux. */
export const VOIES = [0, 1] as const;

/** Les deux bandes, nommées. La seconde porte ce qui court à côté — un projet
 *  long, un groupe qui fait autre chose : le document d'origine en avait deux,
 *  et deux suffisent.
 *
 *  Ici et non dans la frise qui se peint : la vue annuelle les nomme aussi,
 *  dans ses infobulles, et deux listes de deux mots auraient fini par ne pas
 *  dire la même chose. */
export const MOTS_DE_VOIE: Record<number, string> = {
	0: "Bande principale",
	1: "Bande parallèle",
};

/** Ce qu'une semaine de l'année scolaire permet.
 *
 * Trois états, jamais deux : « écourtée » existe parce qu'une semaine à quatre
 * jours n'est ni une semaine pleine ni une semaine perdue, et c'est exactement
 * ce que le document d'origine ne pouvait pas dire avec ses quatre colonnes
 * par mois. */
export type EtatDeSemaine = "ouverte" | "ecourtee" | "fermee";

export function etatDeLaSemaine(week: YearWeek): EtatDeSemaine {
	if (week.school_days === 0) return "fermee";
	if (week.school_days < 5) return "ecourtee";
	return "ouverte";
}

/** Un vocabulaire, pas quatre : la frise, la liste des étapes, l'infobulle et
 *  le PDF prennent leurs mots ici. */
export const MOTS_DE_SEMAINE: Record<EtatDeSemaine, string> = {
	ouverte: "Semaine entière",
	ecourtee: "Semaine écourtée",
	fermee: "Pas de cours",
};

/**
 * Le motif à écrire dans la colonne, `""` si l'on fait cours toute la semaine.
 *
 * **La vacance passe avant le férié** : la semaine du 25 décembre se lit
 * « Vacances de Noël » et non « Noël ». L'inverse est vrai et inutile — le
 * férié y est noyé dans la vacance, et nommer le jour laisse croire que le
 * reste de la semaine a cours.
 */
export function motifDeLaSemaine(week: YearWeek): string {
	if (week.closures.length === 0) return "";
	const vacance = week.closures.find((c) => c.origin !== "ferie");
	return (vacance ?? week.closures[0]).label;
}

/** Vrai si la classe entière est hors cours cette semaine — un stage. */
export function classeHorsCours(week: YearWeek, sessionId: string): boolean {
	return week.sessions_away.some((away) => away.session_id === sessionId);
}

/**
 * Vrai si l'on peut raisonnablement poser une activité sur cette semaine.
 *
 * **L'application ne REFUSE pas de poser ailleurs**, et c'est voulu : le
 * calendrier bouge — une académie déplace des vacances, l'enseignant saisit une
 * journée banalisée —, et un refus aurait effacé en silence une plage déjà
 * peinte au premier changement. La frise le DIT, en pâlissant la colonne, et
 * laisse l'enseignant décider : une semaine de stage peut très bien porter
 * « Rapports de stage ».
 */
export function semainePlanifiable(week: YearWeek, sessionId: string): boolean {
	return week.school_days > 0 && !classeHorsCours(week, sessionId);
}

const MOIS_COURTS = [
	"janv.",
	"févr.",
	"mars",
	"avril",
	"mai",
	"juin",
	"juil.",
	"août",
	"sept.",
	"oct.",
	"nov.",
	"déc.",
];

/** 1 → « janv. ». Les noms sont écrits, pas demandés à `toLocaleDateString` :
 *  l'un fabriquerait une `Date` par colonne, et l'autre rendrait « sept » sans
 *  point selon la version de la plateforme. */
export function nomDuMois(mois: number): string {
	return MOIS_COURTS[mois - 1] ?? "";
}

// ---------------------------------------------------------------------------
// Tranches : les en-têtes groupés de la frise
// ---------------------------------------------------------------------------

/** Un groupe de colonnes consécutives — un mois, un trimestre. */
export interface Tranche {
	/** Le mois (1-12) ou le trimestre (1-3) que le groupe porte. */
	cle: number;
	/** Index de sa première semaine dans `weeks`. */
	debut: number;
	/** Nombre de semaines, donc le `colSpan` de l'en-tête. */
	taille: number;
}

function tranches(
	weeks: readonly YearWeek[],
	cleDe: (week: YearWeek) => number,
): Tranche[] {
	const groupes: Tranche[] = [];
	weeks.forEach((week, index) => {
		const cle = cleDe(week);
		const dernier = groupes[groupes.length - 1];
		if (dernier && dernier.cle === cle) dernier.taille += 1;
		else groupes.push({ cle, debut: index, taille: 1 });
	});
	return groupes;
}

/**
 * Les mois, en groupes de colonnes.
 *
 * Le mois d'une semaine est celui de son **jeudi**, décidé par le backend : la
 * règle est une partition, donc ces groupes couvrent exactement les semaines,
 * sans trou ni recouvrement. Ne pas regrouper sur `monday.slice(5, 7)` — la
 * semaine du 30 novembre est une semaine de décembre, et deux découpages dans
 * la même page mettraient une semaine dans un mois et son trimestre dans un
 * autre.
 */
export function tranchesParMois(weeks: readonly YearWeek[]): Tranche[] {
	return tranches(weeks, (week) => week.month);
}

/** Les trois trimestres, en groupes de colonnes. */
export function tranchesParTrimestre(weeks: readonly YearWeek[]): Tranche[] {
	return tranches(weeks, (week) => week.trimester);
}

/** Un groupe de semaines consécutives partageant un motif de fermeture. */
export interface TrancheDeMotif {
	/** Le motif, `""` quand on fait cours toute la semaine. */
	motif: string;
	debut: number;
	taille: number;
}

/**
 * Les périodes de fermeture, en groupes de colonnes.
 *
 * Même découpage que les mois, sur une clé qui est un mot et non un nombre :
 * la vue annuelle écrit « Vacances de Noël » une fois sur deux colonnes, et
 * c'est ce qui permet de lire l'année sans survoler chaque semaine.
 */
export function tranchesParMotif(weeks: readonly YearWeek[]): TrancheDeMotif[] {
	const groupes: TrancheDeMotif[] = [];
	weeks.forEach((week, index) => {
		const motif = motifDeLaSemaine(week);
		const dernier = groupes[groupes.length - 1];
		if (dernier && dernier.motif === motif) dernier.taille += 1;
		else groupes.push({ motif, debut: index, taille: 1 });
	});
	return groupes;
}

// ---------------------------------------------------------------------------
// Index : retrouver une activité, une plage
// ---------------------------------------------------------------------------

/** La clé d'une case de frise. Une seule fabrication, pour que l'écran et le
 *  PDF ne cherchent pas dans deux index différemment construits. */
export function cleDePlage(weekMonday: string, voie: number): string {
	return `${weekMonday}|${voie}`;
}

/** `(lundi, voie)` → identifiant d'activité. */
export function indexDesPlages(
	progression: Progression,
): ReadonlyMap<string, string> {
	const index = new Map<string, string>();
	for (const plage of progression.plages) {
		index.set(cleDePlage(plage.week_monday, plage.voie), plage.activite_id);
	}
	return index;
}

/** Toutes les activités de l'année, à plat, dans l'ordre de leur rang. */
export function activitesDeLAnnee(
	progression: Progression,
): ProgressionActivite[] {
	return progression.etapes
		.flatMap((etape) => etape.activites)
		.sort((a, b) => a.rang - b.rang);
}

/** Identifiant → activité. */
export function activitesParId(
	progression: Progression,
): ReadonlyMap<string, ProgressionActivite> {
	const index = new Map<string, ProgressionActivite>();
	for (const etape of progression.etapes) {
		for (const activite of etape.activites) index.set(activite.id, activite);
	}
	return index;
}

// ---------------------------------------------------------------------------
// Les traits d'une bande
// ---------------------------------------------------------------------------

/** Ce qu'une colonne d'une bande a besoin de savoir pour se dessiner. */
export interface CaseDeFrise {
	/** L'activité posée sur cette semaine, `null` si la case est libre. */
	activiteId: string | null;
	/** Vrai sur la première semaine d'un trait : c'est là qu'on écrit l'intitulé. */
	debutDeTrait: boolean;
	/** Longueur du trait en semaines, `0` hors de son début. */
	longueur: number;
	/** Vrai si la semaine suivante porte la même activité — le filet intérieur
	 *  se tait alors, pour que huit semaines fassent un trait et non huit. */
	memeVoisin: boolean;
}

/**
 * Les traits d'une bande, une entrée par semaine.
 *
 * **Partagé par les deux frises** : celle qui se peint dans la fiche de classe
 * et celle qui se lit dans l'emploi du temps. Un trait est une suite de
 * semaines consécutives portant la même activité, et son intitulé s'écrit une
 * seule fois, débordé sur les suivantes — deux implémentations de ce découpage
 * auraient coupé un trait à un endroit d'un côté et à un autre de l'autre.
 *
 * Le découpage est fait **par activité et non par couleur** : deux activités
 * voisines de rangs éloignés peuvent se ressembler à l'œil, elles font bien
 * deux traits.
 */
export function casesDeVoie(
	weeks: readonly YearWeek[],
	plages: ReadonlyMap<string, string>,
	voie: number,
): CaseDeFrise[] {
	const de = (index: number): string | null =>
		index < 0 || index >= weeks.length
			? null
			: (plages.get(cleDePlage(weeks[index].monday, voie)) ?? null);

	return weeks.map((_, index) => {
		const activiteId = de(index);
		const debutDeTrait = activiteId !== null && activiteId !== de(index - 1);
		let longueur = 0;
		if (debutDeTrait) {
			longueur = 1;
			while (de(index + longueur) === activiteId) longueur += 1;
		}
		return {
			activiteId,
			debutDeTrait,
			longueur,
			memeVoisin: activiteId !== null && activiteId === de(index + 1),
		};
	});
}
