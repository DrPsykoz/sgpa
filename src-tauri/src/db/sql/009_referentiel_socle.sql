-- ==========================================================================
-- SGPA — palier 009 : référentiel du socle, champs professionnels, savoirs
--
-- Exécuté UNE SEULE FOIS, comme 002 : pas de `ON CONFLICT`, pas de rejeu au
-- démarrage. Un enseignant qui supprime une compétence ne doit pas la voir
-- réapparaître au lancement suivant.
--
-- CE PALIER CORRIGE UNE ERREUR DE FAIT DANS L'EN-TÊTE DE 002, qui affirme que
-- « seul le domaine 1 est décomposé en composantes nommées » et refuse de semer
-- les autres pour ne pas leur donner « une apparence réglementaire qu'ils n'ont
-- pas ». C'est faux : l'annexe du socle (décret n° 2015-372, publiée au BO n° 17
-- du 23 avril 2015) donne pour CHACUN des cinq domaines une liste d'« objectifs
-- de connaissances et de compétences », vérifiée mot pour mot avant ce palier :
--   D2 : Organisation du travail personnel · Coopération et réalisation de
--        projets · Médias, démarches de recherche et de traitement de
--        l'information · Outils numériques pour échanger et communiquer
--   D3 : Expression de la sensibilité et des opinions, respect des autres ·
--        La règle et le droit · Réflexion et discernement · Responsabilité,
--        sens de l'engagement et de l'initiative
--   D4 : Démarches scientifiques · Conception, création, réalisation ·
--        Responsabilités individuelles et collectives
--   D5 : L'espace et le temps · Organisations et représentations du monde ·
--        Invention, élaboration, production
-- La prudence de 002 était bonne, son fait était faux. Ne pas rouvrir le débat.
--
-- DEUX RÉFÉRENTIELS COHABITENT AU NIVEAU DU CHAMP, ET C'EST VOULU. Les champs
-- des domaines 1 et 3 portent les libellés de l'annexe ci-dessus. Ceux des
-- domaines 2, 4 et 5 portent les « compétences travaillées » du programme de
-- Sciences et Technologie (« S'approprier des outils et des méthodes »,
-- « Pratiquer des démarches scientifiques et technologiques », « Concevoir,
-- créer, réaliser », « Se situer dans l'espace et dans le temps », « Adopter un
-- comportement éthique et responsable »), parce que ce sont les libellés que
-- l'enseignant utilise dans son propre tableau de suivi. Ce n'est PAS une
-- incohérence à nettoyer : c'est son outil de travail, et l'application permet
-- de renommer un champ.
--
-- LE RANGEMENT DU CLASSEUR FAIT FOI, pas le programme officiel. Règle donnée
-- par l'enseignant le 2026-11-04 : une compétence appartient au domaine qui est
-- à sa gauche dans sa feuille. Le cas qui a tranché la règle : « Organiser seul
-- ou en groupe un espace de réalisation expérimentale » (ligne 31), que le
-- programme de Sciences et Technologie classe sous « S'approprier des outils et
-- des méthodes » (domaine 2) et que sa feuille range sous le domaine 3. Elle est
-- semée en domaine 3. L'application permet de la déplacer ; le semis n'a pas à
-- lui enseigner le socle.
--
-- SOURCE DES COMPÉTENCES : documents/tableau_competences_ savoir champ_habitat.xlsx,
-- feuilles « competence Cycle 3 » et « competence Cycle 4 », 58 lignes. 53 sont
-- semées ici, 5 ont été écartées comme doublons — dont « Choisir ou utiliser le
-- matériel adapté… », présente QUATRE fois dans la feuille Cycle 3. Semée telle
-- quelle, cette seule compétence aurait pesé quatre fois dans la moyenne /20
-- d'un élève sans que rien ne le signale. Le détail ligne par ligne du nettoyage
-- a été validé par l'enseignant avant écriture.
--
-- IDENTIFIANTS : le cycle 4 et ses domaines gardent les ids de 002
-- (`seed-d1`…`seed-d5`), le cycle 3 prend `seed-c3-d1`…`seed-c3-d5`. Cette
-- asymétrie est assumée : réécrire 002 pour la supprimer ne toucherait QUE les
-- bases neuves — 002 y a déjà tourné ailleurs — et produirait deux jeux d'ids
-- divergents selon la date de création de la base.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Les cinq champs professionnels SEGPA, attendus depuis 002.
-- --------------------------------------------------------------------------

INSERT INTO professional_fields (id, name, position) VALUES
    ('seed-pf-habitat',                       'Habitat',                                 0),
    ('seed-pf-hygiene-alimentation-services', 'Hygiène - Alimentation - Services',       1),
    ('seed-pf-vente-distribution-magasinage', 'Vente - Distribution - Magasinage',       2),
    ('seed-pf-espace-rural-et-environnement', 'Espace rural et environnement',           3),
    ('seed-pf-production-industrielle',       'Production industrielle',                 4);

