//! Remplit une base SGPA de quoi regarder la **progression annuelle** et
//! l'**emploi du temps** : trois classes de la même année, leurs créneaux, et
//! une progression par classe avec ses étapes, ses activités et ses semaines
//! peintes.
//!
//! ```powershell
//! cargo run --example seed_progression -- target\debug\data mon-mot-de-passe
//! ```
//!
//! Complémentaire de `seed_demo`, qui pose une classe avec ses élèves, ses
//! séances et une évaluation, mais ne touche ni à la grille hebdomadaire ni à
//! la progression — les deux sont arrivées après lui.
//!
//! **Il sème des domaines de progression, et c'est le seul endroit du dépôt qui
//! en sème.** L'application les livre vides, délibérément : le vocabulaire
//! appartient à l'enseignant. Mais une frise sans domaine ne montre pas la
//! colonne « Domaine » du PDF, donc un jeu d'essai qui s'en priverait ne
//! servirait à rien. `examples/` n'est pas compilé dans l'application.
//!
//! Toutes les dates sont relatives à l'année scolaire en cours, comme dans
//! `seed_demo` : un semis figé sur un millésime atterrit sur une année que les
//! écrans ne regardent pas.

use std::path::Path;

use chrono::{Datelike, Duration, Local, NaiveDate};
use rusqlite::{params, Transaction};
use uuid::Uuid;

fn id() -> String {
    Uuid::new_v4().to_string()
}

