-- ==========================================================================
-- SGPA — palier 028 : l'académie se règle par établissement
--
-- DEMANDE DE L'AUTEUR, le 2026-11-14 : « l'académie serait donc gérée par
-- établissement et non plus au global dans l'application », avec une vraie
-- page « Établissements » dans le menu.
--
-- ARBITRAGE DE L'AUTEUR, le même jour : le calendrier (vacances, jours fermés)
-- reste UN seul pour toute l'application — une colonne de jour fermée l'est
-- pour toutes les classes —, et c'est l'académie de l'établissement dit
-- « principal » qui le fixe. Les autres établissements portent la leur à titre
-- d'information. Vacances propres à chaque classe : non retenu, c'est une
-- refonte des trois calendriers.
--
-- PURE ADDITION. `app_settings.academie` n'est NI vidée NI supprimée : elle
-- reste la **valeur de repli** quand aucun établissement principal ne porte
-- d'académie, donc une base sans établissement se comporte exactement comme la
-- veille. Rien ne s'écrit non plus dans `app_settings` depuis ce palier — son
-- écran a disparu de Réglages, la valeur transite inchangée à chaque
-- enregistrement des réglages.
--
-- DEUX COLONNES, nées « comme avant » :
--   academie     — '' = non renseignée ;
--   is_principal — 0 ; au plus un 1, tenu par l'index partiel ci-dessous.
--
-- RECOPIE UNIQUE, et c'est la seule écriture du palier : si l'enseignant avait
-- choisi une académie ET déjà créé des établissements, le premier d'entre eux
-- (ordre de la liste) la reçoit et devient principal. Le calendrier affiché ne
-- bouge donc pas d'un jour. Sans établissement, ou sans académie choisie, rien
-- n'est écrit.
-- ==========================================================================

ALTER TABLE establishments ADD COLUMN academie TEXT NOT NULL DEFAULT '';
ALTER TABLE establishments ADD COLUMN is_principal INTEGER NOT NULL DEFAULT 0
    CHECK (is_principal IN (0, 1));

CREATE UNIQUE INDEX ux_establishments_principal
    ON establishments (is_principal) WHERE is_principal = 1;

UPDATE establishments
   SET academie     = (SELECT academie FROM app_settings WHERE id = 1),
       is_principal = 1
 WHERE id = (SELECT id FROM establishments ORDER BY position, name LIMIT 1)
   AND (SELECT academie FROM app_settings WHERE id = 1) <> '';
