# SGPA — instructions pour un assistant de code

Application de bureau **portable** destinée à un enseignant de SEGPA. Tauri v2 (Rust + rusqlite) + React 19 / TypeScript.
L'interface est **intégralement en français**, messages d'erreur compris : un message SQLite en anglais qui remonte jusqu'à l'écran est un bug, pas un détail.

Ce fichier est autonome. `CLAUDE.md`, à la racine, dit la même chose en plus court ; `LISEZ-MOI.txt` s'adresse à l'utilisateur final et ne concerne pas le code.

---

## 1. Ce que le projet est, et n'est pas

- **Portable, exclusivement.** `bundle.active = false` dans `src-tauri/tauri.conf.json` : ni MSI ni NSIS. La CI produit une archive ZIP que l'on décompresse sur une clé USB. Tout vit à côté de l'exécutable, rien n'est écrit dans `%APPDATA%` ni `%LOCALAPPDATA%`.
- **Mono-utilisateur.** Il n'existe pas de table `users` ni de notion de compte. Une base de données = un enseignant. Les réglages tiennent dans `app_settings`, ligne unique contrainte par `CHECK (id = 1)`.
- **Le mot de passe EST la clé de la base.** `data/sgpa.db` est chiffrée par SQLCipher ; le mot de passe déballe, via Argon2id, la clé maître rangée dans `data/sgpa.keys`. Ce n'est plus un verrou d'écran, et rien — texte d'interface, commentaire, message d'erreur — ne doit laisser croire l'inverse, dans un sens comme dans l'autre : ce que le chiffrement ne couvre pas (les PDF de `exports/`, le poste hôte) doit être dit aussi franchement.
- Aucun réseau, aucune télémétrie, aucun service externe.

---

## 2. Arborescence réelle

```
src/                               Frontend React
  App.tsx                          HashRouter + LockGate (garde de verrouillage)
  main.tsx
  pages/                           Sessions, SessionDetail/, Cycles, Settings,
                                     Unlock, FirstRun
    SessionDetail/
      index.tsx                    détient session + élèves, 4 onglets
      tabs/                        StudentsTab, EvaluationsTab, SeancesTab, BilansTab
      seance/SeanceDetail.tsx      cahier de texte + appel
      evaluation/EvaluationDetail.tsx  grille de notes
      dialogs/                     ConfirmDialog, StudentFormDialog
  components/                      CompetencyPicker, ContractSheetEditor, DataState,
                                     RichEditor, TrimesterBoundsDialog
    layout/AppLayout.tsx
    ui/                            shadcn : alert-dialog, badge, button, card, dialog,
                                     input, label, scroll-area, select, separator,
                                     table, tabs, textarea, tooltip
  hooks/                           useLock.tsx (contexte du verrou), useIdleTimer.ts,
                                     useDrafts.tsx (registre des brouillons)
  lib/api.ts                       façade unique autour de invoke()
  lib/pdf.ts                       bilans PDF (jsPDF + jspdf-autotable)
  lib/utils.ts                     cn()
  types/index.ts                   miroir des structs Rust sérialisées

src-tauri/src/
  main.rs                          windows_subsystem + WebView2 embarqué optionnel
  lib.rs                           start() sans base, fenêtre, generate_handler!
  portable.rs                      résolution des chemins, sonde d'écriture, verrou de fichier
  keys.rs                          enveloppes de la clé maître — data/sgpa.keys
  state.rs                         AppState : Mutex<Option<Connection>> + verrou de fichier
  db/mod.rs                        ouverture chiffrée, PRAGMA, trimestres (trimester_for…)
  db/migrations.rs                 paliers pilotés par PRAGMA user_version
  db/sql/001_initial.sql           schéma v2, 18 tables
  db/sql/002_referentiel.sql       semis : 5 domaines du socle + 4 composantes du D1
  db/sql/003_sans_bcrypt.sql       DROP COLUMN password_hash et password_hint
  commands/                        contracts, evaluations, lock, maintenance,
                                     referential, reports (+ reports/scoring.rs),
                                     seances, sessions, students, trimesters
  sql_smoke.rs                     test : prépare toutes les requêtes littérales
```

Rien d'autre n'existe. En particulier : pas de `src/db.rs`, pas de `commands/auth.rs`, pas de `hooks/useAuth.tsx`, pas de `pages/Login.tsx`.

---

## 3. Les trois règles d'architecture non négociables

