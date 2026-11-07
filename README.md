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
| **Séances**           | Titre, date, trimestre déduit de la date et corrigeable à la main, indicateur « annulée » (sortie, jour férié) qui garde la séance au cahier de texte mais la sort des statistiques. Cahier de texte TipTap, **pièces jointes** (image, PDF, audio, docx — 10 Mo par fichier, images redimensionnées à 1600 px, stockées **dans la base chiffrée**), et un « rien à écrire » daté pour les séances qui n'ont pas de compte rendu à produire. |
| **Besoins particuliers** | Étiquettes de l'enseignant (dysorthographie, dyscalculie, AESH, PAP…) et une note libre par élève. L'application **n'en livre aucune** : les libellés justes sont ceux des notifications et des PAP de l'établissement. Affichés à l'appel, dans les grilles de notation, dans la liste de la classe et dans les bilans à l'écran — **sur aucun document imprimé**, et un test le vérifie. |
| **Appel**             | Cinq états : `non_fait`, `present`, `absent`, `retard`, `excuse`. « Non fait » est un état réel : rien n'est pré-rempli à « présent », et l'appel oublié se voit.                                             |
| **Référentiel**       | Arbre Cycle → Domaine → Champ → Compétence en 6 commandes, saisie par collage multi-lignes, archivage d'une compétence déjà notée plutôt que suppression. Livré pré-rempli avec les 5 domaines du socle.      |
| **Évaluations**       | Grille compétences × élèves, note entière de 1 à 20 avec son libellé de maîtrise affiché à côté (case vide = non évalué), trimestre déduit de la date. Retirer une compétence d'une évaluation demande confirmation avant de toucher aux notes.                         |
| **Fiches contrat**    | Une trame par évaluation (projet, champ professionnel et son sous-ensemble, activités de référence, métiers visés), des lignes d'activités ordonnées dont chacune peut pointer une compétence du référentiel, un tableau donné / demandé / exigé **ligne par ligne**, et une couche nominative par élève. Composable en un clic depuis les compétences de l'évaluation. |
| **Bilans**            | Par classe et par trimestre : moyennes par compétence, moyenne générale, statistiques d'assiduité (dont les séances hors période d'inscription), commentaire enseignant.                                      |
| **Export PDF**        | Bilan trimestriel et fiche contrat du projet (`src/lib/pdf.ts`), déposés dans `exports/` à côté de l'exécutable. La **fiche nominative par élève** n'a toujours pas d'export : c'est sa maquette qui n'est pas arrêtée, pas celle de la trame. |
| **Sauvegarde**        | Copie complète à la demande dans `data/backups/`, les 10 plus récentes conservées. Copie automatique avant toute migration de schéma. `VACUUM INTO` hérite de la clé : **les sauvegardes sont chiffrées elles aussi**.                                        |

### Visible dans l'interface, mais pas encore actif

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
par `invoke()` et rien d'autre : **103 commandes**, exposées par une façade typée unique
(`src/lib/api.ts`).

## Structure du projet

