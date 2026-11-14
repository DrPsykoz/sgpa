import type { CompetencyAverage } from "@/types";

/** Un domaine du référentiel et les compétences notées qui en relèvent. */
export interface DomaineDuBilan {
	domain_name: string;
	/**
	 * Moyenne SIMPLE des moyennes de ses compétences, comme la moyenne générale
	 * par défaut (`unweighted_mean`) : aucune pondération nouvelle. Elle est
	 * calculée à l'affichage, jamais stockée, et ne remplace pas la moyenne
	 * générale du bilan, qui vient de Rust selon la règle choisie dans Réglages.
	 */
	average_mark: number;
	grade_count: number;
	competencies: CompetencyAverage[];
}

/**
 * Regroupe les moyennes par domaine, en gardant l'ordre reçu (Rust trie déjà
 * par domaine, champ puis compétence). Le seul endroit qui regroupe : l'écran
 * du bilan et le PDF l'appellent tous deux, pour qu'ils ne puissent pas
 * diverger. Aucune compétence n'est retirée, elles restent dans `competencies`.
 */
export function grouperParDomaine(
	averages: CompetencyAverage[],
): DomaineDuBilan[] {
	const groupes = new Map<string, CompetencyAverage[]>();
	for (const average of averages) {
		const liste = groupes.get(average.domain_name);
		if (liste) liste.push(average);
		else groupes.set(average.domain_name, [average]);
	}
	return [...groupes.entries()].map(([domain_name, competencies]) => ({
		domain_name,
		average_mark:
			competencies.reduce((sum, c) => sum + c.average_mark, 0) /
			competencies.length,
		grade_count: competencies.reduce((sum, c) => sum + c.grade_count, 0),
		competencies,
	}));
}
