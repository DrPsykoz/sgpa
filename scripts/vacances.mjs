// ---------------------------------------------------------------------------
// LE SEUL CODE DU PROJET QUI TOUCHE AU RÉSEAU — et il ne part pas sur la clé USB.
//
// `pnpm vacances` interroge l'open data du ministère et écrit
// `src-tauri/src/db/data/vacances.json`, qui est COMMITÉ et embarqué dans
// l'exécutable par `include_str!`. L'application, elle, n'acquiert ni
// `tauri-plugin-http`, ni capability réseau, ni dépendance TLS : elle lit un
// fichier. `.github/copilot-instructions.md` dit « aucun réseau, aucune
// télémétrie, aucun service externe », et ça reste vrai.
//
// Ce script n'est JAMAIS appelé par `pnpm build` ni par la CI : une panne du
// ministère ne peut pas casser une release.
//
// Source : data.education.gouv.fr, jeu `fr-en-calendrier-scolaire`,
// Licence Ouverte v2.0 (Etalab) — embarquable à condition de citer la source,
// ce que fait le fichier produit.
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const JEU = "fr-en-calendrier-scolaire";
const BASE = `https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/${JEU}`;
const SORTIE = "src-tauri/src/db/data/vacances.json";

/**
 * Fenêtre embarquée. Tout l'historique ferait 143 ko pour des années que
 * personne ne consultera ; cette borne couvre l'année en cours et les
 * suivantes que le ministère a publiées.
 */
const DEPUIS = "2025-08-01";

// ---------------------------------------------------------------------------
// Conversion des dates — LES TROIS PIÈGES, traités ici et une seule fois
//
// Le Rust ne voit JAMAIS un horodatage : il reçoit des `AAAA-MM-JJ`, comme tout
// le reste du schéma. C'est délibéré — `chrono` 0.4 n'embarque aucune base de
// fuseaux horaires (`chrono-tz` est absent du Cargo.lock), alors que Node porte
// l'ICU complet. Convertir ici évite d'ajouter une dépendance à l'application
// pour un calcul fait une fois tous les six mois.
// ---------------------------------------------------------------------------

/**
 * PIÈGE 1 — L'API date en UTC, et minuit à Paris tombe la veille en UTC.
 *
 * Mesuré sur les 5 174 horodatages du jeu : aucun ne tombe ailleurs qu'à minuit
 * heure de Paris, et le décalage est TOUJOURS de +1 jour. Le cas emblématique
 * tient dans un seul enregistrement — Toussaint 2026 à Besançon :
 * `2026-10-16T22:00:00Z` est le 17 octobre (UTC+2), `2026-11-01T23:00:00Z` est
 * le 2 novembre (UTC+1). Les deux décalages dans la même ligne.
 *
 * `toLocaleDateString("sv-SE")` rend `AAAA-MM-JJ` — c'est l'idiome que
 * `CLAUDE.md` impose déjà partout dans le projet, avec ici le fuseau explicite.
 */
const jourParisien = (iso) =>
  new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

/**
 * Veille d'un jour ISO.
 *
 * Le passage par midi UTC est volontaire : à minuit, un changement d'heure
 * ferait glisser la date d'un jour.
 */
