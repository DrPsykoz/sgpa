-- ===========================================================================
-- 19/20 — timetable_slots. LE CRÉNEAU EST UN MODÈLE HEBDOMADAIRE, jamais un
--         cours. Aucune séance n'est engendrée d'office : c'est ce qui rend
--         l'application indifférente aux vacances et aux fériés, et ce qui
--         protège le dénominateur d'assiduité — une séance qui existe compte,
--         et un clic de curiosité sur une date passée imprimerait 92 % au lieu
--         de 100 % sur le bilan de la famille.
--
--         PAS de colonne kind : le type se déduit de la cible. session_id
--         renseigné = un cours ; NULL = une occupation sans classe. Une colonne
--         kind serait une seconde source de vérité capable de contredire la
--         première (kind='cours' avec session_id NULL).
-- ===========================================================================
CREATE TABLE timetable_slots (
    id          TEXT    PRIMARY KEY,

    -- L'année vit sur le créneau : un modèle hebdomadaire n'a pas de date d'où
    -- la déduire. Elle est validée en Rust contre sessions.year_start —
    -- rien n'empêche ici un créneau 2026 de désigner une classe de 2024.
    year_start  INTEGER NOT NULL CHECK (year_start BETWEEN 2000 AND 2100),

    -- ⚠ IRRÉVERSIBLE — une action ON DELETE ne se change pas par ALTER TABLE.
    -- CASCADE et non SET NULL : un créneau de cours pour une classe qui
    -- n'existe plus n'a aucun sens, et laisserait un fantôme dans la grille que
    -- l'enseignant devrait supprimer à la main. Rien d'historique ne part :
    -- seances.slot_id est en SET NULL et les séances partent déjà en cascade de
    -- la session.
    session_id  TEXT    NULL REFERENCES sessions(id) ON DELETE CASCADE,

    -- Exigé EN RUST pour tout créneau, y compris de cours : c'est lui qui donne
    -- son titre à la séance créée depuis le créneau (clean_title refuse le
    -- vide, seances.rs). PAS de CHECK ici — voir la note « le piège » ci-après.
    label       TEXT    NOT NULL DEFAULT '',
    room        TEXT    NOT NULL DEFAULT '',

    weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),   -- ISO, 1 = lundi

    -- ⚠ IRRÉVERSIBLE (CHECK : pas de DROP CONSTRAINT en SQLite).
    -- Le GLOB seul laisse passer '29:00' — VÉRIFIÉ, l'insertion réussit. La
    -- comparaison lexicographique le referme (les deux chaînes font 5 signes).
    start_time  TEXT    NOT NULL
                CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]' AND start_time <= '23:59'),
    end_time    TEXT    NOT NULL
                CHECK (end_time   GLOB '[0-2][0-9]:[0-5][0-9]' AND end_time   <= '23:59'),

    -- ⚠ IRRÉVERSIBLE (CHECK). Quinzaine : voir §3. PAS de lettres A/B —
    -- elles exigeraient une convention de parité que personne n'a tranchée.
    -- 'paires'/'impaires' se vérifient sur n'importe quel calendrier et ne
    -- demandent aucun réglage, donc aucune documentation.
    week_parity TEXT    NOT NULL DEFAULT 'toutes'
                CHECK (week_parity IN ('toutes', 'paires', 'impaires')),

    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),

    CHECK (start_time < end_time)
);
CREATE INDEX ix_slots_year_day ON timetable_slots(year_start, weekday, start_time);
CREATE INDEX ix_slots_session  ON timetable_slots(session_id);   -- sert la cascade

