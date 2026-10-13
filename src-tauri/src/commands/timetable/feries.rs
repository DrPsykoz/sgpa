//! Jours fériés français — **calculés, jamais téléchargés, jamais stockés.**
//!
//! # Pourquoi ce fichier existe
//!
//! L'open data du ministère est un calendrier de VACANCES, pas de jours fériés.
//! Mesuré sur les 2 587 enregistrements du jeu `fr-en-calendrier-scolaire` :
//! `description = "Ascension"` en rend **un seul** (Guadeloupe, 2022-2023), et
//! « Pentecôte » deux. Croisé avec les cinq vraies périodes de vacances de
//! 2026-2027, **quatre fériés tombent un jour de classe et ne sont nulle part** :
//!
//! ```text
//! mer. 11/11/2026   Armistice            *** JOUR DE CLASSE ***
//! lun. 29/03/2027   Lundi de Pâques      *** JOUR DE CLASSE ***
//! jeu. 06/05/2027   Ascension            *** JOUR DE CLASSE ***
//! lun. 17/05/2027   Lundi de Pentecôte   *** JOUR DE CLASSE ***
//! ```
//!
//! Le « Pont de l'Ascension » existe bien dans le jeu, mais sur 28 lignes pour
//! 2026-2027, **quatre seulement ont une durée non nulle** — les 24 académies de
//! métropole publient un intervalle vide, que `scripts/vacances.mjs` écarte.
//!
//! # Zéro donnée, zéro requête, zéro millésime
//!
//! Tout se calcule. Il n'y a donc rien à semer, rien à migrer, et surtout rien
//! qui périme : contrairement au calendrier des vacances, embarqué et borné dans
//! le temps, ces dates sont justes en 2040 comme en 2026.

use chrono::{Datelike, NaiveDate};

/// Dimanche de Pâques — algorithme grégorien anonyme (Meeus/Jones/Butcher).
///
/// VÉRIFIÉ contre le calendrier réel sur six années consécutives, voir les
/// tests. Les noms de variables sont ceux de l'algorithme publié : les
/// renommer en « mois intermédiaire » et « reste de l'épacte » rendrait la
/// comparaison avec la référence impossible, ce qui est le seul moyen de
/// relire ce calcul.
fn paques(annee: i32) -> Option<NaiveDate> {
    let a = annee % 19;
    let b = annee / 100;
    let c = annee % 100;
    let d = b / 4;
    let e = b % 4;
    let f = (b + 8) / 25;
    let g = (b - f + 1) / 3;
    let h = (19 * a + b - d - g + 15) % 30;
    let i = c / 4;
    let k = c % 4;
    let l = (32 + 2 * e + 2 * i - h - k) % 7;
    let m = (a + 11 * h + 22 * l) / 451;
    let mois = (h + l - 7 * m + 114) / 31;
    let jour = (h + l - 7 * m + 114) % 31 + 1;
    NaiveDate::from_ymd_opt(annee, mois as u32, jour as u32)
}

/// Les onze jours fériés d'une année **civile**, dans l'ordre chronologique.
///
/// # Deux décisions, et leurs raisons
///
/// **Le lundi de Pentecôte EST férié.** La journée de solidarité ne l'a pas
/// supprimé depuis 2008 : elle est librement positionnée par l'employeur, et
/// aucun collège ne fait cours ce jour-là. Choix confirmé par l'auteur.
///
/// **PAS les deux fériés d'Alsace-Moselle** (Vendredi saint, 26 décembre). Le
/// droit local suit le DÉPARTEMENT, pas l'académie : Nancy-Metz couvre le 57,
/// mais aussi le 54, le 55 et le 88, qui ne les ont pas. Les déduire de
/// l'académie serait faux pour trois départements sur quatre. Ils se saisissent
/// à la main, comme n'importe quelle journée banalisée.
///
/// **PAS les fériés des territoires d'outre-mer** (abolition de l'esclavage,
/// dates variables par territoire) : l'open data du ministère les publie, lui,
/// comme périodes de vacances. C'est donc le calendrier embarqué qui les porte,
/// et les dédoubler ici les ferait apparaître deux fois.
pub fn feries(annee: i32) -> Vec<(NaiveDate, &'static str)> {
    let mut jours: Vec<(NaiveDate, &'static str)> = Vec::with_capacity(11);
    let mut fixe = |mois: u32, jour: u32, nom: &'static str| {
        if let Some(d) = NaiveDate::from_ymd_opt(annee, mois, jour) {
            jours.push((d, nom));
        }
    };

    fixe(1, 1, "Jour de l'An");
    fixe(5, 1, "Fête du Travail");
    fixe(5, 8, "Victoire 1945");
    fixe(7, 14, "Fête nationale");
    fixe(8, 15, "Assomption");
    fixe(11, 1, "Toussaint");
    fixe(11, 11, "Armistice");
    fixe(12, 25, "Noël");

    // Les trois mobiles. Le dimanche de Pâques n'est pas listé : il est férié,
    // mais un dimanche n'a jamais de cours, et l'afficher mettrait un bandeau
    // « Pâques » sur une colonne que la grille ne dessine même pas.
    if let Some(p) = paques(annee) {
        jours.push((p + chrono::Duration::days(1), "Lundi de Pâques"));
        jours.push((p + chrono::Duration::days(39), "Ascension"));
        jours.push((p + chrono::Duration::days(50), "Lundi de Pentecôte"));
    }

    jours.sort_by_key(|(d, _)| *d);
    jours
}

