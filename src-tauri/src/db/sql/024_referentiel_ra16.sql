-- ==========================================================================
-- SGPA — palier 024 : le référentiel RA16 du champ Habitat, et la fiche
--                     contrat qui y puise
--
-- DEMANDE DE L'AUTEUR, le 2026-11-12, en deux morceaux qui n'en font qu'un :
--
--   « Référentiel : ajouter RA16 avec les domaines d'activité, les activités
--     de référence et les métiers en lien avec ces domaines. »
--
--   « Dans la fiche contrat : sous-ensemble du champ devient "Domaine
--     d'activité" qui doit contenir une valeur provenant du référentiel ;
--     activité de référence à sélectionner à partir du référentiel en prenant
--     en compte le domaine d'activité ; choix du métier par rapport au
--     référentiel. »
--
-- C'est le même mouvement qu'au palier 021, qui a remplacé le texte libre des
-- compétences de progression par une sélection dans le référentiel : il
-- retapait à la main des phrases qui étaient déjà en base, à deux écrans de
-- là. Ici elles n'y étaient pas encore — ce palier les y met d'abord.
--
-- ==========================================================================
-- TROIS POINTS DE FORME, TRANCHÉS PAR L'AUTEUR LE MÊME JOUR
-- ==========================================================================
--
-- 1. UNE SEULE VALEUR PAR CHAMP, choisie dans un menu — pas une liste à
--    cocher. Une fiche contrat nomme UN domaine, UNE activité de référence,
--    UN métier. D'où trois couples (clé, libellé figé) sur `contract_sheets`
--    et non trois tables de rattachement.
--
-- 2. LES MÉTIERS SONT CEUX DE LA ROUE, pas les 22 CAP de la page 3.
--    « On n'affiche pas les CAP, uniquement les métiers disponibles dans la
--    roue. » La roue « Relations entre activités et métiers » de la page 2
--    est une image sans texte extractible ; elle a été lue au rendu, secteur
--    par secteur, et ses frontières relevées au zoom — c'est elle, et elle
--    seule, qui dit quel métier appartient à quel domaine. Elle en porte 21,
--    répartis 8 / 8 / 5. Les CAP, eux, sont des DIPLÔMES et n'entrent pas :
--    plusieurs métiers de la roue partagent un même CAP (« Plâtrier » et
--    « Plaquiste » sortent du CAP « Plâtrier - Plaquiste »), si bien qu'une
--    liste de CAP aurait été plus courte que la liste des métiers tout en
--    nommant moins précisément ce que l'élève a fait.
--
-- 3. HABITAT SEULEMENT. RA16 publie un document par champ professionnel et
--    l'auteur n'a fourni que celui-là — c'est le sien. Les quatre autres
--    champs semés au palier 009 restent SANS référentiel, et ce n'est pas un
--    oubli : « ne rien y semer » vaut ici comme pour `professional_fields`,
--    `progression_domaines` et `student_need_tags`. Un palier ultérieur
--    pourra en ajouter sans rien reprendre — les tables sont par champ.
--
--    CONSÉQUENCE QUI PÈSE SUR L'ÉCRAN, ET QUI EST LA RAISON POUR LAQUELLE LES
--    ANCIENNES COLONNES NE BOUGENT PAS : un enseignant de « Vente -
--    Distribution - Magasinage » n'a aucun domaine à choisir. Si le menu
--    remplaçait le champ de saisie, ses trois cases deviendraient
--    inutilisables — une régression d'écran, qui vaut une perte de données.
--    Le sélecteur ne paraît donc QUE si le champ professionnel a un
--    référentiel ; sinon la saisie libre reste, telle qu'elle est aujourd'hui.
--    Même règle que `SelecteurDeGroupe`, qui rend `null` quand la classe n'a
--    aucun groupe.
--
-- ==========================================================================
-- CE QUI N'EST NI VIDÉ NI SUPPRIMÉ
-- ==========================================================================
--
-- `professional_subset`, `reference_activities` et `target_careers` RESTENT,
-- avec leur contenu. Elles sont la saisie de l'enseignant ; le palier 021 a
-- pris exactement cette précaution pour `progression_etapes.competences` et
-- pour la même raison — l'écran montre ce texte en lecture seule sous le
-- sélecteur tant qu'il reste, le PDF l'imprime encore, et un seul bouton
-- l'efface quand l'enseignant juge que la sélection l'a remplacé. Aucune
-- migration ne devine : personne ne sait si « AMENAGEMENT AGENCEMENT
-- FINITION » tapé à la main désigne le domaine semé ici, et rapprocher les
-- deux par ressemblance de chaîne déciderait à sa place sur toutes les fiches
-- déjà remises.
--
-- ATTENTION AU NOM : la TABLE `reference_activities` créée ici et la COLONNE
-- `contract_sheets.reference_activities` conservée là-haut portent le même
-- mot. Ce n'est pas une collision pour SQLite, c'en est une pour l'œil : la
-- colonne est l'ancienne saisie libre, la table est le référentiel. Le couple
-- neuf est `reference_activity_id` / `reference_activity_label`, au singulier.
--
-- ==========================================================================
-- POURQUOI DES LIBELLÉS FIGÉS À CÔTÉ DES CLÉS
-- ==========================================================================
--
-- Exactement la raison écrite au palier 001 pour `professional_field_label`,
-- puis au palier 010 pour `socle_competency_label` : une fiche contrat est un
-- document remis à un élève. Le référentiel, lui, se range, se renomme et se
-- vide. `ON DELETE SET NULL` lâche le lien et garde le libellé — la fiche
-- continue de dire ce qu'elle disait. Un `RESTRICT` aurait interdit de
-- toucher au référentiel tant qu'une fiche de 2026 y pointe encore.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Les trois tables du référentiel professionnel.
--
--    Chacune pend du cran au-dessus en CASCADE, sur le modèle de
--    `savoir_groups` (palier 009), qui est déjà une table fille de
--    `professional_fields`. Supprimer un champ professionnel emporte donc son
--    référentiel entier : il ne resterait rien à quoi le rattacher.
-- --------------------------------------------------------------------------

