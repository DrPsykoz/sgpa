/**
 * Plusieurs journées en calendrier, sur un SEUL axe horaire.
 *
 * Aujourd'hui en première colonne, les jours ouvrés suivants à sa droite, les
 * heures une seule fois à gauche. C'est la forme que l'accueil demandait — « la
 * vue du jour sur la gauche et sur la droite les prochains jours » — et c'est
 * un calendrier, pas une liste : on y voit un trou d'une heure le mardi
 * après-midi, ce qu'aucune liste ne montre.
 *
 * **Ce composant ne décide d'aucune action, et c'est la raison d'être du
 * fichier.** Chaque carte reçoit du parent soit une adresse (`hrefOf`), soit un
 * geste à faire sur place (`actionDe`), soit rien — et ce qu'elle rend suit :
 * un `<Link>`, un `<button>`, un `<div>` inerte. Les bandes du quadrillage,
 * elles, ne répondent jamais : on n'ajoute pas un cours depuis l'accueil, on
 * l'ajoute depuis l'emploi du temps.
 *
 * Rien n'est relu de la journée pour autant : `buildRows`, `motifDeFermeture`
 * et `absenceDuCreneau` viennent de `journee.ts`, la géométrie de
 * `geometry.ts`. Une seule règle, deux rendus — la grille de la semaine, et ce
 * calendrier.
 *
 * Ce composant ne met aucune date en forme et ne connaît aucune route : les
 * en-têtes, les bandeaux et les liens arrivent en props. Deux implémentations
 * de « jeudi 5 mars » divergeraient au premier ajustement.
 *
 * Les signes suivent ceux de la grille de la semaine : filet franc = l'objet
 * existe, filet pâle = il est seulement prévu, bord tireté = occupation sans
 * classe. Un même signe veut dire la même chose sur les deux rendus.
 */

import {
	useEffect,
	useState,
	type CSSProperties,
	type ReactElement,
	type ReactNode,
} from "react";

import { Link } from "react-router-dom";

import { PastilleDeCategorie } from "@/components/PastilleCategorie";
import {
	absenceDuCreneau,
	buildRows,
	motifDeFermeture,
	motsDeAbsence,
	slotTitle,
	cibleDuRendezVous,
	type Row,
} from "@/pages/Timetable/journee";
import {
	amplitudeDe,
	estPlacable,
	HAUTEUR_PAS,
	libelleHeure,
	libelleHoraire,
	PAS,
	placer,
	PLANCHER_LECTURE,
	type Candidat,
	type Place,
} from "@/pages/Timetable/geometry";
import {
	compteRenduRegle,
	motsDuCahier,
	motsDuCompteRendu,
} from "@/lib/contenu";
import { styleTeinte, type TableTeintes } from "@/lib/teintes";
import { cn } from "@/lib/utils";
import type { DaySchedule, SessionAway } from "@/types";

// ---------------------------------------------------------------------------
// Ce qu'une carte dit
// ---------------------------------------------------------------------------

/** Les deux bornes brutes d'une ligne de journée. `Row` ne porte que l'heure de
 *  début — la liste n'a besoin que d'elle pour trier ; un calendrier a besoin
 *  des deux pour donner une hauteur. */
function bornesDe(row: Row): { debut: string; fin: string } {
	switch (row.kind) {
		case "cours":
		case "occupation":
			return { debut: row.slot.start_time, fin: row.slot.end_time };
		case "seance":
			return { debut: row.seance.start_time, fin: row.seance.end_time };
		case "entree":
			return { debut: row.entry.start_time, fin: row.entry.end_time };
	}
}

/** La classe à laquelle la ligne appartient, ou `null` — un créneau sans
 *  classe, un rendez-vous. C'est elle qui donne sa teinte à la carte. */
function sessionDe(row: Row): string | null {
	switch (row.kind) {
		case "cours":
		case "occupation":
			return row.slot.session_id;
		case "seance":
			return row.seance.session_id;
		case "entree":
			return null;
	}
}