/// Une activité : son libellé, et l'indice du domaine dans `DOMAINES`.
struct Activite(&'static str, usize);

/// Une étape : libellé, compétences, connaissances, priorités, activités.
struct Etape {
    libelle: &'static str,
    competences: &'static str,
    connaissances: &'static str,
    priorites: &'static str,
    activites: &'static [Activite],
}

/// Une plage : l'indice de l'activité **dans l'année** (0-fondé, l'ordre des
/// étapes puis des activités), la voie, et les semaines qu'elle occupe.
struct Plage(usize, i32, &'static [usize]);

struct Plan {
    classe: &'static str,
    niveau: &'static str,
    titre: &'static str,
    intitule_groupe: &'static str,
    devise: &'static str,
    eleves: &'static [(&'static str, &'static str)],
    etapes: &'static [Etape],
    plages: &'static [Plage],
}

const DOMAINES: [&str; 4] = [
    "Préparation et sécurité",
    "Aménagement et finition",
    "Clos et ouvertures",
    "Équipements techniques",
];

/// Trois classes, trois progressions de densité différente : c'est ce que la
/// vue annuelle de l'emploi du temps sert à comparer — la semaine où tout le
/// monde travaille, et celle où une classe n'a rien de prévu.
const PLANS: [Plan; 3] = [
    Plan {
        classe: "4B",
        niveau: "4eme",
        titre: "Progression atelier — Habitat",
        intitule_groupe: "Gr 2",
        devise: "le plaisir de manipuler",
        eleves: &[
            ("Camille", "ANDRÉ"),
            ("Rayan", "FONTAINE"),
            ("Maëlys", "GIRARD"),
            ("Tiago", "MERCIER"),
            ("Louna", "ROBIN"),
        ],
        etapes: &[
            Etape {
                libelle: "Entrer dans l'atelier",
                competences: "Prendre conscience des dangers de l'atelier\nIdentifier et nommer l'outillage\nRespecter une consigne de sécurité sans qu'on la répète",
                connaissances: "Les familles d'outils\nLes équipements de protection individuelle",
                priorites: "La sécurité avant le résultat",
                activites: &[
                    Activite("Trier le matériel", 0),
                    Activite("Démonter des palettes", 0),
                    Activite("Reconnaître les bois", 0),
                ],
            },
            Etape {
                libelle: "Fabriquer en autonomie",
                competences: "Respecter une chronologie imposée\nMesurer et tracer avant de couper\nRanger son poste en fin de séance",
                connaissances: "Lecture d'un plan simple\nLes unités de longueur et leurs conversions",
                priorites: "Mener un ouvrage jusqu'au bout",
                activites: &[
                    Activite("Tracer et débiter", 1),
                    Activite("Assembler le caisson", 1),
                    Activite("Poser un bardage", 2),
                ],
            },
            Etape {
                libelle: "Finir et rendre compte",
                competences: "Vérifier la conformité de son ouvrage\nExpliquer une étape à un camarade\nS'auto-évaluer sans complaisance",
                connaissances: "Les défauts d'aspect\nLe vocabulaire de la finition",
                priorites: "Savoir dire ce qu'on a fait",
                activites: &[
                    Activite("Enduire et poncer", 1),
                    Activite("Peindre", 1),
                    Activite("Présenter l'ouvrage", 3),
                ],
            },
        ],
        // La voie 1 porte « Démonter des palettes » sur des semaines
        // dispersées, pendant qu'une autre activité occupe la bande
        // principale : c'est exactement ce que la bande parallèle sert à dire.
        // Et « Trier le matériel » revient en semaines 30-31 : une seule
        // activité, deux suites dans le temps.
        plages: &[
            Plage(0, 0, &[0, 1]),
            Plage(2, 0, &[2, 3, 4]),
            Plage(3, 0, &[5, 6, 7, 8]),
            Plage(4, 0, &[9, 10, 11, 12, 13]),
            Plage(5, 0, &[14, 15, 16, 17]),
            Plage(6, 0, &[18, 19, 20, 21]),
            Plage(7, 0, &[22, 23, 24, 25]),
            Plage(8, 0, &[26, 27, 28]),
            Plage(0, 0, &[30, 31]),
            Plage(4, 0, &[32, 33, 34, 35, 36]),
            Plage(5, 0, &[37, 38, 39, 40]),
            Plage(1, 1, &[2, 3, 6, 7, 11, 12, 19, 20, 27, 33, 34]),
        ],
    },
    Plan {
        classe: "3A",
        niveau: "3eme",
        titre: "Progression atelier — projet de fin de cycle",
        intitule_groupe: "",
        devise: "",
        eleves: &[
            ("Enzo", "BLANC"),
            ("Chloé", "GARNIER"),
            ("Ibrahim", "LAMBERT"),
            ("Sarah", "NOËL"),
            ("Mathis", "VIDAL"),
        ],
        etapes: &[
            Etape {
                libelle: "Reprendre les gestes",
                competences: "Retrouver seul le mode opératoire\nChoisir l'outil adapté sans le demander",
                connaissances: "Les assemblages courants",
                priorites: "L'autonomie du geste",
                activites: &[
                    Activite("Remise en route de l'atelier", 0),
                    Activite("Lecture de plans", 1),
                ],
            },
            Etape {
                libelle: "Conduire un projet",
                competences: "Tenir un planning sur plusieurs semaines\nRendre compte de son avancement\nTravailler à deux sur un même ouvrage",
                connaissances: "Le devis et la liste de matériel\nLes étapes d'un chantier",
                priorites: "Le projet avant l'exercice",
                activites: &[
                    Activite("Chantier : abri à vélos", 2),
                    Activite("Pose des équipements", 3),
                ],
            },
            Etape {
                libelle: "Préparer l'après",
                competences: "Présenter son parcours à un adulte extérieur\nRelire sa fiche contrat",
                connaissances: "Les métiers du bâtiment et leurs formations",
                priorites: "Se projeter",
                activites: &[Activite("Dossier de stage et oral", 3)],
            },
        ],
        plages: &[
            Plage(0, 0, &[0, 1, 2]),
            Plage(1, 0, &[3, 4, 5]),
            Plage(2, 0, &[8, 9, 10, 11, 12, 13, 14, 15, 16, 17]),
            Plage(3, 0, &[18, 19, 20, 21, 22]),
            Plage(4, 0, &[33, 34, 35, 36]),
            Plage(1, 1, &[9, 10, 16, 17]),
        ],
    },
    // Une classe SANS progression : « Aucune progression » est un état normal,
    // et la vue annuelle doit le montrer tel quel plutôt que d'escamoter la
    // ligne. `etapes` et `plages` vides suffisent : le semis ne crée alors
    // aucune ligne dans `progressions`.
    Plan {
        classe: "6C",
        niveau: "6eme",
        titre: "",
        intitule_groupe: "",
        devise: "",
        eleves: &[("Aya", "BENOIT"), ("Timéo", "GUERIN"), ("Lilou", "MASSON")],
        etapes: &[],
        plages: &[],
    },
];

/// Les créneaux hebdomadaires, par nom de classe. `None` = un créneau qui ne
/// concerne aucune classe (concertation, réunion d'équipe) : `session_id` est
/// nullable, et la grille doit savoir l'afficher.
const CRENEAUX: [(Option<&str>, &str, i32, &str, &str); 11] = [
    (Some("4B"), "Atelier Habitat", 1, "08:30", "10:30"),
    (Some("4B"), "Atelier Habitat", 3, "08:30", "10:30"),
    (Some("4B"), "Suivi de projet", 5, "13:30", "15:30"),
    (Some("3A"), "Atelier Habitat", 2, "08:30", "10:30"),
    (Some("3A"), "Chantier abri à vélos", 4, "13:30", "16:30"),
    (Some("3A"), "Préparation au stage", 5, "08:30", "10:00"),
    (Some("6C"), "Découverte de l'atelier", 2, "10:45", "12:15"),
    (Some("6C"), "Découverte de l'atelier", 4, "10:45", "12:15"),
    (Some("4A"), "Atelier Habitat", 1, "10:45", "12:15"),
    (Some("4A"), "Atelier Habitat", 4, "08:30", "10:30"),
    (None, "Concertation SEGPA", 1, "16:00", "17:00"),
];

/// Le lundi de la semaine `index` de l'année scolaire, 0-fondé.
///
/// La frise part du lundi de la semaine qui contient le 1er septembre, par la
/// même règle que `get_year_calendar` : c'est le lundi qui désigne la semaine,
/// jamais un numéro ISO.
fn lundi(annee: i32, index: usize) -> String {
    let septembre = NaiveDate::from_ymd_opt(annee, 9, 1).expect("1er septembre");
    let recul = septembre.weekday().num_days_from_monday() as i64;
    let premier = septembre - Duration::days(recul);
    (premier + Duration::weeks(index as i64))
        .format("%Y-%m-%d")
        .to_string()
}

/// Rend l'identifiant de la classe nommée, en la créant si elle n'existe pas.
fn classe(tx: &Transaction, annee: i32, nom: &str, niveau: &str) -> rusqlite::Result<String> {
    let existante: Option<String> = tx
        .query_row(
            "SELECT id FROM sessions WHERE name = ?1 AND year_start = ?2",
            params![nom, annee],
            |r| r.get(0),
        )
        .ok();
    if let Some(id) = existante {
        return Ok(id);
    }
    let nouvelle = id();
    tx.execute(
        "INSERT INTO sessions (id, name, level_code, year_start) VALUES (?1, ?2, ?3, ?4)",
        params![nouvelle, nom, niveau, annee],
    )?;
    Ok(nouvelle)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let data_dir = args
        .next()
        .unwrap_or_else(|| "target/debug/data".to_string());
    let password = args
        .next()
        .ok_or("Usage : cargo run --example seed_progression -- <dossier data> <mot de passe>")?;

    let racine = Path::new(&data_dir);
    std::fs::create_dir_all(racine.join("backups"))?;

    let mut conn = if racine.join("sgpa.keys").exists() {
        sgpa_lib::open_for_tools(racine, &password)?
    } else {
        let (conn, phrase) = sgpa_lib::create_for_tools(racine, &password)?;
        println!("Verrou créé. Phrase de récupération : {phrase}");
        conn
    };

    let annee = sgpa_lib::year_start_for(Local::now().date_naive());
    let suivante = annee + 1;
    let tx = conn.transaction()?;

    tx.execute(
        "UPDATE app_settings
            SET teacher_display_name = 'Théo Fourvel',
                school_name = 'Collège Jean Moulin'
          WHERE id = 1",
        [],
    )?;
    tx.execute(
        "INSERT INTO trimester_bounds (year_start, t1_start, t2_start, t3_start, year_end)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(year_start) DO NOTHING",
        params![
            annee,
            format!("{annee}-09-01"),
            format!("{annee}-12-01"),
            format!("{suivante}-03-01"),
            format!("{suivante}-07-07"),
        ],
    )?;

    // Le vocabulaire des domaines. `ON CONFLICT DO NOTHING` sur le nom : le
    // semis doit pouvoir être rejoué sans doubler la liste, et l'index unique
    // est insensible à la casse.
    let mut domaines = Vec::new();
    for (i, nom) in DOMAINES.iter().enumerate() {
        tx.execute(
            "INSERT INTO progression_domaines (id, name, position) VALUES (?1, ?2, ?3)
             ON CONFLICT(name COLLATE NOCASE) DO NOTHING",
            params![id(), nom, i as i32],
        )?;
        let existant: String = tx.query_row(
            "SELECT id FROM progression_domaines WHERE name = ?1 COLLATE NOCASE",
            params![nom],
            |r| r.get(0),
        )?;
        domaines.push(existant);
    }

    for plan in PLANS.iter() {
        let session = classe(&tx, annee, plan.classe, plan.niveau)?;

        for (prenom, nom) in plan.eleves {
            tx.execute(
                "INSERT INTO students (id, session_id, first_name, last_name, enrolled_on)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id(), session, prenom, nom, format!("{annee}-09-01")],
            )?;
        }

        if plan.etapes.is_empty() {
            println!("{} : élèves semés, aucune progression (voulu).", plan.classe);
            continue;
        }

        let progression = id();
        tx.execute(
            "INSERT INTO progressions (id, session_id, titre, intitule_groupe, devise)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                progression,
                session,
                plan.titre,
                plan.intitule_groupe,
                plan.devise
            ],
        )?;

        // Les activités sont collectées dans l'ordre de l'année — (étape, puis
        // activité dans l'étape) — parce que c'est ce même ordre qui donne son
        // rang à chacune côté Rust, et sa couleur. Les plages se désignent donc
        // par cet indice, pas par un identifiant à recopier à la main.
        let mut activites = Vec::new();
        for (p, etape) in plan.etapes.iter().enumerate() {
            let eid = id();
            tx.execute(
                "INSERT INTO progression_etapes
                     (id, progression_id, position, libelle, competences,
                      connaissances, priorites)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    eid,
                    progression,
                    p as i32,
                    etape.libelle,
                    etape.competences,
                    etape.connaissances,
                    etape.priorites
                ],
            )?;
            for (q, Activite(libelle, domaine)) in etape.activites.iter().enumerate() {
                let aid = id();
                tx.execute(
                    "INSERT INTO progression_activites
                         (id, etape_id, domaine_id, position, libelle)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![aid, eid, domaines[*domaine], q as i32, libelle],
                )?;
                activites.push(aid);
            }
        }

        for Plage(activite, voie, semaines) in plan.plages {
            for semaine in *semaines {
                tx.execute(
                    "INSERT INTO progression_plages
                         (progression_id, week_monday, voie, activite_id)
                     VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(progression_id, week_monday, voie)
                     DO UPDATE SET activite_id = excluded.activite_id",
                    params![
                        progression,
                        lundi(annee, *semaine),
                        voie,
                        activites[*activite]
                    ],
                )?;
            }
        }

        println!(
            "{} : {} étapes, {} activités, {} semaines peintes.",
            plan.classe,
            plan.etapes.len(),
            activites.len(),
            plan.plages.iter().map(|p| p.2.len()).sum::<usize>()
        );
    }

    // Les créneaux. Une classe absente de la base est ignorée plutôt que de
    // faire échouer le semis : `seed_demo` pose « 4A », mais il peut ne pas
    // avoir été joué.
    let mut poses = 0;
    for (nom, label, jour, debut, fin) in CRENEAUX.iter() {
        let session: Option<String> = match nom {
            Some(n) => {
                let trouvee: Option<String> = tx
                    .query_row(
                        "SELECT id FROM sessions WHERE name = ?1 AND year_start = ?2",
                        params![n, annee],
                        |r| r.get(0),
                    )
                    .ok();
                if trouvee.is_none() {
                    continue;
                }
                trouvee
            }
            None => None,
        };
        tx.execute(
            "INSERT INTO timetable_slots
                 (id, year_start, session_id, label, room, weekday, start_time, end_time)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id(),
                annee,
                session,
                label,
                "Atelier bois",
                jour,
                debut,
                fin
            ],
        )?;
        poses += 1;
    }
    println!("{poses} créneaux posés.");

    tx.commit()?;
    println!("Semis terminé dans {data_dir}.");
    Ok(())
}
