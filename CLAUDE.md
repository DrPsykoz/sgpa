# SGPA — instructions de travail

Application de bureau **portable** pour enseignant de SEGPA. Tauri v2 (Rust + rusqlite) + React 19 / TypeScript. Interface **intégralement en français**, y compris les messages d'erreur.

> **Phase : développement.** Le schéma n'est pas gelé. Tant que l'auteur n'a pas
> annoncé le passage en production, refondre la base ou repartir de zéro est
> permis : aucune donnée réelle n'est en jeu, et un modèle juste vaut mieux
> qu'un empilement de paliers correctifs. Cela ne lève **que** la règle des
> paliers figés ci-dessous — tout le reste de ce document tient, en
> particulier les trois règles d'architecture, qui viennent de bugs et non du
> schéma. Quand l'auteur annoncera la production, cette note saute et la règle
> des paliers se réarme.

## Commandes

```powershell
# Perl d'abord : toute commande cargo compile OpenSSL depuis les sources
# (rusqlite en `bundled-sqlcipher-vendored-openssl`). Sans lui, le build
# s'arrête sur « Command 'perl' not found ». NASM n'est PAS nécessaire.
$env:PATH = "C:\Strawberry\perl\bin;C:\Users\Theo\AppData\Roaming\fnm\node-versions\v24.14.1\installation;$env:USERPROFILE\.cargo\bin;$env:PATH"

pnpm tauri dev          # lance l'app (Vite sur 1420 + compilation Rust)
pnpm build              # tsc --noEmit puis vite build
cargo test --lib        # depuis src-tauri/ — 102 tests
cargo clippy            # doit rester à zéro avertissement
```

La première compilation d'OpenSSL prend ~7 minutes, les suivantes sont en cache — prévoir des
délais généreux. Le dépôt doit rester haut dans l'arborescence : sous un chemin profond,
l'extraction d'OpenSSL dépasse la limite de 260 caractères de Windows et `Configure` échoue sur
des fichiers « missing » sans nommer la cause.

**Avant de relancer**, tuer l'application ET le serveur Vite. C'est lui le coupable
habituel du « port 1420 déjà utilisé » : quand `pnpm tauri dev` est interrompu, `sgpa.exe`
meurt mais le Vite lancé par `beforeDevCommand` lui survit, orphelin, et garde le port.

```powershell
Get-Process sgpa -ErrorAction SilentlyContinue | Stop-Process -Force
Get-NetTCPConnection -LocalPort 1420 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force }
```

Ne pas tuer `node` en masse : d'autres projets peuvent tourner. Le port est le bon critère.

## Trois règles d'architecture non négociables

Elles viennent chacune d'un bug réel, pas d'une préférence de style.

**1. Un écran enfant ne détient jamais une entité figée.** Le parent garde la liste et l'`id` sélectionné, dérive l'entité (`list.find(x => x.id === selectedId) ?? null`) et la passe en prop. Un prop figé ne se rafraîchit pas quand la liste est rechargée — c'est ce qui faisait réécrire un cahier de texte périmé par-dessus le texte fraîchement saisi.

**2. Tout composant qui détient un brouillon porte `key={entity.id}`.** Sans cela, passer de la séance A à la séance B réutilise l'instance React, `useState(seance.content_html)` ne rejoue pas son initialiseur, et on enregistre le brouillon de A sous l'identifiant de B.

**3. Deux écritures qui ne concernent pas les mêmes colonnes sont deux commandes.** `update_seance_meta` (titre, date, trimestre, annulation) et `update_seance_content` (cahier de texte) sont volontairement disjointes. Une commande unique écrivant tout d'un bloc laisse chaque appelant réécrire des champs qu'il n'a pas rafraîchis.

## Chiffrement

La base est chiffrée par SQLCipher avec une **clé maître** de 32 octets tirée au hasard. Le mot de passe et la phrase de récupération ne servent qu'à la déballer, chacun par son enveloppe Argon2id + XChaCha20-Poly1305 dans `data/sgpa.keys` (~1 Ko). Détail complet : section « Chiffrement » du `README.md`.

