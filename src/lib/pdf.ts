import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { StudentReport } from "@/types";
import { MASTERY_LABELS, type MasteryLevel } from "@/types";

export function exportReportPDF(
	reports: StudentReport[],
	sessionName: string,
	schoolYear: string,
	trimester: number,
) {
	const doc = new jsPDF({
		orientation: "portrait",
		unit: "mm",
		format: "a4",
	});
	const yearLabel = schoolYear === "4eme" ? "4ème" : "3ème";

	reports.forEach((report, index) => {
		if (index > 0) doc.addPage();

		let y = 15;

		// Header
		doc.setFontSize(16);
		doc.setFont("helvetica", "bold");
		doc.text("SGPA - Bilan de compétences", 105, y, { align: "center" });
		y += 8;

		doc.setFontSize(11);
		doc.setFont("helvetica", "normal");
		doc.text(`Session : ${sessionName}`, 105, y, { align: "center" });
		y += 6;
		doc.text(`${yearLabel} — Trimestre ${trimester}`, 105, y, {
			align: "center",
		});
		y += 10;

		// Student name
		doc.setFontSize(14);
		doc.setFont("helvetica", "bold");
		doc.text(
			`${report.student_last_name} ${report.student_first_name}`,
			15,
			y,
		);
		y += 8;

		// Attendance
		doc.setFontSize(10);
		doc.setFont("helvetica", "normal");
		const att = report.attendance_stats;
		doc.text(
			`Présences : ${att.present}/${att.total_seances} | Absences : ${att.absent} | Retards : ${att.retard} | Excusés : ${att.excuse}`,
			15,
			y,
		);
		y += 8;

		// Competency averages table
		if (report.competency_averages.length > 0) {
			const tableData = report.competency_averages.map((ca) => [
				ca.domain_name,
				ca.field_name,
				ca.competency_name,
				getMasteryLabel(ca.average_level),
				ca.average_level.toFixed(1) + "/5",
			]);

			autoTable(doc, {
				startY: y,
				head: [["Domaine", "Champ", "Compétence", "Niveau", "Moyenne"]],
				body: tableData,
				theme: "grid",
				styles: { fontSize: 8, cellPadding: 2 },
				headStyles: { fillColor: [51, 51, 51], fontSize: 8 },
				columnStyles: {
					0: { cellWidth: 35 },
					1: { cellWidth: 35 },
					2: { cellWidth: 50 },
					3: { cellWidth: 40 },
					4: { cellWidth: 20, halign: "center" },
				},
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			y = (doc as any).lastAutoTable.finalY + 8;
		}

		// Overall average
		doc.setFontSize(11);
		doc.setFont("helvetica", "bold");
		doc.text(
			`Moyenne générale : ${report.overall_average.toFixed(1)}/5`,
			15,
			y,
		);
		y += 10;

		// Teacher comment
		if (report.teacher_comment) {
			doc.setFontSize(10);
			doc.setFont("helvetica", "bold");
			doc.text("Commentaire de l'enseignant :", 15, y);
			y += 5;
			doc.setFont("helvetica", "normal");
			const lines = doc.splitTextToSize(report.teacher_comment, 180);
			doc.text(lines, 15, y);
		}
	});

	doc.save(`bilan_${sessionName}_${yearLabel}_T${trimester}.pdf`);
}

function getMasteryLabel(avg: number): string {
	const rounded = Math.round(avg) as MasteryLevel;
	const clamped = Math.max(0, Math.min(5, rounded)) as MasteryLevel;
	return MASTERY_LABELS[clamped];
}
