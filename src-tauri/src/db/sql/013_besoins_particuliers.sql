-- ==========================================================================
-- SGPA — palier 013 : besoins particuliers des élèves
--
-- Un élève peut être dysorthographique, dyscalculique, accompagné d'une AESH,
-- suivre un PAP ou un PPS. L'enseignant a besoin de le voir au moment où il
-- note, où il fait l'appel, où il lit sa classe — pas d'aller le chercher dans
-- un dossier.
--
-- TROIS CHOIX STRUCTURANTS, et chacun répond à une question posée à l'auteur.
--
-- 1. LE VOCABULAIRE APPARTIENT À L'ENSEIGNANT. `student_need_tags` est
--    volontairement VIDE à la livraison, comme `professional_fields`. Semer
--    « Dyslexie, Dyscalculie, AESH, PAP, PPS » paraîtrait serviable et serait
--    faux : les libellés exacts viennent des notifications MDPH et des PAP de
--    SON établissement, et une étiquette approchante recopiée dans un document
--    de travail est une erreur qu'on ne voit pas passer. Il saisit ses
--    étiquettes une fois, elles resservent pour toute la classe.
--
-- 2. RIEN DE TOUT CECI NE S'IMPRIME. Décision explicite de l'auteur, à la
--    question « sur quels documents imprimés faire figurer ces informations ? » :
--    « Jamais ». Ce sont des données de santé concernant des mineurs ; un bilan
--    trimestriel remis à une famille, une fiche contrat, une liste d'appel
--    sortie sur papier et oubliée en salle des profs n'ont aucune raison de les
--    porter. Les écrans les montrent, `commands/reports.rs` et `src/lib/pdf.ts`
--    ne les lisent pas. **Ce n'est pas une omission : ajouter ces colonnes à
--    une projection de bilan serait un bug.**
--
-- 3. LES BESOINS VIVENT SUR LA LIGNE `students`, DONC SUR UN COUPLE
--    CLASSE × ANNÉE. Un élève suivi en 4ᵉ A puis en 3ᵉ A est deux lignes
--    `students` dans ce modèle, et ses étiquettes ne suivent pas d'une année
--    sur l'autre : il faut les reposer. C'est assumé. Les faire suivre
--    demanderait une identité d'élève transversale aux années, c'est-à-dire un
--    autre modèle de données — pour épargner trois clics en septembre.
--    Le vocabulaire, lui, est global : c'est la partie qui coûtait du travail.
--
-- La note libre (`students.needs_note`) complète les étiquettes sans les
-- remplacer. Une étiquette se compte et se filtre, une note porte ce qui ne se
-- range pas : « tiers temps sur les évaluations écrites », « lit mieux en
-- Arial 14 ». Les deux ensemble, parce que l'un sans l'autre forcerait à
-- fabriquer une étiquette par cas particulier, et la liste d'étiquettes
-- deviendrait illisible.
-- ==========================================================================

-- Le vocabulaire de l'enseignant. Aucune ligne n'est semée ici.
CREATE TABLE student_need_tags (
    id    TEXT PRIMARY KEY,

    -- Le libellé complet, tel qu'il s'écrit dans un PAP : « Dysorthographie ».
    label TEXT NOT NULL,

    -- L'abréviation qui tient dans une pastille à côté d'un nom, dans une
    -- grille de notation où chaque colonne est comptée : « Dys-o ». `''` = pas
    -- d'abréviation, et l'écran affiche alors le libellé complet. Le front ne
    -- tronque JAMAIS tout seul : « Dys » pour « Dyscalculie » et « Dys » pour
    -- « Dysorthographie » seraient la même pastille pour deux troubles qui ne
    -- demandent pas les mêmes aménagements.
    short_label TEXT NOT NULL DEFAULT '',

    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Insensible à la casse : « AESH » retapé « Aesh » doit retrouver l'étiquette
-- existante, pas en créer une seconde. Même raison que pour
-- `professional_fields.name`, et même traitement côté Rust — on rend
-- l'étiquette trouvée au lieu de refuser.
CREATE UNIQUE INDEX ux_student_need_tags_label
    ON student_need_tags(label COLLATE NOCASE);

-- Quel élève porte quelle étiquette. Clé primaire composite : une étiquette ne
-- se pose qu'une fois sur un élève, et c'est le schéma qui le garantit plutôt
-- qu'un test côté commande.
CREATE TABLE student_needs (
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    tag_id     TEXT NOT NULL REFERENCES student_need_tags(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (student_id, tag_id)
);

-- Sens de lecture réel : « les étiquettes de cet élève ». La clé primaire
-- couvre déjà ce sens ; cet index-ci couvre l'autre, « quels élèves portent
-- cette étiquette », dont a besoin la suppression d'une étiquette pour dire
-- combien d'élèves elle concerne avant d'effacer.
CREATE INDEX ix_student_needs_tag ON student_needs(tag_id);

-- La note libre. `''` = rien à signaler, jamais NULL : une colonne qui a deux
-- façons de dire « vide » finit par être testée d'une seule des deux.
ALTER TABLE students ADD COLUMN needs_note TEXT NOT NULL DEFAULT '';