-- --------------------------------------------------------------------------
-- 2. Le cycle 3 et ses cinq domaines. Le cycle 4 existe déjà (002).
--    Les domaines du socle sont définis une seule fois par le décret, mais le
--    modèle les rattache à un cycle : chaque cycle en porte donc sa copie, ce
--    qui permet à l'enseignant d'adapter l'arbre d'un cycle sans toucher à
--    l'autre.
-- --------------------------------------------------------------------------

INSERT INTO cycles (id, name, position) VALUES
    ('seed-cycle-3', 'Cycle 3', 1);

INSERT INTO domains (id, cycle_id, name, position) VALUES
    ('seed-c3-d1',      'seed-cycle-3', 'Les langages pour penser et communiquer',               0),
    ('seed-c3-d2',      'seed-cycle-3', 'Les méthodes et outils pour apprendre',                 1),
    ('seed-c3-d3',      'seed-cycle-3', 'La formation de la personne et du citoyen',             2),
    ('seed-c3-d4',      'seed-cycle-3', 'Les systèmes naturels et les systèmes techniques',      3),
    ('seed-c3-d5',      'seed-cycle-3', 'Les représentations du monde et l’activité humaine',    4);

-- --------------------------------------------------------------------------
-- 3. Les champs. Deux du cycle 4 existent déjà (`seed-d1-f1`, `seed-d1-f3`) :
--    les compétences s'y raccrochent plus bas, ils ne sont pas recréés.
--    Trois champs restent VOLONTAIREMENT sans compétence — celui de la
--    responsabilité en cycle 3, et `seed-d1-f2` / `seed-d1-f4` déjà en base :
--    le tableau de l'enseignant ne leur en attribue aucune. Ils restent
--    visibles plutôt que masqués, un champ vide se remarquant mieux qu'un
--    champ absent.
-- --------------------------------------------------------------------------

INSERT INTO fields (id, domain_id, name, position) VALUES
    ('seed-c3-d1-f1',     'seed-c3-d1',    'Comprendre, s’exprimer en utilisant la langue française à l’oral et à l’écrit', 0),
    ('seed-c3-d1-f2',     'seed-c3-d1',    'Comprendre, s’exprimer en utilisant les langages mathématiques, scientifiques et informatiques', 1),
    ('seed-c3-d1-f3',     'seed-c3-d1',    'Comprendre, s’exprimer en utilisant les langages des arts et du corps', 2),
    ('seed-c3-d2-f1',     'seed-c3-d2',    'S’approprier des outils et des méthodes', 0),
    ('seed-c3-d3-f1',     'seed-c3-d3',    'Expression de la sensibilité et des opinions, respect des autres', 0),
    ('seed-c3-d3-f2',     'seed-c3-d3',    'La règle et le droit', 1),
    ('seed-c3-d3-f3',     'seed-c3-d3',    'Réflexion et discernement', 2),
    ('seed-c3-d3-f4',     'seed-c3-d3',    'Responsabilité, sens de l’engagement et de l’initiative', 3),
    ('seed-c3-d4-f1',     'seed-c3-d4',    'Pratiquer des démarches scientifiques et technologiques', 0),
    ('seed-c3-d5-f1',     'seed-c3-d5',    'L’espace et le temps', 0),
    ('seed-c3-d5-f2',     'seed-c3-d5',    'Organisations et représentations du monde', 1),
    ('seed-c3-d5-f3',     'seed-c3-d5',    'Invention, élaboration, production', 2),
    ('seed-c4-d2-f1',     'seed-d2',       'Mobiliser des outils numériques', 0),
    ('seed-c4-d2-f2',     'seed-d2',       'S’approprier des outils et des méthodes', 1),
    ('seed-c4-d2-f3',     'seed-d2',       'Utiliser les médias, les informations de manière autonome', 2),
    ('seed-c4-d3-f1',     'seed-d3',       'Expression de la sensibilité et des opinions, respect des autres', 0),
    ('seed-c4-d3-f2',     'seed-d3',       'La règle et le droit', 1),
    ('seed-c4-d3-f3',     'seed-d3',       'Réflexion et discernement', 2),
    ('seed-c4-d3-f4',     'seed-d3',       'Responsabilité, sens de l’engagement et de l’initiative', 3),
    ('seed-c4-d4-f1',     'seed-d4',       'Concevoir, créer, réaliser', 0),
    ('seed-c4-d4-f2',     'seed-d4',       'Se situer dans l’espace et dans le temps', 1),
    ('seed-c4-d4-f3',     'seed-d4',       'Pratiquer des démarches scientifiques et technologiques', 2),
    ('seed-c4-d5-f1',     'seed-d5',       'Adopter un comportement éthique et responsable', 0);