Chacune vient d'un bug réel, pas d'une préférence de style.

**1. Un écran enfant ne détient jamais une entité figée.** Le parent garde la liste et l'`id` sélectionné, dérive l'entité (`useMemo(() => seances.find((s) => s.id === selectedId) ?? null, …)`) et la passe en prop. Une entité copiée dans un `useState` ne se rafraîchit pas quand la liste est rechargée — c'est ce qui faisait réécrire un cahier de texte périmé par-dessus le texte fraîchement saisi. Voir `SeancesTab.tsx` et `EvaluationsTab.tsx`.

**2. Tout composant qui détient un brouillon porte `key={entity.id}`.** Sans cela, passer de la séance A à la séance B réutilise l'instance React, `useState(seance.content_html)` ne rejoue pas son initialiseur, et le brouillon de A est enregistré sous l'identifiant de B. `<SeanceDetail key={selected.id} …>`, `<EvaluationDetail key={selected.id} …>`.

**3. Deux écritures qui ne concernent pas les mêmes colonnes sont deux commandes.** `update_seance_meta` (titre, date, trimestre, annulation) et `update_seance_content` (cahier de texte) sont volontairement disjointes. Une commande unique écrivant tout d'un bloc laisse chaque appelant réécrire des champs qu'il n'a pas rafraîchis. Ne pas les fusionner « pour simplifier ».

---

## 4. Backend Rust

### Chiffrement

`data/sgpa.db` est chiffrée par SQLCipher (AES-256) avec une **clé maître** de 32 octets tirée au hasard, jamais dérivée du mot de passe. Le mot de passe et une **phrase de récupération** (8 groupes de 5 caractères, 200 bits, base32 sans caractères ambigus) la déballent chacun par son enveloppe, dans `data/sgpa.keys` : Argon2id (64 Mio, 3 passes) puis XChaCha20-Poly1305, AAD `sgpa-keys-v1:password` / `sgpa-keys-v1:recovery`.

Pourquoi ce détour plutôt que le mot de passe dans `PRAGMA key` : Argon2id est *memory-hard* là où le PBKDF2 interne de SQLCipher ne l'est pas ; changer de mot de passe réécrit 1 Ko au lieu de rechiffrer la base ; les sauvegardes déjà prises restent ouvrables ; et une seconde enveloppe rend la phrase de récupération possible.

- `db::prepare_encrypted(layout, &MasterKey)` = ouverture + lecture de contrôle + migrations : **c'est le point d'entrée d'`unlock` et de `setup_lock`**, pas `open_encrypted` seul.
- `PRAGMA key` n'authentifie rien. C'est la lecture de contrôle qui suit qui rend `SQLITE_NOTADB` sur une mauvaise clé → `DbError::WrongKey`.
- Toutes les fonctions de `keys.rs` prennent `layout.root` (le dossier `data/`), jamais le chemin du fichier.
- **Aucun secret ne se journalise ni ne s'affiche**, même tronqué. `MasterKey` n'est ni `Clone` ni `Display`, son `Debug` rend `MasterKey(masquée)`, son `Drop` efface ; idem `RecoveryPhrase`. Un mot de passe reçu de Tauri arrive en `String` : l'envelopper dans `Zeroizing<String>` dès la première ligne de la commande.
- `bcrypt` n'existe plus. Le palier 003 a retiré `password_hash` et `password_hint` de `app_settings` : l'indice vit dans `sgpa.keys` (`keys::read_hint` / `keys::set_hint`), parce qu'il doit se lire base fermée. `AppSettings` ne porte donc plus `password_hint`, et `get_lock_status` n'expose aucun nom d'enseignant — une clé trouvée ne doit pas dire à qui elle appartient.

### Accès à la base

