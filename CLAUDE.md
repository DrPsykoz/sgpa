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
pnpm tauri dev          # lance l'app (Vite sur 1420 + compilation Rust)
pnpm build              # tsc --noEmit puis vite build
cargo test --lib        # depuis src-tauri/ — 171 tests
cargo clippy            # doit rester à zéro avertissement
```

**Toute commande cargo compile OpenSSL depuis ses sources** (`rusqlite` en
`bundled-sqlcipher-vendored-openssl`) : Perl et son module `Text::Template` sont
obligatoires, et sans eux le build s'arrête sur « Command 'perl' not found ».
**NASM n'est PAS nécessaire** — `openssl-src` passe `no-asm`.

`.node-version` épingle Node à la version avec laquelle le projet est bâti. Si
`pnpm` est introuvable dans un terminal, c'est que le crochet fnm n'est pas
chargé : voir `Documents\WindowsPowerShell\profile.ps1`, qui pose le chemin de
fnm et explique pourquoi la méthode normale (`fnm env | Invoke-Expression`)
échoue sur ce poste — le PATH **machine** contient un bloc
Python collé avec ses guillemets, qui casse toute réémission du PATH.

**C'est `profile.ps1` (tous les hôtes), pas `Microsoft.PowerShell_profile.ps1`.**
Le profil nommé ne vaut que pour `ConsoleHost` : le terminal intégré de VS Code
est un autre hôte, ne le lit pas, et `pnpm` y redevient introuvable alors qu'il
marche dans la console. À défaut de profil, la ligne de secours est :

```powershell
$env:PATH = "$env:APPDATA\fnm\node-versions\v24.14.1\installation;$env:PATH"
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
- **Le code PIN n'est pas un second mot de passe.** Six chiffres font 10⁶ combinaisons : contre Argon2id, quelques minutes de carte graphique. Il n'ouvre donc jamais seul — l'autre moitié du secret est 32 octets qui vivent dans `%LOCALAPPDATA%\SGPA\poste.bin`, protégés par DPAPI (`src/device.rs`), et ne suivent pas la clé USB. Un PIN est lié à un poste **et** à un compte Windows ; partout ailleurs `pin_available` vaut faux et l'écran ne propose pas le champ. Ne jamais présenter le PIN comme un équivalent du mot de passe, ni ajouter un chemin qui l'ouvrirait sans le secret du poste.
- **Changer le mot de passe ne retire pas un PIN** : la clé maître ne bouge pas, donc l'enveloppe PIN continue de l'ouvrir. Le seul retrait est `disable_pin` (« Oublier ce poste »), qui efface `poste.bin` **puis** l'enveloppe — dans cet ordre, le secret du poste étant la moitié dangereuse.
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
data/sgpa.db   data/sgpa.keys   data/.sgpa.lock   data/backups/   data/logs/   data/webview/   exports/
```

- **`start()` n'ouvre plus la base** : résolution portable, purge des traces WebView2, `db::move_legacy_aside`, verrou de fichier, puis `AppState::new(layout, verrou)` **sans connexion**. La base s'ouvre après le mot de passe, donc après la fenêtre.
- La seconde instance est détectée par `data/.sgpa.lock` (`share_mode(0)`), pris avant la fenêtre — `PRAGMA locking_mode = EXCLUSIVE` a disparu, il aurait fallu ouvrir la base pour répondre. Le `File` doit vivre autant que le processus : il est gardé dans `AppState`.
- La fenêtre est construite **en Rust** (`lib.rs`), pas déclarée dans `tauri.conf.json`, uniquement pour pouvoir passer `data_directory` : sans elle, WebView2 écrit dans le `%LOCALAPPDATA%` du poste hôte.
- `bundle.active = false` : **ni MSI ni NSIS**. La CI produit une archive ZIP. L'utilisateur final n'installe rien : OpenSSL est lié statiquement, les seules DLL requises sont des DLL système Windows.
- Le démarrage ne panique jamais. Une erreur avant la création de la fenêtre passe par `fatal()`, qui affiche une `MessageBoxW` — en release, `windows_subsystem = "windows"` supprime la console, et l'application disparaîtrait sans un mot.
- **Une seule exception, assumée et facultative** : activer le code PIN écrit `%LOCALAPPDATA%\SGPA\poste.bin` sur le poste où on l'active (échappatoire `SGPA_DEVICE_DIR`). Rien n'est écrit tant que l'enseignant ne l'a pas activé, et « Oublier ce poste » l'efface. Toute autre écriture hors du dossier de l'exécutable est un bug.
- Variable d'échappement : `SGPA_DATA_DIR`.

## Journal de diagnostic

En release, `windows_subsystem = "windows"` supprime la console : une panique
Rust, une exception de rendu React, un palier de migration en échec ne
laissaient **aucune trace**. D'où `data/logs/sgpa-AAAA-MM-JJ.log`, un fichier
par jour, quinze jours conservés, 1 Mio par fichier au plus.

- **En clair, et délibérément hors de la base.** La panne qu'il doit couvrir
  inclut « la base ne s'ouvre plus » : un journal rangé dans `sgpa.db` serait
  illisible précisément le jour où il sert.
- **Conséquence non négociable : il ne contient aucune donnée personnelle.**
  Ce n'est pas une consigne de vigilance, c'est une contrainte de forme —
  `diagnostics::log_command_failure` ne prend **que le nom de la commande**, et
  n'a aucun paramètre `message` où le prénom d'un élève pourrait se glisser.
  Un tel paramètre s'ajouterait un jour « juste pour mieux diagnostiquer » :
  `commands/absences.rs` interpole déjà `{prenom} {nom}` dans son message
  d'erreur. Même règle côté front (`src/lib/journal.ts`) : une ressource en
  échec ne livre que le **schéma** de son URL, jamais l'URL — les pièces
  jointes s'affichent par des URL `data:`, donc journaliser l'URL d'une image
  recopierait la photo dans le fichier.
- **`journal::*` n'échoue jamais et ne panique jamais** : il est appelé depuis
  le crochet de panique, comme `db/holidays.rs` l'est depuis une migration. Un
  dossier non installé rend l'écriture muette — pas de repli sur `exe_dir()`,
  qui écrirait hors du dossier de données et sèmerait des fichiers sous
  `target/` pendant les tests.
- `journal::init` + `installer_capture_de_panique` sont appelés dans `start()`
  **juste après `portable::resolve()`**. Un échec de `resolve` lui-même n'est
  donc pas journalisable : il n'y a alors aucun dossier où écrire, et c'est
  `fatal()` qui le dit par sa `MessageBoxW`.
- Les sept `eprintln!` existants ont été **convertis**, pas doublés : ces
  points d'appel avaient déjà décidé de ce qui méritait d'être signalé, et en
  release ils le signalaient à personne. Le journal `eprintln!` toujours, donc
  la console de `tauri dev` est inchangée. Restent volontairement en
  `eprintln!` : `journal.rs` lui-même, `fatal()`, et `sql_smoke.rs` (tests).
- Côté front, trois filets qui ne se remplacent pas : `LimiteErreur` pour le
  **rendu** (monté au-dessus du garde de verrouillage, comme
  `interdireNavigationParDepot` — une fenêtre blanche sur l'écran de mot de
  passe n'offre aucun moyen d'entrer), les écouteurs globaux de
  `lib/journal.ts` pour les gestionnaires et les promesses, `DataState` pour
  les erreurs de commande.
- L'enseignant le voit dans Réglages (`get_journal_info`, `reveal_logs_dir`).
  Ces deux commandes, et les deux entrées, **n'exigent pas la session
  déverrouillée** : le moment où un diagnostic manque le plus est celui où la
  base refuse de s'ouvrir, donc avant le mot de passe. Aucune ne touche la base.

## Modèle de données

Une **session** est une classe pour une année scolaire (`level_code` + `year_start`). Le niveau et l'année ne vivent nulle part ailleurs.

Le **trimestre** est stocké sur la séance et sur l'évaluation, dérivé de la date via `trimester_bounds`, avec un drapeau `trimester_is_manual` qui protège les corrections de l'enseignant. Le front ne recalcule jamais un trimestre : deux implémentations de la même règle divergeraient au premier changement de bornes.

La **note est sur 20, entière, et le libellé de maîtrise n'en est que la lecture** (palier 018). La chaîne allait dans l'autre sens jusqu'au 2026-11-07 : l'enseignant cliquait un degré et la note s'en déduisait à raison de quatre points par degré. Il saisit maintenant la note, et `grades.mark` est la donnée. Les cinq tranches — 1-4 insuffisante, 5-8 fragile, 9-12 presque, 13-16 satisfaisante, 17-20 très bonne — vivent **dans un seul endroit**, `MASTERY_BANDS` et `niveauDeNote` (`src/types/index.ts`) : ni CHECK, ni colonne calculée, ni table de correspondance, et le backend ne nomme jamais un degré — il stocke un nombre et en vérifie les bornes. Un libellé stocké figerait le découpage au jour de la saisie. **Il n'y a pas de note de 0** : « non évalué » est l'absence de ligne dans `grades`, exactement comme l'appel non fait ci-dessus, donc effacer une note est `delete_grade` et jamais `set_grade(…, 0)` — une flèche restée enfoncée effacerait sinon une note par débordement. Et la saisie ne s'écrit qu'au `blur` ou à `Entrée` : taper « 14 » passe par « 1 », et une écriture par frappe enregistrerait un 1/20 bien réel.

**L'élève ne voit pas sa note par compétence**, seulement le libellé — une croix dans l'une des cinq colonnes — et sa **moyenne sur l'évaluation**. Décision de l'auteur du 2026-11-07, tenue par la **forme des données** et non par la vigilance : `EvaluationSheetCandidate.levels` ne porte que des degrés, convertis à la source dans `EvaluationDetail`, si bien que la note par compétence n'arrive même pas jusqu'à `pdf.ts`. Ne pas ajouter de champ qui la ferait venir.

L'**appel non fait** est un état réel (`non_fait`). L'absence d'enregistrement vaut « non fait », jamais « présent » : pré-remplir à `present` donnait une assiduité parfaite à qui oubliait l'appel.

`students.enrolled_on` / `left_on` bornent l'assiduité. La valeur par défaut est le début de l'année scolaire, **jamais** `date('now')`.

Un **rendez-vous** (`agenda_entries`) peut nommer une **classe**, un **élève**, les deux ou aucun des deux : un conseil de classe concerne une classe entière, une ESS un élève, une réunion d'équipe personne en particulier. Quand un élève est désigné, la classe est **déduite de lui** par `resolve_entry_session` — `students.session_id` est `NOT NULL`, donc les deux colonnes ne peuvent pas se contredire — et un couple contradictoire est **refusé**, jamais rectifié en silence : une rectification muette masquerait le défaut d'écran qui l'a produite. Ni l'une ni l'autre ne s'écrit après la création — `update_agenda_entry_meta` n'y touche pas, parce que le compte rendu du conseil de la 4ᵉ A ne doit pas pouvoir devenir celui de la 3ᵉ B. `session_id` est en **CASCADE** comme `student_id` : supprimer une classe emportait déjà ses rendez-vous nominatifs, et `SET NULL` aurait donné deux sorts différents à deux lignes de la même table.

Le **« rien à écrire »** est `content_waived_at`, un horodatage nullable, porté par `seances` **et par `agenda_entries`** (palier 017), et **ce n'est pas une annulation** : une séance annulée n'a pas eu lieu et sort du dénominateur d'assiduité, une séance sans contenu a eu lieu et son appel compte. Ne jamais faire porter l'un par l'autre. Un rendez-vous, lui, ne s'annule pas — il se supprime —, donc il n'a pas ce troisième cas.

Un compte rendu est **réglé** de trois façons, et il faut les trois partout : du texte, un « rien à écrire », **ou** au moins une pièce jointe — la photo du tableau *est* le compte rendu. « Vide » n'est pas `= ''` : l'éditeur rend `<p></p>`. La règle vit en **deux endroits, un par couche**, qui doivent dire la même chose : les `REPLACE` et les `EXISTS` de `SEANCES_PASSEES` / `ENTREES_PASSEES` dans `commands/home.rs`, et `etatDuCompteRendu` / `compteRenduRegle` dans `src/lib/contenu.ts`. **Aucun écran ne lit `has_content` seul** : il n'est qu'un des trois booléens, et un calendrier qui s'y arrêtait réclamait « cahier vide » à côté d'un « À reprendre » qui venait de se taire — sur le même écran, l'accueil portant les deux. Les quatre vues concernées (`DaysCalendar`, `WeekGrid`, `SeancesTab`, `StudentsTab`) prennent aussi leurs **mots** là-bas (`motsDuCahier`, `motsDuCompteRendu`) : quatre états, un vocabulaire.

Les **pièces jointes** sont des **BLOB dans `seance_attachments`** pour une séance et dans `agenda_entry_attachments` pour un rendez-vous — **deux tables et non une colonne « porteur »** : SQLite refuse une clé étrangère vers deux tables, et une cascade écrite à la main laisserait des BLOB orphelins, la seule fuite que rien ne nomme. Une logique unique par-dessus (`Porteur` + `Requetes` dans `commands/attachments.rs`, `APPELS` dans `src/components/Attachments.tsx`), des requêtes **littérales choisies par un `match`** et jamais un `format!`, pour que `sql_smoke` les prépare. Ce ne sont pas des fichiers à côté de la base : `VACUUM INTO` les emporte donc dans les sauvegardes, et elles sont chiffrées comme le reste. 10 Mo par fichier (`MAX_ATTACHMENT_BYTES`, vérifié sur les octets **décodés**, pas sur le base64 reçu), images réduites à 1600 px par le front. « Ouvrir » écrit une copie **en clair** dans `exports/` — seul moyen que Word s'en saisisse, et c'est pourquoi `exports/` vit sur la clé.

Le **glisser-déposer** passe par le DOM, pas par Tauri : `lib.rs` appelle `disable_drag_drop_handler()` sur le constructeur de fenêtre. L'événement de Tauri ne porte que des **chemins**, il aurait fallu lire le fichier en Rust et sauter la réduction à 1600 px — une photo de téléphone lâchée aurait été refusée à 8 Mo quand la même, choisie au bouton, passe à 300 Ko. **Le même geste doit donner le même résultat**, donc le dépôt et le bouton appellent tous deux `deposer` dans `SeanceAttachments`. Contrepartie obligatoire : privé du gestionnaire de Tauri, WebView2 **navigue vers le fichier lâché** et l'application disparaît derrière lui, sans barre d'adresse pour revenir. D'où `interdireNavigationParDepot` (`src/lib/depot.ts`), posé sur `document` dans `App()` **au-dessus du garde de verrouillage** — l'écran de mot de passe est justement celui où un fichier lâché ferait le plus de dégâts. Toute nouvelle zone de dépôt teste `estDepotDeFichiers` d'abord : sans ce test, elle avalerait le déplacement de texte à la souris dans l'éditeur. Et elle écoute en phase de **capture** avec `stopPropagation`, sinon ProseMirror voit le dépôt et insère le chemin du fichier comme texte.

Les **besoins particuliers** (`student_need_tags`, `student_needs`, `students.needs_note`) sont le vocabulaire de l'enseignant, **livré vide** comme `professional_fields` : ne rien y semer. Ils s'affichent à l'appel, dans la grille de notation, dans la liste des élèves et dans les bilans **à l'écran** — et sur **aucun document imprimé**, jamais. Données de santé concernant des mineurs, décision explicite de l'auteur, tenue par le test de `commands/needs.rs` (voir « Tests »). Limite assumée : un élève appartient à une classe d'une année, donc le même enfant en 4ᵉ puis en 3ᵉ est deux lignes de `students` et ses étiquettes sont à reposer en septembre ; le vocabulaire, lui, est global.

## Frontend

- **L'emploi du temps définit, l'accueil ouvre.** `pages/Timetable` règle la grille hebdomadaire, pose un rendez-vous daté, pose un cours ponctuel — et n'héberge aucun écran de séance : une carte y ouvre sa **définition**, jamais son **contenu**. L'appel, le cahier de texte et les deux gestes qui font naître l'occurrence d'un cours de chaque semaine (`OccurrenceDialog` → `createSeanceFromSlot`, avec ou sans `cancelled`) vivent à l'accueil, qui montre le jour même et les suivants, ou dans la fiche de classe, qui liste toutes les séances. L'onglet « Journée » de l'emploi du temps a été supprimé pour cette raison : il redisait l'accueil, et deux écrans qui modifient la même séance finissent par ne pas en dire la même chose. `WeekGrid` n'a donc **pas** de `onOpenSeance` — ne pas le remettre. **Une seule exception, assumée** : le compte rendu d'un rendez-vous s'ouvre depuis la grille, parce qu'**aucun autre écran ne liste les rendez-vous**. Nommer une classe ne les y fait pas entrer — la fiche de classe liste ses séances et ses évaluations, pas ses rendez-vous —, un rendez-vous peut n'en nommer aucune, et l'accueil ne montre que six journées ouvrées : sans cette porte, un rendez-vous posé dans trois semaines ne serait ni corrigeable ni supprimable.
- Les aides qui disent **ce qu'une journée contient** sont dans `pages/Timetable/journee.ts` (`buildRows`, `motifDeFermeture`, `motifDuCreneau`, `timeLabel`, `slotTitle`, `studentName`, `cibleDuRendezVous`) et la géométrie des calendriers dans `pages/Timetable/geometry.ts`. Les deux calendriers — `WeekGrid` et `DaysCalendar` — les partagent : deux implémentations divergeraient au premier créneau à quinzaine, et l'accueil annoncerait un cours que l'emploi du temps ne montre pas.
- Erreurs : `api.ts` lève `ApiError` (message français du backend), `components/DataState.tsx` teste l'erreur **avant** l'état vide. Aucun `catch` qui ne fait que `console.error`.
- Dates : `new Date().toLocaleDateString("sv-SE")` pour le jour courant. **Jamais** `toISOString().split("T")[0]` — en UTC, une séance créée le 1er décembre à 00h30 est datée du 30 novembre, donc classée au mauvais trimestre.
- Pas de state management global. Tailwind uniquement. Composants shadcn existants dans `src/components/ui/`, ne pas en ajouter sans raison.
- **Un composant n'écrit jamais une couleur.** Il n'écrit que des jetons — `bg-card`, `shadow-carte`, `font-titre`, `teinte-carte` —, réglés dans `:root` par `src/index.css`. **Un seul jeu, sans sélecteur conditionnel** : il n'y a plus de choix de thème, donc plus d'attribut `data-theme`, plus de `src/lib/theme.ts`, plus de sélecteur dans Réglages. La discipline reste, et c'est elle qui vaut : un mode sombre s'ajoutera en un bloc (`@custom-variant dark` est déjà déclaré, le bloc de jetons n'existe pas encore), et une couleur écrite en dur dans un composant ne suivra pas.
- `localStorage` est admis pour une préférence d'affichage — la largeur du menu, et rien d'autre à ce jour —, jamais pour une donnée. La portabilité tient parce que `data_directory` range le profil WebView2 dans `data/webview/` et que `purge_traces_webview` n'efface que `Web Data` et `History`.
- **Chaque classe a sa teinte**, assignée par position dans son année scolaire (`src/lib/teintes.ts`), jamais par hachage de l'`id` : avec quatre classes, un hachage sur dix teintes donne une collision une fois sur deux. `styleTeinte()` pose `--classe-h` en style en ligne, `teinte-carte` / `teinte-appui` / `teinte-plein` / `teinte-encre` la lisent. **Ne pas remettre de `border-primary/30` ni de `hover:bg-primary/20` sur une carte teintée** : la couche `utilities` de Tailwind passe après `components` et les emporterait en silence.
- **Filet franc = l'objet existe ; filet pâle = il est seulement prévu.** C'est le seul signe d'état des cartes de calendrier : une séance créée à cette date ajoute `teinte-appui` à `teinte-carte`, un rendez-vous l'a toujours. **Ne pas réintroduire de barre d'accent le long du bord gauche** (`border-l-4`) : elle a été retirée partout — calendriers, listes du jour, cartes de classe — parce qu'elle ajoutait un ornement à côté de la carte là où la carte pouvait le dire elle-même. Là où le trait portait une information qu'aucun autre signe ne disait, c'est un mot qui l'a remplacé, pas un autre dessin.
- Aucune police n'est téléchargée. L'application est hors ligne par principe, donc seules les fontes livrées avec Windows sont nommées (`Segoe UI`, `Constantia`). `Inter` avait été écrit dans l'ancien CSS sans jamais être installé, et retombait silencieusement sur Segoe UI.

## Décisions en attente — ne pas trancher seul

Ces points appartiennent à l'enseignant ; s'y substituer produirait des documents faux remis à des familles.

1. **Maquette de la fiche contrat PDF**, nominative par élève.
2. **Où est l'élève qui n'a pas trouvé de stage**, pendant la période de stage de sa classe : dans les séances de l'enseignant, en permanence, ou aucune séance ces semaines-là ? Demandé le 2026-09-20, sans réponse. **Ne bloque pas le palier 006** : le schéma et `ATTENDANCE_SQL` sont identiques sous les trois réponses, seul l'écran de suivi en dépendrait.
3. La liste des **champs professionnels** (`professional_fields` est volontairement vide à la livraison — ne rien y semer sans confirmation).

### Décisions arrêtées le 2026-11-06 — ne pas les rouvrir seul non plus

Les deux premières étaient en attente depuis le palier 001 ; leurs valeurs par défaut n'étaient pas des choix mais des emplacements tenus. **Le palier 015 les arrête.**

1. **Moyenne générale** : `'unweighted_mean'`. Chaque compétence pèse pareil, qu'elle porte une note ou huit. C'était déjà la valeur livrée, donc 015 n'écrit rien pour elle — confirmer par un `UPDATE` aurait fait croire à un changement de règle.
2. **Notes d'une compétence retirée d'une évaluation** : `'ignore'`. Elles **sortent des moyennes** mais **restent dans `grades`** : la règle vit dans la requête (`reports::AVERAGES_IGNORE_REMOVED`, greffé par un `match` sur des `&'static str`), jamais dans le stockage. Supprimer réellement ces notes donnerait le même bilan et serait irréversible — c'est le piège que tient `une_base_v14_peuplee_traverse_le_palier_015_intacte`.
3. **Ordre de l'échelle de maîtrise** : insuffisante · fragile · presque · satisfaisante · très bonne. Son classeur source inverse les niveaux 2 et 3 ; la question lui a été posée et il a retenu l'ordre du code. **Ne pas réaligner `MASTERY_SCALE` sur le classeur** (`src/lib/pdf.ts`). Cet ordre a survécu au palier 018 : seules les valeurs ont changé de sens — l'échelle valait 4 · 8 · 12 · 16 · 20 points, elle découpe maintenant les tranches 1-4 · 5-8 · 9-12 · 13-16 · 17-20, et ses anciens points sont exactement les **hauts** de ces tranches, ce qui a rendu la conversion `mark = level * 4` fidèle à tous les libellés déjà saisis.