```
src/                                       Frontend React
├── App.tsx                                HashRouter, garde de verrouillage, interdiction du dépôt
├── main.tsx   index.css                   index.css tient TOUS les jetons de couleur
├── pages/
│   ├── FirstRun.tsx                       premier lancement : mot de passe, nom, phrase de récupération
│   ├── Unlock.tsx   Recover.tsx           déverrouillage (mot de passe ou PIN), récupération
│   ├── Home.tsx                           l'accueil : le jour même et les suivants, « À reprendre »
│   ├── Sessions.tsx                       liste des classes
│   ├── Cycles.tsx                         référentiel de compétences
│   ├── Settings.tsx                       identité, verrou, trimestres, sauvegarde, calcul, journal
│   ├── Timetable/                         l'emploi du temps **définit**, il n'ouvre rien
│   │   ├── index.tsx                      grille de la semaine, créneaux, rendez-vous
│   │   ├── WeekGrid.tsx                   le calendrier de la semaine
│   │   ├── DaysCalendar.tsx               le même jour vu par l'accueil, en colonnes
│   │   ├── journee.ts                     ce qu'une journée contient — **partagé par les deux**
│   │   └── geometry.ts                    la géométrie des deux calendriers, même raison
│   └── SessionDetail/
│       ├── index.tsx                      charge la classe, tient la liste et l'id sélectionné
│       ├── tabs/                          StudentsTab · SeancesTab · EvaluationsTab · AbsencesTab · BilansTab
│       ├── seance/SeanceDetail.tsx        appel + cahier de texte + pièces jointes
│       ├── evaluation/EvaluationDetail.tsx   grille de notes + fiche contrat
│       └── dialogs/                       StudentFormDialog · StudentNeedsDialog · AbsencePeriodDialog
├── components/
│   ├── AgendaEntryEditor.tsx              le compte rendu d'un rendez-vous, pièces comprises
│   ├── Attachments.tsx                    les pièces jointes des **deux** porteurs (`APPELS`)
│   ├── CompetencyPicker.tsx               sélection dans l'arbre du référentiel
│   ├── ConfirmDialog.tsx                  confirmation, partagée — d'où sa place ici
│   ├── ContractSheetEditor.tsx            trame + lignes d'activités + couche par élève
│   ├── DataState.tsx                      chargement / erreur / vide, dans cet ordre
│   ├── LimiteErreur.tsx                   filet de rendu : un écran lisible plutôt qu'une fenêtre blanche
│   ├── NeedsChips.tsx   NeedTagsCard.tsx  besoins particuliers — à l'écran seulement
│   ├── OccurrenceDialog.tsx               faire naître la séance d'un créneau, annulée ou non
│   ├── PinInput.tsx   RecoveryPhrase.tsx  six cases, et les douze mots
│   ├── RichEditor.tsx                     TipTap
│   ├── TrimesterBoundsDialog.tsx          bornes d'année + aperçu du recalcul
│   ├── layout/AppLayout.tsx               barre latérale, bouton Verrouiller
│   └── ui/                                14 composants shadcn
├── hooks/
│   ├── useLock.tsx                        état du verrou, partagé par tout l'arbre
│   ├── useDrafts.tsx                      brouillons non enregistrés, et l'alerte avant de quitter
│   ├── useNeeds.tsx                       le vocabulaire des besoins, chargé une fois
│   ├── useZoneDepot.ts                    glisser-déposer : **un seul exemplaire**, six pièges
│   └── useIdleTimer.ts                    écrit, pas encore branché
├── lib/
│   ├── api.ts                             façade typée des 103 commandes + ApiError
│   ├── contenu.ts                         « vide », et les trois façons de régler un compte rendu
│   ├── depot.ts                           `estDepotDeFichiers`, `interdireNavigationParDepot`
│   ├── journal.ts                         filets globaux d'erreur, sans jamais rien de personnel
│   ├── password.ts                        force du mot de passe, à l'écran seulement
│   ├── pdf.ts                             bilan trimestriel, fiche d'évaluation, fiche contrat
│   ├── teintes.ts                         la teinte d'une classe, par **position** et non par hachage
│   └── utils.ts
└── types/index.ts                         interfaces, LevelCode, MASTERY_LABELS

src-tauri/
├── src/
│   ├── main.rs                            WebView2 embarqué s'il est présent, puis run()
│   ├── lib.rs                             démarrage (sans la base), fenêtre, generate_handler!, fatal()
│   ├── state.rs                           AppState : Connection (absente = verrouillé) + verrou de fichier
│   ├── keys.rs                            enveloppes de la clé maître — data/sgpa.keys
│   ├── device.rs                          secret de poste pour le code PIN — DPAPI, hors clé USB
│   ├── portable.rs                        résolution de data/ et exports/, sonde, verrou de fichier
│   ├── journal.rs                         data/logs/ — en clair, donc rien de personnel
│   ├── sql_smoke.rs                       test : prépare toutes les requêtes contre le schéma
│   ├── db/
│   │   ├── mod.rs                         ouverture chiffrée, journal TRUNCATE, calcul des trimestres
│   │   ├── migrations.rs                  paliers pilotés par PRAGMA user_version
│   │   └── sql/
│   │       ├── 001_initial.sql            les 18 tables
│   │       ├── 002_referentiel.sql        semis du socle commun
│   │       ├── 003_sans_bcrypt.sql        la base n'héberge plus rien du verrou
│   │       └── …                          17 paliers en tout, voir le tableau plus bas
│   └── commands/
│       ├── lock.rs           verrou, code PIN, récupération, réglages  (13 commandes)
│       ├── sessions.rs       classes                   (5)
│       ├── students.rs       élèves                    (6)
│       ├── referential.rs    arbre des compétences     (6)
│       ├── timetable.rs      créneaux et rendez-vous   (14)
│       ├── seances.rs        séances et présences      (11)
│       ├── attachments.rs    pièces jointes des deux porteurs  (10)
│       ├── evaluations.rs    évaluations et notes      (7)
│       ├── needs.rs          besoins particuliers      (7)
│       ├── absences.rs       périodes d'absence        (4)
│       ├── trimesters.rs     bornes d'année            (3)
│       ├── contracts.rs      fiches contrat            (5)
│       ├── home.rs           l'accueil : les jours à venir, « À reprendre »  (2)
│       ├── reports.rs        bilans                    (2)
│       │   └── reports/scoring.rs    règle de moyenne, isolée
│       ├── maintenance.rs    sauvegardes, exports      (4)
│       └── diagnostics.rs    journal de diagnostic     (4)
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
data/logs/            un journal par jour — en clair, mais sans aucune donnée personnelle
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
cd src-tauri ; cargo test --lib   # 171 tests
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
| `wraps.pin` | absent tant qu'aucun code PIN n'est activé ; une enveloppe par poste, 8 au plus     |
| `hint`   | l'indice, **en clair** : c'est son rôle, il doit se lire base fermée                   |

L'AEAD est **XChaCha20-Poly1305** (Rust pur ; nonce de 24 octets, donc un nonce aléatoire est
sûr sans compteur). Les données associées valent `sgpa-keys-v1:password`,
`sgpa-keys-v1:recovery` ou `sgpa-keys-v1:pin:<identifiant du poste>` : intervertir deux
enveloppes est rejeté.

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

### Code PIN lié au poste

Retaper une longue phrase dix fois par jour use la patience, et un mot de passe usé devient un
mot de passe court. D'où une **troisième enveloppe, optionnelle**, ouverte par 6 chiffres.

Six chiffres seuls ne valent rien : un million de combinaisons contre Argon2id tombent en
quelques minutes sur une carte graphique, et c'est justement le scénario « quelqu'un ramasse la
clé USB ». Le PIN n'ouvre donc **jamais seul**. Il est la moitié visible d'un secret dont
l'autre moitié — 32 octets tirés au hasard — reste sur **l'ordinateur**, hors de la clé USB :

```
%LOCALAPPDATA%\SGPA\poste.bin      secret du poste (32 o) + identifiant + compteur d'essais
   protégé par DPAPI                CryptProtectData, portée « utilisateur courant »
            │
            └──┬── 32 o du poste ++ les 6 chiffres ──Argon2id──► clé d'enveloppe₃ ──► CLÉ MAÎTRE
      6 chiffres saisis
