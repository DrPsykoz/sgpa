import jsPDF from "jspdf";
import {
	autoTable,
	type CellInput,
	type RowInput,
	type Table,
} from "jspdf-autotable";
import { api } from "@/lib/api";
import {
	MOTS_DE_VOIE,
	VOIES,
	activitesParId,
	casesDeVoie,
	indexDesPlages,
	nomDuMois,
	tranchesParMois,
	tranchesParMotif,
	tranchesParTrimestre,
} from "@/lib/progression";
import {
	encreDeActivite,
	filetDeActivite,
	fondDeActivite,
} from "@/lib/teintes";
import {
	formatMark20,
	AVERAGE_RULE_PHRASES,
	labelDeNote,
	LEVEL_LABELS,
	MASTERY_LABELS,
	MASTERY_LEVELS,
	MOTS_DE_NATURE,
	schoolYearLabel,
	type AttendanceStats,
	type ContractRow,
	type ContractSheetInput,
	type LevelCode,
	type MasteryLevel,
	type Progression,
	type ProgressionActivite,
	type ProgressionEtape,
	type Session,
	type SessionReport,
	type StudentReport,
	type YearCalendar,
	type YearWeek,
} from "@/types";

const MARGIN_X = 15;
const MARGIN_TOP = 15;
/** Bande réservée au pied de page « Édité le … — page N/M ». */
const MARGIN_BOTTOM = 18;

const GREY: [number, number, number] = [110, 110, 110];
const INK: [number, number, number] = [25, 25, 25];
const RULE: [number, number, number] = [205, 205, 205];
/** Filet des grilles de la fiche contrat : plus sombre que `RULE`, parce
 *  qu'une trame se remplit au stylo et doit tenir à la photocopie. */
const GRID: [number, number, number] = [120, 120, 120];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `2025-12-01` → `01/12/2025`. Le `T00:00:00` force l'heure locale : sans lui,
 *  `new Date("2025-12-01")` vaut minuit UTC et recule d'un jour à l'affichage. */
function formatDate(iso: string): string {
	if (!ISO_DATE.test(iso)) return iso;
	return new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR");
}

function formatAverage(value: number): string {
	return value.toLocaleString("fr-FR", {
		minimumFractionDigits: 1,
		maximumFractionDigits: 1,
	});
}

function plural(count: number): string {
	return count > 1 ? "s" : "";
}

/** Le backend assainit déjà le nom, mais un nom de classe contient couramment
 *  une barre oblique (« 4ème A/B ») : autant lui envoyer un nom déjà valide. */
function slug(value: string): string {
	const cleaned = value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^A-Za-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
	return cleaned || "classe";
}

/** `autoTable` ne renvoie rien : la position de fin est déposée sur le document. */
function tableEndY(doc: jsPDF, fallback: number): number {
	const last = (doc as unknown as { lastAutoTable?: Table | false })
		.lastAutoTable;
	return last && typeof last.finalY === "number" ? last.finalY : fallback;
}

function attendanceLines(attendance: AttendanceStats): string[] {
	const suivies = attendance.present + attendance.retard;
	const lines = [
		`Présence : ${suivies}/${attendance.seances_applicables} séance${plural(
			attendance.seances_applicables,
		)} (présences et retards)`,
		`Présent : ${attendance.present}   ·   Retard : ${attendance.retard}   ·   Absent : ${attendance.absent}   ·   Excusé : ${attendance.excuse}`,
	];
	if (attendance.non_renseigne > 0) {
		lines.push(
			`${attendance.non_renseigne} séance${plural(
				attendance.non_renseigne,
			)} non pointée${plural(attendance.non_renseigne)}`,
		);
	}
	if (attendance.hors_inscription > 0) {
		lines.push(
			`${attendance.hors_inscription} séance${plural(
				attendance.hors_inscription,
			)} hors de sa période d'inscription, non comptabilisée${plural(
				attendance.hors_inscription,
			)}`,
		);
	}
	// Sans cette ligne, le bilan remis à la famille ne s'additionne plus :
	// l'en-tête annonce 26 séances au trimestre et l'élève affiche 20/20.
	// Compteur distinct des deux précédents — la séance elle-même sort du
	// dénominateur, l'élève n'est pas « absent excusé » dessus.
	if (attendance.seances_neutralisees > 0) {
		lines.push(
			`${attendance.seances_neutralisees} séance${plural(
				attendance.seances_neutralisees,
			)} pendant une absence justifiée, non comptabilisée${plural(
				attendance.seances_neutralisees,
			)}`,
		);
	}
	// Quatrième et dernier terme de la partition, né au palier 023 et nul sur
	// toute classe non dédoublée. Même raison que les deux précédents : sans
	// lui, l'en-tête annonce 26 séances au trimestre et l'élève affiche 16/16.
	if (attendance.seances_autre_groupe > 0) {
		lines.push(
			`${attendance.seances_autre_groupe} séance${plural(
				attendance.seances_autre_groupe,
			)} tenue${plural(
				attendance.seances_autre_groupe,
			)} avec un autre groupe, non comptabilisée${plural(
				attendance.seances_autre_groupe,
			)}`,
		);
	}
	return lines;
}

/**
 * Produit le bilan du trimestre, l'enregistre dans `<clé>/exports/` et renvoie
 * son chemin complet.
 *
 * Volontairement pas de `doc.save()` : le téléchargement navigateur déposait des
 * bilans nominatifs d'élèves mineurs dans le dossier Téléchargements du poste.
 *
 * `openAfter` est faux par défaut : ouvrir le PDF confie son chemin au lecteur
 * du poste hôte, qui l'inscrit dans ses documents récents. Sur un poste partagé,
 * le nom de la classe reste alors affiché longtemps après le débranchement de la
 * clé. À l'appelant de le proposer, jamais de l'imposer.
 */
