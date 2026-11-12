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
| **Groupes**           | Une classe se dédouble en autant de groupes que voulu, librement nommés (atelier cuisine, atelier bois, groupe de besoin). Un élève n'appartient qu'à un seul. Un créneau, une séance, une évaluation et une période d'absence peuvent viser un groupe ; **« groupe 1 semaine A, groupe 2 semaine B » se pose avec deux créneaux de parité complémentaire**, le mécanisme existait déjà. Un élève qu'aucun groupe ne réclame reste convoqué partout : un oubli de répartition se voit à l'appel au lieu de disparaître des calculs. |
| **Établissements**    | Une classe peut nommer l'établissement où elle se tient. La liste est **vide à la livraison** — c'est le vocabulaire de l'enseignant —, et un établissement porte un premier réglage : les **compétences qu'il n'emploie pas**, retirées des menus de saisie de ses classes. C'est un filtre de saisie et jamais un masque : une note déjà posée reste visible, comptée et imprimée, et aucun document imprimé ne change. |
| **Élèves**            | Ajout unitaire ou collage multi-lignes depuis un tableur. `enrolled_on` / `left_on` bornent l'assiduité : un élève arrivé en janvier n'est pas compté absent de septembre à décembre.                        |
| **Séances**           | Titre, date, trimestre déduit de la date et corrigeable à la main, indicateur « annulée » (sortie, jour férié) qui garde la séance au cahier de texte mais la sort des statistiques. Cahier de texte TipTap, **pièces jointes** (image, PDF, audio, docx — 10 Mo par fichier, images redimensionnées à 1600 px, stockées **dans la base chiffrée**), et un « rien à écrire » daté pour les séances qui n'ont pas de compte rendu à produire. |
| **Emploi du temps**  | La grille hebdomadaire : créneaux récurrents, toutes les semaines ou **une semaine sur deux** (parité du numéro ISO), **plusieurs cours sur la même case** quand ils alternent, cours ponctuels et rendez-vous datés. Elle **définit** et ne contient aucun écran de séance : l'appel et le cahier de texte vivent à l'accueil et dans la fiche de classe. Vue « Semaine » par défaut, vue « Année » pour comparer les progressions de toutes les classes. |
| **Absences & sorties** | Une période nomme les jours où une classe, ou un seul élève, n'est pas en cours : stage, hospitalisation, séjour. Trois cas distincts — elle **retire** ses séances du dénominateur d'assiduité (stage), ou l'**appel se fait quand même** (sortie scolaire, CDI), ou c'est le **professeur** qui manquait (formation, maladie), auquel cas l'accueil ne réclame ni appel ni cahier de texte. |
| **Besoins particuliers** | Étiquettes de l'enseignant (dysorthographie, dyscalculie, AESH, PAP…) et une note libre par élève. L'application **n'en livre aucune** : les libellés justes sont ceux des notifications et des PAP de l'établissement. Affichés à l'appel, dans les grilles de notation, dans la liste de la classe et dans les bilans à l'écran — **sur aucun document imprimé**, et un test le vérifie. |
| **Appel**             | Cinq états : `non_fait`, `present`, `absent`, `retard`, `excuse`. « Non fait » est un état réel : rien n'est pré-rempli à « présent », et l'appel oublié se voit.                                             |
| **Référentiel**       | **Deux arbres, deux onglets.** « Compétences » : Cycle → Domaine → Champ → Compétence en 6 commandes. « Activités » : Champ professionnel → Domaine d'activité → activités de référence et métiers, soit le RA16, modifiable et extensible comme le reste. Les deux partagent leur composant de ligne et leur vocabulaire, et les mêmes gestes : saisie par collage multi-lignes, renommage, déplacement, et un décompte annoncé **avant** la suppression — une compétence déjà notée, retenue par une évaluation ou citée par une progression s'archive au lieu de disparaître, et les trois sont comptées avant le refus. Livré pré-rempli avec les 5 domaines du socle et le RA16 du champ Habitat.      |
| **Évaluations**       | Grille compétences × élèves, note entière de 1 à 20 avec son libellé de maîtrise affiché à côté. Une case sans note dit laquelle des deux choses elle veut dire — *en attente*, ou *ne sera pas évaluée*, déclaré d'un clic et réversible. Trimestre déduit de la date. Retirer une compétence d'une évaluation demande confirmation avant de toucher aux notes.                         |
| **Fiches contrat**    | Une trame par évaluation (projet, champ professionnel, **domaine d'activité**, **activité de référence**, **métier visé** — les trois derniers choisis dans le référentiel RA16 quand le champ en a un, saisis à la main sinon), des lignes d'activités ordonnées dont chacune peut pointer une compétence du référentiel, un tableau donné / demandé / exigé **ligne par ligne**, et une couche nominative par élève. Composable en un clic depuis les compétences de l'évaluation. |
| **Progression**       | La planification de l'année d'une classe : les **domaines** explorés, découpés en **séquences** (objectifs, métier et CAP) qui portent des **activités** (nom, objectif et compétences du **référentiel** obligatoires), posées à la souris sur les **vraies semaines** du calendrier (avec les stages et absences des élèves) — deux bandes, vacances et stages lus du calendrier officiel. Une par classe. Vue « Année » de l'emploi du temps pour comparer toutes les classes d'un coup d'œil, export PDF en paysage. |
| **Bilans**            | Par classe et par trimestre : moyennes par compétence, moyenne générale, statistiques d'assiduité (dont les séances hors période d'inscription, celles d'une absence justifiée et celles tenues **avec un autre groupe**, chacune avec sa propre phrase), commentaire enseignant.                                      |
| **Export PDF**        | Bilan trimestriel, fiche contrat du projet et **progression annuelle** (`src/lib/pdf.ts`), déposés dans `exports/` à côté de l'exécutable. La **fiche nominative par élève** n'a toujours pas d'export : c'est sa maquette qui n'est pas arrêtée, pas celle de la trame. |
| **Sauvegarde**        | Copie complète à la demande dans `data/backups/`, les 10 plus récentes conservées. Copie automatique avant toute migration de schéma. `VACUUM INTO` hérite de la clé : **les sauvegardes sont chiffrées elles aussi**.                                        |

### Visible dans l'interface, mais pas encore actif

- **Champs professionnels** : les **cinq** champs SEGPA sont semés par le palier 009, et
  l'éditeur de fiche contrat permet d'en ajouter. Ce qui reste en attente n'est pas le
  semis mais la **référence réglementaire** : deux listes circulent, à 4 ou 5 entrées, et
  c'est celle à 5 qui a été retenue — voir « Décisions en attente ».
- **Référentiel RA16** : seul le champ **Habitat** en a un (palier 024) — trois domaines
  d'activité, trente-quatre activités de référence, vingt-et-un métiers, lus du référentiel
  national. Les autres champs n'en ont pas, et l'éditeur y garde ses champs de saisie libre.
  L'onglet « Activités » du Référentiel les montre et permet d'en ajouter : un champ sans
  référentiel s'y remplit comme le reste, et c'est le seul moyen d'y voir autre chose que
  Habitat.
- **Domaines de progression** : `progression_domaines` est vide elle aussi, pour la même
  raison — c'est le vocabulaire de l'enseignant, pas celui de l'application. Ils se créent
  depuis la fiche de classe, onglet « Progression » → « Domaines ».

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
par `invoke()` et rien d'autre : **124 commandes**, exposées par une façade typée unique
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
│   │   ├── index.tsx                      onglets « Semaine » (défaut) et « Année » — `?vue=annee`
│   │   ├── WeekGrid.tsx                   le calendrier de la semaine
│   │   ├── YearGrid.tsx                   l'année, une ligne par classe — **montre et ne modifie pas**
│   │   ├── DaysCalendar.tsx               le même jour vu par l'accueil, en colonnes
│   │   ├── journee.ts                     ce qu'une journée contient — **partagé par les deux**
│   │   └── geometry.ts                    la géométrie des deux calendriers, même raison
│   └── SessionDetail/
│       ├── index.tsx                      charge la classe, tient la liste et l'id sélectionné
│       ├── tabs/                          StudentsTab · SeancesTab · EvaluationsTab · AbsencesTab · ProgressionTab · BilansTab
│       ├── seance/SeanceDetail.tsx        appel + cahier de texte + pièces jointes
│       ├── evaluation/EvaluationDetail.tsx   grille de notes + fiche contrat
│       ├── progression/                   le **seul** endroit où une progression s'écrit :
│       │                                  EtapesEditor · FriseProgression · EtapeDialog ·
│       │                                  ActiviteDialog · DomainesDialog · EnteteDialog
│       └── dialogs/                       StudentFormDialog · StudentNeedsDialog ·
│                                         AbsencePeriodDialog · TeacherAbsenceDialog
├── components/
│   ├── AgendaEntryEditor.tsx              le compte rendu d'un rendez-vous, pièces comprises
│   ├── Attachments.tsx                    les pièces jointes des **deux** porteurs (`APPELS`)
│   ├── CompetencyPicker.tsx               sélection dans l'arbre du référentiel
│   ├── ConfirmDialog.tsx                  confirmation, partagée — d'où sa place ici
│   ├── ContractSheetEditor.tsx            trame + lignes d'activités + couche par élève
│   ├── DataState.tsx                      chargement / erreur / vide, dans cet ordre
│   ├── FriseEntetes.tsx                   colonnes et en-têtes — **partagés par les deux frises**
│   ├── LimiteErreur.tsx                   filet de rendu : un écran lisible plutôt qu'une fenêtre blanche
│   ├── NeedsChips.tsx   NeedTagsCard.tsx  besoins particuliers — à l'écran seulement
│   ├── OccurrenceDialog.tsx               faire naître la séance d'un créneau, annulée ou non
│   ├── PastilleCategorie.tsx              la catégorie d'un rendez-vous, en petit — le seul aplat
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
│   ├── api.ts                             façade typée des 124 commandes + ApiError
│   ├── contenu.ts                         « vide », et les trois façons de régler un compte rendu
│   ├── depot.ts                           `estDepotDeFichiers`, `interdireNavigationParDepot`
│   ├── journal.ts                         filets globaux d'erreur, sans jamais rien de personnel
│   ├── password.ts                        force du mot de passe, à l'écran seulement
│   ├── pdf.ts                             bilan trimestriel, fiche d'évaluation, fiche contrat, progression
│   ├── progression.ts                     semaines, tranches, bandes, traits — lu par les deux frises
│   ├── teintes.ts                         la teinte d'une classe, par **position** et non par hachage ;
│   │                                      celle d'une activité, par **rang**, angle d'or
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
│   │       ├── 019_progression.sql        la planification de l'année, et son modèle commenté
│   │       ├── 020_appel_et_categorie.sql  l'appel pendant une période, l'absence du professeur,
│   │       │                               la catégorie d'un rendez-vous
│   │       └── …                          20 paliers en tout, voir le tableau plus bas
│   └── commands/
│       ├── lock.rs           verrou, code PIN, récupération, réglages  (13 commandes)
│       ├── sessions.rs       classes                   (5)
│       ├── students.rs       élèves                    (6)
│       ├── referential.rs    arbre des compétences     (6)
│       ├── timetable.rs      créneaux et rendez-vous   (15)
│       ├── seances.rs        séances et présences      (11)
│       ├── attachments.rs    pièces jointes des deux porteurs  (10)
│       ├── evaluations.rs    évaluations et notes      (8)
│       ├── needs.rs          besoins particuliers      (7)
│       ├── progressions.rs   progression annuelle      (18)
│       ├── absences.rs       périodes d'absence        (5)
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
cd src-tauri ; cargo test --lib   # 222 tests
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

### Les 45 tables

```
app_settings                     ligne unique — remplace l'ancienne table users
trimester_bounds                 bornes contiguës d'une année scolaire
professional_fields              les cinq champs SEGPA, semés au palier 009
└── activity_domains             domaines d'activité RA16 — semés pour le seul champ Habitat
    ├── reference_activities     ce qu'on y fait, tel que le référentiel national le nomme
    └── careers                  les métiers de la roue RA16 — pas les CAP, qui sont des diplômes
school_holidays                  vacances et jours fériés, origine officielle ou manuelle
student_need_tags                vocabulaire des besoins particuliers — vide à la livraison
progression_domaines             domaines explorés dans l'année — vide à la livraison, et global
establishments                   établissements — vide à la livraison (palier 025)
└── establishment_disabled_competencies
                                 (establishment_id, competency_id) → les compétences que cet
                                 établissement n'emploie pas : un filtre de saisie, jamais
                                 un masque sur une note déjà posée

savoir_groups
└── savoirs                      savoirs techniques rattachables à une fiche contrat

cycles
└── domains
    └── fields
        └── competencies         archived_at plutôt qu'une suppression destructrice

sessions                         une classe pour une année (level_code + year_start) ;
│                                establishment_id facultatif, SET NULL (palier 025)
├── student_groups               groupes de la classe, librement nommés (palier 023) ;
│                                SET NULL pour les réglages qui le citent, RESTRICT pour les faits
├── students                     enrolled_on / left_on, needs_note, group_id (NULL = partout)
│   ├── report_comments          (student_id, trimester)
│   └── student_needs            (student_id, tag_id) → étiquettes posées sur l'élève
├── timetable_slots              créneaux récurrents ; session_id NULL = occupation sans classe,
│                                group_id NULL = le cours de toute la classe
├── agenda_entries               rendez-vous datés ; session_id et student_id facultatifs,
│   │                            content_waived_at comme une séance, category en texte libre
│   └── agenda_entry_attachments BLOB — jumelle de seance_attachments, pas une colonne « porteur »
├── absence_periods              absence justifiée, collective (student_id NULL), nominative
│   │                            ou de groupe (group_id, palier 023) ;
│   │                            attendance_expected = l'appel se fait quand même,
│   │                            teacher_absent = c'est le professeur qui manquait
│   └── stage_placements         un placement désarme la période pour l'élève concerné
├── progressions                 UNE par classe (session_id UNIQUE) : titre, intitule_groupe, devise
│   ├── progression_etapes       l'échelon entre l'année et l'activité : connaissances et
│   │   │                        priorités en texte libre ; competences = le texte d'avant 021
│   │   ├── progression_etape_competences  les compétences, cochées dans le référentiel
│   │   │                        (palier 021) — sans position : l'ordre est celui du référentiel
│   │   └── progression_activites  ce qu'on fait ; domaine_id facultatif vers progression_domaines
│   │       │                    nature (analyse|activite|tp) et objectif depuis le palier 026
│   │       └── progression_activite_competences  les compétences de CETTE ligne (palier 026) :
│   │                            elles s'ajoutent à celles de l'étape, elles ne les remplacent pas
│   └── progression_plages       une case de frise : (week_monday, voie 0|1) → activite_id
├── seances                      trimester, trimester_is_manual, cancelled, content_html,
│   │                            content_waived_at (« rien à écrire », daté), group_id recopié
│   │                            du créneau à la naissance et jamais relu — un fait, pas un réglage
│   ├── attendance_records       (seance_id, student_id) → non_fait | present | absent | retard | excuse
│   └── seance_attachments       BLOB dans la base : les sauvegardes les emportent
└── evaluations                  trimester, trimester_is_manual, group_id (NULL = toute la classe)
    ├── evaluation_competencies  compétences retenues, RESTRICT vers competencies
    ├── grades                   (evaluation_id, competency_id, student_id) → mark 1 à 20,
    │                             le libellé de maîtrise n'est que sa lecture ; pas de ligne = pas de note
    ├── grade_waivers            (evaluation_id, competency_id, student_id) : « ne sera pas évalué »,
    │                             miroir de grades sans la note — l'autre sens de la ligne absente
    └── contract_sheets          une trame par évaluation
        ├── contract_sheet_rows          lignes d'activités, id stable d'un enregistrement à l'autre,
        │                                competency_id facultatif vers competencies
        ├── contract_sheet_requirements  tableau on donne / on demande / on exige, une ligne = trois cases alignées
        ├── contract_sheet_savoirs       savoirs associés à la fiche
        └── contract_sheet_students      couche nominative : rôle, appréciation, dates

            trois couples (clé, libellé figé) depuis le palier 024 :
            activity_domain_id / _label, reference_activity_id / _label,
            career_id / _label — SET NULL vers le référentiel, le libellé reste
```

L'arbre dit la **composition**, pas la totalité des clés : `timetable_slots` et
`agenda_entries` pendent à `sessions` par un `session_id` **nullable** — une occupation sans
classe et une réunion de secteur n'appartiennent à personne —, et `agenda_entries.student_id`
pointe en plus vers `students`. `seances.slot_id` est en `ON DELETE SET NULL` : supprimer un
créneau ne doit jamais emporter un appel déjà fait.

`ON DELETE CASCADE` sur les liens de composition ; `ON DELETE RESTRICT` vers `competencies` :
supprimer une compétence déjà notée est refusé par SQLite, et la commande traduit le refus en
proposition d'archivage. Quatre tables la retiennent ainsi — `grades`,
`evaluation_competencies`, `progression_etape_competences` (palier 021) et `grade_waivers`
(palier 022) — et `delete_node` compte les **quatre** avant de supprimer : une table ajoutée
en `RESTRICT` sans l'être ici rendrait le message faux par omission, « 0 évaluation, 0 note »
suivi d'un refus que plus rien n'explique. La cinquième table qui cite `competencies`,
`establishment_disabled_competencies` (palier 025), est volontairement en **`CASCADE`** et
non en `RESTRICT` : elle ne porte pas un fait mais un réglage, et ranger au référentiel une
compétence que personne n'a notée ne doit pas se heurter à un refus.

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
| 19     | `019_progression.sql`          | `progression_domaines`, `progressions`, `progression_etapes`, `progression_activites`, `progression_plages` : la planification de l'année, une progression par classe (`session_id UNIQUE`), une plage désignée par le **lundi** de sa semaine |
| 20     | `020_appel_et_categorie.sql`   | `absence_periods.attendance_expected` (l'appel se fait quand même : sortie scolaire, séjour, CDI), `absence_periods.teacher_absent` (c'est le professeur qui manquait, pas la classe) et `agenda_entries.category` (texte libre, affichée en pastille). Aucune table nouvelle, trois `DEFAULT` qui reproduisent le comportement de la veille — l'ordre des deux `ALTER` n'est pas interchangeable, le CHECK du second cite le premier |
| 21     | `021_competences_de_progression.sql` | `progression_etape_competences` : les compétences d'une étape viennent du **référentiel** et non plus d'un champ texte. Miroir d'`evaluation_competencies` — CASCADE sur l'étape, RESTRICT sur la compétence, index inverse — à une colonne près : **pas de `position`**, l'ordre étant celui du référentiel. Rien n'est migré et `progression_etapes.competences` n'est ni vidée ni supprimée : aucun rattachement ne peut être deviné d'une suite de phrases écrites à la main |
| 22     | `022_case_non_evaluee.sql`     | `grade_waivers` : « cet élève ne sera pas évalué sur cette compétence », l'autre sens de la ligne absente de `grades`. Miroir de `grades` à la colonne de note près — mêmes cascades, même RESTRICT, mêmes index. La table naît **vide** : toute case aujourd'hui vierge reste « en attente », et aucune moyenne ne change. L'exclusion mutuelle avec `grades` n'est pas dans le schéma — SQLite ne sait pas poser un CHECK sur une autre table — mais dans les deux commandes, chacune dans son sens |
| 23     | `023_groupes.sql`              | `student_groups` et cinq colonnes `group_id` : l'élève, le créneau, la séance, l'évaluation, la période d'absence. Toutes nullables, et `NULL` veut dire « comme avant » partout — sauf sur l'élève, où il veut dire « convoqué à tout », parce qu'un élève non rangé est un oubli et non une décision. `SET NULL` sur les **réglages**, `RESTRICT` sur les **faits** (une séance tenue, une évaluation notée). L'assiduité gagne un quatrième terme, `seances_autre_groupe`, plutôt que de mentir dans l'un des trois existants. « Groupe 1 semaine A, groupe 2 semaine B » n'a rien coûté : deux créneaux de parité complémentaire, mécanisme du palier 004 |
| 24     | `024_referentiel_ra16.sql`     | `activity_domains`, `reference_activities`, `careers`, et six colonnes sur `contract_sheets` : l'en-tête de la fiche puise dans le référentiel RA16 au lieu de se taper à la main. Trois couples (clé, libellé figé) sur le modèle de `professional_field_id` / `_label` — `SET NULL` vers le référentiel, le libellé survit. Semé pour le **seul champ Habitat** : les quatre autres n'ont pas de référentiel, et l'écran y garde ses champs de saisie libre. Les trois colonnes de texte libre du palier 001 ne sont **ni vidées ni supprimées** — mêmes précautions qu'au palier 021, elles s'affichent en lecture seule sous le menu, s'impriment encore, et un bouton les efface |
| 25     | `025_etablissements.sql`       | `establishments`, `sessions.establishment_id` et `establishment_disabled_competencies` : une classe nomme l'établissement où elle se tient, et un établissement dit quelles compétences il n'emploie pas. Le lien vit sur la **classe** et non sur l'année — il n'existe aucune entité « année » dans ce schéma, et le plus général des deux se replie sur l'autre, pas l'inverse. Nullable, `SET NULL`, et `NULL` veut dire « comme avant » partout : aucune compétence retirée d'un menu, aucun document imprimé qui change. La désactivation est un **filtre de saisie** — les lectures qui portent des faits ne la consultent pas, et une compétence déjà notée reste visible et comptée |
| 26     | `026_progression_des_documents.sql` | `progression_etapes.objectifs` et `.metier_cap`, `progression_activites.nature` et `.objectif`, et `progression_activite_competences` : la progression prend la forme de ses propres documents. **Purement additif** — quatre `DEFAULT` qui reproduisent le comportement de la veille (`nature` naît à `'activite'`), une table qui naît vide, et l'étape garde ses compétences : l'activité **gagne** les siennes, elle ne les lui prend pas. `nature` est la seule liste close du palier, et son CHECK ne fait que redire ce que `verifier_nature` refuse en français — ces trois valeurs sont la forme du document, et c'est du code qui les lit pour composer le mot imprimé. Rien n'est migré : aucun rattachement d'activité ne peut être deviné des compétences de son étape |

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

Et, **depuis le palier 020, une `category`** : un mot, trente caractères au plus, en texte
libre. Le palier 004 avait écrit qu'il n'y aurait pas de colonne `kind` tant qu'un second
exemple réel n'existerait pas, et que l'intitulé porterait la catégorie en attendant. Le
second exemple est l'exercice PPMS : un événement qui concerne l'établissement entier, ne
nomme aucune classe, et dont ce qu'on veut lire d'un coup d'œil sur le calendrier n'est pas
l'intitulé mais la **nature**. Elle s'affiche en pastille — le seul aplat de couleur de
l'application, `PastilleDeCategorie`, partagé par les deux calendriers et l'en-tête du
compte rendu, pour que trois rédactions ne divergent pas. Texte libre et non liste close :
une taxonomie figerait un vocabulaire qui appartient à l'établissement, et chaque valeur
manquante renverrait l'enseignant à écrire la catégorie dans le titre, c'est-à-dire à l'état
d'avant. Le prix est connu et arbitré par l'auteur : « PPMS » et « ppms » font deux
catégories. La borne de trente caractères vit dans `clean_entry_category` et dans la saisie,
**pas** dans un CHECK : une limite d'affichage n'est pas une règle de données, et un CHECK
aurait refusé en anglais ce que la commande refuse en français.

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

### Périodes d'absence : trois cas, et deux colonnes pour les distinguer

Depuis le palier 005, une période retire ses séances du **dénominateur d'assiduité** de qui elle
vise. C'est juste pour un stage : l'élève n'est pas là, sa présence en cours n'a pas de sens, et
la compter en absence fabriquerait un taux faux sur le bilan remis à la famille.

Ça ne l'est pas pour une sortie scolaire, un séjour, une matinée au CDI : l'enseignant est
**avec** la classe, l'appel se fait, et manquer est une absence comme une autre. Il n'avait aucun
moyen de le dire, et les deux contournements qui restaient étaient tous deux mauvais — ne pas
saisir la période, et la sortie disparaissait de l'emploi du temps ; la saisir, et la journée
sortait silencieusement de l'assiduité de toute la classe. D'où `attendance_expected`, qui
neutralise la neutralisation : la période nomme toujours sa raison, s'affiche toujours sur
l'emploi du temps, mais ses séances restent au dénominateur.

La règle vit dans la **requête du bilan** (`reports::ATTENDANCE_SQL`) et nulle part dans le
stockage : rien n'est recopié, donc décocher la case rend les séances au calcul sans rien
reconstruire. Elle se lit **aux deux points symétriques** de cette requête, celui de
`neutralisees` et celui du `LEFT JOIN`, ou à aucun : ne l'ajouter qu'à l'un des deux casse
l'invariant imprimé `applicable + hors_inscription + neutralisees == seances_trimestre`
(quatre termes depuis le palier 023, qui y ajoute `autre_groupe` — voir
[Groupes d'élèves](#groupes-délèves-dans-une-classe)).

`teacher_absent` ne change **aucun calcul**, et c'est voulu : une période écarte déjà ses
séances, donc « l'enseignant n'était pas là » n'a rien de plus à retirer. Ce qu'il apporte, c'est
la **cause**, que `reason` — texte libre — ne permettait pas de distinguer d'une chaîne
quelconque. Deux conséquences, toutes deux à l'écran et aucune dans les chiffres :

- l'emploi du temps écrit « Professeur absent », dans la teinte de la classe, là où il écrivait le
  motif de la classe — une fermeture d'établissement et une classe en stage se lisaient pareil ;
- les **trois rappels de l'accueil se taisent** sur une séance couverte : il n'y a ni appel à
  terminer, ni cahier de texte à écrire, ni annulation à motiver pour un cours que personne n'a
  assuré. La séance quitte aussi les trois dénominateurs, par le raisonnement même qui en sort
  les séances annulées. Ce silence ne vaut **que** pour `teacher_absent` : une période de stage
  continue de réclamer, l'enseignant était là et ses autres classes ont eu cours.

Le couple contradictoire est **impossible**, pas découragé. Un professeur absent ne fait pas
l'appel ; ce n'est pas une politique qu'on pourrait rouvrir, c'est une tautologie. Trois verrous
le disent, chacun à son étage : `create_teacher_absence_periods` ne prend pas `attendance_expected`
en paramètre — **la commande EST le drapeau** —, `update_absence_period` refuse de rendre l'appel
à une absence du professeur (et de la rendre nominative : il n'est pas absent pour un seul élève),
et le CHECK du schéma le redit pour un appelant futur qui n'aurait lu ni l'un ni l'autre. SQLite
n'ajoutant pas de contrainte de table par `ALTER`, ce CHECK est porté par la colonne et cite sa
voisine : **l'ordre des deux `ALTER` du palier 020 n'est pas interchangeable.**

Une absence du professeur pose **une ligne par classe cochée**, dans une seule transaction — une
journée de formation vide l'emploi du temps entier, une réunion ne prend qu'une classe, et c'est
à lui de cocher. Il n'y a pas d'entité « absence groupée » : même raison que « Gr 2 » au palier
019, un objet qui n'existe que pour relier des lignes devient un objet dont il faut gérer le
cycle de vie. Une classe inconnue annule **tout** le geste, et une liste vide est refusée en
français.

Les trois cas ne se dessinent pas pareil sur les calendriers, et c'est `absenceDuCreneau`
(`pages/Timetable/journee.ts`) qui tranche : une classe hors cours **garde sa carte** et
l'estompe, avec le motif écrit dessus, exactement comme un créneau de quinzaine qui ne tombe pas
cette semaine — « une case disparue passerait pour un créneau perdu ». Un jour fermé pour tout le
monde, lui, retire ses cartes : l'en-tête de la colonne le dit une fois, vingt-quatre cartes
estompées le rediraient vingt-quatre fois. Et `attendance_expected` ne change rien au dessin : le
cours a lieu, estomper sa carte ferait disparaître à l'œil la séance dont on attend justement
l'appel. Les mots vivent à un seul endroit (`motsDeAbsence`, `motsDesAbsences`), en trois
longueurs — la carte, le bandeau, l'infobulle —, comme `motsDuCahier`.

Ce qu'une carte ne peut pas dire, une **légende** le dit sous la grille. L'en-tête d'une colonne
fait six caractères : à deux classes hors cours le même jour, il ne pouvait plus que compter —
« 2 classes hors cours », vrai et inutilisable. Le détail existait déjà, mais dans un `title=`, et
une infobulle ne se découvre pas. `LegendeDesAbsences` écrit donc une ligne par période : la classe
dans sa teinte et son filet — `teinte-carte` et `styleTeinte`, ceux de la carte qu'elle explique,
aucune couleur écrite à la main —, le motif, les jours couverts, et l'effet sur l'assiduité en une
phrase. Elle est **sous** la grille parce qu'une colonne n'a pas la place d'une phrase, et parce
que la même période revient dans chaque journée qu'elle couvre : `get_week_schedule` rend une
`SessionAway` par jour, donc `absencesGroupees` déduplique sur (classe, `teacher_absent`,
`attendance_expected`, motif) avant d'afficher — sans quoi un stage d'une semaine s'écrirait cinq
fois. Les mots viennent de `journee.ts` (`motsDeLegende`), avec ceux des cartes : deux rédactions
finiraient par ne pas dire la même chose de la même période.

### Deux cours sur la même case : la semaine A/B

`timetable_slots.week_parity` existe depuis le palier 004 (`toutes`, `paires`, `impaires`, sur le
**numéro de semaine ISO**), et la table n'a jamais porté de contrainte d'unicité sur
`(weekday, start_time)` : deux créneaux sur la même bande étaient permis par le schéma depuis le
premier jour. Ce qui manquait était la **porte** — une case occupée renvoyait tous ses clics vers
la modification du créneau existant, et rien ne proposait d'en ajouter un second au même endroit.

Il y en a maintenant **deux, et elles ne se remplacent pas**.

**Dans la grille : le clic ouvre la carte, le glissé ajoute à côté.** C'est le geste qu'on essaie
d'abord, et il ne marchait pas — une carte couvre sa bande, donc le `pointerdown` ne descendait
jamais jusqu'au fond cliquable. `commencerTraceSurCarte` (`WeekGrid`) retrouve cette bande **sous
le curseur** par `elementsFromPoint`, qui rend les éléments empilés dans l'ordre — la carte
d'abord, la bande ensuite —, et le tracé reprend là, à l'identique : même géométrie, même aperçu,
même sélection inclusive. D'où les attributs `data-bande`, `data-jour`, `data-colonne`,
`data-minutes` et `data-date` portés par les bandes du fond : ils sont leur seule description
lisible de l'extérieur, et les lire sur l'élément lui-même évite une table d'index parallèle qui
se désynchroniserait de ce qui est dessiné. Sans mouvement, `relacher` ne crée rien et le clic
ouvre la carte comme avant — rien n'est retiré à qui ne glisse pas. Et `consommerClic`, partagé
par la bande et la carte, avale le `click` que le navigateur émet encore après un glissé : sans
lui, le geste créerait la plage **et** ouvrirait par-dessus la carte dont il est parti. Les cartes
qui ne s'ouvrent pas d'un clic reçoivent la même amorce, sinon un horaire occupé resterait
impossible à doubler ; et la carte d'un cours ponctuel, devenue un lien depuis que sa fiche est
atteignable d'ici, porte en plus `draggable={false}` — le navigateur sait glisser une ancre tout
seul, et ce fantôme aurait mangé le tracé.

**Dans le dialogue de modification :** « Un autre cours à cet horaire » rouvre le sélecteur
de forme préréglé sur le même jour, le même horaire, et la **parité complémentaire** de celle du
créneau qu'on quitte. C'est le chemin de qui a cliqué, le seul chemin au clavier — les bandes du
fond restent atteignables par tabulation sous les cartes —, et le seul des deux à deviner la
périodicité : il est le seul geste qui dise « l'autre semaine », un tracé ne disant que l'horaire.
Trois détails qui ne sont pas des détails :

- **Le créneau existant n'est pas touché.** Le geste ne réécrit pas sa parité en `paires` pour
  faire place à son jumeau : une modification en douce resterait à moitié faite si l'enseignant
  annulait la création, et c'est exactement celle qu'on ne retrouve jamais. La parité reste la
  sienne, et un panneau d'information dit ce qui va se passer — « ils tomberont la même semaine »,
  ou « les périodicités se complètent ».
- Ce panneau liste les voisins dès que l'horaire saisi en **chevauche** un, pas seulement quand il
  l'égale : un 8h–9h et un 8h30–10h occupent bel et bien la même bande de grille.
- L'hôte remet `slotEnEditionId` à `null` avant d'ouvrir la création. Sans ce geste, l'écriture
  qui suit passerait par `enregistrerCreneau`, qui consulte cet identifiant, et **écraserait** le
  créneau qu'on vient de quitter.

L'**horaire d'un cours ponctuel** (`seances.slot_id IS NULL`) s'édite enfin dans sa propre fiche,
et lui seul : une séance née d'un créneau tient son heure du modèle hebdomadaire, qui se corrige
dans l'emploi du temps et pour toutes les semaines à la fois. La corriger occurrence par
occurrence ferait deux vérités pour la même heure — c'est « l'emploi du temps définit » appliqué à
une colonne. Un cours ponctuel, lui, n'a aucun modèle derrière lui : sans ce champ, un horaire
saisi de travers restait faux pour toujours. Sur une séance de créneau, l'horaire **transite
inchangé** par `update_seance_meta` ; l'omettre l'enverrait vide, et un simple renommage effacerait
l'heure du cours.

Restait à y **arriver**. La carte d'un cours ponctuel était inerte dans la grille : elle
s'affichait, et aucun clic n'atteignait ni l'horaire qu'on venait de rendre modifiable, ni l'appel,
ni le cahier de texte. Elle est maintenant un `<Link>` vers
`/classes/:id?onglet=seances&ouvrir=:seanceId`, c'est-à-dire vers le **seul** écran de séance qui
existe : **mener n'est pas héberger**, et un second écran de séance posé dans l'emploi du temps
aurait rouvert le défaut que la suppression de l'onglet « Journée » avait fermé. Un `<button>` qui
navigue serait un mensonge — clic du milieu, « ouvrir dans un nouvel onglet » et copie de l'adresse
n'auraient rien à prendre. Et l'adresse vit **à un seul endroit**, `adresseDeLaSeance` dans
`journee.ts`, partagée avec les deux appels de l'accueil : trois gabarits d'URL auraient divergé au
premier paramètre ajouté.

### Groupes d'élèves dans une classe

Palier 023, demandé le 2026-11-12 : « pouvoir ajouter un système de groupe 1 et groupe 2 dans
les classes, pour pouvoir faire les évaluations sur les deux groupes facilement. Prendre en
compte les stages et absences et l'emploi du temps pour les groupes, pouvoir définir groupe 1
pour semaine A et groupe 2 semaine B par exemple. »

Deux points de forme ont été tranchés le même jour, et ce sont eux qui donnent sa tête au
palier. **Autant de groupes que voulu, librement nommés** : un atelier cuisine, un atelier
bois, un groupe de besoin — le vocabulaire appartient à l'enseignant, comme les domaines de
progression et les champs professionnels. D'où une table `student_groups` et non une colonne
`groupe INTEGER CHECK (groupe IN (1, 2))`. Et **un élève n'appartient qu'à un seul groupe** :
d'où une colonne sur `students`, non une table de rattachement, qui aurait permis d'écrire ce
que le modèle interdit et obligé chaque lecture à redécider quoi faire d'un élève présent deux
fois.

**« Groupe 1 semaine A, groupe 2 semaine B » n'a rien demandé de neuf**, et c'est ce qui rend
ce palier bon marché. Le schéma le permettait déjà, personne ne l'avait vu : deux groupes au
même horaire sont **deux créneaux de parité complémentaire** (voir la section précédente), un
`group_id` chacun. La porte qui les crée existait depuis la révision de `SlotDialog` — « Un
autre cours à cet horaire », qui préréglait justement la parité complémentaire. Le groupe est
un attribut du créneau, pas une seconde dimension de la grille. Conséquence qui compte en
production : `ux_seances_slot_date UNIQUE(slot_id, date)`, que le palier 004 décrit comme « le
point le plus irréversible du palier », **reste valide** — deux groupes ne demandent jamais
deux séances du même créneau le même jour, ils demandent deux créneaux, et il n'y a rien eu à
reconstruire.

**Les cinq colonnes ajoutées naissent toutes à `NULL`, et `NULL` veut dire « comme avant ».**
Une séance sans groupe convoque toute la classe, une évaluation sans groupe note toute la
classe, un créneau sans groupe est le cours de toute la classe, une période sans groupe vise
qui elle visait déjà. Une base migrée se comporte exactement comme la veille, au chiffre près
— y compris les bilans d'assiduité déjà imprimés, dont le test de migration vérifie qu'ils ne
bougent pas d'une unité.

#### Les deux sens de « sans groupe », qui vont dans des directions opposées

C'est délibéré, et toute la justesse du calcul d'assiduité y tient :

- `students.group_id IS NULL` → l'élève est convoqué à **toutes** les séances, y compris
  celles d'un groupe nommé. Parce qu'un élève non rangé est le plus souvent un **oubli**, pas
  une décision : l'enseignant crée ses deux groupes en novembre, inscrit un nouvel élève en
  janvier et ne pense pas à le ranger. Le faire disparaître des séances de groupe le
  retirerait en silence des appels et des bilans — exactement le défaut que corrigeait le
  palier 006. Le faire apparaître partout est visible, corrigible, et ne coûte qu'un
  « non fait » que l'écran signale déjà. Le dialogue des groupes l'écrit en toutes
  lettres, dès qu'un groupe existe, pour que la règle ne se devine pas.
- Mais un élève sans groupe n'est **pas** couvert par une période qui vise un groupe nommé.
  Parce qu'une période **retire** des séances du dénominateur : un oubli de rangement ne doit
  jamais excuser une absence par accident.

Les deux erreurs possibles sont asymétriques, donc les deux règles le sont aussi. Chacune
penche du côté où l'erreur se voit.

#### L'assiduité : un quatrième seau, et surtout pas un seau existant

Une séance tenue avec l'autre groupe doit sortir du dénominateur de l'élève. La ranger dans
`hors_inscription` ferait imprimer « hors de sa période d'inscription » sur le bilan d'un
enfant inscrit depuis septembre ; la ranger dans `seances_neutralisees` ferait imprimer
« pendant une absence justifiée » d'un enfant qui n'était pas absent. **Ces deux phrases
s'impriment telles quelles sur un document remis à une famille**, et une phrase fausse sur un
tel document est le défaut que ce projet refuse le plus.

D'où `seances_autre_groupe`, quatrième terme, avec sa propre phrase — « tenue avec un autre
groupe, non comptabilisée » — à l'écran comme au PDF. L'invariant imprimé devient :

```
applicable + hors_inscription + neutralisees + autre_groupe == seances_trimestre
```

et la partition reste exacte parce que les quatre termes se lisent dans un ordre de priorité
fixé : non inscrit → `hors_inscription` (qui est **le reste**, pas un calcul) ; inscrit mais
autre groupe → `autre_groupe` ; inscrit, son groupe, écartée → `neutralisees` ; sinon →
`applicable`. **Le groupe passe donc avant la neutralisation** : une séance de l'autre groupe
tenue pendant le stage de l'élève est comptée une seule fois, et du bon côté — elle ne lui a
pas été retirée par son stage, elle ne lui était pas destinée.

⚠ Le filtre de groupe se lit aux **trois** points de `ATTENDANCE_SQL` — le `LEFT JOIN`, la
sous-requête `neutralisees`, la sous-requête `autre_groupe` — ou à aucun. C'est l'avertissement
du palier 020 avec une branche de plus : n'en servir que deux casse l'invariant en silence, et
le défaut est **invisible sur toute base où personne n'a créé de groupe**, c'est-à-dire sur
toute base migrée. Deux tests de `commands/reports.rs` le tiennent, et le test de migration
`une_base_v22_peuplee_traverse_le_palier_023_intacte` vérifie que la somme des quatre termes
retombe sur le compte de séances du trimestre.

#### Deux sorts de suppression, parce que deux rôles

⚠ Irréversible : une action `ON DELETE` ne se change pas par `ALTER TABLE`.

- **`SET NULL`** sur `students.group_id`, `timetable_slots.group_id` et
  `absence_periods.group_id` — ce sont des **réglages**. Perdre le groupe rend l'élève, le
  créneau ou la période à toute la classe : l'état d'avant le palier, lisible et corrigible.
- **`RESTRICT`** sur `seances.group_id` et `evaluations.group_id` — ce sont des **faits**.
  Cette séance-là a eu lieu avec ce groupe-là et son bilan d'assiduité en dépend ; cette
  évaluation-là a noté ces élèves-là. Les rendre rétroactivement « toute la classe »
  changerait des chiffres déjà imprimés sans qu'une ligne ne le dise. `delete_student_group`
  compte donc **avant** de supprimer et refuse en français, et la liste des groupes rend ce
  compte à l'écran : présenter un bouton qui échoue vaut moins que l'annoncer.

Le geste qui reste quand un groupe est devenu intouchable est le **renommage**, libre et qui
ne ment sur rien : c'est le même ensemble d'élèves, il change de nom. Réorganiser les groupes
en janvier se fait en créant les nouveaux, pas en effaçant les anciens — les séances de
novembre ont bien eu lieu avec ceux de novembre.

Même partage entre le fait et le réglage à la lecture : `create_seance_from_slot` **recopie**
le groupe du créneau au moment où l'occurrence naît et ne le relit jamais, exactement comme
`start_time` / `end_time` depuis le palier 004. Changer le créneau ne réécrit donc aucune
séance passée, et les calendriers choisissent en un seul endroit (`groupeDuCours`) : le groupe
de la séance quand elle existe, celui du créneau sinon.

#### Une évaluation sur un seul groupe

C'est la demande littérale. La grille n'affiche alors que les élèves du groupe, et le compte de
complétude de l'accueil prend le **même** dénominateur — sans quoi une évaluation de groupe
serait réclamée pour toujours, l'accueil attendant des notes d'élèves qui n'étaient pas là.
Restreindre après coup une évaluation à un groupe est **refusé en français** si des élèves hors
de ce groupe y ont déjà une note ou une mention « non évalué » : refuser plutôt que supprimer —
les notes appartiennent à l'élève, et un bouton « supprimer ces notes » dans un formulaire de
titre et de date serait une perte de données à un clic d'un renommage — et refuser plutôt que
cacher, une note qui existe encore mais que plus aucun écran n'affiche étant la panne qu'on ne
voit pas. Élargir à toute la classe ne cache jamais rien, donc ne déclenche rien.

#### Une troisième portée pour les périodes d'absence

En SEGPA, les groupes partent en stage en alternance : c'est le cas qui a motivé la colonne. La
portée d'une période se lit maintenant ainsi — `student_id` non nul vise cet élève, `group_id`
non nul vise les élèves de ce groupe, les deux nuls visent toute la classe. Deux périodes de
groupes **différents** se chevauchent sans conflit (les déclarer en conflit aurait interdit la
saisie du cas même que le palier sert) ; deux périodes du **même** groupe se gênent comme deux
périodes de la même classe. Le CHECK du schéma redit deux impossibilités que la commande refuse
déjà en français : un groupe **et** un élève nommé, un groupe **et** une absence du professeur —
il n'est pas absent pour un groupe, et quand il manque, il manque à tous ceux qu'il devait
avoir. Pour la même raison qu'au palier 020, **l'ordre des `ALTER` de ce fichier n'est pas
interchangeable** : le CHECK est porté par la colonne et cite ses deux voisines.

Sur les calendriers, enfin, le prédicat n'est **pas** celui du bilan, et les aligner casserait
l'un des deux. Un cours de classe entière pendant le stage du groupe 1 **a lieu** : l'autre
moitié est là, et estomper sa carte ferait disparaître à l'œil la séance dont on attend
justement l'appel. Le bilan, lui, neutralise bien cette séance pour les élèves du groupe 1,
parce qu'`ATTENDANCE_SQL` teste le groupe de **l'élève** et non celui de la séance. La carte
parle du cours, le bilan parle de l'élève : deux vérités du même fait, selon d'où on le
regarde.

### Progression annuelle

Palier 019. C'est la mise au propre d'un classeur papier : l'année d'une classe, les domaines
qu'on y explore, et la semaine où chacun tombe. **Un plan, et rien qu'un plan** — rien ici ne
touche une séance, un appel ni un bilan.

**Une progression par classe**, garantie par un `UNIQUE` sur `progressions.session_id`. « Gr 2 »
est donc un **libellé imprimé** (`intitule_groupe`) et non une entité : il n'existe pas d'objet
« groupe » dans le modèle, et rien ne s'y rattache.

Trois niveaux, et c'est le milieu qui compte :

- l'**étape** (`progression_etapes`) est l'échelon entre l'année et l'activité, et c'est elle
  qui porte les **compétences**, les **connaissances** et les **priorités**. Les compétences
  se **cochent dans le référentiel** depuis le palier 021
  (`progression_etape_competences`), avec le même sélecteur que les évaluations, pour que la
  même compétence s'écrive du même mot dans le plan de l'année et dans le bulletin. Les
  connaissances et les priorités restent en texte libre. Elle porte aussi, depuis le palier
  026, les **objectifs** de la séquence et le **métier et le CAP** qu'elle fait découvrir ;
- l'**activité** (`progression_activites`) est ce qu'on fait, rattachée à une étape et
  éventuellement à un **domaine**. Elle porte depuis le palier 026 sa **nature** (analyse de la
  situation, activité, TP), son **objectif** et **ses propres compétences** — celles que cette
  ligne met à l'épreuve, qui s'ajoutent à celles de l'étape sans les remplacer ;
- la **plage** (`progression_plages`) est une case de frise : un **lundi**, une bande (`voie`,
  0 ou 1), une activité. La semaine se désigne par sa date et **jamais par un numéro ISO** — un
  numéro n'a pas d'année, et la semaine 1 de 2027 suit la 53 de 2026.

Le palier 019 avait tranché l'inverse — « en texte libre, parce qu'il écrit des phrases » —
et c'était une décision de l'auteur ; il l'a rouverte le 2026-11-09. Ce n'est pas un
revirement en l'air : les 53 compétences semées par le palier 009 viennent de **son** tableau,
donc les phrases qu'il retapait à la main étaient déjà dans la base, à deux écrans de là.
Deux conséquences, tenues par la forme des données et non par la vigilance. La table de
rattachement **n'a pas de colonne `position`** : l'ordre d'une étape est celui du référentiel,
celui que Réglages règle, donc une compétence déplacée là-bas se déplace dans toutes les
progressions d'un coup — sa voisine `evaluation_competencies` a cette colonne, l'écrit à
chaque enregistrement, et son lecteur ne la lit jamais. Et `progression_etapes.competences`
**n'est ni vidée ni supprimée** : des enseignants ont des bases réelles, l'écran montre ce
texte en lecture seule sous « Compétences saisies à la main » tant qu'il reste, le PDF
l'imprime encore, un seul bouton l'efface, et tout appelant d'`update_progression_etape` le
fait **transiter inchangé** — l'omettre effacerait au premier renommage d'étape des phrases
écrites avant que le sélecteur n'existe. Un palier ultérieur pourra retirer la colonne le jour
où elle sera vide partout ; jamais par un `UPDATE` qui déciderait à la place de l'enseignant.

Le **rang** d'une activité dans l'année est calculé par le backend en parcourant
`(etape.position, activite.position)`. C'est lui, et rien d'autre, qui donne sa **couleur** :
`teinteDeActivite(rang)` marche la roue des teintes par l'angle d'or (137,508°) en partant de
45°, à l'écart des dix teintes de classe. Calculé une fois côté Rust pour que l'écran et le PDF
ne puissent pas colorier différemment la même activité. Il est **0-fondé** — un numéro imprimé
vaut `rang + 1`.

Les colonnes sont les **vraies semaines**, rendues par `get_year_calendar`, et une semaine
appartient au mois **et** au trimestre qui contiennent son **jeudi** : une partition, donc ni
colonne dédoublée ni semaine orpheline. L'année 2026-2027 en compte quarante-cinq, dont
plusieurs ne sont pas entières — le classeur d'origine supposait quatre semaines par mois, et
`school_days` est le nombre qu'il n'avait pas. Les vacances et les jours fériés sont **lus** du
calendrier officiel, pas peints à la main ; les stages d'une classe entière s'y lisent aussi. Et
une semaine fermée **reste peignable** : le calendrier bouge, et l'application ne dicte pas où
planifier.

**Le bouton de la souris décide du geste** sur la frise de la fiche de classe : clic gauche
pose l'activité choisie, clic droit l'efface, et un glissement couvre une bande entière en
**une seule** commande — huit appels auraient laissé la frise à moitié peinte en cas d'échec
au cinquième. Au clavier, `Entrée` pose et `Suppr` efface : le pinceau « gomme » qui occupait
une entrée du sélecteur a disparu, mais pas sans remplaçant, et les cases restent
atteignables par tabulation. Les deux gestes ont **la même portée** — une case est une
semaine, un glissement est une bande : le clic droit n'efface pas le trait entier sous le
curseur, qui peut faire vingt semaines, et la frise n'a pas d'annulation. `blur`, `Échap` et
`pointercancel` **abandonnent** un tracé sans rien écrire, et le menu contextuel de WebView2
n'est supprimé que pour le geste en cours.

Les **domaines** (`progression_domaines`) sont le vocabulaire de l'enseignant, **livré vide**
comme `professional_fields`. Ils sont **globaux** : un domaine exploré en 4ᵉ et en 3ᵉ est le
même domaine. Supprimer un domaine employé est refusé, et `activity_count` est rendu à la
lecture pour que l'écran le sache **avant** de proposer le bouton.

**Deux écrans, un seul qui écrit.** La fiche de classe, onglet « Progression », est le seul
endroit où une progression se modifie. L'onglet « Année » de l'emploi du temps montre la même
frise pour **toutes les classes de l'année**, une ligne chacune, et n'y touche pas — le nom de
la classe y est un lien vers l'endroit où elle s'écrit. Même règle que pour les séances : deux
écrans qui modifient la même chose finissent par ne pas en dire la même chose. Ce que la vue
annuelle apporte et que la fiche de classe ne peut pas donner, c'est la **comparaison** : la
semaine où trois classes font la même chose, celle où rien n'est prévu, les trous du calendrier.

L'**export PDF** est en **paysage** : quarante-cinq semaines sur une feuille portrait donnent
des colonnes de quatre millimètres, où le numéro de semaine ne tient plus. Le document dit deux
fois la même année — la frise, puis le tableau des étapes — et c'est le **numéro** de l'activité
qui relie les deux ; la couleur ne fait que l'appuyer, parce qu'une progression finit punaisée
au mur après un passage par un photocopieur en noir et blanc. **Le tableau du bas a changé de forme au palier 026** : un **bandeau** ouvre
l'étape et porte ses six textes — intitulé, objectifs, métier et CAP, compétences,
connaissances, priorités —, puis chacune de ses lignes tient une rangée à elle, avec sa nature,
son objectif, ses propres compétences, son domaine et ses semaines. Le dessin d'avant fusionnait
les colonnes de l'étape sur toute la hauteur de son groupe, et six textes dans une cellule
fusionnée sur 267 mm ne laissaient plus rien aux activités qu'elle annonce ; les documents de
l'auteur font exactement cela — un bandeau qui ouvre la séquence, puis ses lignes en dessous.
Une étape **sans** activité garde son bandeau : ses compétences valent d'être lues même si rien
n'est encore posé en face.

#### Ce que le palier 026 ajoute : la forme des documents

Les deux progressions de l'auteur (une 4ᵉ, une 3ᵉ) ouvrent chaque séquence par deux lignes
qu'aucune colonne du palier 019 ne pouvait accueillir — ce que la séquence **vise**, et le
**métier et le CAP** qu'elle fait découvrir — et chacune de leurs lignes porte une **nature**
(analyse de la situation, activité, TP), un **objectif**, et **ses propres compétences** dans la
troisième colonne. Le palier 026 ajoute exactement cela, et rien d'autre :

- sur l'étape, `objectifs` et `metier_cap`. Les loger dans `connaissances` ou dans `priorites`
  les aurait imprimés sous un intitulé faux : un but n'est pas un savoir, et un métier à
  découvrir n'est pas une priorité de passage ;
- sur l'activité, `nature` et `objectif` ;
- une table `progression_activite_competences`, miroir de celle de l'étape.

**L'activité gagne ses compétences, elle ne les prend pas à l'étape.** La décision du
2026-11-07 tient entière : l'étape garde les siennes, les deux niveaux coexistent, et le
document imprime les deux — l'étape dit ce que la séquence travaille, la ligne ce qu'elle met
à l'épreuve. **Rien n'est migré**, pour la raison du palier 021 : deviner laquelle des
compétences d'une étape appartient à laquelle de ses activités aurait décidé à la place de
l'enseignant sur toutes ses progressions passées. Une progression saisie avant ce palier se
relit donc exactement comme la veille — `nature` naît à « activité », la nature de loin la
plus fréquente dans les deux documents, et les trois textes neufs naissent vides.

La `nature` est la **seule liste close** du palier, et c'est assumé. À la différence de la
catégorie d'un rendez-vous, qui est le vocabulaire d'un établissement et reste libre, ces trois
valeurs sont la **forme** des documents — identique de la première à la dernière séquence dans
les deux fichiers — et c'est **du code** qui les lit pour composer le mot imprimé devant
l'intitulé. Le refus est **en français** (`verifier_nature`), le CHECK du schéma ne fait que le
redire pour un appelant futur, et le mot vit à un seul endroit (`MOTS_DE_NATURE`), partagé par
l'écran et le PDF — deux rédactions auraient fini par imprimer « TP » d'un côté et « Travaux
pratiques » de l'autre.

`metier_cap` reste **du texte libre et non une clé vers le référentiel** : la deuxième séquence
de la 3ᵉ nomme « dessinateur industriel », qui n'est pas de la roue Habitat ; la ligne du
document nomme un métier **et** un CAP dans une seule phrase ; et le lien au référentiel vit
déjà dans la fiche contrat, où il situe le projet d'un élève. Découvrir un métier en séquence
n'est pas le projet d'un élève.

Sorts de suppression habituels : `CASCADE` vers le bas (les rattachements partent avec
l'activité), `RESTRICT` vers le haut. Supprimer du référentiel une compétence citée par une
activité est donc refusé en français, et `delete_node` compte maintenant **cinq** usages.

### Le référentiel RA16 et l'en-tête de la fiche contrat

Jusqu'au palier 024, les trois cases d'en-tête de la fiche contrat — sous-ensemble du champ,
activités de référence, métiers visés — étaient du texte libre. L'enseignant retapait à la
main, projet après projet, des formulations qui existent mot pour mot dans un document
national. Le palier les branche sur le **référentiel RA16 du champ Habitat** :

```
professional_fields
└── activity_domains             « Construction », « Aménagement, agencement, finition »,
    │                            « Équipements techniques »
    ├── reference_activities     34 activités, le libellé exact du référentiel
    └── careers                  21 métiers
```

**Une seule valeur par case, dans un menu** — décision de l'enseignant du 2026-11-12, contre
la liste à cocher qui lui était proposée. Et les métiers sont ceux de la **roue** du
référentiel (« relations entre activités et métiers »), pas les 22 CAP de la page suivante :
un CAP est un diplôme, plusieurs métiers de la roue en partagent un, et c'est le métier qu'un
élève de quatrième reconnaît. Vingt-et-un et non vingt-deux pour cette raison même : « Plâtrier »
et « Plaquiste » sont deux entrées de la roue sous un seul CAP « Plâtrier - Plaquiste ».

**Seul Habitat est semé.** Les quatre autres champs du palier 009 n'ont pas de référentiel, et
ce n'est pas un trou à combler plus tard par défaut : c'est le choix de l'enseignant, qui
n'enseigne que celui-là. Conséquence directe sur l'écran, et c'est elle qui a dicté la forme
du composant : **le menu ne paraît que si le champ a un référentiel**, sinon le champ de
saisie libre d'avant reste là, inchangé. Remplacer partout la saisie par un menu vide rendrait
la fiche inremplissable sur les quatre autres champs — et une régression d'écran vaut une
perte de données. C'est la même règle que `SelecteurDeGroupe`, qui rend `null` quand la classe
n'a aucun groupe.

**Trois couples (clé, libellé figé)**, sur le modèle exact de `professional_field_id` /
`professional_field_label` du palier 001 : `ON DELETE SET NULL` vers le référentiel, et le
libellé reste. Une fiche déjà remise à un élève ne se vide pas parce qu'un référentiel a été
rangé.

**Les trois colonnes de texte libre ne sont ni vidées ni supprimées**, mêmes précautions qu'au
palier 021 pour les compétences de progression : ce qui a été tapé s'affiche en lecture seule
sous le menu, s'imprime encore sur le PDF, et **un seul bouton l'efface** — celui de
l'enseignant. Rien n'a été migré : deviner le domaine d'activité d'une fiche à partir de la
phrase qu'elle porte aurait décidé à sa place sur tous ses projets passés.

**Le couple contradictoire est refusé, jamais rectifié en silence** — règle posée pour
`agenda_entries` au palier 016, et qui pèse plus lourd ici : le domaine et l'activité
s'impriment côte à côte sur une fiche remise à un élève, donc « Construction / appliquer des
revêtements muraux » est un document faux. `save_contract_sheet` refuse en français. Mais il
ne refuse **que** la contradiction : une entrée disparue du référentiel, ou un parent qui a
lui-même perdu son lien, laisse passer l'enregistrement en lâchant la clé et en gardant le
libellé. Perdre un lien est acceptable, perdre la saisie de l'enseignant ne l'est pas.

Le nom imprimé change avec le champ : la première colonne de l'identité du projet s'intitule
désormais **« Domaine d'activité »** et non plus « Domaine du socle ». L'intitulé du classeur
d'origine était fautif — ce qu'il désignait n'a jamais été un domaine du socle commun, lesquels
ont leur propre colonne dans la grille du dessous —, et c'est l'enseignant qui a demandé le
renommage.

### Établissements et compétences écartées

Dernier point de la liste du 2026-11-12 : « lier une année scolaire à un établissement, et
ajouter des réglages par établissement comme la désactivation de certaines compétences ».

**Le lien vit sur la classe, pas sur l'année**, et ce n'est pas une approximation. Il n'existe
aucune entité « année scolaire » dans ce schéma : l'année est deux colonnes de `sessions`
(`level_code` + `year_start`), et en créer une table pour y accrocher un réglage aurait inventé
un objet que rien d'autre n'habite. Surtout, **le plus général des deux se replie sur l'autre
et l'inverse est faux** : rattacher les quatre classes d'une année au même établissement est
quatre gestes et c'est tout, alors que deux classes de la même année dans deux établissements
— le cas d'un enseignant partagé entre deux collèges, qui est fréquent — serait inexprimable
si le lien vivait sur l'année.

```
establishments
├── sessions.establishment_id      ON DELETE SET NULL — un réglage perdu, pas un fait
└── establishment_disabled_competencies
                                   (establishment_id, competency_id), CASCADE des deux côtés
```

`sessions.establishment_id` est **nullable**, et `NULL` veut dire « comme avant » : aucune
compétence retirée d'un menu, et l'en-tête des PDF reste le nom saisi dans Réglages. C'est
l'état de toute base migrée, et c'est le cas normal d'un enseignant qui n'a qu'un collège.

**Ne pas confondre les deux « établissements » de Réglages.** La carte « Identité » porte
`app_settings.school_name`, le nom **imprimé** en tête des bilans et des fiches contrat ; la
carte « Établissements », juste en dessous, porte la liste des entités auxquelles on rattache
des classes, et **rien de ce qu'elle règle ne s'imprime**. Si le nom de l'établissement de la
classe doit un jour remplacer celui de Réglages en tête des documents, c'est à l'enseignant de
le dire et ce sera un autre palier — voir « Décisions en attente ».

#### Un filtre de saisie, jamais un masque sur des notes

`establishment_disabled_competencies` dit quelles compétences du référentiel ne sont **pas
proposées** dans les menus des classes de cet établissement. Rien de plus, et la nuance est
tout le palier :

- les lectures qui portent des **faits** — `get_evaluation_competencies`,
  `COMPETENCES_DES_ETAPES`, `reports::AVERAGES_*` — ne consultent **pas** cette table et ne
  doivent jamais la consulter ;
- une compétence déjà cochée dans une évaluation ou dans une étape de progression **reste
  visible, cochée et notée** même si l'établissement vient de l'écarter.

C'est la règle arrêtée au palier 015 pour une compétence retirée d'une évaluation (`'ignore'` :
elle sort des moyennes, elle **reste** dans `grades`) appliquée un étage plus haut. L'autre
dessin — cacher la compétence partout — aurait laissé des notes bien réelles que plus aucun
écran n'affiche, c'est-à-dire la panne qu'on ne voit pas.

Côté écran, le filtre vit **à un seul endroit** : le `sessionId` facultatif de
`CompetencyPicker`, posé juste à côté de la règle `archived` qu'il imite trait pour trait, si
bien que « sauf si elle est déjà cochée » n'est écrit qu'une fois pour les trois appelants
(grille d'évaluation, création d'évaluation, étape de progression). Et le sélecteur **dit
combien** il en a retiré, par qui, et où le réglage se trouve : une compétence attendue et
absente se lit comme un défaut de l'application, et l'enseignant irait la recréer dans le
référentiel.

#### Deux écritures, parce que deux colonnes

`create_session` prend l'établissement ; **`update_session` n'y touche jamais** ; le seul
écrivain d'après-coup est `set_session_establishment`. Troisième règle d'architecture, et la
raison est celle de l'horaire d'`update_seance_meta` : une colonne ajoutée à une commande
d'écriture générale oblige **tout** appelant à la faire transiter, et le premier qui l'omet
l'efface au premier renommage. L'écran d'édition d'une classe fait donc deux appels, et
seulement si la valeur a bougé.

#### La suppression ne refuse pas

`delete_establishment` **ne refuse jamais**, à la différence de `delete_student_group` ou de
`delete_node` : ses classes reviennent à « aucun établissement » — l'état exact d'avant le
palier — et ses compétences écartées partent avec lui. La distinction est la même qu'au palier
023 : un **réglage** perdu se repose en trois clics, un **fait** perdu ne revient pas. Et le
`CASCADE` vers `competencies` va dans le même sens : ranger une compétence au référentiel
emporte le réglage qui la citait, là où une note la retient par un `RESTRICT`.

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

`cargo test --lib`, depuis `src-tauri/` — **222 tests** :

| Fichier                       | Tests | Ce qui est vérifié                                                                                                            |
| ----------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| `keys.rs`                     | 24    | aller-retour des deux enveloppes, mauvais mot de passe, phrase étrangère, normalisation de la saisie, changement de mot de passe, régénération qui invalide l'ancienne phrase, récupération puis nouveau mot de passe, enveloppes interverties rejetées par l'AAD, écriture atomique, absence de toute identité dans le fichier, paramètres KDF hors bornes, secrets qui refusent de s'afficher ; enveloppe PIN : un PIN seul n'ouvre rien sans le secret du poste, changer de mot de passe ne retire pas le PIN, nombre d'enveloppes borné, un fichier écrit avant le PIN reste lisible |
| `device.rs`                   | 6     | le secret du poste : aller-retour sous DPAPI, fichier illisible en clair, fichier altéré refusé, compteur d'essais qui survit à la relecture, absence de fichier qui n'est pas une erreur, secret qui refuse de s'afficher |
| `commands/maintenance.rs`     | 12    | noms d'export : traversée de chemin, caractères interdits, noms réservés Windows, longueur, désambiguïsation des doublons ; rotation et listage des sauvegardes |
| `db/mod.rs`                   | 9     | la base se rouvre avec la même clé, une mauvaise clé est refusée par la lecture de contrôle, le fichier sur le disque ne laisse rien lire, `VACUUM INTO` reste chiffré, base sans `sgpa.keys` mise de côté ; trimestre aux dates charnières, hors bornes, année bissextile, bornes par défaut |
| `commands/students.rs`        | 6     | découpage nom / prénom des lignes collées, noms composés, lignes vides, validation des dates                                   |
| `commands/trimesters.rs`      | 6     | validation des bornes : ordre, égalité fin / début de T3, dates impossibles, année hors bornes, libellé court de date          |
| `db/migrations.rs`            | 22    | version atteinte, idempotence, base trop récente refusée, semis du socle, aucune référence orpheline ; et des bases peuplées qui traversent les derniers paliers **intactes** — celle du palier 016 vérifie en plus que la classe d'un rendez-vous est bien déduite de son élève et qu'une reprise n'en invente aucune, celle du palier 017 qu'aucun « rien à écrire » n'est inventé et qu'**aucun octet ne survit à sa classe** — deux cascades enchaînées, posées par `ALTER TABLE`, réellement actives ; celle du palier 018 qu'aucun libellé ne change de sens à la conversion, que les index et le `RESTRICT` sont bien reposés sur la table reconstruite, et que le nouveau CHECK refuse 0, 21 et −1 ; celle du palier 019 qu'une base d'avant la progression le traverse sans perdre une ligne, et que les cinq tables nouvelles n'y naissent vides ; celle du palier 020 qu'un bilan d'assiduité recompté **avec la requête réelle du bilan** rende les mêmes chiffres après migration qu'avant, puis qu'il change bien quand la case est cochée ; celle du palier 021 que les textes d'une étape restent intacts, qu'**aucun rattachement n'est deviné** (la table nouvelle naît vide), qu'un doublon est refusé, que supprimer du référentiel une compétence citée par une étape est refusé par le `RESTRICT`, et que supprimer l'étape emporte ses liens sans laisser d'orphelin ; celle du palier 022 qu'**aucune case n'est devinée** (`grade_waivers` naît vide, donc toute case vierge reste « en attente »), qu'une note déjà posée est intacte, que la clé primaire refuse le doublon, que le `RESTRICT` protège la compétence et les deux `CASCADE` l'élève et l'évaluation — et que le **schéma**, lui, accepterait une case portant note et déclaration : c'est le test qui dit noir sur blanc où vit réellement l'exclusion, dans les deux commandes et non dans la base ; celle du palier 024 que les six colonnes neuves **naissent vides** et qu'une fiche déjà saisie se relise mot pour mot, que le semis n'ait posé **aucun orphelin** (les paliers tournent `foreign_keys` OFF, donc rien ne l'aurait rattrapé), et que supprimer un domaine d'activité emporte bien ses enfants sans vider la fiche qui le citait — elle perd son lien, jamais son libellé ; celle du palier 025 que les deux tables neuves **naissent vides** et qu'aucune classe ne se voit attribuer d'établissement, que la note et la désactivation **coexistent** sur la même compétence — un filtre de saisie n'est pas un masque sur un fait —, puis les deux sorts à la fois : `SET NULL` qui rend la classe à « aucun établissement » et `CASCADE` qui emporte les réglages des deux côtés, l'établissement supprimé et la compétence rangée au référentiel ; celle du palier 026 que les trois textes d'avant sortent **mot pour mot** et que les quatre colonnes neuves naissent vides ou à « activité », que la table de rattachement naît **vide** (aucun rattachement d'activité n'est deviné), puis — une fois le palier réellement employé — qu'une quatrième nature est refusée par le CHECK, qu'une compétence citée refuse de partir (`RESTRICT`) et qu'une activité supprimée emporte son rattachement **et** sa plage (`CASCADE`) |
| `commands/reports/scoring.rs` | 5     | moyenne non pondérée, moyenne pondérée par le nombre de notes, absence de note — sur 20 depuis le palier 018                     |
| `portable.rs`                 | 5     | sonde d'écriture (dossier inscriptible, chemin inexistant), purge des traces WebView2 et profil absent, verrou qui refuse une seconde instance |
| `commands/timetable.rs`       | 17    | créneaux récurrents : parité de la semaine (dont deux semaines impaires de suite au passage de 2027), bornes d'horaire, ordre des heures, jours de la semaine, intitulés obligatoires ; la journée assemblée depuis ses trois sources, la quinzaine qui ne tombe pas, une lecture qui n'écrit rien, et l'année qui compte ses **vraies** semaines ; une période qui vise un groupe arrive à la grille **avec** son groupe, sans quoi l'écran estomperait la carte de toute la classe ; `feries.rs` ajoute 4 tests sur les jours fériés mobiles |
| `commands/reports.rs`         | 17    | assiduité : séances hors période d'inscription, absences justifiées collectives ou nominatives, placements de stage qui désarment la période pour un seul élève ; et les deux du palier 023, **ceux qui protègent le document remis à la famille** — une classe dédoublée partage son trimestre en **quatre** termes exactement (l'élève non rangé restant convoqué partout, son compteur de groupe à zéro), et une séance de l'autre groupe tenue **pendant** le stage de l'élève n'est comptée qu'une fois : sans le filtre de groupe dans la sous-requête `neutralisees`, elle sortait à 29 séances sur un trimestre qui en compte 26 |
| `commands/absences.rs`        | 22    | périodes d'absence justifiée : validation des bornes, chevauchements, portée collective ou nominative, cascade vers les placements ; et depuis le palier 020 — une période « avec appel » s'écrit et se relit, une absence du professeur pose une ligne par classe cochée dans une seule transaction, une liste de classes vide est refusée, une classe inconnue annule tout le geste, et `update_absence_period` refuse de rendre l'appel à une absence du professeur ou de la rendre nominative — tout en laissant corriger ses dates, une absence du professeur n'étant pas une ligne en lecture seule ; et depuis le palier 023 — une période de groupe n'écarte que les séances de son groupe, deux groupes se chevauchent sans conflit mais pas un groupe avec lui-même, une période vise un élève **ou** un groupe et jamais les deux, et une absence du professeur ne vise pas un groupe |
| `db/holidays.rs`              | 8     | découpage d'une année scolaire, semis du calendrier officiel, et surtout : un semis impossible ne fait **rien** échouer — un `?` à cet endroit détruirait `data/sgpa.keys` |
| `commands/seances.rs`         | 10    | appel : « non fait » comme état réel, appel collectif, remise à zéro, création depuis un créneau ; et depuis le palier 023 — une séance de groupe n'appelle que son groupe, et l'occurrence née d'un créneau **recopie** son groupe et refuse celui d'une autre classe |
| `commands/establishments.rs`  | 8     | les établissements : un nom rogné, normalisé, non vide et borné à 120 signes ; un renommage qui refuse le doublon mais **corrige sa propre casse** (`COLLATE NOCASE` — le doublon qu'on ne voit pas) ; un collage multiligne qui passe les lignes vides et rend ses doublons ; une classe **sans** établissement qui ne filtre rien, qui est l'état de toute base migrée ; **désactiver une compétence sans toucher ni à la note ni au rattachement**, c'est-à-dire le palier entier en un test ; une compétence inconnue qui annule **tout** l'enregistrement ; le compte inverse, qui dit où une compétence reste employée ; et la suppression qui **ne refuse pas** et rend la classe à l'état d'avant |
| `commands/activities.rs`      | 5     | l'écran du référentiel RA16 : l'arbre qui rend les champs **sans domaine** et compte les fiches contrat qui citent chaque entrée — l'écran doit savoir **avant** de proposer un bouton ce qu'une suppression coûterait —, un libellé rogné et borné, un renommage qui refuse le doublon sauf sa propre casse, un collage qui passe les lignes vides, et un réordonnancement refusé quand la liste ne correspond plus à ce qui est en base : deux écrans ouverts sur le même référentiel ne doivent pas se renuméroter l'un sur l'autre |
| `commands/groups.rs`          | 4     | les groupes : un nom rogné, non vide et borné à 40 signes ; un groupe d'une autre classe refusé ; une séance tenue qui **retient** son groupe là où un élève rangé le lâche — `RESTRICT` contre `SET NULL`, les faits contre les réglages ; et le listage qui dit **avant** ce qu'une suppression heurterait, présenter un bouton qui échoue valant moins que l'annoncer |
| `commands/attachments.rs`     | 3     | le plafond de 10 Mo porte sur les octets **décodés** et non sur la chaîne base64 reçue ; taille affichée en français (« 312 Ko », « 1,4 Mo ») ; les deux porteurs ont des requêtes jumelles — une divergence ne se verrait que sur l'écran le moins fréquenté |
| `commands/progressions.rs`    | 11    | la progression annuelle : le rang d'une activité suit `(étape, activité)` et non l'ordre d'insertion, une activité d'une autre classe est refusée, une plage se désigne par un lundi, la frise n'a que deux bandes, et supprimer une étape ne laisse pas une plage orpheline ; et depuis le palier 021 — les compétences d'une étape sortent dans l'ordre du **référentiel** et non dans celui des clics (ce qui dispense la table de rattachement d'une colonne `position`), une compétence inconnue annule **tout** l'enregistrement et pas seulement ses rattachements, et le texte libre d'avant survit au passage du sélecteur ; et les trois du palier 026 — les compétences d'une **activité** sortent elles aussi dans l'ordre du référentiel (la double jointure vers la progression est le seul endroit où cette requête peut diverger de sa jumelle de l'étape), les **trois** natures sont acceptées et une quatrième refusée en français, et supprimer une activité ne laisse pas un rattachement orphelin — le `RESTRICT` qui protège la compétence étant vérifié d'abord |
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
ou 5 entrées, et la référence réglementaire n'est toujours pas vérifiée. Le palier 009 a semé
celle à **5 entrées** — il fallait bien en retenir une pour que le référentiel du socle ait où
se rattacher, et le palier 024 greffe le RA16 sous l'une d'elles. Ce n'est pas un arbitrage :
si l'enseignant tranche pour l'autre liste, c'est un palier de plus, qui renomme ou retire un
champ — et aucun des deux gestes n'est anodin, une fiche contrat gardant le **libellé figé**
du champ qu'elle cite.

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
du code a été retenu. **« Presque maîtrisé » a depuis été retiré par l'auteur** — voir
« Quatre degrés au lieu de cinq » ci-dessous —, mais l'ordre des quatre restants n'a pas
bougé.

### La note sur 20 (palier 018, 2026-11-07)

L'enseignant **saisit une note entière de 1 à 20**, et le libellé de maîtrise s'affiche à côté
d'elle. La chaîne allait dans l'autre sens jusque-là : on cliquait un degré parmi cinq, et la
note /20 s'en déduisait à quatre points par degré.

Les tranches sont **1-5 insuffisante, 6-10 fragile, 11-15 satisfaisante, 16-20 très bonne**
depuis le 2026-11-12 ; elles étaient cinq de quatre points avant cette date (voir « Quatre
degrés au lieu de cinq » ci-dessous). Elles ne sont écrites **qu'une fois**, dans
`MASTERY_BANDS` et `niveauDeNote` (`src/types/index.ts`) : pas de CHECK sur le libellé, pas de
colonne calculée, pas de table de correspondance. Le backend ne nomme jamais un degré — il
stocke un nombre et en vérifie les bornes. Un libellé stocké figerait le découpage au jour de
la saisie, et le relâcher plus tard changerait les bilans déjà établis sans que rien ne le
signale.

**Il n'y a pas de note de 0.** L'absence de note est l'absence de ligne dans `grades`, comme
l'appel non fait n'est pas un « présent » par défaut. Effacer une note est donc une commande
à part, `delete_grade`, et non un `set_grade(…, 0)` : une flèche restée enfoncée effacerait
sinon une note par simple débordement.

**Et cette absence dit deux choses, distinguées depuis le palier 022.** « Je n'ai pas encore
noté » reste l'absence pure — la case est *en attente*. « Je ne noterai jamais cet élève sur
cette compétence » est une ligne dans `grade_waivers`, posée d'un clic sur le mot à côté de la
case (ou par la touche <kbd>N</kbd>) et retirée du même geste. Les deux sortent de la moyenne,
et de la même façon : une case déclarée n'a pas de note, donc les requêtes `AVERAGES_*` sont
restées **mot pour mot** celles d'avant le palier. Ce que la déclaration change est ailleurs —
l'accueil cesse de réclamer une évaluation volontairement partielle (son compte de complétude
parcourt les **cases** et compte celles qu'une note *ou* une déclaration règle), et la feuille
remise à l'élève imprime « non évalué » en travers des colonnes de maîtrise au lieu d'une
ligne vierge qui se lisait comme un oubli. Les deux états ne peuvent pas coexister sur une
case : `set_grade` lève la déclaration dans sa transaction — poser une note, c'est évaluer —,
et `set_grade_waiver` refuse en français tant qu'une note est là.

La conversion n'a perdu aucun libellé : les anciens points 4, 8, 12, 16 et 20 sont exactement
les **hauts** des cinq tranches, donc `mark = level * 4` a conservé à chaque note déjà saisie
le libellé qu'elle affichait. C'est ce que tient le test
`une_base_v17_notee_traverse_le_palier_018_sans_perdre_un_libelle`.

Sur la **fiche d'évaluation remise à l'élève**, la note par compétence n'apparaît pas : il lit
un libellé de maîtrise — une croix dans l'une des colonnes de l'échelle — et sa moyenne sur
l'évaluation. La règle est tenue par la forme des données : la fiche reçoit des degrés,
convertis à la source, et la note par compétence n'arrive jamais jusqu'au générateur de PDF.

Ce qui **n'existe pas** et reste à concevoir si le besoin vient : pondération des trimestres et
moyenne annuelle, coefficients d'évaluation, et toute notion de dispense — absente du schéma.

### Quatre degrés au lieu de cinq (2026-11-12)

« Presque maîtrisé » a été **retiré de l'échelle** à la demande de l'auteur. Les quatre
libellés restants — maîtrise insuffisante, maîtrise fragile, maîtrise satisfaisante, très
bonne maîtrise — sont mot pour mot ceux du LSU, ceux que la famille lit déjà sur le bulletin.

Retirer un degré oblige à **recouper les vingt points**, et c'est fait en tranches égales de
cinq : **1-5 · 6-10 · 11-15 · 16-20**, contre 1-4 · 5-8 · 9-12 · 13-16 · 17-20 avant.

**Aucune note n'a changé, et il n'y a pas eu de migration.** C'est exactement ce que le palier
018 avait acheté en refusant de stocker le libellé : `grades.mark` est la donnée, le degré n'en
est que la lecture, et le découpage ne vit qu'à un seul endroit — `MASTERY_BANDS` et
`niveauDeNote` dans `src/types/index.ts`. Changer l'échelle y tient en cinq lignes.

**Ce qui change, c'est la lecture, et il faut le savoir** : un 9/20 qui s'affichait « presque
maîtrisé » s'affiche désormais « maîtrise fragile », un 12/20 passe de « presque » à
« satisfaisante », un 16/20 de « satisfaisante » à « très bonne ». Un bilan imprimé avant cette
date et le même bilan réimprimé aujourd'hui peuvent donc porter deux mots différents pour la
même note. La seule façon de l'éviter aurait été de figer le libellé dans la base au moment de
la saisie — ce qui aurait rendu ce changement impossible.

Les colonnes du PDF suivent sans qu'une largeur soit retouchée : tout ce qui les compte les
compte par `MASTERY_SCALE.length`, jamais en écrivant « 5 ».

## Documents liés

| Fichier                           | Pour qui                                                                 |
| --------------------------------- | ------------------------------------------------------------------------ |
| `LISEZ-MOI.txt`                   | l'utilisateur final : installation, phrase de récupération, ce que le chiffrement ne couvre pas, BitLocker To Go, sauvegarde, mot de passe oublié |
| `CLAUDE.md`                       | quiconque modifie le code : règles d'architecture non négociables         |
| `.github/copilot-instructions.md` | assistants de code                                                        |

## Licence

Projet personnel — tous droits réservés.
