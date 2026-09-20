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

use std::path::Path;

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

    let tx = conn.transaction()?;

    // Le mot de passe ne vit plus dans la base : il n'y a rien à y poser.
    tx.execute(
        "UPDATE app_settings
            SET teacher_display_name = 'Théo Fourvel',
                school_name = 'Collège Jean Moulin'
          WHERE id = 1",
        [],
    )?;

    // Une classe de 4ème pour l'année 2021-2022.
    let classe = id();
    tx.execute(
        "INSERT INTO sessions (id, name, level_code, year_start) VALUES (?1, '4A', '4eme', 2021)",
        params![classe],
    )?;
    tx.execute(
        "INSERT INTO trimester_bounds (year_start, t1_start, t2_start, t3_start, year_end)
         VALUES (2021, '2021-09-01', '2021-12-01', '2022-03-01', '2022-07-07')
         ON CONFLICT(year_start) DO NOTHING",
        [],
    )?;

    // Six élèves, dont un arrivé en janvier : c'est lui qui met à l'épreuve le
    // dénominateur d'assiduité.
    let eleves: Vec<(String, &str, &str, &str)> = vec![
        (id(), "Léa", "BERNARD", "2021-09-01"),
        (id(), "Hugo", "DUBOIS", "2021-09-01"),
        (id(), "Inès", "LEROY", "2021-09-01"),
        (id(), "Noah", "MOREAU", "2021-09-01"),
        (id(), "Jade", "PETIT", "2021-09-01"),
        (id(), "Sacha", "ROUX", "2022-01-10"),
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
    let seances: Vec<(String, &str, &str, i32, i32)> = vec![
        (id(), "Séance du 14/09", "2021-09-14", 1, 0),
        (id(), "Sortie au musée", "2021-10-05", 1, 1),
        (id(), "Séance du 09/11", "2021-11-09", 1, 0),
        (id(), "Séance du 18/01", "2022-01-18", 2, 0),
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
         VALUES (?1, ?2, 'Lecture expressive — évaluation 1', '2021-11-09', 1)",
        params![eval, classe],
    )?;
    for (i, (cid, _)) in comps.iter().enumerate() {
        tx.execute(
            "INSERT INTO evaluation_competencies (evaluation_id, competency_id, position)
             VALUES (?1, ?2, ?3)",
            params![eval, cid, i as i32],
        )?;
    }
    for (e, (eid, _, _, depuis)) in eleves.iter().enumerate() {
        if *depuis > "2021-11-09" {
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

    println!("Jeu de démonstration écrit dans {data_dir}/sgpa.db");
    Ok(())
}
