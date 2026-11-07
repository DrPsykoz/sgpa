-- ============================================================================
-- SGPA — schéma v2, palier 001
--
-- RÈGLE D'OR : un palier livré n'est JAMAIS modifié. Toute évolution ultérieure
-- passe par un nouveau fichier 0NN_*.sql et une entrée dans migrations::STEPS.
-- ============================================================================

-- 1/18 — app_settings. Ligne unique typée. REMPLACE la table users.
--        Le cloisonnement des données n'est plus une colonne, c'est le fichier :
--        une clé USB, une base, un enseignant. Le mot de passe est un verrou
--        d'écran, pas un système d'identification.
CREATE TABLE app_settings (
    id                        INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash             TEXT    NULL,               -- bcrypt ; NULL = premier lancement
    teacher_display_name      TEXT    NOT NULL DEFAULT '',
    school_name               TEXT    NOT NULL DEFAULT '',   -- en-tête des PDF
    lock_timeout_minutes      INTEGER NOT NULL DEFAULT 15 CHECK (lock_timeout_minutes BETWEEN 1 AND 120),
    lock_on_minimize          INTEGER NOT NULL DEFAULT 1  CHECK (lock_on_minimize IN (0, 1)),
    password_hint             TEXT    NOT NULL DEFAULT '',   -- jamais la réponse

    -- Règle de la moyenne générale. Changer de règle = UPDATE d'une ligne + une
    -- fonction dans reports/scoring.rs, JAMAIS une migration.
    -- Livrée « en attente » : la valeur ci-dessous était un emplacement tenu.
    -- ARRÊTÉE AU PALIER 015 — c'est lui qu'il faut lire, pas cette ligne.
    overall_average_rule      TEXT    NOT NULL DEFAULT 'unweighted_mean'
                              CHECK (overall_average_rule IN ('unweighted_mean', 'weighted_by_count')),

    -- Que faire des notes d'une compétence retirée d'une évaluation.
    -- 'keep'   : les notes survivent et restent comptées (comportement livré)
    -- 'ignore' : les notes survivent mais sortent des moyennes
    -- Livrée « en attente » sur 'keep', emplacement tenu lui aussi.
    -- ARRÊTÉE AU PALIER 015, qui bascule sur 'ignore'. La valeur par défaut
    -- ci-dessous reste celle qui a été LIVRÉE : un palier ne se réécrit pas, et
    -- 015 rattrape aussi bien une base neuve qu'une base déjà en service.
    removed_competency_policy TEXT    NOT NULL DEFAULT 'keep'
                              CHECK (removed_competency_policy IN ('keep', 'ignore')),

    last_backup_at            TEXT    NULL,
    created_at                TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at                TEXT    NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO app_settings (id) VALUES (1);

-- 2/18 — trimester_bounds. Bornes CONTIGUËS : le début de T2 est la fin de T1.
--        Une table (année, trimestre, début, fin) autoriserait un trou — une
--        séance dans aucun trimestre — et un chevauchement. Ici c'est inexprimable.
CREATE TABLE trimester_bounds (
    year_start INTEGER PRIMARY KEY CHECK (year_start BETWEEN 2000 AND 2100),
    t1_start   TEXT NOT NULL CHECK (t1_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    t2_start   TEXT NOT NULL CHECK (t2_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    t3_start   TEXT NOT NULL CHECK (t3_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    year_end   TEXT NOT NULL CHECK (year_end GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (t1_start < t2_start AND t2_start < t3_start AND t3_start <= year_end)
);

-- 3/18 — professional_fields. Perd user_id, devient globale, donc UNIQUE possible.
CREATE TABLE professional_fields (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL UNIQUE,
    position INTEGER NOT NULL DEFAULT 0
);

-- 4/18 — cycles
CREATE TABLE cycles (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 5/18 — domains
CREATE TABLE domains (
    id         TEXT PRIMARY KEY,
    cycle_id   TEXT NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_domains_cycle ON domains(cycle_id, position, name);

-- 6/18 — fields
CREATE TABLE fields (
    id         TEXT PRIMARY KEY,
    domain_id  TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_fields_domain ON fields(domain_id, position, name);

-- 7/18 — competencies. archived_at est la réponse de repli à la question des
--        compétences retirées : la suppression dure devient impossible dès qu'une
--        note existe (RESTRICT en tables 13 et 14), l'enseignant archive, les
--        notes survivent.
--        PAS de UNIQUE(field_id, name) : un collage de 30 lignes ne doit pas
--        échouer en bloc sur un doublon. La déduplication est faite en Rust, qui
--        peut dire lesquelles ont été ignorées.
CREATE TABLE competencies (
    id          TEXT PRIMARY KEY,
    field_id    TEXT NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    archived_at TEXT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_competencies_field ON competencies(field_id, position, name);

-- 8/18 — sessions. Une session EST une classe pour une année scolaire donnée.
--        year_start INTEGER et non « 2021-2022 » : tri correct sans parsing,
--        année suivante = +1, et l'appartenance d'une date se teste directement.
CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    level_code TEXT NOT NULL CHECK (level_code IN ('6eme', '5eme', '4eme', '3eme', '3eme_prepa')),
    year_start INTEGER NOT NULL CHECK (year_start BETWEEN 2000 AND 2100),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_sessions_year ON sessions(year_start DESC, name);

-- 9/18 — students. enrolled_on / left_on : sans eux, « absent » et « pas encore
--        inscrit » sont indiscernables, et le dénominateur d'assiduité d'un élève
--        arrivé en janvier est faux.
--        Valeur par défaut à la création = t1_start de l'année de la session,
--        JAMAIS date('now') — sinon tous les élèves saisis en novembre seraient
--        réputés absents de septembre à octobre.
CREATE TABLE students (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    first_name  TEXT NOT NULL,
    last_name   TEXT NOT NULL,
    enrolled_on TEXT NOT NULL CHECK (enrolled_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    left_on     TEXT NULL     CHECK (left_on IS NULL OR left_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (left_on IS NULL OR left_on >= enrolled_on)
);
CREATE INDEX ix_students_session ON students(session_id, last_name, first_name);

-- 10/18 — seances. end_date SUPPRIMÉE (écrite, recopiée, jamais lue).
--         date est NOT NULL : sans date, pas de trimestre.
--         cancelled : une sortie scolaire ou un jour férié reste au cahier de
--         texte mais sort des statistiques d'assiduité — sinon elle déclencherait
--         le signal « appel non fait » pour toute la classe.
CREATE TABLE seances (
    id                  TEXT PRIMARY KEY,
    session_id          TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    date                TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    trimester           INTEGER NOT NULL CHECK (trimester IN (1, 2, 3)),
    trimester_is_manual INTEGER NOT NULL DEFAULT 0 CHECK (trimester_is_manual IN (0, 1)),
    cancelled           INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0, 1)),
    content_html        TEXT NOT NULL DEFAULT '',
    attendance_taken_at TEXT NULL,     -- NULL = l'appel n'a jamais été fait
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_seances_session_date ON seances(session_id, date DESC);
CREATE INDEX ix_seances_session_trim ON seances(session_id, trimester);

-- 11/18 — attendance_records. L'uuid id disparaît : jamais lu côté front, et
--         set_attendance en générait un à chaque clic pour rien.
--         DEUX niveaux de « non fait », volontairement :
--           seances.attendance_taken_at IS NULL → l'appel n'a pas été fait ce jour-là
--           ligne absente OU status='non_fait'  → cet élève-là n'est pas renseigné
CREATE TABLE attendance_records (
    seance_id   TEXT NOT NULL REFERENCES seances(id)  ON DELETE CASCADE,
    student_id  TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    status      TEXT NOT NULL CHECK (status IN ('non_fait', 'present', 'absent', 'retard', 'excuse')),
    recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (seance_id, student_id)
);
CREATE INDEX ix_attendance_student ON attendance_records(student_id);

-- 12/18 — evaluations. school_year SUPPRIMÉE : le niveau ET l'année viennent
--         désormais de la session. Même couple auto/manuel que seances.
CREATE TABLE evaluations (
    id                  TEXT PRIMARY KEY,
    session_id          TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    date                TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    trimester           INTEGER NOT NULL CHECK (trimester IN (1, 2, 3)),
    trimester_is_manual INTEGER NOT NULL DEFAULT 0 CHECK (trimester_is_manual IN (0, 1)),
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_evaluations_session ON evaluations(session_id, trimester, date DESC);

-- 13/18 — evaluation_competencies. RESTRICT au lieu de CASCADE : avant, supprimer
--         une compétence détruisait en cascade les liens PUIS les notes, sans que
--         la confirmation le mentionne. Désormais SQLite refuse et la commande
--         traduit en « utilisée par N évaluation(s) — l'archiver ? ».
CREATE TABLE evaluation_competencies (
    evaluation_id TEXT NOT NULL REFERENCES evaluations(id)  ON DELETE CASCADE,
    competency_id TEXT NOT NULL REFERENCES competencies(id) ON DELETE RESTRICT,
    position      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (evaluation_id, competency_id)
);
CREATE INDEX ix_evalcomp_competency ON evaluation_competencies(competency_id);

-- 14/18 — grades. L'uuid id disparaît (le front insérait littéralement id:"" dans
--         son optimistic update) ; comment aussi (lue par le struct, jamais écrite,
--         aucune UI).
--         TROIS FK SIMPLES, pas de FK composite différée : evaluation_id →
--         evaluations en CASCADE est ce qui rend delete_evaluation possible.
--         L'ordre de la PK met (evaluation_id, competency_id) en préfixe, ce dont
--         update_evaluation a besoin pour repérer les notes devenues orphelines.
--         level reste 0..5 : changer d'échelle avant de savoir combien de niveaux
--         elle doit compter, ce serait trancher deux fois.
CREATE TABLE grades (
    evaluation_id TEXT NOT NULL REFERENCES evaluations(id)  ON DELETE CASCADE,
    competency_id TEXT NOT NULL REFERENCES competencies(id) ON DELETE RESTRICT,
    student_id    TEXT NOT NULL REFERENCES students(id)     ON DELETE CASCADE,
    level         INTEGER NOT NULL CHECK (level BETWEEN 0 AND 5),   -- 0 = non évalué
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (evaluation_id, competency_id, student_id)
);
CREATE INDEX ix_grades_student    ON grades(student_id, competency_id);
CREATE INDEX ix_grades_competency ON grades(competency_id);   -- requis par le RESTRICT

-- 15/18 — contract_sheets. evaluation_id GARDE son UNIQUE : la trame reste commune
--         (un projet = une trame), l'individualisation est additive (table 17).
--         Le champ professionnel était stocké par son NOM : un renommage
--         orphelinait silencieusement toutes les fiches déjà saisies. Désormais
--         FK + libellé figé au moment de la saisie.
CREATE TABLE contract_sheets (
    id                       TEXT PRIMARY KEY,
    evaluation_id            TEXT NOT NULL UNIQUE REFERENCES evaluations(id) ON DELETE CASCADE,
    project_title            TEXT NOT NULL DEFAULT '',
    professional_field_id    TEXT NULL REFERENCES professional_fields(id) ON DELETE SET NULL,
    professional_field_label TEXT NOT NULL DEFAULT '',
    socle_domain             TEXT NOT NULL DEFAULT '',
    reference_activities     TEXT NOT NULL DEFAULT '',
    target_careers           TEXT NOT NULL DEFAULT '',
    given_text               TEXT NOT NULL DEFAULT '',
    asked_text               TEXT NOT NULL DEFAULT '',
    required_text            TEXT NOT NULL DEFAULT '',
    created_at               TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 16/18 — contract_sheet_rows. row_order → position : un seul vocabulaire d'ordre
--         dans tout le schéma. L'id doit rester STABLE d'un enregistrement à
--         l'autre : save_contract_sheet supprimait tout puis réinsérait avec de
--         nouveaux uuid, ce qui détruira le travail des élèves dès que quoi que ce
--         soit référencera ces lignes.
CREATE TABLE contract_sheet_rows (
    id                     TEXT PRIMARY KEY,
    contract_sheet_id      TEXT NOT NULL REFERENCES contract_sheets(id) ON DELETE CASCADE,
    position               INTEGER NOT NULL DEFAULT 0,
    student_activity       TEXT NOT NULL DEFAULT '',
    training_activity      TEXT NOT NULL DEFAULT '',
    socle_domain_label     TEXT NOT NULL DEFAULT '',
    socle_competency_label TEXT NOT NULL DEFAULT ''
);
CREATE INDEX ix_contract_rows_sheet ON contract_sheet_rows(contract_sheet_id, position);

-- 17/18 — contract_sheet_students. Couche additive : la trame n'est jamais
--         dupliquée, seul ce qui est propre à l'élève vit ici. Absence de ligne =
--         fiche non attribuée. Imprimer « toute la classe » n'exige AUCUNE ligne
--         ici : c'est le cas dégénéré, gratuit.
--         La maquette définitive est attendue ; ces colonnes sont le socle minimal
--         qu'aucune des variantes envisagées ne remet en cause.
CREATE TABLE contract_sheet_students (
    contract_sheet_id TEXT NOT NULL REFERENCES contract_sheets(id) ON DELETE CASCADE,
    student_id        TEXT NOT NULL REFERENCES students(id)        ON DELETE CASCADE,
    role_text         TEXT NOT NULL DEFAULT '',   -- poste / rôle dans le projet
    teacher_note      TEXT NOT NULL DEFAULT '',   -- appréciation nominative
    issued_at         TEXT NULL,
    completed_at      TEXT NULL,
    PRIMARY KEY (contract_sheet_id, student_id)
);
CREATE INDEX ix_contract_students_student ON contract_sheet_students(student_id);

-- 18/18 — report_comments. school_year DISPARAÎT : un élève appartient à une seule
--         session, qui porte un seul niveau et une seule année ; (student_id,
--         trimester) est donc déjà une clé complète. Le CHECK manquant est ajouté :
--         avant, rien n'empêchait d'écrire trimester = 7.
CREATE TABLE report_comments (
    student_id      TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    trimester       INTEGER NOT NULL CHECK (trimester IN (1, 2, 3)),
    teacher_comment TEXT NOT NULL DEFAULT '',
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (student_id, trimester)
);
