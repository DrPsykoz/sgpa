-- ===========================================================================
-- 22/22 — stage_placements. UN ÉLÈVE, UNE ENTREPRISE, UN INTERVALLE CONTINU.
--
--         CE QU'ELLE CORRIGE, mesuré : la période de classe « Stage en
--         entreprise » du 18/01 au 05/02 sort ses 6 séances du dénominateur de
--         TOUS les élèves — y compris de ceux qui sont assis dans l'atelier. Un
--         élève qui n'a pas trouvé, resté au collège et absent 5 de ces
--         6 séances, sort à 19/20 = 95 % au lieu de 20/26 = 77 %, et ses cinq
--         absences, pointées à la main, DISPARAISSENT ENTIÈREMENT du bilan
--         remis à sa famille : la séance ne rejoint pas l'élève dans le
--         LEFT JOIN, donc l'appel ne rejoint rien non plus. C'est la fraction
--         du palier 005 imprimée À L'ENVERS — et dans le sens que personne ne
--         conteste, puisqu'il flatte.
--
--         LA RÈGLE QUE CETTE TABLE INSTALLE : une séance sort du dénominateur
--         d'un élève parce que CET élève-là était en entreprise CE jour-là, pas
--         parce que sa classe était en stage cette semaine-là. Une
--         absence_periods qui porte au moins un placement DE SA CLASSE — et, si
--         elle est nominative, DE SON ÉLÈVE — cesse d'écarter pour toute la
--         classe et laisse ses placements décider, élève par élève ; une
--         période sans placement garde exactement le comportement de 005.
--         L'appartenance n'est pas un détail : sans elle, un placement rattaché
--         par erreur à l'hospitalisation d'un autre élève désarme celle-ci et
--         fait réapparaître ses absences justifiées en absences sèches. La
--         clause est dans ATTENDANCE_SQL (commands/reports.rs), le garde-fou de
--         saisie qui la double reste à écrire en Rust au lot 2.
--
--         CE QUE LA TABLE NE FAIT PAS : elle ne remplace pas absence_periods et
--         n'en crée aucune. La période de stage reste la ligne que l'enseignant
--         saisit déjà — aucune conversion, aucun bandeau de migration, et sur
--         une base sans le moindre placement pas un pourcentage ne bouge.
--         Elle ne pointe PAS non plus la présence EN entreprise : un jour de
--         stage n'est jamais compté contre l'élève, et l'échappatoire est de
--         raccourcir le placement.
--
--         PLUSIEURS PLACEMENTS PAR ÉLÈVE ET PAR PÉRIODE, et c'est le cas réel
--         qui l'impose : « renvoyé, lui réattribuer une nouvelle entreprise »
--         décrit littéralement deux placements dans une même fenêtre. Écraser
--         l'entreprise sur une ligne unique perdrait trois choses
--         irrécupérables : que l'élève était chez Durand du 18 au 22, que ça
--         s'est mal fini, et le compte rendu de la visite qu'on y avait faite.
--
--         PAS de colonne is_current, PAS de colonne status : le placement
--         courant est celui dont start_date est la plus grande, et « en stage /
--         terminé » sont des comparaisons de dates. Une colonne serait la
--         seconde source de vérité capable de contredire la première, que
--         004_emploi_du_temps.sql a déjà refusée pour timetable_slots.kind.
-- ===========================================================================
CREATE TABLE stage_placements (
    id                TEXT NOT NULL PRIMARY KEY,

    -- ⚠ IRRÉVERSIBLE — une action ON DELETE ne se change pas par ALTER TABLE.
    -- CASCADE, et PAS RESTRICT. VÉRIFIÉ : absence_periods.session_id est en
    -- CASCADE (005_periodes_absence.sql), et delete_session
    -- (commands/sessions.rs) n'est qu'un « DELETE FROM sessions » nu. Avec un
    -- RESTRICT ici, supprimer une classe qui porte un seul placement échouerait
    -- sur « FOREIGN KEY constraint failed » — la phrase brute de SQLite, en
    -- anglais, à l'écran d'un enseignant. La protection du travail réel se fait
    -- DANS LA COMMANDE, qui compte les placements et le dit avant de supprimer.
    --
    -- ⚠ CETTE COMMANDE N'EST PAS ENCORE ÉCRITE, et il faut le dire ici plutôt
    -- que de le découvrir : delete_absence_period (commands/absences.rs) est un
    -- « DELETE FROM absence_periods » nu, et le dialogue de confirmation du
    -- front affirme mot pour mot « Aucune séance, aucun appel et aucun cahier de
    -- texte n'est touché » — vrai, mais muet sur les placements, qui partent
    -- TOUS, et sur les visites, dont le rattachement passe à NULL sans retour
    -- possible. Mesuré : une période portant un placement et une visite
    -- rédigée → 0 placement, agenda_entries.stage_placement_id à NULL, compte
    -- rendu conservé mais orphelin. Non atteignable tant qu'aucune commande ne
    -- sait CRÉER un placement ; à livrer avec elles, au lot 2, et c'est le geste
    -- QUOTIDIEN (« je me suis trompé de dates, je refais la période »), pas un
    -- geste rare.
    absence_period_id TEXT NOT NULL REFERENCES absence_periods(id) ON DELETE CASCADE,

    -- ⚠ IRRÉVERSIBLE. CASCADE, comme tout ce qui est nominatif : grades,
    -- attendance_records, report_comments et agenda_entries partent déjà avec
    -- l'élève. Prix à payer, et il se paie ailleurs :
    -- get_student_deletion_impact (commands/students.rs) gagne un compteur et
    -- la confirmation l'annonce.
    student_id        TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,

    -- L'ENTREPRISE, EN TEXTE, SUR LE PLACEMENT. Pas de table companies dans ce
    -- palier : une quinzaine d'élèves, deux ou trois périodes par an, soit une
    -- trentaine de lignes. 004_emploi_du_temps.sql a VÉRIFIÉ qu'une clé
    -- étrangère s'ajoute plus tard par ALTER TABLE ADD COLUMN et que son
    -- ON DELETE est vivant ensuite : le carnet d'entreprises est donc
    -- reportable SANS reconstruction de table.
    -- Non vide exigé EN RUST, comme absence_periods.reason.
    company_label     TEXT NOT NULL,

    -- Ce qu'il faut pour ALLER À LA VISITE, et rien d'autre. Une seule zone
    -- d'adresse, jamais découpée en rue / code postal / ville : on y va en
    -- voiture, on ne la trie pas. Téléphone en TEXT et JAMAIS numérique —
    -- « 06 12 34 56 78 (atelier) » doit passer.
    -- PAS de SIRET, PAS de numéro de convention, PAS de rattachement à
    -- professional_fields (table volontairement vide) : vocabulaire non
    -- confirmé par l'auteur.
    company_address   TEXT NOT NULL DEFAULT '',
    company_contact   TEXT NOT NULL DEFAULT '',   -- nom neutre : tuteur ? référent ?
    company_phone     TEXT NOT NULL DEFAULT '',

    -- ⚠ IRRÉVERSIBLE (CHECK : pas de DROP CONSTRAINT en SQLite). Mêmes GLOB que
    -- students.enrolled_on et absence_periods.start_date : c'est cette forme,
    -- et elle seule, qui rend légitime le BETWEEN lexicographique du bilan.
    --
    -- end_date EST LA DATE PRÉVUE TANT QUE LE STAGE COURT, et devient LE
    -- DERNIER JOUR RÉELLEMENT PASSÉ EN ENTREPRISE dès qu'il s'arrête — c'est
    -- cette correction-là que le formulaire doit rendre évidente. Le jour où
    -- l'enseignant saisit le placement, le dernier jour réellement passé
    -- n'existe pas encore : exiger autre chose qu'une date prévue rendrait la
    -- saisie impossible.
    --
    -- PAS d'échappatoire à '' ici, à l'inverse d'agenda_entries.start_time
    -- (« heure à caler ») : un end_date vide casserait le BETWEEN
    -- lexicographique du bilan, qui est toute la valeur de ce GLOB. Le prix est
    -- nul — les séances neutralisées d'avance sont dans le futur, aucun bilan
    -- ne les imprime avant que l'enseignant n'ait corrigé la date.
    --
    -- D'un stage INTERROMPU, end_date est le dernier jour où l'élève y était,
    -- jamais le jour où l'entreprise appelle : c'est la seule date dont dépend
    -- tout le calcul, et le libellé du formulaire doit le dire en toutes
    -- lettres.
    start_date        TEXT NOT NULL
                      CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    end_date          TEXT NOT NULL
                      CHECK (end_date   GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),

    -- '' = le stage est allé au bout, ou court toujours. Non vide = il s'est
    -- arrêté avant, et le texte dit pourquoi, DANS LES MOTS DE L'ENSEIGNANT.
    --
    -- ⚠ IRRÉVERSIBLE si on le posait : PAS de CHECK IN ('renvoi', 'abandon', …)
    -- ici. Ce serait inventer du vocabulaire réglementaire et le figer À VIE,
    -- un CHECK ne se retirant pas en SQLite. Prix assumé : aucune statistique
    -- sur les renvois ne sera jamais possible. Troisième cas du même traitement
    -- qu'absence_periods.reason, timetable_slots.label et agenda_entries.title :
    -- contenu libre, AUCUN calcul dessus, et rien de tout cela ne s'imprime sur
    -- un bilan.
    --
    -- LE RENVOI N'EST PAS UN ÉTAT : c'est end_date, plus ce mot. Le calcul n'a
    -- besoin que de la date.
    end_reason        TEXT NOT NULL DEFAULT '',

    notes             TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),

    -- ⚠ IRRÉVERSIBLE (CHECK). Égalité permise : un stage d'observation d'une
    -- journée est une période d'un jour, exactement comme l'hospitalisation de
    -- 005_periodes_absence.sql.
    CHECK (start_date <= end_date)
);

