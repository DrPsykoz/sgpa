# SGPA — instructions pour un assistant de code

Application de bureau **portable** destinée à un enseignant de SEGPA. Tauri v2 (Rust + rusqlite) + React 19 / TypeScript.
L'interface est **intégralement en français**, messages d'erreur compris : un message SQLite en anglais qui remonte jusqu'à l'écran est un bug, pas un détail.

Ce fichier est autonome. `CLAUDE.md`, à la racine, dit la même chose en plus court ; `LISEZ-MOI.txt` s'adresse à l'utilisateur final et ne concerne pas le code.

---

## 1. Ce que le projet est, et n'est pas

- **Portable, exclusivement.** `bundle.active = false` dans `src-tauri/tauri.conf.json` : ni MSI ni NSIS. La CI produit une archive ZIP que l'on décompresse sur une clé USB. Tout vit à côté de l'exécutable. **Une seule écriture hors de ce dossier, assumée et facultative** : activer le code PIN écrit `%LOCALAPPDATA%\SGPA\poste.bin`, les 32 octets du poste protégés par DPAPI (`src/device.rs`, échappatoire `SGPA_DEVICE_DIR`). Rien n'y est écrit tant que l'enseignant ne l'a pas activé, et « Oublier ce poste » (`disable_pin`) l'efface. Toute autre écriture hors du dossier de l'exécutable est un bug.
- **Des données personnelles de mineurs.** Noms, notes, absences, et des besoins particuliers qui sont des données de santé. C'est ce qui justifie le chiffrement, l'absence de réseau, et le fait que le journal de diagnostic ne prenne **que des noms de commandes**.
- **Mono-utilisateur.** Il n'existe pas de table `users` ni de notion de compte. Une base de données = un enseignant. Les réglages tiennent dans `app_settings`, ligne unique contrainte par `CHECK (id = 1)`.
- **Le mot de passe EST la clé de la base.** `data/sgpa.db` est chiffrée par SQLCipher ; le mot de passe déballe, via Argon2id, la clé maître rangée dans `data/sgpa.keys`. Ce n'est plus un verrou d'écran, et rien — texte d'interface, commentaire, message d'erreur — ne doit laisser croire l'inverse, dans un sens comme dans l'autre : ce que le chiffrement ne couvre pas (les PDF de `exports/`, le poste hôte) doit être dit aussi franchement.
- Aucun réseau, aucune télémétrie, aucun service externe.

---

## 2. Arborescence réelle

```
src/                               Frontend React
  App.tsx                          HashRouter + LimiteErreur + interdireNavigationParDepot
                                     + LockGate (garde de verrouillage)
  main.tsx
  index.css                        TOUS les jetons de couleur, dans :root — un seul jeu
  pages/
    Home.tsx                       l'accueil : six journées ouvrées, ce qui reste à reprendre
    Sessions.tsx                   les classes
    SessionDetail/
      index.tsx                    détient session + élèves, 6 onglets
      tabs/                        StudentsTab, SeancesTab, EvaluationsTab,
                                     AbsencesTab, BilansTab, ProgressionTab
      seance/SeanceDetail.tsx      cahier de texte + appel + pièces jointes
      evaluation/                  EvaluationDetail.tsx, GradeInput.tsx (note sur 20)
      progression/                 EtapesEditor, FriseProgression, EtapeDialog,
                                     ActiviteDialog, DomainesDialog, EnteteDialog
      dialogs/                     StudentFormDialog, StudentNeedsDialog,
                                     AbsencePeriodDialog
    Timetable/
      index.tsx                    onglets « Semaine » (défaut) et « Année » — ?vue=annee
      WeekGrid.tsx                 la grille hebdomadaire — PAS de onOpenSeance
      YearGrid.tsx                 la frise annuelle, EN LECTURE SEULE
      DaysCalendar.tsx             les journées de l'accueil (même géométrie)
      journee.ts  geometry.ts      aides partagées par les deux calendriers
      SlotDialog, AgendaEntryDialog, OneOffSeanceDialog,
      CancelReasonDialog, NewPlanningDialog
    Cycles.tsx                     le référentiel de compétences
    Settings.tsx  Unlock.tsx  FirstRun.tsx  Recover.tsx
  components/                      AgendaEntryEditor, Attachments, CompetencyPicker,
                                     ConfirmDialog, ContractSheetEditor, DataState,
                                     EvaluationSheetPanel, FriseEntetes, LimiteErreur,
                                     NeedTagsCard, NeedsChips, OccurrenceDialog,
                                     PinInput, RecoveryPhrase, RichEditor,
                                     TrimesterBoundsDialog
    layout/AppLayout.tsx
    ui/                            shadcn : alert-dialog, badge, button, card, dialog,
                                     input, label, scroll-area, select, separator,
                                     table, tabs, textarea, tooltip
  hooks/                           useLock.tsx (contexte du verrou), useIdleTimer.ts,
                                     useDrafts.tsx (registre des brouillons),
                                     useNeeds.tsx, useZoneDepot.ts
  lib/api.ts                       façade unique autour de invoke()
  lib/pdf.ts                       tous les PDF (jsPDF + jspdf-autotable)
  lib/progression.ts               découpage de la frise, vocabulaire de la semaine
  lib/teintes.ts                   teinte par classe, teinte par rang d'activité, OKLCH→sRVB
  lib/contenu.ts                   les trois façons de régler un compte rendu
  lib/depot.ts                     glisser-déposer : estDepotDeFichiers, interdireNavigationParDepot
  lib/journal.ts                   écouteurs globaux d'erreur → log_ui_error
  lib/password.ts  lib/utils.ts
  types/index.ts                   miroir des structs Rust + MASTERY_BANDS / niveauDeNote

src-tauri/src/
  main.rs                          windows_subsystem + WebView2 embarqué optionnel
  lib.rs                           start() sans base, fenêtre, generate_handler!
  portable.rs                      résolution des chemins, sonde d'écriture, verrou de fichier
  keys.rs                          enveloppes de la clé maître — data/sgpa.keys
  device.rs                        les 32 octets du poste sous DPAPI — le PIN, et rien d'autre
  journal.rs                       data/logs/ — n'échoue jamais, ne panique jamais
  state.rs                         AppState : Mutex<Option<Connection>> + verrou de fichier
  db/mod.rs                        ouverture chiffrée, PRAGMA, trimestres (trimester_for…)
  db/migrations.rs                 paliers pilotés par PRAGMA user_version
  db/holidays.rs                   semis du calendrier scolaire — muet en cas d'échec
  db/sql/001_initial.sql           schéma d'origine, 18 tables
  db/sql/0NN_*.sql                 19 paliers en tout ; lire 019_progression.sql
                                     pour le modèle de la progression annuelle
  commands/                        absences, attachments, contracts, diagnostics,
                                     evaluations, home, lock, maintenance, needs,
                                     progressions, referential, reports
                                     (+ reports/scoring.rs), seances, sessions,
                                     students, timetable (+ timetable/feries.rs),
                                     trimesters
  sql_smoke.rs                     test : prépare toutes les requêtes littérales
```

