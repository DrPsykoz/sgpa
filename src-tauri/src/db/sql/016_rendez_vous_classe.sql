-- ==========================================================================
-- SGPA — palier 016 : la classe d'un rendez-vous
--
-- Un conseil de classe, une réunion parents-professeurs, un bilan de fin de
-- trimestre concernent une CLASSE, et la base ne savait pas le dire. Le seul
-- rattachement possible était un ÉLÈVE, ce qui donnait deux travers :
-- l'enseignant devait choisir dans une liste de tous les élèves de toutes les
-- classes pour trouver celui qui l'intéressait, et pour un conseil de classe il
-- ne pouvait rien choisir du tout. La classe se retrouvait alors recopiée à la
-- main dans l'intitulé (« Conseil de classe 4ème A »), donc écrite en deux
-- graphies dès le deuxième trimestre, et jamais regroupable.
--
-- UNE COLONNE, NULLABLE, ET ELLE RESTE FACULTATIVE.
--
-- `session_id` est NULL par défaut : aucune entrée déjà saisie ne change de
-- sens en traversant ce palier, et un rendez-vous sans classe demeure une
-- saisie parfaitement valide — une ESS, un rendez-vous de médecine scolaire,
-- une formation ne concernent aucune classe. La colonne ajoute une précision
-- possible ; elle n'impose pas une taxonomie, et c'est la même retenue que
-- l'absence de colonne `kind` sur cette table.
--
-- L'ORDRE EST CLASSE PUIS ÉLÈVE, ET LA CLASSE SE DÉDUIT DE L'ÉLÈVE.
--
-- Un élève appartient à exactement une session (`students.session_id` est NOT
-- NULL) : quand une entrée désigne un élève, sa classe n'est donc pas une
-- seconde information mais la même, et c'est le Rust qui la recopie au moment
-- de l'INSERT. Les deux colonnes ne peuvent pas se contredire parce qu'aucun
-- appelant n'est autorisé à les écrire séparément — et un couple
-- contradictoire reçu de l'interface est REFUSÉ, pas rectifié en silence : une
-- rectification muette masquerait le défaut d'écran qui l'a produite.
--
-- Comme `student_id`, la colonne n'est écrite qu'à la création :
-- `update_agenda_entry_meta` ne la touche pas. Un compte rendu rédigé sur le
-- conseil de la 4ème A ne doit pas pouvoir devenir celui de la 3ème B, pour le
-- mot à mot du raisonnement qui rend l'élève immuable.
--
-- ⚠ IRRÉVERSIBLE (action ON DELETE). CASCADE et non SET NULL, et ce n'est pas
-- une préférence : supprimer une classe emporte ses élèves, donc emporte DÉJÀ
-- ses rendez-vous nominatifs par le CASCADE de `student_id`. Un SET NULL ici
-- laisserait survivre le conseil de classe et pas la visite de stage après le
-- même geste — deux sorts différents pour deux lignes de la même table, dont
-- aucun écran ne saurait rendre compte. Et un « Conseil de classe » dont la
-- classe a disparu ne désigne plus rien : il serait le seul survivant d'une
-- suppression, l'exception que le palier 004 nommait déjà « la moins
-- défendable du schéma ».
-- ==========================================================================

ALTER TABLE agenda_entries ADD COLUMN session_id TEXT NULL
    REFERENCES sessions(id) ON DELETE CASCADE;

-- Index PARTIEL, comme ix_agenda_placement : beaucoup d'entrées ne nommeront
-- aucune classe, et la partie NULL n'a pas à être tenue à jour à chaque
-- écriture. Il sert le parcours du CASCADE et « les rendez-vous de cette
-- classe, par date ».
CREATE INDEX ix_agenda_session ON agenda_entries(session_id, date DESC)
    WHERE session_id IS NOT NULL;

-- Reprise des entrées déjà saisies : celles qui désignent un élève connaissent
-- déjà leur classe, elles ne savaient simplement pas l'écrire. Les autres
-- restent à NULL — deviner la classe d'une réunion d'après son intitulé serait
-- inventer une donnée, et l'inventer juste une fois sur deux.
UPDATE agenda_entries
   SET session_id = (SELECT st.session_id FROM students st
                      WHERE st.id = agenda_entries.student_id)
 WHERE student_id IS NOT NULL;
