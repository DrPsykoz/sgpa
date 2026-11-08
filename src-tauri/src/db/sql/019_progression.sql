-- ==========================================================================
-- SGPA — palier 019 : la progression annuelle d'une classe
--
-- Le plan de progression est la pièce que l'enseignant pose en septembre et
-- relit toute l'année : les domaines d'activité qu'il va explorer, les
-- activités dans leur ordre, les semaines où chacune tombe, et ce que l'élève
-- doit y gagner. Il existait sur un document bureautique, en deux tableaux —
-- une frise des semaines en haut, le détail des activités en bas — dont la
-- correspondance tenait uniquement à la couleur des cases. Elle ne tenait pas :
-- trois teintes diffèrent d'un chiffre entre les deux tableaux, une quatrième
-- couvre deux activités distinctes, et le blanc veut dire à la fois une
-- activité nommée et « rien ». Les deux tableaux de ce palier lisent les mêmes
-- lignes, donc ils ne peuvent plus se contredire.
--
-- CINQ TABLES, ET POURQUOI AUCUNE NE SE REPLIE SUR UNE AUTRE
--
--   `progression_domaines`   le vocabulaire, global et LIVRÉ VIDE
--   `progressions`           une par classe
--   `progression_etapes`     ce qui porte compétences, connaissances, priorités
--   `progression_activites`  l'unité nommée, dans son ordre
--   `progression_plages`     l'occupation d'une semaine
--
-- L'ÉTAPE EST L'ÉCHELON QUE L'AUTEUR A DEMANDÉ. Son document portait quatre
-- blocs de compétences — sécurité et identification, autonomie et méthode,
-- auto-évaluation et conformité, ergonomie et rapport au corps — découpés
-- autrement que les domaines et autrement que les couleurs : le quatrième
-- chevauche deux domaines. Ni le domaine ni l'activité ne pouvaient donc les
-- porter. L'étape couvre une suite d'activités consécutives et porte les trois
-- textes ; elle ne possède PAS de semaines, et c'est volontaire — ce sont les
-- plages des activités qui disent le temps, et les deux découpes n'ont aucune
-- raison de coïncider.
--
-- L'ACTIVITÉ NE PORTE PAS `progression_id`. Son rang dans l'année se déduit de
-- `(etape.position, activite.position)`, donc l'ordre — et la couleur, qui en
-- vient — ne peut pas contredire l'étape. Une colonne de plus serait une
-- seconde vérité à tenir à jour.
--
-- LA CLÉ PRIMAIRE DES PLAGES REND L'IMPOSSIBLE IRREPRÉSENTABLE.
-- `(progression_id, week_monday, voie)` : deux activités la même semaine sur la
-- même voie n'existent pas, alors que le document en contenait. En contrepartie
-- `progression_id` y est dupliqué — il se déduit de l'activité par deux
-- jointures. Une plage dont l'activité appartient à une autre progression est
-- donc REFUSÉE par `commands/progressions.rs`, jamais rectifiée en silence :
-- une rectification muette masquerait le défaut d'écran qui l'a produite. C'est
-- la règle du couple classe/élève d'un rendez-vous, au palier 016.
--
-- UNE ACTIVITÉ QUI REVIENT EST UNE SEULE LIGNE, AVEC PLUSIEURS PLAGES.
-- Le document faisait revenir « Trier le matériel » en semaines 1-2 puis 20,
-- « Enduire » en 11 puis 14, « Bardage » en 25-26 puis 29. Même activité, même
-- couleur, même entrée au tableau du bas : la répétition est dans le temps, pas
-- dans la liste.
--
-- LA VOIE EST LA BANDE PARALLÈLE, celle qui portait « Démontage palettes » sur
-- neuf semaines dispersées pendant qu'une autre activité occupait la bande
-- principale. Deux voies suffisent, et le CHECK le dit. En revanche la
-- troisième rangée du document — celle qui coupait une semaine en deux — N'A
-- PAS d'équivalent ici : elle ne portait aucune information propre, c'était un
-- artefact de mise en page.
--
-- RIEN DU CALENDRIER N'EST STOCKÉ ICI. Pas de colonne de vacances, pas de
-- colonne de stage, pas de numéro de semaine. Les vacances vivent dans
-- `school_holidays` par plage de dates, les fériés sont calculés
-- (`commands/timetable/feries.rs`), et une classe en stage est une
-- `absence_periods` sans élève nommé. La frise les lit là où ils sont : une
-- vacance déplacée par l'académie bouge d'elle-même, alors qu'une vacance
-- peinte à la main serait restée juste jusqu'au premier changement.
--
-- `week_monday` est le lundi de la semaine, pas un numéro : un numéro ISO ne se
-- compare pas d'une année sur l'autre et laisserait la semaine 1 avant la
-- semaine 52 de la même année scolaire. Même raison qu'ailleurs dans le schéma,
-- où le calendrier s'interroge toujours par plage de dates.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- Le vocabulaire des domaines d'activité explorés.
--
-- GLOBAL, et non rattaché à une classe : « Réaliser le clos et les ouvertures »
-- reste le même domaine en 4e et en 3e, et le reposer chaque année serait la
-- saisie que ce palier doit éviter. Limite assumée, la même que pour les
-- étiquettes de besoins : le vocabulaire est global, les progressions qui s'en
-- servent sont annuelles.
--
-- LIVRÉ VIDE, comme `professional_fields` et `student_need_tags`. Les quatre
-- domaines du référentiel Habitat figuraient dans le document de l'auteur, mais
-- les semer ici reviendrait à décider pour lui de son champ professionnel et de
-- son orthographe — son document écrit « Equipements technique » sans accent et
-- au singulier, et ce n'est pas à l'application de le corriger.
--
-- `name` est unique SANS ÉGARD À LA CASSE : le document contenait
-- « Aménagement » et « aménagement », qui sont le même domaine revenu plus tard
-- dans l'année. Deux lignes auraient donné deux couleurs et deux fusions.
-- --------------------------------------------------------------------------
CREATE TABLE progression_domaines (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX ux_progression_domaines_name
    ON progression_domaines(name COLLATE NOCASE);

-- --------------------------------------------------------------------------
-- La progression d'une classe.
--
-- `session_id` est UNIQUE : une progression par classe, décision de l'auteur.
-- Son document distinguait un « Gr 2 », mais le groupe n'est pas une entité du
-- modèle — c'est un intitulé imprimé, et il est stocké comme tel.
--
-- Le niveau et l'année ne sont PAS repris ici : ils vivent sur `sessions` et
-- nulle part ailleurs.
-- --------------------------------------------------------------------------
CREATE TABLE progressions (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
    -- Le titre imprimé. `''` = l'export compose un titre depuis la classe et
    -- l'année, plutôt que d'imprimer une ligne vide.
    titre      TEXT NOT NULL DEFAULT '',
    -- L'intitulé de la première colonne de la frise : « Gr 2 », « Atelier »,
    -- ce que l'enseignant y met. Aucun calcul n'en dépend.
    intitule_groupe TEXT NOT NULL DEFAULT '',
    -- La bannière verticale du tableau — « le plaisir de manipuler ». Vide,
    -- elle ne s'imprime pas et la colonne disparaît.
    devise     TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --------------------------------------------------------------------------
-- Une étape de l'année : une suite d'activités consécutives, et les trois
-- textes que l'enseignant leur attache.
--
-- LES TROIS TEXTES SONT LIBRES, une ligne par puce. Décision de l'auteur : ils
-- ne citent pas `competencies`. Son document écrit « Prendre conscience des
-- dangers », « Respecter une chronologie imposée » — des formulations d'atelier
-- qui ne figurent dans aucun référentiel, et une liste à cocher les aurait
-- remplacées par des intitulés approchants.
--
-- `''` et non NULL : une colonne qui a deux façons de dire « vide » finit par
-- n'être testée que d'une des deux.
--
-- `position` sans UNIQUE, comme partout ailleurs dans ce schéma (`domains`,
-- `fields`, `competencies`, `contract_sheet_rows`) : un UNIQUE imposerait un
-- décalage en deux passes à chaque réordonnancement.
-- --------------------------------------------------------------------------
CREATE TABLE progression_etapes (
    id             TEXT PRIMARY KEY,
    progression_id TEXT NOT NULL REFERENCES progressions(id) ON DELETE CASCADE,
    position       INTEGER NOT NULL DEFAULT 0,
    -- Les blocs du document de l'auteur n'avaient pas de titre. `''` est donc
    -- le cas normal, pas une étape inachevée.
    libelle        TEXT NOT NULL DEFAULT '',
    competences    TEXT NOT NULL DEFAULT '',
    connaissances  TEXT NOT NULL DEFAULT '',
    priorites      TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_progression_etapes_progression
    ON progression_etapes(progression_id, position);

-- --------------------------------------------------------------------------
-- Une activité nommée, rattachée à son étape et à son domaine.
--
-- `domaine_id` est NULLABLE : une activité peut être posée avant que son
-- domaine soit choisi, et le document de l'auteur avait quatre activités sans
-- domaine arrêté. Mais la suppression est en RESTRICT, pas en SET NULL :
-- retirer du vocabulaire un domaine employé par huit activités les laisserait
-- orphelines sans que rien ne le dise. L'écran annonce le nombre d'activités
-- concernées, et c'est l'enseignant qui les détache.
-- --------------------------------------------------------------------------
CREATE TABLE progression_activites (
    id         TEXT PRIMARY KEY,
    etape_id   TEXT NOT NULL REFERENCES progression_etapes(id) ON DELETE CASCADE,
    domaine_id TEXT REFERENCES progression_domaines(id) ON DELETE RESTRICT,
    position   INTEGER NOT NULL DEFAULT 0,
    libelle    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_progression_activites_etape
    ON progression_activites(etape_id, position);

CREATE INDEX ix_progression_activites_domaine
    ON progression_activites(domaine_id);

-- --------------------------------------------------------------------------
-- L'occupation d'une semaine par une activité.
--
-- Une ligne par semaine et par voie, et non un couple (début, fin) : une
-- activité revient en plusieurs suites séparées, et des bornes auraient demandé
-- une ligne par suite, donc la même table avec une arithmétique de plus.
-- Peindre et dépeindre une semaine est alors un REPLACE et un DELETE, comme la
-- note d'une compétence.
-- --------------------------------------------------------------------------
CREATE TABLE progression_plages (
    progression_id TEXT NOT NULL REFERENCES progressions(id) ON DELETE CASCADE,
    week_monday    TEXT NOT NULL
        CHECK (week_monday GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    -- 0 = la bande principale, 1 = la bande parallèle. Deux voies, parce que le
    -- document n'en a jamais eu trois et qu'une troisième se lirait mal sur une
    -- frise de quarante-quatre colonnes.
    voie           INTEGER NOT NULL DEFAULT 0 CHECK (voie IN (0, 1)),
    activite_id    TEXT NOT NULL REFERENCES progression_activites(id) ON DELETE CASCADE,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (progression_id, week_monday, voie)
);

CREATE INDEX ix_progression_plages_activite
    ON progression_plages(activite_id);
