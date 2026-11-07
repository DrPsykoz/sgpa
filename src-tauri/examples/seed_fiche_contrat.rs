//! Remplit la fiche contrat d'une évaluation de démonstration, pour vérifier
//! l'export PDF sans ressaisir trois tableaux à la main.
//!
//! ```powershell
//! cargo run --example seed_fiche_contrat -- target\debug\data mon-mot-de-passe
//! ```
//!
//! À lancer après `seed_demo`, qui crée la classe et l'évaluation. Un troisième
//! argument facultatif désigne l'évaluation à garnir ; sans lui, c'est la plus
//! ancienne. Relançable sans dommage : l'en-tête est mis à jour, les lignes et
//! les consignes sont effacées puis réécrites, et rien d'autre n'est touché.
//!
//! Le contenu est inventé. Il reprend la FORME du classeur de l'enseignant,
//! parce que c'est elle que le PDF doit savoir rendre :
//!
//! - quatre blocs du socle de 3, 1, 3 et 1 lignes ;
//! - un bloc où une seule activité de formation couvre ses trois lignes ;
//! - un bloc où trois activités de formation différentes tiennent sous une
//!   seule compétence — c'est le cas d'emboîtement, celui qui casse si les
//!   fusions ne sont pas calculées à l'intérieur d'un bloc du socle ;
//!
//! Aucune ligne vide : une ligne entièrement blanche ne s'imprime pas — elle
//! n'apprend rien et coûte une page. L'éditeur, lui, laisse en ajouter.
//!
//! Son projet à lui n'est pas recopié ici : `documents/` est hors du dépôt, et
//! ce fichier, lui, est versionné.

use std::path::Path;

use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

/// Une ligne de la grille des activités.
///
/// Les deux libellés du socle ne sont pas écrits ici : quand la ligne porte une
/// compétence, ils sont relus dans le référentiel au moment du semis — ce que
/// fait `resolve_competency` quand l'enseignant choisit une compétence dans la
/// liste. Le domaine passe par `socle_reference`, la même fonction que les
/// commandes, pour que la fiche de démonstration porte exactement les libellés
/// que l'application écrit. Une ligne sans compétence les laisse vides.
struct Ligne {
    eleve: &'static str,
    formation: &'static str,
    competence: Option<&'static str>,
    /// « ON EXIGE » de la fiche d'évaluation. Stocké, pas encore imprimé.
    exige: &'static str,
}

/// Répétée à l'identique sur les trois premières lignes : c'est cette égalité
/// de texte, et rien d'autre, qui fait la fusion verticale à l'impression.
const PREVENTION: &str =
    "Identifier les risques professionnels et appliquer les mesures de prévention";

const LIGNES: &[Ligne] = &[
    Ligne {
        eleve: "Identifier les EPI nécessaires",
        formation: PREVENTION,
        competence: Some("seed-c3-l31"),
        exige: "Les EPI sont portés pendant toute la séance",
    },
    Ligne {
        eleve: "Préparer les outils",
        formation: PREVENTION,
        competence: Some("seed-c3-l31"),
        exige: "Les outils sortis sont ceux de la fiche de préparation",
    },
    Ligne {
        eleve: "Préparer son poste de travail",
        formation: PREVENTION,
        competence: Some("seed-c3-l31"),
        exige: "Le poste est dégagé et l'établi est propre",
    },
    Ligne {
        eleve: "Analyser les documents de présentation du projet",
        formation: "Rechercher une forme, une dimension sur un plan, un dessin",
        competence: Some("seed-c3-l06"),
        exige: "Les côtes relevées sont celles du plan",
    },
    Ligne {
        eleve: "Identifier les différents éléments qui constituent le composteur",
        formation: "Repérer les éléments en les identifiant avec un code couleur",
        competence: Some("seed-c3-l22"),
        exige: "Chaque élément porte la couleur de son repère",
    },
    Ligne {
        eleve: "Démonter les palettes afin de récupérer les planches utiles à la réalisation",
        formation: "Le poste de travail est correctement organisé",
        competence: Some("seed-c3-l22"),
        exige: "Les planches récupérées sont sans clou ni éclat",
    },
    Ligne {
        eleve: "Coller les éléments sur des dormants",
        formation: "Le collage est correctement effectué",
        competence: Some("seed-c3-l22"),
        exige: "L'assemblage est d'équerre et tient sans jeu",
    },
    Ligne {
        eleve: "Remettre en état le poste de travail. Trier les déchets.",
        formation: "Analyser l'impact environnemental d'un objet et de ses constituants.",
        competence: Some("seed-c4-l37"),
        exige: "Les déchets sont dans la benne qui leur correspond",
    },
];