/** L'identifiant de la classe portée par la ligne, ou `undefined` si la ligne
 *  n'est pas un créneau.
 *
 *  La distinction compte : seul un créneau se masque. Une séance datée ou un
 *  rendez-vous restent dessinés même un jour fermé — un rattrapage pendant les
 *  vacances est un fait, et une faute de frappe sur la date doit se voir. */
function classeDuCreneau(row: Row): string | null | undefined {
	if (row.kind === "cours" || row.kind === "occupation") {
		return row.slot.session_id;
	}
	return undefined;
}

/** La période qui met cette ligne hors cours, ou `null`.
 *
 *  Seul un créneau peut l'être : une séance datée et un rendez-vous sont des
 *  faits, et un rattrapage posé pendant un stage reste un rattrapage. */
function absenceDe(day: DaySchedule, row: Row): SessionAway | null {
	return absenceDuCreneau(day, classeDuCreneau(row) ?? null);
}

/**
 * L'apparence de la carte.
 *
 * Un cours porte la teinte de sa classe : `teinte-carte` lit `--classe-h`,
 * posée en style en ligne par `styleTeinte()`. Sans table de teintes, le repli
 * de `index.css` vaut le bleu, c'est-à-dire exactement l'aspect d'avant.
 *
 * **Un seul signe pour quatre états, et c'est le filet de la carte** : franc
 * quand l'objet existe pour de bon — une séance est créée à cette date, ou la
 * carte EST un rendez-vous —, pâle quand il n'est que prévu. Il n'y a plus de
 * barre d'accent le long du bord gauche : elle disait la même chose en
 * ajoutant un ornement à côté de la carte, là où la carte pouvait le dire
 * elle-même.
 *
 * Aucune classe utilitaire de couleur ici sur les branches teintées : la couche
 * `utilities` de Tailwind passe après `components`, donc un `border-primary/30`
 * emporterait `teinte-carte` en silence.
 */
function apparenceDe(row: Row): string {
	switch (row.kind) {
		case "cours":
			return cn("teinte-carte", row.seance && "teinte-appui");
		case "occupation":
			return "border-dashed border-border bg-muted text-muted-foreground";
		case "seance":
			return "teinte-carte teinte-appui";
		case "entree":
			return "border-agenda bg-agenda-fond text-agenda-encre";
	}
}

/** Le titre de la carte, et sa deuxième ligne quand il y en a une. */
function texteDe(row: Row): { titre: string; sous: string | null } {
	switch (row.kind) {
		case "cours":
			return { titre: slotTitle(row.slot), sous: row.slot.room || null };
		case "occupation":
			return { titre: slotTitle(row.slot), sous: "Sans classe" };
		case "seance":
			return { titre: row.seance.title, sous: row.seance.session_name };
		case "entree":
			return { titre: row.entry.title, sous: cibleDuRendezVous(row.entry) };
	}
}

/** La catégorie de la carte, `""` quand elle n'en a pas — et seul un
 *  rendez-vous peut en porter une : un créneau et une séance sont des cours,
 *  leur nature est dans leur intitulé. */
function categorieDe(row: Row): string {
	return row.kind === "entree" ? row.entry.category : "";
}

/** La séance barrée d'un trait : annulée. */
function estAnnulee(row: Row): boolean {
	if (row.kind === "cours") return row.seance?.cancelled ?? false;
	if (row.kind === "seance") return row.seance.cancelled;
	return false;
}

/**
 * L'état de la carte en une ligne, et s'il réclame quelque chose.
 *
 * Les pastilles d'autrefois ne tiennent pas ici : à 14 px de texte et 24 px de
 * haut, deux d'entre elles débordent d'une carte d'une heure, qui n'en fait que
 * 48. Une phrase courte dit la même chose sur une seule ligne — et elle la dit
 * en mots, là où un glyphe demanderait une légende.
 *
 * `reclame` ne décide rien, il allume seulement une puce : c'est l'écran
 * « À reprendre » qui fait le compte, et il ne regarde que le passé. Ici la
 * puce sert à préparer, pas à accuser.
 */