Les deux règles sont désormais **modifiables dans Réglages** — c'est tout ce qui manquait, le backend les validait et les écrivait déjà. Les moyennes étant calculées à la lecture, en changer recalcule les bilans déjà établis, trimestres passés compris : la carte le dit.

Ce qui **n'existe pas du tout** et reste à concevoir avec lui si le besoin vient : pondération des trimestres / moyenne annuelle, coefficients d'évaluation, et toute notion de dispense (absente du schéma). À l'inverse, le filtre de `home.rs` (`EVALUATIONS_PASSEES`) sur les compétences encore rattachées **n'est pas cette règle** et reste inconditionnel : il empêche une évaluation d'être « complète à 112 % », ce qui vaut sous les deux politiques.

## Tests

`cargo test --lib` : 171 tests, dont 24 sur `keys.rs` (enveloppes, récupération, AAD, secrets qui refusent de s'afficher), 9 sur l'ouverture chiffrée, 6 sur `journal.rs` (dont celui qui vérifie qu'un dossier impossible ne fait **rien** échouer — il est appelé depuis le crochet de panique) et 8 sur `db/holidays.rs` (dont celui qui vérifie qu'un semis impossible ne fait **rien** échouer — un `?` à cet endroit détruirait `data/sgpa.keys`). Le plus utile reste `sql_smoke` — il extrait les requêtes littérales des modules de commandes et les fait préparer par SQLite contre le schéma migré, ce qui attrape toute colonne renommée ou table oubliée. Son garde-fou exige un nombre minimal de requêtes : l'abaisser doit rester exceptionnel et temporaire.

**`commands/needs.rs` porte un test qui relit du code source**, et non une base : il ouvre `commands/reports.rs`, `commands/reports/scoring.rs`, `commands/contracts.rs` et `src/lib/pdf.ts`, et échoue si l'un d'eux cite `student_need_tags`, `student_needs` ou `needs_note`. C'est la décision « jamais imprimé » rendue exécutable. Si un de ces fichiers est déplacé, **corriger le chemin dans le test — ne pas retirer la ligne de la liste.** Et `src/lib/pdf.ts` y figure délibérément : c'est lui qui dessine réellement les PDF, un garde-fou qui s'arrêterait à la frontière du Rust laisserait passer exactement l'erreur qu'il surveille.

Le harnais `tauri::test::mock_builder` **ne fonctionne pas ici** : ses binaires de test meurent au démarrage avec `STATUS_ENTRYPOINT_NOT_FOUND`, `tauri-build` n'embarquant son manifeste Windows que dans l'exécutable de l'application. Ne pas réessayer sans résoudre ce point d'abord.