Rien d'autre n'existe. En particulier : pas de `src/db.rs`, pas de `commands/auth.rs`, pas de `commands/stages.rs`, pas de `hooks/useAuth.tsx`, pas de `pages/Login.tsx`, pas de `src/lib/theme.ts` (il n'y a plus de choix de thème).

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
- **Le code PIN n'est pas un second mot de passe.** Six chiffres font 10⁶ combinaisons : contre Argon2id, quelques minutes de carte graphique. Il n'ouvre donc **jamais seul** — l'autre moitié du secret est les 32 octets de `%LOCALAPPDATA%\SGPA\poste.bin`, protégés par DPAPI (`src/device.rs`), qui ne suivent pas la clé USB. Un PIN est lié à un poste **et** à un compte Windows ; partout ailleurs `pin_available` vaut faux et l'écran ne propose pas le champ. Ne jamais le présenter comme un équivalent du mot de passe, ni ajouter un chemin qui l'ouvrirait sans le secret du poste.
- **Changer le mot de passe ne retire pas un PIN** : la clé maître ne bouge pas, donc l'enveloppe PIN continue de l'ouvrir. Le seul retrait est `disable_pin` (« Oublier ce poste »), qui efface `poste.bin` **puis** l'enveloppe — dans cet ordre, le secret du poste étant la moitié dangereuse.

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

- `db/migrations.rs` + `db/sql/0NN_*.sql`, pilotées par `PRAGMA user_version`, constante `SCHEMA_VERSION` (actuellement `19`). `user_version` vit dans l'en-tête, qui est chiffré : le mécanisme fonctionne inchangé, simplement après le mot de passe — `migrations::run` est appelée depuis `db::prepare_encrypted`, plus depuis `start()`.
- **Un palier livré n'est jamais modifié** — une fois en production. Pour faire évoluer le schéma : nouveau fichier `0NN_*.sql`, nouvelle entrée dans `STEPS`, `SCHEMA_VERSION` incrémenté, et `TABLES_ATTENDUES` ajusté si le compte de tables change (36 au palier 019). Modifier `001_initial.sql` est un no-op sur toute base existante, donc invisible et trompeur.
- **Le projet est encore en développement** : le schéma n'est pas gelé. Réécrire ou fondre des paliers reste autorisé tant que l'auteur n'a pas annoncé la production ; il faut alors détruire `data/` et resemer. Mais une version est publiée et il teste pour de vrai : en pratique, **ajouter un palier plutôt que réécrire un ancien**, et ne se servir de cette permission que si un palier correctif produirait un modèle faux. La règle ci-dessus redevient absolue au passage en production.
- Une base déjà peuplée (`user_version > 0`) est copiée dans `data/backups/` par `VACUUM INTO` **avant** qu'un nouveau palier ne soit appliqué ; une base neuve n'en a pas besoin. `PRAGMA foreign_key_check` est passé à la fin de chaque palier, dans la transaction : une référence orpheline annule tout.
- Une base dont l'`user_version` dépasse `SCHEMA_VERSION` est **refusée** (`DbError::TooNew`), jamais ouverte de force.
- Une base d'avant le chiffrement — critère : `sgpa.db` présent **sans** `sgpa.keys` — est renommée `data/sgpa-legacy-v1.db` et une base neuve est créée. `db::move_legacy_aside` ne demande aucune clé et est appelée par `start()`, avant la fenêtre ; ne pas la rappeler ailleurs.

### Démarrage

- **`start()` n'ouvre plus la base.** Elle est chiffrée, sa clé n'existe qu'une fois le mot de passe déballé, donc après la fenêtre. Ne restent avant la fenêtre que les échecs qu'aucune interface ne pourrait rattraper :

  ```
  start()   portable::resolve → journal::init + installer_capture_de_panique
            → purge_traces_webview → db::move_legacy_aside
            → portable::acquire_lock → AppState::new(layout, verrou)   SANS connexion
  fenêtre   get_lock_status → setup_lock(mdp) | unlock(mdp) | recover(phrase, nouveau_mdp)
            lock() ferme la Connection
  ```

- La fenêtre est construite **en Rust** dans `lib.rs` (`WebviewWindowBuilder`), pas déclarée dans `tauri.conf.json` — `app.windows` est volontairement vide — uniquement pour pouvoir passer `data_directory(webview_dir)`. Sans elle, WebView2 range localStorage, cookies et cache dans le `%LOCALAPPDATA%` du poste hôte.
- **Le démarrage ne panique jamais.** Toute erreur survenant avant la création de la fenêtre passe par `fatal()`, qui affiche une `MessageBoxW` : en release, `windows_subsystem = "windows"` supprime la console et l'application disparaîtrait sans un mot.
- Chemins résolus par `portable.rs` : `data/sgpa.db`, `data/sgpa.keys`, `data/.sgpa.lock`, `data/backups/`, `data/logs/`, `data/webview/`, et `exports/` **à côté de l'exe** (ce sont des documents que l'enseignant va chercher, pas des fichiers internes — et c'est pourquoi « Ouvrir » une pièce jointe y écrit une copie **en clair** : seul moyen que Word s'en saisisse). La racine est éprouvée par un fichier sonde : un `create_dir_all` qui réussit ne prouve pas qu'on peut écrire.
- Variables d'échappement : `SGPA_DATA_DIR` impose une autre racine de données, `SGPA_DEVICE_DIR` un autre dossier pour `poste.bin`.
- Journal SQLite en **TRUNCATE, pas en WAL** : le WAL crée `sgpa.db-wal` et `sgpa.db-shm`, donc « je copie `sgpa.db` sur mon disque » produit une sauvegarde périmée sans que rien ne le signale.
- `locking_mode = EXCLUSIVE` a **disparu**. La détection d'une seconde instance est un fichier de verrou, `data/.sgpa.lock`, ouvert en `share_mode(0)` par `portable::acquire_lock` avant la fenêtre ; échec → `DbError::AlreadyOpen` dans la `MessageBoxW`. Le `File` rendu doit vivre autant que le processus : `AppState` le garde. Windows le relâche à la mort du processus, plantage compris — aucun verrou fantôme, rien à nettoyer à la main.

### Journal de diagnostic

En release, `windows_subsystem = "windows"` supprime la console : une panique Rust, une exception de rendu React, un palier de migration en échec ne laissaient **aucune trace**. D'où `data/logs/sgpa-AAAA-MM-JJ.log`, un fichier par jour, quinze jours conservés, 1 Mio par fichier au plus.