- **Un seul point d'accès** : `AppState::conn()` dans `src-tauri/src/state.rs`. Le garde-fou de verrouillage vit là et nulle part ailleurs : une commande qui n'obtient pas de `Connection` ne peut rien lire.
- **L'état de verrouillage est la présence de la connexion**, `db: Mutex<Option<Connection>>` : plus d'`AtomicBool unlocked`, plus de `conn_for_lock()`. Il est donc impossible d'être « déverrouillé » sans base, ou l'inverse. `conn()` rend `Err("Session verrouillée")` quand l'option est vide.
- `lock()` passe par `AppState::close()`, qui **ferme réellement** la connexion : une `Connection` vivante garde la clé en clair dans le contexte SQLCipher.
- **Une seule `Connection`** pour tout le processus, sous `Mutex`, ouverte une fois par session déverrouillée. **Ne jamais rouvrir la base dans une commande** : c'était le défaut de la v1, chaque clic rejouait l'initialisation.
- Une commande qui touche au dossier de données sans lire la base passe quand même par `conn()` — voir `require_unlocked()` dans `commands/maintenance.rs` — pour ne pas réimplémenter le test du verrou.
- Rendre le verrou avant toute opération longue : Argon2id à 64 Mio prend plusieurs centaines de millisecondes et doit tourner **hors** du `MutexGuard`, `maintenance.rs` fait `drop(conn)` avant de parcourir le dossier des sauvegardes.

### Forme d'une commande

```rust
#[tauri::command]
pub fn create_session(
    state: tauri::State<'_, AppState>,
    name: String,
    level_code: String,
    year_start: i32,
) -> Result<Session, String> {
    let name = clean_name(&name)?;          // validation métier, message français
    check_level(&level_code)?;
    let mut conn = state.conn()?;           // `mut` obligatoire pour ouvrir une transaction
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    // …
    tx.commit().map_err(|e| e.to_string())?;
    Ok(session)
}
```

- `state: tauri::State<'_, AppState>` **toujours en premier paramètre**, retour `Result<T, String>`.
- Les identifiants sont des `Uuid::new_v4().to_string()`.
- `rusqlite::params![]` partout. Les fragments SQL variables viennent d'un `match` renvoyant des `&'static str` ou d'une constante (`SEANCE_COLUMNS`, `SESSION_SELECT`), **jamais** d'une saisie utilisateur.
- **Toute écriture qui touche plusieurs lignes ou plusieurs tables va dans une transaction.**
- Les valeurs des `CHECK` du schéma sont redupliquées côté Rust en constantes (`LEVEL_CODES`, `ATTENDANCE_STATUSES`, `AVERAGE_RULES`) pour produire un message français au lieu d'une erreur de contrainte SQLite.
- Structs de retour : `#[derive(Debug, Serialize)]` (souvent `Clone` en plus), champs en `snake_case`, **aucun `serde(rename)`** — c'est ce qui rend `src/types/index.ts` copiable tel quel.
- Horodatage : `datetime('now')` ou `strftime(…)` **côté SQLite**. La base est la seule horloge du projet ; un horodatage pris côté Rust dériverait de celui des colonnes `created_at`.
- Les messages d'erreur sont des phrases complètes en français qui disent quoi faire (« Vérifiez que le support n'est pas protégé en écriture. »). Le style est celui de `commands/maintenance.rs` et de `db/mod.rs`.

### Migrations

- `db/migrations.rs` + `db/sql/0NN_*.sql`, pilotées par `PRAGMA user_version`, constante `SCHEMA_VERSION` (actuellement `5`). `user_version` vit dans l'en-tête, qui est chiffré : le mécanisme fonctionne inchangé, simplement après le mot de passe — `migrations::run` est appelée depuis `db::prepare_encrypted`, plus depuis `start()`.
- **Un palier livré n'est jamais modifié** — une fois en production. Pour faire évoluer le schéma : nouveau fichier `0NN_*.sql`, nouvelle entrée dans `STEPS`, `SCHEMA_VERSION` incrémenté. Modifier `001_initial.sql` est un no-op sur toute base existante, donc invisible et trompeur.
- **Le projet est encore en développement** : le schéma n'est pas gelé, aucune base réelle n'existe. Réécrire ou fondre des paliers est autorisé tant que l'auteur n'a pas annoncé la production ; il faut alors détruire `data/` et resemer. La règle ci-dessus redevient absolue à ce moment-là.
- Une base déjà peuplée (`user_version > 0`) est copiée dans `data/backups/` par `VACUUM INTO` **avant** qu'un nouveau palier ne soit appliqué ; une base neuve n'en a pas besoin. `PRAGMA foreign_key_check` est passé à la fin de chaque palier, dans la transaction : une référence orpheline annule tout.
- Une base dont l'`user_version` dépasse `SCHEMA_VERSION` est **refusée** (`DbError::TooNew`), jamais ouverte de force.
- Une base d'avant le chiffrement — critère : `sgpa.db` présent **sans** `sgpa.keys` — est renommée `data/sgpa-legacy-v1.db` et une base neuve est créée. `db::move_legacy_aside` ne demande aucune clé et est appelée par `start()`, avant la fenêtre ; ne pas la rappeler ailleurs.

