-- ============================================================================
-- SGPA — palier 015 : les deux règles de calcul, arrêtées
--
-- RÈGLE D'OR : un palier livré n'est JAMAIS modifié. Toute évolution ultérieure
-- passe par un nouveau fichier 0NN_*.sql et une entrée dans migrations::STEPS.
-- ============================================================================

-- Le palier 001 a livré ces deux colonnes avec la mention « EN ATTENTE » : la
-- règle n'était pas tranchée, et leurs valeurs par défaut étaient des
-- emplacements tenus, pas des choix. L'enseignant a tranché le 2026-11-06 :
--
--   * moyenne générale      → 'unweighted_mean', ce qui est DÉJÀ la valeur
--     livrée : chaque compétence pèse pareil, qu'elle porte une note ou huit.
--     Rien à écrire, donc, et c'est volontaire — un UPDATE qui « confirme » une
--     valeur inchangée ferait croire à un changement de règle à qui relirait ce
--     palier, et bousculerait `updated_at` sans raison.
--
--   * compétences retirées  → 'ignore' : les notes d'une compétence retirée
--     d'une évaluation sortent des moyennes. C'est le seul changement ici.
--
-- Ce palier ne touche donc pas au schéma : il corrige une valeur qui n'avait
-- jamais été choisie. Et RIEN N'EST SUPPRIMÉ — 'ignore' écarte les notes du
-- calcul, pas de la base : elles restent dans `grades`, et remettre la
-- compétence dans l'évaluation les y fait revenir
-- (`reports::AVERAGES_IGNORE_REMOVED`, ajouté à la requête et non au stockage).
--
-- Le WHERE ne rattrape que la valeur livrée. L'écran Réglages étant désormais
-- modifiable, une base peut déjà porter un choix de l'enseignant : ce palier ne
-- doit pas l'écraser. Et il ne se rejoue jamais, `user_version` passant à 15.
UPDATE app_settings
   SET removed_competency_policy = 'ignore',
       updated_at                = datetime('now')
 WHERE id = 1
   AND removed_competency_policy = 'keep';
