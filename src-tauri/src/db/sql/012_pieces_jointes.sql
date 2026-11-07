-- ==========================================================================
-- SGPA — palier 012 : pièces jointes au cahier de texte
--
-- Une séance peut porter des fichiers : la photo du tableau, le PDF distribué,
-- l'énoncé en .docx, un enregistrement audio. Ils vivent DANS la base, en
-- BLOB, et c'est un choix, pas une facilité.
--
-- Pourquoi dans la base plutôt qu'en fichiers à côté :
--
--   * `create_backup` copie `sgpa.db`, et rien d'autre. Des pièces jointes
--     rangées dans `data/pieces/` sortiraient donc silencieusement du
--     périmètre de la sauvegarde — exactement le piège du journal WAL, où
--     « je copie sgpa.db » produit une copie incomplète sans que rien ne le
--     signale. Ici, sauvegarder la base sauvegarde les pièces, et restaurer
--     reste « je recopie un fichier ».
--   * Elles héritent du chiffrement SQLCipher sans une ligne de code. Une
--     photo de classe ou un bilan en clair sur la clé USB, c'est précisément
--     le scénario contre lequel toute la machinerie de `keys.rs` existe.
--
-- Le prix est réel et assumé : la base grossit, et `data/backups/` en garde
-- dix copies. Deux garde-fous l'encadrent, côté Rust et non ici — un CHECK sur
-- `length(content)` dirait « contrainte violée » là où il faut un message
-- français qui nomme le fichier et sa taille :
--
--   * plafond de 10 Mo par fichier (`attachments::MAX_ATTACHMENT_BYTES`) ;
--   * les images sont redimensionnées à 1600 px par le front AVANT l'envoi.
--     C'est de là que vient le volume : une photo de téléphone fait 4 à 8 Mo,
--     la même en 1600 px environ 300 Ko.
--
-- `content` est la DERNIÈRE colonne, et ce n'est pas cosmétique : SQLite range
-- les colonnes dans l'ordre déclaré et déborde sur des pages annexes dès que
-- la ligne dépasse la page. Déclaré en dernier, le BLOB part seul dans ces
-- pages, et lister les pièces jointes sans sélectionner `content` ne les lit
-- pas du tout. Déclaré avant `created_at`, chaque listage aurait traversé des
-- mégaoctets pour atteindre une date.
--
-- Pas de déduplication par empreinte, et c'est délibéré : le même PDF joint à
-- vingt séances serait stocké vingt fois, soit quelques mégaoctets au plafond
-- de 10 Mo. Une table de contenus partagés avec compteur de références coûte
-- un invariant à tenir à chaque suppression — plus cher, et plus longtemps,
-- que la place qu'elle économise.
--
-- Pas de `position` non plus : l'ordre d'affichage est celui de l'ajout, et
-- une colonne d'ordre réglable sans écran pour la régler n'est qu'une colonne
-- que les prochaines requêtes devront porter.
-- ==========================================================================

CREATE TABLE seance_attachments (
    id         TEXT PRIMARY KEY,
    seance_id  TEXT NOT NULL REFERENCES seances(id) ON DELETE CASCADE,

    -- Nom tel que l'enseignant le reconnaît, assaini côté Rust (ni chemin, ni
    -- séparateur) : il sert de nom de fichier le jour où une pièce est ouverte
    -- dans Word, et un `..\` recopié tel quel écrirait hors du dossier prévu.
    file_name  TEXT NOT NULL,

    -- Type MIME annoncé par le navigateur. Indicatif, jamais une autorisation :
    -- il décide seulement du mode d'affichage (image, audio, PDF, ou « ouvrir
    -- dans l'application du poste »). `''` = inconnu.
    mime_type  TEXT NOT NULL DEFAULT '',

    -- Taille des octets stockés, après redimensionnement éventuel. Redondante
    -- avec `length(content)`, et c'est tout l'intérêt : afficher « 312 Ko » en
    -- face de chaque ligne ne doit pas lire les BLOB de toute la séance.
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),

    created_at TEXT NOT NULL DEFAULT (datetime('now')),

    content    BLOB NOT NULL
);

CREATE INDEX ix_seance_attachments_seance
    ON seance_attachments(seance_id, created_at);