- **En clair, et délibérément hors de la base.** La panne qu'il doit couvrir inclut « la base ne s'ouvre plus » : un journal rangé dans `sgpa.db` serait illisible précisément le jour où il sert.
- **Conséquence non négociable : il ne contient aucune donnée personnelle.** Ce n'est pas une consigne de vigilance, c'est une contrainte de forme — `diagnostics::log_command_failure` ne prend **que le nom de la commande**, et n'a aucun paramètre `message` où le prénom d'un élève pourrait se glisser. Un tel paramètre s'ajouterait un jour « juste pour mieux diagnostiquer » : `commands/absences.rs` interpole déjà `{prenom} {nom}` dans son message d'erreur.
- **`journal::*` n'échoue jamais et ne panique jamais** : il est appelé depuis le crochet de panique, comme `db/holidays.rs` l'est depuis une migration. Un dossier non installé rend l'écriture muette — **pas de repli sur `exe_dir()`**, qui écrirait hors du dossier de données et sèmerait des fichiers sous `target/` pendant les tests. Même règle pour `db/holidays.rs` : un `?` à cet endroit détruirait `data/sgpa.keys`.
- `journal::init` + `installer_capture_de_panique` sont appelés dans `start()` **juste après `portable::resolve()`**. Un échec de `resolve` lui-même n'est donc pas journalisable : il n'y a alors aucun dossier où écrire, et c'est `fatal()` qui le dit par sa `MessageBoxW`.
- Les `eprintln!` existants ont été **convertis**, pas doublés. Le journal `eprintln!` toujours, donc la console de `tauri dev` est inchangée. Restent volontairement en `eprintln!` : `journal.rs` lui-même, `fatal()`, et `sql_smoke.rs`.

### Les 123 commandes

Enregistrées dans `src-tauri/src/lib.rs` (`generate_handler!`), groupées par module :

| Module | N | Commandes |
| --- | --- | --- |
| `lock` | 13 | `get_lock_status`, `setup_lock`, `unlock`, `unlock_with_pin`, `enable_pin`, `disable_pin`, `recover`, `lock`, `change_password`, `regenerate_recovery`, `set_password_hint`, `get_settings`, `update_settings` |
| `sessions` | 5 | `get_sessions`, `get_session`, `create_session`, `update_session`, `delete_session` |
| `students` | 6 | `get_students`, `create_student`, `create_students_bulk`, `update_student`, `get_student_deletion_impact`, `delete_student` |
| `needs` | 7 | `get_need_tags`, `create_need_tag`, `update_need_tag`, `delete_need_tag`, `get_session_needs`, `set_student_needs`, `update_student_needs_note` |
| `referential` | 6 | `get_referential_tree`, `create_nodes_bulk`, `rename_node`, `delete_node`, `reorder_nodes`, `archive_competency` |
| `seances` | 11 | `get_seances`, `create_seance`, `update_seance_meta`, `update_seance_content`, `set_seance_content_waived`, `delete_seance`, `get_attendance`, `set_attendance`, `set_bulk_attendance`, `reset_attendance`, `create_seance_from_slot` |
| `attachments` | 10 | `get_seance_attachments`, `add_seance_attachment`, `read_seance_attachment`, `export_seance_attachment`, `delete_seance_attachment`, et les cinq mêmes en `_entry_` pour un rendez-vous |
| `evaluations` | 8 | `get_evaluations`, `create_evaluation`, `update_evaluation`, `delete_evaluation`, `get_evaluation_competencies`, `get_grades`, `set_grade`, `delete_grade` |
| `home` | 2 | `get_upcoming_days`, `get_home_overview` |
| `timetable` | 15 | `get_available_academies`, `get_day_schedule`, `get_week_schedule`, `get_year_calendar`, `get_timetable_slots`, `create_timetable_slot`, `update_timetable_slot`, `delete_timetable_slot`, `create_agenda_entry`, `get_agenda_entry`, `update_agenda_entry_meta`, `update_agenda_entry_content`, `set_agenda_entry_content_waived`, `delete_agenda_entry`, `get_student_agenda_entries` |
| `absences` | 4 | `get_absence_periods`, `create_absence_period`, `update_absence_period`, `delete_absence_period` |
| `trimesters` | 3 | `get_trimester_bounds`, `preview_trimester_recompute`, `update_trimester_bounds` |
| `progressions` | 18 | 4 sur les domaines (`get` / `create` / `rename` / `delete_progression_domaine`), `get_progression`, `create_progression`, `update_progression_meta`, 4 sur les étapes (+ `reorder_progression_etapes`), 4 sur les activités (+ `reorder_progression_activites`), `set_progression_activite_etape`, `set_progression_plages`, `clear_progression_plages` |
| `contracts` | 5 | `get_contract_sheet`, `suggest_contract_sheet`, `save_contract_sheet`, `get_professional_fields`, `create_professional_field` |
| `reports` | 2 | `get_report`, `save_report_comment` |
| `diagnostics` | 4 | `get_journal_info`, `reveal_logs_dir`, `log_command_failure`, `log_ui_error` |
| `maintenance` | 4 | `create_backup`, `list_backups`, `reveal_data_dir`, `save_export` |

- Le référentiel n'a pas de commandes unitaires par niveau : il se manipule par **arbre** (`get_referential_tree` renvoie `cycles → domaines → champs → compétences`) et par lot (`create_nodes_bulk` accepte un collage multi-lignes venu d'un tableur, `kind` valant `cycle` | `domain` | `field` | `competency`).
- `diagnostics::get_journal_info` et `reveal_logs_dir` **n'exigent pas la session déverrouillée** : le moment où un diagnostic manque le plus est celui où la base refuse de s'ouvrir, donc avant le mot de passe. Aucune des deux ne touche la base — et c'est pourquoi `diagnostics.rs` n'est pas dans les `SOURCES` de `sql_smoke`.
- `timetable::get_day_schedule` est orpheline depuis la suppression de l'onglet « Journée » : aucun écran ne l'appelle.

---

## 5. Modèle de données — 36 tables

Schémas de référence, abondamment commentés : `001_initial.sql` pour le socle, puis le palier qui a introduit la table que l'on touche — `012_pieces_jointes.sql`, `013_besoins_particuliers.sql`, `016_rendez_vous_classe.sql`, `018_note_sur_20.sql`, `019_progression.sql`. Les décisions qui s'y trouvent ne se devinent pas depuis le code appelant : les lire avant d'écrire une requête.

```
app_settings  trimester_bounds  professional_fields  school_holidays
cycles  domains  fields  competencies  savoir_groups  savoirs
sessions  students  student_need_tags  student_needs
  absence_periods  stage_placements
timetable_slots  agenda_entries  agenda_entry_attachments
seances  attendance_records  seance_attachments
evaluations  evaluation_competencies  grades
contract_sheets  contract_sheet_rows  contract_sheet_students
  contract_sheet_requirements  contract_sheet_savoirs
report_comments
progression_domaines  progressions  progression_etapes
  progression_activites  progression_plages
```

Points qui changent tout, et qui ne se lisent pas dans le code appelant :