export async function exportReportPDF(
	report: SessionReport,
	schoolName: string,
	openAfter: boolean = false,
): Promise<string> {
	const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
	const pageWidth = doc.internal.pageSize.getWidth();
	const pageHeight = doc.internal.pageSize.getHeight();
	const contentWidth = pageWidth - MARGIN_X * 2;
	const centerX = pageWidth / 2;
	const bottomLimit = pageHeight - MARGIN_BOTTOM;

	const levelLabel = LEVEL_LABELS[report.level_code] ?? report.level_code;
	const yearLabel = schoolYearLabel(report.year_start);

	doc.setProperties({
		title: `Bilan T${report.trimester} — ${report.session_name} — ${yearLabel}`,
		subject: "Bilan de compétences",
		creator: "SGPA",
		author: schoolName || "SGPA",
	});

	let y = MARGIN_TOP;
	/** Nom rappelé en haut des pages ouvertes par `ensure`. */
	let continuation = "";

	/** Ouvre une page dès que le bloc à écrire ne tient plus dans la zone utile.
	 *  Sans ce garde-fou, la moyenne générale et le commentaire étaient dessinés
	 *  hors page dès qu'un élève avait assez de compétences pour remplir la
	 *  première. */
	const ensure = (height: number) => {
		if (y + height <= bottomLimit) return;
		doc.addPage();
		y = MARGIN_TOP;
		if (!continuation) return;
		doc.setFont("helvetica", "italic");
		doc.setFontSize(9);
		doc.setTextColor(...GREY);
		doc.text(`${continuation} (suite)`, MARGIN_X, y);
		y += 7;
	};

	const drawHeader = () => {
		if (schoolName) {
			doc.setFont("helvetica", "normal");
			doc.setFontSize(9);
			doc.setTextColor(...GREY);
			doc.text(schoolName, MARGIN_X, y);
			y += 6;
		}

		doc.setFont("helvetica", "bold");
		doc.setFontSize(16);
		doc.setTextColor(...INK);
		doc.text("Bilan de compétences", centerX, y, { align: "center" });
		y += 7;

		doc.setFont("helvetica", "normal");
		doc.setFontSize(11);
		doc.text(
			`${report.session_name} — ${levelLabel} — ${yearLabel}`,
			centerX,
			y,
			{ align: "center" },
		);
		y += 6;

		doc.setFontSize(10);
		doc.text(
			`Trimestre ${report.trimester} — du ${formatDate(
				report.trimester_start,
			)} au ${formatDate(report.trimester_end)}`,
			centerX,
			y,
			{ align: "center" },
		);
		y += 5;

		doc.setFontSize(9);
		doc.setTextColor(...GREY);
		const cancelled =
			report.cancelled_count > 0
				? ` (dont ${report.cancelled_count} annulée${plural(
						report.cancelled_count,
					)})`
				: "";
		doc.text(
			`${report.seance_count} séance${plural(
				report.seance_count,
			)} au trimestre${cancelled}`,
			centerX,
			y,
			{ align: "center" },
		);
		y += 5;

		doc.setDrawColor(...RULE);
		doc.setLineWidth(0.3);
		doc.line(MARGIN_X, y, pageWidth - MARGIN_X, y);
		y += 8;
		doc.setTextColor(...INK);
	};

	const drawStudent = (student: StudentReport) => {
		const fullName = `${student.student_last_name} ${student.student_first_name}`;
		continuation = fullName;

		doc.setFont("helvetica", "bold");
		doc.setFontSize(14);
		doc.setTextColor(...INK);
		doc.text(fullName, MARGIN_X, y);
		y += 8;

		// ---- Moyennes par compétence ----
		if (student.competency_averages.length > 0) {
			autoTable(doc, {
				startY: y,
				margin: {
					top: MARGIN_TOP,
					bottom: MARGIN_BOTTOM,
					left: MARGIN_X,
					right: MARGIN_X,
				},
				head: [
					[
						"Domaine",
						"Champ",
						"Compétence",
						"Niveau atteint",
						"Moy.",
						"Notes",
					],
				],
				body: student.competency_averages.map((competency) => [
					competency.domain_name,
					competency.field_name,
					competency.competency_name,
					labelDeNote(competency.average_mark),
					`${formatAverage(competency.average_mark)}/20`,
					String(competency.grade_count),
				]),
				theme: "grid",
				styles: {
					fontSize: 8,
					cellPadding: 1.6,
					overflow: "linebreak",
					textColor: INK,
					lineColor: RULE,
					lineWidth: 0.1,
				},
				headStyles: {
					fillColor: [45, 45, 45],
					textColor: [255, 255, 255],
					fontStyle: "bold",
					fontSize: 8,
				},
				columnStyles: {
					0: { cellWidth: 30 },
					1: { cellWidth: 30 },
					2: { cellWidth: 56 },
					3: { cellWidth: 38 },
					4: { cellWidth: 14, halign: "center" },
					5: { cellWidth: 12, halign: "center" },
				},
			});
			y = tableEndY(doc, y) + 8;
		} else {
			ensure(6);
			doc.setFont("helvetica", "italic");
			doc.setFontSize(10);
			doc.setTextColor(...GREY);
			doc.text("Aucune note saisie sur ce trimestre.", MARGIN_X, y);
			y += 10;
		}

		// ---- Moyenne générale ----
		ensure(14);
		doc.setFont("helvetica", "bold");
		doc.setFontSize(11);
		doc.setTextColor(...INK);
		if (student.overall_average === null) {
			// Jamais « 0,0/20 » : sur un document remis à une famille, cela se lit
			// comme une maîtrise nulle et non comme une absence de note. Depuis le
			// palier 018, 0 n'est d'ailleurs plus une note que l'enseignant puisse
			// saisir — l'écrire ici serait une invention de l'application.
			doc.text("Moyenne générale : —", MARGIN_X, y);
			y += 5;
			doc.setFont("helvetica", "normal");
			doc.setFontSize(9);
			doc.setTextColor(...GREY);
			doc.text("(non évalué ce trimestre)", MARGIN_X, y);
			y += 5;
		} else {
			doc.text(
				`Moyenne générale : ${formatAverage(student.overall_average)}/20`,
				MARGIN_X,
				y,
			);
			y += 5;
			doc.setFont("helvetica", "normal");
			doc.setFontSize(8);
			doc.setTextColor(...GREY);
			doc.text(
				`Règle de calcul : ${
					AVERAGE_RULE_PHRASES[report.average_rule] ?? report.average_rule
				}`,
				MARGIN_X,
				y,
			);
			y += 5;
		}
		y += 4;

		// ---- Assiduité ----
		// Le bloc est réservé en entier, titre compris : il compte désormais
		// jusqu'à cinq lignes, et un `ensure` par ligne laissait « Assiduité »
		// seul en bas de page, ses chiffres renvoyés à la suivante. Au pire
		// 30 mm, très loin de la hauteur utile d'une page.
		const attendanceBlock = attendanceLines(student.attendance);
		ensure(5 + attendanceBlock.length * 5);
		doc.setFont("helvetica", "bold");
		doc.setFontSize(10);
		doc.setTextColor(...INK);
		doc.text("Assiduité", MARGIN_X, y);
		y += 5;
		doc.setFont("helvetica", "normal");
		doc.setFontSize(9);
		for (const line of attendanceBlock) {
			doc.text(line, MARGIN_X, y);
			y += 5;
		}
		y += 4;

		// ---- Commentaire ----
		if (student.teacher_comment.trim()) {
			ensure(10);
			doc.setFont("helvetica", "bold");
			doc.setFontSize(10);
			doc.setTextColor(...INK);
			doc.text("Commentaire de l'enseignant", MARGIN_X, y);
			y += 5;
			doc.setFont("helvetica", "normal");
			doc.setFontSize(9);
			const lines: string[] = doc.splitTextToSize(
				student.teacher_comment.trim(),
				contentWidth,
			);
			for (const line of lines) {
				ensure(5);
				// `ensure` laisse la police en italique gris quand il ouvre une
				// page : sans ce rappel, la suite d'une appréciation coupée par
				// un saut de page change de voix au milieu d'une phrase, sur un
				// document remis à la famille.
				doc.setFont("helvetica", "normal");
				doc.setFontSize(9);
				doc.setTextColor(...INK);
				doc.text(line, MARGIN_X, y);
				y += 5;
			}
		}

		continuation = "";
	};

	if (report.students.length === 0) {
		drawHeader();
		doc.setFont("helvetica", "italic");
		doc.setFontSize(10);
		doc.setTextColor(...GREY);
		doc.text("Aucun élève dans cette classe.", MARGIN_X, y);
	} else {
		report.students.forEach((student, index) => {
			// Un élève par page : le bilan est remis famille par famille.
			if (index > 0) doc.addPage();
			y = MARGIN_TOP;
			drawHeader();
			drawStudent(student);
		});
	}

	// ---- Pied de page ----
	// En dernier seulement : le nombre total de pages n'est connu qu'ici.
	const pageCount = doc.getNumberOfPages();
	const editedOn = new Date().toLocaleDateString("fr-FR");
	for (let page = 1; page <= pageCount; page += 1) {
		doc.setPage(page);
		doc.setFont("helvetica", "normal");
		doc.setFontSize(8);
		doc.setTextColor(...GREY);
		doc.text(
			`Édité le ${editedOn} — page ${page}/${pageCount}`,
			centerX,
			pageHeight - 10,
			{ align: "center" },
		);
	}

	const fileName = `Bilan-${slug(report.session_name)}-T${
		report.trimester
	}-${yearLabel}.pdf`;
	const bytes = Array.from(new Uint8Array(doc.output("arraybuffer")));
	return await api.saveExport(fileName, bytes, openAfter);
}

// ===========================================================================
//  Fiche contrat
// ===========================================================================

/** Ce que la fiche doit dire d'elle-même et que `contract_sheets` ne porte pas :
 *  la classe vient de la session, le titre de l'évaluation en est le support. */
export interface ContractSheetContext {
	session_name: string;
	level_code: LevelCode;
	year_start: number;
	evaluation_title: string;
}

/** Clé de fusion verticale d'une ligne du socle.
 *
 *  `null` = « ne fusionne avec personne ». Deux cases vides côte à côte ne se
 *  fondent donc pas en une seule haute : sur une fiche encore à remplir, la
 *  trame perdrait les lignes horizontales qui servent à écrire à la main.
 *
 *  L'identifiant passe devant le texte : c'est lui qui dit qu'il s'agit de la
 *  même compétence, même si l'enseignant a reformulé son libellé.
 *
 *  **Exportée pour l'éditeur**, qui groupe ses lignes avec cette fonction-ci :
 *  ce qu'il montre comme un bloc est donc, par construction, ce que le PDF
 *  imprimera comme une cellule. Une seconde règle de regroupement écrite à
 *  côté finirait par promettre à l'écran une fusion que l'impression ne fait
 *  pas. */
export function socleMergeKey(row: ContractRow): string | null {
	if (row.competency_id) return `id:${row.competency_id}`;
	const text = `${row.socle_domain_label}\u0000${row.socle_competency_label}`;
	return text.trim() ? `txt:${text}` : null;
}

/**
 * Hauteur de fusion de chaque ligne : `n >= 1` ouvre une cellule de `n` lignes,
 * `0` est une ligne couverte par la cellule du dessus, qui ne doit donc rien
 * émettre dans cette colonne — `autoTable` attend alors un tableau plus court.
 */
function mergeSpans(
	count: number,
	key: (index: number) => string | null,
): number[] {
	const spans = new Array<number>(count).fill(1);
	let start = 0;
	while (start < count) {
		const current = key(start);
		let end = start + 1;
		if (current !== null) {
			while (end < count && key(end) === current) end += 1;
		}
		spans[start] = end - start;
		for (let covered = start + 1; covered < end; covered += 1) {
			spans[covered] = 0;
		}
		start = end;
	}
	return spans;
}

/** Une ligne entièrement vide n'apprend rien et mange une page : elle ne
 *  s'imprime pas. L'éditeur, lui, la garde — c'est là qu'on remplit. */
function rowIsBlank(row: ContractRow): boolean {
	return (
		row.student_activity.trim() === "" &&
		row.training_activity.trim() === "" &&
		row.socle_domain_label.trim() === "" &&
		row.socle_competency_label.trim() === ""
	);
}

/** Réglages d'une tentative de mise en page.
 *
 *  La fiche doit tenir sur une seule feuille, et rien ne doit en être retiré
 *  pour y arriver : la seule variable est donc la taille. On dessine, on
 *  compte les pages, et on recommence un cran plus bas tant qu'il y en a
 *  deux. */
interface ContractScale {
	/** Corps des cellules, en points. */
	font: number;
	/** Marge intérieure d'une cellule, en millimètres. */
	pad: number;
	/** Le surtitre « FICHE CONTRAT » et le nom de l'établissement. */
	kicker: number;
	/** L'intitulé du projet, seul à cette taille sur toute la feuille. */
	title: number;
	/** Les étiquettes « CLASSE », « CHAMP PROFESSIONNEL »… */
	label: number;
	/** Les valeurs qu'elles désignent. */
	value: number;
	/** Blanc entre deux tableaux. */
	gap: number;
}

/** Du confortable au serré. Le dernier cran sert de filet : s'il déborde
 *  encore, la fiche s'imprime sur deux pages plutôt que de devenir illisible —
 *  une grille qu'on ne peut pas lire ne vaut pas mieux qu'une feuille de
 *  plus.
 *
 *  L'écart entre `title` et `value` ne se referme jamais complètement : c'est
 *  lui qui dit au premier coup d'œil quelle est l'information principale, et
 *  une fiche serrée n'a pas moins besoin d'être lisible qu'une fiche aérée. */
const CONTRACT_SCALES: ContractScale[] = [
	{ font: 8, pad: 1.8, kicker: 7.5, title: 17, label: 6.5, value: 10, gap: 6 },
	{
		font: 7.5,
		pad: 1.5,
		kicker: 7,
		title: 15.5,
		label: 6.5,
		value: 9.5,
		gap: 5.5,
	},
	{ font: 7, pad: 1.3, kicker: 7, title: 14, label: 6, value: 9, gap: 5 },
	{ font: 6.5, pad: 1.1, kicker: 6.5, title: 13, label: 6, value: 8.5, gap: 4.5 },
	{ font: 6, pad: 0.9, kicker: 6, title: 12, label: 5.5, value: 8, gap: 4 },
	{ font: 5.5, pad: 0.8, kicker: 6, title: 11, label: 5.5, value: 7.5, gap: 3.5 },
];

/** Hauteur d'une ligne de texte, en millimètres, pour un corps donné en
 *  points. Un point vaut 0,3528 mm et l'interligne usuel 1,2 corps. */
function lineHeight(fontSize: number): number {
	return fontSize * 0.3528 * 1.2;
}

/**
 * Dessine la fiche entière à une taille donnée et rend le document. Le pied de
 * page n'y est pas : il demande le nombre total de pages, qui n'est connu
 * qu'une fois la taille retenue.
 */
