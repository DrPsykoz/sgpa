//! Remplit une base SGPA avec un jeu de démonstration, pour vérifier les écrans
//! sans avoir à tout ressaisir à la main.
//!
//! ```powershell
//! cargo run --example seed_demo -- target\debug\data mon-mot-de-passe
//! ```
//!
//! La base étant chiffrée, il faut le mot de passe défini au premier lancement
//! de l'application : c'est lui qui déballe la clé maître de `data/sgpa.keys`.
//! Ce fichier n'est pas compilé dans l'application : `examples/` n'est bâti que
//! sur demande.
//!
//! **Toutes les dates sont relatives à l'année scolaire en cours**, et aucune
//! n'est écrite en dur. La version précédente figeait la démonstration sur
//! 2021-2022 : la classe, les bornes de trimestres, les inscriptions, les
//! séances et l'évaluation. L'emploi du temps, lui, s'ouvre sur la semaine
//! d'aujourd'hui et ne propose que les classes de l'année qu'il affiche — le
//! sélecteur « Classe » était donc vide, sans qu'aucun écran puisse l'expliquer,
//! et la grille de démonstration était inatteignable cinq ans durant.

use std::path::Path;

use chrono::Local;
use rusqlite::params;
use uuid::Uuid;

fn id() -> String {
    Uuid::new_v4().to_string()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let data_dir = args
        .next()
        .unwrap_or_else(|| "target/debug/data".to_string());
    let password = args
        .next()
        .ok_or("Usage : cargo run --example seed_demo -- <dossier data> <mot de passe>")?;

    let racine = Path::new(&data_dir);
    std::fs::create_dir_all(racine.join("backups"))?;

    // Si aucun verrou n'existe, on en crée un : le jeu de démonstration doit
    // pouvoir partir d'un dossier vide, sans passer par l'écran de premier
    // lancement.
    let mut conn = if racine.join("sgpa.keys").exists() {
        sgpa_lib::open_for_tools(racine, &password)?
    } else {
        let (conn, phrase) = sgpa_lib::create_for_tools(racine, &password)?;
        println!("Verrou créé. Phrase de récupération : {phrase}");
        conn
    };

    let version: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version == 0 {
        return Err(format!(
            "{data_dir}/sgpa.db n'est pas une base SGPA migrée. \
             Lancez l'application une fois d'abord."
        )
        .into());
    }

    // L'année scolaire de la démonstration est celle d'aujourd'hui, et elle est
    // calculée par `year_start_for` — la fonction même dont se sert l'emploi du
    // temps. La recopier ici (« l'année civile, ou la précédente avant août »)
    // donnerait deux implémentations d'une seule règle, qui divergeraient au
    // premier déplacement de la bascule du 1er août : la démonstration
    // atterrirait alors sur une année que la grille ne regarde pas, et le défaut
    // serait exactement celui que ce semis corrige.
    let annee = sgpa_lib::year_start_for(Local::now().date_naive());
    let suivante = annee + 1;

    // Les quelques dates du jeu, posées une fois. Les journées et les mois sont
    // gardés tels quels : ils situent la rentrée, le musée, le conseil de
    // classe — c'est leur place dans l'année qui compte, pas leur millésime.
    let rentree = format!("{annee}-09-01");
    let arrivee_tardive = format!("{suivante}-01-10");
    let date_evaluation = format!("{annee}-11-09");

    let tx = conn.transaction()?;

    // Le mot de passe ne vit plus dans la base : il n'y a rien à y poser.
    tx.execute(
        "UPDATE app_settings
            SET teacher_display_name = 'Théo Fourvel',
                school_name = 'Collège Jean Moulin'
          WHERE id = 1",
        [],
    )?;

    // Une classe de 4ème pour l'année scolaire en cours.
    let classe = id();
    tx.execute(
        "INSERT INTO sessions (id, name, level_code, year_start) VALUES (?1, '4A', '4eme', ?2)",
        params![classe, annee],
    )?;
    tx.execute(
        "INSERT INTO trimester_bounds (year_start, t1_start, t2_start, t3_start, year_end)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(year_start) DO NOTHING",
        params![
            annee,
            rentree,
            format!("{annee}-12-01"),
            format!("{suivante}-03-01"),
            format!("{suivante}-07-07"),
        ],
    )?;

    // Six élèves, dont un arrivé en janvier : c'est lui qui met à l'épreuve le
    // dénominateur d'assiduité.
    let eleves: Vec<(String, &str, &str, String)> = vec![
        (id(), "Léa", "BERNARD", rentree.clone()),
        (id(), "Hugo", "DUBOIS", rentree.clone()),
        (id(), "Inès", "LEROY", rentree.clone()),
        (id(), "Noah", "MOREAU", rentree.clone()),
        (id(), "Jade", "PETIT", rentree.clone()),
        (id(), "Sacha", "ROUX", arrivee_tardive),
    ];
    for (eid, prenom, nom, depuis) in &eleves {
        tx.execute(
            "INSERT INTO students (id, session_id, first_name, last_name, enrolled_on)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![eid, classe, prenom, nom, depuis],
        )?;
    }

    // Compétences sous la première composante du domaine 1 (posée par le semis).
    let comps: Vec<(String, &str)> = vec![
        (id(), "Lire à voix haute de manière expressive"),
        (id(), "Rédiger un texte cohérent"),
        (id(), "Participer à un échange oral"),
    ];
    for (i, (cid, nom)) in comps.iter().enumerate() {
        tx.execute(
            "INSERT INTO competencies (id, field_id, name, position)
             VALUES (?1, 'seed-d1-f1', ?2, ?3)",
            params![cid, nom, i as i32],
        )?;
    }

    // Quatre séances : trois au T1, une au T2. La deuxième est annulée (sortie).
    let seances: Vec<(String, String, String, i32, i32)> = vec![
        (
            id(),
            "Séance du 14/09".into(),
            format!("{annee}-09-14"),
            1,
            0,
        ),
        (
            id(),
            "Sortie au musée".into(),
            format!("{annee}-10-05"),
            1,
            1,
        ),
        (
            id(),
            "Séance du 09/11".into(),
            date_evaluation.clone(),
            1,
            0,
        ),
        (
            id(),
            "Séance du 18/01".into(),
            format!("{suivante}-01-18"),
            2,
            0,
        ),
    ];
    for (sid, titre, date, trim, annulee) in &seances {
        tx.execute(
            "INSERT INTO seances (id, session_id, title, date, trimester, cancelled, content_html,
                                  attendance_taken_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6,
                     '<h3>Objectif</h3><p>Lecture expressive d''un extrait.</p>',
                     CASE WHEN ?6 = 1 THEN NULL ELSE datetime('now') END)",
            params![sid, classe, titre, date, trim, annulee],
        )?;
    }

    // Appel sur les séances non annulées, pour les élèves déjà inscrits.
    let statuts = [
        "present", "present", "absent", "present", "retard", "excuse",
    ];
    for (sid, _, date, _, annulee) in &seances {
        if *annulee == 1 {
            continue;
        }
        for (i, (eid, _, _, depuis)) in eleves.iter().enumerate() {
            if depuis > date {
                continue; // pas encore inscrit à cette date
            }
            tx.execute(
                "INSERT INTO attendance_records (seance_id, student_id, status)
                 VALUES (?1, ?2, ?3)",
                params![sid, eid, statuts[(i + date.len()) % statuts.len()]],
            )?;
        }
    }

    // Une évaluation au T1, notée pour tout le monde.
    let eval = id();
    tx.execute(
        "INSERT INTO evaluations (id, session_id, title, date, trimester)
         VALUES (?1, ?2, 'Lecture expressive — évaluation 1', ?3, 1)",
        params![eval, classe, date_evaluation],
    )?;
    for (i, (cid, _)) in comps.iter().enumerate() {
        tx.execute(
            "INSERT INTO evaluation_competencies (evaluation_id, competency_id, position)
             VALUES (?1, ?2, ?3)",
            params![eval, cid, i as i32],
        )?;
    }
    for (e, (eid, _, _, depuis)) in eleves.iter().enumerate() {
        if depuis > &date_evaluation {
            continue;
        }
        for (c, (cid, _)) in comps.iter().enumerate() {
            let niveau = 1 + ((e * 3 + c * 2) % 5) as i32;
            tx.execute(
                "INSERT INTO grades (evaluation_id, competency_id, student_id, level)
                 VALUES (?1, ?2, ?3, ?4)",
                params![eval, cid, eid, niveau],
            )?;
        }
    }

    // Un commentaire de bilan.
    tx.execute(
        "INSERT INTO report_comments (student_id, trimester, teacher_comment)
         VALUES (?1, 1, 'Trimestre encourageant. Léa gagne en assurance à l''oral et
prend part aux échanges. À poursuivre.')",
        params![eleves[0].0],
    )?;

    tx.commit()?;

    println!("Jeu de démonstration écrit dans {data_dir}/sgpa.db — année scolaire {annee}-{suivante}.");
    Ok(())
}