CREATE TABLE activity_domains (
    id                    TEXT PRIMARY KEY,
    professional_field_id TEXT NOT NULL REFERENCES professional_fields(id) ON DELETE CASCADE,
    name                  TEXT NOT NULL,
    position              INTEGER NOT NULL DEFAULT 0,
    UNIQUE (professional_field_id, name)
);

CREATE INDEX ix_activity_domains_field
    ON activity_domains(professional_field_id, position);

CREATE TABLE reference_activities (
    id                 TEXT PRIMARY KEY,
    activity_domain_id TEXT NOT NULL REFERENCES activity_domains(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    position           INTEGER NOT NULL DEFAULT 0,
    UNIQUE (activity_domain_id, name)
);

CREATE INDEX ix_reference_activities_domain
    ON reference_activities(activity_domain_id, position);

CREATE TABLE careers (
    id                 TEXT PRIMARY KEY,
    activity_domain_id TEXT NOT NULL REFERENCES activity_domains(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    position           INTEGER NOT NULL DEFAULT 0,
    UNIQUE (activity_domain_id, name)
);

CREATE INDEX ix_careers_domain
    ON careers(activity_domain_id, position);

-- --------------------------------------------------------------------------
-- 2. Les trois couples (clé, libellé figé) sur la fiche contrat.
--
--    Nullables et libellés vides par défaut : une fiche déjà saisie traverse
--    le palier sans changer d'un caractère, et l'écran la rend exactement
--    comme la veille.
-- --------------------------------------------------------------------------

ALTER TABLE contract_sheets
    ADD COLUMN activity_domain_id TEXT NULL REFERENCES activity_domains(id) ON DELETE SET NULL;
ALTER TABLE contract_sheets
    ADD COLUMN activity_domain_label TEXT NOT NULL DEFAULT '';

ALTER TABLE contract_sheets
    ADD COLUMN reference_activity_id TEXT NULL REFERENCES reference_activities(id) ON DELETE SET NULL;
ALTER TABLE contract_sheets
    ADD COLUMN reference_activity_label TEXT NOT NULL DEFAULT '';

ALTER TABLE contract_sheets
    ADD COLUMN career_id TEXT NULL REFERENCES careers(id) ON DELETE SET NULL;
ALTER TABLE contract_sheets
    ADD COLUMN career_label TEXT NOT NULL DEFAULT '';

-- Même raison que `ix_contract_rows_competency` au palier 010 : sans index,
-- chaque suppression dans le référentiel balaie toute la table des fiches
-- pour trouver les lignes à mettre à NULL.
CREATE INDEX ix_contract_sheets_activity_domain ON contract_sheets(activity_domain_id);
CREATE INDEX ix_contract_sheets_reference_activity ON contract_sheets(reference_activity_id);
CREATE INDEX ix_contract_sheets_career ON contract_sheets(career_id);

-- --------------------------------------------------------------------------
-- 3. Le semis : RA16, champ professionnel Habitat.
--
--    Source : « RA16_C4_SEGPA_Habitat_821360.pdf », ressource d'accompagnement
--    Éduscol du cycle 4 pour la SEGPA. Page 2 pour les trois domaines, leurs
--    34 activités de référence et la roue des métiers.
--
--    CHAQUE INSERT EST UN `INSERT ... SELECT` qui lit son parent, et jamais un
--    `INSERT ... VALUES` avec l'identifiant écrit en dur. Si `seed-pf-habitat`
--    a été supprimé ou renommé sur une base réelle — rien ne l'interdit, c'est
--    le vocabulaire de l'enseignant — le `SELECT` ne rend aucune ligne, le
--    semis ne fait rien, et le palier passe. Avec des `VALUES`, le même cas
--    aurait semé 58 lignes orphelines : les clés étrangères sont suspendues
--    pendant un palier (voir `migrations::run`), donc rien ne l'aurait arrêté.
-- --------------------------------------------------------------------------

INSERT INTO activity_domains (id, professional_field_id, name, position)
SELECT 'seed-ad-hab-construction', id, 'Construction', 0
  FROM professional_fields WHERE id = 'seed-pf-habitat';

INSERT INTO activity_domains (id, professional_field_id, name, position)
SELECT 'seed-ad-hab-amenagement', id, 'Aménagement, agencement, finition', 1
  FROM professional_fields WHERE id = 'seed-pf-habitat';

INSERT INTO activity_domains (id, professional_field_id, name, position)
SELECT 'seed-ad-hab-equipements', id, 'Équipements techniques', 2
  FROM professional_fields WHERE id = 'seed-pf-habitat';

-- --------------------------------------------------------------------------
-- 3a. Construction — 12 activités de référence.
--
--     Le document les introduit par « À partir d'une structure porteuse
--     existante : ». Cette amorce n'est pas recopiée dans chaque libellé : un
--     menu déroulant où douze lignes sur douze commencent par les mêmes sept
--     mots ne se lit plus. Elle appartient au domaine, pas à l'activité.
-- --------------------------------------------------------------------------

INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-c-01', id, 'Réaliser une paroi secondaire en briques creuses, béton cellulaire, blocs béton, etc.', 0
  FROM activity_domains WHERE id = 'seed-ad-hab-construction';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-c-02', id, 'Fabriquer et installer un élément préfabriqué', 1
  FROM activity_domains WHERE id = 'seed-ad-hab-construction';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-c-03', id, 'Réaliser un habillage décoratif en briques, pierres, etc.', 2
  FROM activity_domains WHERE id = 'seed-ad-hab-construction';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-c-04', id, 'Réaliser un enduit monocouche', 3
  FROM activity_domains WHERE id = 'seed-ad-hab-construction';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-c-05', id, 'Réaliser un pavage, un cheminement', 4
  FROM activity_domains WHERE id = 'seed-ad-hab-construction';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-c-06', id, 'Installer une structure ou ossature bois (murs, planchers, terrasse, etc.)', 5
  FROM activity_domains WHERE id = 'seed-ad-hab-construction';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-c-07', id, 'Réaliser un bardage extérieur bois (étanchéité, isolation, revêtement, etc.)', 6
  FROM activity_domains WHERE id = 'seed-ad-hab-construction';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-c-08', id, 'Installer une structure de façade en profilés et verre (façade rideau, véranda, etc.)', 7
  FROM activity_domains WHERE id = 'seed-ad-hab-construction';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-c-09', id, 'Adapter et installer des ouvrages annexes de charpente : abris, auvent, balcons, etc.', 8
  FROM activity_domains WHERE id = 'seed-ad-hab-construction';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-c-10', id, 'Poser des éléments de couverture par emboîtement, tuiles mécaniques, gouttières, etc.', 9
  FROM activity_domains WHERE id = 'seed-ad-hab-construction';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-c-11', id, 'Installer une menuiserie extérieure', 10
  FROM activity_domains WHERE id = 'seed-ad-hab-construction';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-c-12', id, 'Installer une fermeture, volets, portails, etc.', 11
  FROM activity_domains WHERE id = 'seed-ad-hab-construction';

-- --------------------------------------------------------------------------
-- 3b. Aménagement, agencement, finition — 15 activités de référence.
-- --------------------------------------------------------------------------

INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-a-01', id, 'Installer des équipements de protection (rampes, grilles de défense, serrures, etc.)', 0
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-a-02', id, 'Réaliser une cloison de doublage', 1
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-a-03', id, 'Réaliser des cloisons de distribution (plaques de plâtre, ossature bois, etc.)', 2
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-a-04', id, 'Installer une menuiserie intérieure', 3
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-a-05', id, 'Poser des produits d''isolation thermique et de correction acoustique', 4
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-a-06', id, 'Installer un faux plafond en plaques, dalles, etc.', 5
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-a-07', id, 'Réaliser un habillage mural décoratif', 6
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-a-08', id, 'Poser un parquet ou revêtement de sol', 7
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-a-09', id, 'Poser un revêtement en carrelage ou faïence, horizontal et/ou vertical', 8
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-a-10', id, 'Poser un revêtement de sol, moquette, etc.', 9
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-a-11', id, 'Réaliser des aménagements intérieurs (placards, rangements, habillages, etc.)', 10
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-a-12', id, 'Monter, ajuster et installer des mobiliers d''agencement', 11
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-a-13', id, 'Ajuster et fixer des éléments décoratifs ou de liaison', 12
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-a-14', id, 'Appliquer des revêtements muraux', 13
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-a-15', id, 'Appliquer des produits de finition et de protection', 14
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';

-- --------------------------------------------------------------------------
-- 3c. Équipements techniques — 7 activités de référence.
--
--     Le document marque les deux dernières d'un astérisque renvoyant à
--     « hors tension ». Un menu déroulant ne porte pas de note de bas de
--     page : la mention entre dans le libellé, où elle se lit au moment où
--     l'enseignant choisit, et s'imprime avec lui sur la fiche de l'élève.
-- --------------------------------------------------------------------------

INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-e-01', id, 'Installer un réseau fluidique intérieur (eau potable, eau usée, etc.)', 0
  FROM activity_domains WHERE id = 'seed-ad-hab-equipements';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-e-02', id, 'Poser et fixer un équipement sanitaire (évier, lave-main, baignoire, etc.)', 1
  FROM activity_domains WHERE id = 'seed-ad-hab-equipements';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-e-03', id, 'Équiper et raccorder un équipement sanitaire (robinetterie, évacuation, accessoires, etc.)', 2
  FROM activity_domains WHERE id = 'seed-ad-hab-equipements';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-e-04', id, 'Installer un réseau de canalisations extérieures (alimentation ou évacuation, etc.)', 3
  FROM activity_domains WHERE id = 'seed-ad-hab-equipements';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-e-05', id, 'Installer un réseau électrique intérieur (caché ou apparent, simple allumage ou va-et-vient, etc.)', 4
  FROM activity_domains WHERE id = 'seed-ad-hab-equipements';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-e-06', id, 'Poser et raccorder un appareillage électrique, hors tension (éclairage, alimentation, etc.)', 5
  FROM activity_domains WHERE id = 'seed-ad-hab-equipements';
INSERT INTO reference_activities (id, activity_domain_id, name, position)
SELECT 'seed-ra-hab-e-07', id, 'Installer un produit « domotique », hors tension (store ou volet télécommandé, éclairage automatique, etc.)', 6
  FROM activity_domains WHERE id = 'seed-ad-hab-equipements';

-- --------------------------------------------------------------------------
-- 3d. Les 21 métiers de la roue, rangés par domaine.
--
--     La roue les écrit dans le sens horaire. L'ordre ci-dessous est le sien,
--     secteur par secteur : il n'a pas d'autre sens que de retrouver le
--     document à côté de l'écran.
--
--     Les libellés sont ceux de la roue, et non ceux des CAP de la page 3.
--     « Couvreur Zingueur », « Métallier Serrurier », « Moquettiste Solier »
--     sont un seul métier chacun, écrits sur deux lignes dans l'image ;
--     « Plâtrier » et « Plaquiste », eux, sont deux libellés distincts posés
--     chacun sur son activité, bien qu'ils partagent un CAP.
-- --------------------------------------------------------------------------

INSERT INTO careers (id, activity_domain_id, name, position)
SELECT 'seed-me-hab-c-01', id, 'Constructeur en canalisations des travaux publics', 0
  FROM activity_domains WHERE id = 'seed-ad-hab-construction';
INSERT INTO careers (id, activity_domain_id, name, position)
SELECT 'seed-me-hab-c-02', id, 'Constructeur de routes', 1
  FROM activity_domains WHERE id = 'seed-ad-hab-construction';
INSERT INTO careers (id, activity_domain_id, name, position)
SELECT 'seed-me-hab-c-03', id, 'Constructeur en béton armé', 2
  FROM activity_domains WHERE id = 'seed-ad-hab-construction';
INSERT INTO careers (id, activity_domain_id, name, position)
SELECT 'seed-me-hab-c-04', id, 'Maçon', 3
  FROM activity_domains WHERE id = 'seed-ad-hab-construction';
INSERT INTO careers (id, activity_domain_id, name, position)
SELECT 'seed-me-hab-c-05', id, 'Constructeur bois', 4
  FROM activity_domains WHERE id = 'seed-ad-hab-construction';
INSERT INTO careers (id, activity_domain_id, name, position)
SELECT 'seed-me-hab-c-06', id, 'Charpentier', 5
  FROM activity_domains WHERE id = 'seed-ad-hab-construction';
INSERT INTO careers (id, activity_domain_id, name, position)
SELECT 'seed-me-hab-c-07', id, 'Couvreur zingueur', 6
  FROM activity_domains WHERE id = 'seed-ad-hab-construction';
INSERT INTO careers (id, activity_domain_id, name, position)
SELECT 'seed-me-hab-c-08', id, 'Métallier serrurier', 7
  FROM activity_domains WHERE id = 'seed-ad-hab-construction';

INSERT INTO careers (id, activity_domain_id, name, position)
SELECT 'seed-me-hab-a-01', id, 'Plâtrier', 0
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';
INSERT INTO careers (id, activity_domain_id, name, position)
SELECT 'seed-me-hab-a-02', id, 'Plaquiste', 1
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';
INSERT INTO careers (id, activity_domain_id, name, position)
SELECT 'seed-me-hab-a-03', id, 'Menuisier aluminium verre', 2
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';
INSERT INTO careers (id, activity_domain_id, name, position)
SELECT 'seed-me-hab-a-04', id, 'Menuisier fabricant', 3
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';
INSERT INTO careers (id, activity_domain_id, name, position)
SELECT 'seed-me-hab-a-05', id, 'Menuisier installateur', 4
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';
INSERT INTO careers (id, activity_domain_id, name, position)
SELECT 'seed-me-hab-a-06', id, 'Carreleur mosaïste', 5
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';
INSERT INTO careers (id, activity_domain_id, name, position)
SELECT 'seed-me-hab-a-07', id, 'Peintre applicateur de revêtement', 6
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';
INSERT INTO careers (id, activity_domain_id, name, position)
SELECT 'seed-me-hab-a-08', id, 'Moquettiste solier', 7
  FROM activity_domains WHERE id = 'seed-ad-hab-amenagement';

INSERT INTO careers (id, activity_domain_id, name, position)
SELECT 'seed-me-hab-e-01', id, 'Installateur en froid et climatisation', 0
  FROM activity_domains WHERE id = 'seed-ad-hab-equipements';
INSERT INTO careers (id, activity_domain_id, name, position)
SELECT 'seed-me-hab-e-02', id, 'Installateur sanitaire', 1
  FROM activity_domains WHERE id = 'seed-ad-hab-equipements';
INSERT INTO careers (id, activity_domain_id, name, position)
SELECT 'seed-me-hab-e-03', id, 'Installateur thermique', 2
  FROM activity_domains WHERE id = 'seed-ad-hab-equipements';
INSERT INTO careers (id, activity_domain_id, name, position)
SELECT 'seed-me-hab-e-04', id, 'Électricien', 3
  FROM activity_domains WHERE id = 'seed-ad-hab-equipements';
INSERT INTO careers (id, activity_domain_id, name, position)
SELECT 'seed-me-hab-e-05', id, 'Agent de maintenance des bâtiments', 4
  FROM activity_domains WHERE id = 'seed-ad-hab-equipements';
