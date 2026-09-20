import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ElementType, ReactNode } from "react";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Bookmark,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  GraduationCap,
  Layers,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import type {
  BulkResult,
  CompetencyNode,
  CycleNode,
  DomainNode,
  FieldNode,
  NodeKind,
} from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DataState } from "@/components/DataState";
import { ConfirmDialog } from "@/pages/SessionDetail/dialogs/ConfirmDialog";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n > 1 ? many : one}`;

/**
 * Word, les PDF et les tableurs collent des espaces insécables (U+00A0,
 * U+202F) et des tabulations. Sans cette normalisation, `trim()` laisse le
 * blanc invisible en place et la déduplication échoue dessus : on obtient deux
 * compétences visuellement identiques.
 */
function normalizeNames(lines: string[]): string[] {
  return lines
    .map((line) =>
      line
        .replace(/[\u00a0\u202f]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => line.length > 0);
}

/** Le backend ne dédoublonne que contre l'existant ; le texte collé peut, lui,
 *  se répéter (colonne de tableur recopiée). On filtre donc aussi la liste. */
function dedupeNames(names: string[]): {
  unique: string[];
  duplicates: string[];
} {
  const seen = new Set<string>();
  const unique: string[] = [];
  const duplicates: string[] = [];
  for (const name of names) {
    const key = name.toLocaleLowerCase("fr-FR");
    if (seen.has(key)) duplicates.push(name);
    else {
      seen.add(key);
      unique.push(name);
    }
  }
  return { unique, duplicates };
}

/**
 * Échange le nœud avec son voisin *visible*, mais renvoie l'ordre complet du
 * niveau : `reorder_nodes` réécrit toutes les positions, et une liste amputée
 * des compétences archivées les repousserait en fin de liste.
 */
function reorderIds(
  all: { id: string }[],
  visible: { id: string }[],
  id: string,
  direction: -1 | 1,
): string[] | null {
  const from = visible.findIndex((n) => n.id === id);
  if (from === -1) return null;
  const neighbour: { id: string } | undefined = visible[from + direction];
  if (!neighbour) return null;
  const next = all.map((n) => n.id);
  const a = next.indexOf(id);
  const b = next.indexOf(neighbour.id);
  if (a === -1 || b === -1) return null;
  next[a] = neighbour.id;
  next[b] = id;
  return next;
}

const LEVEL_STYLES: Record<
  NodeKind,
  { icon: ElementType; accent: string; text: string }
> = {
  cycle: {
    icon: Layers,
    accent: "border-l-primary",
    text: "text-base font-semibold",
  },
  domain: {
    icon: FolderOpen,
    accent: "border-l-amber-400",
    text: "text-sm font-semibold",
  },
  field: {
    icon: Bookmark,
    accent: "border-l-blue-300",
    text: "text-sm font-medium",
  },
  competency: {
    icon: GraduationCap,
    accent: "border-l-emerald-300",
    text: "text-sm",
  },
};

const ADD_LABELS: Record<NodeKind, string> = {
  cycle: "Ajouter un cycle",
  domain: "Ajouter un domaine",
  field: "Ajouter un champ",
  competency: "Ajouter une compétence",
};

const DELETE_TITLES: Record<NodeKind, string> = {
  cycle: "Supprimer ce cycle ?",
  domain: "Supprimer ce domaine ?",
  field: "Supprimer ce champ ?",
  competency: "Supprimer cette compétence ?",
};

interface TreeActions {
  collapsed: Set<string>;
  toggle: (key: string) => void;
  showArchived: boolean;
  onRename: (kind: NodeKind, id: string, name: string) => void;
  onDelete: (kind: NodeKind, id: string, name: string) => void;
  onArchive: (id: string, archived: boolean) => void;
  onReorder: (
    kind: NodeKind,
    parentId: string | null,
    orderedIds: string[],
  ) => void;
  onAdd: (
    kind: NodeKind,
    parentId: string | null,
    names: string[],
  ) => Promise<BulkResult>;
}

// ---------------------------------------------------------------------------
// Champ d'ajout — le cœur de la saisie du référentiel
// ---------------------------------------------------------------------------

interface AddNodeFieldProps {
  kind: NodeKind;
  parentId: string | null;
  onAdd: TreeActions["onAdd"];
  className?: string;
}

function AddNodeField({ kind, parentId, onAdd, className }: AddNodeFieldProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(0);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (rawNames: string[]) => {
    if (busy) return;
    const names = normalizeNames(rawNames);
    if (names.length === 0) return;
    const { unique, duplicates } = dedupeNames(names);
    setBusy(true);
    setError(null);
    try {
      const result = await onAdd(kind, parentId, unique);
      setAdded((n) => n + result.created.length);
      setSkipped([...duplicates, ...result.skipped]);
      setValue("");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
      // Le champ reste ouvert ET focalisé : le refermer après chaque ajout
      // rendait la saisie d'une centaine de nœuds intenable.
      inputRef.current?.focus();
    }
  };

  const close = () => {
    setOpen(false);
    setValue("");
    setAdded(0);
    setSkipped([]);
    setError(null);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex cursor-pointer items-center gap-1 py-1 text-xs font-medium text-primary hover:underline",
          className,
        )}
      >
        <Plus className="h-3 w-3" />
        {ADD_LABELS[kind]}
      </button>
    );
  }

  return (
    <div className={cn("py-1", className)}>
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          autoFocus
          value={value}
          placeholder={`${ADD_LABELS[kind]} — ou collez une liste`}
          className="h-7 max-w-[380px] text-sm"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit([value]);
            }
            if (e.key === "Escape") close();
          }}
          onPaste={(e) => {
            // Même dans un <input>, l'événement `paste` expose le texte AVEC
            // ses sauts de ligne : inutile de passer à un <textarea>.
            const text = e.clipboardData.getData("text");
            if (!text.includes("\n")) return; // un seul nom : collage natif
            e.preventDefault();
            void submit(text.split(/\r?\n/));
          }}
        />
        <Button
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={busy || value.trim().length === 0}
          onClick={() => void submit([value])}
        >
          {busy ? "Ajout…" : "Ajouter"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={close}
        >
          Fermer
        </Button>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {added > 0 && (
          <span className="font-medium text-emerald-700">
            {plural(added, "ajouté", "ajoutés")}
          </span>
        )}
        {skipped.length > 0 && (
          <span className="text-amber-700">
            {plural(skipped.length, "doublon ignoré", "doublons ignorés")} :{" "}
            {skipped.slice(0, 5).join(", ")}
            {skipped.length > 5 ? "…" : ""}
          </span>
        )}
        {error && <span className="text-destructive">{error}</span>}
        {added === 0 && skipped.length === 0 && !error && (
          <span className="text-muted-foreground">
            Collez une liste (une ligne par élément) pour tout créer d'un coup.
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ligne générique de l'arbre
// ---------------------------------------------------------------------------

interface NodeRowProps {
  kind: NodeKind;
  name: string;
  depth: number;
  archived?: boolean;
  meta?: string;
  collapsible?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onToggleArchive?: () => void;
  children?: ReactNode;
}

function NodeRow({
  kind,
  name,
  depth,
  archived = false,
  meta,
  collapsible = false,
  expanded = true,
  onToggle,
  canMoveUp,
  canMoveDown,
  onMove,
  onRename,
  onDelete,
  onToggleArchive,
  children,
}: NodeRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const style = LEVEL_STYLES[kind];
  const Icon = style.icon;

  const startEdit = () => {
    setDraft(name);
    setEditing(true);
  };

  const commit = () => {
    const next = draft.trim();
    if (next && next !== name) onRename(next);
    setEditing(false);
  };

  return (
    <div className={cn(depth > 0 && "ml-3 border-l-2", style.accent)}>
      <div
        className={cn(
          "group flex items-center gap-2 rounded-r-md py-1.5 pr-2 transition-colors hover:bg-muted/50",
          depth > 0 ? "pl-3" : "pl-2",
        )}
      >
        {collapsible ? (
          <button
            type="button"
            onClick={onToggle}
            title={expanded ? "Replier" : "Déplier"}
            className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            archived ? "text-muted-foreground/60" : "text-muted-foreground",
          )}
        />

        {editing ? (
          <div className="flex flex-1 items-center gap-2">
            <Input
              value={draft}
              autoFocus
              className="h-7 max-w-[380px] text-sm"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                }
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <Button size="sm" className="h-7 px-2 text-xs" onClick={commit}>
              Renommer
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setEditing(false)}
            >
              Annuler
            </Button>
          </div>
        ) : (
          <>
            <span
              className={cn(
                "flex-1 truncate",
                style.text,
                archived && "text-muted-foreground line-through",
              )}
            >
              {name}
            </span>

            {archived && (
              <Badge
                variant="outline"
                className="shrink-0 text-[10px] font-normal text-muted-foreground"
              >
                archivée
              </Badge>
            )}

            {meta && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {meta}
              </span>
            )}

            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="Monter"
                disabled={!canMoveUp}
                onClick={() => onMove(-1)}
              >
                <ArrowUp className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="Descendre"
                disabled={!canMoveDown}
                onClick={() => onMove(1)}
              >
                <ArrowDown className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="Renommer"
                onClick={startEdit}
              >
                <Pencil className="h-3 w-3" />
              </Button>
              {onToggleArchive && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  title={archived ? "Désarchiver" : "Archiver"}
                  onClick={onToggleArchive}
                >
                  {archived ? (
                    <ArchiveRestore className="h-3 w-3" />
                  ) : (
                    <Archive className="h-3 w-3" />
                  )}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-destructive hover:text-destructive"
                title="Supprimer"
                onClick={onDelete}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </>
        )}
      </div>

      {expanded && children ? <div className="pb-1">{children}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Niveaux
// ---------------------------------------------------------------------------

function CompetencyRow({
  competency,
  all,
  visible,
  fieldId,
  actions,
}: {
  competency: CompetencyNode;
  all: CompetencyNode[];
  visible: CompetencyNode[];
  fieldId: string;
  actions: TreeActions;
}) {
  const index = visible.findIndex((c) => c.id === competency.id);
  return (
    <NodeRow
      kind="competency"
      name={competency.name}
      depth={3}
      archived={competency.archived}
      canMoveUp={index > 0}
      canMoveDown={index >= 0 && index < visible.length - 1}
      onMove={(direction) => {
        const ordered = reorderIds(all, visible, competency.id, direction);
        if (ordered) actions.onReorder("competency", fieldId, ordered);
      }}
      onRename={(name) => actions.onRename("competency", competency.id, name)}
      onDelete={() =>
        actions.onDelete("competency", competency.id, competency.name)
      }
      onToggleArchive={() =>
        actions.onArchive(competency.id, !competency.archived)
      }
    />
  );
}

function FieldBlock({
  field,
  all,
  domainId,
  actions,
}: {
  field: FieldNode;
  all: FieldNode[];
  domainId: string;
  actions: TreeActions;
}) {
  const key = `field:${field.id}`;
  const expanded = !actions.collapsed.has(key);
  const index = all.findIndex((f) => f.id === field.id);
  const visible = actions.showArchived
    ? field.competencies
    : field.competencies.filter((c) => !c.archived);
  const hiddenCount = field.competencies.length - visible.length;

  return (
    <NodeRow
      kind="field"
      name={field.name}
      depth={2}
      collapsible
      expanded={expanded}
      onToggle={() => actions.toggle(key)}
      meta={
        plural(visible.length, "compétence", "compétences") +
        (hiddenCount > 0
          ? ` · ${plural(hiddenCount, "archivée", "archivées")}`
          : "")
      }
      canMoveUp={index > 0}
      canMoveDown={index < all.length - 1}
      onMove={(direction) => {
        const ordered = reorderIds(all, all, field.id, direction);
        if (ordered) actions.onReorder("field", domainId, ordered);
      }}
      onRename={(name) => actions.onRename("field", field.id, name)}
      onDelete={() => actions.onDelete("field", field.id, field.name)}
    >
      {visible.map((competency) => (
        <CompetencyRow
          key={competency.id}
          competency={competency}
          all={field.competencies}
          visible={visible}
          fieldId={field.id}
          actions={actions}
        />
      ))}
      <AddNodeField
        kind="competency"
        parentId={field.id}
        onAdd={actions.onAdd}
        className="ml-7"
      />
    </NodeRow>
  );
}

function DomainBlock({
  domain,
  all,
  cycleId,
  actions,
}: {
  domain: DomainNode;
  all: DomainNode[];
  cycleId: string;
  actions: TreeActions;
}) {
  const key = `domain:${domain.id}`;
  const expanded = !actions.collapsed.has(key);
  const index = all.findIndex((d) => d.id === domain.id);

  return (
    <NodeRow
      kind="domain"
      name={domain.name}
      depth={1}
      collapsible
      expanded={expanded}
      onToggle={() => actions.toggle(key)}
      meta={plural(domain.fields.length, "champ", "champs")}
      canMoveUp={index > 0}
      canMoveDown={index < all.length - 1}
      onMove={(direction) => {
        const ordered = reorderIds(all, all, domain.id, direction);
        if (ordered) actions.onReorder("domain", cycleId, ordered);
      }}
      onRename={(name) => actions.onRename("domain", domain.id, name)}
      onDelete={() => actions.onDelete("domain", domain.id, domain.name)}
    >
      {domain.fields.map((field) => (
        <FieldBlock
          key={field.id}
          field={field}
          all={domain.fields}
          domainId={domain.id}
          actions={actions}
        />
      ))}
      <AddNodeField
        kind="field"
        parentId={domain.id}
        onAdd={actions.onAdd}
        className="ml-7"
      />
    </NodeRow>
  );
}

function CycleBlock({
  cycle,
  all,
  actions,
}: {
  cycle: CycleNode;
  all: CycleNode[];
  actions: TreeActions;
}) {
  const key = `cycle:${cycle.id}`;
  const expanded = !actions.collapsed.has(key);
  const index = all.findIndex((c) => c.id === cycle.id);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3">
        <NodeRow
          kind="cycle"
          name={cycle.name}
          depth={0}
          collapsible
          expanded={expanded}
          onToggle={() => actions.toggle(key)}
          meta={plural(cycle.domains.length, "domaine", "domaines")}
          canMoveUp={index > 0}
          canMoveDown={index < all.length - 1}
          onMove={(direction) => {
            const ordered = reorderIds(all, all, cycle.id, direction);
            if (ordered) actions.onReorder("cycle", null, ordered);
          }}
          onRename={(name) => actions.onRename("cycle", cycle.id, name)}
          onDelete={() => actions.onDelete("cycle", cycle.id, cycle.name)}
        >
          {cycle.domains.map((domain) => (
            <DomainBlock
              key={domain.id}
              domain={domain}
              all={cycle.domains}
              cycleId={cycle.id}
              actions={actions}
            />
          ))}
          <AddNodeField
            kind="domain"
            parentId={cycle.id}
            onAdd={actions.onAdd}
            className="ml-7"
          />
        </NodeRow>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface NodeTarget {
  kind: NodeKind;
  id: string;
  name: string;
}

export default function Cycles() {
  const [tree, setTree] = useState<CycleNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<NodeTarget | null>(null);
  const [blocked, setBlocked] = useState<
    (NodeTarget & { message: string }) | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTree(await api.getReferentialTree());
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Recharge sans repasser par `loading` : sinon `DataState` démonterait le
   *  champ d'ajout à chaque écriture, qui perdrait focus et compteur. */
  const run = useCallback(async (action: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await action();
      setTree(await api.getReferentialTree());
    } catch (err) {
      setActionError(messageOf(err));
    }
  }, []);

  const handleAdd = useCallback(
    async (kind: NodeKind, parentId: string | null, names: string[]) => {
      setActionError(null);
      const result = await api.createNodesBulk(kind, parentId, names);
      setTree(await api.getReferentialTree());
      return result;
    },
    [],
  );

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const actions = useMemo<TreeActions>(
    () => ({
      collapsed,
      toggle,
      showArchived,
      onRename: (kind, id, name) =>
        void run(() => api.renameNode(kind, id, name)),
      onDelete: (kind, id, name) => setPendingDelete({ kind, id, name }),
      onArchive: (id, archived) =>
        void run(() => api.archiveCompetency(id, archived)),
      onReorder: (kind, parentId, orderedIds) =>
        void run(() => api.reorderNodes(kind, parentId, orderedIds)),
      onAdd: handleAdd,
    }),
    [collapsed, toggle, showArchived, run, handleAdd],
  );

  const allKeys = useMemo(() => {
    const keys: string[] = [];
    for (const cycle of tree) {
      keys.push(`cycle:${cycle.id}`);
      for (const domain of cycle.domains) {
        keys.push(`domain:${domain.id}`);
        for (const field of domain.fields) keys.push(`field:${field.id}`);
      }
    }
    return keys;
  }, [tree]);

  const archivedTotal = useMemo(
    () =>
      tree.reduce(
        (total, cycle) =>
          total +
          cycle.domains.reduce(
            (perCycle, domain) =>
              perCycle +
              domain.fields.reduce(
                (perDomain, field) =>
                  perDomain +
                  field.competencies.filter((c) => c.archived).length,
                0,
              ),
            0,
          ),
        0,
      ),
    [tree],
  );

  const confirmDelete = async () => {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    setActionError(null);
    try {
      await api.deleteNode(target.kind, target.id);
      setTree(await api.getReferentialTree());
    } catch (err) {
      // Le backend refuse avec un message chiffré (« utilisée par 3
      // évaluation(s) et porte 27 note(s) ») : on l'affiche tel quel et on
      // propose l'archivage, seule issue non destructive.
      setBlocked({ ...target, message: messageOf(err) });
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Référentiel de compétences</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cycle → Domaine → Champ → Compétence. Collez une liste dans un champ
            d'ajout pour créer tous les éléments d'un coup.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCollapsed(new Set(allKeys))}
            disabled={tree.length === 0}
          >
            Tout replier
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCollapsed(new Set())}
            disabled={tree.length === 0}
          >
            Tout déplier
          </Button>
          <Button
            variant={showArchived ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowArchived((v) => !v)}
          >
            <Archive className="h-4 w-4" />
            {showArchived
              ? "Masquer les archivées"
              : `Afficher les archivées${
                  archivedTotal > 0 ? ` (${archivedTotal})` : ""
                }`}
          </Button>
        </div>
      </div>

      {actionError && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{actionError}</span>
          <button
            type="button"
            title="Masquer"
            className="cursor-pointer"
            onClick={() => setActionError(null)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <DataState loading={loading} error={error} onRetry={() => void load()}>
        <div className="space-y-3">
          {tree.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <BookOpen className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-muted-foreground">
                  Aucun cycle pour l'instant.
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Créez un premier cycle ci-dessous, puis ses domaines, ses
                  champs et ses compétences.
                </p>
              </CardContent>
            </Card>
          ) : (
            tree.map((cycle) => (
              <CycleBlock
                key={cycle.id}
                cycle={cycle}
                all={tree}
                actions={actions}
              />
            ))
          )}

          <AddNodeField kind="cycle" parentId={null} onAdd={handleAdd} />
        </div>
      </DataState>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={pendingDelete ? DELETE_TITLES[pendingDelete.kind] : ""}
        description={
          pendingDelete &&
          (pendingDelete.kind === "competency" ? (
            <>
              La compétence « {pendingDelete.name} » sera supprimée
              définitivement. Si des notes s'y rattachent, la suppression sera
              refusée et vous pourrez l'archiver à la place.
            </>
          ) : (
            <>
              « {pendingDelete.name} » et tout son contenu seront supprimés
              définitivement. Cette action est irréversible.
            </>
          ))
        }
        onConfirm={confirmDelete}
      />

      <Dialog
        open={blocked !== null}
        onOpenChange={(open) => {
          if (!open) setBlocked(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suppression impossible</DialogTitle>
            <DialogDescription>{blocked?.message}</DialogDescription>
          </DialogHeader>
          {blocked && blocked.kind !== "competency" && (
            <p className="text-sm text-muted-foreground">
              Archivez les compétences concernées, puis réessayez.
            </p>
          )}
          <DialogFooter>
            {blocked && blocked.kind === "competency" && (
              <Button
                onClick={() => {
                  const id = blocked.id;
                  setBlocked(null);
                  void run(() => api.archiveCompetency(id, true));
                }}
              >
                <Archive className="h-4 w-4" />
                Archiver la compétence
              </Button>
            )}
            <Button variant="outline" onClick={() => setBlocked(null)}>
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
