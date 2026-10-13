//! Semis du calendrier scolaire embarqué.
//!
//! # LA RÈGLE DE CE FICHIER : IL NE REND RIEN, ET IL NE PEUT RIEN FAIRE ÉCHOUER
//!
//! Ce n'est pas une précaution de style. `seed` est appelée depuis
//! `db::prepare_encrypted`, qui remonte à **deux** commandes :
//!
//! * `unlock` — une erreur empêcherait l'enseignant d'ouvrir sa propre base ;
//! * `setup_lock` — et là c'est pire : l'échec y déclenche `annuler_setup`
//!   (`commands/lock.rs`), qui **supprime `data/sgpa.keys`**. Une seule ligne de
//!   calendrier mal formée rendrait l'application définitivement impossible à
//!   configurer, avec un message parlant de vacances scolaires.
//!
//! Il faut tuer au passage un raisonnement faux et séduisant : « le
//! `CHECK (start_date <= end_date)` du schéma écartera tout seul les lignes sans
//! durée ». **Non.** SQLite ne saute pas une ligne fautive : il lève une erreur
//! et avorte la transaction. C'est `scripts/vacances.mjs` qui écarte ces lignes,
//! à la génération, où un échec ne coûte rien.
//!
//! Les vacances sont une **couche d'affichage**. Elles n'ont pas le droit
//! d'empêcher l'ouverture d'un bilan. Toute erreur est donc journalisée sur
//! stderr et comptée, jamais propagée.
//!
//! # Ce n'est PAS un palier de migration
//!
//! Un palier livré n'est jamais rejoué : son numéro est inscrit dans
//! `user_version`. Ces données, elles, doivent se **rafraîchir à chaque version
//! de SGPA** — sinon un enseignant qui met à jour en 2029 garderait le
//! calendrier de 2026. D'où un semis idempotent, gardé par un millésime, appelé
//! après les migrations.

use rusqlite::Connection;
use serde::Deserialize;

/// Le calendrier, embarqué dans l'exécutable. Produit par `pnpm vacances`,
/// commité, relisible en diff.
const DONNEES: &str = include_str!("data/vacances.json");

#[derive(Deserialize)]
struct Fichier {
    #[allow(dead_code)]
    source: String,
    /// Dernier jour couvert. La grille l'affiche en pied de page : sans cette
    /// ligne, la fonctionnalité ne s'éteindrait pas, elle se mettrait à mentir
    /// dans l'autre sens — des créneaux redessinés pendant des vacances qu'on
    /// ne connaît plus.
    couvert_jusqu_au: String,
    /// Première date couverte, et borne de la purge : voir `tenter`.
    depuis: String,
    /// `[id, académie, libellé, début, fin]`. Des tuples et non des objets :
    /// 59 ko au lieu de 150, et une ligne par période dans le diff.
    periodes: Vec<(String, String, String, String, String)>,
}

/// Dernier jour du calendrier embarqué, pour l'afficher dans la grille.
///
/// Rend `None` si le fichier est illisible — même doctrine que `seed` : une
/// donnée d'affichage ne fait rien échouer.
pub fn couvert_jusqu_au() -> Option<String> {
    serde_json::from_str::<Fichier>(DONNEES)
        .ok()
        .map(|f| f.couvert_jusqu_au)
}

/// Réaligne les périodes `'officiel'` sur le fichier embarqué.
///
/// **Ne rend rien, volontairement.** Voir la règle en tête de fichier.
pub fn seed(conn: &mut Connection) {
    if let Err(message) = tenter(conn) {
        eprintln!("[sgpa] calendrier scolaire non semé : {message}");
    }
}