function renderContractSheet(
	sheet: ContractSheetInput,
	context: ContractSheetContext,
	schoolName: string,
	scale: ContractScale,
): jsPDF {
	// Portrait : la fiche est faite pour être distribuée et rangée avec le
	// reste du classeur de l'élève, pas pour être affichée.
	const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
	const pageWidth = doc.internal.pageSize.getWidth();
	const contentWidth = pageWidth - MARGIN_X * 2;

	const levelLabel = LEVEL_LABELS[context.level_code] ?? context.level_code;
	const yearLabel = schoolYearLabel(context.year_start);
	const title = sheet.project_title.trim() || context.evaluation_title.trim();

	doc.setProperties({
		title: `Fiche contrat — ${title}`,
		subject: "Fiche contrat de séquence",
		creator: "SGPA",
		author: schoolName || "SGPA",
	});

	const tableMargin = {
		top: MARGIN_TOP,
		bottom: MARGIN_BOTTOM,
		left: MARGIN_X,
		right: MARGIN_X,
	};

	// Son classeur centre chaque cellule, horizontalement et verticalement, et
	// laisse le texte revenir à la ligne. Un alignement en haut à gauche ferait
	// flotter les cellules fusionnées hautes tout en haut de leur bloc, là où
	// les siennes se tiennent au milieu, en face de ce qu'elles couvrent.
	const baseStyles = {
		fontSize: scale.font,
		cellPadding: scale.pad,
		overflow: "linebreak" as const,
		textColor: INK,
		lineColor: GRID,
		lineWidth: 0.1,
		halign: "center" as const,
		valign: "middle" as const,
	};
	// Pas de bandeau noir : ses en-têtes sont du gras centré sur fond clair,
	// dans la même grille que le reste. Une fiche imprimée se remplit au stylo.
	const headStyles = {
		fillColor: [238, 238, 238] as [number, number, number],
		textColor: INK,
		fontStyle: "bold" as const,
		fontSize: scale.font,
		halign: "center" as const,
		valign: "middle" as const,
	};

	// Largeurs reprises du classeur. Les deux tableaux larges valent 3-3-4
	// colonnes du tableur, celui des activités 2-2-2-4 : « compétences » est
	// deux fois plus large que ses voisines, et c'est elle qui porte les
	// phrases les plus longues.
	const unit = contentWidth / 10;
	const wide3 = [unit * 3, unit * 3, contentWidth - unit * 6];
	const act4 = [unit * 2, unit * 2, unit * 2, contentWidth - unit * 6];

	let y = MARGIN_TOP;

	// ---- En-tête ----
	// Trois niveaux, et non trois lignes de même poids : on doit savoir sans
	// lire de quoi parle la feuille.
	//
	//   FICHE CONTRAT                              Collège Jean Moulin
	//   ───────────────────────────────────────────────────────────────
	//   Fabrication d'un composteur de jardin
	//
	//   CLASSE            CHAMP PROFESSIONNEL      ANNÉE SCOLAIRE
	//   4A — 4ème         Habitat                  2021-2022
	//
	// Le nom du document passe en surtitre : il dit ce qu'on tient, pas de
	// quoi il s'agit. Ce que la feuille raconte, c'est le PROJET — seul à sa
	// taille sur toute la page. Le reste est du contexte, et du contexte
	// s'étiquette : une valeur sans son étiquette oblige à deviner si
	// « Habitat » est une classe, un champ ou une salle.

	doc.setFont("helvetica", "bold");
	doc.setFontSize(scale.kicker);
	doc.setTextColor(...GREY);
	doc.text("FICHE CONTRAT", MARGIN_X, y, { charSpace: 0.5 });
	if (schoolName) {
		doc.setFont("helvetica", "normal");
		doc.text(schoolName, pageWidth - MARGIN_X, y, { align: "right" });
	}

	y += 2.2;
	doc.setDrawColor(...INK);
	doc.setLineWidth(0.5);
	doc.line(MARGIN_X, y, pageWidth - MARGIN_X, y);

	// L'intitulé du projet. Sans titre saisi, celui de l'évaluation sert de
	// repli — une fiche sans titre n'est pas identifiable une fois imprimée.
	doc.setFont("helvetica", "bold");
	doc.setFontSize(scale.title);
	doc.setTextColor(...INK);
	const titleLead = lineHeight(scale.title);
	y += scale.gap;
	for (const line of doc.splitTextToSize(title, contentWidth) as string[]) {
		y += titleLead;
		doc.text(line, MARGIN_X, y);
	}

	// ---- Les repères de contexte ----
	// Une colonne par information, étiquette grise au-dessus de sa valeur. Une
	// information absente ne laisse pas de colonne vide : elle disparaît et
	// les autres se répartissent la largeur. Le champ professionnel manque
	// tant que l'enseignant ne l'a pas choisi, et un trou étiqueté se lit
	// comme un oubli de l'application.
	const champ = sheet.professional_field_label.trim();
	const classe = [
		context.session_name,
		levelLabel === context.session_name ? "" : levelLabel,
	]
		.filter((part) => part !== "")
		.join(" — ");

	const facts = [
		{ label: "CLASSE", value: classe },
		{ label: "CHAMP PROFESSIONNEL", value: champ },
		{ label: "ANNÉE SCOLAIRE", value: yearLabel },
	].filter((fact) => fact.value !== "");

	if (facts.length > 0) {
		y += scale.gap + 1;
		const column = contentWidth / facts.length;
		const labelLead = lineHeight(scale.label);
		const valueLead = lineHeight(scale.value);
		let tallest = 0;

		for (const [index, fact] of facts.entries()) {
			const x = MARGIN_X + column * index;

			doc.setFont("helvetica", "normal");
			doc.setFontSize(scale.label);
			doc.setTextColor(...GREY);
			doc.text(fact.label, x, y + labelLead, { charSpace: 0.35 });

			doc.setFont("helvetica", "bold");
			doc.setFontSize(scale.value);
			doc.setTextColor(...INK);
			// `column - 4` : une gouttière, sinon une valeur longue vient
			// toucher l'étiquette de la colonne suivante et les deux se lisent
			// comme une seule phrase.
			const lines = doc.splitTextToSize(fact.value, column - 4) as string[];
			lines.forEach((line, row) => {
				doc.text(line, x, y + labelLead + 1.2 + valueLead * (row + 1));
			});
			tallest = Math.max(tallest, labelLead + 1.2 + valueLead * lines.length);
		}

		y += tallest;
	}

	y += scale.gap + 2;

	// ---- Identité du projet ----
	// Trois colonnes côte à côte, en-tête puis valeur, exactement comme la
	// première grille de son classeur. Le tableau s'imprime même vide : c'est
	// une trame, et ses trois cases se remplissent aussi à la main.
	//
	// Son classeur intitulait la première « domaine du socle », à tort : ce
	// qu'il y écrivait — « AMENAGEMENT AGENCEMENT FINITION » — est un
	// sous-ensemble du champ professionnel, et les vrais domaines du socle ont
	// leur colonne dans la grille du dessous. Le palier 024 lui rend son nom,
	// celui de RA16 : **domaine d'activité**. C'est l'enseignant qui l'a
	// demandé le 2026-11-12, donc le renommage ne lui fait pas perdre sa
	// fiche — il la lui rend juste exacte.
	autoTable(doc, {
		startY: y,
		margin: tableMargin,
		head: [
			[
				"Domaine d'activité",
				"Activité de référence",
				"Parcours / métiers ciblés",
			],
		],
		body: [
			[
				identiteDuProjet(
					sheet.activity_domain_label,
					sheet.professional_subset,
				),
				identiteDuProjet(
					sheet.reference_activity_label,
					sheet.reference_activities,
				),
				identiteDuProjet(sheet.career_label, sheet.target_careers),
			],
		],
		theme: "grid",
		styles: baseStyles,
		headStyles,
		columnStyles: {
			0: { cellWidth: wide3[0] },
			1: { cellWidth: wide3[1] },
			2: { cellWidth: wide3[2] },
		},
	});
	y = tableEndY(doc, y) + scale.gap;

	// ---- Activités et socle commun ----
	const rows = [...sheet.rows]
		.sort((a, b) => a.position - b.position)
		.filter((row) => !rowIsBlank(row));
	const socleSpan = mergeSpans(rows.length, (index) =>
		socleMergeKey(rows[index]),
	);

	// La fusion de « activités de formation » reste à l'intérieur d'un bloc du
	// socle : ainsi une cellule est toujours contenue dans celle de sa droite,
	// jamais à cheval sur deux. Une grille emboîtée se dessine sans surprise,
	// une grille décalée non — et sa fiche est emboîtée : chez lui, une
	// compétence du socle couvre trois cellules d'activités de formation.
	const trainingSpan = new Array<number>(rows.length).fill(1);
	for (let start = 0; start < rows.length; start += socleSpan[start]) {
		const size = socleSpan[start];
		const inner = mergeSpans(size, (offset) => {
			const text = rows[start + offset].training_activity.trim();
			return text ? `txt:${text}` : null;
		});
		for (let offset = 0; offset < size; offset += 1) {
			trainingSpan[start + offset] = inner[offset];
		}
	}

	const body: RowInput[] = rows.map((row, index) => {
		const cells: CellInput[] = [{ content: row.student_activity }];
		if (trainingSpan[index] > 0) {
			cells.push({
				content: row.training_activity,
				rowSpan: trainingSpan[index],
			});
		}
		if (socleSpan[index] > 0) {
			cells.push(
				{ content: row.socle_domain_label, rowSpan: socleSpan[index] },
				{ content: row.socle_competency_label, rowSpan: socleSpan[index] },
			);
		}
		return cells;
	});

	// La grille s'imprime même sans ligne : son en-tête à deux niveaux est la
	// trame, et une fiche vierge sert à la remplir au stylo.
	autoTable(doc, {
		startY: y,
		margin: tableMargin,
		head: [
			[
				{ content: "Activités des élèves", rowSpan: 2 },
				{ content: "Activités de formation", rowSpan: 2 },
				{ content: "Mise en relation avec le socle commun", colSpan: 2 },
			],
			["Domaines", "Compétences"],
		],
		body,
		theme: "grid",
		styles: baseStyles,
		headStyles,
		columnStyles: {
			0: { cellWidth: act4[0] },
			1: { cellWidth: act4[1] },
			2: { cellWidth: act4[2] },
			3: { cellWidth: act4[3] },
		},
	});
	y = tableEndY(doc, y) + scale.gap;

	// ---- On donne / on demande / on exige ----
	// Troisième bloc de son classeur, aux mêmes largeurs que le premier. Les
	// lignes entièrement vides sautent — elles n'apprennent rien — mais
	// l'en-tête reste, pour la même raison que les deux grilles du dessus.
	const requirements = [...sheet.requirements]
		.sort((a, b) => a.position - b.position)
		.filter(
			(line) =>
				line.given_text.trim() !== "" ||
				line.asked_text.trim() !== "" ||
				line.required_text.trim() !== "",
		);

	autoTable(doc, {
		startY: y,
		margin: tableMargin,
		head: [["ON DONNE", "ON DEMANDE", "ON EXIGE"]],
		body: requirements.map((line) => [
			line.given_text,
			line.asked_text,
			line.required_text,
		]),
		theme: "grid",
		styles: baseStyles,
		headStyles,
		columnStyles: {
			0: { cellWidth: wide3[0] },
			1: { cellWidth: wide3[1] },
			2: { cellWidth: wide3[2] },
		},
	});

	return doc;
}

