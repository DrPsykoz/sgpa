# SGPA — instructions de travail

Application de bureau **portable** pour enseignant de SEGPA. Tauri v2 (Rust + rusqlite) + React 19 / TypeScript. Interface **intégralement en français**, y compris les messages d'erreur.

> **Phase : production, depuis le 2026-11-08.** L'auteur a annoncé ce jour-là
> que **des enseignants utilisent l'application sur leurs vraies classes**. La
> note de phase de développement qui vivait ici, et qui autorisait à refondre
> la base ou à réécrire un palier livré, est donc levée — elle disait
> elle-même qu'elle sauterait à cette annonce. Ce qui s'applique maintenant :
>
> - **Un palier livré n'est jamais modifié ni renuméroté.** On ajoute un
>   palier et on incrémente `SCHEMA_VERSION`. Réécrire `019_progression.sql`
>   ne changerait rien chez qui l'a déjà traversé : `PRAGMA user_version`
>   vaut déjà 19 et le fichier ne sera jamais rejoué. Le schéma divergerait
>   silencieusement d'un poste à l'autre, et c'est la panne qu'on ne voit pas.
> - **Aucune colonne ni table existante ne perd ses données.** Une colonne
>   nouvelle est nullable ou porte un `DEFAULT` qui **reproduit le
>   comportement d'avant** : une base migrée sans que l'enseignant ne touche
>   à rien doit se comporter exactement comme la veille.
> - **Chaque palier apporte son test « une base vNN peuplée traverse le
>   palier NN+1 intacte »**, sur le modèle de ceux de `db/migrations.rs`. Ce
>   n'est pas une formalité : c'est le seul endroit qui vérifie qu'une base
>   déjà remplie survit, et les paliers 015 à 020 en ont chacun un.
> - **Une régression d'écran vaut une perte de données.** Un enseignant qui
>   ne retrouve pas son cahier de texte ne fait pas la différence. Donc pas de
>   geste supprimé sans remplaçant, pas de commande retirée de
>   `lib.rs`, pas de champ qui disparaît d'un formulaire.
> - **Le mode d'emploi suit** : `LISEZ-MOI.txt` et le `README.md` sont lus par
>   des gens qui n'ont pas le code.
>
> Tout le reste de ce document tenait déjà et tient toujours — en particulier
> les trois règles d'architecture, qui viennent de bugs et non du schéma.

## Commandes

