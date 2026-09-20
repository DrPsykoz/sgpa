<div align="center">

# 🎓 SGPA

**Suivi et Gestion Pédagogique Adapté**

Application de bureau **portable** pour enseignant de SEGPA : classes, élèves, séances, appel,
cahier de texte, évaluations par compétences, fiches contrat et bilans trimestriels.
Rien n'est installé, rien n'est écrit ailleurs : tout vit à côté de l'exécutable, clé USB comprise.
La base est **chiffrée** — une clé USB perdue ne livre aucun nom d'élève.

[![Tauri](https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri&logoColor=white)](https://v2.tauri.app)
[![React](https://img.shields.io/badge/React-19.1-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-édition%202021-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![SQLCipher](https://img.shields.io/badge/SQLCipher-4.6.1%20AES--256-003B57?logo=sqlite&logoColor=white)](https://www.zetetic.net/sqlcipher/)
[![Portable](https://img.shields.io/badge/distribution-ZIP%20portable-4C9A2A)](#installation-et-lancement)

</div>

---

## Fonctionnalités

| Module                | Description                                                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Verrou & réglages** | Un seul mot de passe, qui **chiffre la base** : il n'ouvre pas un écran, il déballe la clé maître (voir [Chiffrement](#chiffrement)). Phrase de récupération, indice, nom de l'enseignant, nom de l'établissement (en-tête des PDF), règles de calcul. |
| **Classes**           | Une classe = un niveau (`6eme`, `5eme`, `4eme`, `3eme`, `3eme_prepa`) pour une année scolaire. Le niveau et l'année ne sont stockés nulle part ailleurs.                                                     |
| **Élèves**            | Ajout unitaire ou collage multi-lignes depuis un tableur. `enrolled_on` / `left_on` bornent l'assiduité : un élève arrivé en janvier n'est pas compté absent de septembre à décembre.                        |
| **Séances**           | Titre, date, trimestre déduit de la date et corrigeable à la main, indicateur « annulée » (sortie, jour férié) qui garde la séance au cahier de texte mais la sort des statistiques. Cahier de texte TipTap. |
| **Appel**             | Cinq états : `non_fait`, `present`, `absent`, `retard`, `excuse`. « Non fait » est un état réel : rien n'est pré-rempli à « présent », et l'appel oublié se voit.                                             |
| **Référentiel**       | Arbre Cycle → Domaine → Champ → Compétence en 6 commandes, saisie par collage multi-lignes, archivage d'une compétence déjà notée plutôt que suppression. Livré pré-rempli avec les 5 domaines du socle.      |
| **Évaluations**       | Grille compétences × élèves, notation 0 à 5 (`0` = non évalué), trimestre déduit de la date. Retirer une compétence d'une évaluation demande confirmation avant de toucher aux notes.                         |
| **Fiches contrat**    | Une trame par évaluation (projet, champ professionnel, domaine du socle, activités de référence, donné / demandé / exigé), des lignes d'activités ordonnées, et une couche nominative par élève.              |
| **Bilans**            | Par classe et par trimestre : moyennes par compétence, moyenne générale, statistiques d'assiduité (dont les séances hors période d'inscription), commentaire enseignant.                                      |
| **Export PDF**        | Bilan trimestriel uniquement (`src/lib/pdf.ts`), déposé dans `exports/` à côté de l'exécutable. **La fiche contrat n'a pas d'export PDF** : sa maquette n'est pas arrêtée.                                    |
| **Sauvegarde**        | Copie complète à la demande dans `data/backups/`, les 10 plus récentes conservées. Copie automatique avant toute migration de schéma. `VACUUM INTO` hérite de la clé : **les sauvegardes sont chiffrées elles aussi**.                                        |

### Visible dans l'interface, mais pas encore actif

- **Règle de la moyenne générale** : réglable dans les Réglages (`unweighted_mean` par défaut,
  `weighted_by_count` disponible), mais la règle retenue n'est pas tranchée — voir
  [Décisions en attente](#décisions-en-attente).
- **Champs professionnels** : la table `professional_fields` est volontairement vide à la
  livraison. Ils se créent à la main depuis l'éditeur de fiche contrat.

## Stack technique

| Couche            | Technologies                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| **Frontend**      | React 19.1, TypeScript 5.8, Vite 7, React Router 7 (`HashRouter`)                                |
| **Backend**       | Tauri 2 (Rust, édition 2021), rusqlite 0.35 en `bundled-sqlcipher-vendored-openssl`, chrono 0.4, uuid v4 |
| **Chiffrement**   | SQLCipher 4.6.1 (AES-256), argon2 0.5 (Argon2id), chacha20poly1305 0.10 (XChaCha20-Poly1305), zeroize 1 |
| **UI**            | TailwindCSS 4.2, shadcn/ui (Radix UI), Lucide React, TanStack Table 8                            |
| **Éditeur riche** | TipTap 3.22                                                                                      |
| **PDF**           | jsPDF 4.2 + jspdf-autotable 5                                                                    |
| **Windows**       | windows-sys 0.61, pour la boîte de dialogue d'erreur de démarrage                                |

`bcrypt` a disparu avec le chiffrement : le mot de passe n'est plus vérifié par un condensat,
il l'est par sa capacité à déballer la clé maître.

Pas de gestionnaire d'état global, pas de client HTTP, pas de serveur. Le front parle au Rust
par `invoke()` et rien d'autre : **55 commandes**, exposées par une façade typée unique
(`src/lib/api.ts`).

## Structure du projet

```
src/                                       Frontend React
├── App.tsx                                HashRouter + garde de verrouillage
├── main.tsx   index.css
├── pages/
│   ├── FirstRun.tsx                       premier lancement : mot de passe, nom, phrase de récupération
│   ├── Unlock.tsx                         déverrouillage, et récupération par la phrase
│   ├── Sessions.tsx                       liste des classes
│   ├── Cycles.tsx                         référentiel de compétences
│   ├── Settings.tsx                       identité, verrou, trimestres, sauvegarde, calcul
│   └── SessionDetail/
│       ├── index.tsx                      charge la classe, tient la liste et l'id sélectionné
│       ├── tabs/                          StudentsTab · SeancesTab · EvaluationsTab · BilansTab
│       ├── seance/SeanceDetail.tsx        appel + cahier de texte
│       ├── evaluation/EvaluationDetail.tsx   grille de notes + fiche contrat
│       └── dialogs/                       ConfirmDialog · StudentFormDialog
├── components/
│   ├── CompetencyPicker.tsx               sélection dans l'arbre du référentiel
│   ├── ContractSheetEditor.tsx            trame + lignes d'activités + couche par élève
│   ├── DataState.tsx                      chargement / erreur / vide, dans cet ordre
│   ├── RichEditor.tsx                     TipTap
│   ├── TrimesterBoundsDialog.tsx          bornes d'année + aperçu du recalcul
│   ├── layout/AppLayout.tsx               barre latérale, bouton Verrouiller
│   └── ui/                                14 composants shadcn
├── hooks/
│   ├── useLock.tsx                        état du verrou, partagé par tout l'arbre
│   └── useIdleTimer.ts                    écrit, pas encore branché
├── lib/
│   ├── api.ts                             façade typée des 55 commandes + ApiError
│   ├── pdf.ts                             bilan trimestriel
│   └── utils.ts
└── types/index.ts                         interfaces, LevelCode, MASTERY_LABELS

src-tauri/
├── src/
│   ├── main.rs                            WebView2 embarqué s'il est présent, puis run()
│   ├── lib.rs                             démarrage (sans la base), fenêtre, generate_handler!, fatal()
│   ├── state.rs                           AppState : Connection (absente = verrouillé) + verrou de fichier
│   ├── keys.rs                            enveloppes de la clé maître — data/sgpa.keys
│   ├── portable.rs                        résolution de data/ et exports/, sonde, verrou de fichier
│   ├── sql_smoke.rs                       test : prépare toutes les requêtes contre le schéma
│   ├── db/
│   │   ├── mod.rs                         ouverture chiffrée, journal TRUNCATE, calcul des trimestres
│   │   ├── migrations.rs                  paliers pilotés par PRAGMA user_version
│   │   └── sql/
│   │       ├── 001_initial.sql            les 18 tables
│   │       ├── 002_referentiel.sql        semis du socle commun
│   │       └── 003_sans_bcrypt.sql        la base n'héberge plus rien du verrou
│   └── commands/
│       ├── lock.rs           verrou, récupération, réglages  (10 commandes)
│       ├── sessions.rs       classes                   (5)
│       ├── students.rs       élèves                    (5)
│       ├── referential.rs    arbre des compétences     (6)
│       ├── seances.rs        séances et présences      (9)
│       ├── evaluations.rs    évaluations et notes      (7)
│       ├── trimesters.rs     bornes d'année            (3)
│       ├── contracts.rs      fiches contrat            (4)
│       ├── reports.rs        bilans                    (2)
│       │   └── reports/scoring.rs    règle de moyenne, isolée
│       └── maintenance.rs    sauvegardes, exports      (4)
├── Cargo.toml
└── tauri.conf.json

.github/workflows/build.yml                typecheck, tests, bump, build, archive ZIP, release
LISEZ-MOI.txt                              document livré à l'utilisateur final
CLAUDE.md                                  règles d'architecture, à lire avant de modifier
```

## Installation et lancement

### Prérequis

- [Rust](https://rustup.rs/) stable
- [Node.js](https://nodejs.org/) ≥ 20 ([fnm](https://github.com/Schniz/fnm) recommandé ; la CI utilise Node 22)
- [pnpm](https://pnpm.io/) ≥ 10
- Prérequis système Tauri v2 : [guide officiel](https://v2.tauri.app/start/prerequisites/)
- **[Strawberry Perl](https://strawberryperl.com/) et le module Perl `Text::Template`** — voir
  ci-dessous

#### Perl, exigé par OpenSSL

`rusqlite` est pris en `bundled-sqlcipher-vendored-openssl` : SQLCipher **et** OpenSSL sont
compilés depuis les sources, et le `Configure` d'OpenSSL est un script Perl qui s'appuie sur
`Text::Template`. Sans eux, `cargo build` s'arrête sur `Command 'perl' not found` ou sur un
`Can't locate Text/Template.pm`.

```powershell
winget install StrawberryPerl.StrawberryPerl
cpanm Text::Template                    # cpanm est livré avec Strawberry Perl
$env:PATH = "C:\Strawberry\perl\bin;$env:PATH"
```

En revanche **NASM n'est pas nécessaire** : `openssl-src` passe `no-asm` en dur à `Configure`,
aucune ligne d'assembleur n'est compilée.

**Piège — la limite de 260 caractères de Windows.** OpenSSL est extrait sous
`src-tauri/target/<profil>/build/…` ; sous une racine de projet trop profonde, l'extraction
dépasse `MAX_PATH` et `Configure` échoue sur des fichiers « missing », sans jamais nommer la
vraie cause. Garder le dépôt haut dans l'arborescence (`C:\Users\<vous>\Desktop\sgpa` convient).

La première compilation d'OpenSSL prend environ **7 minutes** ; les suivantes sont servies par
le cache de `target/`.

**L'utilisateur final, lui, n'a rien à installer.** OpenSSL est lié statiquement (`no-shared`) :
l'exécutable ne dépend d'aucune DLL OpenSSL, seulement de DLL système Windows — `advapi32`,
`crypt32`, `dbghelp`, `kernel32`, `ntdll`, `user32`, `ws2_32` — et de `vcruntime140`, dont SGPA
dépendait déjà. Le chiffrement coûte environ 2 Mo sur la taille de `SGPA.exe`, pas une
dépendance de plus.

### Développement

```powershell
pnpm install
pnpm tauri dev          # Vite sur le port 1420, compilation Rust, puis ouverture de la fenêtre
```

En développement, la base de travail est `src-tauri/target/debug/data/sgpa.db`. Elle est
chiffrée comme en production : **aucun outil ne l'ouvre avec le mot de passe**, qui ne chiffre
rien lui-même — la clé de la base est une valeur brute de 32 octets, tirée au hasard et rangée
dans `data/sgpa.keys`. Un outil acceptant une clé brute (DB Browser for SQLite, mode *raw key*)
l'ouvrirait, mais encore faudrait-il extraire cette clé : `MasterKey` refuse délibérément de
s'afficher, y compris en `Debug`. Pour lire la base pendant le développement, écrire un exemple
qui appelle
`sgpa_lib::open_for_tools(<dossier data>, <mot de passe>)` — c'est la seule porte publique, et
elle exige le mot de passe comme n'importe quel accès.

Si une fenêtre est restée ouverte avant de relancer : `Get-Process sgpa | Stop-Process -Force`.

### Build

```powershell
pnpm tauri build --no-bundle
```

Le résultat est un **exécutable portable**, `src-tauri/target/release/SGPA.exe`, et non un
installeur : `bundle.active` est à `false` dans `tauri.conf.json`, aucun MSI ni NSIS n'est
produit. La CI ajoute `LISEZ-MOI.txt` à côté de l'exe et publie le tout en archive ZIP sur la
page des releases.

L'application crée ses dossiers au premier lancement, dans le dossier de l'exécutable :

```
SGPA.exe
data/sgpa.db          la base, chiffrée
data/sgpa.keys        ~1 Ko : les deux enveloppes de la clé maître
data/.sgpa.lock       verrou de seconde instance, pris au démarrage
data/backups/         les sauvegardes, chiffrées elles aussi
data/webview/         profil WebView2 — sinon il irait dans le %LOCALAPPDATA% du poste hôte
exports/              les PDF générés — jamais chiffrés, ce sont des documents à transmettre
webview2/             optionnel : runtime WebView2 embarqué, utilisé seulement s'il est présent
```

`data/sgpa.keys` est indissociable de la base : une sauvegarde copiée sans lui ne s'ouvre avec
aucun mot de passe. Le `LISEZ-MOI.txt` le dit à l'utilisateur, c'est le point sur lequel on ne
se trompe qu'une fois.

La variable d'environnement `SGPA_DATA_DIR` impose un autre emplacement pour `data/`.

### Vérifications locales

```powershell
pnpm exec tsc --noEmit            # typecheck du front
cd src-tauri ; cargo test --lib   # 63 tests
cd src-tauri ; cargo clippy       # doit rester à zéro avertissement
```

Perl doit être dans le `PATH` de ces commandes aussi : elles compilent OpenSSL.

## Chiffrement

La menace est concrète et tient en une phrase : **quelqu'un ramasse la clé USB et a tout son
temps**. Le mot de passe n'est donc plus un verrou d'écran, c'est la clé de la base.

### Clé maître enveloppée

`data/sgpa.db` est chiffrée par SQLCipher (AES-256-CBC, HMAC-SHA512) avec une **clé maître** de
32 octets tirée au hasard, jamais dérivée du mot de passe. Le mot de passe et la phrase de
récupération ne servent qu'à la déballer, chacun par son enveloppe :

```
mot de passe    ──Argon2id(sel₁)──► clé d'enveloppe₁ ──┐
                                                       ├─► déchiffre la CLÉ MAÎTRE (32 o)
phrase de récup ──Argon2id(sel₂)──► clé d'enveloppe₂ ──┘              │
                                                                      ▼
                                                        PRAGMA key = x'<clé maître>'
```

Ce détour plutôt que le mot de passe directement dans `PRAGMA key`, pour quatre raisons :

1. **Argon2id au lieu de PBKDF2.** Passé à `PRAGMA key`, un mot de passe est étiré par le
   PBKDF2-HMAC-SHA512 × 256 000 interne de SQLCipher, qui n'est pas *memory-hard* et se casse
   bien sur carte graphique. Argon2id l'est (64 Mio, 3 passes, 1 voie). Face à une attaque hors
   ligne, c'est le seul paramètre qui compte vraiment.
2. **Changer de mot de passe réécrit 1 Ko** au lieu de rechiffrer toute la base.
3. **Les sauvegardes déjà prises restent ouvrables** après ce changement. Avec `PRAGMA rekey`,
   elles deviendraient orphelines.
4. **Une phrase de récupération devient possible.** SQLCipher n'accepte qu'une clé par base ;
   deux enveloppes sur une clé maître unique lèvent la contrainte.

### `data/sgpa.keys`

JSON, environ 1 Ko, écrit atomiquement (fichier temporaire puis `rename` sur le même volume).
Il ne contient **aucune donnée d'élève et aucun nom d'enseignant** : une clé trouvée ne doit pas
dire à qui elle appartient — l'écran de déverrouillage n'affiche donc plus de nom, c'est
volontaire.

| Champ    | Contenu                                                                              |
| -------- | ------------------------------------------------------------------------------------ |
| `kdf`    | `argon2id`, `m_cost_kib` 65536, `t_cost` 3, `p_cost` 1                                 |
| `wraps`  | `password` et `recovery` : sel 16 o, nonce 24 o, chiffré 48 o, en base64               |
| `hint`   | l'indice, **en clair** : c'est son rôle, il doit se lire base fermée                   |

L'AEAD est **XChaCha20-Poly1305** (Rust pur ; nonce de 24 octets, donc un nonce aléatoire est
sûr sans compteur). Les données associées valent `sgpa-keys-v1:password` ou
`sgpa-keys-v1:recovery` : intervertir les deux enveloppes est rejeté.

`MasterKey` n'est ni `Clone` ni `Display`, son `Debug` rend `MasterKey(masquée)`, et son `Drop`
efface les octets (`zeroize`). Même discipline pour `RecoveryPhrase` et pour les mots de passe
manipulés, enveloppés dans `Zeroizing<String>`.

### Phrase de récupération

25 octets d'aléa découpés en 40 symboles de 5 bits — **200 bits**, aucun modulo donc aucun
biais — encodés dans un alphabet base32 sans caractères ambigus (`ABCDEFGHJKMNPQRSTVWXYZ0123456789`,
ni I, ni L, ni O, ni U) et présentés en 8 groupes de 5 :

```
K7M2P-9XQTV-3HR8N-BZ4WY-6JFDS-2NKCG-VT5PX-A9M3Q
```

Affichée **une seule fois**, jamais stockée en clair. À la saisie, casse, tirets et espaces sont
ignorés. La régénérer depuis les Réglages réécrit l'enveloppe `recovery` et invalide la phrase
précédente.

*Pourquoi 200 et non 256 bits :* 8 groupes de 5 font 40 symboles base32, soit exactement 200
bits — 256 bits imposeraient 52 caractères, donc un format que l'enseignant recopie moins bien.
Le format d'affichage a été jugé prioritaire : 200 bits sont hors de portée de toute force
brute, et le facteur limitant reste de toute façon Argon2id.

Le mot de passe fait **8 caractères minimum**, sans règle de complexité imposée : une phrase
longue vaut mieux qu'un mot court et tordu, et l'enseignant la retape plusieurs fois par jour.

### Ce que le chiffrement ne protège pas

`exports/*.pdf` (bilans nominatifs, faits pour être transmis), `data/webview/` pendant la
session, la mémoire du processus, et le poste hôte lui-même. Le `LISEZ-MOI.txt` le dit **avant**
d'annoncer le chiffrement et recommande BitLocker To Go sur la clé USB en complément : une
fausse assurance ferait laisser la clé dans un tiroir.

### Démarrage, verrouillage, seconde instance

La base n'est **plus ouverte au démarrage** : sa clé n'existe qu'une fois le mot de passe
déballé, donc après la fenêtre.

```
lib.rs::start()          portable::resolve, purge des traces WebView2,
                         db::move_legacy_aside, verrou de fichier
                         → AppState::new(layout, verrou)   SANS connexion
fenêtre
  get_lock_status        sgpa.keys existe ? non → premier lancement | oui → déverrouillage
  setup_lock(mdp)        clé maître + phrase, écrit sgpa.keys, crée la base chiffrée, migre
  unlock(mdp)            Argon2id → clé maître → PRAGMA key → lecture de contrôle → migrations
  recover(phrase, mdp)   déballe par l'enveloppe recovery, réécrit l'enveloppe password, ouvre
  lock()                 FERME la Connection — une connexion vivante garde la clé en mémoire
```

`AppState.db` est un `Mutex<Option<Connection>>` : **l'état de verrouillage est la présence ou
non de la connexion**, et non plus un `AtomicBool` posé à côté. Il devient impossible d'être
« déverrouillé » sans base, ou l'inverse.

`PRAGMA key` n'authentifie rien — il enregistre la clé. C'est la **lecture de contrôle** qui
suit (`SELECT count(*) FROM sqlite_master`) qui échoue sur une mauvaise clé, avec
`SQLITE_NOTADB` : `db::DbError::WrongKey`.

La détection de seconde instance est passée de `PRAGMA locking_mode = EXCLUSIVE` à un **fichier
de verrou**, `data/.sgpa.lock`, ouvert en `share_mode(0)` (bibliothèque standard, aucune
dépendance). Le `locking_mode` ne pouvait plus jouer ce rôle : il aurait fallu ouvrir la base
pour détecter le doublon, donc répondre « SGPA est déjà ouvert » *après* la saisie du mot de
passe. Windows relâche le fichier à la mort du processus, plantage compris : aucun verrou
fantôme, rien à supprimer à la main.

## Base de données

SQLite embarqué (`rusqlite`, fonctionnalité `bundled-sqlcipher-vendored-openssl`), **un seul
fichier**, aucun serveur. Le journal est en mode **TRUNCATE** et non WAL : le WAL crée
`sgpa.db-wal` et `sgpa.db-shm`, si bien que copier `sgpa.db` produirait une sauvegarde périmée
sans que rien ne le signale. En TRUNCATE, entre deux transactions, `sgpa.db` seul *est* la base
complète — la condition d'une sauvegarde par simple copie depuis une clé USB.

La base est ouverte **une seule fois par session déverrouillée** ; la `Connection` obtenue vit
ensuite dans `AppState` sous `Mutex` et est partagée par toutes les commandes via
`tauri::State`. `PRAGMA user_version` vit dans l'en-tête, qui est chiffré : le mécanisme de
migration fonctionne inchangé, simplement après le mot de passe.

### Les 18 tables

```
app_settings                     ligne unique — remplace l'ancienne table users
trimester_bounds                 bornes contiguës d'une année scolaire
professional_fields              vide à la livraison

cycles
└── domains
    └── fields
        └── competencies         archived_at plutôt qu'une suppression destructrice

sessions                         une classe pour une année (level_code + year_start)
├── students                     enrolled_on / left_on
│   └── report_comments          (student_id, trimester)
├── seances                      trimester, trimester_is_manual, cancelled, content_html
│   └── attendance_records       (seance_id, student_id) → non_fait | present | absent | retard | excuse
└── evaluations                  trimester, trimester_is_manual
    ├── evaluation_competencies  compétences retenues, RESTRICT vers competencies
    ├── grades                   (evaluation_id, competency_id, student_id) → level 0 à 5
    └── contract_sheets          une trame par évaluation
        ├── contract_sheet_rows      lignes d'activités, id stable d'un enregistrement à l'autre
        └── contract_sheet_students  couche nominative : rôle, appréciation, dates
```

`ON DELETE CASCADE` sur les liens de composition ; `ON DELETE RESTRICT` vers `competencies` :
supprimer une compétence déjà notée est refusé par SQLite, et la commande traduit le refus en
proposition d'archivage.

### Migrations

Le schéma est versionné par `PRAGMA user_version`. `src-tauri/src/db/migrations.rs` tient la
liste ordonnée des paliers, chacun étant un fichier de `db/sql/` :

| Palier | Fichier                | Contenu                                                            |
| ------ | ---------------------- | ------------------------------------------------------------------ |
| 1      | `001_initial.sql`      | les 18 tables                                                      |
| 2      | `002_referentiel.sql`  | 5 domaines du socle commun, 4 composantes du domaine 1             |
| 3      | `003_sans_bcrypt.sql`  | `DROP COLUMN` de `app_settings.password_hash` et `.password_hint`   |

Le palier 3 vide la base de tout ce qui touchait au verrou. Le condensat bcrypt n'a plus de
vérificateur — le mot de passe se prouve en déballant la clé maître — et un condensat resté là
serait une seconde cible pour rien. L'indice, lui, doit se lire **avant** d'ouvrir la base : il
vit désormais dans `data/sgpa.keys`, seul fichier lisible session verrouillée.

Règle : **un palier livré n'est jamais modifié** — on en ajoute un nouveau et on incrémente
`SCHEMA_VERSION`. Chaque palier s'applique dans une transaction, suivi d'un
`PRAGMA foreign_key_check` ; la moindre référence orpheline annule tout. Une base déjà peuplée
est copiée dans `data/backups/` avant la première migration. Une base écrite par une version
plus récente de l'application est refusée avec un message explicite plutôt qu'ouverte.

Une base d'avant le chiffrement est mise de côté sous `data/sgpa-legacy-v1.db`, et une base
neuve est créée. Le critère est devenu plus simple qu'un test de version : **`sgpa.db` présent
sans `sgpa.keys`**. Une telle base n'a pas d'enveloppes, elle est donc définitivement
inouvrable par cette version — inutile de l'ouvrir pour l'inspecter. `move_legacy_aside` est
appelée dans `start()`, avant la fenêtre : elle ne demande aucune clé. L'ancien fichier reste
intact à côté, **en clair** : le `LISEZ-MOI.txt` demande à l'enseignant de le ranger ailleurs
ou de le supprimer.

### Sauvegarde

`data/backups/` reçoit les copies faites depuis Réglages → Sauvegarde (les 10 plus récentes
sont conservées) et celles prises automatiquement avant migration. Toutes sont produites par
`VACUUM INTO`, jamais par une copie de fichier ouvert, qui pourrait capturer une lecture
déchirée.

`VACUUM INTO` produit une copie **chiffrée**, qui hérite de la clé de la base d'origine et se
rouvre avec elle — vérifié en lisant les octets du fichier produit : ni l'en-tête
`SQLite format 3` ni les données n'y sont lisibles. Le mécanisme de sauvegarde n'a donc rien
coûté au chiffrement. Sa contrepartie est que `data/sgpa.keys` doit accompagner toute copie de
`data/backups/` emportée hors de la clé.

## Tests

`cargo test --lib`, depuis `src-tauri/` — **63 tests** :

| Fichier                       | Tests | Ce qui est vérifié                                                                                                            |
| ----------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| `keys.rs`                     | 15    | aller-retour des deux enveloppes, mauvais mot de passe, phrase étrangère, normalisation de la saisie, changement de mot de passe, régénération qui invalide l'ancienne phrase, récupération puis nouveau mot de passe, enveloppes interverties rejetées par l'AAD, écriture atomique, absence de toute identité dans le fichier, paramètres KDF hors bornes, secrets qui refusent de s'afficher |
| `commands/maintenance.rs`     | 11    | noms d'export : traversée de chemin, caractères interdits, noms réservés Windows, longueur, désambiguïsation des doublons ; rotation et listage des sauvegardes |
| `db/mod.rs`                   | 9     | la base se rouvre avec la même clé, une mauvaise clé est refusée par la lecture de contrôle, le fichier sur le disque ne laisse rien lire, `VACUUM INTO` reste chiffré, base sans `sgpa.keys` mise de côté ; trimestre aux dates charnières, hors bornes, année bissextile, bornes par défaut |
| `commands/students.rs`        | 6     | découpage nom / prénom des lignes collées, noms composés, lignes vides, validation des dates                                   |
| `commands/trimesters.rs`      | 6     | validation des bornes : ordre, égalité fin / début de T3, dates impossibles, année hors bornes, libellé court de date          |
| `db/migrations.rs`            | 5     | version atteinte, idempotence, base trop récente refusée, semis du socle, aucune référence orpheline                          |
| `commands/reports/scoring.rs` | 5     | moyenne non pondérée, moyenne pondérée par le nombre de notes, absence de note                                                 |
| `portable.rs`                 | 5     | sonde d'écriture (dossier inscriptible, chemin inexistant), purge des traces WebView2 et profil absent, verrou qui refuse une seconde instance |
| `sql_smoke.rs`                | 1     | le plus utile : extrait toutes les requêtes SQL littérales des modules de commandes et les fait préparer par SQLite sur une base migrée — une colonne renommée ou une table oubliée est attrapée ici |

`pnpm exec tsc --noEmit` et `cargo clippy` (zéro avertissement) complètent le filet. La CI
exécute le typecheck et les tests Rust sur chaque push vers `main`.

### Ce qui n'est pas couvert

- **Aucun test frontend** : ni test unitaire, ni test de composant, ni end-to-end. Le typecheck
  TypeScript est le seul filet du front, et aucun ESLint n'est configuré.
- **Les commandes ne sont pas testées de bout en bout.** Le harnais `tauri::test::mock_builder`
  ne fonctionne pas ici : ses binaires de test meurent au démarrage avec
  `STATUS_ENTRYPOINT_NOT_FOUND`, `tauri-build` n'embarquant son manifeste Windows que dans
  l'exécutable de l'application. `sql_smoke` est le repli — il valide le SQL, pas la logique :
  une requête syntaxiquement correcte qui compte les mauvaises lignes passera.
- Le chemin de démarrage (résolution portable, ouverture de la base, boîte de dialogue fatale)
  n'est vérifié qu'à la main.

## Décisions en attente

Ces points appartiennent à l'enseignant. S'y substituer produirait des documents faux remis à
des familles ; le code les isole pour qu'en changer coûte un `UPDATE` d'une ligne, jamais une
migration.

1. **Règle de la moyenne générale.** Implémentation provisoire dans
   `src-tauri/src/commands/reports/scoring.rs`, règle lue dans
   `app_settings.overall_average_rule` — `unweighted_mean` par défaut, `weighted_by_count`
   disponible.
2. **Sort des notes d'une compétence retirée d'une évaluation.**
   `app_settings.removed_competency_policy` : `keep` par défaut (les notes survivent et restent
   comptées), `ignore` prévu (elles survivent mais sortent des moyennes).
3. **Maquette de la fiche contrat PDF**, nominative par élève. Les colonnes de
   `contract_sheet_students` sont le socle minimal qu'aucune variante envisagée ne remet en
   cause ; l'export lui-même attend la maquette.

En attente également : la **liste des champs professionnels** SEGPA. Deux listes circulent, à 4
ou 5 entrées, et la référence réglementaire n'est pas vérifiée — `professional_fields` reste
donc vide à la livraison.

## Documents liés

| Fichier                           | Pour qui                                                                 |
| --------------------------------- | ------------------------------------------------------------------------ |
| `LISEZ-MOI.txt`                   | l'utilisateur final : installation, phrase de récupération, ce que le chiffrement ne couvre pas, BitLocker To Go, sauvegarde, mot de passe oublié |
| `CLAUDE.md`                       | quiconque modifie le code : règles d'architecture non négociables         |
| `.github/copilot-instructions.md` | assistants de code                                                        |

## Licence

Projet personnel — tous droits réservés.