- **Une session EST une classe pour une année scolaire**, avec `level_code` (`6eme`, `5eme`, `4eme`, `3eme`, `3eme_prepa`) et `year_start` (entier : 2021 signifie 2021-2022). Le niveau et l'année ne vivent nulle part ailleurs — `evaluations.school_year` et `report_comments.school_year` ont disparu.
- **Le trimestre est stocké** sur `seances` et sur `evaluations`, dérivé de la date par `db::trimester_for` à partir de `trimester_bounds`, avec `trimester_is_manual` qui protège la correction faite à la main par l'enseignant. **Le front ne recalcule jamais un trimestre** : deux implémentations de la même règle divergeraient au premier changement de bornes. `trimester_bounds` stocke des bornes **contiguës** (`t1_start`, `t2_start`, `t3_start`, `year_end`) : ni trou ni chevauchement possible.
- **L'appel non fait est un état réel** : `attendance_records.status` vaut `non_fait` | `present` | `absent` | `retard` | `excuse`. L'absence de ligne vaut « non fait », jamais « présent » — pré-remplir à `present` donnait une assiduité parfaite à qui oubliait l'appel. Deux niveaux distincts : `seances.attendance_taken_at IS NULL` (l'appel n'a pas été fait ce jour-là) et ligne absente ou `non_fait` (cet élève-là n'est pas renseigné).
- `students.enrolled_on` / `left_on` bornent l'assiduité : sans eux, « absent » et « pas encore inscrit » sont indiscernables. La valeur par défaut à la création est le `t1_start` de l'année de la session, **jamais** `date('now')`.
- `seances.cancelled` sort une séance annulée des statistiques d'assiduité tout en la gardant au cahier de texte.
- **`content_waived_at` (le « rien à écrire ») n'est pas une annulation** — palier 014, puis 017 pour `agenda_entries`. Une séance annulée n'a pas eu lieu et sort du dénominateur d'assiduité ; une séance sans contenu a eu lieu et son appel compte. Ne jamais faire porter l'un par l'autre. Un rendez-vous ne s'annule pas (il se supprime), donc il n'a pas ce troisième cas.
- **Un compte rendu est réglé de trois façons, et il faut les trois partout** : du texte, un « rien à écrire », **ou** au moins une pièce jointe — la photo du tableau *est* le compte rendu. « Vide » n'est pas `= ''` : l'éditeur rend `<p></p>`. La règle vit en **deux endroits, un par couche**, qui doivent dire la même chose : les `REPLACE` et `EXISTS` de `SEANCES_PASSEES` / `ENTREES_PASSEES` dans `commands/home.rs`, et `etatDuCompteRendu` / `compteRenduRegle` dans `src/lib/contenu.ts`. **Aucun écran ne lit `has_content` seul.**
- `competencies.archived_at` : une compétence utilisée par une évaluation ou portant une note ne peut pas être supprimée (`ON DELETE RESTRICT` sur `evaluation_competencies` et `grades`), elle s'archive.
- **`grades.mark` est une note sur 20, entière, et le libellé de maîtrise n'en est que la lecture** (palier 018). La chaîne allait dans l'autre sens avant : l'enseignant cliquait un degré et la note s'en déduisait. Les cinq tranches — 1-4 insuffisante, 5-8 fragile, 9-12 presque, 13-16 satisfaisante, 17-20 très bonne — vivent **dans un seul endroit**, `MASTERY_BANDS` et `niveauDeNote` (`src/types/index.ts`) : ni CHECK, ni colonne calculée, ni table de correspondance, et **le backend ne nomme jamais un degré** — il stocke un nombre et en vérifie les bornes. **Il n'y a pas de note de 0** : « non évalué » est l'absence de ligne, donc effacer est `delete_grade` et jamais `set_grade(…, 0)`.
- **Les besoins particuliers sont des données de santé concernant des mineurs** (`student_need_tags`, `student_needs`, `students.needs_note`, palier 013). Ils s'affichent à l'écran — appel, grille de notation, liste des élèves, bilans — et sur **aucun document imprimé, jamais**. Décision explicite de l'auteur, tenue par un test qui **relit du code source** (voir §8).
- **Les pièces jointes sont des BLOB**, dans `seance_attachments` pour une séance et `agenda_entry_attachments` pour un rendez-vous — **deux tables et non une colonne « porteur »** : SQLite refuse une clé étrangère vers deux tables, et une cascade écrite à la main laisserait des BLOB orphelins. Une logique unique par-dessus (`Porteur` + `Requetes` dans `commands/attachments.rs`), des requêtes **littérales choisies par un `match`** et jamais un `format!`, pour que `sql_smoke` les prépare. 10 Mo par fichier (`MAX_ATTACHMENT_BYTES`, vérifié sur les octets **décodés**, pas sur le base64 reçu). Ce ne sont pas des fichiers à côté de la base : `VACUUM INTO` les emporte dans les sauvegardes, et elles sont chiffrées comme le reste.
- **Un rendez-vous (`agenda_entries`) peut nommer une classe, un élève, les deux ou aucun des deux** : un conseil de classe concerne une classe, une ESS un élève, une réunion d'équipe personne. Quand un élève est désigné, la classe est **déduite de lui** par `resolve_entry_session`, et un couple contradictoire est **refusé**, jamais rectifié en silence. Ni l'une ni l'autre colonne ne s'écrit après la création — `update_agenda_entry_meta` n'y touche pas. `session_id` est en **CASCADE** comme `student_id`.
- **La progression annuelle est un plan, et rien qu'un plan** (palier 019) : elle ne touche ni séance, ni appel, ni bilan. **Une seule par classe** — `progressions.session_id` est `UNIQUE` —, donc « Gr 2 » est un **libellé imprimé** (`intitule_groupe`) et non une entité. Trois niveaux : l'**étape** (`progression_etapes`) porte les compétences, connaissances et priorités, en **texte libre**, sans citer `competencies` ; l'**activité** (`progression_activites`) est ce qu'on fait ; la **plage** (`progression_plages`) est une case de frise, désignée par le **lundi** de sa semaine et sa bande (`voie`, 0 ou 1), **jamais par un numéro ISO** — un numéro n'a pas d'année, et la semaine 1 de 2027 suit la 53 de 2026.
- **Le rang d'une activité est calculé en Rust** (`commands/progressions.rs`) en parcourant `(etape.position, activite.position)`, et il est **0-fondé** : un numéro imprimé est `rang + 1`. C'est lui, et rien d'autre, qui donne sa couleur (`teinteDeActivite`, roue des teintes par l'angle d'or depuis 45°). Calculé une fois côté Rust pour que l'écran et le PDF ne puissent pas colorier différemment la même activité : **ne pas le recalculer** depuis l'index d'un `map`.
- **Les semaines sont les vraies semaines**, rendues par `get_year_calendar`, et une semaine appartient au mois **et** au trimestre qui contiennent son **jeudi** : c'est une partition, donc ni colonne dédoublée ni semaine orpheline. Ne pas regrouper par `monday.slice(5, 7)`. 2026-2027 en compte quarante-cinq. Les fermetures sont **lues de `school_holidays`** et non peintes à la main, et une semaine fermée **reste peignable**. Elles sont filtrées par **`app_settings.academie`** (`commands/timetable.rs`, `WHERE sh.academie = (SELECT academie FROM app_settings WHERE id = 1)`) : sans académie choisie, la frise ne montre que les fériés nationaux calculés, et **ce n'est pas un bug** — c'est Réglages qui manque. Première chose à vérifier quand « les vacances n'apparaissent pas ».
- Le référentiel est **livré pré-rempli** (paliers 002 et 009) : les 5 domaines du socle commun, les 4 composantes du domaine 1, et les savoirs du socle. **`professional_fields`, `student_need_tags` et `progression_domaines` sont volontairement vides à la livraison** — ce sont le vocabulaire de l'enseignant : **ne rien y semer**. `progression_domaines` est **global** et non par classe (un domaine exploré en 4ᵉ et en 3ᵉ est le même domaine), et le backend refuse de supprimer un domaine employé, d'où `activity_count` rendu à la lecture : l'écran doit le savoir **avant** de proposer le bouton.

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
- **Un composant n'écrit jamais une couleur.** Il n'écrit que des jetons — `bg-card`, `shadow-carte`, `font-titre`, `teinte-carte` —, réglés dans `:root` par `src/index.css`. **Un seul jeu, sans sélecteur conditionnel** : il n'y a plus de choix de thème, donc plus d'attribut `data-theme`, plus de `src/lib/theme.ts`, plus de sélecteur dans Réglages. La discipline reste, et c'est elle qui vaut : un mode sombre s'ajoutera en un bloc (`@custom-variant dark` est déjà déclaré), et une couleur écrite en dur dans un composant ne suivra pas.
- **Chaque classe a sa teinte**, assignée par position dans son année scolaire (`src/lib/teintes.ts`), **jamais par hachage de l'`id`** : avec quatre classes, un hachage sur dix teintes donne une collision une fois sur deux. `styleTeinte()` pose `--classe-h` en style en ligne, `teinte-carte` / `teinte-appui` / `teinte-plein` / `teinte-encre` la lisent. **Ne pas remettre de `border-primary/30` ni de `hover:bg-primary/20` sur une carte teintée** : la couche `utilities` de Tailwind passe après `components` et les emporterait en silence.
- **Filet franc = l'objet existe ; filet pâle = il est seulement prévu.** C'est le seul signe d'état des cartes de calendrier : une séance créée à cette date ajoute `teinte-appui` à `teinte-carte`, un rendez-vous l'a toujours. **Ne pas réintroduire de barre d'accent le long du bord gauche** (`border-l-4`) : elle a été retirée partout parce qu'elle ajoutait un ornement à côté de la carte là où la carte pouvait le dire elle-même.
- Aucune police n'est téléchargée. L'application est hors ligne par principe, donc seules les fontes livrées avec Windows sont nommées (`Segoe UI`, `Constantia`), et les PDF s'en tiennent au `helvetica` intégré à jsPDF.
- `localStorage` est admis pour une préférence d'affichage — la largeur du menu, et rien d'autre à ce jour —, **jamais pour une donnée**.
- **Le glisser-déposer passe par le DOM, pas par Tauri** : `lib.rs` appelle `disable_drag_drop_handler()`. L'événement de Tauri ne porte que des **chemins**, il aurait fallu lire le fichier en Rust et sauter la réduction à 1600 px — une photo de téléphone lâchée aurait été refusée à 8 Mo quand la même, choisie au bouton, passe à 300 Ko. Contrepartie obligatoire : privé du gestionnaire de Tauri, WebView2 **navigue vers le fichier lâché** et l'application disparaît derrière lui, sans barre d'adresse pour revenir. D'où `interdireNavigationParDepot` (`src/lib/depot.ts`), posé sur `document` dans `App()` **au-dessus du garde de verrouillage**. Toute nouvelle zone de dépôt teste `estDepotDeFichiers` d'abord, et écoute en phase de **capture** avec `stopPropagation`, sinon ProseMirror voit le dépôt et insère le chemin du fichier comme texte.
- **Un PDF ne passe jamais par `doc.save()`** : le téléchargement navigateur déposait des bilans nominatifs d'élèves mineurs dans le dossier `Téléchargements` du poste hôte. Toujours `api.saveExport(fileName, bytes, openAfter)`, qui écrit dans `exports/`, sur la clé — et `openAfter` est **faux par défaut**, parce qu'ouvrir le PDF inscrit son chemin dans les documents récents du poste.
- **Trois filets d'erreur côté front, qui ne se remplacent pas** : `LimiteErreur` pour le **rendu** (monté au-dessus du garde de verrouillage — une fenêtre blanche sur l'écran de mot de passe n'offre aucun moyen d'entrer), les écouteurs globaux de `lib/journal.ts` pour les gestionnaires et les promesses, `DataState` pour les erreurs de commande. `lib/journal.ts` ne livre d'une ressource en échec que le **schéma** de son URL, jamais l'URL : les pièces jointes s'affichent par des URL `data:`, donc journaliser l'URL d'une image recopierait la photo dans le fichier de journal.