-- --------------------------------------------------------------------------
-- 4. Les 53 compétences. L'orthographe de 1990 (« maitriser ») est celle du
--    socle : elle est conservée telle quelle, ce n'est pas une coquille.
--    L'id porte le numéro de ligne du classeur source, ce qui permet de
--    retrouver une compétence dans le tableau de l'enseignant.
-- --------------------------------------------------------------------------

INSERT INTO competencies (id, field_id, name, position) VALUES
    ('seed-c3-l06',     'seed-c3-d1-f1',     'Comprendre des textes, des documents et des images pour les interpréter.', 0),
    ('seed-c3-l07',     'seed-c3-d1-f1',     'Écrire à la main de manière fluide et efficace', 1),
    ('seed-c3-l08',     'seed-c3-d1-f1',     'Parler en prenant en compte son auditoire', 2),
    ('seed-c3-l10',     'seed-c3-d1-f2',     'Analyser une figure plane sous différents aspects (surface, contour de celle-ci, lignes et points)', 0),
    ('seed-c3-l11',     'seed-c3-d1-f2',     'Reconnaître et utiliser des premiers éléments de codage d’une figure plane ou d’un solide', 1),
    ('seed-c3-l12',     'seed-c3-d1-f2',     'Utiliser des propriétés géométriques pour reconnaître des objets', 2),
    ('seed-c3-l13',     'seed-c3-d1-f2',     'Produire et utiliser diverses représentations des fractions simples et des nombres décimaux', 3),
    ('seed-c3-l14',     'seed-c3-d1-f2',     'Contrôler la vraisemblance de ses résultats', 4),
    ('seed-c3-l15',     'seed-c3-d1-f2',     'Utiliser une calculatrice pour trouver un résultat ou le vérifier', 5),
    ('seed-c3-l16',     'seed-c3-d1-f2',     'Utiliser progressivement un vocabulaire adéquat et/ou des notations adaptées pour décrire une situation, exposer une argumentation.', 6),
    ('seed-c3-l18',     'seed-c3-d1-f3',     'S’exprimer par des activités physiques, sportives ou artistiques', 0),
    ('seed-c3-l19',     'seed-c3-d1-f3',     'Pratiquer les arts en mobilisant divers langages artistiques et leurs ressources', 1),
    ('seed-c3-l20',     'seed-c3-d1-f3',     'Prendre du recul sur la pratique artistique, individuelle et collective', 2),
    ('seed-c3-l22',     'seed-c3-d2-f1',     'Choisir ou utiliser le matériel adapté pour mener une observation, effectuer une mesure, réaliser une expérience ou une production', 0),
    ('seed-c3-l23',     'seed-c3-d2-f1',     'Faire le lien entre la mesure réalisée, les unités et l’outil utilisés', 1),
    ('seed-c3-l28',     'seed-c3-d3-f1',     'Maitriser l’expression de sa sensibilité et de ses opinions, respecter celles des autres', 0),
    ('seed-c3-l29',     'seed-c3-d3-f2',     'Comprendre la règle et le droit', 0),
    ('seed-c3-l34',     'seed-c3-d3-f2',     'S’engager dans un projet de création et publication sur papier ou en ligne utile à une communauté d’utilisateurs dans ou hors de l’établissement qui respecte droit et éthique de l’information.', 1),
    ('seed-c3-l30',     'seed-c3-d3-f3',     'Exercer son esprit critique, faire preuve de réflexion et de discernement', 0),
    ('seed-c3-l31',     'seed-c3-d3-f4',     'Organiser seul ou en groupe un espace de réalisation expérimentale', 0),
    ('seed-c3-l36',     'seed-c3-d4-f1',     'Mener une démarche scientifique ou technologique, résoudre des problèmes simples', 0),
    ('seed-c3-l37',     'seed-c3-d4-f1',     'Mettre en pratique des comportements simples, respectueux des autres, de l’environnement, de sa santé', 1),
    ('seed-c3-l39',     'seed-c3-d5-f1',     'Situer et se situer dans le temps et dans l’espace', 0),
    ('seed-c3-l40',     'seed-c3-d5-f2',     'Analyser et comprendre les organisations humaines et les représentations du monde', 0),
    ('seed-c3-l41',     'seed-c3-d5-f3',     'Raisonner, imaginer, élaborer, produire', 0),
    ('seed-c4-l06',     'seed-d1-f1',        'Lire des images, des documents composites (y compris numériques) et des textes non littéraires.', 0),
    ('seed-c4-l07',     'seed-d1-f1',        'Utiliser l’écrit pour penser et pour apprendre.', 1),
    ('seed-c4-l08',     'seed-d1-f1',        'S’exprimer de façon maitrisée en s’adressant à un auditoire', 2),
    ('seed-c4-l10',     'seed-d1-f3',        'Utiliser, produire et mettre en relation des représentations de solides (par exemple, perspective ou vue de dessus/de dessous) et de situations spatiales (schémas, croquis, maquettes, patrons, figures géométriques, photographies, plans, cartes, courbes de niveau).', 0),
    ('seed-c4-l12',     'seed-c4-d2-f1',     'Organiser, structurer et stocker des ressources numériques.', 0),
    ('seed-c4-l13',     'seed-c4-d2-f1',     'Lire, utiliser et produire des représentations numériques d’objets ou systèmes techniques.', 1),
    ('seed-c4-l14',     'seed-c4-d2-f2',     'Exprimer sa pensée à l’aide d’outils de description adaptés : croquis, schémas, graphes, diagrammes, tableaux (représentations non normées).', 0),
    ('seed-c4-l15',     'seed-c4-d2-f2',     'Présenter à l’oral et à l’aide de supports numériques multimédia des solutions techniques au moment des revues de projet.', 1),
    ('seed-c4-l16',     'seed-c4-d2-f3',     'Mobiliser des outils numériques pour apprendre, échanger, communiquer', 0),
    ('seed-c4-l17',     'seed-c4-d2-f3',     'Utiliser des dictionnaires et encyclopédies sur tous supports', 1),
    ('seed-c4-l18',     'seed-c4-d2-f3',     'Exploiter le centre de ressources comme outil de recherche de l’information.', 2),
    ('seed-c4-l19',     'seed-c4-d2-f3',     'Utiliser les genres et les outils d’information à disposition adaptés à ses recherches.', 3),
    ('seed-c4-l20',     'seed-c4-d2-f3',     'Découvrir comment l’information est indexée et hiérarchisée, comprendre les principaux termes techniques associés.', 4),
    ('seed-c4-l21',     'seed-c4-d2-f3',     'Classer ses propres documents sur sa tablette, son espace personnel, au collège ou chez soi sur des applications mobiles ou dans le « nuage ». Organiser des portefeuilles thématiques.', 5),
    ('seed-c4-l22',     'seed-c4-d2-f3',     'Acquérir une méthode de recherche exploratoire d’informations et de leur exploitation par l’utilisation avancée des moteurs de recherche.', 6),
    ('seed-c4-l23',     'seed-c4-d2-f3',     'Adopter progressivement une démarche raisonnée dans la recherche d’informations', 7),
    ('seed-c4-l25',     'seed-c4-d3-f1',     'Maitriser l’expression de sa sensibilité et de ses opinions, respecter celles des autres', 0),
    ('seed-c4-l26',     'seed-c4-d3-f2',     'Comprendre la règle et le droit', 0),
    ('seed-c4-l27',     'seed-c4-d3-f3',     'Exercer son esprit critique, faire preuve de réflexion et de discernement', 0),
    ('seed-c4-l28',     'seed-c4-d3-f4',     'Faire preuve de responsabilité, respecter les règles de vie collective, s’engager et prendre des initiatives', 0),
    ('seed-c4-l30',     'seed-c4-d4-f1',     'Identifier le(s) matériau(x), les flux d’énergie et d’information dans le cadre d’une production technique sur un objet et décrire les transformations qui s’opèrent.', 0),
    ('seed-c4-l31',     'seed-c4-d4-f1',     'Imaginer des solutions en réponse au cahier des charges.', 1),
    ('seed-c4-l32',     'seed-c4-d4-f1',     'Réaliser, de manière collaborative, le prototype ou tout ou partie d’un objet, d’un système technique.', 2),
    ('seed-c4-l33',     'seed-c4-d4-f2',     'Regrouper des objets en familles et lignées, y associer l’évolution des métiers, des techniques, des services techniques.', 0),
    ('seed-c4-l34',     'seed-c4-d4-f3',     'Imaginer, respecter une procédure, un protocole, restituer, proposer des évolutions ou modifications de la procédure, du protocole en fonction des résultats obtenus', 0),
    ('seed-c4-l35',     'seed-c4-d4-f3',     'Participer à l’organisation et au déroulement de projets', 1),
    ('seed-c4-l37',     'seed-c4-d5-f1',     'Analyser l’impact environnemental d’un objet et de ses constituants.', 0),
    ('seed-c4-l38',     'seed-c4-d5-f1',     'Décrire le cycle de vie d’un objet', 1);