function etatDe(row: Row): { texte: string; reclame: boolean } | null {
	switch (row.kind) {
		case "occupation":
			return null;

		case "cours":
		case "seance": {
			const { seance } = row;
			if (seance === null) return { texte: "Séance à créer", reclame: false };
			// Pas de motif ici : `DaySeance` ne le porte pas, et il faudrait le faire
			// remonter de trois requêtes pour l'afficher. L'absence de motif est déjà
			// relevée par « Annulations sans motif » dans « À reprendre », qui ne
			// regarde que le passé — c'est le bon endroit pour en faire le compte.
			if (seance.cancelled) return { texte: "Annulée", reclame: false };
			const parts: string[] = [];
			if (seance.attendance_total === 0) {
				parts.push("aucun élève inscrit");
			} else {
				parts.push(`appel ${seance.attendance_done}/${seance.attendance_total}`);
			}
			parts.push(motsDuCahier(seance).carte);
			const appelIncomplet =
				seance.attendance_total > 0 &&
				seance.attendance_done < seance.attendance_total;
			return {
				texte: parts.join(" · "),
				reclame: appelIncomplet || !compteRenduRegle(seance),
			};
		}

		case "entree":
			return {
				texte: motsDuCompteRendu(row.entry).carte,
				reclame: !compteRenduRegle(row.entry),
			};
	}
}

// ---------------------------------------------------------------------------
// L'heure courante
// ---------------------------------------------------------------------------

/** Minutes écoulées depuis minuit, en heure LOCALE. Les heures UTC n'ont rien
 *  à faire ici : le trait « maintenant » doit tomber à l'heure qu'affiche la
 *  pendule du poste. */
function minutesCourantes(): number {
	const maintenant = new Date();
	return maintenant.getHours() * 60 + maintenant.getMinutes();
}

/**
 * L'heure courante, rafraîchie chaque minute.
 *
 * Sans le minuteur, le trait serait figé à l'heure d'ouverture de la page — et
 * une page d'accueil reste ouverte des heures. Il est retiré au démontage : un
 * intervalle qui survit à son composant est une fuite, discrète mais réelle.
 */
function useMinuteCourante(actif: boolean): number | null {
	const [minutes, setMinutes] = useState<number | null>(() =>
		actif ? minutesCourantes() : null,
	);

	useEffect(() => {
		if (!actif) {
			setMinutes(null);
			return;
		}
		setMinutes(minutesCourantes());
		const minuteur = window.setInterval(() => {
			setMinutes(minutesCourantes());
		}, 60_000);
		return () => window.clearInterval(minuteur);
	}, [actif]);

	return minutes;
}

// ---------------------------------------------------------------------------
// Le calendrier
// ---------------------------------------------------------------------------

/** Les trois rangées de tête, de hauteur libre, avant la grille horaire. Elles
 *  sont nommées parce qu'une erreur d'un cran y est silencieuse : la carte se
 *  poserait une demi-heure trop haut sans que rien ne le signale. */
const LIGNE_ENTETE = 1;
const LIGNE_BANDEAU = 2;
const LIGNE_HORS_HORAIRE = 3;
const PREMIERE_LIGNE_HORAIRE = 4;

/** Ce qu'une journée devient une fois lue : ses contenus placés, et ceux dont
 *  l'heure reste à caler. */
interface JourPlace {
	day: DaySchedule;
	colonne: number;
	places: Place<Row>[];
	horsHoraire: Row[];
}