### Qui définit, qui ouvre, qui écrit — la règle des écrans

Elle vient d'un bug réel : deux écrans qui modifient la même chose finissent par ne pas en dire la même chose.

- **L'emploi du temps définit, l'accueil ouvre.** `pages/Timetable` règle la grille hebdomadaire, pose un rendez-vous daté, pose un cours ponctuel — et n'héberge **aucun écran de séance** : une carte y ouvre sa **définition**, jamais son **contenu**. L'appel, le cahier de texte et les deux gestes qui font naître l'occurrence d'un cours (`OccurrenceDialog` → `createSeanceFromSlot`, avec ou sans `cancelled`) vivent à l'accueil ou dans la fiche de classe. L'onglet « Journée » a été **supprimé** pour cette raison. `WeekGrid` n'a donc **pas** de `onOpenSeance` — ne pas le remettre. **Une seule exception, assumée** : le compte rendu d'un rendez-vous s'ouvre depuis la grille, parce qu'**aucun autre écran ne liste les rendez-vous**.
- **La progression s'écrit dans la fiche de classe, l'emploi du temps la montre.** L'onglet « Progression » de `SessionDetail` est le **seul** endroit où une progression se modifie ; l'onglet « Année » de `pages/Timetable` (`YearGrid`, adressable par `?vue=annee`, « Semaine » par défaut) ne fait que **lire**, et le nom de la classe y est un lien vers l'endroit où elle s'écrit. Ce que la vue annuelle apporte et que la fiche de classe ne peut pas donner : la **comparaison** — la semaine où trois classes font la même chose, celle où rien n'est prévu, les trous du calendrier.
- **Les écrans qui montrent la même chose partagent leur code, pas seulement leur dessin.** Les aides qui disent ce qu'une journée contient sont dans `pages/Timetable/journee.ts` et la géométrie des calendriers dans `geometry.ts` : `WeekGrid` et `DaysCalendar` les partagent. Les deux frises partagent `src/components/FriseEntetes.tsx` (`ColonnesDeFrise`, `EntetesDeFrise`, `LARGEUR_SEMAINE`) et `src/lib/progression.ts` (`casesDeVoie`, `tranchesParMois` / `tranchesParTrimestre` / `tranchesParMotif`, `MOTS_DE_VOIE`, `MOTS_DE_SEMAINE`). Les quatre vues qui parlent de contenu (`DaysCalendar`, `WeekGrid`, `SeancesTab`, `StudentsTab`) prennent leurs **mots** dans `lib/contenu.ts` (`motsDuCahier`, `motsDuCompteRendu`) : quatre états, un vocabulaire. Deux implémentations divergeraient au premier créneau à quinzaine, et l'accueil annoncerait un cours que l'emploi du temps ne montre pas.
- **Le PDF de progression** (`exportProgressionPDF`, `src/lib/pdf.ts`) est en **paysage** : quarante-cinq semaines sur une feuille portrait donnent des colonnes de quatre millimètres. Il dit deux fois la même année — la frise, puis le tableau des étapes —, et c'est le **numéro** de l'activité qui relie les deux ; la couleur ne fait que l'appuyer, parce qu'une progression finit punaisée au mur après un passage par un photocopieur en noir et blanc. Sa frise est dessinée au `rect` et non par `autoTable` (un `colSpan` par trait aurait interdit d'écrire le numéro dans la première case seulement). **Un seul objet** en paramètre (`ProgressionPdfInput`) : six paramètres positionnels de même type se seraient inversés au premier appel, et une classe échangée avec une autre imprime une progression fausse sous le bon nom.

### Indentation — le dépôt n'est pas homogène, et c'est intentionnel de le respecter

| Emplacement | Indentation |
| --- | --- |
| `src/types/index.ts`, `src/lib/api.ts`, `pdf.ts`, `progression.ts`, `teintes.ts`, `password.ts` | **tabulations** |
| `src/lib/contenu.ts`, `depot.ts`, `journal.ts` | **2 espaces** (les plus récents) |
| `src/pages/`, `src/components/`, `src/hooks/`, `src/App.tsx`, `src/main.tsx` | **2 espaces** |
| `src-tauri/**/*.rs` | 4 espaces (rustfmt) |
| `package.json`, `src-tauri/tauri.conf.json` | 4 espaces (`scripts/bump.mjs` réécrit avec `JSON.stringify(…, null, 4)`) |
| `tsconfig.json`, `vite.config.ts` | tabulations |
| `.github/workflows/build.yml`, `scripts/bump.mjs` | 4 espaces |

Il n'y a **ni Prettier ni ESLint** dans le projet : rien ne reformatera à votre place, et un fichier réindenté en entier produit un diff illisible. Suivre le style du fichier que l'on modifie — et de même pour les **fins de ligne**, qui sont par fichier : `src/types/index.ts`, `src/lib/api.ts`, `src-tauri/src/lib.rs`, `commands/mod.rs`, `db/migrations.rs` et `sql_smoke.rs` sont en CRLF, le reste en LF. `cargo fmt --check` n'est **pas** propre sur tout le dépôt (reflux d'accents antérieur) : le garde-fou de style côté Rust est `cargo clippy`, pas `cargo fmt`.

