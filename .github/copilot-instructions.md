# SGPA - Instructions Copilot

## Projet

Application de bureau portable pour enseignants de SEGPA (collège). Gestion de classes, élèves, évaluations, compétences, séances, présences, bilans et exports PDF.

## Stack technique

- **Frontend** : React 19 + TypeScript, Vite, React Router v7
- **Backend** : Tauri v2 (Rust), rusqlite (SQLite bundled), bcrypt, chrono, uuid v4
- **UI** : TailwindCSS 4, shadcn/ui (Radix UI), Lucide React icons
- **Éditeur riche** : TipTap 3
- **PDF** : jsPDF + jspdf-autotable
- **Gestionnaire de paquets** : pnpm

## Structure du projet

```
src/                    # Frontend React
  pages/                # Pages : Login, Sessions, SessionDetail, Cycles
  components/           # Composants métier + layout + ui/ (shadcn)
  lib/api.ts            # Façade Tauri invoke() — toutes les commandes
  lib/pdf.ts            # Export PDF
  types/index.ts        # Interfaces TypeScript
  hooks/useAuth.tsx     # Contexte d'authentification

src-tauri/              # Backend Rust
  src/db.rs             # Init SQLite + migrations (WAL mode, FK activées)
  src/commands/         # Commandes Tauri (auth, sessions, students, cycles,
                        #   seances, evaluations, contracts, reports)
  src/lib.rs            # Enregistrement des commandes
```

## Conventions de code

### Rust (backend)

- Chaque commande est annotée `#[tauri::command]`
- Retour `Result<T, String>` (erreur = `.map_err(|e| e.to_string())`)
- UUID v4 pour tous les identifiants (`Uuid::new_v4().to_string()`)
- `rusqlite::params![]` pour les requêtes paramétrées
- La BDD est portable : `<exe_dir>/data/sgpa.db`

### React (frontend)

- API via `api.xxx()` (façade dans `src/lib/api.ts` autour de `invoke()`)
- Composants UI dans `src/components/ui/` (shadcn/ui)
- Helper `cn()` pour les classes Tailwind conditionnelles
- Conteneurs limités en largeur (`max-w-7xl mx-auto`)

### Général

- Interface utilisateur **en français**
- Pas de framework CSS autre que Tailwind
- Pas de state management global (état local + props)

## Environnement de développement

```powershell
# PATH requis (fnm + cargo)
$nodePath = "C:\Users\Theo\AppData\Roaming\fnm\node-versions\v24.14.1\installation"
$cargoPath = "$env:USERPROFILE\.cargo\bin"
$env:PATH = "$nodePath;$cargoPath;$env:PATH"

# Lancement
pnpm tauri dev

# Port dev : 1420
# Tuer le process avant relance si besoin : Get-Process sgpa -ErrorAction SilentlyContinue | Stop-Process -Force
```

## Base de données (SQLite)

Tables principales : `users`, `sessions`, `students`, `seances`, `attendance_records`, `evaluations`, `evaluation_competencies`, `grades`, `cycles`, `domains`, `fields`, `competencies`, `contract_sheets`, `contract_sheet_rows`, `professional_fields`, `report_comments`.

Cascades DELETE sur toutes les FK. Contraintes UNIQUE sur les couples logiques (ex: `seance_id + student_id` pour attendance).