```

Ce que cela donne, honnêtement :

- **Clé USB seule** → l'enveloppe PIN est inouvrable : il manque 2²⁵⁶ possibilités.
- **Clé USB + session Windows ouverte de l'enseignant** → 10⁶ essais suffisent. Mais à ce
  stade l'attaquant est déjà *dans* la session, et le mot de passe tapé au clavier y serait
  tout aussi exposé.
- **Autre ordinateur, ou autre compte Windows** → DPAPI refuse de déballer, `pin_available`
  vaut faux, et l'écran de déverrouillage ne propose même pas le champ.

Le **compteur d'essais** (10, puis le PIN du poste est supprimé) vit dans `poste.bin` et non
dans `sgpa.keys` : sur la clé, dupliquer le fichier avant d'essayer suffirait à le remettre à
zéro. Il reste contournable par qui recopie `poste.bin` lui-même — il ne prétend donc arrêter
que les essais tapés à la main.

Trois conséquences qui se disent mal mais se paient cher si on les tait :

1. **Activer le PIN écrit un fichier hors de la clé USB.** C'est la seule exception assumée à
   la portabilité de SGPA ; rien n'est écrit tant que le PIN n'est pas activé, et
   « Oublier ce poste » efface le fichier puis l'enveloppe — dans cet ordre, parce que c'est le
   secret du poste qui est la moitié dangereuse. Échappatoire : `SGPA_DEVICE_DIR`.
2. **Changer le mot de passe ne retire pas le PIN.** La clé maître ne bouge jamais, donc
   l'enveloppe PIN continue de l'ouvrir. C'est « Oublier ce poste » qui la retire, nulle part
   ailleurs.
3. **L'identifiant de poste est un UUID tiré au hasard.** Il entre dans les données associées
   de l'enveloppe, et ne dit rien du poste — surtout pas son nom.

Côté code : `src-tauri/src/device.rs` (DPAPI, `poste.bin`), `keys::set_pin` /
`keys::unwrap_with_pin` / `keys::remove_pin`, et les commandes `unlock_with_pin`, `enable_pin`,
`disable_pin`.

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
  unlock_with_pin(pin)   secret du poste (DPAPI) ++ 6 chiffres → même chemin ; 10 essais max
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

### Les 31 tables

```
app_settings                     ligne unique — remplace l'ancienne table users
trimester_bounds                 bornes contiguës d'une année scolaire
professional_fields              vide à la livraison
school_holidays                  vacances et jours fériés, origine officielle ou manuelle
student_need_tags                vocabulaire des besoins particuliers — vide à la livraison

savoir_groups
└── savoirs                      savoirs techniques rattachables à une fiche contrat

cycles
└── domains
    └── fields
        └── competencies         archived_at plutôt qu'une suppression destructrice

sessions                         une classe pour une année (level_code + year_start)
├── students                     enrolled_on / left_on, needs_note
│   ├── report_comments          (student_id, trimester)
│   └── student_needs            (student_id, tag_id) → étiquettes posées sur l'élève
├── timetable_slots              créneaux récurrents ; session_id NULL = occupation sans classe
├── agenda_entries               rendez-vous datés ; session_id et student_id facultatifs,
│   │                            content_waived_at comme une séance
│   └── agenda_entry_attachments BLOB — jumelle de seance_attachments, pas une colonne « porteur »
├── absence_periods              absence justifiée, collective (student_id NULL) ou nominative
│   └── stage_placements         un placement désarme la période pour l'élève concerné
├── seances                      trimester, trimester_is_manual, cancelled, content_html,
│   │                            content_waived_at (« rien à écrire », daté)
│   ├── attendance_records       (seance_id, student_id) → non_fait | present | absent | retard | excuse
│   └── seance_attachments       BLOB dans la base : les sauvegardes les emportent
└── evaluations                  trimester, trimester_is_manual
    ├── evaluation_competencies  compétences retenues, RESTRICT vers competencies
    ├── grades                   (evaluation_id, competency_id, student_id) → mark 1 à 20,
    │                             le libellé de maîtrise n'est que sa lecture ; pas de ligne = non évalué
    └── contract_sheets          une trame par évaluation
        ├── contract_sheet_rows          lignes d'activités, id stable d'un enregistrement à l'autre,
        │                                competency_id facultatif vers competencies
        ├── contract_sheet_requirements  tableau on donne / on demande / on exige, une ligne = trois cases alignées
        ├── contract_sheet_savoirs       savoirs associés à la fiche
        └── contract_sheet_students      couche nominative : rôle, appréciation, dates