export interface DaysCalendarProps {
	/** Les journées, dans l'ordre d'affichage. La première colonne est la
	 *  première du tableau — l'appelant décide, pas le composant. */
	days: readonly DaySchedule[];
	/** Date du jour, pour l'emphase de sa colonne et le trait « maintenant ». La
	 *  journée du jour n'est pas forcément dans le lot : un samedi, l'accueil
	 *  n'affiche que les jours suivants. */
	today: string;
	/** Vers quoi mène un clic sur la carte, ou `null` quand elle ne navigue
	 *  nulle part — un créneau sans classe est un modèle, il n'a rien à ouvrir,
	 *  et un cours dont la séance n'existe pas encore se traite sur place. */
	hrefOf: (row: Row, day: DaySchedule) => string | null;
	/** Ce qu'un clic fait **sur place**, quand il n'y a nulle part à aller.
	 *
	 *  Le cas est celui d'un cours de chaque semaine dont la séance n'existe pas
	 *  encore : il n'y a pas encore d'écran où mener, il y a un geste à proposer
	 *  — créer l'occurrence, ou la déclarer sans cours. `hrefOf` gagne quand les
	 *  deux répondent, parce qu'une carte qui mène ailleurs doit rester un lien :
	 *  clic du milieu, « ouvrir dans un onglet », et le clavier. */
	actionDe?: (row: Row, day: DaySchedule) => (() => void) | null;
	/** L'en-tête de la colonne : nom du jour, date, numéro de semaine. Mise en
	 *  forme laissée à l'appelant, qui tient déjà ces libellés. */
	enteteDe: (day: DaySchedule) => ReactNode;
	/** Ce qui s'affiche sous l'en-tête : vacances, férié, classe en stage. */
	bandeauDe: (day: DaySchedule) => ReactNode;
	/** Classe → teinte. Absente, toutes les cartes retombent sur le bleu. */
	teintes?: TableTeintes;
	/** Largeur relative de la colonne du jour, par rapport aux autres. */
	emphaseAujourdhui?: number;
	className?: string;
}