/// ON DONNE / ON DEMANDE / ON EXIGE, trois colonnes alignées sur trois lignes :
/// à chaque chose donnée répond ce qu'on en demande et ce qu'on en exige.
const CONSIGNES: &[(&str, &str, &str)] = &[
    (
        "Les plans",
        "Identifier et interpréter un document",
        "Les éléments sont correctement repérés",
    ),
    (
        "Les palettes",
        "Démonter sans dégrader les planches",
        "Les planches récupérées sont empilées par longueur",
    ),
    (
        "Des dormants pour le collage des différents éléments",
        "Assembler les éléments collés",
        "L'assemblage est d'équerre et stable",
    ),
];

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let data_dir = args
        .next()
        .unwrap_or_else(|| "target/debug/data".to_string());
    let password = args.next().ok_or(
        "Usage : cargo run --example seed_fiche_contrat -- \
         <dossier data> <mot de passe> [id d'évaluation]",
    )?;
    let voulue = args.next();

    let racine = Path::new(&data_dir);
    if !racine.join("sgpa.keys").exists() {
        return Err(format!("{data_dir}/sgpa.keys est absent : lancez seed_demo d'abord.").into());
    }
    let mut conn = sgpa_lib::open_for_tools(racine, &password)?;

    let version: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 11 {
        return Err(format!(
            "La base est au palier {version} : le code du domaine arrive au 011. \
             Lancez l'application une fois pour migrer."
        )
        .into());
    }

    // L'évaluation visée, et de quoi dire à l'écran où aller la chercher.
    let evaluation = match &voulue {
        Some(id) => conn
            .query_row(
                "SELECT e.id, e.title, s.name
                   FROM evaluations e
                   JOIN sessions s ON s.id = e.session_id
                  WHERE e.id = ?1",
                params![id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| format!("Aucune évaluation d'identifiant {id}."))?,
        None => conn
            .query_row(
                "SELECT e.id, e.title, s.name
                   FROM evaluations e
                   JOIN sessions s ON s.id = e.session_id
                  ORDER BY e.date, e.title
                  LIMIT 1",
                [],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?
            .ok_or("La base ne contient aucune évaluation : lancez seed_demo d'abord.")?,
    };
    let (evaluation_id, titre, classe) = evaluation;

    let tx = conn.transaction()?;

    // Le champ professionnel vient du palier 009. S'il manquait, la fiche
    // garderait son libellé sans le lien — même arbitrage que `resolve_field`
    // dans les commandes : un défaut de référentiel ne vide pas une fiche.
    let champ: Option<String> = tx
        .query_row(
            "SELECT id FROM professional_fields WHERE id = 'seed-pf-habitat'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    if champ.is_none() {
        println!("Champ « Habitat » absent du référentiel : la fiche ne portera que son libellé.");
    }

    tx.execute(
        "INSERT INTO contract_sheets
             (id, evaluation_id, project_title, professional_field_id,
              professional_field_label, professional_subset, reference_activities,
              target_careers)
         VALUES (?1, ?2, ?3, ?4, 'Habitat', 'AMÉNAGEMENT AGENCEMENT FINITION',
                 'Réaliser un composteur de jardin en bois de palette',
                 'CAP menuisier fabricant')
         ON CONFLICT(evaluation_id) DO UPDATE SET
             project_title            = excluded.project_title,
             professional_field_id    = excluded.professional_field_id,
             professional_field_label = excluded.professional_field_label,
             professional_subset      = excluded.professional_subset,
             reference_activities     = excluded.reference_activities,
             target_careers           = excluded.target_careers,
             updated_at               = datetime('now')",
        params![
            Uuid::new_v4().to_string(),
            evaluation_id,
            "Fabrication d'un composteur de jardin",
            champ,
        ],
    )?;

    let fiche: String = tx.query_row(
        "SELECT id FROM contract_sheets WHERE evaluation_id = ?1",
        params![evaluation_id],
        |r| r.get(0),
    )?;

    // Effacer puis réécrire : rien ne référence encore ces lignes — les savoirs
    // d'une séquence s'accrochent à la fiche, pas à ses lignes.
    tx.execute(
        "DELETE FROM contract_sheet_rows WHERE contract_sheet_id = ?1",
        params![fiche],
    )?;
    tx.execute(
        "DELETE FROM contract_sheet_requirements WHERE contract_sheet_id = ?1",
        params![fiche],
    )?;

    for (position, ligne) in LIGNES.iter().enumerate() {
        let (reference, competence) = match ligne.competence {
            Some(id) => tx
                .query_row(
                    "SELECT d.code, d.name, cy.name, c.name
                       FROM competencies c
                       JOIN fields  f  ON f.id = c.field_id
                       JOIN domains d  ON d.id = f.domain_id
                       JOIN cycles  cy ON cy.id = d.cycle_id
                      WHERE c.id = ?1",
                    params![id],
                    |r| {
                        Ok((
                            sgpa_lib::socle_reference(
                                &r.get::<_, String>(0)?,
                                &r.get::<_, String>(1)?,
                                &r.get::<_, String>(2)?,
                            ),
                            r.get::<_, String>(3)?,
                        ))
                    },
                )
                .optional()?
                .ok_or_else(|| {
                    format!("Compétence {id} introuvable : le palier 009 a-t-il bien tourné ?")
                })?,
            None => (String::new(), String::new()),
        };

        tx.execute(
            "INSERT INTO contract_sheet_rows
                 (id, contract_sheet_id, position, student_activity, training_activity,
                  competency_id, socle_domain_label, socle_competency_label, required_text)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                Uuid::new_v4().to_string(),
                fiche,
                position as i32,
                ligne.eleve,
                ligne.formation,
                ligne.competence,
                reference,
                competence,
                ligne.exige,
            ],
        )?;
    }

    for (position, (donne, demande, exige)) in CONSIGNES.iter().enumerate() {
        tx.execute(
            "INSERT INTO contract_sheet_requirements
                 (id, contract_sheet_id, position, given_text, asked_text, required_text)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                Uuid::new_v4().to_string(),
                fiche,
                position as i32,
                donne,
                demande,
                exige,
            ],
        )?;
    }

    tx.commit()?;

    println!(
        "Fiche contrat semée : {} lignes, {} consignes.",
        LIGNES.len(),
        CONSIGNES.len()
    );
    println!("Dans l'application : classe {classe} → onglet Évaluations → « {titre} » → bouton « Fiche contrat » → « Exporter en PDF ».");
    Ok(())
}