-- --------------------------------------------------------------------------
-- 5. Les savoirs associés à un champ professionnel.
--
--    `physics_reminder` : dans le tableau de l'enseignant, l'intitulé du groupe
--    S1 porte la légende « (*Rappel du programme Sciences Physique de Collège) »
--    et dix de ses vingt savoirs commencent par une astérisque. Ce n'est donc
--    pas du texte, c'est un attribut — et il ne peut pas vivre sur le groupe :
--    les savoirs marqués sont S1.01 à S1.09 PUIS S1.13, pas un bloc continu.
--    Laisser l'astérisque dans le libellé ferait imprimer « *Le courant
--    alternatif » sur une fiche remise à un élève.
--
--    `archived_at`, et RESTRICT sur la liaison : même raison qu'en table 7 pour
--    les compétences. Dès qu'une fiche contrat référence un savoir, la
--    suppression dure doit échouer pour que la commande puisse proposer
--    l'archivage au lieu de détruire le travail en silence.
-- --------------------------------------------------------------------------

-- 24/26 — savoir_groups
CREATE TABLE savoir_groups (
    id                    TEXT PRIMARY KEY,
    professional_field_id TEXT NOT NULL REFERENCES professional_fields(id) ON DELETE CASCADE,
    code                  TEXT NOT NULL,
    name                  TEXT NOT NULL,
    position              INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (professional_field_id, code)
);
CREATE INDEX ix_savoir_groups_field ON savoir_groups(professional_field_id, position, code);

