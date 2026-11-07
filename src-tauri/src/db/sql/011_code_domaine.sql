-- ==========================================================================
-- SGPA — palier 011 : le domaine du socle porte son code
--
-- Sur la fiche contrat, la colonne « domaines » ne disait que le nom :
-- « La formation de la personne et du citoyen ». L'enseignant écrit, lui,
-- « D3 la formation de la personne et du citoyen cycle 3 » — et il a raison :
-- sans le code ni le cycle, la case ne permet pas de retrouver l'entrée dans
-- le référentiel, qui est pourtant tout ce qu'on lui demande. Les cinq
-- domaines portent les mêmes noms d'un cycle à l'autre : « D2 » tout seul est
-- ambigu, « cycle 3 » tout seul aussi.
--
-- Pourquoi une colonne, et non `position + 1` :
--
--   `position` est un ordre d'affichage, que l'enseignant peut changer. Le
--   code vient du décret et ne change pas. Les faire porter par la même valeur
--   revient à renommer D3 en D2 le jour où quelqu'un remonte un domaine dans
--   la liste — un document déjà remis à une famille se mettrait à désigner
--   autre chose. Même raison que `trimester_is_manual` : ce qui vient d'une
--   règle extérieure ne se déduit pas d'un détail d'interface.
--
-- La colonne est NOT NULL DEFAULT '' plutôt que NULL : un domaine créé par
-- l'enseignant n'a pas de code au décret, et la chaîne vide dit exactement
-- cela. Le libellé composé saute alors le code au lieu d'afficher un trou.
--
-- Ce palier NE réécrit AUCUN `socle_domain_label` déjà enregistré, et ce n'est
-- pas un oubli :
--
--   * le libellé d'une ligne de fiche est un texte de l'enseignant, que le
--     référentiel comble mais ne corrige pas (voir `resolve_competency`) ;
--   * composer le nouveau libellé en SQL ici dupliquerait `socle_reference`,
--     la fonction même qui existe pour que la règle ne vive qu'à un endroit ;
--   * et il n'y a rien à rattraper : le palier 010 n'est pas encore livré,
--     donc aucune fiche n'existe ailleurs que dans une base de démonstration,
--     que `examples/seed_fiche_contrat` réécrit de toute façon.
-- ==========================================================================

ALTER TABLE domains ADD COLUMN code TEXT NOT NULL DEFAULT '';

-- Les domaines semés par 002 (cycle 4) et 009 (cycle 3). Le code est pris sur
-- l'identifiant, qui l'encode déjà : `seed-d3` et `seed-c3-d3` sont tous deux
-- le domaine 3. Les domaines créés à la main gardent leur chaîne vide.
UPDATE domains SET code = 'D1' WHERE id IN ('seed-d1', 'seed-c3-d1');
UPDATE domains SET code = 'D2' WHERE id IN ('seed-d2', 'seed-c3-d2');
UPDATE domains SET code = 'D3' WHERE id IN ('seed-d3', 'seed-c3-d3');
UPDATE domains SET code = 'D4' WHERE id IN ('seed-d4', 'seed-c3-d4');
UPDATE domains SET code = 'D5' WHERE id IN ('seed-d5', 'seed-c3-d5');