export function DaysCalendar({
	days,
	today,
	hrefOf,
	actionDe,
	enteteDe,
	bandeauDe,
	teintes,
	emphaseAujourdhui = 1.45,
	className,
}: DaysCalendarProps): ReactElement {
	// Un créneau d'un JOUR fermé n'est pas dessiné : c'est un MODÈLE, il n'existe
	// pas, et le bandeau de la journée dit déjà pourquoi personne ne fait cours.
	// Même doctrine que la grille de la semaine.
	//
	// Une classe hors cours, elle, GARDE ses cartes depuis le palier 020 —
	// estompées, inertes, le motif écrit dessus (`absenceDe`). Une colonne vidée
	// ne disait pas si l'emploi du temps était seulement saisi, et l'effet que le
	// palier 006 cherchait tient autrement : la carte n'ouvre plus rien, donc
	// elle ne propose plus de créer la séance d'un cours qui n'a pas eu lieu.
	const jours: JourPlace[] = days.map((day, index) => {
		const ferme = motifDeFermeture(day) !== null;
		const lignes = buildRows(day).filter(
			(row) => classeDuCreneau(row) === undefined || !ferme,
		);

		const candidats: Candidat<Row>[] = [];
		const horsHoraire: Row[] = [];
		for (const row of lignes) {
			const { debut, fin } = bornesDe(row);
			if (estPlacable(debut, fin)) {
				candidats.push({ cle: row.key, contenu: row, debut, fin });
			} else {
				horsHoraire.push(row);
			}
		}

		return {
			day,
			colonne: index + 2, // la colonne 1 porte les heures
			places: placer(candidats),
			horsHoraire,
		};
	});

	// **Une seule amplitude pour toutes les colonnes.** C'est ce qui fait de ce
	// composant un calendrier et non six calendriers côte à côte : 10h doit
	// tomber à la même hauteur le lundi et le vendredi, sinon l'œil ne peut plus
	// comparer deux journées — et comparer est tout ce qu'on vient faire ici.
	const { debut, fin } = amplitudeDe(
		jours.flatMap((jour) => jour.places),
		PLANCHER_LECTURE,
	);

	const colonneDuJour =
		jours.find((jour) => jour.day.date === today)?.colonne ?? null;
	const maintenant = useMinuteCourante(colonneDuJour !== null);

	// L'arrondi n'est pas cosmétique : le champ horaire n'a pas de `step`, donc
	// un cours peut commencer à 8h32. Sans lui, `gridRow` vaudrait « 8.4 », que
	// le navigateur ignore — et la carte se poserait en haut de la grille.
	const ligneDe = (minutes: number) =>
		PREMIERE_LIGNE_HORAIRE + Math.round((minutes - debut) / PAS);
	const ligneFinale = ligneDe(fin);

	const heures: number[] = [];
	for (let h = debut; h < fin; h += 60) heures.push(h);

	const demiHeures: number[] = [];
	for (let t = debut; t < fin; t += 30) demiHeures.push(t);

	const style: CSSProperties = {
		gridTemplateColumns: `2.75rem ${days
			.map((day) =>
				day.date === today
					? `minmax(0, ${emphaseAujourdhui}fr)`
					: "minmax(0, 1fr)",
			)
			.join(" ")}`,
		gridTemplateRows: `auto auto auto repeat(${(fin - debut) / PAS}, ${HAUTEUR_PAS}px)`,
	};

	return (
		<div className={cn("grid", className)} style={style}>
			{/* Le fond de la colonne du jour, posé en PREMIER dans le DOM : sans
			    `position`, l'empilement d'éléments de grille suit l'ordre du
			    document, et ce fond doit rester sous le quadrillage comme sous les
			    cartes. */}
			{colonneDuJour !== null && (
				<div
					aria-hidden
					className="bg-accent/40"
					style={{
						gridColumn: colonneDuJour,
						gridRow: `${LIGNE_ENTETE} / ${ligneFinale}`,
					}}
				/>
			)}

			{/* Rangée des en-têtes. */}
			{jours.map((jour) => (
				<div
					key={`entete-${jour.day.date}`}
					className={cn(
						"border-b border-border px-1.5 pb-1.5",
						jour.day.date === today && "border-b-primary/40",
					)}
					style={{ gridColumn: jour.colonne, gridRow: LIGNE_ENTETE }}
				>
					{enteteDe(jour.day)}
				</div>
			))}

			{/* Rangée des bandeaux — vacances, férié, classe en stage. Vide, cette
			    rangée `auto` ne prend aucune hauteur ; dès qu'une seule journée en
			    porte un, elle s'ouvre pour toutes, et c'est la contrepartie d'un axe
			    partagé. */}
			{jours.map((jour) => (
				<div
					key={`bandeau-${jour.day.date}`}
					className="space-y-1 px-1 pt-1.5 empty:pt-0"
					style={{ gridColumn: jour.colonne, gridRow: LIGNE_BANDEAU }}
				>
					{bandeauDe(jour.day)}
				</div>
			))}

			{/* Rangée « heure à caler » : un rendez-vous dont l'heure n'est pas fixée
			    (`start_time = ''`) n'a aucune place dans la grille horaire, et il ne
			    doit pas pour autant disparaître. Même doctrine que la grille de la
			    semaine, qui ouvre la journée par ces lignes-là. */}
			{jours.some((jour) => jour.horsHoraire.length > 0) && (
				<div
					className="self-end pb-1.5 pr-2 text-right text-[10px] leading-tight text-muted-foreground"
					style={{ gridColumn: 1, gridRow: LIGNE_HORS_HORAIRE }}
				>
					heure à caler
				</div>
			)}
			{jours
				.filter((jour) => jour.horsHoraire.length > 0)
				.map((jour) => (
					<div
						key={`hors-${jour.day.date}`}
						className="space-y-1 px-0.5 pb-1.5"
						style={{ gridColumn: jour.colonne, gridRow: LIGNE_HORS_HORAIRE }}
					>
						{jour.horsHoraire.map((row) => (
							<Carte
								key={row.key}
								row={row}
								href={hrefOf(row, jour.day)}
								action={actionDe?.(row, jour.day) ?? null}
								absence={absenceDe(jour.day, row)}
								teintes={teintes}
								horaire
							/>
						))}
					</div>
				))}

			{/* Colonne des heures. `span 12` = une heure, soit douze pas de 5 min.
			    `tabular-nums` aligne « 08h » sur « 11h » au chiffre près. */}
			{heures.map((heure) => (
				<div
					key={`heure-${heure}`}
					className="pr-2 text-right text-[11px] leading-none tabular-nums text-muted-foreground"
					style={{ gridColumn: 1, gridRow: `${ligneDe(heure)} / span 12` }}
				>
					{libelleHeure(heure)}
				</div>
			))}

			{/* Les cartes AVANT le quadrillage dans le DOM : c'est l'ordre du clavier
			    qui le commande, pas l'empilement. `z-10` suffit à les poser par-dessus
			    les bandes, `z-index` s'appliquant aux éléments d'une grille CSS même
			    sans `position`. Placées après, elles n'étaient atteintes qu'au bout
			    des vingt-quatre bandes du fond. */}
			{jours.flatMap((jour) =>
				jour.places.map((place) => (
					<CartePlacee
						key={`${jour.day.date}-${place.cle}`}
						place={place}
						colonne={jour.colonne}
						href={hrefOf(place.contenu, jour.day)}
						action={actionDe?.(place.contenu, jour.day) ?? null}
						absence={absenceDe(jour.day, place.contenu)}
						teintes={teintes}
						ligneDebut={ligneDe(place.debut)}
						// Un contenu de moins de 5 minutes retomberait sur la même ligne de
						// départ et d'arrivée, donc sur une case invisible.
						ligneFin={Math.max(ligneDe(place.fin), ligneDe(place.debut) + 1)}
					/>
				)),
			)}

			{/* Quadrillage horizontal : une bande par demi-heure, en travers de TOUTES
			    les colonnes de jour (`2 / -1`). Une bande par colonne ferait ici cent
			    quarante-quatre éléments pour le même dessin. Inerte au clic — c'est
			    tout l'écart avec la grille de la semaine, où la même bande ouvre la
			    création d'un créneau. */}
			{demiHeures.map((t) => (
				<div
					key={`bande-${t}`}
					aria-hidden
					className={cn(
						"border-t",
						t % 60 === 0 ? "border-t-border" : "border-t-border/40",
					)}
					style={{ gridColumn: "2 / -1", gridRow: `${ligneDe(t)} / span 6` }}
				/>
			))}

			{/* Les filets verticaux, un par colonne de jour. Le dernier ferme la
			    grille à droite : sans lui la dernière journée reste ouverte, et son
			    quadrillage semble se poursuivre hors de la carte. */}
			{jours.map((jour, index) => (
				<div
					key={`filet-${jour.day.date}`}
					aria-hidden
					className={cn(
						"border-l border-border",
						index === jours.length - 1 && "border-r",
					)}
					style={{
						gridColumn: jour.colonne,
						gridRow: `${PREMIERE_LIGNE_HORAIRE} / ${ligneFinale}`,
					}}
				/>
			))}

			{/* Le trait de clôture. Il tombe sur une rangée implicite, au-delà des
			    `(fin - debut) / PAS` déclarées : haute de rien, elle ne porte que ce
			    bord. */}
			<div
				aria-hidden
				className="border-t border-border"
				style={{ gridColumn: "2 / -1", gridRow: `${ligneFinale} / span 1` }}
			/>

			{/* Le trait de l'heure courante, dans la SEULE colonne d'aujourd'hui : en
			    travers de toute la grille, il désignerait la même heure jeudi
			    prochain, ce qui ne veut rien dire. Et seulement s'il tombe dans
			    l'amplitude dessinée — collé en haut de la grille à 6 h du matin, il
			    pointerait une heure qui n'y est pas. */}
			{colonneDuJour !== null &&
				maintenant !== null &&
				maintenant >= debut &&
				maintenant < fin && (
					<div
						aria-hidden
						className="relative z-20 h-0 border-t-2 border-destructive"
						style={{
							gridColumn: colonneDuJour,
							gridRow: `${ligneDe(maintenant)} / span 1`,
						}}
					>
						<span className="absolute -left-[3px] -top-[4px] block h-1.5 w-1.5 rounded-full bg-destructive" />
					</div>
				)}
		</div>
	);
}