/**
 * Produit la fiche contrat du projet, l'enregistre dans `<clé>/exports/` et
 * renvoie son chemin complet. Mêmes règles que `exportReportPDF` : pas de
 * `doc.save()`, et `openAfter` faux par défaut.
 *
 * **Portrait, une seule feuille.** La fiche est distribuée et rangée dans le
 * classeur de l'élève ; une fiche à cheval sur deux pages coupe une grille en
 * deux et perd la cellule fusionnée qui tenait la coupure. Comme rien ne doit
 * en être retiré pour y arriver, la fiche est dessinée en entier, les pages
 * sont comptées, et on recommence un cran plus petit tant qu'il y en a deux.
 * Dessiner coûte quelques millisecondes : c'est moins cher que deviner.
 *
 * La mise en page suit celle de son classeur, bloc par bloc : le titre et les
 * deux lignes d'en-tête alignés à gauche, le tableau d'identité du projet à
 * **trois colonnes côte à côte**, la grille des activités à quatre colonnes
 * sous un en-tête à deux niveaux, puis « on donne / on demande / on exige ».
 * Même les largeurs sont les siennes : ses colonnes fusionnées valent 3-3-4
 * unités pour les deux tableaux larges, 2-2-2-4 pour celui des activités.
 *
 * La fusion verticale n'est pas une coquetterie de mise en page. Sur sa fiche,
 * une compétence du socle couvre trois activités d'un seul tenant ; la recopier
 * trois fois la ferait compter trois fois au moment de noter. Le PDF imprime
 * donc ce que la base dit : des lignes voisines qui partagent une compétence
 * partagent une cellule.
 */
export async function exportContractSheetPDF(
	sheet: ContractSheetInput,
	context: ContractSheetContext,
	schoolName: string,
	openAfter: boolean = false,
): Promise<string> {
	let doc = renderContractSheet(sheet, context, schoolName, CONTRACT_SCALES[0]);
	for (
		let attempt = 1;
		attempt < CONTRACT_SCALES.length && doc.getNumberOfPages() > 1;
		attempt += 1
	) {
		doc = renderContractSheet(
			sheet,
			context,
			schoolName,
			CONTRACT_SCALES[attempt],
		);
	}

	// ---- Pied de page ----
	// En dernier : le nombre total de pages n'est connu qu'ici. Il reste utile
	// même sur une page — c'est la date d'édition qui dit si la fiche affichée
	// au mur est celle d'avant ou d'après la dernière correction.
	const pageWidth = doc.internal.pageSize.getWidth();
	const pageHeight = doc.internal.pageSize.getHeight();
	const pageCount = doc.getNumberOfPages();
	const editedOn = new Date().toLocaleDateString("fr-FR");
	for (let page = 1; page <= pageCount; page += 1) {
		doc.setPage(page);
		doc.setFont("helvetica", "normal");
		doc.setFontSize(8);
		doc.setTextColor(...GREY);
		doc.text(
			pageCount > 1
				? `Édité le ${editedOn} — page ${page}/${pageCount}`
				: `Édité le ${editedOn}`,
			pageWidth / 2,
			pageHeight - 10,
			{ align: "center" },
		);
	}

	const title = sheet.project_title.trim() || context.evaluation_title.trim();
	const fileName = `Fiche-contrat-${slug(title)}-${slug(
		context.session_name,
	)}.pdf`;
	const bytes = Array.from(new Uint8Array(doc.output("arraybuffer")));
	return await api.saveExport(fileName, bytes, openAfter);
}

// ===========================================================================
//  Fiche d'évaluation
// ===========================================================================

/** Un élève, et ce qu'il a obtenu sur cette évaluation.
 *
 *  `mark20` est **calculée par l'appelant**, pas ici. L'écran de notation
 *  affiche déjà une moyenne /20 par élève, lue sur les compétences de
 *  l'ÉVALUATION via `moyenneDesNotes` : la recalculer ici sur les lignes de la
 *  fiche donnerait un second chiffre pour le même élève — la fiche peut citer
 *  une compétence que l'évaluation ne note pas, ou n'en citer aucune. Un seul
 *  calcul, un seul nombre.
 *
 *  **Et c'est la SEULE note que ce document porte.** L'élève lit un libellé de
 *  maîtrise par compétence — une croix dans l'une des colonnes de l'échelle —
 *  et sa moyenne sur l'évaluation, jamais le 9/20 qui a produit la croix. Décision
 *  de l'auteur du 2026-11-07, et elle est tenue par la FORME de ce type :
 *  `levels` ne porte que des degrés, la note par compétence n'arrive même pas
 *  jusqu'ici. Ne pas y ajouter un champ qui la ferait venir. */
export interface EvaluationSheetStudent {
	id: string;
	/** « Léa BERNARD ». Composé par l'appelant : la fiche est nominative, et
	 *  c'est la seule chose qui distingue deux pages par ailleurs identiques. */
	full_name: string;
	/** Degré de maîtrise obtenu, par identifiant de compétence — **déduit de la
	 *  note** par l'appelant, qui est le seul à la connaître. Une compétence
	 *  absente ne reçoit **aucune croix** : non évalué n'est pas « insuffisant ».
	 *  C'est la même règle que l'appel non fait, qui ne vaut pas « présent ».
	 *  Depuis le palier 018 il n'y a plus de degré `0` : l'absence d'évaluation
	 *  est l'absence de clé dans cet objet, et nulle part une valeur basse. */
	levels: Record<string, MasteryLevel>;
	/** Les compétences sur lesquelles cet élève **ne sera pas évalué**, par
	 *  identifiant (palier 022).
	 *
	 *  **Ce n'est pas une note, et ce n'est pas non plus l'absence de note.**
	 *  Une compétence qui n'est ni ici ni dans `levels` est *en attente* : ses
	 *  cases restent vierges, à cocher au stylo pendant la séquence. Une
	 *  compétence citée ici reçoit, à la place des colonnes de l'échelle, un
	 *  « non évalué » écrit en toutes lettres — c'est le seul moyen qu'une
	 *  ligne volontairement laissée de côté ne se lise pas comme un oubli de
	 *  l'enseignant, et c'est exactement ce que l'auteur a demandé le
	 *  2026-11-12.
	 *
	 *  Une liste d'identifiants, donc toujours **aucune note par compétence**
	 *  dans ce type : la règle du 2026-11-07 tient par sa forme. */
	waived: string[];
	/** `null` = aucune compétence notée. La case reste alors **vide**, pas à
	 *  « — » : la fiche est un formulaire, et une case vide se remplit au stylo
	 *  pendant la séquence. L'écran, lui, dit qui n'a pas encore de note. */
	mark20: number | null;
}

/** Une case de l'identité du projet : le libellé du référentiel, la saisie
 *  libre, ou les deux.
 *
 *  **Les deux, quand les deux existent**, et c'est voulu. Le palier 024 ne
 *  vide pas les trois colonnes de texte libre du palier 001 ; tant que
 *  l'enseignant ne les a pas effacées lui-même d'un bouton, elles font partie
 *  de sa fiche et doivent sortir de l'imprimante — même règle qu'au
 *  palier 021 pour les compétences de progression saisies à la main. Les
 *  escamoter dès qu'une entrée du référentiel est choisie ferait disparaître
 *  d'un document déjà distribué une phrase que personne n'a demandé à
 *  retirer. */
function identiteDuProjet(libelleDuReferentiel: string, saisi: string): string {
	return [libelleDuReferentiel.trim(), saisi.trim()]
		.filter((part) => part !== "")
		.join("\n");
}

/** Ce que la fiche d'évaluation imprime de la fiche contrat.
 *
 *  Volontairement plus étroit que `ContractSheetInput` : ni « activités de
 *  formation », ni « activités de référence », ni « on donne / on demande / on
 *  exige » en tableau séparé. Son classeur d'évaluation n'a que quatre colonnes
 *  de texte, et une fiche qui imprimerait des colonnes que son modèle n'a pas
 *  ne serait plus la sienne. Un `ContractSheetInput` satisfait ce type tel
 *  quel : l'appelant n'a rien à convertir. */
export interface EvaluationSheetInput {
	project_title: string;
	professional_field_label: string;
	professional_subset: string;
	/** Le domaine d'activité du référentiel, quand le champ professionnel en a
	 *  un (palier 024). Il passe DEVANT `professional_subset`, qui est la
	 *  saisie libre d'avant et reste le repli. */
	activity_domain_label: string;
	rows: ContractRow[];
}

/** Les quatre niveaux, dans l'ordre de l'échelle. Non évalué n'a pas de
 *  colonne : il n'y a rien à cocher, et depuis le palier 018 ce n'est plus un
 *  niveau.
 *
 *  **L'ordre est celui de `MASTERY_LABELS`**, donc celui de `MASTERY_BANDS` :
 *  insuffisante, fragile, satisfaisante, très bonne — tranches 1-5, 6-10,
 *  11-15, 16-20. **Ils étaient cinq jusqu'au 2026-11-12**, « presque
 *  maîtrisé » occupant le milieu ; l'auteur l'a retiré ce jour-là, et ce qui
 *  reste est l'échelle du LSU. Rien n'a été retouché ici pour autant : ce
 *  tableau n'est que `MASTERY_LEVELS`, et tout ce qui dessine la grille compte
 *  ses colonnes par `MASTERY_SCALE.length`.
 *
 *  Son classeur source range « presque maîtrisé » avant « maîtrise fragile »,
 *  ce qui inversait les niveaux 2 et 3 ; la question lui avait été posée le
 *  2026-11-06 et il avait retenu l'ordre ci-dessus — le degré litigieux ayant
 *  disparu, la question ne se repose plus. L'ordre des quatre restants, lui,
 *  ne se touche pas : une échelle imprimée se lit de gauche à droite dans
 *  l'ordre où elle compte, et intervertir deux colonnes ferait valoir dix
 *  points la croix qui en vaut quinze — sur un document déjà remis à une
 *  famille. */
