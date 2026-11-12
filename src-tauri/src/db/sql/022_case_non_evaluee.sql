-- ==========================================================================
-- SGPA — palier 022 : « cet élève ne sera pas évalué sur cette compétence »
--
-- DEMANDE DE L'AUTEUR, le 2026-11-12 : « Non évalué = l'élève ne sera pas
-- évalué, différencier une évaluation en attente d'une qui ne sera jamais
-- faite. » Il a précisé la portée le même jour, entre trois possibles : c'est
-- UNE CASE DE LA GRILLE — un élève × une compétence —, ni l'évaluation
-- entière, ni l'élève entier.
--
-- CE QUI MANQUAIT. Depuis le palier 018, « non évalué » est l'ABSENCE DE LIGNE
-- dans `grades`. Cette absence dit deux choses que rien ne distinguait : « je
-- n'ai pas encore noté » et « je ne noterai jamais ». L'accueil réclamait donc
-- éternellement une évaluation volontairement incomplète, et la feuille remise
-- à l'élève laissait une ligne vide qui se lisait comme un oubli.
--
-- UNE TABLE, ET NON UNE VALEUR CONVENTIONNELLE DANS `grades`. Une ligne de
-- `grades` EST une note : `mark` y est `NOT NULL` et contrôlée entre 1 et 20,
-- et c'est ce qui fait que `AVG(g.mark)` n'a jamais à se demander ce qu'il
-- compte. Loger « pas de note » dedans redemanderait partout la question que
-- le palier 018 a fermée — un `mark = 0`, un `mark IS NULL`, un drapeau à
-- côté —, et la première moyenne qui oublierait de l'écarter ferait chuter un
-- bulletin déjà imprimé. La déclaration vit donc à part, et toutes les
-- requêtes de moyenne (`reports::AVERAGES_*`) restent mot pour mot celles
-- d'hier : une case déclarée n'a pas de note, donc elle sort du calcul sans
-- qu'une ligne de SQL ait à la nommer. C'est exactement ce que l'auteur a
-- choisi — « la case sort de sa moyenne ».
--
-- MIROIR DE `grades`, À LA COLONNE DE NOTE PRÈS : même clé primaire, mêmes
-- cascades, même RESTRICT, mêmes deux index. Deux tables qui décrivent la même
-- case doivent se lire avec les mêmes hypothèses.
--
-- L'EXCLUSION MUTUELLE N'EST PAS DANS LE SCHÉMA, et elle ne peut pas y être :
-- SQLite ne sait pas poser un CHECK qui regarde une autre table, et ce projet
-- n'emploie pas de déclencheur. Elle est tenue par les deux commandes, chacune
-- dans son sens — `set_grade` efface la déclaration dans sa transaction (poser
-- une note, c'est évaluer), `set_grade_waiver` refuse en français tant qu'une
-- note est là (effacez-la d'abord). Troisième filet, côté lecture : le compte
-- de complétude de l'accueil parcourt les CASES et non les lignes, si bien
-- qu'une case comptée deux fois resterait une case — « complète à 112 % » est
-- structurellement impossible, et pas seulement improbable.
--
-- RESTRICT SUR LA COMPÉTENCE, comme `grades` et comme
-- `progression_etape_competences`. La feuille d'évaluation IMPRIME la
-- déclaration — « non évalué » en travers des colonnes de maîtrise —, donc
-- supprimer la compétence du référentiel retirerait une ligne d'un document
-- déjà remis sans que rien ne le dise. `delete_node` compte ces cases AVANT de
-- supprimer et les annonce, comme il annonce déjà les notes et les étapes.
--
-- CASCADE SUR L'ÉVALUATION ET SUR L'ÉLÈVE, comme `grades` : la case cesse
-- d'exister avec l'un ou l'autre. `get_student_deletion_impact` ne compte pas
-- ces lignes et c'est délibéré — elles ne contiennent rien, et allonger la
-- confirmation de suppression d'un élève avec un chiffre qui ne pèse rien
-- noierait les quatre qui pèsent.
--
-- RIEN À MIGRER, ET C'EST LE POINT QUI COMPTE EN PRODUCTION. La table naît
-- vide : toute case aujourd'hui vierge reste « en attente », c'est-à-dire
-- exactement ce qu'elle était la veille. Aucune note ne bouge, aucune moyenne
-- ne change, aucun compte d'accueil ne change tant que l'enseignant n'a rien
-- déclaré. Deviner les cases « jamais évaluées » à partir des cases vides
-- aurait été l'inverse : décider à sa place sur toutes ses évaluations
-- passées.
--
-- CE QUE LE PALIER NE FAIT PAS. Retirer une compétence d'une évaluation ne
-- touche pas aux déclarations qui la visaient, exactement comme cela ne touche
-- pas aux notes tant que l'enseignant n'a pas confirmé : la case n'existe plus,
-- donc plus rien ne la lit (le compte de l'accueil exige la compétence encore
-- rattachée), et si la compétence revient dans la grille, la déclaration revient
-- avec elle. C'est la même promesse que le palier 015 fait aux notes.
-- ==========================================================================

CREATE TABLE grade_waivers (
    evaluation_id TEXT NOT NULL REFERENCES evaluations(id)  ON DELETE CASCADE,
    competency_id TEXT NOT NULL REFERENCES competencies(id) ON DELETE RESTRICT,
    student_id    TEXT NOT NULL REFERENCES students(id)     ON DELETE CASCADE,
    -- Quand la déclaration a été posée. Jamais affiché à ce jour : il est là
    -- pour la même raison que `grades.updated_at` — un jour où une case
    -- déclarée surprendra quelqu'un, c'est la seule chose qui pourra dire
    -- quand elle l'a été.
    waived_at     TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (evaluation_id, competency_id, student_id)
);

-- Les deux index de `grades`, reposés à l'identique. Le premier est celui dont
-- dépend le ON DELETE RESTRICT de `competency_id` : sans lui, SQLite balaierait
-- toute la table pour savoir si une compétence y est citée.
CREATE INDEX ix_grade_waivers_competency ON grade_waivers(competency_id);
CREATE INDEX ix_grade_waivers_student    ON grade_waivers(student_id, competency_id);