fn tenter(conn: &mut Connection) -> Result<(), String> {
    let fichier: Fichier =
        serde_json::from_str(DONNEES).map_err(|e| format!("fichier embarqué illisible : {e}"))?;

    // Garde par millésime : une lecture, et on sort. Le millésime vient de la
    // DONNÉE (dernière date couverte) et non de l'horloge : deux versions de
    // SGPA portant le même calendrier ne resèment pas.
    let pose: String = conn
        .query_row(
            "SELECT holidays_stamp FROM app_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("lecture du millésime : {e}"))?;
    if pose == fichier.couvert_jusqu_au {
        return Ok(());
    }

    let tx = conn
        .transaction()
        .map_err(|e| format!("ouverture de la transaction : {e}"))?;

    // 1. Purge du SEUL officiel, et SEULEMENT sur la fenêtre que le fichier
    //    couvre. Sans cette borne, une version future à fenêtre plus étroite
    //    effacerait en silence une année qu'une version antérieure avait semée.
    //    Les lignes 'manuel' ne sont JAMAIS touchées : ce sont les journées
    //    banalisées et les corrections de l'enseignant.
    tx.execute(
        "DELETE FROM school_holidays WHERE origin = 'officiel' AND start_date >= ?1",
        [&fichier.depuis],
    )
    .map_err(|e| format!("purge des périodes officielles : {e}"))?;

    // 2. Insertion ligne à ligne, l'identifiant venant du fichier.
    //
    //    ⚠ `ON CONFLICT DO NOTHING`, ET C'EST LA LIGNE QUI SAUVE LES
    //    CORRECTIONS. Corriger une période officielle la fait passer en
    //    'manuel' : elle survit donc au DELETE ci-dessus, garde son identifiant,
    //    et l'originale ne revient PAS se mettre à côté d'elle. Sans ce
    //    `DO NOTHING`, l'enseignant aurait DEUX « Vacances de la Toussaint »,
    //    l'une corrigée, l'autre non.
    let mut pose_une = tx
        .prepare(
            "INSERT INTO school_holidays (id, academie, label, start_date, end_date, origin)
             VALUES (?1, ?2, ?3, ?4, ?5, 'officiel')
             ON CONFLICT(id) DO NOTHING",
        )
        .map_err(|e| format!("préparation de l'insertion : {e}"))?;

    let mut ecartees = 0usize;
    for (id, academie, label, debut, fin) in &fichier.periodes {
        // Dernier filet, et il est délibérément redondant avec le script : une
        // ligne fautive est COMPTÉE et SAUTÉE ici, jamais laissée aller jusqu'au
        // CHECK qui avorterait la transaction — donc le semis — donc, au premier
        // lancement, la création du verrou.
        if academie.is_empty()
            || label.is_empty()
            || fin < debut
            || !date_valide(debut)
            || !date_valide(fin)
        {
            ecartees += 1;
            continue;
        }
        if let Err(e) = pose_une.execute([id, academie, label, debut, fin]) {
            eprintln!("[sgpa] période de vacances ignorée ({id}) : {e}");
            ecartees += 1;
        }
    }
    drop(pose_une);

    if ecartees > 0 {
        eprintln!("[sgpa] calendrier scolaire : {ecartees} période(s) écartée(s)");
    }

    // 3. Le millésime, dans la MÊME transaction : pas de semis à moitié appliqué.
    tx.execute(
        "UPDATE app_settings SET holidays_stamp = ?1, updated_at = datetime('now')
          WHERE id = 1",
        [&fichier.couvert_jusqu_au],
    )
    .map_err(|e| format!("écriture du millésime : {e}"))?;

    tx.commit()
        .map_err(|e| format!("validation du semis : {e}"))?;
    Ok(())
}

/// `AAAA-MM-JJ`, la forme qu'exigent les `CHECK` du schéma et que supposent
/// toutes les comparaisons lexicographiques de dates du projet.
///
/// Ne vérifie que la FORME : une date du 31 février passerait, et c'est sans
/// conséquence ici — le calendrier n'est qu'un affichage, et le ministère ne
/// publie pas de 31 février.
fn date_valide(s: &str) -> bool {
    s.len() == 10
        && s.as_bytes()[4] == b'-'
        && s.as_bytes()[7] == b'-'
        && s.bytes().enumerate().all(|(i, b)| {
            if i == 4 || i == 7 {
                b == b'-'
            } else {
                b.is_ascii_digit()
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_migree(nom: &str) -> Connection {
        let dir = std::env::temp_dir().join(format!("sgpa-vac-{nom}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = Connection::open(dir.join("sgpa.db")).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::db::migrations::run(&mut conn, &dir).unwrap();
        conn
    }

    fn compte(conn: &Connection, origine: &str) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM school_holidays WHERE origin = ?1",
            [origine],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn le_fichier_embarque_est_coherent() {
        let f: Fichier = serde_json::from_str(DONNEES).expect("JSON valide");
        assert!(!f.periodes.is_empty(), "le fichier ne doit pas être vide");
        let mut vus = std::collections::HashSet::new();
        for (id, academie, label, debut, fin) in &f.periodes {
            assert!(date_valide(debut), "date de début : {debut}");
            assert!(date_valide(fin), "date de fin : {fin}");
            assert!(debut <= fin, "{debut} > {fin} ferait échouer le CHECK");
            assert!(!academie.is_empty(), "académie vide");
            assert!(!label.is_empty(), "libellé vide");
            assert!(vus.insert(id.clone()), "identifiant en double : {id}");
            assert!(debut >= &f.depuis, "{debut} hors de la fenêtre annoncée");
        }
    }

    /// Le cas qui porte les DEUX décalages d'heure d'été dans le même
    /// enregistrement, et qui prouve que la conversion du script est juste.
    /// `2026-10-16T22:00Z` = 17 octobre (UTC+2), `2026-11-01T23:00Z` =
    /// 2 novembre (UTC+1), dont on retire un jour pour avoir le DERNIER jour de
    /// vacances et non le jour de reprise.
    #[test]
    fn la_toussaint_2026_de_besancon_est_juste() {
        let f: Fichier = serde_json::from_str(DONNEES).unwrap();
        let trouve = f.periodes.iter().find(|(_, a, l, d, _)| {
            a == "Besançon" && l.contains("Toussaint") && d.starts_with("2026-")
        });
        let (_, _, _, debut, fin) = trouve.expect("Toussaint 2026 à Besançon");
        assert_eq!(debut, "2026-10-17");
        assert_eq!(fin, "2026-11-01");
    }

    #[test]
    fn le_semis_pose_les_periodes_puis_est_idempotent() {
        let mut conn = base_migree("idempotent");
        seed(&mut conn);
        let apres = compte(&conn, "officiel");
        assert!(apres > 400, "attendu plusieurs centaines, obtenu {apres}");

        // Rejouer ne doit rien ajouter — ni dédoubler, ni réécrire.
        seed(&mut conn);
        seed(&mut conn);
        assert_eq!(compte(&conn, "officiel"), apres);
    }

    /// Une ligne `'manuel'` appartient à l'enseignant : le semis ne la touche
    /// jamais. C'est elle qui porte les journées banalisées.
    #[test]
    fn une_periode_manuelle_survit_au_semis() {
        let mut conn = base_migree("manuelle");
        seed(&mut conn);
        conn.execute(
            "INSERT INTO school_holidays (id, academie, label, start_date, end_date, origin)
             VALUES ('a-moi', 'Besançon', 'Journée banalisée', '2026-11-16', '2026-11-16',
                     'manuel')",
            [],
        )
        .unwrap();

        // Le millésime est remis à vide pour forcer un vrai second semis.
        conn.execute("UPDATE app_settings SET holidays_stamp = ''", [])
            .unwrap();
        seed(&mut conn);

        assert_eq!(compte(&conn, "manuel"), 1, "la ligne manuelle a disparu");
        let label: String = conn
            .query_row(
                "SELECT label FROM school_holidays WHERE id = 'a-moi'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(label, "Journée banalisée");
    }

    /// Une période officielle corrigée passe en `'manuel'`, garde son
    /// identifiant, et l'originale ne revient donc PAS se mettre à côté d'elle.
    /// Sans le `ON CONFLICT DO NOTHING`, il y aurait deux Toussaint.
    #[test]
    fn une_correction_ne_se_dedouble_pas_au_semis_suivant() {
        let mut conn = base_migree("correction");
        seed(&mut conn);

        let id: String = conn
            .query_row(
                "SELECT id FROM school_holidays
                  WHERE academie = 'Besançon' AND label LIKE '%Toussaint%'
                    AND start_date LIKE '2026-%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        conn.execute(
            "UPDATE school_holidays SET end_date = '2026-11-02', origin = 'manuel'
              WHERE id = ?1",
            [&id],
        )
        .unwrap();

        conn.execute("UPDATE app_settings SET holidays_stamp = ''", [])
            .unwrap();
        seed(&mut conn);

        let combien: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM school_holidays
                  WHERE academie = 'Besançon' AND label LIKE '%Toussaint%'
                    AND start_date LIKE '2026-%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(combien, 1, "la correction s'est dédoublée");
        let fin: String = conn
            .query_row(
                "SELECT end_date FROM school_holidays WHERE id = ?1",
                [&id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fin, "2026-11-02", "la correction a été écrasée");
    }

    /// Le millésime évite le travail inutile : une fois posé, le semis sort sur
    /// une seule lecture.
    #[test]
    fn le_millesime_est_pose() {
        let mut conn = base_migree("millesime");
        seed(&mut conn);
        let pose: String = conn
            .query_row("SELECT holidays_stamp FROM app_settings", [], |r| r.get(0))
            .unwrap();
        assert_eq!(pose, couvert_jusqu_au().unwrap());
    }

    /// **Le test qui porte la règle du fichier.** Un semis impossible ne doit
    /// JAMAIS remonter : sur une base sans la table, `seed` journalise et se
    /// tait. Si elle propageait, `setup_lock` supprimerait `data/sgpa.keys`.
    #[test]
    fn un_semis_impossible_ne_fait_rien_echouer() {
        let dir = std::env::temp_dir().join("sgpa-vac-sans-table");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = Connection::open(dir.join("sgpa.db")).unwrap();
        // Base vierge : ni `app_settings`, ni `school_holidays`.
        seed(&mut conn); // ne doit pas paniquer
        assert!(tenter(&mut conn).is_err(), "la cause doit rester visible");
    }

    #[test]
    fn date_valide_refuse_ce_qui_casserait_le_check() {
        assert!(date_valide("2026-10-17"));
        assert!(!date_valide(""));
        assert!(!date_valide("2026-10-1"));
        assert!(!date_valide("2026/10/17"));
        assert!(!date_valide("20261017"));
        assert!(!date_valide("abcd-ef-gh"));
    }
}
