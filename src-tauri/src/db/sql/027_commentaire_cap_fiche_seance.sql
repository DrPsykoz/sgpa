-- ==========================================================================
-- SGPA — palier 027 : le commentaire d'une fiche d'évaluation, les CAP, et la
-- fiche d'une séance de progression
--
-- DEMANDE DE L'AUTEUR, le 2026-11-14 — trois de ses huit lignes touchent le
-- schéma :
--
--   « Ajouter une case commentaire du professeur pour les fiches evaluations. »
--   « Ajouter la fiche Seance a partir du fichier fiche_seance_prototype.pdf.
--     Dans la fiche seance retirer la colonne note professeur et le
--     commentaire. »
--   « Dans la progression, ajouter la selection de metier + CAP, possible de
--     ne rien selectionner. »
--
-- Le palier est PUREMENT ADDITIF (production depuis le 2026-11-08) : trois
-- tables neuves, quatre colonnes nullables ou à DEFAULT vide. Une base migrée
-- sans que l'enseignant ne touche à rien se comporte exactement comme la
-- veille, et aucun document imprimé ne change tant qu'un commentaire, un CAP
-- ou une fiche n'a pas été saisi.
--
-- VOCABULAIRE. Dans l'application, depuis ce jour, un « Cours » est ce que la
-- table `seances` a toujours porté (ce qui a eu lieu, avec son appel et son
-- cahier de texte), et une « Séance » est une unité de la progression — un
-- ensemble de cours. Les identifiants du code n'ont pas bougé : la ligne de
-- progression que l'écran appelle « Séance » est toujours une ligne de
-- `progression_activites`, et sa fiche est `progression_fiches_seance`.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Le commentaire du professeur, par élève et par évaluation.
--
--    Une table et non une colonne de `grades` : une ligne de `grades` EST une
--    note (mark NOT NULL, bornée), et le commentaire d'un élève n'est ni
--    attaché à une compétence ni forcément accompagné d'une note. Même raison
--    que `grade_waivers` au palier 022.
--
--    CASCADE des deux côtés : le commentaire appartient à l'élève et à
--    l'évaluation. Une ligne vide n'est jamais stockée — la commande la
--    supprime —, donc l'absence de ligne est « pas de commentaire ».
-- --------------------------------------------------------------------------

CREATE TABLE evaluation_comments (
    evaluation_id TEXT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
    student_id    TEXT NOT NULL REFERENCES students(id)    ON DELETE CASCADE,
    comment       TEXT NOT NULL,
    PRIMARY KEY (evaluation_id, student_id)
);

CREATE INDEX ix_evaluation_comments_student ON evaluation_comments(student_id);

-- --------------------------------------------------------------------------
-- 2. Les CAP du champ professionnel.
--
--    Le référentiel RA16 (palier 024) a retenu les MÉTIERS de la roue et
--    écarté les CAP : « un CAP est un diplôme, plusieurs métiers de la roue en
--    partagent un ». L'auteur demande de pouvoir choisir un métier ET un CAP
--    sur une séquence ; les deux listes sont donc distinctes.
--
--    Sous le champ professionnel, pas sous un domaine d'activité : la page
--    source des CAP ne les rattache pas aux trois domaines de la roue. Seul
--    Habitat en a, comme pour `careers`.
-- --------------------------------------------------------------------------

CREATE TABLE caps (
    id                    TEXT PRIMARY KEY,
    professional_field_id TEXT NOT NULL REFERENCES professional_fields(id) ON DELETE CASCADE,
    name                  TEXT NOT NULL,
    position              INTEGER NOT NULL DEFAULT 0,
    UNIQUE (professional_field_id, name)
);

CREATE INDEX ix_caps_field ON caps(professional_field_id, position);

