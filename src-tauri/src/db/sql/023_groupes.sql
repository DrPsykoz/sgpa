-- ==========================================================================
-- SGPA — palier 023 : les groupes d'élèves dans une classe
--
-- DEMANDE DE L'AUTEUR, le 2026-11-12 : « Pouvoir ajouter un système de groupe
-- 1 et groupe 2 dans les classes, pour pouvoir faire les évaluations sur les
-- deux groupes facilement. Prendre en compte les stages et absences et
-- l'emploi du temps pour les groupes, pouvoir définir groupe 1 pour semaine A
-- et groupe 2 semaine B par exemple. »
--
-- Il a tranché deux points le même jour, et ce sont eux qui donnent sa forme
-- au palier :
--   1. AUTANT DE GROUPES QUE VOULU, librement nommés — pas deux, pas une
--      colonne `groupe INTEGER CHECK (groupe IN (1, 2))`. Un atelier cuisine,
--      un atelier bois, un groupe de besoin : le vocabulaire appartient à
--      l'enseignant, comme les domaines de progression et les champs
--      professionnels. D'où une TABLE et non une valeur.
--   2. UN ÉLÈVE N'APPARTIENT QU'À UN SEUL GROUPE. D'où une COLONNE sur
--      `students`, et non une table de rattachement : une table n+n aurait
--      permis d'écrire ce que le modèle interdit, et chaque lecture aurait eu
--      à redécider quoi faire d'un élève présent deux fois.
--
-- ==========================================================================
-- CE QUE LE PALIER N'A PAS EU À FAIRE, ET POURQUOI IL EST BON MARCHÉ
-- ==========================================================================
--
-- « GROUPE 1 SEMAINE A, GROUPE 2 SEMAINE B » NE DEMANDE RIEN DE NEUF. Le
-- schéma le permettait déjà et personne ne l'avait vu : `timetable_slots` n'a
-- jamais porté d'unicité sur (weekday, start_time), et `week_parity` existe
-- depuis le palier 004. Deux groupes au même horaire sont donc DEUX CRÉNEAUX
-- de parité complémentaire, un groupe chacun — et la porte qui les crée
-- existe depuis la révision de `SlotDialog` (« Un autre cours à cet
-- horaire », qui prérègle justement la parité complémentaire). Le groupe est
-- un attribut du créneau, pas une seconde dimension de la grille.
--
-- CONSÉQUENCE DIRECTE : `ux_seances_slot_date UNIQUE(slot_id, date)` RESTE
-- VALIDE. Le SQL du palier 004 la décrit comme « le point le plus
-- irréversible du palier », et la contourner aurait imposé de reconstruire
-- `seances` — copie de table, en production, sur des bases qui contiennent le
-- cahier de texte de l'année. Un créneau portant UN groupe, deux groupes ne
-- demandent jamais deux séances du même créneau le même jour : ils demandent
-- deux créneaux. Rien à reconstruire.
--
-- RIEN N'EST MIGRÉ, ET C'EST LA GARANTIE QUI COMPTE. Les cinq colonnes
-- ajoutées naissent toutes à NULL, et NULL signifie partout « comme avant » :
-- un élève sans groupe est concerné par tout, une séance sans groupe convoque
-- toute la classe, une évaluation sans groupe note toute la classe, un
-- créneau sans groupe est le cours de toute la classe, une période d'absence
-- sans groupe vise qui elle visait déjà. Une base migrée se comporte
-- exactement comme la veille, au chiffre près — y compris les bilans
-- d'assiduité déjà imprimés, dont le test de migration vérifie qu'ils ne
-- bougent pas d'une unité.
--
-- ==========================================================================
-- LES DEUX SENS DE « SANS GROUPE », QUI NE SONT PAS LE MÊME
-- ==========================================================================
--
-- Ils vont dans des directions opposées, délibérément, et toute la justesse
-- du calcul d'assiduité tient à cette asymétrie :
--
--   • `seances.group_id IS NULL`   → la séance convoque TOUTE la classe.
--   • `students.group_id IS NULL`  → l'élève est convoqué à TOUTES les
--     séances, y compris celles d'un groupe nommé.
--   • `absence_periods.group_id IS NULL` → la période vise qui elle vise
--     déjà (toute la classe, ou l'élève nommé).
--   • Mais un élève SANS groupe n'est PAS couvert par une période qui vise
--     UN groupe nommé : il n'est pas dedans.
--
-- Pourquoi l'élève sans groupe garde toutes ses séances plutôt que de n'avoir
-- que celles de la classe entière : parce que l'élève sans groupe est le plus
-- souvent un OUBLI, pas une décision. L'enseignant crée ses deux groupes en
-- novembre, inscrit un nouvel élève en janvier et ne pense pas à le ranger.
-- Le faire disparaître des séances de groupe le retirerait en silence des
-- appels et des bilans — c'est exactement le défaut que corrigeait le palier
-- 006 (« une case disparue passerait pour un créneau perdu »). Le faire
-- apparaître partout est visible, corrigible, et ne coûte qu'un `non_fait`
-- que l'écran signale déjà. L'écran avertit en plus, en toutes lettres, quand
-- une classe a des groupes et des élèves qui n'en ont aucun.
--
-- Et pourquoi, à l'inverse, il n'est pas couvert par une période de groupe :
-- parce qu'une période RETIRE des séances du dénominateur. Un oubli de
-- rangement ne doit jamais excuser une absence par accident. Les deux
-- défauts possibles sont asymétriques, donc les deux règles le sont aussi :
-- chacune penche du côté où l'erreur se voit.
--
-- ==========================================================================
-- L'ASSIDUITÉ : UN QUATRIÈME SEAU, ET SURTOUT PAS UN SEAU EXISTANT
-- ==========================================================================
--
-- `reports::ATTENDANCE_SQL` imprime un invariant : jusqu'ici
--   applicable + hors_inscription + neutralisees == seances_trimestre
-- et `hors_inscription` n'est PAS calculé, il est le RESTE
-- (`seance_count - applicable - neutralisees`, `load_attendance`).
--
-- Une séance tenue avec l'autre groupe doit sortir du dénominateur de
-- l'élève. Si elle sortait seulement du `LEFT JOIN`, elle retomberait
-- mécaniquement dans le reste, et le bilan remis à la famille dirait « hors
-- de sa période d'inscription » d'un enfant inscrit toute l'année. Si on la
-- rangeait dans `neutralisees`, il dirait « pendant une absence justifiée »
-- d'un enfant qui n'était pas absent. Les deux phrases sont fausses, et une
-- phrase fausse sur un document remis à une famille est le défaut que ce
-- projet refuse le plus.
--
-- D'où `seances_autre_groupe`, quatrième terme, avec sa propre phrase (« avec
-- un autre groupe, non comptabilisée ») à l'écran comme au PDF. L'invariant
-- devient :
--   applicable + hors_inscription + neutralisees + autre_groupe
--     == seances_trimestre
-- et la partition reste exacte parce que les quatre termes se lisent dans un
-- ordre de priorité fixé :
--   ¬inscrit                       → hors_inscription  (le reste)
--   inscrit ∧ autre groupe         → autre_groupe
--   inscrit ∧ son groupe ∧ écartée → neutralisees
--   inscrit ∧ son groupe ∧ sinon   → applicable
--
-- LE GROUPE PASSE DONC AVANT LA NEUTRALISATION : une séance de l'autre groupe
-- pendant le stage de l'élève est comptée « autre groupe », une seule fois.
-- Elle ne lui a pas été retirée par son stage, elle ne lui était pas
-- destinée. C'est le même geste que « hospitalisation pendant un stage
-- comptée une fois », avec un terme de plus.
--
-- ⚠ LE FILTRE DE GROUPE SE LIT AUX TROIS POINTS, OU À AUCUN — exactement
-- l'avertissement que le palier 020 a écrit pour `attendance_expected`, avec
-- une branche de plus : le `LEFT JOIN`, la sous-requête `neutralisees` et la
-- nouvelle sous-requête `autre_groupe`. N'en servir que deux casse
-- l'invariant en silence, et le défaut est invisible sur toute base où
-- personne n'a créé de groupe — c'est-à-dire sur toute base migrée. Le test
-- `une_base_v22_peuplee_traverse_le_palier_023_intacte` le tient en posant
-- des groupes sur une base déjà peuplée et en vérifiant que la somme des
-- quatre termes retombe sur le compte de séances du trimestre.
--
-- ==========================================================================
-- LES SORTS DE SUPPRESSION, QUI NE SONT PAS TOUS LES MÊMES
-- ==========================================================================
--
-- ⚠ IRRÉVERSIBLE — une action ON DELETE ne se change pas par ALTER TABLE.
--
-- Deux rôles, donc deux sorts, et ce n'est pas l'incohérence que le palier
-- 016 s'interdisait (là, c'étaient DEUX LIGNES DE LA MÊME TABLE ; ici, ce
-- sont des tables qui ne disent pas la même chose) :
--
--   • SET NULL sur `students.group_id`, `timetable_slots.group_id` et
--     `absence_periods.group_id` — ce sont des RÉGLAGES. Perdre le groupe
--     rend l'élève, le créneau ou la période à toute la classe : l'état
--     d'avant le palier, lisible et corrigible.
--
--   • RESTRICT sur `seances.group_id` et `evaluations.group_id` — ce sont des
--     FAITS. Cette séance-là a eu lieu avec ce groupe-là, et son bilan
--     d'assiduité en dépend ; cette évaluation-là a noté ces élèves-là. Les
--     rendre rétroactivement « toute la classe » changerait des chiffres déjà
--     imprimés sans qu'une ligne ne le dise. `delete_student_group` compte
--     donc AVANT de supprimer et refuse en français, comme `delete_node` pour
--     une compétence et comme le refus de supprimer un domaine employé.
--
-- Le geste qui reste à l'enseignant quand un groupe est devenu intouchable
-- est le RENOMMAGE, qui est libre et qui ne ment sur rien : le groupe est le
-- même ensemble d'élèves, il change de nom. Réorganiser les groupes en
-- janvier se fait en créant les nouveaux, pas en effaçant les anciens — les
-- séances de novembre ont bien eu lieu avec ceux de novembre.
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 1/6 — La table des groupes.
-- ---------------------------------------------------------------------------
CREATE TABLE student_groups (
    id         TEXT PRIMARY KEY,

    -- ⚠ IRRÉVERSIBLE. CASCADE : un groupe appartient à UNE classe d'UNE année
    -- scolaire, comme ses élèves. Le même « Groupe 1 » en 4ᵉ et en 3ᵉ est deux
    -- lignes, exactement comme le même enfant y est deux `students` (limite
    -- assumée, déjà écrite pour les besoins particuliers au palier 013).
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

    -- « Groupe 1 », « Atelier cuisine », « Gr A »… Non vide et borné à 40
    -- signes EN RUST, comme `timetable_slots.label` et
    -- `agenda_entries.category` : un CHECK refuserait en anglais ce que la
    -- commande refuse en français, et ne se retire pas en SQLite.
    name       TEXT NOT NULL,

    -- L'ordre d'affichage, et il est LU — contrairement à celui de
    -- `progression_etape_competences`, qui n'en a volontairement pas. Un
    -- groupe n'a aucun ordre naturel : trier par nom mettrait « Groupe 10 »
    -- avant « Groupe 2 », et l'ordre des clics n'est pas celui de l'atelier.
    position   INTEGER NOT NULL DEFAULT 0,

    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Deux groupes de même nom dans la même classe sont une confusion, pas un
-- choix : l'enseignant rangerait des élèves dans l'un en croyant les ranger
-- dans l'autre. COLLATE NOCASE parce que « Groupe 1 » et « groupe 1 » sont le
-- même groupe — c'est l'inverse du choix fait pour `agenda_entries.category`
-- au palier 020, et pour une raison : une catégorie est une étiquette libre
-- qu'on retape, un groupe est une entité qu'on désigne. Limite connue : le
-- NOCASE de SQLite ne replie que l'ASCII, donc « Été » et « été » passeraient.
-- La commande compare elle aussi, pour rendre un message français plutôt
-- qu'une erreur SQLite brute.
CREATE UNIQUE INDEX ux_student_groups_session_name
    ON student_groups(session_id, name COLLATE NOCASE);
CREATE INDEX ix_student_groups_session ON student_groups(session_id, position);

-- ---------------------------------------------------------------------------
-- 2/6 — L'appartenance de l'élève. NULL = aucun groupe = convoqué partout.
-- ---------------------------------------------------------------------------
ALTER TABLE students ADD COLUMN group_id TEXT NULL
    REFERENCES student_groups(id) ON DELETE SET NULL;
CREATE INDEX ix_students_group ON students(group_id);

-- ---------------------------------------------------------------------------
-- 3/6 — Le créneau hebdomadaire. NULL = le cours de toute la classe.
--
-- C'est ici que vit « groupe 1 semaine A, groupe 2 semaine B » : deux
-- créneaux au même horaire, `week_parity` complémentaire, un `group_id`
-- chacun. Rien d'autre n'était nécessaire.
-- ---------------------------------------------------------------------------
ALTER TABLE timetable_slots ADD COLUMN group_id TEXT NULL
    REFERENCES student_groups(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 4/6 — La séance. NULL = toute la classe est convoquée.
--
-- Une séance née d'un créneau COPIE le groupe du créneau à sa création, et ne
-- le relit jamais ensuite — même raison que `start_time` / `end_time`, copiés
-- eux aussi depuis le palier 004 : `seances.slot_id` est en SET NULL, le
-- créneau peut être supprimé ou changer de groupe, et la séance de mardi
-- dernier doit continuer de dire avec qui elle a eu lieu.
-- ---------------------------------------------------------------------------
ALTER TABLE seances ADD COLUMN group_id TEXT NULL
    REFERENCES student_groups(id) ON DELETE RESTRICT;
CREATE INDEX ix_seances_group ON seances(group_id);

-- ---------------------------------------------------------------------------
-- 5/6 — L'évaluation. NULL = toute la classe est notée.
--
-- C'est la demande littérale (« faire les évaluations sur les deux groupes
-- facilement ») : la grille n'affiche alors que les élèves du groupe, et le
-- compte de complétude de l'accueil prend le même dénominateur — sans quoi
-- une évaluation de groupe serait réclamée pour toujours, l'accueil attendant
-- des notes pour des élèves qui n'étaient pas là.
-- ---------------------------------------------------------------------------
ALTER TABLE evaluations ADD COLUMN group_id TEXT NULL
    REFERENCES student_groups(id) ON DELETE RESTRICT;
CREATE INDEX ix_evaluations_group ON evaluations(group_id);

-- ---------------------------------------------------------------------------
-- 6/6 — La période d'absence. Une TROISIÈME portée, entre les deux existantes.
--
-- « Prendre en compte les stages […] pour les groupes » : en SEGPA, les
-- groupes partent en stage en alternance, et c'est le cas qui a motivé la
-- colonne. La portée d'une période se lit donc maintenant ainsi :
--     student_id NON NULL                       → cet élève
--     group_id   NON NULL                       → les élèves de ce groupe
--     les deux NULL                             → toute la classe
--
-- ⚠ L'ORDRE DES `ALTER` DE CE FICHIER N'EST PAS INTERCHANGEABLE, pour la même
-- raison qu'au palier 020 : SQLite n'ajoute pas de contrainte de TABLE par
-- ALTER, donc ce CHECK est porté par la colonne et cite ses deux voisines,
-- qui doivent exister. `teacher_absent` est venue au palier 020, `student_id`
-- au palier 005 : les deux sont là. Mais si un palier futur déplace cette
-- ligne, il casse la migration de tout le monde.
--
-- Les deux impossibilités que le CHECK redit :
--   • Un groupe ET un élève — redondant au mieux, contradictoire au pire
--     (l'élève nommé n'étant pas forcément de ce groupe). La commande refuse
--     déjà en français ; le CHECK est là pour l'appelant futur.
--   • Un groupe ET une absence du professeur — le professeur n'est pas absent
--     pour un groupe. Quand il manque, il manque à tous ceux qu'il devait
--     avoir, et `create_teacher_absence_periods` pose déjà une ligne par
--     classe sans paramètre d'élève : elle n'en prend pas non plus de groupe.
-- ---------------------------------------------------------------------------
ALTER TABLE absence_periods ADD COLUMN group_id TEXT NULL
    REFERENCES student_groups(id) ON DELETE SET NULL
    CHECK (group_id IS NULL OR (student_id IS NULL AND teacher_absent = 0));