/** La carte posée dans la grille horaire : colonne, position, hauteur, voie. */
function CartePlacee({
	place,
	colonne,
	href,
	action,
	absence,
	teintes,
	ligneDebut,
	ligneFin,
}: {
	place: Place<Row>;
	colonne: number;
	href: string | null;
	action: (() => void) | null;
	absence: SessionAway | null;
	teintes?: TableTeintes;
	ligneDebut: number;
	ligneFin: number;
}): ReactElement {
	const { contenu, voie, voies } = place;

	// Les pourcentages d'un élément de grille se résolvent sur sa zone : la
	// largeur et la marge répartissent donc les voies dans la seule colonne du
	// jour, sans positionnement absolu ni second conteneur. La voie est prise
	// entière, et la gouttière qui fait respirer les cartes est un `padding` de
	// l'enveloppe — prise sur la largeur, elle laisserait vivre une bande morte
	// de part et d'autre de chaque carte.
	const style: CSSProperties = {
		gridColumn: colonne,
		gridRow: `${ligneDebut} / ${ligneFin}`,
		width: `${100 / voies}%`,
		marginLeft: `${(voie * 100) / voies}%`,
	};

	return (
		<div className="z-10 px-0.5 pt-px" style={style}>
			<Carte
				row={contenu}
				href={href}
				action={action}
				absence={absence}
				teintes={teintes}
				pleineHauteur
			/>
		</div>
	);
}