INSERT INTO caps (id, professional_field_id, name, position)
SELECT 'seed-cap-hab-' || printf('%02d', v.pos + 1), pf.id, v.nom, v.pos
  FROM professional_fields AS pf
  JOIN (
        SELECT 0 AS pos, 'Constructeur d''ouvrages du bâtiment' AS nom
  UNION ALL SELECT 1,  'Constructeur en béton armé du bâtiment'
  UNION ALL SELECT 2,  'Constructeur en ouvrages d''art'
  UNION ALL SELECT 3,  'Constructeur de canalisations des travaux publics'
  UNION ALL SELECT 4,  'Constructeur de routes'
  UNION ALL SELECT 5,  'Maçon'
  UNION ALL SELECT 6,  'Constructeur bois'
  UNION ALL SELECT 7,  'Étancheur du bâtiment et des travaux publics'
  UNION ALL SELECT 8,  'Couvreur'
  UNION ALL SELECT 9,  'Installateur en froid et conditionnement d''air'
  UNION ALL SELECT 10, 'Installateur sanitaire'
  UNION ALL SELECT 11, 'Installateur thermique'
  UNION ALL SELECT 12, 'Serrurier - Métallier'
  UNION ALL SELECT 13, 'Menuisier aluminium verre'
  UNION ALL SELECT 14, 'Menuisier fabricant de menuiserie, de mobilier et d''agencement'
  UNION ALL SELECT 15, 'Menuisier installateur'
  UNION ALL SELECT 16, 'Préparation et réalisation d''ouvrages électriques'
  UNION ALL SELECT 17, 'Plâtrier - Plaquiste'
  UNION ALL SELECT 18, 'Carreleur mosaïste'
  UNION ALL SELECT 19, 'Solier - Moquettiste'
  UNION ALL SELECT 20, 'Peintre - Applicateur de revêtements'
  UNION ALL SELECT 21, 'Maintenance des bâtiments de collectivité'
  ) AS v
 WHERE pf.id = 'seed-pf-habitat';

-- Le métier et le CAP d'une séquence : deux couples (clé, libellé figé),
-- modèle exact de ceux de `contract_sheets` au palier 024. `SET NULL` vers le
-- référentiel, et le libellé reste : une progression déjà imprimée ne se vide
-- pas parce qu'un référentiel a été rangé. Les deux sont facultatifs — « ne
-- rien sélectionner » est l'état de départ et reste un état valable.
--
-- `progression_etapes.metier_cap` (palier 026, texte libre) n'est NI vidé NI
-- supprimé : même contrat qu'aux paliers 021 et 024.
ALTER TABLE progression_etapes
    ADD COLUMN career_id TEXT NULL REFERENCES careers(id) ON DELETE SET NULL;
ALTER TABLE progression_etapes
    ADD COLUMN career_label TEXT NOT NULL DEFAULT '';
ALTER TABLE progression_etapes
    ADD COLUMN cap_id TEXT NULL REFERENCES caps(id) ON DELETE SET NULL;
ALTER TABLE progression_etapes
    ADD COLUMN cap_label TEXT NOT NULL DEFAULT '';

CREATE INDEX ix_progression_etapes_career ON progression_etapes(career_id);
CREATE INDEX ix_progression_etapes_cap    ON progression_etapes(cap_id);

-- --------------------------------------------------------------------------
-- 3. La fiche d'une séance — « fiche_seance_prototype.pdf ».
--
--    Une fiche par séance, à part : 0 ou 1 ligne par ligne de progression, et
--    non onze colonnes de plus sur `progression_activites`. La ligne de
--    progression se lit sur la frise, dans la liste des séquences et dans le
--    PDF de la progression, et aucun de ces écrans n'a besoin de la fiche ; et
--    la troisième règle d'architecture demande que `save_fiche_seance` n'oblige
--    jamais un appelant d'`update_progression_activite` à faire transiter les
--    textes de la fiche.
--
--    Les listes (EPI, outillage, matériaux, étapes, critères) sont du texte,
--    UNE LIGNE PAR ÉLÉMENT. Une ligne d'étape qui commence par « - » est une
--    sous-puce de l'étape précédente. Pas de table par liste : aucun calcul ne
--    s'appuie sur ces éléments.
--
--    Ce que le prototype porte et que cette table ne porte PAS, volontairement
--    — demande de l'auteur : la colonne « Professeur » du tableau
--    d'auto-évaluation, et le cadre « Observations du professeur ». L'élève
--    coche Oui ou Non, et c'est tout.
--
--    CASCADE : la fiche n'existe que pour sa séance. Rien n'est migré — la
--    table naît vide.
-- --------------------------------------------------------------------------

CREATE TABLE progression_fiches_seance (
    activite_id       TEXT PRIMARY KEY REFERENCES progression_activites(id) ON DELETE CASCADE,
    domaine           TEXT NOT NULL DEFAULT '',
    duree             TEXT NOT NULL DEFAULT '',
    chantier          TEXT NOT NULL DEFAULT '',
    situation         TEXT NOT NULL DEFAULT '',
    epi               TEXT NOT NULL DEFAULT '',
    consigne_securite TEXT NOT NULL DEFAULT '',
    outillage         TEXT NOT NULL DEFAULT '',
    materiaux         TEXT NOT NULL DEFAULT '',
    etapes            TEXT NOT NULL DEFAULT '',
    criteres          TEXT NOT NULL DEFAULT ''
);