-- 25/26 — savoirs
CREATE TABLE savoirs (
    id               TEXT PRIMARY KEY,
    savoir_group_id  TEXT NOT NULL REFERENCES savoir_groups(id) ON DELETE CASCADE,
    code             TEXT NOT NULL,
    name             TEXT NOT NULL,
    physics_reminder INTEGER NOT NULL DEFAULT 0 CHECK (physics_reminder IN (0, 1)),
    position         INTEGER NOT NULL DEFAULT 0,
    archived_at      TEXT NULL,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (savoir_group_id, code)
);
CREATE INDEX ix_savoirs_group ON savoirs(savoir_group_id, position, code);

-- 26/26 — contract_sheet_savoirs. La « séquence » du tableau de l'enseignant,
--         c'est l'évaluation et sa fiche contrat : contract_sheets est en 1-1
--         sur evaluations, donc s'accrocher ici attache bien les savoirs à la
--         séquence sans introduire une entité de plus.
CREATE TABLE contract_sheet_savoirs (
    contract_sheet_id TEXT NOT NULL REFERENCES contract_sheets(id) ON DELETE CASCADE,
    savoir_id         TEXT NOT NULL REFERENCES savoirs(id)         ON DELETE RESTRICT,
    position          INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (contract_sheet_id, savoir_id)
);
CREATE INDEX ix_contract_savoirs_savoir ON contract_sheet_savoirs(savoir_id);   -- requis par le RESTRICT

-- Les sept groupes du champ Habitat.
INSERT INTO savoir_groups (id, professional_field_id, code, name, position) VALUES
    ('seed-sav-s1',       'seed-pf-habitat', 'S1',  'Installation Électrique',                     0),
    ('seed-sav-s2',       'seed-pf-habitat', 'S2',  'Installation Sanitaire et Thermique',         1),
    ('seed-sav-s3',       'seed-pf-habitat', 'S3',  'Maçonnerie, Plâtrerie, Carrelage',            2),
    ('seed-sav-s4',       'seed-pf-habitat', 'S4',  'Menuiserie, Charpente, Couverture S4. Menuiserie, Charpente, Couverture', 3),
    ('seed-sav-s5',       'seed-pf-habitat', 'S5',  'Métallerie, Serrurerie, Vitrerie',            4),
    ('seed-sav-s6',       'seed-pf-habitat', 'S6',  'Peinture, Isolation, Revêtements',            5),
    ('seed-sav-s7',       'seed-pf-habitat', 'S7',  'Savoirs communs, Dessin Technique',           6);