```

L'arbre dit la **composition**, pas la totalité des clés : `timetable_slots` et
`agenda_entries` pendent à `sessions` par un `session_id` **nullable** — une occupation sans
classe et une réunion de secteur n'appartiennent à personne —, et `agenda_entries.student_id`
pointe en plus vers `students`. `seances.slot_id` est en `ON DELETE SET NULL` : supprimer un
créneau ne doit jamais emporter un appel déjà fait.

`ON DELETE CASCADE` sur les liens de composition ; `ON DELETE RESTRICT` vers `competencies` :
supprimer une compétence déjà notée est refusé par SQLite, et la commande traduit le refus en
proposition d'archivage.

### Migrations

Le schéma est versionné par `PRAGMA user_version`. `src-tauri/src/db/migrations.rs` tient la
liste ordonnée des paliers, chacun étant un fichier de `db/sql/` :

| Palier | Fichier                        | Contenu                                                                                  |
| ------ | ------------------------------ | ---------------------------------------------------------------------------------------- |
| 1      | `001_initial.sql`              | les 18 tables de départ                                                                  |
| 2      | `002_referentiel.sql`          | 5 domaines du socle commun, 4 composantes du domaine 1                                   |
| 3      | `003_sans_bcrypt.sql`          | `DROP COLUMN` de `app_settings.password_hash` et `.password_hint`                         |
| 4      | `004_emploi_du_temps.sql`      | créneaux récurrents, entrées datées                                                      |
| 5      | `005_periodes_absence.sql`     | périodes d'absence justifiée, collectives ou nominatives                                 |
| 6      | `006_suivi_de_stage.sql`       | placements de stage, qui désarment la période pour l'élève concerné                      |
| 7      | `007_motif_annulation.sql`     | motif d'annulation d'une séance (aucune table nouvelle)                                  |
| 8      | `008_calendrier_scolaire.sql`  | `school_holidays` : vacances et jours fériés, origine officielle ou manuelle              |
| 9      | `009_referentiel_socle.sql`    | socle commun complet par cycle, 5 champs professionnels, `savoir_groups` / `savoirs` / `contract_sheet_savoirs` |
| 10     | `010_fiche_contrat.sql`        | `contract_sheet_requirements`, `contract_sheet_rows.competency_id` et `.required_text`, `socle_domain` renommé `professional_subset` |
| 11     | `011_code_domaine.sql`         | `domains.code` (« D1 »… « D5 »), pour que la colonne « domaines » d'une fiche désigne le cycle ET le domaine |
| 12     | `012_pieces_jointes.sql`       | `seance_attachments` : pièces jointes au cahier de texte, contenu en BLOB dans la base chiffrée |
| 13     | `013_besoins_particuliers.sql` | `student_need_tags`, `student_needs`, `students.needs_note` — vocabulaire livré **vide** |
| 14     | `014_cahier_sans_contenu.sql`  | `seances.content_waived_at` : « rien à écrire », daté (aucune table nouvelle) |
| 15     | `015_regles_de_calcul.sql`     | règles de calcul arrêtées : les notes d'une compétence retirée sortent des moyennes (aucune table, aucune colonne — une valeur) |
| 16     | `016_rendez_vous_classe.sql`   | `agenda_entries.session_id` : la classe d'un rendez-vous, facultative, déduite de l'élève quand il y en a un (aucune table nouvelle) |
| 17     | `017_rendez_vous_compte_rendu.sql` | `agenda_entries.content_waived_at` et `agenda_entry_attachments` : un rendez-vous a désormais le même compte rendu qu'une séance — pièces jointes comprises |
| 18     | `018_note_sur_20.sql`          | `grades.mark`, note entière de 1 à 20, remplace `grades.level` : le libellé de maîtrise devient la lecture de la note et non son origine. Table reconstruite — SQLite ne sait pas remplacer le CHECK d'une colonne, et `BETWEEN 0 AND 5` aurait refusé toute note au-dessus de 5 dès la première frappe |

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

### Pièces jointes d'un compte rendu

Image, PDF, audio, `.docx` : le contenu est un **BLOB dans la base** — `seance_attachments`
pour une séance, `agenda_entry_attachments` pour un rendez-vous —, pas un fichier posé à côté
d'elle. Trois raisons, dans l'ordre :

1. **La sauvegarde les emporte.** `VACUUM INTO` copie la base entière ; un dossier
   `data/pieces/` à côté aurait produit des sauvegardes qui *paraissent* complètes et
   ressuscitent un cahier de texte aux images cassées.
2. **Elles sont chiffrées comme le reste.** Une photo de tableau porte des écritures d'élèves,
   parfois leurs prénoms. Un fichier en clair sur une clé USB perdue annulerait l'intérêt de
   SQLCipher.
3. **Une clé USB supporte mal des milliers de petits fichiers**, et rien ne se perd en route
   quand on déplace le dossier de l'application.

Le prix est connu et borné : **10 Mo par fichier**, et les images sont redimensionnées à
~1600 px de côté avant d'être stockées — large de quoi relire un tableau à l'écran, sans faire
grossir la base d'un cliché de 12 Mo par séance. Le plafond est vérifié sur les **octets
décodés**, pas sur la chaîne base64 reçue de la WebView, qui est un tiers plus longue.

« Ouvrir » une pièce jointe écrit une copie **en clair** dans `exports/`, parce qu'il faut bien
un fichier sur le disque pour que Word ou le lecteur audio du poste s'en saisissent. C'est le
même compromis que les PDF exportés, et c'est pour cela qu'`exports/` vit sur la clé et non
dans le `%TEMP%` du poste hôte.

**Deux tables, une logique.** Le palier 017 a donné les mêmes pièces jointes aux rendez-vous,
et le choix de la seconde table plutôt qu'une colonne « porteur » n'est pas un goût : SQLite
refuse une clé étrangère qui désignerait tantôt `seances`, tantôt `agenda_entries`, et une
cascade écrite à la main aurait laissé des BLOB orphelins — des octets d'élèves sans
propriétaire, la seule fuite que rien ne vient nommer. Le plafond, l'assainissement du nom, le
refus du dossier, la réduction à 1600 px et l'export en clair restent donc écrits **une seule
fois** : `Porteur` choisit un jeu de requêtes `&'static str` en Rust (**littérales, jamais un
`format!`**, pour que `sql_smoke` les prépare), `APPELS` choisit une famille d'appels dans
`src/components/Attachments.tsx`, et un test vérifie que les deux jeux de requêtes restent
jumeaux — une divergence ne se serait vue que sur l'écran le moins fréquenté.