---

## 7. Pièges concrets, déjà rencontrés

**`toISOString()` décale la date d'un jour et fausse le trimestre.** En UTC, une séance créée le 1er décembre à 00h30 est datée du 30 novembre, donc rangée au trimestre précédent. Pour le jour courant : `new Date().toLocaleDateString("sv-SE")` (le locale suédois donne `AAAA-MM-JJ`). Pour afficher une date ISO venue de la base : `new Date(iso + "T00:00:00").toLocaleDateString("fr-FR")` — le suffixe `T00:00:00` force l'heure locale, `new Date("2025-12-01")` seul vaut minuit UTC et recule d'un jour.

**`pragma_update` ignore la valeur retournée par `PRAGMA journal_mode`.** Il passe par `execute_batch`, qui jette la ligne de résultat ; or `PRAGMA journal_mode` renvoie le mode **réellement** appliqué. Sans lecture, la base peut rester silencieusement en WAL. Il faut `conn.query_row("PRAGMA journal_mode = TRUNCATE", [], |row| row.get(0))` puis comparer la valeur reçue — c'est ce que fait `open_encrypted()` dans `db/mod.rs`.

**Compiler exige Perl.** `rusqlite` est pris en `bundled-sqlcipher-vendored-openssl` : OpenSSL est compilé depuis les sources, et son `Configure` est un script Perl qui a besoin du module `Text::Template`. Strawberry Perl doit être dans le `PATH` de toute commande cargo (`C:\Strawberry\perl\bin`). NASM, en revanche, n'est **pas** nécessaire : `openssl-src` passe `no-asm` en dur. Et le dépôt doit rester haut dans l'arborescence : sous un chemin profond, l'extraction d'OpenSSL dépasse la limite de 260 caractères de Windows et `Configure` échoue sur des fichiers « missing » sans jamais nommer la cause. Première compilation ~7 minutes, ensuite en cache. Côté utilisateur final, tout cela est invisible : le lien est statique, aucune DLL OpenSSL n'accompagne `SGPA.exe`.

**`PRAGMA key` doit précéder toute autre instruction**, y compris les autres pragmas, sinon SQLCipher tente de lire des pages chiffrées sans clé. Et il n'authentifie rien : sur un fichier neuf comme sur une mauvaise clé, il réussit. C'est la lecture de contrôle qui suit (`SELECT count(*) FROM sqlite_master`) qui tranche.

**`PRAGMA foreign_keys` est ignoré à l'intérieur d'une transaction.** Il doit être posé **avant** de l'ouvrir : voir la suspension puis le rétablissement autour de chaque palier dans `db/migrations.rs`.

**`VACUUM INTO` refuse une cible qui existe déjà, et ne peut pas être appelé dans une transaction.** Les deux appelants (`migrations::backup_before_migration`, `maintenance::create_backup`) testent donc l'existence du fichier avant. Le chemin cible est toujours construit par le code, jamais par une saisie utilisateur. Ne pas remplacer par un `std::fs::copy` du fichier ouvert : il peut capturer une lecture déchirée, c'est-à-dire une sauvegarde inutilisable qui ne se signale qu'au moment où on en a besoin.

**jsPDF ne tronque rien.** `doc.text` écrit son texte au-delà de la case, de la colonne et de la page, sans rien signaler : un intitulé d'activité un peu long chevauche le trait voisin de la frise. D'où `tronquerA(doc, texte, largeur)` dans `pdf.ts`, appelé partout où le texte est dessiné à la main — `autoTable`, lui, gère sa propre largeur. Et sur la frise, c'est le **numéro** qui est écrit en priorité : quand l'intitulé complet ne tient pas, on garde le numéro seul, parce que c'est lui qui relie la frise au tableau.