-- Sert le NOT EXISTS du bilan — évalué une fois par couple (élève, séance) —,
-- la vérification de chevauchement entre deux placements du même élève, et la
-- cascade de student_id.
-- VÉRIFIÉ au plan de requête : « SEARCH stage_placements USING COVERING INDEX
-- ix_stage_placements_student (student_id=? AND start_date<?) » — aucun accès à
-- la table elle-même.
CREATE INDEX ix_stage_placements_student
    ON stage_placements(student_id, start_date, end_date);

-- Sert « cette période porte-t-elle un suivi de stage ? » — le NOT EXISTS
-- imbriqué qui désarme une période dès qu'elle porte un placement —, l'écran de
-- suivi, le compteur affiché sur la ligne de la période, et la cascade de
-- absence_period_id. VÉRIFIÉ : « COVERING INDEX ix_stage_placements_period
-- (absence_period_id=?) » — student_id est dans l'index, donc la vérification
-- d'appartenance ci-dessous ne le dé-couvre pas.
CREATE INDEX ix_stage_placements_period
    ON stage_placements(absence_period_id, student_id);

-- ⚠ CE PALIER DÉ-COUVRE ix_absence_periods_session, et le commentaire de
-- 005_periodes_absence.sql qui annonce « COVERING INDEX » est donc devenu FAUX
-- — on ne touche pas un palier livré, on le dit ici. Plan relu, pas supposé :
--   v5, ASSIDUITE_005    → « SEARCH absence_periods AS p USING COVERING INDEX
--                            ix_absence_periods_session »
--   v6, ATTENDANCE_SQL   → « … USING INDEX … », sans COVERING, aux deux sondes.
-- Cause : le NOT EXISTS imbriqué lit p.id, absent de
-- ix_absence_periods_session(session_id, start_date, end_date, student_id) —
-- id est une TEXT PRIMARY KEY, donc pas le rowid. Chaque couple (élève, séance)
-- paie désormais un accès à la table absence_periods, plus une recherche
-- sqlite_autoindex_students_1 (id=?) par placement rattaché pour la
-- vérification d'appartenance. Coût ASSUMÉ : ces deux tables se comptent en
-- dizaines de lignes. Un index de remplacement (…, student_id, id) ne se
-- justifie pas à cette volumétrie.