const MASTERY_SCALE: MasteryLevel[] = MASTERY_LEVELS;

/** Une ligne s'imprime si elle dit quelque chose dans l'une des colonnes de CE
 *  document.
 *
 *  Ce n'est pas `rowIsBlank` : celui-là ignore `required_text`, et il a raison
 *  — « on exige » n'a pas de colonne sur la fiche contrat. Ici il en a une, et
 *  une ligne qui ne porte que ce texte doit donc rester. Les deux documents
 *  peuvent ainsi avoir un nombre de lignes différent, chacun montrant les
 *  lignes qui remplissent ses propres cases.
 *
 *  **Exportée pour le panneau d'export**, qui compte les lignes de la feuille
 *  et complète la grille avant de l'imprimer : le compte qu'il annonce et ce
 *  qui sort de l'imprimante viennent ainsi de la même règle. */
export function evaluationRowIsPrintable(row: ContractRow): boolean {
	return !rowIsBlank(row) || row.required_text.trim() !== "";
}

/** Dessine les fiches de tous les élèves à une taille donnée, une page par
 *  élève, et rend le document. Pied de page exclu : il demande le nombre total
 *  de pages, qui n'est connu qu'une fois la taille retenue. */
function renderEvaluationSheets(
	sheet: EvaluationSheetInput,
	context: ContractSheetContext,
	students: EvaluationSheetStudent[],
	schoolName: string,
	scale: ContractScale,
): jsPDF {
	// Paysage, contrairement à la fiche contrat. Le tableau a neuf colonnes au
	// lieu de quatre, dont cinq qui doivent rester assez larges pour qu'on y
	// pose une croix au stylo. En portrait, « compétences » tomberait sous les
	// 30 mm alors qu'elle porte les phrases les plus longues de la feuille.
	const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
	const pageWidth = doc.internal.pageSize.getWidth();
	const contentWidth = pageWidth - MARGIN_X * 2;

	const levelLabel = LEVEL_LABELS[context.level_code] ?? context.level_code;
	const yearLabel = schoolYearLabel(context.year_start);
	const title = sheet.project_title.trim() || context.evaluation_title.trim();
	const subset =
		sheet.activity_domain_label.trim() || sheet.professional_subset.trim();
	const champ = sheet.professional_field_label.trim();
	const classe = [
		context.session_name,
		levelLabel === context.session_name ? "" : levelLabel,
	]
		.filter((part) => part !== "")
		.join(" — ");

	doc.setProperties({
		title: `Fiche d'évaluation — ${title}`,
		subject: "Fiche d'évaluation de séquence",
		creator: "SGPA",
		author: schoolName || "SGPA",
	});

	const tableMargin = {
		top: MARGIN_TOP,
		bottom: MARGIN_BOTTOM,
		left: MARGIN_X,
		right: MARGIN_X,
	};

	// Mêmes réglages de grille que la fiche contrat : les deux documents sont
	// distribués ensemble et doivent se reconnaître comme deux feuilles d'un
	// même dossier.
	const baseStyles = {
		fontSize: scale.font,
		cellPadding: scale.pad,
		overflow: "linebreak" as const,
		textColor: INK,
		lineColor: GRID,
		lineWidth: 0.1,
		halign: "center" as const,
		valign: "middle" as const,
	};
	const headStyles = {
		fillColor: [238, 238, 238] as [number, number, number],
		textColor: INK,
		fontStyle: "bold" as const,
		fontSize: scale.font,
		halign: "center" as const,
		valign: "middle" as const,
	};

	// Largeurs : les quatre colonnes de texte valent 2-2-2-3 unités, comme
	// chez lui, et les colonnes de maîtrise sont fixes. Une colonne à cocher
	// n'a pas besoin de s'élargir avec la page — elle a besoin de tenir son
	// libellé sur trois lignes et d'accueillir une croix.
	//
	// Le 9 du diviseur est la somme de ces quatre unités de texte (2+2+2+3) et
	// n'a rien à voir avec le nombre de degrés : celui-ci est lu de
	// `MASTERY_SCALE.length`, ce qui a fait passer la grille de cinq colonnes à
	// quatre le 2026-11-12 sans qu'une largeur soit retouchée.
	const tick = 15;
	const unit = (contentWidth - tick * MASTERY_SCALE.length) / 9;

	// ---- Les lignes, et leurs fusions ----
	// Mêmes fusions que la fiche contrat, par `socleMergeKey` : ce que l'écran
	// montre comme un bloc est ce que les deux PDF impriment comme une cellule.
	//
	// Les colonnes de maîtrise suivent EXACTEMENT ces fusions : une
	// compétence, un niveau, une croix. Son classeur coupe parfois les croix
	// plus fin que la compétence qui les couvre (le domaine 3 de sa feuille a
	// une compétence sur deux lignes d'activité, mais deux lignes de croix) ;
	// le suivre produirait deux croix pour une seule compétence, donc deux poids
	// dans la moyenne /20 — le défaut même que la fusion existe pour éviter.
	const rows = [...sheet.rows]
		.sort((a, b) => a.position - b.position)
		.filter(evaluationRowIsPrintable);
	const socleSpan = mergeSpans(rows.length, (index) =>
		socleMergeKey(rows[index]),
	);

	const head: RowInput[] = [
		[
			{ content: "ON DEMANDE", rowSpan: 2 },
			{ content: "ON EXIGE", rowSpan: 2 },
			{ content: "Mise en relation avec le socle commun", colSpan: 2 },
			...MASTERY_SCALE.map((level) => ({
				content: MASTERY_LABELS[level],
				rowSpan: 2,
			})),
		],
		["Domaines", "Compétences"],
	];

	const columnStyles: Record<number, { cellWidth: number }> = {
		0: { cellWidth: unit * 2 },
		1: { cellWidth: unit * 2 },
		2: { cellWidth: unit * 2 },
		3: { cellWidth: unit * 3 },
	};
	for (let column = 0; column < MASTERY_SCALE.length; column += 1) {
		columnStyles[4 + column] = { cellWidth: tick };
	}

	students.forEach((student, page) => {
		if (page > 0) doc.addPage();
		let y = MARGIN_TOP;

		// ---- En-tête ----
		// Même composition que la fiche contrat — surtitre, filet, projet, puis
		// des repères étiquetés — avec deux ajouts que ce document-ci exige :
		// le NOM DE L'ÉLÈVE, parce qu'une fiche nominative sans nom dessus n'est
		// identifiable que par celui qui l'a imprimée, et la case NOTE / 20,
		// qui est en haut à droite sur son classeur.
		doc.setFont("helvetica", "bold");
		doc.setFontSize(scale.kicker);
		doc.setTextColor(...GREY);
		doc.text("FICHE D'ÉVALUATION", MARGIN_X, y, { charSpace: 0.5 });
		if (schoolName) {
			doc.setFont("helvetica", "normal");
			doc.text(schoolName, pageWidth - MARGIN_X, y, { align: "right" });
		}

		y += 2.2;
		doc.setDrawColor(...INK);
		doc.setLineWidth(0.5);
		doc.line(MARGIN_X, y, pageWidth - MARGIN_X, y);

		// La case de la note est posée avant le titre : c'est elle qui dit
		// jusqu'où le titre peut s'étendre. Sans cette réserve, un intitulé long
		// passerait dessous et les deux se liraient l'un sur l'autre.
		const boxWidth = 32;
		const boxHeight = lineHeight(scale.title) + 8;
		const boxX = pageWidth - MARGIN_X - boxWidth;
		const boxY = y + scale.gap * 0.5;
		doc.setDrawColor(...INK);
		doc.setLineWidth(0.4);
		doc.rect(boxX, boxY, boxWidth, boxHeight);
		doc.setFont("helvetica", "normal");
		doc.setFontSize(scale.label);
		doc.setTextColor(...GREY);
		doc.text("NOTE / 20", boxX + boxWidth / 2, boxY + 4.2, {
			align: "center",
			charSpace: 0.35,
		});
		// Rien quand aucune compétence n'est notée : la case reste à remplir.
		if (student.mark20 !== null) {
			doc.setFont("helvetica", "bold");
			doc.setFontSize(scale.title * 0.75);
			doc.setTextColor(...INK);
			doc.text(
				formatMark20(student.mark20),
				boxX + boxWidth / 2,
				boxY + boxHeight - 3.2,
				{ align: "center" },
			);
		}

		// L'intitulé du projet, et sous lui le sous-ensemble du champ
		// professionnel quand il est saisi — « agencement » sous « habitat ».
		// C'est le « intitulé du projet » de son classeur.
		const titleWidth = contentWidth - boxWidth - 6;
		doc.setFont("helvetica", "bold");
		doc.setFontSize(scale.title);
		doc.setTextColor(...INK);
		const titleLead = lineHeight(scale.title);
		y += scale.gap;
		for (const line of doc.splitTextToSize(title, titleWidth) as string[]) {
			y += titleLead;
			doc.text(line, MARGIN_X, y);
		}
		if (subset) {
			doc.setFont("helvetica", "normal");
			doc.setFontSize(scale.value);
			doc.setTextColor(...GREY);
			y += lineHeight(scale.value) + 0.8;
			doc.text(subset, MARGIN_X, y);
		}

		// ---- Les repères de contexte ----
		// L'élève d'abord : c'est ce qu'on cherche en prenant la feuille dans
		// une pile. Une information absente ne laisse pas de colonne vide.
		const facts = [
			{ label: "ÉLÈVE", value: student.full_name },
			{ label: "CLASSE", value: classe },
			{ label: "CHAMP PROFESSIONNEL", value: champ },
			{ label: "ANNÉE SCOLAIRE", value: yearLabel },
		].filter((fact) => fact.value !== "");

		if (facts.length > 0) {
			y = Math.max(y, boxY + boxHeight) + scale.gap;
			const column = contentWidth / facts.length;
			const labelLead = lineHeight(scale.label);
			const valueLead = lineHeight(scale.value);
			let tallest = 0;

			for (const [index, fact] of facts.entries()) {
				const x = MARGIN_X + column * index;

				doc.setFont("helvetica", "normal");
				doc.setFontSize(scale.label);
				doc.setTextColor(...GREY);
				doc.text(fact.label, x, y + labelLead, { charSpace: 0.35 });

				doc.setFont("helvetica", "bold");
				doc.setFontSize(scale.value);
				doc.setTextColor(...INK);
				const lines = doc.splitTextToSize(fact.value, column - 4) as string[];
				lines.forEach((line, row) => {
					doc.text(line, x, y + labelLead + 1.2 + valueLead * (row + 1));
				});
				tallest = Math.max(tallest, labelLead + 1.2 + valueLead * lines.length);
			}

			y += tallest;
		}

		y += scale.gap + 2;

		// ---- La grille ----
		// Elle s'imprime même sans ligne : son en-tête à deux niveaux EST la
		// trame, et une feuille vierge sert à la remplir au stylo pendant la
		// séquence. C'est d'ailleurs ainsi que son classeur est rangé : huit
		// onglets identiques, aucun rempli.
		// Monté une fois par élève : `waived` est une liste, et la parcourir
		// pour chacune des lignes de la grille referait le même travail.
		const sansNote = new Set(student.waived);

		const body: RowInput[] = rows.map((row, index) => {
			const cells: CellInput[] = [
				{ content: row.student_activity },
				{ content: row.required_text },
			];
			if (socleSpan[index] > 0) {
				const span = socleSpan[index];
				cells.push(
					{ content: row.socle_domain_label, rowSpan: span },
					{ content: row.socle_competency_label, rowSpan: span },
				);
				// La croix vient du niveau de CETTE compétence. Sans identifiant
				// de référentiel, la ligne ne porte qu'un libellé : aucune note
				// ne lui est rattachable, et les cases restent toutes à cocher.
				const level = row.competency_id
					? student.levels[row.competency_id]
					: undefined;
				if (row.competency_id && sansNote.has(row.competency_id)) {
					// Un mot en travers des quatre colonnes, et non quatre cases
					// barrées : la ligne doit se lire du premier coup d'œil
					// comme « il n'y avait rien à évaluer ici », pas comme une
					// grille qu'on aurait oublié de cocher. En italique et en
					// gris, parce que ce n'est pas un résultat.
					cells.push({
						content: "non évalué",
						colSpan: MASTERY_SCALE.length,
						rowSpan: span,
						styles: {
							halign: "center",
							fontStyle: "italic",
							textColor: GREY,
						},
					});
				} else {
					for (const step of MASTERY_SCALE) {
						cells.push({
							content: level === step ? "X" : "",
							rowSpan: span,
							styles: { fontStyle: "bold" },
						});
					}
				}
			}
			return cells;
		});

		autoTable(doc, {
			startY: y,
			margin: tableMargin,
			head,
			body,
			theme: "grid",
			styles: baseStyles,
			headStyles,
			columnStyles,
		});
	});

	return doc;
}