### Démarrage

- **`start()` n'ouvre plus la base.** Elle est chiffrée, sa clé n'existe qu'une fois le mot de passe déballé, donc après la fenêtre. Ne restent avant la fenêtre que les échecs qu'aucune interface ne pourrait rattraper :

  ```
  start()   portable::resolve → purge_traces_webview → db::move_legacy_aside
            → portable::acquire_lock → AppState::new(layout, verrou)   SANS connexion
  fenêtre   get_lock_status → setup_lock(mdp) | unlock(mdp) | recover(phrase, nouveau_mdp)
            lock() ferme la Connection
  ```

- La fenêtre est construite **en Rust** dans `lib.rs` (`WebviewWindowBuilder`), pas déclarée dans `tauri.conf.json` — `app.windows` est volontairement vide — uniquement pour pouvoir passer `data_directory(webview_dir)`. Sans elle, WebView2 range localStorage, cookies et cache dans le `%LOCALAPPDATA%` du poste hôte.
- **Le démarrage ne panique jamais.** Toute erreur survenant avant la création de la fenêtre passe par `fatal()`, qui affiche une `MessageBoxW` : en release, `windows_subsystem = "windows"` supprime la console et l'application disparaîtrait sans un mot.
- Chemins résolus par `portable.rs` : `data/sgpa.db`, `data/sgpa.keys`, `data/.sgpa.lock`, `data/backups/`, `data/webview/`, et `exports/` **à côté de l'exe** (ce sont des documents que l'enseignant va chercher, pas des fichiers internes). La racine est éprouvée par un fichier sonde : un `create_dir_all` qui réussit ne prouve pas qu'on peut écrire.
- Variable d'échappement : `SGPA_DATA_DIR` impose une autre racine de données.
- Journal SQLite en **TRUNCATE, pas en WAL** : le WAL crée `sgpa.db-wal` et `sgpa.db-shm`, donc « je copie `sgpa.db` sur mon disque » produit une sauvegarde périmée sans que rien ne le signale.
- `locking_mode = EXCLUSIVE` a **disparu**. La détection d'une seconde instance est un fichier de verrou, `data/.sgpa.lock`, ouvert en `share_mode(0)` par `portable::acquire_lock` avant la fenêtre ; échec → `DbError::AlreadyOpen` dans la `MessageBoxW`. Le `File` rendu doit vivre autant que le processus : `AppState` le garde. Windows le relâche à la mort du processus, plantage compris — aucun verrou fantôme, rien à nettoyer à la main.

### Les 55 commandes

Enregistrées dans `src-tauri/src/lib.rs` (`generate_handler!`), groupées par module :

| Module | N | Commandes |
| --- | --- | --- |
| `lock` | 10 | `get_lock_status`, `setup_lock`, `unlock`, `lock`, `change_password`, `recover`, `regenerate_recovery`, `set_password_hint`, `get_settings`, `update_settings` |
| `sessions` | 5 | `get_sessions`, `get_session`, `create_session`, `update_session`, `delete_session` |
| `students` | 5 | `get_students`, `create_student`, `create_students_bulk`, `update_student`, `delete_student` |
| `referential` | 6 | `get_referential_tree`, `create_nodes_bulk`, `rename_node`, `delete_node`, `reorder_nodes`, `archive_competency` |
| `seances` | 9 | `get_seances`, `create_seance`, `update_seance_meta`, `update_seance_content`, `delete_seance`, `get_attendance`, `set_attendance`, `set_bulk_attendance`, `reset_attendance` |
| `evaluations` | 7 | `get_evaluations`, `create_evaluation`, `update_evaluation`, `delete_evaluation`, `get_evaluation_competencies`, `get_grades`, `set_grade` |
| `trimesters` | 3 | `get_trimester_bounds`, `preview_trimester_recompute`, `update_trimester_bounds` |
| `contracts` | 4 | `get_contract_sheet`, `save_contract_sheet`, `get_professional_fields`, `create_professional_field` |
| `reports` | 2 | `get_report`, `save_report_comment` |
| `maintenance` | 4 | `create_backup`, `list_backups`, `reveal_data_dir`, `save_export` |