```powershell
pnpm tauri dev          # lance l'app (Vite sur 1420 + compilation Rust)
pnpm build              # tsc --noEmit puis vite build
cargo test --lib        # depuis src-tauri/ — 188 tests
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
- **Migrations versionnées** : `db/migrations.rs` + `db/sql/0NN_*.sql`, pilotées par `PRAGMA user_version`. **Un palier livré n'est jamais modifié** — on en ajoute un nouveau, et on incrémente `SCHEMA_VERSION`. Ce n'est plus négociable depuis le 2026-11-08 (voir la note en tête) : des enseignants ont des bases réelles, et un palier réécrit ne leur sera jamais rejoué. Ne pas s'interdire le bon modèle pour éviter une migration — mais l'atteindre **par ajout**, en gardant les anciennes colonnes jusqu'à ce qu'un palier ultérieur les vide puis les retire.
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

Une **période d'absence** (`absence_periods`) couvre trois situations que le palier 005 confondait en une, et le palier 020 les sépare par **deux colonnes, pas par le motif** — `reason` est du texte libre, aucun calcul ne s'y appuie. Par défaut la période **retire** ses séances du dénominateur d'assiduité de qui elle vise (stage, hospitalisation) ; `attendance_expected = 1` neutralise cette neutralisation (sortie scolaire, séjour, CDI : l'enseignant est **avec** la classe, l'appel se fait, manquer est une absence comme une autre) ; `teacher_absent = 1` ne change **aucun calcul** — une période écarte déjà — et porte la **cause**, ce que `reason` ne permettait pas de distinguer. La règle de l'appel vit dans la requête du bilan (`reports::ATTENDANCE_SQL`) et **jamais dans le stockage** : elle s'y lit aux **deux** points symétriques, celui de `neutralisees` et celui du `LEFT JOIN`, ou à aucun — n'en servir qu'un casse l'invariant imprimé `applicable + hors_inscription + neutralisees == seances_trimestre`. Ce que `teacher_absent` change est à l'écran : l'emploi du temps écrit « Professeur absent » dans la teinte de la classe, et les **trois** rappels de l'accueil se taisent sur la séance — personne ne l'a assurée —, ce silence ne valant que pour ce drapeau, une période de stage continuant de réclamer.

Le couple `teacher_absent = 1 AND attendance_expected = 1` est **impossible**, et à trois étages : `create_teacher_absence_periods` ne prend pas le second en paramètre (**la commande EST le drapeau**), `update_absence_period` refuse de rendre l'appel à une absence du professeur ou de la rendre nominative, et le CHECK du schéma le redit pour un appelant futur. SQLite n'ajoutant pas de contrainte de table par `ALTER`, ce CHECK est porté par la colonne et cite sa voisine : **l'ordre des deux `ALTER` de `020_appel_et_categorie.sql` n'est pas interchangeable.** Une absence du professeur n'est jamais nominative — il n'est pas absent pour un élève —, et pose **une ligne par classe cochée** dans une seule transaction : pas d'entité « absence groupée », même raison que « Gr 2 » au palier 019.

Un **rendez-vous** (`agenda_entries`) peut nommer une **classe**, un **élève**, les deux ou aucun des deux : un conseil de classe concerne une classe entière, une ESS un élève, une réunion d'équipe personne en particulier. Quand un élève est désigné, la classe est **déduite de lui** par `resolve_entry_session` — `students.session_id` est `NOT NULL`, donc les deux colonnes ne peuvent pas se contredire — et un couple contradictoire est **refusé**, jamais rectifié en silence : une rectification muette masquerait le défaut d'écran qui l'a produite. Il porte aussi, depuis le palier 020, une **`category`** : texte libre, trente caractères au plus, vide par défaut, affichée en pastille sur les calendriers. Le palier 004 avait écrit qu'il n'y aurait pas de colonne `kind` tant qu'un second exemple réel n'existerait pas ; l'exercice PPMS est ce second exemple. **Pas de liste close** — une taxonomie figerait un vocabulaire qui appartient à l'établissement, et chaque valeur manquante renverrait la catégorie dans le titre, c'est-à-dire à l'état d'avant. Le prix est arbitré par l'auteur : « PPMS » et « ppms » font deux catégories, rien ne normalise la casse. La borne vit dans `clean_entry_category` et dans la saisie, **jamais dans un CHECK** : une limite d'affichage n'est pas une règle de données, et un CHECK refuserait en anglais ce que la commande refuse en français. Elle se modifie avec l'intitulé et la date, par `update_agenda_entry_meta`. Ni la classe ni l'élève ne s'écrivent après la création — `update_agenda_entry_meta` n'y touche pas, parce que le compte rendu du conseil de la 4ᵉ A ne doit pas pouvoir devenir celui de la 3ᵉ B. `session_id` est en **CASCADE** comme `student_id` : supprimer une classe emportait déjà ses rendez-vous nominatifs, et `SET NULL` aurait donné deux sorts différents à deux lignes de la même table.

Le **« rien à écrire »** est `content_waived_at`, un horodatage nullable, porté par `seances` **et par `agenda_entries`** (palier 017), et **ce n'est pas une annulation** : une séance annulée n'a pas eu lieu et sort du dénominateur d'assiduité, une séance sans contenu a eu lieu et son appel compte. Ne jamais faire porter l'un par l'autre. Un rendez-vous, lui, ne s'annule pas — il se supprime —, donc il n'a pas ce troisième cas.

Un compte rendu est **réglé** de trois façons, et il faut les trois partout : du texte, un « rien à écrire », **ou** au moins une pièce jointe — la photo du tableau *est* le compte rendu. « Vide » n'est pas `= ''` : l'éditeur rend `<p></p>`. La règle vit en **deux endroits, un par couche**, qui doivent dire la même chose : les `REPLACE` et les `EXISTS` de `SEANCES_PASSEES` / `ENTREES_PASSEES` dans `commands/home.rs`, et `etatDuCompteRendu` / `compteRenduRegle` dans `src/lib/contenu.ts`. **Aucun écran ne lit `has_content` seul** : il n'est qu'un des trois booléens, et un calendrier qui s'y arrêtait réclamait « cahier vide » à côté d'un « À reprendre » qui venait de se taire — sur le même écran, l'accueil portant les deux. Les quatre vues concernées (`DaysCalendar`, `WeekGrid`, `SeancesTab`, `StudentsTab`) prennent aussi leurs **mots** là-bas (`motsDuCahier`, `motsDuCompteRendu`) : quatre états, un vocabulaire.

Les **pièces jointes** sont des **BLOB dans `seance_attachments`** pour une séance et dans `agenda_entry_attachments` pour un rendez-vous — **deux tables et non une colonne « porteur »** : SQLite refuse une clé étrangère vers deux tables, et une cascade écrite à la main laisserait des BLOB orphelins, la seule fuite que rien ne nomme. Une logique unique par-dessus (`Porteur` + `Requetes` dans `commands/attachments.rs`, `APPELS` dans `src/components/Attachments.tsx`), des requêtes **littérales choisies par un `match`** et jamais un `format!`, pour que `sql_smoke` les prépare. Ce ne sont pas des fichiers à côté de la base : `VACUUM INTO` les emporte donc dans les sauvegardes, et elles sont chiffrées comme le reste. 10 Mo par fichier (`MAX_ATTACHMENT_BYTES`, vérifié sur les octets **décodés**, pas sur le base64 reçu), images réduites à 1600 px par le front. « Ouvrir » écrit une copie **en clair** dans `exports/` — seul moyen que Word s'en saisisse, et c'est pourquoi `exports/` vit sur la clé.

Le **glisser-déposer** passe par le DOM, pas par Tauri : `lib.rs` appelle `disable_drag_drop_handler()` sur le constructeur de fenêtre. L'événement de Tauri ne porte que des **chemins**, il aurait fallu lire le fichier en Rust et sauter la réduction à 1600 px — une photo de téléphone lâchée aurait été refusée à 8 Mo quand la même, choisie au bouton, passe à 300 Ko. **Le même geste doit donner le même résultat**, donc le dépôt et le bouton appellent tous deux `deposer` dans `SeanceAttachments`. Contrepartie obligatoire : privé du gestionnaire de Tauri, WebView2 **navigue vers le fichier lâché** et l'application disparaît derrière lui, sans barre d'adresse pour revenir. D'où `interdireNavigationParDepot` (`src/lib/depot.ts`), posé sur `document` dans `App()` **au-dessus du garde de verrouillage** — l'écran de mot de passe est justement celui où un fichier lâché ferait le plus de dégâts. Toute nouvelle zone de dépôt teste `estDepotDeFichiers` d'abord : sans ce test, elle avalerait le déplacement de texte à la souris dans l'éditeur. Et elle écoute en phase de **capture** avec `stopPropagation`, sinon ProseMirror voit le dépôt et insère le chemin du fichier comme texte.

La **progression annuelle** (palier 019) est un **plan**, et rien qu'un plan : elle ne touche ni séance, ni appel, ni bilan. **Une seule par classe** — `progressions.session_id` est `UNIQUE` —, donc « Gr 2 » est un **libellé imprimé** (`intitule_groupe`) et non une entité : il n'existe pas d'objet « groupe » dans le modèle, et rien ne s'y rattache. Trois niveaux : l'**étape** (`progression_etapes`) est l'échelon entre l'année et l'activité, et c'est **elle** qui porte les compétences, les connaissances et les priorités. Les **compétences se cochent dans le référentiel** depuis le palier 021 (`progression_etape_competences`, miroir d'`evaluation_competencies`) : le palier 019 les voulait en texte libre et c'était **sa** décision, qu'il a rouverte le 2026-11-09 — ce qui se tient, les 53 compétences semées venant de son propre tableau, si bien qu'il retapait à la main des phrases déjà en base, à deux écrans de là. **La table de rattachement n'a pas de colonne `position`** : l'ordre est celui du référentiel, celui que Réglages règle, donc une compétence déplacée là-bas se déplace dans toutes les progressions d'un coup — sa voisine en a une, l'écrit à chaque enregistrement, et son lecteur ne la lit jamais. Et **`progression_etapes.competences` n'est ni vidée ni supprimée** : l'écran montre ce texte en lecture seule sous « Compétences saisies à la main » tant qu'il reste, le PDF l'imprime encore, un seul bouton l'efface, et **tout** appelant d'`update_progression_etape` le fait transiter inchangé — même corollaire que l'horaire d'`update_seance_meta`, l'omettre effacerait au premier renommage d'étape des phrases écrites avant que le sélecteur n'existe. Les connaissances et les priorités, elles, restent en texte libre. L'**activité** (`progression_activites`) est ce qu'on fait ; la **plage** (`progression_plages`) est une case de frise, désignée par le **lundi** de sa semaine et sa bande (`voie`, 0 ou 1), jamais par un numéro ISO — un numéro n'a pas d'année, et la semaine 1 de 2027 suit la 53 de 2026.

Le **rang** d'une activité dans l'année est calculé **en Rust** (`commands/progressions.rs`) en parcourant `(etape.position, activite.position)`, et il est **0-fondé** : un numéro imprimé est `rang + 1`. C'est lui, et rien d'autre, qui donne sa couleur — `teinteDeActivite(rang)` marche la roue par l'angle d'or (137,508°) depuis 45°, à l'écart des dix teintes de classe. Calculé une fois côté Rust pour que l'écran et le PDF ne puissent pas colorier différemment la même activité : **ne pas le recalculer** à partir de l'index d'un `map`, un filtre d'affichage changerait les couleurs sans rien changer à l'année.

Les **semaines sont les vraies semaines**, rendues par `get_year_calendar`, et une semaine appartient au mois **et** au trimestre qui contiennent son **jeudi** : c'est une partition, donc la frise n'a ni colonne dédoublée ni semaine orpheline. Ne pas regrouper par `monday.slice(5, 7)`. L'année 2026-2027 en compte quarante-cinq, dont plusieurs ne sont pas entières — le classeur d'origine supposait quatre semaines par mois, et `school_days` est le nombre qu'il n'avait pas. Les fermetures sont **lues du calendrier officiel** (`closures`) et non peintes à la main, et une semaine fermée **reste peignable** : le calendrier bouge, et l'application ne dicte pas où planifier. Elles sont filtrées par **l'académie choisie dans Réglages** (`app_settings.academie`) : sans académie, la frise ne montre que les fériés nationaux calculés, et ce n'est pas un défaut du code — c'est le réglage qui manque. À vérifier d'abord quand « les vacances n'apparaissent pas ».

Les **domaines** (`progression_domaines`) sont le vocabulaire de l'enseignant, **livré vide** comme `professional_fields` : ne rien y semer. Ils sont **globaux** et non par classe — un domaine exploré en 4ᵉ et en 3ᵉ est le même domaine. Le backend refuse de supprimer un domaine employé, d'où `activity_count` rendu à la lecture : l'écran doit le savoir **avant** de proposer le bouton, et présenter un bouton qui échoue vaut moins que l'annoncer.

Les **besoins particuliers** (`student_need_tags`, `student_needs`, `students.needs_note`) sont le vocabulaire de l'enseignant, **livré vide** comme `professional_fields` : ne rien y semer. Ils s'affichent à l'appel, dans la grille de notation, dans la liste des élèves et dans les bilans **à l'écran** — et sur **aucun document imprimé**, jamais. Données de santé concernant des mineurs, décision explicite de l'auteur, tenue par le test de `commands/needs.rs` (voir « Tests »). Limite assumée : un élève appartient à une classe d'une année, donc le même enfant en 4ᵉ puis en 3ᵉ est deux lignes de `students` et ses étiquettes sont à reposer en septembre ; le vocabulaire, lui, est global.

## Frontend

- **L'emploi du temps définit, l'accueil ouvre.** `pages/Timetable` règle la grille hebdomadaire, pose un rendez-vous daté, pose un cours ponctuel — et n'héberge aucun écran de séance : une carte y ouvre sa **définition**, jamais son **contenu**. L'appel, le cahier de texte et les deux gestes qui font naître l'occurrence d'un cours de chaque semaine (`OccurrenceDialog` → `createSeanceFromSlot`, avec ou sans `cancelled`) vivent à l'accueil, qui montre le jour même et les suivants, ou dans la fiche de classe, qui liste toutes les séances. L'onglet « Journée » de l'emploi du temps a été supprimé pour cette raison : il redisait l'accueil, et deux écrans qui modifient la même séance finissent par ne pas en dire la même chose. `WeekGrid` n'a donc **pas** de `onOpenSeance` — ne pas le remettre. **Mais mener n'est pas héberger** : la carte d'un cours ponctuel est un `<Link>` vers `/classes/:id?onglet=seances&ouvrir=:seanceId`, et rien de plus — l'écran de séance reste **unique**, la grille y conduit. Elle était inerte avant, donc un cours ponctuel s'affichait sans qu'aucun clic n'atteigne ni son horaire — celui-là même qu'on vient de rendre modifiable — ni son appel ; et un second écran de séance posé ici aurait rouvert le défaut que la suppression de l'onglet « Journée » avait fermé. L'adresse vit **à un seul endroit** (`adresseDeLaSeance`, `journee.ts`), partagée avec les deux appels de l'accueil : trois gabarits d'URL auraient divergé au premier paramètre ajouté. Le `<Link>` porte `draggable={false}` — le navigateur sait glisser une ancre tout seul, et ce fantôme aurait mangé le tracé qui ajoute un cours à côté. **Une seule exception, assumée** : le compte rendu d'un rendez-vous s'ouvre depuis la grille, parce qu'**aucun autre écran ne liste les rendez-vous**. Nommer une classe ne les y fait pas entrer — la fiche de classe liste ses séances et ses évaluations, pas ses rendez-vous —, un rendez-vous peut n'en nommer aucune, et l'accueil ne montre que six journées ouvrées : sans cette porte, un rendez-vous posé dans trois semaines ne serait ni corrigeable ni supprimable.
- **La progression s'écrit dans la fiche de classe, l'emploi du temps la montre.** Même règle, et même origine : l'onglet « Progression » de `SessionDetail` est le **seul** endroit où une progression se modifie ; l'onglet « Année » de `pages/Timetable` (`YearGrid`, adressable par `?vue=annee`, « Semaine » par défaut) ne fait que lire, et le nom de la classe y est un lien vers l'endroit où elle s'écrit. Ce que la vue annuelle apporte et que la fiche de classe ne peut pas donner : la **comparaison** — la semaine où trois classes font la même chose, celle où rien n'est prévu, les trous du calendrier. Peindre d'ici demanderait en plus de choisir une activité parmi celles de quatre classes à la fois, ce qui n'a pas de sens. **Sur la frise qui écrit, le bouton de la souris décide du geste** : clic gauche pose l'activité choisie, clic droit l'efface — demandé le 2026-11-09 —, et au clavier `Entrée` pose, `Suppr` ou `Retour arrière` efface. Le pinceau « gomme » qui occupait une entrée du sélecteur a disparu, mais **pas sans remplaçant** : les cases restent atteignables par tabulation, pour la raison même qui fait vivre « Un autre cours à cet horaire » dans `SlotDialog`. **Les deux gestes ont la même portée** — une case est une semaine, un glissement est une bande : le clic droit n'efface donc **pas** le trait entier sous le curseur, qui peut faire vingt semaines, et la frise n'a pas d'annulation. Le `contextmenu` de WebView2 n'est supprimé **que pour le geste en cours**, par un drapeau posé à l'enfoncement du bouton droit : sous Windows l'événement arrive **après** `pointerup`, donc la trace est déjà consommée quand il passe, et un garde qui s'appuierait sur elle laisserait le menu du système s'ouvrir par-dessus la frise.
- **Les deux frises partagent leur géométrie et leur vocabulaire.** Les colonnes et les trois en-têtes (Trimestre / Mois / Semaine) viennent de `src/components/FriseEntetes.tsx` (`ColonnesDeFrise`, `EntetesDeFrise`, `LARGEUR_SEMAINE`, `formatDateDeFrise`) ; le découpage des traits et les mots, de `src/lib/progression.ts` (`casesDeVoie`, `tranchesParMois` / `tranchesParTrimestre` / `tranchesParMotif`, `MOTS_DE_VOIE`, `MOTS_DE_SEMAINE`, `etatDeLaSemaine`, `motifDeLaSemaine`). C'est la raison qui fait déjà partager `journee.ts` et `geometry.ts` entre `WeekGrid` et `DaysCalendar` : deux implémentations divergeraient au premier détail, et la vue annoncerait une semaine que la frise ne montre pas. `LARGEUR_SEMAINE` est connue du code parce qu'un intitulé posé sur plusieurs semaines est écrit **une seule fois**, dans la première case, et débordé sur les suivantes — un `colSpan` aurait donné le même dessin mais une seule cible de clic pour huit semaines.
- Le **PDF de progression** (`exportProgressionPDF`, `src/lib/pdf.ts`) est en **paysage** : quarante-cinq semaines sur une feuille portrait donnent des colonnes de quatre millimètres, où le numéro de semaine ne tient plus. Il dit deux fois la même année — la frise, puis le tableau des étapes —, et c'est le **numéro** de l'activité qui relie les deux ; la couleur ne fait que l'appuyer, parce qu'une progression finit punaisée au mur après un passage par un photocopieur en noir et blanc. Sa frise est dessinée au `rect` et non par `autoTable` (un `colSpan` par trait aurait interdit d'écrire le numéro dans la première case seulement), et ses teintes viennent de `fondDeActivite` / `filetDeActivite` / `encreDeActivite`, conversion OKLCH→sRVB des constantes mêmes de `teinte-carte teinte-appui`. Un **seul objet** en paramètre (`ProgressionPdfInput`) : six paramètres positionnels de même type se seraient inversés au premier appel, et une classe échangée avec une autre imprime une progression fausse sous le bon nom.
- Les aides qui disent **ce qu'une journée contient** sont dans `pages/Timetable/journee.ts` (`buildRows`, `motifDeFermeture`, `absenceDuCreneau`, `motsDeAbsence`, `motsDesAbsences`, `motsDeLegende`, `absencesGroupees`, `adresseDeLaSeance`, `timeLabel`, `slotTitle`, `studentName`, `cibleDuRendezVous`) et la géométrie des calendriers dans `pages/Timetable/geometry.ts`. Les deux calendriers — `WeekGrid` et `DaysCalendar` — les partagent : deux implémentations divergeraient au premier créneau à quinzaine, et l'accueil annoncerait un cours que l'emploi du temps ne montre pas. **Deux portées d'absence qui ne se confondent pas** : un JOUR fermé pour tout le monde (vacances, férié) retire ses cartes, l'en-tête de colonne le disant une fois pour toutes ; une CLASSE hors cours **garde** ses cartes et les estompe, le motif écrit dessus — les confondre referait à l'envers le défaut corrigé au palier 006, et « une case disparue passerait pour un créneau perdu ». `absenceDuCreneau` rend l'**enregistrement** et non un booléen « masqué », parce qu'il faut peindre trois cas et non deux ; il rend `null` sur `attendance_expected`, et ce n'est pas un oubli : le cours a lieu, estomper sa carte ferait disparaître à l'œil la séance dont on attend justement l'appel. Les mots sont là aussi, en trois longueurs (carte, bandeau, infobulle), même doctrine que `motsDuCahier`.
- **Ce qu'une carte ne peut pas dire, la légende le dit sous la grille.** `LegendeDesAbsences` (`WeekGrid`) écrit une ligne par période de la semaine : la classe, le motif, les jours couverts, l'effet sur l'assiduité. Elle répare un manque et n'ornemente pas — l'en-tête d'une colonne fait six caractères, donc à deux classes hors cours le même jour il écrit « 2 classes hors cours », ce qui est vrai et inutilisable, et le détail n'existait que dans un `title=` : une infobulle ne se découvre pas. **Sous** la grille et non dedans, parce qu'une colonne n'a pas la place d'une phrase et que `get_week_schedule` rend une `SessionAway` **par journée couverte** — d'où `absencesGroupees`, qui déduplique sur (classe, `teacher_absent`, `attendance_expected`, motif) : un stage d'une semaine arrive cinq fois. Sa pastille reprend `teinte-carte` et `styleTeinte` de la carte qu'elle explique, donc elle n'écrit aucune couleur et se lit comme la légende de ce qui est à l'écran. Même mouvement au-dessus de la grille : le pavé d'aide tient en **trois phrases** — à quoi sert l'écran, le partage clic/glissé, où se tient l'appel. Ce qui en est sorti n'est pas perdu, il est dit là où il sert : les six formes par `NewPlanningDialog` au moment du choix, la destination d'une carte par son propre `title=`. Un pavé de quatorze lignes ne se lit pas, et il poussait la grille hors de l'écran.
- **Deux cours peuvent occuper la même case de grille** — `timetable_slots` n'a jamais porté d'unicité sur `(weekday, start_time)` et `week_parity` existe depuis le palier 004, donc la semaine A/B était permise par le schéma dès le premier jour : ce qui manquait était la **porte**, une case occupée renvoyant tous ses clics vers la modification du créneau existant. Il y en a **deux, et elles ne se remplacent pas**. Dans la grille, **le clic ouvre la carte, le glissé ajoute à côté** : `commencerTraceSurCarte` (`WeekGrid`) retrouve par `elementsFromPoint` la bande du fond que la carte recouvre, et le tracé reprend là, avec la même géométrie et le même aperçu — d'où les `data-bande` / `data-jour` / `data-colonne` / `data-minutes` / `data-date` portés par les bandes, qui sont leur seule description lisible de l'extérieur. Sans mouvement, rien n'est créé et le clic ouvre la carte comme avant ; `consommerClic`, partagé par la bande et la carte, avale le `click` que le navigateur émet encore après un glissé — sans lui, le geste créerait la plage **et** ouvrirait la carte de départ par-dessus. La seconde porte est dans `SlotDialog` (« Un autre cours à cet horaire »), rend à l'hôte la case de grille et la **parité complémentaire**, et **ne touche pas au créneau existant** : lui réécrire sa parité en douce resterait à moitié fait si l'enseignant annulait la création, donc c'est un panneau d'information qui dit ce qui va arriver. Ce panneau liste les voisins par **chevauchement** et non par égalité — un 8h–9h et un 8h30–10h occupent la même bande. C'est elle, et pas le glissé, qui prérègle la **parité complémentaire** : elle est le seul des deux gestes qui dise « l'autre semaine », un tracé ne disant que l'horaire. Elle reste aussi le seul chemin au clavier, les bandes du fond restant atteignables par tabulation sous les cartes. Côté hôte, `ouvrirAjoutAuMemeHoraire` remet `slotEnEditionId` à `null` avant d'ouvrir la création : sans ce geste l'écriture passerait par `enregistrerCreneau`, qui consulte cet identifiant, et **écraserait** le créneau qu'on vient de quitter.
- **Seul un cours ponctuel (`slot_id === null`) a son horaire modifiable dans sa fiche.** Une séance née d'un créneau tient son heure du modèle hebdomadaire, qui se corrige dans l'emploi du temps et pour toutes les semaines à la fois — c'est « l'emploi du temps définit » appliqué à une colonne, et la corriger occurrence par occurrence ferait deux vérités pour la même heure. Un cours ponctuel n'a aucun modèle derrière lui : sans ce champ, un horaire saisi de travers restait faux pour toujours. Corollaire : **tout** appelant d'`update_seance_meta` fait transiter l'horaire inchangé, comme il fait transiter le motif — l'omettre l'envoie vide, et un simple renommage effacerait l'heure du cours.
- **La pastille de catégorie est le seul aplat de couleur de l'application** (`src/components/PastilleCategorie.tsx`), et elle est partagée par `WeekGrid`, `DaysCalendar` et `AgendaEntryEditor` : trois rédactions du même petit rectangle auraient divergé. Elle rend `null` sur `""`, donc rien à tester chez l'appelant.
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

### Décisions arrêtées le 2026-11-07 — la progression annuelle

Les quatre premières sont **de lui**, posées avant d'écrire le palier 019. Les quatre suivantes sont de moi, annoncées dans le plan qu'il a approuvé : elles se rouvrent s'il le dit, mais pas sans lui.

**De lui.** (1) Les compétences, connaissances et priorités se rattachent à l'**étape**, l'échelon entre l'année et l'activité — pas à l'année, pas à l'activité. (2) **Une progression par classe**, sans entité « groupe » : « Gr 2 » est un libellé imprimé. (3) Les couleurs sont assignées **par l'application, par position** — donc par `rang`, jamais choisies à la main ni tirées d'un hachage. (4) Les compétences étaient en **texte libre** et ne citaient pas le référentiel `competencies` : il écrivait des phrases. **Il a rouvert ce point lui-même le 2026-11-09** — « il faudrait pouvoir sélectionner les compétences via le référentiel et pas un champ texte libre » — et le palier 021 le fait : c'est la seule des huit décisions à avoir bougé. Ne pas la refermer dans l'autre sens sans lui, et ne pas en déduire que les sept autres se sont ouvertes avec elle. Ce qui avait été saisi reste en base, affiché et imprimé, jusqu'à ce que l'enseignant l'efface d'un bouton.

**De moi, par défaut assumé.** (5) Les colonnes sont les **vraies semaines** du calendrier, pas quatre par mois comme son classeur. (6) Les vacances sont **lues** du calendrier officiel, pas peintes. (7) Les **domaines** sont livrés vides, comme `professional_fields`. (8) La vue annuelle de l'emploi du temps **montre et ne modifie pas** ; tout s'écrit dans la fiche de classe. Le point 8 lui a été signalé pour objection — « si vous préférez tout peindre depuis l'emploi du temps, dites-le maintenant » — et il a approuvé sans objecter.

## Tests

`cargo test --lib` : 188 tests, dont 24 sur `keys.rs` (enveloppes, récupération, AAD, secrets qui refusent de s'afficher), 9 sur l'ouverture chiffrée, 6 sur `journal.rs` (dont celui qui vérifie qu'un dossier impossible ne fait **rien** échouer — il est appelé depuis le crochet de panique) et 8 sur `db/holidays.rs` (dont celui qui vérifie qu'un semis impossible ne fait **rien** échouer — un `?` à cet endroit détruirait `data/sgpa.keys`). Parmi eux, 18 sur `commands/absences.rs` — dont les cinq du palier 020 : qu'une période « avec appel » s'écrive et se relise, qu'une absence du professeur pose une ligne par classe cochée, qu'une liste de classes vide soit refusée, qu'une classe inconnue annule **tout** le geste, et qu'une absence du professeur ne puisse devenir ni nominative ni « avec appel » tout en laissant corriger ses dates. Et 8 sur `commands/progressions.rs` : que le rang suive `(étape, activité)` et non l'ordre d'insertion, qu'une activité d'une autre classe soit refusée, qu'une plage se désigne par un lundi, que la frise n'ait que deux bandes, que supprimer une étape ne laisse pas une plage orpheline, et les trois du palier 021 — que les compétences d'une étape sortent dans l'ordre du **référentiel** et non dans celui des clics (c'est tout ce qui dispense la table de rattachement d'une colonne `position`), qu'une compétence inconnue annule **tout** l'enregistrement et pas seulement ses rattachements, et que le texte libre d'avant survive au passage du sélecteur. Le plus utile reste `sql_smoke` — il extrait les requêtes littérales des modules de commandes et les fait préparer par SQLite contre le schéma migré, ce qui attrape toute colonne renommée ou table oubliée. Son garde-fou exige un nombre minimal de requêtes : l'abaisser doit rester exceptionnel et temporaire.

**`commands/needs.rs` porte un test qui relit du code source**, et non une base : il ouvre `commands/reports.rs`, `commands/reports/scoring.rs`, `commands/contracts.rs` et `src/lib/pdf.ts`, et échoue si l'un d'eux cite `student_need_tags`, `student_needs` ou `needs_note`. C'est la décision « jamais imprimé » rendue exécutable. Si un de ces fichiers est déplacé, **corriger le chemin dans le test — ne pas retirer la ligne de la liste.** Et `src/lib/pdf.ts` y figure délibérément : c'est lui qui dessine réellement les PDF, un garde-fou qui s'arrêterait à la frontière du Rust laisserait passer exactement l'erreur qu'il surveille.

Le harnais `tauri::test::mock_builder` **ne fonctionne pas ici** : ses binaires de test meurent au démarrage avec `STATUS_ENTRYPOINT_NOT_FOUND`, `tauri-build` n'embarquant son manifeste Windows que dans l'exécutable de l'application. Ne pas réessayer sans résoudre ce point d'abord.