const veille = (jour) => {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** Empreinte stable des cinq colonnes : c'est la clé primaire en base.
 *
 *  Déterministe et calculée ici, pour deux raisons. Elle rend le semis
 *  rejouable sans écraser une correction de l'enseignant, et elle est VISIBLE
 *  DANS LE DIFF — un identifiant tiré au hasard à chaque régénération ferait
 *  d'une mise à jour de calendrier un diff de 511 lignes illisible.
 *
 *  PAS sur (académie, année, libellé) : mesuré, ce triplet n'est pas unique —
 *  quatre collisions légitimes dans la fenêtre retenue (Polynésie « Grandes
 *  Vacances », Guadeloupe « Abolition de l'esclavage »). */
const empreinte = (...champs) =>
  createHash("sha256").update([JEU, ...champs].join("\u0000")).digest("hex").slice(0, 24);

// ---------------------------------------------------------------------------

async function recuperer() {
  const lignes = [];
  const taille = 100;
  let offset = 0;

  for (;;) {
    const url =
      `${BASE}/records?limit=${taille}&offset=${offset}` +
      `&where=start_date%20%3E%3D%20date'${DEPUIS}'` +
      `&order_by=start_date`;
    const reponse = await fetch(url);
    if (!reponse.ok) {
      throw new Error(`${reponse.status} ${reponse.statusText} sur ${url}`);
    }
    const page = await reponse.json();
    lignes.push(...page.results);
    // L'API plafonne `offset + limit` à 10 000 ; la fenêtre retenue en compte
    // quelques centaines, donc on sort bien avant.
    if (page.results.length < taille) break;
    offset += taille;
    if (offset > 5000) throw new Error("fenêtre inattendue : plus de 5000 lignes");
  }
  return lignes;
}

function convertir(brut) {
  const periodes = [];
  const ecartees = { enseignants: 0, dureeNulle: 0, dateManquante: 0, doublons: 0 };
  const vus = new Set();

  for (const r of brut) {
    if (!r.start_date || !r.end_date) {
      ecartees.dateManquante += 1;
      continue;
    }

    // PIÈGE 2 — Les vacances d'été sont publiées EN DOUBLE, une ligne Élèves et
    // une ligne Enseignants, avec deux dates de fin différentes. SGPA date des
    // COURS : on garde la population élèves. Mesuré : 354 lignes sur 2 587
    // écartées sur tout le jeu. `population` prend 21 valeurs distinctes en
    // comptant les territoires, mais en zones A/B/C il ne vaut jamais autre
    // chose que '-', 'Élèves' ou 'Enseignants'.
    if (/^enseignant/i.test(r.population ?? "")) {
      ecartees.enseignants += 1;
      continue;
    }

    const debut = jourParisien(r.start_date);
    // `end_date` est le JOUR DE REPRISE, pas le dernier jour de vacances. On
    // stocke le premier et le DERNIER JOUR, bornes incluses — c'est la
    // convention d'`absence_periods` (`BETWEEN start_date AND end_date`) et de
    // `students.enrolled_on / left_on`. Une seconde convention dans le même
    // schéma ferait qu'un `BETWEEN` écrit par un palier futur masquerait un
    // vrai cours le jour de la rentrée.
    const fin = veille(jourParisien(r.end_date));

    // PIÈGE 3 — Durée nulle : « Pont de l'Ascension » en métropole (28 lignes
    // pour 2026-2027, dont 4 seulement ont une durée réelle), « Début des
    // Vacances d'Été ». Ce sont des POINTS, pas des périodes. Mesuré : 93 lignes
    // sur 2 587. C'EST CE `continue` QUI LES ÉCARTE — surtout pas le CHECK du
    // schéma, qui ferait ÉCHOUER l'INSERT, donc avorter le semis, donc
    // potentiellement empêcher l'ouverture de la base.
    if (fin < debut) {
      ecartees.dureeNulle += 1;
      continue;
    }

    const academie = r.location ?? "";
    const libelle = r.description ?? "";
    const id = empreinte(academie, libelle, debut, fin);
    if (vus.has(id)) {
      ecartees.doublons += 1;
      continue;
    }
    vus.add(id);
    periodes.push([id, academie, libelle, debut, fin]);
  }

  periodes.sort(
    (a, b) => a[3].localeCompare(b[3]) || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]),
  );
  return { periodes, ecartees };
}

const brut = await recuperer();
console.log(`${brut.length} enregistrements reçus depuis ${DEPUIS}`);

const { periodes, ecartees } = convertir(brut);
console.log(
  `écartées — enseignants : ${ecartees.enseignants}, durée nulle : ${ecartees.dureeNulle}, ` +
    `date manquante : ${ecartees.dateManquante}, doublons : ${ecartees.doublons}`,
);
console.log(`${periodes.length} périodes retenues`);

const academies = [...new Set(periodes.map((p) => p[1]))].sort();
console.log(`${academies.length} académies : ${academies.join(", ")}`);

// Le millésime vient de la DONNÉE, pas de l'horloge de la machine : deux
// exécutions le même jour sur un jeu inchangé doivent produire le même fichier,
// au caractère près, sinon le diff mentirait sur ce qui a changé.
const releve = periodes.reduce((max, p) => (p[4] > max ? p[4] : max), "");

const fichier = {
  source: `data.education.gouv.fr — ${JEU} (Licence Ouverte v2.0)`,
  // Dernier jour couvert : c'est lui que la grille affiche en pied de page
  // (« calendrier embarqué jusqu'au … »). Sans cette ligne, la fonctionnalité
  // ne s'éteindrait pas, elle se mettrait à mentir dans l'autre sens — des
  // créneaux redessinés pendant des vacances qu'on ne connaît plus.
  couvert_jusqu_au: releve,
  depuis: DEPUIS,
  // Des tuples et non des objets : 34 ko au lieu de 90, et UNE LIGNE PAR
  // PÉRIODE dans le diff. L'ordre est [id, académie, libellé, début, fin].
  periodes,
};

mkdirSync("src-tauri/src/db/data", { recursive: true });
writeFileSync(SORTIE, `${JSON.stringify(fichier, null, 1)}\n`, "utf8");
console.log(`écrit ${SORTIE} — couvert jusqu'au ${releve}`);