Le référentiel n'a plus de commandes unitaires par niveau : il se manipule par **arbre** (`get_referential_tree` renvoie `cycles → domaines → champs → compétences`) et par lot (`create_nodes_bulk` accepte un collage multi-lignes venu d'un tableur, `kind` valant `cycle` | `domain` | `field` | `competency`).

---

## 5. Modèle de données — 18 tables

Schéma de référence : `src-tauri/src/db/sql/001_initial.sql`, abondamment commenté. Les décisions qui s'y trouvent ne se devinent pas depuis le code appelant : le lire avant d'écrire une requête.

```
app_settings          trimester_bounds     professional_fields
cycles  domains  fields  competencies
sessions  students  seances  attendance_records
evaluations  evaluation_competencies  grades
contract_sheets  contract_sheet_rows  contract_sheet_students
report_comments
```

Points qui changent tout par rapport à l'ancienne structure :

- **Une session EST une classe pour une année scolaire**, avec `level_code` (`6eme`, `5eme`, `4eme`, `3eme`, `3eme_prepa`) et `year_start` (entier : 2021 signifie 2021-2022). Le niveau et l'année ne vivent nulle part ailleurs — `evaluations.school_year` et `report_comments.school_year` ont disparu.
- **Le trimestre est stocké** sur `seances` et sur `evaluations`, dérivé de la date par `db::trimester_for` à partir de `trimester_bounds`, avec `trimester_is_manual` qui protège la correction faite à la main par l'enseignant. **Le front ne recalcule jamais un trimestre** : deux implémentations de la même règle divergeraient au premier changement de bornes. `trimester_bounds` stocke des bornes **contiguës** (`t1_start`, `t2_start`, `t3_start`, `year_end`) : ni trou ni chevauchement possible.
- **L'appel non fait est un état réel** : `attendance_records.status` vaut `non_fait` | `present` | `absent` | `retard` | `excuse`. L'absence de ligne vaut « non fait », jamais « présent » — pré-remplir à `present` donnait une assiduité parfaite à qui oubliait l'appel. Deux niveaux distincts : `seances.attendance_taken_at IS NULL` (l'appel n'a pas été fait ce jour-là) et ligne absente ou `non_fait` (cet élève-là n'est pas renseigné).
- `students.enrolled_on` / `left_on` bornent l'assiduité : sans eux, « absent » et « pas encore inscrit » sont indiscernables. La valeur par défaut à la création est le `t1_start` de l'année de la session, **jamais** `date('now')`.
- `seances.cancelled` sort une séance annulée des statistiques d'assiduité tout en la gardant au cahier de texte.
- `competencies.archived_at` : une compétence utilisée par une évaluation ou portant une note ne peut pas être supprimée (`ON DELETE RESTRICT` sur `evaluation_competencies` et `grades`), elle s'archive.
- `grades.level` est un entier 0..5, `0` valant « non évalué ».
- Le référentiel est **livré pré-rempli** (palier 002) : les 5 domaines du socle commun et les 4 composantes du domaine 1. Aucune compétence n'est inventée, et `professional_fields` est **volontairement vide**.

---

## 6. Frontend

### Conventions

