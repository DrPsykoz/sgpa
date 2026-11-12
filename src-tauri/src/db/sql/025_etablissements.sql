-- ==========================================================================
-- SGPA — palier 025 : l'établissement d'une classe, et ses réglages
--
-- DEMANDE DE L'AUTEUR, le 2026-11-12, en trois phrases :
--
--   « Essayer de lier une année scolaire à un établissement.
--     Ajouter des réglages par établissement comme la désactivation de
--     certaines compétences.
--     Les classes seront donc liées à cet établissement. »
--
-- ==========================================================================
-- OÙ SE RATTACHE L'ÉTABLISSEMENT : SUR LA CLASSE, ET POURQUOI
-- ==========================================================================
--
-- La première phrase dit « une année scolaire », la troisième dit « les
-- classes ». Il n'y a pas de contradiction à lever, parce qu'il n'y a pas
-- d'entité « année scolaire » dans ce modèle et qu'il n'en faut pas une : une
-- session EST une classe pour une année (level_code + year_start), et l'année
-- ne vit nulle part ailleurs — c'est écrit depuis le palier 001.
--
-- La colonne va donc sur `sessions`, et ce choix est le SEUL des deux qui
-- n'enferme rien :
--   • Une colonne sur la classe sait exprimer « toute l'année 2026-2027 est
--     au collège X » — il suffit que les classes de cette année portent la
--     même valeur. L'écran peut l'appliquer d'un geste si le besoin vient.
--   • Une table (année → établissement) ne saurait PAS exprimer l'inverse —
--     un enseignant partagé entre deux établissements la même année, ce qui
--     est le cas même où le réglage sert (une 4ᵉ ici, une 3ᵉ là-bas, deux
--     usages locaux qui ne désactivent pas les mêmes compétences).
-- Le plus général des deux se replie sur l'autre ; l'inverse est faux. On
-- prend le plus général.
--
-- ⚠ CE QUI RESTE À TRANCHER, ET QUI N'EST PAS DANS CE PALIER : si le nom de
-- l'établissement DE LA CLASSE doit remplacer `app_settings.school_name` en
-- tête des PDF. Ce palier ne change AUCUN document imprimé — `school_name`
-- reste la seule source de l'en-tête, exactement comme la veille. Un bilan
-- réimprimé après migration porte le même nom qu'avant, au caractère près.
-- Changer cela se voit sur des documents déjà remis à des familles, donc
-- c'est à l'auteur de le dire, pas au code de le deviner.
--
-- ==========================================================================
-- NULL VEUT DIRE « COMME AVANT », PARTOUT
-- ==========================================================================
--
-- `sessions.establishment_id IS NULL` = la classe n'est rattachée à rien :
-- aucune compétence désactivée, aucun réglage local, l'en-tête des PDF reste
-- `school_name`. C'est l'état de TOUTE base migrée, et c'est exactement le
-- comportement d'avant le palier — la table naît vide et rien n'est deviné.
--
-- Deviner l'établissement à partir de `app_settings.school_name` aurait été
-- tentant : il y a souvent un nom là-dedans. Mais le créer d'office
-- rattacherait toutes les classes passées à un établissement que l'enseignant
-- n'a pas nommé, et la première chose qu'il verrait serait un réglage qu'il
-- n'a pas posé sur des classes qu'il n'a pas touchées. Même refus qu'au palier
-- 022 (« toute case vierge reste en attente ») et qu'au palier 024 (« deviner
-- le domaine d'une fiche à partir de la phrase qu'elle porte »). `school_name`
-- reste donc ce qu'il est, et il n'est NI lu NI vidé NI supprimé par ce palier.
--
-- ==========================================================================
-- LA DÉSACTIVATION EST UN FILTRE DE SAISIE, JAMAIS UN MASQUE SUR DES NOTES
-- ==========================================================================
--
-- « Désactiver une compétence » veut dire : ne plus me la PROPOSER quand je
-- compose une évaluation ou une étape de progression dans une classe de cet
-- établissement. Cela ne veut PAS dire :
--   • supprimer la compétence — elle appartient au référentiel, et un autre
--     établissement l'emploie ;
--   • l'archiver — `competencies.archived_at` existe depuis le palier 001 et
--     vaut pour TOUTE la base ; c'est le geste global, celui-ci est local ;
--   • retirer les notes déjà saisies — elles restent dans `grades`, comptées
--     exactement comme avant. Une note qui existe encore mais que plus aucun
--     écran n'affiche est la panne qu'on ne voit pas (palier 023, même mot).
--
-- Conséquence tenue par les écrans et non par le schéma : une compétence
-- désactivée qui est DÉJÀ rattachée à une évaluation ou à une étape continue
-- de s'afficher, cochée, avec sa note. Le filtre ne retire que ce qui n'est
-- pas encore choisi. `get_evaluation_competencies` et `COMPETENCES_DES_ETAPES`
-- ne consultent donc pas cette table : ils lisent des FAITS.
--
-- ==========================================================================
-- LES SORTS DE SUPPRESSION
-- ==========================================================================
--
-- ⚠ IRRÉVERSIBLE — une action ON DELETE ne se change pas par ALTER TABLE.
--
--   • SET NULL sur `sessions.establishment_id` — c'est un RÉGLAGE, le même
--     partage qu'au palier 023 entre le fait et le réglage. Perdre le
--     rattachement rend la classe à l'état d'avant le palier : lisible,
--     corrigible, et aucun chiffre ne bouge. Un établissement supprimé par
--     erreur se recrée et se repose ; une classe, non.
--   • CASCADE sur les deux colonnes de `establishment_disabled_competencies`
--     — une ligne de cette table n'est rien d'autre que le lien entre ses
--     deux bouts ; sans l'un ou l'autre elle ne veut rien dire, et la laisser
--     derrière serait exactement le BLOB orphelin du palier 012. Côté
--     compétence, c'est aussi ce qui permet à `delete_node` de continuer de ne
--     compter QUE ce qui compte : des notes, des évaluations, des étapes, des
--     déclarations. Un réglage local n'empêche pas une suppression de
--     référentiel, il la suit.
--
-- `delete_establishment` compte donc les classes AVANT de supprimer et le dit
-- — comme `delete_activity_node` au palier 024 : la suppression ne refuse
-- jamais, donc l'écran doit annoncer son prix. Ne pas confondre avec
-- `delete_student_group`, qui refuse : là, les séances tenues sont des faits.
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 1/3 — Les établissements. Livrés VIDES, comme `professional_fields`,
--       `progression_domaines` et `student_need_tags` : c'est le vocabulaire
--       de l'enseignant, personne d'autre ne connaît le nom de son collège.
-- ---------------------------------------------------------------------------
CREATE TABLE establishments (
    id         TEXT PRIMARY KEY,

    -- « Collège Jean Moulin », « SEGPA Les Tilleuls »… Non vide et borné à
    -- 120 signes EN RUST, comme `student_groups.name` et
    -- `agenda_entries.category` : un CHECK refuserait en anglais ce que la
    -- commande refuse en français, et ne se retire pas en SQLite. 120 et non
    -- 40 : un nom d'établissement officiel est long.
    name       TEXT NOT NULL,

    -- L'ordre d'affichage, et il est LU — même raison que pour
    -- `student_groups` : trier par nom est un ordre, pas le bon. L'enseignant
    -- met en premier celui où il est le plus.
    position   INTEGER NOT NULL DEFAULT 0,

    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Deux établissements de même nom sont une confusion, pas un choix :
-- l'enseignant désactiverait des compétences dans l'un en croyant les
-- désactiver dans l'autre. COLLATE NOCASE pour la même raison que
-- `student_groups` — un établissement est une ENTITÉ qu'on désigne, pas une
-- étiquette libre qu'on retape comme `agenda_entries.category`. Limite connue
-- et identique : le NOCASE de SQLite ne replie que l'ASCII, donc « École » et
-- « école » passeraient ; la commande compare elle aussi, pour rendre un
-- message français plutôt qu'une erreur SQLite brute.
CREATE UNIQUE INDEX ux_establishments_name
    ON establishments(name COLLATE NOCASE);
CREATE INDEX ix_establishments_position ON establishments(position, name);

-- ---------------------------------------------------------------------------
-- 2/3 — Le rattachement de la classe. NULL = comme avant le palier.
-- ---------------------------------------------------------------------------
ALTER TABLE sessions ADD COLUMN establishment_id TEXT NULL
    REFERENCES establishments(id) ON DELETE SET NULL;
CREATE INDEX ix_sessions_establishment ON sessions(establishment_id);

-- ---------------------------------------------------------------------------
-- 3/3 — Les compétences que cet établissement n'emploie pas.
--
--       Une table de rattachement, et ici elle est justifiée là où celle des
--       groupes ne l'était pas (palier 023) : une compétence EST désactivée
--       dans plusieurs établissements à la fois, et un établissement en
--       désactive plusieurs. La relation est n à n pour de vrai.
--
--       Pas de colonne `position` : l'ordre d'affichage est celui du
--       référentiel, exactement comme pour `progression_etape_competences` au
--       palier 021. Une compétence déplacée dans Réglages se déplace partout
--       d'un coup.
-- ---------------------------------------------------------------------------
CREATE TABLE establishment_disabled_competencies (
    establishment_id TEXT NOT NULL
        REFERENCES establishments(id) ON DELETE CASCADE,
    competency_id    TEXT NOT NULL
        REFERENCES competencies(id) ON DELETE CASCADE,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (establishment_id, competency_id)
);

-- La lecture qui compte est « quelles compétences cet établissement
-- désactive-t-il », servie par la clé primaire. L'index inverse sert le
-- compteur de Réglages (« désactivée dans 2 établissements »), qui dit à
-- l'enseignant qu'une compétence invisible ici est visible ailleurs.
CREATE INDEX ix_edc_competency
    ON establishment_disabled_competencies(competency_id);
