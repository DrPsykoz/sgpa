//! Vérifie que **chaque requête SQL du code** est valide contre le schéma réel.
//!
//! Le harnais de test de Tauri (`tauri::test::mock_builder`) permettrait
//! d'appeler les commandes elles-mêmes, mais ses binaires de test échouent au
//! démarrage sous Windows avec `STATUS_ENTRYPOINT_NOT_FOUND` : `tauri-build`
//! embarque un manifeste Windows dans l'exécutable de l'application, pas dans
//! ceux que produit `cargo test`, et les imports comctl32/uxtheme v6 ne se
//! résolvent pas.
//!
//! À défaut, ce test extrait toutes les requêtes littérales des modules de
//! commandes et les fait **préparer** par SQLite sur une base migrée. SQLite
//! résout alors les noms de tables, de colonnes et de fonctions : une colonne
//! renommée, une table oubliée ou une faute de frappe sont attrapées ici.
//!
//! Ce que ce test NE couvre PAS : la logique. Une requête syntaxiquement
//! valide qui compte les mauvaises lignes passera. Les invariants de calcul sont
//! couverts par les tests unitaires de `db` et de `reports::scoring`.

use rusqlite::Connection;

/// Sources analysées. Ajouter un module de commandes ici quand il en apparaît un.
const SOURCES: &[(&str, &str)] = &[
    ("absences", include_str!("commands/absences.rs")),
    ("attachments", include_str!("commands/attachments.rs")),
    ("contracts", include_str!("commands/contracts.rs")),
    ("evaluations", include_str!("commands/evaluations.rs")),
    ("home", include_str!("commands/home.rs")),
    ("lock", include_str!("commands/lock.rs")),
    ("maintenance", include_str!("commands/maintenance.rs")),
    ("needs", include_str!("commands/needs.rs")),
    ("progressions", include_str!("commands/progressions.rs")),
    ("referential", include_str!("commands/referential.rs")),
    ("reports", include_str!("commands/reports.rs")),
    ("seances", include_str!("commands/seances.rs")),
    ("sessions", include_str!("commands/sessions.rs")),
    ("students", include_str!("commands/students.rs")),
    ("timetable", include_str!("commands/timetable.rs")),
    ("trimesters", include_str!("commands/trimesters.rs")),
];

/// Extrait les littéraux de chaîne d'un source Rust.
///
/// Gère les guillemets échappés et les chaînes brutes `r"…"` / `r#"…"#`, qui
/// suffisent à couvrir la façon dont le SQL est écrit dans ce projet.
fn string_literals(source: &str) -> Vec<String> {
    let bytes: Vec<char> = source.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;

    while i < bytes.len() {
        // Chaîne brute : r, puis N dièses, puis un guillemet.
        if bytes[i] == 'r' {
            let mut j = i + 1;
            let mut hashes = 0;
            while j < bytes.len() && bytes[j] == '#' {
                hashes += 1;
                j += 1;
            }
            if j < bytes.len() && bytes[j] == '"' {
                let closing: String = std::iter::once('"')
                    .chain(std::iter::repeat_n('#', hashes))
                    .collect();
                let rest: String = bytes[j + 1..].iter().collect();
                if let Some(end) = rest.find(&closing) {
                    out.push(rest[..end].to_string());
                    i = j + 1 + end + closing.len();
                    continue;
                }
            }
        }

        if bytes[i] == '"' {
            let mut j = i + 1;
            let mut literal = String::new();
            while j < bytes.len() {
                match bytes[j] {
                    '\\' => {
                        // On conserve la séquence telle quelle : le SQL de ce projet
                        // n'utilise que \" et \n, sans effet sur l'analyse SQLite.
                        if j + 1 < bytes.len() {
                            if bytes[j + 1] == 'n' {
                                literal.push('\n');
                            } else {
                                literal.push(bytes[j + 1]);
                            }
                            j += 2;
                            continue;
                        }
                        j += 1;
                    }
                    '"' => break,
                    c => {
                        literal.push(c);
                        j += 1;
                    }
                }
            }
            out.push(literal);
            i = j + 1;
            continue;
        }

        i += 1;
    }

    out
}

fn looks_like_sql(s: &str) -> bool {
    let head = s.trim_start().to_ascii_uppercase();
    [
        "SELECT ", "INSERT ", "UPDATE ", "DELETE ", "WITH ", "REPLACE ",
    ]
    .iter()
    .any(|kw| head.starts_with(kw))
}

/// Base migrée, en mémoire : le schéma y est exactement celui des paliers.
fn migrated_db() -> Connection {
    let dir = std::env::temp_dir().join("sgpa-sql-smoke");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let mut conn = Connection::open(dir.join("sgpa.db")).unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    crate::db::migrations::run(&mut conn, &dir).unwrap();
    conn
}

#[test]
fn toutes_les_requetes_sql_sont_valides_contre_le_schema() {
    let conn = migrated_db();

    let mut checked = 0usize;
    let mut skipped_templates = 0usize;
    let mut failures: Vec<String> = Vec::new();

    for (module, source) in SOURCES {
        for literal in string_literals(source) {
            if !looks_like_sql(&literal) {
                continue;
            }
            // Les requêtes assemblées par `format!` portent des accolades : elles
            // ne sont pas préparables telles quelles. Leur partie variable est
            // toujours un `&'static str` choisi par un `match` du module, jamais
            // une saisie utilisateur.
            if literal.contains('{') || literal.contains('}') {
                skipped_templates += 1;
                continue;
            }

            match conn.prepare(&literal) {
                Ok(_) => checked += 1,
                Err(e) => {
                    let extrait: String = literal.split_whitespace().collect::<Vec<_>>().join(" ");
                    let extrait = extrait.chars().take(140).collect::<String>();
                    failures.push(format!("[{module}] {e}\n    → {extrait}"));
                }
            }
        }
    }

    assert!(
        failures.is_empty(),
        "{} requête(s) invalide(s) contre le schéma :\n\n{}",
        failures.len(),
        failures.join("\n\n")
    );

    // Garde-fou : si l'extraction cesse de fonctionner (refactor, chaînes
    // construites autrement), le test passerait en ne vérifiant rien.
    //
    // Le seuil reste sous le compte réel — 250 au palier 019, dont une vingtaine
    // apportées par `timetable.rs` et une quinzaine par `absences.rs` et les
    // tests de `reports.rs`. Il ne se relève qu'avec un module de plus, et ne
    // s'abaisse qu'exceptionnellement : `lock.rs` est passé de six requêtes à
    // trois quand le mot de passe, son indice et la phrase de récupération ont
    // quitté la base pour `data/sgpa.keys`, qui n'est pas du SQL.
    assert!(
        checked >= 225,
        "seulement {checked} requêtes analysées — l'extraction ne trouve plus le SQL du projet"
    );

    eprintln!(
        "[sql_smoke] {checked} requêtes préparées avec succès, \
         {skipped_templates} assemblées par format! (non préparables telles quelles)"
    );
}