**Un compte rendu est réglé de trois façons**, et c'est ce qui compte à l'écran : du texte, un
« rien à écrire », ou au moins une pièce jointe. Le backend l'applique dans `home.rs`, le
front dans `etatDuCompteRendu` / `compteRenduRegle` (`src/lib/contenu.ts`), et les quatre vues
qui affichent cet état en tirent aussi leurs mots. Sans cette unité, joindre la photo du
tableau faisait taire « À reprendre » tout en laissant le calendrier juste à côté — sur le
même écran — réclamer « cahier vide ».

#### Glisser-déposer : pourquoi il ne passe pas par Tauri

Tout l'onglet « Cahier de texte » est une zone de dépôt, éditeur compris — c'est là que la main
va quand on glisse la photo du tableau, pas sur une petite cible dans une carte en bas. Depuis
le palier 017, le compte rendu d'un rendez-vous en est une aussi, et par le **même** hook
(`src/hooks/useZoneDepot.ts`) : la mécanique tient en six pièges venus chacun d'un bug réel, et
deux copies divergeraient dès le premier corrigé d'un seul côté. Les
fichiers lâchés **rejoignent les pièces jointes ; ils ne sont pas insérés dans le texte du
compte rendu**, et le calque de survol le dit, parce que les octets vivent dans la base et non
dans le HTML.

Tauri sait intercepter un dépôt sur la fenêtre, et SGPA le lui **retire** :
`disable_drag_drop_handler()` sur le constructeur de fenêtre, dans `src-tauri/src/lib.rs`. Son
événement ne porte que des **chemins**. Il aurait fallu lire le fichier en Rust, donc sauter le
redimensionnement à 1600 px que fait le front — et une photo de téléphone lâchée aurait été
refusée à 8 Mo quand la même, choisie au bouton, passe à 300 Ko. Le même geste doit donner le
même résultat : le dépôt et le bouton appellent donc tous deux `deposer`, et il n'existe qu'un
seul chemin d'acceptation (réduction, plafond, refus nommés).

La contrepartie est réelle et se paie côté front. Privé du gestionnaire de Tauri, WebView2
applique le comportement par défaut d'un navigateur et **navigue vers le fichier lâché** :
l'application disparaîtrait derrière un PDF, sans barre d'adresse pour revenir. D'où
`interdireNavigationParDepot` (`src/lib/depot.ts`), posé sur `document` **au-dessus du garde de
verrouillage** — l'écran de mot de passe est précisément celui où un fichier lâché ferait le
plus de dégâts.

Trois détails qui ne sont pas des détails :

- Un dossier est **refusé en le nommant**, sans interrompre les fichiers lâchés à côté de lui.
  `webkitGetAsEntry()` est le seul moyen de le distinguer d'un fichier vide : les deux arrivent
  avec une taille de zéro octet, et le laisser filer aurait produit « Le fichier est vide ».
- Tout dépôt est d'abord testé par `estDepotDeFichiers` (`types.includes("Files")`, car `files`
  reste vide jusqu'au `drop`). Sans ce test, la zone avalerait le déplacement de texte à la
  souris dans l'éditeur.
- La zone écoute en phase de **capture**, avec `stopPropagation`. ProseMirror installe ses
  propres gestionnaires de dépôt sur son nœud ; sans la capture, il verrait le fichier et
  insérerait son chemin comme texte dans le compte rendu.

Les **entrées datées** de l'agenda (réunion, ESS, visite de stage) ont, **depuis le palier
017, les mêmes pièces jointes et le même « rien à écrire »** qu'une séance — un compte rendu
de visite se signe sur papier, et sans la convention scannée il n'y avait rien à joindre au
texte. Même geste, même plafond, même export en clair, parce que c'est la même zone de dépôt
(`useZoneDepot`) et le même composant (`Attachments`) : seuls le nom de la table et deux
phrases d'exemple changent. Elles nomment aussi, depuis le palier 016, une **classe** et
facultativement un **élève** — la classe étant déduite de l'élève dès qu'il y en a un, et un
couple contradictoire refusé plutôt que rectifié en silence (`resolve_entry_session`).

### Besoins particuliers des élèves

`student_need_tags` est le vocabulaire de l'enseignant — « Dysorthographie », « AESH », « PAP »
— et il est **livré vide**, comme `professional_fields` : les libellés justes sont ceux des
notifications MDPH et des PAP de l'établissement, et une liste pré-remplie aurait surtout servi
à faire cocher l'étiquette approchante. `student_needs` relie une étiquette à un élève,
`students.needs_note` porte ce qui ne se range dans aucune étiquette (« tiers temps », « lit
mieux en Arial 14 »).

Ces informations s'affichent à la feuille d'appel, dans la grille de notation d'une évaluation,
dans la liste des élèves de la classe et dans les bilans **à l'écran**. Elles ne figurent sur
**aucun document imprimé** — ni bulletin, ni fiche contrat, ni liste exportée. Ce sont des
données de santé concernant des mineurs, la décision est explicite, et elle est tenue par un
test plutôt que par un commentaire : `commands/needs.rs` relit `commands/reports.rs`,
`commands/reports/scoring.rs`, `commands/contracts.rs` et `src/lib/pdf.ts`, et échoue si l'un
d'eux cite `student_need_tags`, `student_needs` ou `needs_note`. `src/lib/pdf.ts` en fait
partie parce que c'est lui qui dessine réellement les PDF : un garde-fou qui s'arrêterait à la
frontière du Rust laisserait passer exactement l'erreur qu'il surveille.

