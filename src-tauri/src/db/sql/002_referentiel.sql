-- ============================================================================
-- SGPA — palier 002 : référentiel de départ
--
-- Exécuté UNE SEULE FOIS, à la création de la base. Volontairement PAS de
-- `ON CONFLICT` et PAS de rejeu au démarrage : un enseignant qui supprime un
-- cycle ne doit pas le voir réapparaître au lancement suivant.
--
-- PÉRIMÈTRE DU SEMIS — ce qui est ici est vérifiable, le reste ne l'est pas.
--
--   SEMÉ : les 5 domaines du socle commun de connaissances, de compétences et
--   de culture, et les 4 composantes du domaine 1. Source : décret n° 2015-372
--   du 31 mars 2015.
--
--   NON SEMÉ : les sous-intitulés des domaines 2 à 5. Dans le texte officiel,
--   seul le domaine 1 est décomposé en composantes nommées ; fabriquer des
--   libellés pour les autres leur donnerait une apparence réglementaire qu'ils
--   n'ont pas — et ces libellés finiraient recopiés tels quels dans un bilan
--   remis à une famille.
--
--   NON SEMÉ : les champs professionnels SEGPA, en attente de la liste de
--   l'enseignant (deux listes circulent, à 4 ou 5 entrées, et la référence
--   réglementaire n'est pas vérifiée). La table professional_fields reste vide.
--
--   NON SEMÉ : aucune compétence. Les feuilles de l'arbre se remplissent par
--   collage multi-lignes depuis un tableur, ce qui rend la saisie indolore.
-- ============================================================================

INSERT INTO cycles (id, name, position) VALUES
    ('seed-cycle-4', 'Cycle 4', 0);

INSERT INTO domains (id, cycle_id, name, position) VALUES
    ('seed-d1', 'seed-cycle-4', 'Les langages pour penser et communiquer',            0),
    ('seed-d2', 'seed-cycle-4', 'Les méthodes et outils pour apprendre',              1),
    ('seed-d3', 'seed-cycle-4', 'La formation de la personne et du citoyen',          2),
    ('seed-d4', 'seed-cycle-4', 'Les systèmes naturels et les systèmes techniques',   3),
    ('seed-d5', 'seed-cycle-4', 'Les représentations du monde et l''activité humaine', 4);

-- Les quatre composantes du domaine 1, seules subdivisions nommées par le texte.
INSERT INTO fields (id, domain_id, name, position) VALUES
    ('seed-d1-f1', 'seed-d1', 'Comprendre, s''exprimer en utilisant la langue française à l''oral et à l''écrit', 0),
    ('seed-d1-f2', 'seed-d1', 'Comprendre, s''exprimer en utilisant une langue étrangère et, le cas échéant, une langue régionale', 1),
    ('seed-d1-f3', 'seed-d1', 'Comprendre, s''exprimer en utilisant les langages mathématiques, scientifiques et informatiques', 2),
    ('seed-d1-f4', 'seed-d1', 'Comprendre, s''exprimer en utilisant les langages des arts et du corps', 3);
