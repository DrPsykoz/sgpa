-- ==========================================================================
-- SGPA — palier 021 : les compétences d'une étape viennent du référentiel
--
-- LE PALIER 019 AVAIT TRANCHÉ L'INVERSE, ET C'ÉTAIT UNE DÉCISION DE L'AUTEUR :
-- « les compétences sont en texte libre et ne citent pas le référentiel
-- `competencies`, parce qu'il écrit des phrases » (2026-11-07). Il l'a rouverte
-- le 2026-11-09 : « il faudrait pouvoir sélectionner les compétences via le
-- référentiel et pas un champ texte libre ». Ce n'est pas un revirement en
-- l'air — les 53 compétences semées par le palier 009 viennent de SON tableau,
-- donc les phrases qu'il retapait à la main étaient déjà dans la base, à deux
-- écrans de là. Ne pas rouvrir dans l'autre sens sans lui.
--
-- `progression_etapes.competences` N'EST PAS SUPPRIMÉE, ET PAS VIDÉE. Des
-- enseignants ont des bases réelles depuis le 2026-11-08 : la colonne garde son
-- texte, l'écran le montre en lecture seule tant qu'il n'est pas vide, et seul
-- un geste explicite de l'enseignant l'efface. Un palier ultérieur pourra la
-- retirer le jour où elle sera vide partout — jamais avant, et jamais par un
-- UPDATE qui déciderait à sa place.
--
-- MIROIR DE `evaluation_competencies`, À UNE COLONNE PRÈS : même forme, même
-- CASCADE sur le porteur, même RESTRICT sur la compétence, même index inverse.
-- Une table jumelle qui diverge de sa voisine finit par être lue avec les
-- hypothèses de l'autre.
--
-- PAS DE COLONNE `position`, et c'est la seule différence, assumée. Sa voisine
-- en a une, l'écrit à chaque enregistrement… et son lecteur
-- (`get_evaluation_competencies`) ordonne par `d.position, f.position,
-- c.position` — l'ordre du référentiel, jamais le sien. Une colonne qu'aucune
-- requête ne lit est une colonne qui finira par contredire l'écran. L'ordre
-- d'une étape est donc celui du référentiel, que l'enseignant règle déjà dans
-- Réglages, et une compétence déplacée là-bas se déplace partout d'un coup.
--
-- RESTRICT ET NON CASCADE. Supprimer du référentiel une compétence qu'une
-- progression cite retirerait une ligne d'un plan déjà imprimé sans que rien ne
-- le dise. `delete_node` compte donc l'impact AVANT de supprimer — comme il le
-- fait déjà pour les notes et les évaluations — et nomme les étapes concernées.
-- Même doctrine que `progression_activites.domaine_id` : « présenter un bouton
-- qui échoue vaut moins que l'annoncer ».
--
-- Rien à migrer : aucune ligne ne peut être devinée. Le texte libre d'une étape
-- est une suite de phrases écrites à la main, et le rapprocher du référentiel
-- par ressemblance rattacherait à une étape une compétence que l'enseignant n'a
-- pas choisie. C'est lui qui coche, une fois, et il voit ce qu'il avait écrit
-- pendant qu'il le fait.
-- ==========================================================================

CREATE TABLE progression_etape_competences (
    etape_id      TEXT NOT NULL REFERENCES progression_etapes(id) ON DELETE CASCADE,
    competency_id TEXT NOT NULL REFERENCES competencies(id)       ON DELETE RESTRICT,
    PRIMARY KEY (etape_id, competency_id)
);

-- Le sens inverse : « quelles étapes citent cette compétence ? », posé par
-- `delete_node` avant chaque suppression du référentiel.
CREATE INDEX ix_progression_etape_competences_competency
    ON progression_etape_competences(competency_id);