- **Un seul chemin vers le backend** : `src/lib/api.ts`. Aucun `invoke()` ailleurs. La façade convertit les erreurs en `ApiError` (le message français du backend) — sans cette normalisation, un échec de désérialisation affiche « [object Object] ».
- Les arguments passés à `invoke` sont en **camelCase** (`{ sessionId, levelCode, yearStart }`) ; Tauri les mappe sur les paramètres `snake_case` de la commande Rust. Les **données** renvoyées, elles, restent en `snake_case` : `src/types/index.ts` est le miroir exact des structs sérialisées, toute divergence est un bug.
- Imports par alias `@/` (`@/lib/api`, `@/types`, `@/components/ui/button`) — configuré dans `tsconfig.json` et `vite.config.ts`. Pas d'imports relatifs qui remontent (`../../`).
- Chargement, erreur et vide passent par `components/DataState.tsx`, qui teste **l'erreur avant l'état vide** : sans cet ordre, un chargement en échec s'affiche « Aucun élève dans cette classe » et l'enseignant croit à une base vide au lieu d'une panne. Aucun `catch` qui se contente de `console.error`.
- Pas de state management global : état local, props, et `useLock` pour le seul contexte existant. Pas de bibliothèque de formulaires ni de data-fetching.
- Tailwind 4 uniquement, via `cn()` (`clsx` + `tailwind-merge`). Conteneurs de page en `p-8 max-w-7xl mx-auto`.
- Composants shadcn existants dans `src/components/ui/` — **ne pas en ajouter sans raison**, et ne pas en installer un nouveau pour un besoin ponctuel.
- Routage : `HashRouter` (en build packagé, Tauri sert la page par un protocole personnalisé). La garde de verrouillage `LockGate` vit **sous** le routeur, et **démonte** l'arbre authentifié au lieu de le masquer : l'état React contenant noms d'élèves et notes doit réellement disparaître. Verrouiller ferme aussi la base côté Rust — l'écran verrouillé n'a donc plus aucune donnée à afficher, et **`Unlock` ne montre pas le nom de l'enseignant** : une clé trouvée ne doit pas dire à qui elle appartient.
- La phrase de récupération n'est montrée qu'une fois, au premier lancement, sur un écran dédié : bouton « Copier » et confirmation explicite (« Je l'ai notée et rangée en lieu sûr ») avant de pouvoir continuer. Ne jamais la réafficher, ni la stocker, ni la journaliser — elle ouvre la base au même titre que le mot de passe.
- Le verrouillage automatique par inactivité **est branché** dans `AppLayout` (`useIdleTimer`, délai lu dans `app_settings.lock_timeout_minutes`, préavis de 30 s), ainsi que le verrouillage à la réduction de la fenêtre (`app_settings.lock_on_minimize`, via `tauri://resize` puis `isMinimized()` — jamais `tauri://blur`, qui se déclencherait en ouvrant un PDF). Verrouiller démonte l'arbre React : tout chemin de verrouillage passe donc d'abord par `flushAll()` du registre `hooks/useDrafts.tsx`, où s'inscrit chaque composant détenant une saisie non enregistrée (cahier de texte, fiche contrat, appréciation de bilan). Le verrou tombe **même si un enregistrement échoue** ; les libellés en échec sont mémorisés dans `useLock` (qui survit au démontage) et affichés au déverrouillage.

### Indentation — le dépôt n'est pas homogène, et c'est intentionnel de le respecter

| Emplacement | Indentation |
| --- | --- |
| `src/lib/`, `src/types/` | **tabulations** |
| `src/pages/`, `src/components/`, `src/hooks/`, `src/App.tsx`, `src/main.tsx` | **2 espaces** |
| `src-tauri/**/*.rs` | 4 espaces (rustfmt) |
| `package.json`, `src-tauri/tauri.conf.json` | 4 espaces (`scripts/bump.mjs` réécrit avec `JSON.stringify(…, null, 4)`) |
| `tsconfig.json`, `vite.config.ts` | tabulations |
| `.github/workflows/build.yml`, `scripts/bump.mjs` | 4 espaces |

Il n'y a **ni Prettier ni ESLint** dans le projet : rien ne reformatera à votre place, et un fichier réindenté en entier produit un diff illisible. Suivre le style du fichier que l'on modifie.

---

## 7. Pièges concrets, déjà rencontrés

**`toISOString()` décale la date d'un jour et fausse le trimestre.** En UTC, une séance créée le 1er décembre à 00h30 est datée du 30 novembre, donc rangée au trimestre précédent. Pour le jour courant : `new Date().toLocaleDateString("sv-SE")` (le locale suédois donne `AAAA-MM-JJ`). Pour afficher une date ISO venue de la base : `new Date(iso + "T00:00:00").toLocaleDateString("fr-FR")` — le suffixe `T00:00:00` force l'heure locale, `new Date("2025-12-01")` seul vaut minuit UTC et recule d'un jour.

**`pragma_update` ignore la valeur retournée par `PRAGMA journal_mode`.** Il passe par `execute_batch`, qui jette la ligne de résultat ; or `PRAGMA journal_mode` renvoie le mode **réellement** appliqué. Sans lecture, la base peut rester silencieusement en WAL. Il faut `conn.query_row("PRAGMA journal_mode = TRUNCATE", [], |row| row.get(0))` puis comparer la valeur reçue — c'est ce que fait `open_encrypted()` dans `db/mod.rs`.

**Compiler exige Perl.** `rusqlite` est pris en `bundled-sqlcipher-vendored-openssl` : OpenSSL est compilé depuis les sources, et son `Configure` est un script Perl qui a besoin du module `Text::Template`. Strawberry Perl doit être dans le `PATH` de toute commande cargo (`C:\Strawberry\perl\bin`). NASM, en revanche, n'est **pas** nécessaire : `openssl-src` passe `no-asm` en dur. Et le dépôt doit rester haut dans l'arborescence : sous un chemin profond, l'extraction d'OpenSSL dépasse la limite de 260 caractères de Windows et `Configure` échoue sur des fichiers « missing » sans jamais nommer la cause. Première compilation ~7 minutes, ensuite en cache. Côté utilisateur final, tout cela est invisible : le lien est statique, aucune DLL OpenSSL n'accompagne `SGPA.exe`.

**`PRAGMA key` doit précéder toute autre instruction**, y compris les autres pragmas, sinon SQLCipher tente de lire des pages chiffrées sans clé. Et il n'authentifie rien : sur un fichier neuf comme sur une mauvaise clé, il réussit. C'est la lecture de contrôle qui suit (`SELECT count(*) FROM sqlite_master`) qui tranche.

**`PRAGMA foreign_keys` est ignoré à l'intérieur d'une transaction.** Il doit être posé **avant** de l'ouvrir : voir la suspension puis le rétablissement autour de chaque palier dans `db/migrations.rs`.

**`VACUUM INTO` refuse une cible qui existe déjà, et ne peut pas être appelé dans une transaction.** Les deux appelants (`migrations::backup_before_migration`, `maintenance::create_backup`) testent donc l'existence du fichier avant. Le chemin cible est toujours construit par le code, jamais par une saisie utilisateur. Ne pas remplacer par un `std::fs::copy` du fichier ouvert : il peut capturer une lecture déchirée, c'est-à-dire une sauvegarde inutilisable qui ne se signale qu'au moment où on en a besoin.

**Il n'existe pas de composant `Checkbox` dans `src/components/ui/`.** Les cases à cocher sont des `<input type="checkbox">` natifs enveloppés dans un `<label>`, avec `className="h-4 w-4 cursor-pointer rounded border-input accent-primary"` — voir `SeanceDetail.tsx` (séance annulée) et `Settings.tsx` (verrouiller à la réduction). Ne pas installer un composant shadcn pour une case de plus.

**`state.conn()` renvoie un `ConnGuard`**, qui déréférence vers `Connection`. Écrire `conn.execute(…)` et passer `&conn` marche comme avant ; pour ouvrir une transaction il faut toujours `let mut conn = state.conn()?;`. Et le garde ne doit jamais être conservé pendant une opération coûteuse (Argon2id, parcours de dossier, écriture de fichier) : tout le reste de l'application attend derrière.

**Le harnais `tauri::test::mock_builder` ne fonctionne pas ici.** Ses binaires de test meurent au démarrage sous Windows avec `STATUS_ENTRYPOINT_NOT_FOUND` : `tauri-build` n'embarque son manifeste Windows que dans l'exécutable de l'application. Ne pas réessayer sans résoudre ce point d'abord ; `sql_smoke.rs` est le contournement en place.

**`@tanstack/react-table` et `@radix-ui/react-dropdown-menu` sont déclarés dans `package.json` mais jamais importés.** Leur présence n'est pas une convention à suivre.

---

## 8. Tests et vérifications

```powershell
cargo test --lib     # depuis src-tauri/ — 63 tests
cargo clippy         # doit rester à zéro avertissement
pnpm exec tsc --noEmit
```

Répartition des tests : `keys.rs` 15, `commands/maintenance.rs` 11, `db/mod.rs` 9, `commands/students.rs` 6, `commands/trimesters.rs` 6, `db/migrations.rs` 5, `commands/reports/scoring.rs` 5, `portable.rs` 5, `sql_smoke.rs` 1.

`keys.rs` vérifie les deux enveloppes, le rejet d'un mauvais mot de passe et d'une phrase étrangère, la normalisation de la saisie, la régénération qui invalide l'ancienne phrase, l'échec d'une interversion des enveloppes grâce à l'AAD, l'écriture atomique, l'absence de toute identité dans le fichier et le fait que les secrets refusent de s'afficher. `db/mod.rs` ajoute l'aller-retour chiffré, le refus d'une mauvaise clé, l'illisibilité du fichier sur le disque et le fait qu'une sauvegarde `VACUUM INTO` reste chiffrée.

Le plus utile reste `sql_smoke` : il extrait les requêtes littérales des modules de commandes et les fait **préparer** par SQLite contre le schéma migré. Une colonne renommée, une table oubliée ou une faute de frappe sont attrapées là. Il ne couvre pas la logique — une requête valide qui compte les mauvaises lignes passe — et il exige un nombre minimal de requêtes : si une refonte change la façon d'écrire le SQL, ce garde-fou se plaint au lieu de ne plus rien vérifier. Ajouter un module de commandes implique de l'ajouter à la constante `SOURCES`, et d'y remonter ce seuil.

Il n'y a aucun test côté JavaScript.

---

## 9. Environnement de développement

```powershell
# PATH requis : Strawberry Perl (OpenSSL), fnm, cargo
$env:PATH = "C:\Strawberry\perl\bin;C:\Users\Theo\AppData\Roaming\fnm\node-versions\v24.14.1\installation;$env:USERPROFILE\.cargo\bin;$env:PATH"

pnpm tauri dev      # Vite sur le port 1420 + compilation Rust, puis ouverture de la fenêtre
pnpm build          # tsc && vite build (tsconfig porte noEmit)
```

- Le port **1420** est en `strictPort: true` : aucun repli sur un autre port, une instance restée ouverte bloque le lancement. Avant de relancer : `Get-Process sgpa -ErrorAction SilentlyContinue | Stop-Process -Force`.
- En développement la base est `src-tauri/target/debug/data/sgpa.db` — le dossier de l'exécutable, comme en production. Elle est **chiffrée comme en production** : aucun outil ne l'ouvre avec le mot de passe, qui ne chiffre rien lui-même. Pour la lire, passer par `sgpa_lib::open_for_tools(<dossier data>, <mot de passe>)`, seule porte publique.
- Pour reproduire l'écran d'erreur fatale : `$env:SGPA_DATA_DIR = "C:\Windows\System32\config\sgpa-data"` avant de lancer l'exe, puis `Remove-Item Env:\SGPA_DATA_DIR`.
- Le rechargement du front est à chaud ; une modification d'un `.rs` recompile et relance la fenêtre.
- Jeu de démonstration : `cargo run --example seed_demo -- target\debug\data <mot de passe>` (`src-tauri/examples/seed_demo.rs`). Il prend le dossier `data/` et le mot de passe défini au premier lancement, la base étant chiffrée, et exige une base déjà migrée. `examples/` n'est pas compilé dans l'application.

### CI — `.github/workflows/build.yml`

Sur chaque push vers `main` dont le message ne contient pas `[skip ci]`, sur `windows-latest` : vérification de Perl et du module `Text::Template` (prérequis d'OpenSSL, installés si l'image du runner ne les fournit pas), `pnpm exec tsc --noEmit`, `cargo test --lib`, puis incrément de version patch par `node scripts/bump.mjs patch` (qui écrit `src-tauri/tauri.conf.json`, `package.json` et `src-tauri/Cargo.toml`), commit `[skip ci]`, `pnpm tauri build --no-bundle`, assemblage d'un ZIP contenant `SGPA.exe` et `LISEZ-MOI.txt`, publication d'une release GitHub. Une version mineure se déclenche à la main : `pnpm version:minor`.

L'étape Perl est délibérément placée **avant** le bump de version : un échec de compilation d'OpenSSL après le commit `[skip ci]` et son `git push` laisserait le dépôt avec une version incrémentée et aucune release.

---

## 10. Décisions en attente — ne pas trancher seul

Ces points appartiennent à l'enseignant. S'y substituer produirait des documents faux remis à des familles.

1. **Règle de la moyenne générale.** Implémentation provisoire isolée dans `commands/reports/scoring.rs` ; la règle est lue dans `app_settings.overall_average_rule` (`unweighted_mean` par défaut, `weighted_by_count` disponible). En changer coûte l'`UPDATE` d'une ligne, **jamais** une migration.
2. **Sort des notes d'une compétence retirée d'une évaluation.** `app_settings.removed_competency_policy`, `keep` par défaut, `ignore` prévu.
3. **Maquette de la fiche contrat PDF**, nominative par élève. La table `contract_sheet_students` en pose le socle minimal ; le reste attend la maquette.
4. **Liste des champs professionnels SEGPA.** `professional_fields` est volontairement vide à la livraison : deux listes circulent et la référence réglementaire n'est pas vérifiée. Ne rien y semer sans confirmation.

Même principe pour l'échelle de maîtrise (`grades.level` 0..5) : ne pas en changer le nombre de niveaux avant que la question soit tranchée.
