/**
 * Règles de mot de passe, partagées par les trois écrans qui en demandent un
 * (premier lancement, récupération, changement depuis les réglages).
 *
 * Le minimum est le miroir exact de `keys::MIN_PASSWORD_LEN` : une valeur plus
 * permissive ici ferait passer la validation du front pour être refusée par le
 * backend, une valeur plus stricte refuserait un mot de passe pourtant valable.
 */
export const MIN_PASSWORD_LENGTH = 8;

/** Longueur en caractères et non en unités UTF-16 : le backend compte des
 *  `char`, et « 🔑🔑🔑🔑 » vaut 4 caractères pour lui et 8 pour `String.length`. */
export const passwordLength = (password: string): number =>
	Array.from(password).length;

export interface PasswordStrength {
	/** 0 = trop court, 4 = excellent. Sert à colorer la jauge, rien d'autre. */
	score: 0 | 1 | 2 | 3 | 4;
	label: string;
	/** Classes Tailwind du segment rempli de la jauge. */
	barClass: string;
	textClass: string;
}

const LEVELS: Omit<PasswordStrength, "score">[] = [
	{
		label: "Trop court",
		barClass: "bg-destructive",
		textClass: "text-destructive",
	},
	{ label: "Faible", barClass: "bg-red-500", textClass: "text-red-600" },
	{ label: "Moyen", barClass: "bg-amber-500", textClass: "text-amber-700" },
	{ label: "Bon", barClass: "bg-lime-600", textClass: "text-lime-700" },
	{ label: "Excellent", barClass: "bg-green-600", textClass: "text-green-700" },
];

/**
 * Estimation **indicative** de la force, jamais bloquante au-delà du minimum.
 *
 * La longueur pèse beaucoup plus que la variété de caractères : face à une
 * attaque hors ligne, une phrase de quatre mots vaut mieux qu'un mot court
 * truffé de symboles, et c'est elle que l'enseignant retapera dix fois par jour
 * sans se tromper.
 */
export function passwordStrength(password: string): PasswordStrength {
	const length = passwordLength(password);
	if (length < MIN_PASSWORD_LENGTH) return { score: 0, ...LEVELS[0] };

	let score = 1;
	if (length >= 12) score += 1;
	if (length >= 16) score += 1;
	if (length >= 24) score += 1;

	// La variété ne fait gagner qu'un cran, et seulement en deçà du maximum :
	// elle ne doit jamais faire passer un mot de 8 caractères pour excellent.
	const families = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) =>
		re.test(password),
	).length;
	if (families >= 3 && score < 4) score += 1;

	const level = Math.min(score, 4) as 1 | 2 | 3 | 4;
	return { score: level, ...LEVELS[level] };
}
