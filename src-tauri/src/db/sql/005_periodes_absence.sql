-- ===========================================================================
-- 21/21 — absence_periods. LA PÉRIODE PENDANT LAQUELLE UNE SÉANCE DE LA CLASSE
--         NE COMPTE NI COMME PRÉSENCE NI COMME ABSENCE.
--
--         LE CHIFFRE QU'ELLE CORRIGE, mesuré : un élève parti trois semaines en
--         stage sur un trimestre de 26 séances sortait à 20/26 = 77 % sur le
--         bilan remis à sa famille — QUOI QUE l'enseignant coche. Vérifié :
--         `absent`, `excuse` ou rien ne changeaient que le libellé, jamais le
--         pourcentage, ATTENDANCE_SQL (commands/reports.rs) ne connaissant que
--         enrolled_on / left_on. L'élève était exactement là où on l'avait
--         envoyé, et l'injustice était imprimée.
--
--         PAS de table `stages`. students.enrolled_on / left_on a déjà tranché
--         la question : la bonne unité de ce schéma est LA PÉRIODE, pas le
--         motif. Stage, hospitalisation, exclusion temporaire et départ
--         anticipé produisent exactement le même faux chiffre ; une seule table
--         les sert tous, et aucune colonne n'affirme quoi que ce soit du
--         fonctionnement des stages en SEGPA — sujet sur lequel rien n'est
--         confirmé. Le motif est un texte libre : il distingue les cas à
--         l'écran, et AUCUN calcul ne s'appuie dessus.
--
--         CE QUE LA TABLE NE FAIT PAS : elle ne crée ni ne supprime aucune
--         séance. Les séances du stage restent au cahier de texte, avec leur
--         contenu et leurs appels ; seule leur entrée dans le dénominateur
--         d'assiduité de l'élève visé est retirée. C'est la différence avec
--         seances.cancelled, qui retire la séance pour TOUTE la classe.
-- ===========================================================================
CREATE TABLE absence_periods (
    id         TEXT NOT NULL PRIMARY KEY,

    -- ⚠ IRRÉVERSIBLE — une action ON DELETE ne se change pas par ALTER TABLE.
    -- CASCADE : une période sans sa classe n'écarte plus rien, les séances
    -- qu'elle visait partant déjà avec la session.
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

    -- NULL = TOUTE LA CLASSE. Une table, deux usages, demandés tous les deux :
    -- le stage collectif (la classe entière) et le cas d'un seul élève —
    -- hospitalisation, stage annulé pour lui, départ anticipé.
    --
    -- ⚠ IRRÉVERSIBLE. CASCADE, surtout PAS SET NULL : SET NULL transformerait
    -- en silence l'hospitalisation d'un élève supprimé en absence de TOUTE la
    -- classe, et fausserait le bilan de tous les autres. Ce serait le bug que
    -- ce palier corrige, à l'envers et sans un mot.
    student_id TEXT NULL REFERENCES students(id) ON DELETE CASCADE,

    -- « Stage en entreprise », « Hospitalisation »… Non vide exigé EN RUST,
    -- comme timetable_slots.label et agenda_entries.title : un CHECK ne se
    -- retire pas en SQLite, et il bloquerait une reprise de données là où la
    -- commande, elle, se corrige en une ligne.
    reason     TEXT NOT NULL,

    -- ⚠ IRRÉVERSIBLE (CHECK : pas de DROP CONSTRAINT en SQLite). Mêmes GLOB que
    -- students.enrolled_on : c'est cette forme, et elle seule, qui rend
    -- légitimes les comparaisons de dates lexicographiques de tout le projet —
    -- `se.date BETWEEN p.start_date AND p.end_date` en est une.
    start_date TEXT NOT NULL
               CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    end_date   TEXT NOT NULL
               CHECK (end_date   GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- Égalité permise : une journée seule est une période d'un jour, et c'est
    -- la saisie la plus courante pour une hospitalisation.
    CHECK (start_date <= end_date)
);

-- UN SEUL index, et il sert les DEUX requêtes du palier :
--
--   * l'exclusion d'assiduité — le NOT EXISTS corrélé de ATTENDANCE_SQL, évalué
--     une fois par couple (élève, séance) : égalité sur session_id, contrainte
--     de rang sur start_date, puis end_date et student_id lus DANS l'index,
--     donc sans aucun accès à la table. VÉRIFIÉ au plan de requête, qui
--     l'annonce en « COVERING INDEX ix_absence_periods_session » ;
--
--   * l'écran de saisie — « les périodes de cette classe, par date » est
--     exactement le préfixe (session_id, start_date). VÉRIFIÉ au plan de
--     requête : seul le tri d'égalité sur le nom de l'élève passe par une table
--     temporaire, sur une poignée de lignes.
--
-- PAS de second index sur student_id pour servir sa cascade, contrairement à
-- ix_slots_session : cette table se comptera en dizaines de lignes pour toute
-- la vie de la base. Un parcours complet à la suppression d'un élève — action
-- rare et déjà confirmée — coûte moins cher qu'un index à tenir à jour à chaque
-- écriture. La cascade de session_id, elle, est servie par le préfixe ci-dessus.
CREATE INDEX ix_absence_periods_session
    ON absence_periods(session_id, start_date, end_date, student_id);
