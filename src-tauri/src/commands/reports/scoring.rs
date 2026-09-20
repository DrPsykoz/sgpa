// RÈGLE PROVISOIRE — en attente de la règle officielle de l'établissement.
//
// La règle vit dans `app_settings.overall_average_rule`, pas dans le schéma :
// en changer coûte l'UPDATE d'une ligne, jamais une migration. Tant que
// l'établissement n'a pas tranché, tout ce qui suit est réversible.

use super::CompetencyAverage;

/// Moyenne générale d'un élève, calculée à partir de ses moyennes par compétence.
///
/// Renvoie `None` quand l'élève n'a aucune note. `0.0` s'imprimerait
/// « Moyenne générale : 0.0/5 » sur un document remis à une famille, ce qui se lit
/// comme une maîtrise nulle et non comme une absence d'évaluation.
pub fn overall_average(averages: &[CompetencyAverage], rule: &str) -> Option<f64> {
    if averages.is_empty() {
        return None;
    }
    match rule {
        "weighted_by_count" => Some(weighted_by_count(averages)),
        // 'unweighted_mean' est la règle historique, et le repli de toute valeur
        // inattendue : un bilan doit sortir même si le réglage est illisible.
        _ => Some(unweighted_mean(averages)),
    }
}

/// Moyenne non pondérée : chaque compétence pèse autant, quel que soit le nombre
/// de notes qui la fondent.
fn unweighted_mean(averages: &[CompetencyAverage]) -> f64 {
    averages.iter().map(|a| a.average_level).sum::<f64>() / averages.len() as f64
}

/// Moyenne pondérée par le nombre de notes : une compétence évaluée cinq fois
/// pèse cinq fois plus qu'une compétence vue une seule fois.
fn weighted_by_count(averages: &[CompetencyAverage]) -> f64 {
    let total: i64 = averages.iter().map(|a| a.grade_count.max(0) as i64).sum();
    if total == 0 {
        // Une moyenne par compétence ne remonte que si elle repose sur au moins
        // une note ; si le compte est malgré tout nul, la pondération n'a plus de
        // sens et on rend la moyenne simple plutôt qu'une division par zéro.
        return unweighted_mean(averages);
    }
    let weighted: f64 = averages
        .iter()
        .map(|a| a.average_level * a.grade_count.max(0) as f64)
        .sum();
    weighted / total as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn avg(level: f64, count: i32) -> CompetencyAverage {
        CompetencyAverage {
            competency_id: "c1".to_string(),
            competency_name: "Compétence".to_string(),
            field_name: "Champ".to_string(),
            domain_name: "Domaine".to_string(),
            average_level: level,
            grade_count: count,
        }
    }

    #[test]
    fn aucune_note_ne_donne_jamais_zero() {
        assert_eq!(overall_average(&[], "unweighted_mean"), None);
        assert_eq!(overall_average(&[], "weighted_by_count"), None);
    }

    #[test]
    fn une_seule_competence() {
        let une = [avg(3.5, 2)];
        assert_eq!(overall_average(&une, "unweighted_mean"), Some(3.5));
        assert_eq!(overall_average(&une, "weighted_by_count"), Some(3.5));
    }

    #[test]
    fn ponderee_differe_de_non_ponderee() {
        // 4.0 sur une seule note, 2.0 sur trois notes.
        let data = [avg(4.0, 1), avg(2.0, 3)];
        // (4.0 + 2.0) / 2
        assert_eq!(overall_average(&data, "unweighted_mean"), Some(3.0));
        // (4.0 * 1 + 2.0 * 3) / 4
        assert_eq!(overall_average(&data, "weighted_by_count"), Some(2.5));
    }

    #[test]
    fn regle_inconnue_retombe_sur_la_moyenne_simple() {
        let data = [avg(4.0, 1), avg(2.0, 3)];
        assert_eq!(overall_average(&data, "regle_du_futur"), Some(3.0));
    }

    #[test]
    fn compte_de_notes_nul_ne_divise_pas_par_zero() {
        let data = [avg(4.0, 0), avg(2.0, 0)];
        assert_eq!(overall_average(&data, "weighted_by_count"), Some(3.0));
    }
}