/**
 * Le visuel de la carte. Il ne porte ni position ni hauteur — c'est son
 * enveloppe qui les tient, et c'est ce qui permet de la réutiliser telle quelle
 * dans la rangée « heure à caler ».
 *
 * `horaire` n'est vrai que hors de la grille : dans la grille, la position dit
 * déjà l'heure, et une quatrième ligne de texte serait rognée sur une carte
 * d'une heure. Le `title=` la porte dans les deux cas.
 */
function Carte({
	row,
	href,
	action = null,
	absence = null,
	teintes,
	pleineHauteur = false,
	horaire = false,
}: {
	row: Row;
	href: string | null;
	action?: (() => void) | null;
	/** La période qui met la classe hors cours, ou `null`. Quand elle est là,
	 *  elle emporte TOUT : la carte s'estompe, écrit le motif à la place de son
	 *  état, et n'ouvre plus rien. */
	absence?: SessionAway | null;
	teintes?: TableTeintes;
	pleineHauteur?: boolean;
	horaire?: boolean;
}): ReactElement {
	const { titre, sous } = texteDe(row);
	const categorie = categorieDe(row);
	const bornes = bornesDe(row);
	const libelle = libelleHoraire(bornes.debut, bornes.fin) || "heure à caler";
	// Le motif PASSE DEVANT l'état de la séance : « appel 0/12 » sur un cours qui
	// n'a pas eu lieu réclamerait un appel que personne ne doit faire — c'est
	// exactement ce que le palier 006 a corrigé, et la carte le dit maintenant
	// au lieu de disparaître.
	const etat =
		absence === null
			? etatDe(row)
			: { texte: motsDeAbsence(absence).carte, reclame: false };
	// Une carte estompée qui ouvrirait quelque chose mentirait deux fois : rien
	// à ouvrir pour un cours qui ne s'est pas tenu, et surtout rien à créer.
	const mene = absence === null ? href : null;
	const geste = absence === null ? action : null;

	// `w-full` n'est PAS décoratif : sans lui, la carte rendue en `<button>`
	// — une séance pas encore créée, un rendez-vous — déborde sur la colonne
	// du jour suivant. Un bouton est un contrôle de formulaire : son
	// `width: auto` reste un *fit-content* même en `display: block`, donc sa
	// largeur devient le `max-content` de son contenu — et comme chaque ligne
	// du corps porte `truncate` (donc `white-space: nowrap`), ce `max-content`
	// est le titre ENTIER sur une ligne. `overflow-hidden` n'y peut rien : il
	// n'y a aucun débordement *dans* le bouton, c'est le bouton qui est trop
	// large, et `truncate` ne s'arme jamais. Les pistes de la grille sont en
	// `minmax(0, 1fr)`, ce qui empêche la colonne de s'élargir mais pas la
	// carte de peindre par-dessus la voisine. Le jumeau `CarteLibre` de
	// `WeekGrid` porte déjà ce `w-full` ; c'est ici qu'il manquait.
	const classes = cn(
		"block w-full overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight",
		pleineHauteur && "h-full",
		apparenceDe(row),
		// `opacity-40` = ce cours ne se tient pas, et c'est le même signe que sur
		// la grille de la semaine : un même estompage veut dire la même chose sur
		// les deux rendus. Pas de hachure ni de second dessin — c'est le motif
		// écrit sur la carte qui dit pourquoi.
		absence !== null && "opacity-40",
		(mene || geste) &&
			"transition-shadow hover:shadow-carte focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
	);

	// La teinte est posée sur la carte elle-même, et non sur son enveloppe : la
	// rangée « heure à caler » n'a pas d'enveloppe de grille.
	const style = styleTeinte(teintes, sessionDe(row));

	const corps = (
		<>
			<span
				className={cn(
					"block truncate font-medium",
					estAnnulee(row) && "line-through",
				)}
			>
				{titre}
			</span>
			{/* Sous l'intitulé, donc avant tout ce qui serait rogné : sur une carte
			    d'une heure — 48 px — c'est l'horaire qui saute, et la position de la
			    carte le dit déjà. */}
			<PastilleDeCategorie category={categorie} />
			{sous && <span className="block truncate opacity-80">{sous}</span>}
			{horaire && <span className="block truncate opacity-80">{libelle}</span>}
			{/* `min-w-0` des deux côtés : `text-overflow` est inopérant sur un
			    conteneur flex, et un enfant de flex garde `min-width: auto`,
			    donc refuse de rétrécir. Sans eux la coupe est franche, sans les
			    trois points qui disent qu'il manque du texte. */}
			{etat && (
				<span className="flex min-w-0 items-center gap-1 opacity-90">
					{etat.reclame && (
						<span
							aria-hidden
							className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
						/>
					)}
					<span className="min-w-0 truncate">{etat.texte}</span>
				</span>
			)}
		</>
	);

	// La catégorie accolée à l'intitulé, et non sur une ligne à elle : rognée
	// dans la pastille, c'est ici qu'elle se lit en entier.
	const entete = categorie ? `${titre} — ${categorie}` : titre;
	const infobulle =
		absence === null
			? `${entete} — ${libelle}${etat ? `\n${etat.texte}` : ""}`
			: `${entete} — ${libelle}\n${motsDeAbsence(absence).infobulle}`;

	// Un lien quand la carte MÈNE quelque part : elle doit alors s'ouvrir au clic
	// du milieu comme au clavier, ce qu'un `<button>` ne sait pas faire.
	//
	// Un `<button>` quand elle AGIT sur place — le cours dont la séance n'existe
	// pas encore. Un lien y serait un mensonge : il n'y a pas d'adresse derrière,
	// et « ouvrir dans un nouvel onglet » n'ouvrirait rien.
	//
	// Un `<div>` inerte quand elle ne fait ni l'un ni l'autre : une occupation —
	// un créneau sans classe est un modèle, il n'existe pas — et, depuis le
	// palier 020, un cours dont la classe est hors cours.
	if (mene) {
		return (
			<Link to={mene} className={classes} style={style} title={infobulle}>
				{corps}
			</Link>
		);
	}
	if (geste) {
		return (
			<button
				type="button"
				onClick={geste}
				className={classes}
				style={style}
				title={infobulle}
			>
				{corps}
			</button>
		);
	}
	return (
		<div className={classes} style={style} title={infobulle}>
			{corps}
		</div>
	);
}

export default DaysCalendar;