- **Le mot de passe est la clé.** Ne jamais écrire, ni sous-entendre, qu'il verrouille seulement l'écran. Minimum 8 caractères (`keys::MIN_PASSWORD_LEN`).
- **Un secret ne se journalise ni ne s'affiche**, même tronqué. `MasterKey` et `RecoveryPhrase` masquent leur `Debug` et s'effacent au `Drop` ; envelopper dans `Zeroizing<String>` tout mot de passe reçu de Tauri.
- **`db::prepare_encrypted(layout, &key)`** est le point d'entrée d'`unlock` et `setup_lock` : ouverture + lecture de contrôle + migrations. `PRAGMA key` n'authentifie rien, c'est la lecture qui suit qui rend `DbError::WrongKey`.
- `keys::*` prend toujours `layout.root` (le dossier `data/`), jamais le chemin du fichier.
- Rien de ce qui touche au verrou ne vit dans la base : le palier 003 a supprimé `password_hash` et `password_hint`. L'indice est dans `sgpa.keys`, seul fichier lisible session verrouillée. Et `get_lock_status` n'expose aucun nom — une clé trouvée ne doit pas dire à qui elle appartient.

## Backend

- **Un seul point d'accès à la base** : `AppState::conn()` dans `src/state.rs`. C'est là, et nulle part ailleurs, que vit le garde-fou de verrouillage — une commande qui n'obtient pas de `Connection` ne peut rien lire.
- **L'état de verrouillage EST la présence de la connexion** : `db: Mutex<Option<Connection>>`, pas de drapeau à côté. `lock()` appelle `AppState::close()`, qui ferme réellement la base — une `Connection` vivante garde la clé en mémoire dans le contexte SQLCipher.
- **Une seule `Connection`** pour tout le processus, sous `Mutex`. Ne jamais rouvrir la base dans une commande.
- **Migrations versionnées** : `db/migrations.rs` + `db/sql/0NN_*.sql`, pilotées par `PRAGMA user_version`. En production, **un palier livré n'est jamais modifié** — on en ajoute un nouveau, et on incrémente `SCHEMA_VERSION`. En phase de développement (voir en tête), réécrire un palier existant ou fondre plusieurs paliers en un seul est autorisé : le coût est une base de démonstration à reconstruire, pas une perte de données. Ne pas s'interdire le bon modèle pour éviter une migration.
- Toute commande est `#[tauri::command]`, prend `state: tauri::State<'_, AppState>` en premier paramètre, retourne `Result<T, String>`.
- Écritures multi-lignes : **toujours** dans une transaction.
- `rusqlite::params![]` partout. Les fragments SQL variables viennent d'un `match` renvoyant des `&'static str`, jamais d'une saisie utilisateur.
- Journal SQLite en **TRUNCATE**, pas en WAL : le WAL crée `sgpa.db-wal` et `sgpa.db-shm`, donc « je copie `sgpa.db` » produit une sauvegarde périmée sans que rien ne le signale.

## Portabilité

Tout vit à côté de l'exécutable, résolu par `src/portable.rs` :

```
data/sgpa.db   data/sgpa.keys   data/.sgpa.lock   data/backups/   data/webview/   exports/
```

- **`start()` n'ouvre plus la base** : résolution portable, purge des traces WebView2, `db::move_legacy_aside`, verrou de fichier, puis `AppState::new(layout, verrou)` **sans connexion**. La base s'ouvre après le mot de passe, donc après la fenêtre.
- La seconde instance est détectée par `data/.sgpa.lock` (`share_mode(0)`), pris avant la fenêtre — `PRAGMA locking_mode = EXCLUSIVE` a disparu, il aurait fallu ouvrir la base pour répondre. Le `File` doit vivre autant que le processus : il est gardé dans `AppState`.
- La fenêtre est construite **en Rust** (`lib.rs`), pas déclarée dans `tauri.conf.json`, uniquement pour pouvoir passer `data_directory` : sans elle, WebView2 écrit dans le `%LOCALAPPDATA%` du poste hôte.
- `bundle.active = false` : **ni MSI ni NSIS**. La CI produit une archive ZIP. L'utilisateur final n'installe rien : OpenSSL est lié statiquement, les seules DLL requises sont des DLL système Windows.
- Le démarrage ne panique jamais. Une erreur avant la création de la fenêtre passe par `fatal()`, qui affiche une `MessageBoxW` — en release, `windows_subsystem = "windows"` supprime la console, et l'application disparaîtrait sans un mot.
- Variable d'échappement : `SGPA_DATA_DIR`.

## Modèle de données

Une **session** est une classe pour une année scolaire (`level_code` + `year_start`). Le niveau et l'année ne vivent nulle part ailleurs.

Le **trimestre** est stocké sur la séance et sur l'évaluation, dérivé de la date via `trimester_bounds`, avec un drapeau `trimester_is_manual` qui protège les corrections de l'enseignant. Le front ne recalcule jamais un trimestre : deux implémentations de la même règle divergeraient au premier changement de bornes.

L'**appel non fait** est un état réel (`non_fait`). L'absence d'enregistrement vaut « non fait », jamais « présent » : pré-remplir à `present` donnait une assiduité parfaite à qui oubliait l'appel.

`students.enrolled_on` / `left_on` bornent l'assiduité. La valeur par défaut est le début de l'année scolaire, **jamais** `date('now')`.

## Frontend

- Erreurs : `api.ts` lève `ApiError` (message français du backend), `components/DataState.tsx` teste l'erreur **avant** l'état vide. Aucun `catch` qui ne fait que `console.error`.
- Dates : `new Date().toLocaleDateString("sv-SE")` pour le jour courant. **Jamais** `toISOString().split("T")[0]` — en UTC, une séance créée le 1er décembre à 00h30 est datée du 30 novembre, donc classée au mauvais trimestre.
- Pas de state management global. Tailwind uniquement. Composants shadcn existants dans `src/components/ui/`, ne pas en ajouter sans raison.

## Décisions en attente — ne pas trancher seul

Ces trois points appartiennent à l'enseignant ; s'y substituer produirait des documents faux remis à des familles.

1. **Règle de la moyenne générale.** Implémentation provisoire isolée dans `commands/reports/scoring.rs`, règle lue dans `app_settings.overall_average_rule`.
2. **Sort des notes d'une compétence retirée.** `app_settings.removed_competency_policy`, `'keep'` par défaut.
3. **Maquette de la fiche contrat PDF**, nominative par élève.

4. **Où est l'élève qui n'a pas trouvé de stage**, pendant la période de stage de sa classe : dans les séances de l'enseignant, en permanence, ou aucune séance ces semaines-là ? Demandé le 2026-09-20, sans réponse. **Ne bloque pas le palier 006** : le schéma et `ATTENDANCE_SQL` sont identiques sous les trois réponses, seul l'écran de suivi en dépendrait.

Également en attente : la liste des **champs professionnels** (`professional_fields` est volontairement vide à la livraison — ne rien y semer sans confirmation).

## Tests

`cargo test --lib` : 102 tests, dont 15 sur `keys.rs` (enveloppes, récupération, AAD, secrets qui refusent de s'afficher) et 9 sur l'ouverture chiffrée. Le plus utile reste `sql_smoke` — il extrait les requêtes littérales des modules de commandes et les fait préparer par SQLite contre le schéma migré, ce qui attrape toute colonne renommée ou table oubliée. Son garde-fou exige un nombre minimal de requêtes : l'abaisser doit rester exceptionnel et temporaire.

Le harnais `tauri::test::mock_builder` **ne fonctionne pas ici** : ses binaires de test meurent au démarrage avec `STATUS_ENTRYPOINT_NOT_FOUND`, `tauri-build` n'embarquant son manifeste Windows que dans l'exécutable de l'application. Ne pas réessayer sans résoudre ce point d'abord.