**Il n'existe pas de composant `Checkbox` dans `src/components/ui/`.** Les cases à cocher sont des `<input type="checkbox">` natifs enveloppés dans un `<label>`, avec `className="h-4 w-4 cursor-pointer rounded border-input accent-primary"` — voir `SeanceDetail.tsx` (séance annulée) et `Settings.tsx` (verrouiller à la réduction). Ne pas installer un composant shadcn pour une case de plus.

**`state.conn()` renvoie un `ConnGuard`**, qui déréférence vers `Connection`. Écrire `conn.execute(…)` et passer `&conn` marche comme avant ; pour ouvrir une transaction il faut toujours `let mut conn = state.conn()?;`. Et le garde ne doit jamais être conservé pendant une opération coûteuse (Argon2id, parcours de dossier, écriture de fichier) : tout le reste de l'application attend derrière.

**Le harnais `tauri::test::mock_builder` ne fonctionne pas ici.** Ses binaires de test meurent au démarrage sous Windows avec `STATUS_ENTRYPOINT_NOT_FOUND` : `tauri-build` n'embarque son manifeste Windows que dans l'exécutable de l'application. Ne pas réessayer sans résoudre ce point d'abord ; `sql_smoke.rs` est le contournement en place.

**`@tanstack/react-table` et `@radix-ui/react-dropdown-menu` sont déclarés dans `package.json` mais jamais importés.** Leur présence n'est pas une convention à suivre.

---

## 8. Tests et vérifications

```powershell
cargo test --lib     # depuis src-tauri/ — 178 tests
cargo clippy         # doit rester à zéro avertissement
pnpm exec tsc --noEmit
```

Répartition : `keys.rs` 24, `commands/timetable.rs` 16, `db/migrations.rs` 15, `commands/reports.rs` 15, `commands/absences.rs` 13, `commands/maintenance.rs` 12, `db/mod.rs` 9, `db/holidays.rs` 8, `commands/seances.rs` 8, `journal.rs` 6, `device.rs` 6, `commands/trimesters.rs` 6, `commands/students.rs` 6, `portable.rs` 5, `commands/reports/scoring.rs` 5, `commands/referential.rs` 5, `commands/progressions.rs` 5, `commands/contracts.rs` 5, `commands/timetable/feries.rs` 4, `commands/attachments.rs` 3, `sql_smoke.rs` 1, `commands/needs.rs` 1.

`keys.rs` vérifie les deux enveloppes, le rejet d'un mauvais mot de passe et d'une phrase étrangère, la normalisation de la saisie, la régénération qui invalide l'ancienne phrase, l'échec d'une interversion des enveloppes grâce à l'AAD, l'écriture atomique, l'absence de toute identité dans le fichier et le fait que les secrets refusent de s'afficher. `db/mod.rs` ajoute l'aller-retour chiffré, le refus d'une mauvaise clé, l'illisibilité du fichier sur le disque et le fait qu'une sauvegarde `VACUUM INTO` reste chiffrée.

Trois tests tiennent une décision plutôt qu'un calcul, et comptent à ce titre plus que leur ligne :

- **`commands/needs.rs` relit du code source**, et non une base : il ouvre `commands/reports.rs`, `commands/reports/scoring.rs`, `commands/contracts.rs` et `src/lib/pdf.ts`, et échoue si l'un d'eux cite `student_need_tags`, `student_needs` ou `needs_note`. C'est la décision « jamais imprimé » rendue exécutable. Si un de ces fichiers est déplacé, **corriger le chemin dans le test — ne pas retirer la ligne de la liste.** Et `src/lib/pdf.ts` y figure délibérément : c'est lui qui dessine réellement les PDF, un garde-fou qui s'arrêterait à la frontière du Rust laisserait passer exactement l'erreur qu'il surveille.
- **`db::migrations::tests::une_base_v14_peuplee_traverse_le_palier_015_intacte`** tient le piège de la règle « compétence retirée = `ignore` » : supprimer réellement ces notes donnerait le même bilan et serait irréversible. Chaque palier qui touche à des données existantes a son jumeau — `…v17_notee_traverse_le_palier_018_sans_perdre_un_libelle`, `…v18_peuplee_traverse_le_palier_019_intacte` : un nouveau palier destructif s'écrit avec le sien.
- **`journal.rs` et `db/holidays.rs`** portent chacun le test qu'un dossier impossible ne fait **rien** échouer — ils sont appelés depuis le crochet de panique et depuis une migration.

Les 5 tests de `commands/progressions.rs` vérifient que le rang suive `(étape, activité)` et non l'ordre d'insertion, qu'une activité d'une autre classe soit refusée, qu'une plage se désigne par un lundi, que la frise n'ait que deux bandes, et que supprimer une étape ne laisse pas une plage orpheline.

Le plus utile reste `sql_smoke` : il extrait les requêtes littérales des modules de commandes et les fait **préparer** par SQLite contre le schéma migré. Une colonne renommée, une table oubliée ou une faute de frappe sont attrapées là. Il ne couvre pas la logique — une requête valide qui compte les mauvaises lignes passe — et il exige un nombre minimal de requêtes (`checked >= 225` pour 250 réellement préparées au palier 019) : si une refonte change la façon d'écrire le SQL, ce garde-fou se plaint au lieu de ne plus rien vérifier. **Abaisser ce seuil doit rester exceptionnel et temporaire.** Ajouter un module de commandes implique de l'ajouter à la constante `SOURCES` — sauf s'il ne touche pas la base, comme `diagnostics.rs` — et d'y remonter le seuil. C'est aussi pour `sql_smoke` que les requêtes variables viennent d'un `match` sur des `&'static str` et jamais d'un `format!` : une requête assemblée n'est pas préparable telle quelle, et sort de sa couverture.

Il n'y a aucun test côté JavaScript : `pnpm exec tsc --noEmit` est le seul filet du front.

---

## 9. Environnement de développement

```powershell
# PATH requis : Strawberry Perl (OpenSSL), fnm, cargo
$env:PATH = "C:\Strawberry\perl\bin;C:\Users\Theo\AppData\Roaming\fnm\node-versions\v24.14.1\installation;$env:USERPROFILE\.cargo\bin;$env:PATH"

pnpm tauri dev      # Vite sur le port 1420 + compilation Rust, puis ouverture de la fenêtre
pnpm build          # tsc && vite build (tsconfig porte noEmit)
```

- Le port **1420** est en `strictPort: true` : aucun repli sur un autre port, une instance restée ouverte bloque le lancement. **Avant de relancer, tuer l'application ET le serveur Vite** — c'est lui le coupable habituel du « port 1420 déjà utilisé » : quand `pnpm tauri dev` est interrompu, `sgpa.exe` meurt mais le Vite lancé par `beforeDevCommand` lui survit, orphelin, et garde le port.

  ```powershell
  Get-Process sgpa -ErrorAction SilentlyContinue | Stop-Process -Force
  Get-NetTCPConnection -LocalPort 1420 -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force }
  ```

  **Ne pas tuer `node` en masse** : d'autres projets peuvent tourner. Le port est le bon critère.
