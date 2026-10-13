-- ===========================================================================
-- 23/23 — school_holidays. UNE COUCHE D'AFFICHAGE, ET RIEN D'AUTRE.
--
--         CE QU'ELLE NE FAIT PAS, et c'est l'essentiel : elle ne crée ni ne
--         supprime AUCUNE séance, n'entre dans AUCUN comptage de bilan, et ne
--         touche pas une ligne d'`ATTENDANCE_SQL`. Même promesse que le palier
--         004. La grille cesse de PROPOSER un cours ces jours-là ; elle
--         n'annule rien, parce qu'il n'y a rien à annuler — un créneau est un
--         modèle, il n'existe pas.
--
--         CE CHOIX A ÉTÉ PESÉ, et l'autre a été refusé en connaissance de
--         cause. Créer automatiquement des séances `cancelled` pendant les
--         vacances et les stages aurait semblé plus « automatique ». Mais une
--         séance annulée sort du dénominateur de TOUTE la classe
--         (`reports.rs`, `cancelled = 0` dans les deux faces), et `cancelled`
--         est évalué AVANT toute logique de placement : l'élève qui n'a pas
--         trouvé de stage, resté au collège, reperdrait ses séances et ses
--         absences — 18 points de pourcentage mesurés sur le bilan remis à sa
--         famille, exactement le défaut que le palier 006 a corrigé. Et le
--         bilan annoncerait « 6 séances annulées » pour des semaines de stage.
--         AFFICHER NE MENT JAMAIS ; ÉCRIRE PEUT MENTIR.
--
--         PAS dans `absence_periods`, qui porte `session_id NOT NULL ON DELETE
--         CASCADE` : une période de vacances n'appartient à aucune classe, l'y
--         loger imposerait N lignes par classe, et supprimer une classe
--         emporterait les vacances de toutes les autres.
--
--         PAS de colonne `year_start`. Elle ne servirait qu'à grouper un écran,
--         et imposerait une SECONDE implémentation de `year_start_for`
--         (commands/timetable.rs) dans le script JavaScript — exactement ce que
--         CLAUDE.md interdit pour le trimestre. Le groupement par année se fait
--         en Rust, à la lecture. La grille, elle, interroge par PLAGE DE DATES
--         et jamais par année : mesuré, les vacances d'été 2026-2027 à Besançon
--         courent du 2027-07-03 au 2027-09-01, donc à cheval sur le 1er août.
--         Un filtre par année les ferait disparaître le 20 août, au moment
--         précis où l'on prépare la rentrée.
--
--         PAS d'index UNIQUE. MESURÉ sur les données réelles du ministère : le
--         triplet (académie, libellé, année) n'est pas unique — quatre
--         collisions légitimes dans la fenêtre embarquée. La clé primaire est
--         une empreinte des cinq colonnes, calculée par `scripts/vacances.mjs`,
--         et le dédoublonnage se fait dans le script, où il est relisible.
-- ===========================================================================
CREATE TABLE school_holidays (
    -- Empreinte des cinq colonnes, calculée par `scripts/vacances.mjs`. Deux
    -- propriétés qu'un uuid n'aurait pas : le semis est rejouable sans écraser
    -- une correction de l'enseignant, et l'identifiant est VISIBLE DANS LE DIFF
    -- — un identifiant tiré au hasard à chaque régénération ferait d'une mise à
    -- jour de calendrier un diff illisible de 513 lignes.
    id         TEXT NOT NULL PRIMARY KEY,

    -- Valeur EXACTE du champ `location` de l'open data, pas un code. Aucune
    -- table d'académies : ce serait une seconde source de vérité à semer et à
    -- tenir à jour. La liste proposée à l'enseignant se lit DANS CES LIGNES
    -- (`SELECT DISTINCT academie`), donc elle ne peut pas proposer une académie
    -- sans dates — un réglage qui aurait l'air de marcher et ne ferait rien.
    academie   TEXT NOT NULL,

    label      TEXT NOT NULL,            -- non vide exigé EN RUST

    -- ⚠ IRRÉVERSIBLE (CHECK : pas de DROP CONSTRAINT en SQLite). Mêmes GLOB que
    -- `absence_periods` et `students.enrolled_on` : c'est cette forme, et elle
    -- seule, qui rend légitimes les comparaisons lexicographiques de dates de
    -- tout le projet.
    --
    -- PREMIER ET DERNIER JOUR DE VACANCES, BORNES INCLUSES — surtout pas la
    -- borne de reprise que publie l'API, que `scripts/vacances.mjs` convertit.
    -- Une seconde convention dans le même schéma ferait qu'un `BETWEEN` écrit
    -- par un palier futur masquerait un vrai cours le jour de la rentrée.
    start_date TEXT NOT NULL
               CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    end_date   TEXT NOT NULL
               CHECK (end_date   GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),

    -- ⚠ IRRÉVERSIBLE (CHECK).
    -- 'officiel' = semé depuis le fichier embarqué, remplaçable à chaque mise à
    --              jour de SGPA.
    -- 'manuel'   = à l'enseignant, JAMAIS touché par le semis.
    -- Défaut 'manuel' : une ligne insérée à la main appartient à son auteur tant
    -- que personne n'a dit le contraire. Et corriger une ligne 'officiel' la
    -- fait basculer en 'manuel' — c'est ce qui fait survivre la correction au
    -- semis suivant.
    origin     TEXT NOT NULL DEFAULT 'manuel'
               CHECK (origin IN ('officiel', 'manuel')),

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- Égalité permise : une journée banalisée est une période d'un jour. C'est
    -- aussi ce qui autorise un jour férié saisi à la main.
    CHECK (start_date <= end_date)
);

-- UN SEUL index, et il couvre la requête de la grille : égalité sur `academie`,
-- contrainte de rang sur `end_date`, puis `start_date` et `label` lus DANS
-- l'index. Pas de second index : cette table compte quelques centaines de
-- lignes pour toute la vie de la base, et elle n'est écrite qu'au semis.
CREATE INDEX ix_holidays_academie
    ON school_holidays(academie, end_date, start_date, label);

-- '' = non renseignée. Même esprit que `professional_fields`, volontairement
-- vide : l'application ne devine pas où enseigne quelqu'un. La grille invite à
-- la renseigner plutôt que d'afficher les vacances d'une académie au hasard —
-- des dates fausses seraient pires que pas de dates.
--
-- C'est une propriété de l'ENSEIGNANT — une clé USB, une base, un enseignant —
-- donc elle vit dans `app_settings` et non sur la classe ou l'année.
--
-- PAR ACADÉMIE ET NON PAR ZONE : `zones` prend 13 valeurs dont 10 ne sont que
-- le nom du territoire répété, et en 2026-2027 la Corse publie un pont que les
-- zones A/B/C ne publient pas. Une clé par zone forcerait aussitôt une seconde
-- clé. Et on connaît son académie ; sa zone a changé au fil des réformes.
ALTER TABLE app_settings ADD COLUMN academie TEXT NOT NULL DEFAULT '';

-- Millésime du fichier déjà semé dans CETTE base, pour que le semis sorte en
-- une lecture quand il n'y a rien à faire.
--
-- N'entre PAS dans `AppSettings` exposé au front, et c'est volontaire : il
-- appartient au semis, comme `last_backup_at` appartient à la sauvegarde. Un
-- formulaire de réglages un peu périmé le remettrait à vide et referait le semis
-- à chaque enregistrement.
ALTER TABLE app_settings ADD COLUMN holidays_stamp TEXT NOT NULL DEFAULT '';