-- ---------------------------------------------------------------------------
-- La visite reste une agenda_entry : c'est ce qui évite d'écrire un calendrier,
-- la grille de la semaine l'affichant déjà gratuitement (ENTREES_DE_LA_PERIODE,
-- commands/timetable.rs, ne filtre que sur la date).
--
-- 004_emploi_du_temps.sql avait préparé le terrain mot pour mot : « VÉRIFIÉ,
-- tous s'ajoutent plus tard par ALTER TABLE ADD COLUMN, CHECK et clé étrangère
-- compris, et l'action ON DELETE posée par l'ALTER est vivante. »
--
-- ⚠ IRRÉVERSIBLE. SET NULL et NON CASCADE, à l'inverse de student_id sur cette
-- même table : là, le parent EST la personne ; ici, la personne existe
-- toujours. Corriger une entreprise mal choisie — supprimer, ressaisir — ne
-- doit jamais détruire un compte rendu déjà rédigé. Mot pour mot le
-- raisonnement de seances.slot_id.
--
-- POURQUOI LA COLONNE PLUTÔT QUE LE LIEN IMPLICITE PAR (élève, date) : après un
-- renvoi, le lien implicite devient FAUX. Une visite du 28/01 chez Durand,
-- laissée au calendrier alors que l'élève est passé chez Bertrand le 25,
-- s'afficherait avec la mauvaise entreprise et la mauvaise adresse — donc
-- l'enseignant irait à la mauvaise porte.
--
-- Le garde-fou « le placement désigné appartient au MÊME élève que l'entrée »
-- est en Rust : sans lui, une visite sur Hugo afficherait l'entreprise de Léa.
-- Comme update_agenda_entry_meta refuse déjà de changer l'élève d'une entrée,
-- le couple reste valide à vie.
ALTER TABLE agenda_entries ADD COLUMN stage_placement_id TEXT NULL
    REFERENCES stage_placements(id) ON DELETE SET NULL;

-- Index PARTIEL, comme ux_seances_slot_date : l'immense majorité des entrées
-- datées n'est pas une visite de stage, et la partie NULL ne mérite pas d'être
-- tenue à jour à chaque écriture. Il sert le parcours du SET NULL et « les
-- visites de ce placement, par date ».
CREATE INDEX ix_agenda_placement ON agenda_entries(stage_placement_id, date)
    WHERE stage_placement_id IS NOT NULL;
