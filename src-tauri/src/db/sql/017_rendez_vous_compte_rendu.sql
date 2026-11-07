-- ==========================================================================
-- SGPA — palier 017 : le compte rendu d'un rendez-vous, comme un cahier de texte
--
-- Un rendez-vous passe par le même éditeur qu'une séance, et l'accueil le
-- réclame dans « À reprendre » par la même règle — un corps vide, et le rappel
-- tombe. Il lui manquait les deux seules sorties que la séance possède depuis
-- les paliers 012 et 014 :
--
--   * une pièce jointe. Le rapport de visite arrive signé par le tuteur, le
--     compte rendu d'ESS arrive scanné : le document EST le compte rendu, et
--     réclamer en plus deux lignes tapées n'apporterait rien. C'est l'argument
--     de la photo du tableau, à ceci près qu'ici le document reçu est la forme
--     normale et le texte tapé l'exception.
--   * « rien à écrire ». Une réunion tenue où rien ne s'est décidé, un conseil
--     dont le relevé est diffusé par l'établissement n'ont pas de compte rendu
--     à produire. Sans cette sortie, un rendez-vous de septembre reste dans
--     « À reprendre » jusqu'en juillet, et un rappel qui ne s'éteint jamais
--     apprend à se faire ignorer — il emporte avec lui les visites réellement
--     à rédiger, qui étaient le seul intérêt de la liste.
--
-- UNE SECONDE TABLE, ET NON UNE COLONNE « PORTEUR ».
--
-- `seance_attachments` aurait pu recevoir un couple (type de porteur,
-- identifiant) au lieu de sa clé étrangère. SQLite refuse une clé étrangère
-- vers deux tables : la cascade serait alors à réécrire à la main dans chaque
-- suppression, et un BLOB orphelin est précisément la fuite que rien ne
-- nomme — il grossit la base, les dix copies de `data/backups/` le recopient,
-- et aucun écran ne le montre. Deux tables, deux CASCADE, et
-- `PRAGMA foreign_key_check` qui le dit après chaque palier.
--
-- Ce qui ne se duplique pas, c'est la LOGIQUE : `commands/attachments.rs`
-- choisit l'ensemble de ses requêtes par un `match` sur le porteur, et le
-- plafond de 10 Mo, l'assainissement du nom, les refus nommés et l'export en
-- clair restent écrits une seule fois. Les deux tables ne peuvent donc pas se
-- comporter différemment, ce qui était le seul vrai risque de la duplication.
--
-- `content_waived_at` est NULL par défaut : aucun rendez-vous existant ne
-- change de statut en traversant ce palier. Et ce n'est pas une annulation —
-- un rendez-vous n'entre dans aucun dénominateur d'assiduité, il n'y a rien à
-- neutraliser. C'est uniquement « ne me le réclame plus ».
-- ==========================================================================

ALTER TABLE agenda_entries ADD COLUMN content_waived_at TEXT;

-- Colonnes identiques à `seance_attachments`, délibérément : chacune est
-- documentée au palier 012, y compris la raison pour laquelle `content` est
-- déclaré en DERNIER — SQLite range les colonnes dans l'ordre déclaré et pousse
-- le débordement en pages annexes, donc lister des pièces jointes sans
-- sélectionner `content` ne lit pas les octets.
CREATE TABLE agenda_entry_attachments (
    id         TEXT PRIMARY KEY,
    entry_id   TEXT NOT NULL REFERENCES agenda_entries(id) ON DELETE CASCADE,
    file_name  TEXT NOT NULL,
    mime_type  TEXT NOT NULL DEFAULT '',
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    content    BLOB NOT NULL
);

CREATE INDEX ix_agenda_entry_attachments_entry
    ON agenda_entry_attachments(entry_id, created_at);