/**
 * Produit les fiches d'évaluation des élèves retenus — **une page par élève** —
 * les enregistre dans `<clé>/exports/` et renvoie le chemin du fichier.
 *
 * C'est le second rendu du tableau saisi dans la fiche contrat, celui que son
 * classeur appelle « evaluation sequence 1.xls » : huit onglets pour huit
 * élèves, la même grille sur chacun. Les colonnes sont les siennes —
 * ON DEMANDE | ON EXIGE | DOMAINES | COMPÉTENCES, puis les niveaux de
 * maîtrise — et « on demande » est mot pour mot l'« activité de l'élève » de la
 * fiche contrat. D'où la règle que le palier 010 a posée dans le schéma :
 * l'enseignant saisit une fois, et imprime les deux documents.
 *
 * **Ce que SGPA ajoute à son modèle**, et pourquoi :
 *
 * - le **nom de l'élève sur la feuille**. Son classeur ne le porte que sur
 *   l'onglet, qui ne s'imprime pas : huit feuilles sorties de l'imprimante sont
 *   indistinguables, et c'est le genre d'erreur qui se découvre après
 *   distribution ;
 * - la **croix déjà posée** quand la compétence est notée dans l'application,
 *   et la **note /20** quand elle existe. Les cases restent vides sinon : la
 *   fiche se remplit aussi entièrement à la main, avant la séquence.
 *
 * Mêmes règles d'export que les deux autres PDF : pas de `doc.save()`, le
 * fichier passe par `save_export` côté Rust, et `openAfter` est faux par
 * défaut. Même filet de taille aussi — on dessine, on compte les pages, et on
 * recommence un cran plus bas tant qu'il y en a plus d'une par élève.
 *
 * Ceci ne tranche **pas** la maquette de la fiche contrat nominative, qui reste
 * une décision de l'enseignant : la fiche contrat continue de s'imprimer en un
 * exemplaire, sans nom.
 */
export async function exportEvaluationSheetsPDF(
	sheet: EvaluationSheetInput,
	context: ContractSheetContext,
	students: EvaluationSheetStudent[],
	schoolName: string,
	openAfter: boolean = false,
): Promise<string> {
	if (students.length === 0) {
		throw new Error(
			"Aucun élève sélectionné : il n'y a aucune fiche à imprimer.",
		);
	}

	let doc = renderEvaluationSheets(
		sheet,
		context,
		students,
		schoolName,
		CONTRACT_SCALES[0],
	);
	for (
		let attempt = 1;
		attempt < CONTRACT_SCALES.length &&
		doc.getNumberOfPages() > students.length;
		attempt += 1
	) {
		doc = renderEvaluationSheets(
			sheet,
			context,
			students,
			schoolName,
			CONTRACT_SCALES[attempt],
		);
	}

	// ---- Pied de page ----
	const pageWidth = doc.internal.pageSize.getWidth();
	const pageHeight = doc.internal.pageSize.getHeight();
	const pageCount = doc.getNumberOfPages();
	const editedOn = new Date().toLocaleDateString("fr-FR");
	for (let page = 1; page <= pageCount; page += 1) {
		doc.setPage(page);
		doc.setFont("helvetica", "normal");
		doc.setFontSize(8);
		doc.setTextColor(...GREY);
		doc.text(
			pageCount > 1
				? `Édité le ${editedOn} — page ${page}/${pageCount}`
				: `Édité le ${editedOn}`,
			pageWidth / 2,
			pageHeight - 10,
			{ align: "center" },
		);
	}

	// Un seul élève retenu : son nom dans le nom du fichier, c'est ce qu'on
	// cherche dans `exports/` quand on réimprime une feuille perdue. Plusieurs :
	// la classe, comme pour le bilan.
	const title = sheet.project_title.trim() || context.evaluation_title.trim();
	const who =
		students.length === 1
			? slug(students[0].full_name)
			: slug(context.session_name);
	const fileName = `Fiche-evaluation-${slug(title)}-${who}.pdf`;
	const bytes = Array.from(new Uint8Array(doc.output("arraybuffer")));
	return await api.saveExport(fileName, bytes, openAfter);
}

// ===========================================================================
//  Progression annuelle
// ===========================================================================

/** Hauteurs des bandes de la frise imprimée, en millimètres. */
const FRISE_H_ENTETE = 4.4;
const FRISE_H_SEMAINE = 3.8;
const FRISE_H_VOIE = 6;
/** Largeur de la colonne des intitulés de ligne de la frise. */
const FRISE_LEGENDE = 25;
/** Fond des bandes d'en-tête, et son cran plus soutenu pour une semaine sans
 *  cours. Deux gris et aucune couleur : la couleur de ce document est réservée
 *  aux activités, sinon la frise ne se lit plus. */
const FRISE_FOND: [number, number, number] = [238, 238, 238];
const FRISE_FOND_FERME: [number, number, number] = [219, 219, 219];

/**
 * Tout ce dont le document a besoin, en un objet.
 *
 * Six paramètres positionnels, dont quatre objets, se seraient inversés au
 * premier appel — et une classe échangée avec une autre imprime une
 * progression fausse sous le bon nom.
 */
export interface ProgressionPdfInput {
	progression: Progression;
	session: Session;
	/** Les semaines réelles de l'année, celles que l'écran affiche. Fournies et
	 *  non relues ici : la frise imprimée doit être celle qu'on a vue. */
	calendar: YearCalendar;
	schoolName: string;
	openAfter?: boolean;
}

/**
 * Tronque à la largeur disponible, en millimètres.
 *
 * Les colonnes de la frise font cinq millimètres : il n'y a pas la place d'un
 * mot, et un texte qui dépasse se superposerait au voisin au lieu de se
 * couper. jsPDF n'écrête rien de lui-même.
 */
function tronquerA(doc: jsPDF, texte: string, largeur: number): string {
	if (largeur <= 0 || texte === "") return "";
	if (doc.getTextWidth(texte) <= largeur) return texte;
	let coupe = texte;
	while (coupe !== "" && doc.getTextWidth(coupe + "…") > largeur) {
		coupe = coupe.slice(0, -1);
	}
	return coupe === "" ? "" : `${coupe}…`;
}

/**
 * Les semaines d'une activité, écrites comme on les lit : « S36 – S39, S45 ».
 *
 * Le tiret demi-cadratin, et non une flèche : les polices intégrées de jsPDF
 * sont encodées en WinAnsi, qui ne contient pas « → ». L'export l'écrivait, et
 * le caractère ressortait en « !’ » dans la colonne « Semaines » du document
 * imprimé — vu sur une capture, pas sur un test. Tout ce qui part dans le PDF
 * doit tenir dans WinAnsi : « — », « – », « … », « « » » y sont, les flèches et
 * les espaces fines, non.
 *
 * Les deux bandes sont confondues : une activité posée la même semaine sur les
 * deux ne la compte qu'une fois. Et le regroupement se fait sur l'INDEX dans
 * l'année, jamais sur le numéro ISO — la semaine 1 de janvier suit la 53 de
 * décembre, et un regroupement par numéro aurait coupé Noël en deux.
 */
