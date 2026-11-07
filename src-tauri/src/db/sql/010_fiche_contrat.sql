-- ==========================================================================
-- SGPA — palier 010 : la fiche contrat prend la forme de ses trois tableaux
--
-- Le schéma de 001 a été écrit d'après les EN-TÊTES de « fiche contrat
-- sequence.xls », avant que son contenu ait pu être lu (BIFF8, aucun tableur
-- sur le poste). La lecture des fusions de cellules, faite le 2026-11-04,
-- montre trois écarts. Chacun coûte une information que l'enseignant a saisie.
--
-- 1. « domaine du socle » N'EST PAS UN DOMAINE DU SOCLE. Sous cet en-tête, sa
--    fiche porte « AMENAGEMENT AGENCEMENT FINITION » : une subdivision du champ
--    professionnel Habitat, pas un domaine du décret. L'en-tête de sa feuille
--    est fautif et `socle_domain` en a hérité le nom. La colonne devient
--    `professional_subset`, et l'écran l'étiquette « sous-ensemble du champ
--    professionnel ». Les vrais domaines du socle sont dans les lignes, où ils
--    ont toujours été.
--
-- 2. ON DONNE / ON DEMANDE / ON EXIGE EST UN TABLEAU, PAS TROIS PARAGRAPHES.
--    Sa fiche aligne trois colonnes sur trois lignes : « les plans » /
--    « identifier et interpréter un document » / « les éléments sont
--    correctement repérer », puis deux autres lignes de la même façon. Trois
--    colonnes TEXT uniques sur `contract_sheets` perdent l'alignement, qui est
--    précisément l'information : à chaque chose donnée répond ce qu'on en
--    demande et ce qu'on en exige. D'où `contract_sheet_requirements`.
--
-- 3. UNE ENTRÉE DU SOCLE COUVRE PLUSIEURS ACTIVITÉS. Sa fiche a huit lignes
--    d'activité pour quatre compétences : la cellule « organiser seul ou en
--    groupe un espace de réalisation expérimentale » est fusionnée sur neuf
--    rangs, en face de trois activités (identifier les EPI, préparer les
--    outils, préparer son poste de travail). Avec un libellé libre par ligne,
--    reproduire cela demande de recopier la compétence trois fois — et une
--    compétence présente trois fois dans une grille de notation pèse trois fois
--    dans la note /20. C'est exactement le défaut que le palier 009 a retiré du
--    référentiel ; il n'a pas à rentrer par les fiches. D'où `competency_id` :
--    les lignes consécutives qui pointent la MÊME compétence s'affichent et
--    s'impriment sous une seule cellule fusionnée.
--
-- Le libellé reste stocké à côté de la clé (`socle_domain_label`,
-- `socle_competency_label`), comme `professional_field_label` l'est déjà à côté
-- de `professional_field_id`, et pour la même raison : une compétence renommée
-- ou retirée du référentiel ne doit pas vider une fiche déjà remise à un élève.
--
-- `required_text` arrive aussi SUR LA LIGNE. La fiche d'évaluation du même
-- projet (« evaluation sequence 1.xls ») a pour colonnes ON DEMANDE | ON EXIGE
-- | DOMAINES | COMPETENCES : son « ON DEMANDE » est mot pour mot l'« activité
-- de l'élève » de la fiche contrat. Les deux documents sont deux rendus du même
-- tableau, à un critère près — celui-ci. Le poser ici, c'est permettre de
-- saisir une fois et d'imprimer les deux.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. L'en-tête : renommage, et sortie des trois textes.
-- --------------------------------------------------------------------------

ALTER TABLE contract_sheets RENAME COLUMN socle_domain TO professional_subset;

CREATE TABLE contract_sheet_requirements (
    id                TEXT PRIMARY KEY,
    contract_sheet_id TEXT NOT NULL REFERENCES contract_sheets(id) ON DELETE CASCADE,
    position          INTEGER NOT NULL DEFAULT 0,
    given_text        TEXT NOT NULL DEFAULT '',   -- ON DONNE
    asked_text        TEXT NOT NULL DEFAULT '',   -- ON DEMANDE
    required_text     TEXT NOT NULL DEFAULT ''    -- ON EXIGE
);

CREATE INDEX ix_contract_requirements_sheet
    ON contract_sheet_requirements(contract_sheet_id, position);

-- Ce qui a été saisi dans les trois anciennes colonnes devient la première
-- ligne du tableau. L'alignement est inconnu pour ces fiches-là — il n'était
-- pas stockable — mais le texte, lui, est à l'enseignant : on ne le jette pas.
-- `hex(randomblob(16))` tient lieu d'uuid : ce palier n'a pas de code Rust.
INSERT INTO contract_sheet_requirements
    (id, contract_sheet_id, position, given_text, asked_text, required_text)
SELECT lower(hex(randomblob(16))), id, 0, given_text, asked_text, required_text
  FROM contract_sheets
 WHERE TRIM(given_text) <> '' OR TRIM(asked_text) <> '' OR TRIM(required_text) <> '';

ALTER TABLE contract_sheets DROP COLUMN given_text;
ALTER TABLE contract_sheets DROP COLUMN asked_text;
ALTER TABLE contract_sheets DROP COLUMN required_text;

-- --------------------------------------------------------------------------
-- 2. Les lignes d'activité : la compétence devient une référence.
-- --------------------------------------------------------------------------

-- ON DELETE SET NULL, et non RESTRICT comme sur `grades` : une note sans
-- compétence n'a pas de sens et doit bloquer la suppression, tandis qu'une
-- ligne de fiche garde tout son sens avec son seul libellé figé. Un défaut de
-- référentiel ne doit pas empêcher l'enseignant de ranger son référentiel.
ALTER TABLE contract_sheet_rows
    ADD COLUMN competency_id TEXT NULL REFERENCES competencies(id) ON DELETE SET NULL;

-- Même raison que l'index du RESTRICT ailleurs : sans lui, chaque suppression
-- de compétence balaie toute la table des lignes de fiches.
CREATE INDEX ix_contract_rows_competency ON contract_sheet_rows(competency_id);

ALTER TABLE contract_sheet_rows ADD COLUMN required_text TEXT NOT NULL DEFAULT '';