-- Les 91 savoirs du champ Habitat, dans l'ordre du tableau. Les autres champs
-- professionnels n'ont pas encore de liste : leurs groupes restent à saisir.
INSERT INTO savoirs (id, savoir_group_id, code, name, physics_reminder, position) VALUES
    ('seed-sav-s1-01',      'seed-sav-s1',       'S1.01',   'Les différents types de courant (AC, DC)', 1, 0),
    ('seed-sav-s1-02',      'seed-sav-s1',       'S1.02',   'L’origine du courant électrique (centrales, éoliennes…)', 1, 1),
    ('seed-sav-s1-03',      'seed-sav-s1',       'S1.03',   'Le transport et le stockage de l’électricité', 1, 2),
    ('seed-sav-s1-04',      'seed-sav-s1',       'S1.04',   'Le vocabulaire spécifique (tension, intensité…)', 1, 3),
    ('seed-sav-s1-05',      'seed-sav-s1',       'S1.05',   'Les unités employées et notions de consommation', 1, 4),
    ('seed-sav-s1-06',      'seed-sav-s1',       'S1.06',   'Le courant continu', 1, 5),
    ('seed-sav-s1-07',      'seed-sav-s1',       'S1.07',   'Initiation au circuit d’un courant continu', 1, 6),
    ('seed-sav-s1-08',      'seed-sav-s1',       'S1.08',   'Les mesures simples d’un courant continu (sur accus basse tension)', 1, 7),
    ('seed-sav-s1-09',      'seed-sav-s1',       'S1.09',   'Le courant alternatif', 1, 8),
    ('seed-sav-s1-10',      'seed-sav-s1',       'S1.10',   'Les câbles et leurs sections', 0, 9),
    ('seed-sav-s1-11',      'seed-sav-s1',       'S1.11',   'La sécurité et les isolants (le risque électrique)', 0, 10),
    ('seed-sav-s1-12',      'seed-sav-s1',       'S1.12',   'Les outils de l’électricien du bâtiment', 0, 11),
    ('seed-sav-s1-13',      'seed-sav-s1',       'S1.13',   'La mise à la terre', 1, 12),
    ('seed-sav-s1-14',      'seed-sav-s1',       'S1.14',   'Les applications du courant alternatif', 0, 13),
    ('seed-sav-s1-15',      'seed-sav-s1',       'S1.15',   'Branchement simple d’une lampe ou moteur (hors tension)', 0, 14),
    ('seed-sav-s1-16',      'seed-sav-s1',       'S1.16',   'Notions d’accessoires électriques du bâtiment (disjoncteur, prises, inter ... )', 0, 15),
    ('seed-sav-s1-17',      'seed-sav-s1',       'S1.17',   'Lecture d’un plan électrique simple: normes de représentation', 0, 16),
    ('seed-sav-s1-18',      'seed-sav-s1',       'S1.18',   'Élaboration théorique d’un réseau « habitat » simple', 0, 17),
    ('seed-sav-s1-19',      'seed-sav-s1',       'S1.19',   'Les procédés de mise en place (Gaines, fixations, colliers, Chevilles… )', 0, 18),
    ('seed-sav-s1-20',      'seed-sav-s1',       'S1.20',   'Systèmes de renouvellement d’air (ventilation mécanique controlée, extraction de hotte...)', 0, 19),
    ('seed-sav-s2-01',      'seed-sav-s2',       'S2.01',   'L’eau : son captage son traitement préalable et sa distribution', 0, 0),
    ('seed-sav-s2-02',      'seed-sav-s2',       'S2.02',   'Le réseau d’assainissement public: eaux usées, vannes et leur recyclage', 0, 1),
    ('seed-sav-s2-03',      'seed-sav-s2',       'S2.03',   'Les éléments du réseau privé (alimentation et évacuation)', 0, 2),
    ('seed-sav-s2-04',      'seed-sav-s2',       'S2.04',   'Les différents matériaux (cuivre, étain, pvc… ) et leur forme marchande', 0, 3),
    ('seed-sav-s2-05',      'seed-sav-s2',       'S2.05',   'Lecture de plans (sanitaire) et normes de représentation (circuit des fluides et accessoires)', 0, 4),
    ('seed-sav-s2-06',      'seed-sav-s2',       'S2.06',   'Notions de niveaux et pentes (écoulements)', 0, 5),
    ('seed-sav-s2-07',      'seed-sav-s2',       'S2.07',   'Les moyens de liaisons (raccords, coudes, tés, brides, vannes… )', 0, 6),
    ('seed-sav-s2-08',      'seed-sav-s2',       'S2.08',   'Les principes de brasure et l’outillage', 0, 7),
    ('seed-sav-s2-09',      'seed-sav-s2',       'S2.09',   'Préparation et réalisation d’une brasure tendre sur cuivre', 0, 8),
    ('seed-sav-s2-10',      'seed-sav-s2',       'S2.10',   'L’étanchéité et les moyens employés (joints, téflon, pâtes…)', 0, 9),
    ('seed-sav-s2-11',      'seed-sav-s2',       'S2.11',   'La conformation des tubes (cintrage, emboîtage… )', 0, 10),
    ('seed-sav-s2-12',      'seed-sav-s2',       'S2.12',   'Les outils du plombier', 0, 11),
    ('seed-sav-s2-13',      'seed-sav-s2',       'S2.13',   'Élaboration théorique d’une installation sanitaire privée', 0, 12),
    ('seed-sav-s2-14',      'seed-sav-s2',       'S2.14',   'Sensibilisation au moyens de chauffage de l’eau (énergies + procédés)', 0, 13),
    ('seed-sav-s2-15',      'seed-sav-s2',       'S2.15',   'Sensibilisation au moyens de climatisation (principe et matériels)', 0, 14),
    ('seed-sav-s3-01',      'seed-sav-s3',       'S3.01',   'Les principaux ouvrages du bâtiment (implantation, fondations, murs, charpente, couverture...)', 0, 0),
    ('seed-sav-s3-02',      'seed-sav-s3',       'S3.02',   'Les matériaux de construction et leurs caractéristiques (sable, grave, acier, blocs, plaques…)', 0, 1),
    ('seed-sav-s3-03',      'seed-sav-s3',       'S3.03',   'Les liants (ciment, chaux, plâtre) et leurs utilisations (béton, mortier, enduit...)', 0, 2),
    ('seed-sav-s3-04',      'seed-sav-s3',       'S3.04',   'Les ouvrages de maçonnerie (Dalles, murs, cloisons, Poteaux, linteaux, chaînage, appuis…)', 0, 3),
    ('seed-sav-s3-05',      'seed-sav-s3',       'S3.05',   'Les ouvrages de plâtrerie (cloisons, doublage, habillage, plafonds, éléments de décoration...)', 0, 4),
    ('seed-sav-s3-06',      'seed-sav-s3',       'S3.06',   'Les ouvrages de carrelage (Sols intérieurs, Faïences murales, Sols extérieurs, pavage…)', 0, 5),
    ('seed-sav-s3-07',      'seed-sav-s3',       'S3.07',   'Notions d’étanchéité, d’ isolation thermique et acoustique', 0, 6),
    ('seed-sav-s3-08',      'seed-sav-s3',       'S3.08',   'Les outils du bâtiment et leurs utilisations', 0, 7),
    ('seed-sav-s3-09',      'seed-sav-s3',       'S3.09',   'Notions d’implantation, d’élévation, de niveau, d’aplomb, de pente…', 0, 8),
    ('seed-sav-s3-10',      'seed-sav-s3',       'S3.10',   'Lecture de plans, de coupes…', 0, 9),
    ('seed-sav-s4-01',      'seed-sav-s4',       'S4.01',   'Les ouvrages de charpente, les ossatures bois et leurs éléments constitutifs', 0, 0),
    ('seed-sav-s4-02',      'seed-sav-s4',       'S4.02',   'Les types de couverture (régions, pentes, matériaux) et le principe de récupération des EP', 0, 1),
    ('seed-sav-s4-03',      'seed-sav-s4',       'S4.03',   'Les types de tuiles, les accessoires et le principe de pose', 0, 2),
    ('seed-sav-s4-04',      'seed-sav-s4',       'S4.04',   'Les ouvrages de menuiserie du bâtiment (Huisseries, escalier, aménagements…)', 0, 3),
    ('seed-sav-s4-05',      'seed-sav-s4',       'S4.05',   'Les bois, produits dérivés et leur forme commerciale', 0, 4),
    ('seed-sav-s4-06',      'seed-sav-s4',       'S4.06',   'Les types d’ouvrants (désignation et caractéristiques)', 0, 5),
    ('seed-sav-s4-07',      'seed-sav-s4',       'S4.07',   'Les principes d’assemblage et de liaison d’ouvrages par usinage', 0, 6),
    ('seed-sav-s4-08',      'seed-sav-s4',       'S4.08',   'Les outils du menuisier et du charpentier', 0, 7),
    ('seed-sav-s4-09',      'seed-sav-s4',       'S4.09',   'Les moyens de fixation (clavetage, vissage, collage…) et leur forme marchande', 0, 8),
    ('seed-sav-s4-10',      'seed-sav-s4',       'S4.10',   'La protection des bois et les caractéristiques des produits utilisés', 0, 9),
    ('seed-sav-s4-11',      'seed-sav-s4',       'S4.11',   'Le parquet, le lambris, le bardage… (matières, caractéristiques, et principes de pose)', 0, 10),
    ('seed-sav-s4-12',      'seed-sav-s4',       'S4.12',   'La finition (état de surface, placage, vernis, peinture, lasures…)', 0, 11),
    ('seed-sav-s5-01',      'seed-sav-s5',       'S5.01',   'Les ouvrages de structure métallique (Génie civil, Ossatures, hangar, charpente, plancher…)', 0, 0),
    ('seed-sav-s5-02',      'seed-sav-s5',       'S5.02',   'Les ouvrages de métallerie du bâtiment (Escaliers, rampes, huisseries, grilles, volets roulants, portails, clôtures, vérandas…)', 0, 1),
    ('seed-sav-s5-03',      'seed-sav-s5',       'S5.03',   'Les principaux métaux, alliages, et leurs formes marchandes', 0, 2),
    ('seed-sav-s5-04',      'seed-sav-s5',       'S5.04',   'Les types de liaison avec le gros œuvre (Scellements au mortier, chimique, chevilles…)', 0, 3),
    ('seed-sav-s5-05',      'seed-sav-s5',       'S5.05',   'Les outils principaux du métallier-aluminier', 0, 4),
    ('seed-sav-s5-06',      'seed-sav-s5',       'S5.06',   'Le vitrage des huisseries et ses caractéristiques', 0, 5),
    ('seed-sav-s5-07',      'seed-sav-s5',       'S5.07',   'La serrurerie (organes de rotation, de fermeture, systèmes coulissants, types de commande…)', 0, 6),
    ('seed-sav-s5-08',      'seed-sav-s5',       'S5.08',   'La corrosion et les traitements de surface', 0, 7),
    ('seed-sav-s5-09',      'seed-sav-s5',       'S5.09',   'Le PVC (caractéristiques et formes marchandes)', 0, 8),
    ('seed-sav-s6-01',      'seed-sav-s6',       'S6.01',   'Les isolants thermiques, phoniques et leurs formes marchandes (Laines verre, roche et polyuréthane, joints...)', 0, 0),
    ('seed-sav-s6-02',      'seed-sav-s6',       'S6.02',   'Les principes d’application des isolants', 0, 1),
    ('seed-sav-s6-03',      'seed-sav-s6',       'S6.03',   'Notions d’état de surface des matériaux et d’accrochage des supports', 0, 2),
    ('seed-sav-s6-04',      'seed-sav-s6',       'S6.04',   'Les produits de revêtement mural (intérieur et extérieur) et leurs caractéristiques', 0, 3),
    ('seed-sav-s6-05',      'seed-sav-s6',       'S6.05',   'Principes de pose des enduits de rebouchage et de protection', 0, 4),
    ('seed-sav-s6-06',      'seed-sav-s6',       'S6.06',   'Principes de préparation et d’application des peintures', 0, 5),
    ('seed-sav-s6-07',      'seed-sav-s6',       'S6.07',   'Les outils du peintre décorateur', 0, 6),
    ('seed-sav-s6-08',      'seed-sav-s6',       'S6.08',   'Le papier peint, les toiles murales, les colles (types, et caractéristiques)', 0, 7),
    ('seed-sav-s6-09',      'seed-sav-s6',       'S6.09',   'Les revêtements de sol (types et caractéristiques)', 0, 8),
    ('seed-sav-s7-01',      'seed-sav-s7',       'S7.01',   'L’enclenchement: décomposition d’un ensemble', 0, 0),
    ('seed-sav-s7-02',      'seed-sav-s7',       'S7.02',   'Étude fonctionnelle d’un objet', 0, 1),
    ('seed-sav-s7-03',      'seed-sav-s7',       'S7.03',   'Processus d’une fabrication : Établir un planning de phases', 0, 2),
    ('seed-sav-s7-04',      'seed-sav-s7',       'S7.04',   'Notion de poste de travail et d’organisation', 0, 3),
    ('seed-sav-s7-05',      'seed-sav-s7',       'S7.05',   'L’atelier et le chantier: Notion d’ analyse de "situation de travail" et risques professionnels', 0, 4),
    ('seed-sav-s7-06',      'seed-sav-s7',       'S7.06',   'Les principes de manutention et techniques gestuelles (Formation PRAP 12h)', 0, 5),
    ('seed-sav-s7-07',      'seed-sav-s7',       'S7.07',   'Dessin Technique: Formats, cartouche, traits normalisés…', 0, 6),
    ('seed-sav-s7-08',      'seed-sav-s7',       'S7.08',   'Recherche de cotes (sensibilisation à la lecture des dessins, plans...)', 0, 7),
    ('seed-sav-s7-09',      'seed-sav-s7',       'S7.09',   'Principes de représentation des vues', 0, 8),
    ('seed-sav-s7-10',      'seed-sav-s7',       'S7.10',   'Utilisation des instruments pour compléter des vues', 0, 9),
    ('seed-sav-s7-11',      'seed-sav-s7',       'S7.11',   'Principe de perspective et vue en 3D (Schéma et relevé de côtes)', 0, 10),
    ('seed-sav-s7-12',      'seed-sav-s7',       'S7.12',   'Évaluation de matière première: Établir une feuille de débit', 0, 11),
    ('seed-sav-s7-13',      'seed-sav-s7',       'S7.13',   'Notion de coupes, d’élévation…', 0, 12),
    ('seed-sav-s7-14',      'seed-sav-s7',       'S7.14',   'Préparation au stage en Entreprise', 0, 13),
    ('seed-sav-s7-15',      'seed-sav-s7',       'S7.15',   'Rédiger un compte rendu de Stage.', 0, 14),
    ('seed-sav-s7-16',      'seed-sav-s7',       'S7.16',   '…', 0, 15);