Une limite assumée : les étiquettes sont posées sur un **élève**, et un élève est propre à une
classe d'une année. Le même enfant en 4ᵉ puis en 3ᵉ est deux lignes de `students`, donc ses
étiquettes sont à reposer en septembre. Le vocabulaire, lui, est global et ne se ressaisit
jamais.

## Journal de diagnostic

En release, `windows_subsystem = "windows"` supprime la console. Une panique Rust, une exception
de rendu React, un palier de migration en échec ne laissaient donc **aucune trace** : la seule
information qui remontait était « ça n'a pas marché ». D'où `data/logs/sgpa-AAAA-MM-JJ.log`, un
fichier par jour, quinze jours conservés, 1 Mio par fichier au plus.

### En clair, hors de la base, et donc sans rien de personnel

Le journal est **en clair**, délibérément. La panne qu'il doit couvrir inclut « la base ne
s'ouvre plus » : un journal rangé dans `sgpa.db` serait illisible précisément le jour où il
sert.

La contrepartie n'est pas négociable : **il ne contient aucune donnée personnelle**. Et ce n'est
pas une consigne de vigilance, c'est une contrainte de forme — `diagnostics::log_command_failure`
ne prend **que le nom de la commande**, et n'a aucun paramètre `message` où le prénom d'un élève
pourrait se glisser. La fuite est réelle et mesurée : `commands/absences.rs` interpole
`{prenom} {nom}` dans son message d'erreur français. Un paramètre `message` aurait suffi à
recopier ce prénom sur la clé USB, et il se serait ajouté un jour « juste pour mieux
diagnostiquer ».

La même règle tient côté front (`src/lib/journal.ts`) : une ressource qui ne se charge pas ne
livre que le **schéma** de son URL, jamais l'URL. Les pièces jointes s'affichent par des URL
`data:` — journaliser l'URL d'une image en échec aurait recopié la photo dans le fichier.

C'est ce qui permet à l'enseignant d'envoyer le fichier sans le relire, et c'est ce que lui dit
la carte de Réglages.

### Il n'échoue jamais

`journal::*` est appelé depuis le crochet de panique, donc il ne panique pas et ne renvoie
aucune erreur — même règle que `db/holidays.rs`, appelé depuis une migration. Un dossier non
installé rend l'écriture muette : **pas de repli** sur `exe_dir()`, qui écrirait hors du dossier
de données et sèmerait des fichiers sous `target/` pendant les tests.

`journal::init` et `installer_capture_de_panique` sont appelés dans `start()` juste après
`portable::resolve()`. Un échec de `resolve` lui-même n'est donc pas journalisable — il n'y a
alors aucun dossier où écrire —, et c'est la `MessageBoxW` de `fatal()` qui le dit.

### Ce qui y écrit

Les sept `eprintln!` existants ont été **convertis**, pas doublés : ces points d'appel avaient
déjà décidé de ce qui méritait d'être signalé, et en release ils le signalaient à personne. Le
journal `eprintln!` toujours de son côté, donc la console de `pnpm tauri dev` est inchangée.

| Origine                 | Ce qu'elle inscrit                                                        |
| ----------------------- | ------------------------------------------------------------------------- |
| `démarrage`             | la ligne de bannière (version, schéma, OS, dossier), et tout `fatal()`     |
| `panique`               | le crochet de panique, qui rappelle ensuite le précédent                  |
| `migration`             | chaque palier appliqué, et surtout **le palier en échec** — l'information qui manque le jour où « l'application ne s'ouvre plus après la mise à jour » |
| `calendrier scolaire`   | semis des vacances : périodes écartées, fichier illisible                  |
| `sauvegardes/rotation`  | une sauvegarde ancienne qui n'a pas pu être supprimée                      |
| `commande`              | le **nom** d'une commande qui a échoué côté interface                      |
| `interface/*`           | exception de rendu, promesse rejetée, ressource non chargée                |

Côté front, trois filets qui ne se remplacent pas :

- `components/LimiteErreur.tsx` pour le **rendu**, monté au-dessus du garde de verrouillage
  comme `interdireNavigationParDepot` — une fenêtre blanche sur l'écran de mot de passe
  n'offrirait aucun moyen d'entrer dans l'application ;
