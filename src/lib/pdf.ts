import jsPDF from "jspdf";
import { autoTable, type Table } from "jspdf-autotable";
import { api } from "@/lib/api";
import {
	LEVEL_LABELS,
	MASTERY_LABELS,
	schoolYearLabel,
	type AttendanceStats,
	type MasteryLevel,
	type OverallAverageRule,
	type SessionReport,
	type StudentReport,
} from "@/types";

const MARGIN_X = 15;
const MARGIN_TOP = 15;
/** Bande réservée au pied de page « Édité le … — page N/M ». */
const MARGIN_BOTTOM = 18;

const GREY: [number, number, number] = [110, 110, 110];
const INK: [number, number, number] = [25, 25, 25];
const RULE: [number, number, number] = [205, 205, 205];

const RULE_LABELS: Record<OverallAverageRule, string> = {
	unweighted_mean: "moyenne non pondérée des compétences",
	weighted_by_count: "moyenne pondérée par le nombre de notes",
};

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

function masteryLabel(average: number): string {
	const level = Math.min(5, Math.max(0, Math.round(average))) as MasteryLevel;
	return MASTERY_LABELS[level];
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
					masteryLabel(competency.average_level),
					`${formatAverage(competency.average_level)}/5`,
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
			// Jamais « 0,0/5 » : sur un document remis à une famille, cela se lit
			// comme une maîtrise nulle et non comme une absence de note.
			doc.text("Moyenne générale : —", MARGIN_X, y);
			y += 5;
			doc.setFont("helvetica", "normal");
			doc.setFontSize(9);
			doc.setTextColor(...GREY);
			doc.text("(non évalué ce trimestre)", MARGIN_X, y);
			y += 5;
		} else {
			doc.text(
				`Moyenne générale : ${formatAverage(student.overall_average)}/5`,
				MARGIN_X,
				y,
			);
			y += 5;
			doc.setFont("helvetica", "normal");
			doc.setFontSize(8);
			doc.setTextColor(...GREY);
			doc.text(
				`Moyenne indicative — règle de calcul à confirmer (${
					RULE_LABELS[report.average_rule] ?? report.average_rule
				})`,
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
