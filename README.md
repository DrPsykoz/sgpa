<div align="center">

# 🎓 SGPA

**Suivi et Gestion Pédagogique Adapté**

Application de bureau pour les enseignants de SEGPA — gestion de classes, élèves, évaluations, compétences, séances, présences, bilans et exports PDF.

[![Tauri](https://img.shields.io/badge/Tauri-v2-24C8D8?logo=tauri&logoColor=white)](https://v2.tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![Rust](https://img.shields.io/badge/Rust-stable-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![SQLite](https://img.shields.io/badge/SQLite-bundled-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org)

</div>

---

## ✨ Fonctionnalités

| Module                         | Description                                                            |
| ------------------------------ | ---------------------------------------------------------------------- |
| **Sessions / Classes**         | Création et gestion de groupes-classes par année                       |
| **Élèves**                     | Ajout, modification, suppression d'élèves par session                  |
| **Séances**                    | Planification de séances avec cahier de texte (éditeur riche)          |
| **Présences**                  | Suivi des présences / absences / retards par séance                    |
| **Évaluations**                | Création d'évaluations avec grille de compétences et notation (0-5)    |
| **Fiches contrat**             | Fiches contrat liées aux évaluations (champ pro, activités, exigences) |
| **Référentiel de compétences** | Arborescence Cycle → Domaine → Champ → Compétence                      |
| **Bilans**                     | Bilans trimestriels par élève avec commentaires enseignant             |
| **Export PDF**                 | Génération de bilans au format PDF                                     |

## 🛠 Stack technique

| Couche            | Technologies                                                        |
| ----------------- | ------------------------------------------------------------------- |
| **Frontend**      | React 19, TypeScript, Vite, React Router v7                         |
| **Backend**       | Tauri v2 (Rust), rusqlite (SQLite bundled), bcrypt, chrono, uuid v4 |
| **UI**            | TailwindCSS 4, shadcn/ui (Radix UI), Lucide React                   |
| **Éditeur riche** | TipTap 3                                                            |
| **PDF**           | jsPDF + jspdf-autotable                                             |

## 📁 Structure du projet

```
src/                        # Frontend React
├── pages/                  # Login, Sessions, SessionDetail, Cycles
├── components/             # Composants métier + layout + ui/ (shadcn)
├── lib/
│   ├── api.ts              # Façade Tauri invoke()
│   └── pdf.ts              # Export PDF
├── types/index.ts          # Interfaces TypeScript
└── hooks/useAuth.tsx       # Contexte d'authentification

src-tauri/                  # Backend Rust
├── src/
│   ├── db.rs               # Init SQLite + migrations
│   ├── lib.rs              # Enregistrement des commandes
│   └── commands/           # auth, sessions, students, cycles,
│                           # seances, evaluations, contracts, reports
└── Cargo.toml
```

## 🚀 Installation

### Prérequis

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) ≥ 20 (via [fnm](https://github.com/Schniz/fnm) recommandé)
- [pnpm](https://pnpm.io/) ≥ 10
- Prérequis système Tauri v2 : [guide officiel](https://v2.tauri.app/start/prerequisites/)

### Lancement en développement

```powershell
# Installer les dépendances
pnpm install

# Lancer l'application (compile Rust + démarre Vite sur le port 1420)
pnpm tauri dev
```

### Build de production

```powershell
pnpm tauri build
```

L'exécutable portable se trouve dans `src-tauri/target/release/`.

## 💾 Base de données

SQLite en mode WAL, intégrée dans l'application. La base est stockée à côté de l'exécutable dans `data/sgpa.db` — aucun serveur externe requis.

**Tables principales :**

```
users ─┬── sessions ─┬── students
       │             ├── seances ──── attendance_records
       │             └── evaluations ─┬── grades
       │                              └── evaluation_competencies
       └── cycles ── domains ── fields ── competencies
```

Cascades `DELETE` sur toutes les clés étrangères. Contraintes `UNIQUE` sur les couples logiques.

## 📄 Licence

Projet personnel — tous droits réservés.