- les écouteurs globaux de `lib/journal.ts` pour les gestionnaires d'événement et les promesses
  rejetées, posés en phase de **capture** (une erreur de chargement de ressource ne se propage
  pas jusqu'à `window`) ;
- `DataState` pour les erreurs de commande, qui sont les seules à devoir s'afficher en français
  à l'écran.

Tout est plafonné : 200 événements par session, 5 par signature. Une boucle de rendu en défaut
journalise des milliers de fois par seconde — sans plafond, elle remplirait la clé.

### Ce que l'enseignant en voit

Réglages → « Journal de diagnostic » : le fichier du jour, sa taille, le nombre de fichiers
conservés, les 40 dernières lignes au besoin, et un bouton qui ouvre le dossier dans
l'Explorateur. Le geste visé est « joindre ce fichier à un message ».

`get_journal_info`, `reveal_logs_dir`, `log_command_failure` et `log_ui_error` sont les quatre
seules commandes qui **n'exigent pas la session déverrouillée** : le moment où un diagnostic
manque le plus est celui où la base refuse de s'ouvrir, donc avant le mot de passe. Aucune ne
touche la base.

## Tests

`cargo test --lib`, depuis `src-tauri/` — **171 tests** :

| Fichier                       | Tests | Ce qui est vérifié                                                                                                            |
| ----------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| `keys.rs`                     | 24    | aller-retour des deux enveloppes, mauvais mot de passe, phrase étrangère, normalisation de la saisie, changement de mot de passe, régénération qui invalide l'ancienne phrase, récupération puis nouveau mot de passe, enveloppes interverties rejetées par l'AAD, écriture atomique, absence de toute identité dans le fichier, paramètres KDF hors bornes, secrets qui refusent de s'afficher ; enveloppe PIN : un PIN seul n'ouvre rien sans le secret du poste, changer de mot de passe ne retire pas le PIN, nombre d'enveloppes borné, un fichier écrit avant le PIN reste lisible |
| `device.rs`                   | 6     | le secret du poste : aller-retour sous DPAPI, fichier illisible en clair, fichier altéré refusé, compteur d'essais qui survit à la relecture, absence de fichier qui n'est pas une erreur, secret qui refuse de s'afficher |
| `commands/maintenance.rs`     | 12    | noms d'export : traversée de chemin, caractères interdits, noms réservés Windows, longueur, désambiguïsation des doublons ; rotation et listage des sauvegardes |
| `db/mod.rs`                   | 9     | la base se rouvre avec la même clé, une mauvaise clé est refusée par la lecture de contrôle, le fichier sur le disque ne laisse rien lire, `VACUUM INTO` reste chiffré, base sans `sgpa.keys` mise de côté ; trimestre aux dates charnières, hors bornes, année bissextile, bornes par défaut |
| `commands/students.rs`        | 6     | découpage nom / prénom des lignes collées, noms composés, lignes vides, validation des dates                                   |
| `commands/trimesters.rs`      | 6     | validation des bornes : ordre, égalité fin / début de T3, dates impossibles, année hors bornes, libellé court de date          |
| `db/migrations.rs`            | 14    | version atteinte, idempotence, base trop récente refusée, semis du socle, aucune référence orpheline ; et des bases peuplées qui traversent les derniers paliers **intactes** — celle du palier 016 vérifie en plus que la classe d'un rendez-vous est bien déduite de son élève et qu'une reprise n'en invente aucune, celle du palier 017 qu'aucun « rien à écrire » n'est inventé et qu'**aucun octet ne survit à sa classe** — deux cascades enchaînées, posées par `ALTER TABLE`, réellement actives ; celle du palier 018 qu'aucun libellé ne change de sens à la conversion, que les index et le `RESTRICT` sont bien reposés sur la table reconstruite, et que le nouveau CHECK refuse 0, 21 et −1 |
| `commands/reports/scoring.rs` | 5     | moyenne non pondérée, moyenne pondérée par le nombre de notes, absence de note — sur 20 depuis le palier 018                     |
| `portable.rs`                 | 5     | sonde d'écriture (dossier inscriptible, chemin inexistant), purge des traces WebView2 et profil absent, verrou qui refuse une seconde instance |
| `commands/timetable.rs`       | 19    | créneaux récurrents : chevauchements, bornes d'horaire, jours de la semaine, entrées datées et leur rattachement ; `feries.rs` ajoute 4 tests sur les jours fériés mobiles |
| `commands/reports.rs`         | 15    | assiduité : séances hors période d'inscription, absences justifiées collectives ou nominatives, placements de stage qui désarment la période pour un seul élève |
| `commands/absences.rs`        | 13    | périodes d'absence justifiée : validation des bornes, chevauchements, portée collective ou nominative, cascade vers les placements |
| `db/holidays.rs`              | 8     | découpage d'une année scolaire, semis du calendrier officiel, et surtout : un semis impossible ne fait **rien** échouer — un `?` à cet endroit détruirait `data/sgpa.keys` |
| `commands/seances.rs`         | 8     | appel : « non fait » comme état réel, appel collectif, remise à zéro, création depuis un créneau |
| `commands/attachments.rs`     | 3     | le plafond de 10 Mo porte sur les octets **décodés** et non sur la chaîne base64 reçue ; taille affichée en français (« 312 Ko », « 1,4 Mo ») ; les deux porteurs ont des requêtes jumelles — une divergence ne se verrait que sur l'écran le moins fréquenté |
| `commands/needs.rs`           | 1     | le garde-fou de la décision « jamais imprimé » : `reports.rs`, `reports/scoring.rs`, `contracts.rs` et `src/lib/pdf.ts` sont relus et ne doivent citer ni `student_need_tags`, ni `student_needs`, ni `needs_note` |
| `commands/contracts.rs`       | 5     | le libellé saisi survit à l'enregistrement, une compétence inconnue garde le texte et lâche le lien, plusieurs activités partagent une seule compétence (ce qui l'empêche de compter plusieurs fois), supprimer la compétence conserve la ligne, le tableau des consignes accepte plusieurs lignes alignées |
| `commands/referential.rs`     | 5     | libellé d'un domaine du socle : forme complète « D3 — … (Cycle 3) », code absent sans tiret orphelin, cycle absent sans parenthèses vides, nom absent qui ne produit rien, espaces rognés |
| `journal.rs`                  | 6     | une erreur arrive bien dans le fichier du jour, un événement tient sur une seule ligne, un détail démesuré est tronqué sur une frontière de caractère, la purge emporte les anciens et garde les récents, et surtout : un dossier impossible ne fait **rien** échouer, et sans dossier installé écrire est un non-événement — ces deux-là tiennent le fait que le crochet de panique l'appelle |
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

