-- ============================================================================
-- SGPA — palier 003 : la base n'héberge plus rien du verrou
--
-- Le mot de passe n'est plus vérifié par un condensat bcrypt : il l'est par sa
-- capacité à déballer la clé maître de data/sgpa.keys. Un condensat resté dans
-- la base serait une seconde cible à attaquer, pour une vérification que plus
-- personne ne fait.
--
-- L'indice suit le même chemin : il doit être lisible AVANT d'ouvrir la base,
-- puisqu'il sert à retrouver le mot de passe qui l'ouvre. Il vit désormais dans
-- le fichier d'enveloppes, seul fichier lisible session verrouillée.
--
-- DROP COLUMN est possible ici : aucune des deux colonnes n'est indexée, ni
-- citée dans une contrainte de table, une vue ou un déclencheur.
-- ============================================================================

ALTER TABLE app_settings DROP COLUMN password_hash;
ALTER TABLE app_settings DROP COLUMN password_hint;