-- ===========================================================================
-- 20/20 — agenda_entries. L'ENTRÉE DATÉE : elle n'est pas un modèle, ELLE EST
--         l'occurrence, et porte son contenu elle-même.
--
--         INVARIANT QUI SÉPARE CETTE TABLE DE LA 19 :
--           une entrée datée est TOUJOURS ouvrable ;
--           un créneau ne l'est que s'il désigne une classe — et il faut alors
--           fabriquer l'occurrence.
--
--         AUCUNE ligne d'ici n'entre dans seances, donc jamais dans le
--         SUM(cancelled = 0) de commands/reports.rs:154 : pas une requête de
--         bilan ne change. Un kind sur seances aurait imposé d'ajouter
--         « AND kind = 'cours' » à chaque comptage, et l'oubli aurait gonflé
--         un dénominateur en silence.
--
--         PAS de colonne kind, PAS de location/contact, PAS de session_id :
--         VÉRIFIÉ, tous s'ajoutent plus tard par ALTER TABLE ADD COLUMN, CHECK
--         et clé étrangère compris, et l'action ON DELETE posée par l'ALTER est
--         vivante. Le titre porte la catégorie tant qu'un second exemple réel
--         n'existe pas.
-- ===========================================================================
CREATE TABLE agenda_entries (
    id           TEXT PRIMARY KEY,

    date         TEXT NOT NULL
                 CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),

    -- '' = « heure à caler » : l'entrée s'affiche en bandeau du jour, hors
    -- grille horaire. Sans cette tolérance, une visite notée à la volée serait
    -- impossible à saisir tant que l'heure n'est pas connue.
    start_time   TEXT NOT NULL DEFAULT ''
                 CHECK (start_time = '' OR (start_time GLOB '[0-2][0-9]:[0-5][0-9]' AND start_time <= '23:59')),
    end_time     TEXT NOT NULL DEFAULT ''
                 CHECK (end_time   = '' OR (end_time   GLOB '[0-2][0-9]:[0-5][0-9]' AND end_time   <= '23:59')),

    title        TEXT NOT NULL,            -- non vide exigé en Rust

    -- ⚠ IRRÉVERSIBLE (action ON DELETE). CASCADE par cohérence VÉRIFIÉE avec
    -- tout ce qui est nominatif : grades, attendance_records, report_comments,
    -- contract_sheet_students partent déjà avec l'élève. SET NULL ferait de ce
    -- rapport le seul survivant d'une suppression d'élève — l'exception la
    -- moins défendable du schéma. Prix assumé : delete_student doit COMPTER et
    -- ANNONCER l'impact (commande prévue au lot 7).
    student_id   TEXT NULL REFERENCES students(id) ON DELETE CASCADE,

    content_html TEXT NOT NULL DEFAULT '', -- même machinerie que le cahier de texte

    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_agenda_date    ON agenda_entries(date, start_time);
CREATE INDEX ix_agenda_student ON agenda_entries(student_id, date DESC);  -- fiche élève

-- ===========================================================================
-- seances : la partie VRAIMENT irréversible du palier. timetable_slots est la
-- table la moins chère du schéma à reconstruire (une douzaine de lignes, aucune
-- valeur historique) ; seances est la plus chère (des milliers de lignes,
-- attendance_records en enfant). Tout ce qui la concerne doit être juste
-- maintenant.
--
-- VÉRIFIÉ : ADD COLUMN accepte un CHECK et la contrainte est ACTIVE ensuite
-- (insertion de '29:00' refusée) ; il accepte REFERENCES … ON DELETE SET NULL
-- et l'action est vivante (créneau supprimé -> slot_id NULL, appel intact).
-- ===========================================================================
ALTER TABLE seances ADD COLUMN slot_id TEXT NULL
    REFERENCES timetable_slots(id) ON DELETE SET NULL;
-- SET NULL est SANS DANGER ici, contrairement à timetable_slots.session_id :
-- slot_id n'apparaît dans aucun CHECK. Supprimer un créneau ne détruit jamais
-- un appel et ne fait échouer aucune suppression.

-- L'horaire appartient au dossier historique, pas au modèle : il est RECOPIÉ à
-- la création. '' = séance hors créneau, ou antérieure au palier.
ALTER TABLE seances ADD COLUMN start_time TEXT NOT NULL DEFAULT ''
    CHECK (start_time = '' OR (start_time GLOB '[0-2][0-9]:[0-5][0-9]' AND start_time <= '23:59'));
ALTER TABLE seances ADD COLUMN end_time   TEXT NOT NULL DEFAULT ''
    CHECK (end_time   = '' OR (end_time   GLOB '[0-2][0-9]:[0-5][0-9]' AND end_time   <= '23:59'));

-- ⚠ LE POINT LE PLUS IRRÉVERSIBLE DU PALIER. Un index se crée à tout moment —
-- celui-ci non : posé au palier 005, il échouerait sur les doublons entrés
-- d'ici là (VÉRIFIÉ : « UNIQUE constraint failed: seances.slot_id, seances.date »)
-- et il faudrait demander à l'enseignant lequel de deux appels garder.
-- Deux séances le même jour pour la même classe restent légales : slot_id NULL
-- n'entre pas dans l'index (VÉRIFIÉ).
CREATE UNIQUE INDEX ux_seances_slot_date ON seances(slot_id, date)
    WHERE slot_id IS NOT NULL;