1. **Maquette de la fiche contrat PDF, nominative par élève.** La trame du projet, elle,
   s'exporte : `exportContractSheetPDF` reproduit les trois tableaux de la fiche d'origine,
   fusions verticales comprises. Ce qui attend est la variante remise à chaque élève. Les
   colonnes de `contract_sheet_students` sont le socle minimal qu'aucune variante envisagée ne
   remet en cause.

En attente également : la **liste des champs professionnels** SEGPA. Deux listes circulent, à 4
ou 5 entrées, et la référence réglementaire n'est pas vérifiée — `professional_fields` reste
donc vide à la livraison.

### Règles de calcul, arrêtées le 2026-11-06

Elles étaient en attente depuis le palier 001, où leurs valeurs par défaut étaient des
emplacements tenus et non des choix. Le **palier 015** les arrête, et les deux sont désormais
**modifiables dans les Réglages**.

| Règle                                      | Valeur retenue      | Effet                                                                     |
| ------------------------------------------ | ------------------- | ------------------------------------------------------------------------- |
| `overall_average_rule`                     | `unweighted_mean`   | chaque compétence pèse pareil, qu'elle porte une note ou huit             |
| `removed_competency_policy`                | `ignore`            | les notes d'une compétence retirée d'une évaluation sortent des moyennes  |

`unweighted_mean` était déjà la valeur livrée : le palier 015 n'écrit donc rien pour elle. Un
`UPDATE` qui « confirme » une valeur inchangée aurait fait croire à un changement de règle à qui
relirait le palier, et aurait bousculé `updated_at` sans raison.

`ignore` **ne supprime aucune note.** La règle vit dans la requête — un fragment
`AVERAGES_IGNORE_REMOVED` greffé par un `match` sur des `&'static str` — jamais dans le
stockage : les notes restent dans `grades`, et remettre la compétence dans l'évaluation les fait
revenir dans le calcul. Supprimer réellement ces notes donnerait le même bilan et serait
irréversible ; c'est ce piège que tient le test
`une_base_v14_peuplee_traverse_le_palier_015_intacte`.

Les moyennes étant calculées à la lecture, changer l'une de ces règles **recalcule les bilans
déjà établis**, trimestres passés compris. La carte des Réglages le dit.

L'**ordre de l'échelle de maîtrise** a été confirmé le même jour : insuffisante · fragile ·
presque · satisfaisante · très bonne. Le classeur source inverse les niveaux 2 et 3 ; l'ordre
du code a été retenu.

### La note sur 20 (palier 018, 2026-11-07)

L'enseignant **saisit une note entière de 1 à 20**, et le libellé de maîtrise s'affiche à côté
d'elle. La chaîne allait dans l'autre sens jusque-là : on cliquait un degré parmi cinq, et la
note /20 s'en déduisait à quatre points par degré.

Les cinq tranches sont 1-4 insuffisante, 5-8 fragile, 9-12 presque, 13-16 satisfaisante,
17-20 très bonne. Elles ne sont écrites **qu'une fois**, dans `MASTERY_BANDS` et `niveauDeNote`
(`src/types/index.ts`) : pas de CHECK sur le libellé, pas de colonne calculée, pas de table de
correspondance. Le backend ne nomme jamais un degré — il stocke un nombre et en vérifie les
bornes. Un libellé stocké figerait le découpage au jour de la saisie, et le relâcher plus tard
changerait les bilans déjà établis sans que rien ne le signale.

**Il n'y a pas de note de 0.** « Non évalué » est l'absence de ligne dans `grades`, comme
l'appel non fait n'est pas un « présent » par défaut. Effacer une note est donc une commande
à part, `delete_grade`, et non un `set_grade(…, 0)` : une flèche restée enfoncée effacerait
sinon une note par simple débordement.

La conversion n'a perdu aucun libellé : les anciens points 4, 8, 12, 16 et 20 sont exactement
les **hauts** des cinq tranches, donc `mark = level * 4` a conservé à chaque note déjà saisie
le libellé qu'elle affichait. C'est ce que tient le test
`une_base_v17_notee_traverse_le_palier_018_sans_perdre_un_libelle`.

Sur la **fiche d'évaluation remise à l'élève**, la note par compétence n'apparaît pas : il lit
un libellé de maîtrise — une croix dans l'une des cinq colonnes — et sa moyenne sur
l'évaluation. La règle est tenue par la forme des données : la fiche reçoit des degrés,
convertis à la source, et la note par compétence n'arrive jamais jusqu'au générateur de PDF.

Ce qui **n'existe pas** et reste à concevoir si le besoin vient : pondération des trimestres et
moyenne annuelle, coefficients d'évaluation, et toute notion de dispense — absente du schéma.

## Documents liés

| Fichier                           | Pour qui                                                                 |
| --------------------------------- | ------------------------------------------------------------------------ |
| `LISEZ-MOI.txt`                   | l'utilisateur final : installation, phrase de récupération, ce que le chiffrement ne couvre pas, BitLocker To Go, sauvegarde, mot de passe oublié |
| `CLAUDE.md`                       | quiconque modifie le code : règles d'architecture non négociables         |
| `.github/copilot-instructions.md` | assistants de code                                                        |

## Licence

Projet personnel — tous droits réservés.