function phraseDesSemaines(
	activiteId: string,
	progression: Progression,
	weeks: readonly YearWeek[],
	parLundi: ReadonlyMap<string, number>,
): string {
	const index = progression.plages
		.filter((plage) => plage.activite_id === activiteId)
		.map((plage) => parLundi.get(plage.week_monday))
		.filter((i): i is number => i !== undefined)
		.sort((a, b) => a - b)
		.filter((valeur, rang, tous) => rang === 0 || valeur !== tous[rang - 1]);

	const morceaux: string[] = [];
	let debut = 0;
	while (debut < index.length) {
		let fin = debut;
		while (fin + 1 < index.length && index[fin + 1] === index[fin] + 1) fin += 1;
		const premiere = weeks[index[debut]].iso_week;
		const derniere = weeks[index[fin]].iso_week;
		morceaux.push(debut === fin ? `S${premiere}` : `S${premiere} – S${derniere}`);
		debut = fin + 1;
	}
	return morceaux.join(", ");
}

/**
 * La frise : les en-têtes groupés, le calendrier, les deux bandes.
 *
 * Dessinée au trait et non par `autoTable` : quarante-cinq colonnes de cinq
 * millimètres, et un intitulé qui déborde sur les semaines suivantes, ne sont
 * pas un tableau — un `colSpan` par trait aurait interdit d'écrire le numéro
 * dans la première case seulement.
 *
 * Le découpage des traits vient de `casesDeVoie`, le même qu'à l'écran : la
 * frise imprimée coupe ses traits là où l'écran les coupe.
 *
 * Renvoie l'ordonnée du bas de la frise.
 */
function dessinerFrise(
	doc: jsPDF,
	progression: Progression,
	weeks: readonly YearWeek[],
	x: number,
	y: number,
	largeur: number,
): number {
	const col = (largeur - FRISE_LEGENDE) / weeks.length;
	const xs = x + FRISE_LEGENDE;
	const parId = activitesParId(progression);
	const plages = indexDesPlages(progression);

	doc.setLineWidth(0.1);
	doc.setDrawColor(...GRID);

	/** L'intitulé de la ligne, à gauche, sur fond gris. */
	const legende = (texte: string, ligneY: number, hauteur: number) => {
		doc.setDrawColor(...GRID);
		doc.setLineWidth(0.1);
		doc.setFillColor(...FRISE_FOND);
		doc.rect(x, ligneY, FRISE_LEGENDE, hauteur, "FD");
		doc.setFontSize(6);
		doc.setFont("helvetica", "normal");
		doc.setTextColor(...GREY);
		doc.text(
			tronquerA(doc, texte, FRISE_LEGENDE - 2),
			x + 1.2,
			ligneY + hauteur / 2,
			{ baseline: "middle" },
		);
	};

	/** Une bande d'en-tête groupée : un rectangle par tranche de colonnes. */
	const bande = (
		titre: string,
		ligneY: number,
		hauteur: number,
		tranches: readonly { debut: number; taille: number; texte: string }[],
	) => {
		legende(titre, ligneY, hauteur);
		tranches.forEach((tranche) => {
			const largeurTranche = tranche.taille * col;
			const gauche = xs + tranche.debut * col;
			if (tranche.texte === "") doc.setFillColor(255, 255, 255);
			else doc.setFillColor(...FRISE_FOND);
			doc.rect(gauche, ligneY, largeurTranche, hauteur, "FD");
			if (tranche.texte === "") return;
			doc.setFontSize(6);
			doc.setFont("helvetica", "bold");
			doc.setTextColor(...INK);
			doc.text(
				tronquerA(doc, tranche.texte, largeurTranche - 1),
				gauche + largeurTranche / 2,
				ligneY + hauteur / 2,
				{ align: "center", baseline: "middle" },
			);
		});
	};

	let ligneY = y;

	bande(
		"Trimestre",
		ligneY,
		FRISE_H_ENTETE,
		tranchesParTrimestre(weeks).map((tranche) => ({
			debut: tranche.debut,
			taille: tranche.taille,
			texte: `Trimestre ${tranche.cle}`,
		})),
	);
	ligneY += FRISE_H_ENTETE;

	bande(
		"Mois",
		ligneY,
		FRISE_H_ENTETE,
		tranchesParMois(weeks).map((tranche) => ({
			debut: tranche.debut,
			taille: tranche.taille,
			texte: nomDuMois(tranche.cle),
		})),
	);
	ligneY += FRISE_H_ENTETE;

	// Les numéros de semaine, un par colonne. Une semaine sans cours est d'un
	// gris plus soutenu : c'est le seul signe qui survive à une photocopie en
	// noir et blanc.
	legende("Semaine", ligneY, FRISE_H_SEMAINE);
	weeks.forEach((week, index) => {
		const gauche = xs + index * col;
		const fond = week.school_days === 0 ? FRISE_FOND_FERME : FRISE_FOND;
		doc.setFillColor(...fond);
		doc.rect(gauche, ligneY, col, FRISE_H_SEMAINE, "FD");
		doc.setFontSize(5);
		doc.setFont("helvetica", "normal");
		doc.setTextColor(...INK);
		doc.text(
			String(week.iso_week),
			gauche + col / 2,
			ligneY + FRISE_H_SEMAINE / 2,
			{ align: "center", baseline: "middle" },
		);
	});
	ligneY += FRISE_H_SEMAINE;

	// Le calendrier, écrit une fois par période : « Vacances de Noël » sur deux
	// colonnes se lit, le même mot répété deux fois ne se lit plus.
	bande(
		"Calendrier",
		ligneY,
		FRISE_H_ENTETE,
		tranchesParMotif(weeks).map((tranche) => ({
			debut: tranche.debut,
			taille: tranche.taille,
			texte: tranche.motif,
		})),
	);
	ligneY += FRISE_H_ENTETE;

	VOIES.forEach((voie) => {
		const cases = casesDeVoie(weeks, plages, voie);
		legende(MOTS_DE_VOIE[voie], ligneY, FRISE_H_VOIE);

		// Le quadrillage d'abord, les traits par-dessus : un trait de huit
		// semaines est UN rectangle, et les filets intérieurs ne doivent pas le
		// traverser.
		weeks.forEach((week, index) => {
			const gauche = xs + index * col;
			if (week.school_days === 0) doc.setFillColor(...FRISE_FOND);
			else doc.setFillColor(255, 255, 255);
			doc.rect(gauche, ligneY, col, FRISE_H_VOIE, "FD");
		});

		cases.forEach((caseDeFrise, index) => {
			if (!caseDeFrise.debutDeTrait || caseDeFrise.activiteId === null) return;
			const activite = parId.get(caseDeFrise.activiteId);
			if (activite === undefined) return;
			const gauche = xs + index * col;
			const largeurTrait = caseDeFrise.longueur * col;
			doc.setFillColor(...fondDeActivite(activite.rang));
			doc.setDrawColor(...filetDeActivite(activite.rang));
			doc.setLineWidth(0.3);
			doc.rect(gauche, ligneY, largeurTrait, FRISE_H_VOIE, "FD");

			// Le NUMÉRO d'abord, l'intitulé seulement s'il reste de la place : le
			// numéro renvoie au tableau du dessous, et c'est lui qui fait tenir le
			// document photocopié en noir et blanc, où les teintes se ressemblent
			// toutes.
			const numero = String(activite.rang + 1);
			doc.setFontSize(6);
			doc.setFont("helvetica", "bold");
			doc.setTextColor(...encreDeActivite(activite.rang));
			const place = largeurTrait - 1.6;
			const complet = `${numero} ${activite.libelle}`;
			const texte =
				doc.getTextWidth(complet) <= place
					? complet
					: tronquerA(doc, numero, place);
			if (texte !== "") {
				doc.text(texte, gauche + 0.8, ligneY + FRISE_H_VOIE / 2, {
					baseline: "middle",
				});
			}
		});

		ligneY += FRISE_H_VOIE;
	});

	doc.setLineWidth(0.1);
	doc.setDrawColor(...GRID);
	return ligneY;
}

/** Une ligne du tableau : soit l'en-tête d'une étape, soit une de ses lignes.
 *
 *  **Deux sortes de lignes et non une cellule fusionnée**, et c'est le palier
 *  026 qui l'a imposé : l'étape porte maintenant six textes — intitulé,
 *  objectifs, métier et CAP, compétences, connaissances, priorités —, et six
 *  colonnes fusionnées sur 267 mm ne laissaient plus rien aux activités. Les
 *  deux documents de l'auteur font exactement cela : un bandeau qui ouvre la
 *  séquence, puis ses lignes en dessous.
 *
 *  Une étape sans activité garde donc son bandeau — ses compétences valent
 *  d'être lues même si rien n'est encore posé en face. */
type LigneDeProgression =
	| { sorte: "etape"; etape: ProgressionEtape }
	| { sorte: "activite"; activite: ProgressionActivite };

/** Le nombre de colonnes du tableau, nommé parce qu'un bandeau les couvre
 *  toutes : un `colSpan` écrit en chiffre à deux endroits se serait
 *  désaccordé de la liste des largeurs au premier ajout de colonne, et
 *  `autoTable` aurait dessiné un bandeau trop court sans rien signaler. */
const COLONNES_DE_PROGRESSION = 5;

/**
 * Produit la progression annuelle d'une classe, l'enregistre dans
 * `<clé>/exports/` et renvoie son chemin complet.
 *
 * **Paysage**, et c'est la frise qui l'impose : quarante-cinq semaines sur une
 * feuille portrait donnent des colonnes de quatre millimètres, où le numéro de
 * semaine ne tient plus.
 *
 * Le document dit deux fois la même année — la frise en haut, le tableau en bas
 * —, et le **numéro** d'une activité est ce qui relie les deux. La couleur
 * l'appuie et ne porte rien seule : une progression finit punaisée au mur après
 * un passage par un photocopieur en noir et blanc.
 *
 * **Le tableau du bas a changé de forme au palier 026**, et c'est la forme des
 * documents de l'auteur : un **bandeau** ouvre l'étape et porte ses six textes,
 * puis chacune de ses lignes tient une rangée à elle, avec sa nature, son
 * objectif et ses propres compétences. Le dessin d'avant fusionnait les
 * colonnes de l'étape sur toute la hauteur du groupe ; six textes d'étape dans
 * une cellule fusionnée ne laissaient plus rien aux activités qu'elle annonce.
 * Une étape sans activité garde son bandeau — ses compétences valent d'être
 * lues même si rien n'est encore posé en face.
 *
 * Volontairement pas de `doc.save()`, pour la même raison que les bilans : le
 * téléchargement navigateur déposait les documents dans le dossier
 * Téléchargements du poste hôte. Et `openAfter` est faux par défaut — ouvrir le
 * PDF inscrit son chemin dans les documents récents du lecteur du poste.
 */