- En développement la base est `src-tauri/target/debug/data/sgpa.db` — le dossier de l'exécutable, comme en production. Elle est **chiffrée comme en production** : aucun outil ne l'ouvre avec le mot de passe, qui ne chiffre rien lui-même. Pour la lire, passer par `sgpa_lib::open_for_tools(<dossier data>, <mot de passe>)`, seule porte publique.
- Pour reproduire l'écran d'erreur fatale : `$env:SGPA_DATA_DIR = "C:\Windows\System32\config\sgpa-data"` avant de lancer l'exe, puis `Remove-Item Env:\SGPA_DATA_DIR`.
- Le rechargement du front est à chaud ; une modification d'un `.rs` recompile et relance la fenêtre.
- Jeux de démonstration : `cargo run --example seed_demo -- target\debug\data <mot de passe>`, `seed_fiche_contrat` et `seed_progression` (`src-tauri/examples/`) — ce dernier pose trois classes de la même année, leurs créneaux, et une progression par classe avec ses étapes, ses activités et ses semaines peintes. Ils prennent le dossier `data/` et le mot de passe défini au premier lancement, la base étant chiffrée, et exigent une base déjà migrée. `examples/` n'est pas compilé dans l'application. **Ils ne sèment ni champ professionnel, ni étiquette de besoin** : ces vocabulaires appartiennent à l'enseignant. **Une seule exception, assumée : `seed_progression` sème des domaines de progression**, et c'est le seul endroit du dépôt qui en sème — une frise sans domaine ne montre pas la colonne « Domaine » du PDF, donc un jeu d'essai qui s'en priverait ne servirait à rien. L'application, elle, les livre toujours vides ; si cette exception devait tomber, c'est le semis qu'on retire, pas la règle. `seed_fiche_contrat` *lit* `professional_fields` et se contente du libellé si le champ manque — même arbitrage que `resolve_field` dans les commandes : un défaut de référentiel ne vide pas une fiche.

### CI — `.github/workflows/build.yml`

Sur chaque push vers `main` dont le message ne contient pas `[skip ci]`, sur `windows-latest` : vérification de Perl et du module `Text::Template` (prérequis d'OpenSSL, installés si l'image du runner ne les fournit pas), `pnpm exec tsc --noEmit`, `cargo test --lib`, puis incrément de version patch par `node scripts/bump.mjs patch` (qui écrit `src-tauri/tauri.conf.json`, `package.json` et `src-tauri/Cargo.toml`), commit `[skip ci]`, `pnpm tauri build --no-bundle`, assemblage d'un ZIP contenant `SGPA.exe` et `LISEZ-MOI.txt`, publication d'une release GitHub. Une version mineure se déclenche à la main : `pnpm version:minor`.

L'étape Perl est délibérément placée **avant** le bump de version : un échec de compilation d'OpenSSL après le commit `[skip ci]` et son `git push` laisserait le dépôt avec une version incrémentée et aucune release.

---

## 10. Décisions en attente — ne pas trancher seul

Ces points appartiennent à l'enseignant. S'y substituer produirait des documents faux remis à des familles.

1. ~~Règle de la moyenne générale~~ — **arrêtée le 2026-11-06** : `unweighted_mean`, et réglable dans Réglages.
2. ~~Sort des notes d'une compétence retirée d'une évaluation~~ — **arrêtée le 2026-11-06** : `ignore`, la règle vivant dans la requête (`reports::AVERAGES_IGNORE_REMOVED`) et jamais dans le stockage.
3. **Maquette de la fiche contrat PDF**, nominative par élève. La table `contract_sheet_students` en pose le socle minimal ; le reste attend la maquette.
4. **Liste des champs professionnels SEGPA.** `professional_fields` est volontairement vide à la livraison : deux listes circulent et la référence réglementaire n'est pas vérifiée. Ne rien y semer sans confirmation.
5. **Où est l'élève qui n'a pas trouvé de stage**, pendant la période de stage de sa classe : dans les séances de l'enseignant, en permanence, ou aucune séance ces semaines-là ? Demandé le 2026-09-20, sans réponse. Ne bloque rien : le schéma et `ATTENDANCE_SQL` sont identiques sous les trois réponses, seul l'écran de suivi en dépendrait.

### Ce qui est tranché, et ne se rouvre pas seul

- **L'échelle de maîtrise.** Depuis le palier 018 la donnée est `grades.mark`, une note **entière de 1 à 20**, et les cinq libellés n'en sont que la lecture (tranches 1-4, 5-8, 9-12, 13-16, 17-20). Le découpage n'est écrit **qu'une fois**, dans `MASTERY_BANDS` / `niveauDeNote` (`src/types/index.ts`) : ne pas le recopier en CHECK, en colonne calculée ni en table de correspondance, et ne jamais faire nommer un degré par le backend. Il n'y a **pas de note de 0** : « non évalué » est l'absence de ligne, donc effacer est `delete_grade` et jamais `set_grade(…, 0)`. La saisie ne s'écrit qu'au `blur` ou à `Entrée` : taper « 14 » passe par « 1 », et une écriture par frappe enregistrerait un 1/20 bien réel.
- **L'ordre de l'échelle** : insuffisante · fragile · presque · satisfaisante · très bonne. Son classeur source inverse les niveaux 2 et 3 ; la question lui a été posée et il a retenu l'ordre du code. **Ne pas réaligner `MASTERY_SCALE` sur le classeur** (`src/lib/pdf.ts`).
- **L'élève ne voit pas sa note par compétence**, seulement le libellé, et sa **moyenne sur l'évaluation** (décision du 2026-11-07). Tenue par la **forme des données** et non par la vigilance : `EvaluationSheetCandidate.levels` ne porte que des degrés, convertis à la source dans `EvaluationDetail`, si bien que la note par compétence n'arrive même pas jusqu'à `pdf.ts`. **Ne pas ajouter de champ qui la ferait venir.**
- **La progression annuelle** (2026-11-07). De lui : les compétences, connaissances et priorités se rattachent à l'**étape** ; **une progression par classe**, sans entité « groupe » ; les couleurs sont assignées **par l'application, par position** — donc par `rang`, jamais choisies à la main ni tirées d'un hachage ; les compétences sont en **texte libre** et ne citent pas `competencies`. De moi, annoncé dans le plan qu'il a approuvé : les colonnes sont les **vraies semaines** ; les vacances sont **lues** du calendrier officiel ; les **domaines** sont livrés vides ; la vue annuelle de l'emploi du temps **montre et ne modifie pas**.

Ce qui **n'existe pas du tout** et reste à concevoir avec lui si le besoin vient : pondération des trimestres / moyenne annuelle, coefficients d'évaluation, toute notion de dispense (absente du schéma), et le suivi de stage (`stage_placements` existe, aucun écran ne l'alimente — « visite de stage non remplie » n'a pas encore de source de données).
