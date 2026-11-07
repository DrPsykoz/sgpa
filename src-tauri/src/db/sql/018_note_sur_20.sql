-- ==========================================================================
-- SGPA — palier 018 : la note sur 20 devient la donnée, le libellé sa lecture
--
-- Jusqu'ici l'enseignant cliquait un niveau de maîtrise, et la note sur 20 en
-- était déduite (`MASTERY_POINTS`, niveau × 4). La chaîne s'inverse : il saisit
-- une note ENTIÈRE de 1 à 20, et « Maîtrise fragile », « Très bonne maîtrise »
-- ne sont plus que des lectures de cette note.
--
-- LES TRANCHES, choisies par l'auteur le 2026-11-07 :
--
--       1 · 2 · 3 · 4   Maîtrise insuffisante
--       5 · 6 · 7 · 8   Maîtrise fragile
--    9 · 10 · 11 · 12   Presque maîtrisé
--   13 · 14 · 15 · 16   Maîtrise satisfaisante
--   17 · 18 · 19 · 20   Très bonne maîtrise
--
-- Quatre points par tranche, donc `plafond(note / 4)`. Cette règle n'est PAS
-- dans le schéma : ni CHECK, ni colonne calculée, ni table de correspondance.
-- Un libellé stocké figerait le découpage du jour où il a été écrit, alors que
-- déplacer une borne doit redessiner les bilans déjà établis — c'est la même
-- raison qui garde les moyennes hors du stockage (palier 015). La règle est
-- écrite une seule fois, dans `src/types/index.ts`.
--
-- POURQUOI `note = niveau × 4` NE PERD RIEN.
--
-- Le barème sortant plaçait les cinq niveaux à 4, 8, 12, 16 et 20 points. Ces
-- cinq valeurs sont exactement les BORNES HAUTES des cinq tranches ci-dessus.
-- Chaque note déjà saisie garde donc son libellé mot pour mot : la conversion
-- n'arbitre rien, elle écrit en chiffres ce que la base disait en mots. C'est
-- la seule raison pour laquelle ce palier n'a pas à faire relire sa grille à
-- l'enseignant.
--
-- IL N'Y A PAS DE NOTE DE 0.
--
-- Décision de l'auteur, le même jour : la note la plus basse est 1. « Non
-- évalué » n'est pas une note, c'est l'ABSENCE DE LIGNE dans `grades` — la même
-- règle que l'appel non fait, qui ne vaut pas « présent ». Les lignes
-- `level = 0` du schéma sortant disaient précisément « pas de note » : elles
-- sont supprimées, et c'est la seule perte du palier. Rien ne les lisait,
-- `AVG(g.level)` comme le compte de l'accueil les écartant déjà par
-- `g.level > 0`.
--
-- POURQUOI UNE TABLE NEUVE, ET NON `RENAME COLUMN`.
--
-- La colonne porte un CHECK, et SQLite ne sait pas remplacer la contrainte
-- d'une colonne existante. `BETWEEN 0 AND 5` resterait donc accroché à une
-- colonne renommée `mark` et contenant des notes sur 20 : toute note au-dessus
-- de 5 serait refusée à l'écriture, et l'échec tomberait à la première saisie
-- de l'enseignant plutôt qu'ici. On reconstruit.
-- ==========================================================================

CREATE TABLE grades_sur_20 (
    evaluation_id TEXT NOT NULL REFERENCES evaluations(id)  ON DELETE CASCADE,
    competency_id TEXT NOT NULL REFERENCES competencies(id) ON DELETE RESTRICT,
    student_id    TEXT NOT NULL REFERENCES students(id)     ON DELETE CASCADE,
    mark          INTEGER NOT NULL CHECK (mark BETWEEN 1 AND 20),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (evaluation_id, competency_id, student_id)
);

-- `updated_at` est recopié tel quel : la conversion n'est pas une correction de
-- l'enseignant, et remettre `datetime('now')` ferait croire que toute la classe
-- a été renotée le jour de la mise à jour.
INSERT INTO grades_sur_20 (evaluation_id, competency_id, student_id, mark, updated_at)
SELECT evaluation_id, competency_id, student_id, level * 4, updated_at
  FROM grades
 WHERE level BETWEEN 1 AND 5;

DROP TABLE grades;

ALTER TABLE grades_sur_20 RENAME TO grades;

-- Les deux index du palier 001, reposés à l'identique : un index tombe avec la
-- table qu'il indexe, et `ix_grades_competency` est celui dont dépend le
-- ON DELETE RESTRICT de `competency_id` — sans lui, SQLite balaierait toute la
-- table des notes pour savoir si une compétence y est citée.
CREATE INDEX ix_grades_student    ON grades(student_id, competency_id);
CREATE INDEX ix_grades_competency ON grades(competency_id);