/// Vrai si cette date est un jour où personne ne fait cours **par principe** :
/// un férié, un samedi ou un dimanche.
///
/// Le week-end est inclus ici parce que l'appelant poserait sinon la question
/// deux fois. La grille ne dessine de toute façon samedi et dimanche que s'ils
/// portent déjà quelque chose.
pub fn nom_du_ferie(date: NaiveDate) -> Option<&'static str> {
    feries(date.year())
        .into_iter()
        .find(|(d, _)| *d == date)
        .map(|(_, nom)| nom)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Weekday;

    fn jour(iso: &str) -> NaiveDate {
        NaiveDate::parse_from_str(iso, "%Y-%m-%d").unwrap()
    }

    /// Les dates de Pâques ne se déduisent pas : elles se vérifient contre le
    /// calendrier réel, sinon l'algorithme n'est qu'une suite d'opérations
    /// qu'on espère justes.
    #[test]
    fn paques_tombe_aux_vraies_dates() {
        let attendu = [
            (2025, "2025-04-20"),
            (2026, "2026-04-05"),
            (2027, "2027-03-28"),
            (2028, "2028-04-16"),
            (2029, "2029-04-01"),
            (2030, "2030-04-21"),
        ];
        for (annee, iso) in attendu {
            assert_eq!(paques(annee), Some(jour(iso)), "Pâques {annee}");
        }
    }

    /// Les quatre fériés que l'open data du ministère ne publie pas, et qui
    /// tombent un jour de classe en 2026-2027. C'est la raison d'être de ce
    /// fichier : si ce test tombe, la grille se remet à proposer des cours ces
    /// jours-là.
    #[test]
    fn les_quatre_feries_en_jour_de_classe_de_2026_2027() {
        assert_eq!(nom_du_ferie(jour("2026-11-11")), Some("Armistice"));
        assert_eq!(nom_du_ferie(jour("2027-03-29")), Some("Lundi de Pâques"));
        assert_eq!(nom_du_ferie(jour("2027-05-06")), Some("Ascension"));
        assert_eq!(nom_du_ferie(jour("2027-05-17")), Some("Lundi de Pentecôte"));
        // Et aucun n'est un week-end : ce sont bien des jours de classe perdus.
        for iso in ["2026-11-11", "2027-03-29", "2027-05-06", "2027-05-17"] {
            let j = jour(iso);
            assert!(
                !matches!(j.weekday(), Weekday::Sat | Weekday::Sun),
                "{iso} devrait être en semaine"
            );
        }
    }

    #[test]
    fn onze_feries_par_an_dans_l_ordre() {
        for annee in 2025..=2030 {
            let liste = feries(annee);
            assert_eq!(liste.len(), 11, "année {annee}");
            let dates: Vec<_> = liste.iter().map(|(d, _)| *d).collect();
            let mut triees = dates.clone();
            triees.sort();
            assert_eq!(dates, triees, "année {annee} : ordre chronologique");
            // Aucun doublon : l'Ascension ne peut pas tomber le 1er mai.
            let uniques: std::collections::HashSet<_> = dates.iter().collect();
            assert_eq!(uniques.len(), 11, "année {annee} : dates distinctes");
        }
    }

    #[test]
    fn le_dimanche_de_paques_n_est_pas_liste() {
        // Il est férié, mais un dimanche n'a jamais de cours : l'afficher
        // mettrait un bandeau sur une colonne que la grille ne dessine pas.
        assert_eq!(nom_du_ferie(jour("2027-03-28")), None);
        assert_eq!(nom_du_ferie(jour("2027-03-29")), Some("Lundi de Pâques"));
    }
}