export async function exportProgressionPDF({
	progression,
	session,
	calendar,
	schoolName,
	openAfter = false,
}: ProgressionPdfInput): Promise<string> {
	const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
	const pageWidth = doc.internal.pageSize.getWidth();
	const pageHeight = doc.internal.pageSize.getHeight();
	const contentWidth = pageWidth - MARGIN_X * 2;
	const centerX = pageWidth / 2;

	const yearLabel = schoolYearLabel(session.year_start);
	const levelLabel = LEVEL_LABELS[session.level_code] ?? session.level_code;
	const titre =
		progression.titre.trim() === ""
			? "Progression annuelle"
			: progression.titre.trim();

	doc.setProperties({
		title: `${titre} — ${session.name} — ${yearLabel}`,
		subject: "Progression annuelle",
		creator: "SGPA",
		author: schoolName || "SGPA",
	});

	let y = MARGIN_TOP;

	if (schoolName) {
		doc.setFont("helvetica", "normal");
		doc.setFontSize(9);
		doc.setTextColor(...GREY);
		doc.text(schoolName, MARGIN_X, y);
		y += 5;
	}

	// L'intitulé de groupe se pose à DROITE du titre, sur la même ligne : c'est
	// un libellé — « Gr 2 » —, pas un sous-titre, et une ligne à lui seul
	// laisserait croire à une entité du modèle.
	doc.setFont("helvetica", "bold");
	doc.setFontSize(16);
	doc.setTextColor(...INK);
	doc.text(titre, MARGIN_X, y + 1);
	if (progression.intitule_groupe.trim() !== "") {
		doc.setFontSize(13);
		doc.text(progression.intitule_groupe.trim(), pageWidth - MARGIN_X, y + 1, {
			align: "right",
		});
	}
	y += 7;

	doc.setFont("helvetica", "normal");
	doc.setFontSize(11);
	doc.setTextColor(...INK);
	doc.text(
		`${session.name} — ${levelLabel} — année scolaire ${yearLabel}`,
		MARGIN_X,
		y,
	);
	y += 6;

	if (progression.devise.trim() !== "") {
		doc.setFont("helvetica", "italic");
		doc.setFontSize(10);
		doc.setTextColor(...GREY);
		doc.text(progression.devise.trim(), MARGIN_X, y);
		y += 6;
	}

	doc.setDrawColor(...RULE);
	doc.setLineWidth(0.3);
	doc.line(MARGIN_X, y, pageWidth - MARGIN_X, y);
	y += 6;

	// ---- La frise ----
	if (calendar.weeks.length > 0) {
		y =
			dessinerFrise(
				doc,
				progression,
				calendar.weeks,
				MARGIN_X,
				y,
				contentWidth,
			) + 8;
	} else {
		doc.setFont("helvetica", "italic");
		doc.setFontSize(10);
		doc.setTextColor(...GREY);
		doc.text("Aucune semaine à afficher pour cette année scolaire.", MARGIN_X, y);
		y += 8;
	}

	// ---- Le tableau ----
	const parLundi = new Map(
		calendar.weeks.map((week, index) => [week.monday, index] as const),
	);

	/** Les compétences d'une étape, telles que le bandeau les imprime : celles du
	 *  référentiel, puis le texte libre d'avant le palier 021 tant qu'il reste.
	 *
	 *  Les deux dans la MÊME ligne et non deux lignes : l'enseignant qui relit son
	 *  année n'a pas à savoir par quel écran la phrase est arrivée là. Le nom
	 *  seul, sans le champ ni le socle — le plan de l'année nomme ce qu'on
	 *  travaille, là où la fiche contrat doit situer la compétence dans le socle.
	 *  Le texte libre passe en dernier parce qu'il est en voie de disparition :
	 *  il s'effacera d'un bouton, et il ne restera que la première moitié. */
	const competencesDeEtape = (etape: ProgressionEtape): string => {
		const lignesDeCellule = etape.competences_ref.map((c) => c.name);
		const libre = etape.competences.trim();
		if (libre !== "") lignesDeCellule.push(libre);
		return lignesDeCellule.join("\n");
	};

	/** L'en-tête d'une étape, telle que le bandeau l'imprime.
	 *
	 *  Une ligne par texte renseigné, chacune préfixée de son intitulé : sans ce
	 *  préfixe, « réaliser une boîte » et « Vocabulaire du dessin technique » se
	 *  liraient comme deux phrases de la même liste, alors que l'une est un but et
	 *  l'autre un savoir. Un texte vide ne laisse pas de ligne vide — le bandeau
	 *  d'une étape à peine commencée ne fait alors qu'un mot. */
	const enTeteDeEtape = (etape: ProgressionEtape): string => {
		const parts: string[] = [];
		const ajouter = (titre: string, valeur: string) => {
			const texte = valeur.trim();
			if (texte !== "") parts.push(`${titre} : ${texte}`);
		};
		ajouter("Objectifs", etape.objectifs);
		ajouter("Métier et CAP", etape.metier_cap);
		ajouter("Compétences", competencesDeEtape(etape));
		ajouter("Connaissances", etape.connaissances);
		ajouter("Priorités", etape.priorites);
		return parts.join("\n");
	};

	const lignes: LigneDeProgression[] = progression.etapes.flatMap(
		(etape): LigneDeProgression[] => [
			{ sorte: "etape", etape },
			...etape.activites.map(
				(activite): LigneDeProgression => ({ sorte: "activite", activite }),
			),
		],
	);

	if (lignes.length === 0) {
		doc.setFont("helvetica", "italic");
		doc.setFontSize(10);
		doc.setTextColor(...GREY);
		doc.text("Aucune étape n'est encore définie pour cette année.", MARGIN_X, y);
	} else {
		const body: RowInput[] = lignes.flatMap((ligne): RowInput[] => {
			if (ligne.sorte === "etape") {
				// Le bandeau : l'intitulé en gras sur sa ligne, les textes en
				// dessous. Deux lignes et non une cellule, parce qu'`autoTable` ne
				// sait pas mettre deux styles dans une cellule — un bandeau tout en
				// gras écraserait les activités qu'il annonce.
				const entete = enTeteDeEtape(ligne.etape);
				const rows: RowInput[] = [
					[
						{
							content: ligne.etape.libelle,
							colSpan: COLONNES_DE_PROGRESSION,
							styles: {
								fontStyle: "bold",
								fontSize: 9,
								fillColor: [238, 238, 238],
							},
						},
					],
				];
				if (entete !== "") {
					rows.push([
						{
							content: entete,
							colSpan: COLONNES_DE_PROGRESSION,
							styles: { fillColor: [248, 248, 248] },
						},
					]);
				}
				return rows;
			}

			const activite = ligne.activite;
			const cells: CellInput[] = [];
			// La pastille du numéro porte la teinte de l'activité : la même couleur
			// que son trait sur la frise, prise au même endroit.
			cells.push({
				content: String(activite.rang + 1),
				styles: {
					fillColor: fondDeActivite(activite.rang),
					textColor: encreDeActivite(activite.rang),
					fontStyle: "bold",
				},
			});
			// La nature devant l'intitulé, du même mot qu'à l'écran et pris au même
			// endroit (`MOTS_DE_NATURE`) : deux rédactions auraient fini par
			// imprimer « TP » d'un côté et « Travaux pratiques » de l'autre.
			cells.push(`${MOTS_DE_NATURE[activite.nature]} · ${activite.libelle}`);
			cells.push(activite.objectif);
			// Les compétences de CETTE ligne. Le nom seul, sans le champ ni le
			// socle, pour la même raison que dans le bandeau : le plan de l'année
			// nomme ce qu'on travaille, là où la fiche contrat doit le situer.
			cells.push(activite.competences_ref.map((c) => c.name).join("\n"));
			cells.push(
				phraseDesSemaines(activite.id, progression, calendar.weeks, parLundi),
			);
			return [cells];
		});

		// Largeurs, en millimètres, pour les 267 mm utiles d'une A4 paysage. La
		// colonne des compétences est la plus large : ce sont des phrases entières,
		// et c'est la colonne que l'enseignant relit ligne par ligne.
		const largeurs = [8, 70, 64, 86, 39];

		autoTable(doc, {
			startY: y,
			margin: { left: MARGIN_X, right: MARGIN_X, bottom: MARGIN_BOTTOM },
			head: [
				[
					"N°",
					"Séance",
					"Objectif",
					"Compétences évaluées",
					"Semaines",
				],
			],
			body,
			theme: "grid",
			styles: {
				fontSize: 8,
				cellPadding: 1.4,
				overflow: "linebreak",
				textColor: INK,
				lineColor: GRID,
				lineWidth: 0.1,
				valign: "middle",
			},
			// Pas de bandeau noir : la même convention que la fiche contrat, du gras
			// centré sur fond clair, dans la même grille que le reste.
			headStyles: {
				fillColor: [238, 238, 238],
				textColor: INK,
				fontStyle: "bold",
				fontSize: 8,
				halign: "center",
				valign: "middle",
			},
			columnStyles: {
				0: { cellWidth: largeurs[0], halign: "center" },
				1: { cellWidth: largeurs[1] },
				2: { cellWidth: largeurs[2] },
				3: { cellWidth: largeurs[3] },
				4: { cellWidth: largeurs[4], halign: "center" },
			},
		});
	}

	// ---- Pied de page ----
	// En dernier seulement : le nombre total de pages n'est connu qu'ici.
	const pageCount = doc.getNumberOfPages();
	const editedOn = new Date().toLocaleDateString("fr-FR");
	for (let page = 1; page <= pageCount; page += 1) {
		doc.setPage(page);
		doc.setFont("helvetica", "normal");
		doc.setFontSize(8);
		doc.setTextColor(...GREY);
		doc.text(
			`Édité le ${editedOn} — page ${page}/${pageCount}`,
			centerX,
			pageHeight - 8,
			{ align: "center" },
		);
	}

	const fileName = `Progression-${slug(session.name)}-${yearLabel}.pdf`;
	const bytes = Array.from(new Uint8Array(doc.output("arraybuffer")));
	return await api.saveExport(fileName, bytes, openAfter);
}
