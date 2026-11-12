import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
  Bookmark,
  BookOpen,
  FolderOpen,
  GraduationCap,
  Layers,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataState } from "@/components/DataState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  ChampDAjout,
  LigneDArbre,
  type StyleDeNiveau,
} from "@/components/ArbreReferentiel";
import { ReferentielActivites } from "@/pages/ReferentielActivites";
import { plural, reorderIds } from "@/lib/referentiel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const LEVEL_STYLES: Record<NodeKind, StyleDeNiveau> = {
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
    <LigneDArbre
      style={LEVEL_STYLES.competency}
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
    <LigneDArbre
      style={LEVEL_STYLES.field}
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
      <ChampDAjout
        libelle={ADD_LABELS.competency}
        onAjouter={(noms) => actions.onAdd("competency", field.id, noms)}
        className="ml-7"
      />
    </LigneDArbre>
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
    <LigneDArbre
      style={LEVEL_STYLES.domain}
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
      <ChampDAjout
        libelle={ADD_LABELS.field}
        onAjouter={(noms) => actions.onAdd("field", domain.id, noms)}
        className="ml-7"
      />
    </LigneDArbre>
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
        <LigneDArbre
          style={LEVEL_STYLES.cycle}
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
          <ChampDAjout
            libelle={ADD_LABELS.domain}
            onAjouter={(noms) => actions.onAdd("domain", cycle.id, noms)}
            className="ml-7"
          />
        </LigneDArbre>
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

  /**
   * Lequel des deux référentiels on regarde, **dans l'adresse** et non dans un
   * état local — même choix qu'`?vue=annee` de l'emploi du temps, et pour la
   * même raison : « Activités professionnelles » devient adressable, donc la
   * fiche contrat peut y renvoyer sans qu'un second écran du RA16 existe
   * quelque part. « Compétences » par défaut : c'est l'onglet qu'on ouvre pour
   * noter, et c'était le seul écran avant le 2026-11-12.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const vue =
    searchParams.get("vue") === "activites" ? "activites" : "competences";

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
      <h1 className="text-2xl font-bold">Référentiel</h1>
      <p className="mb-5 mt-1 text-sm text-muted-foreground">
        Les deux référentiels de l'application : celui des compétences, qui sert
        à noter, et celui des activités professionnelles, qui remplit la fiche
        contrat.
      </p>

      <Tabs
        value={vue}
        onValueChange={(valeur) => {
          setSearchParams(valeur === "activites" ? { vue: "activites" } : {}, {
            replace: true,
          });
        }}
      >
        <TabsList className="mb-6">
          <TabsTrigger value="competences">Compétences</TabsTrigger>
          <TabsTrigger value="activites">
            Activités professionnelles
          </TabsTrigger>
        </TabsList>

        <TabsContent value="competences" className="mt-0">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <p className="max-w-3xl text-sm text-muted-foreground">
              Cycle → Domaine → Champ → Compétence. Collez une liste dans un
              champ d'ajout pour créer tous les éléments d'un coup.
            </p>
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

          <DataState
            loading={loading}
            error={error}
            onRetry={() => void load()}
          >
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

              <ChampDAjout
                libelle={ADD_LABELS.cycle}
                onAjouter={(noms) => handleAdd("cycle", null, noms)}
              />
            </div>
          </DataState>
        </TabsContent>

        <TabsContent value="activites" className="mt-0">
          {/* Son propre chargement et sa propre barre d'erreur : les deux
              référentiels n'ont aucune donnée commune, et Radix démonte
              l'onglet caché — donc revenir ici relit l'arbre, ce qui est
              exactement ce qu'on veut après un passage par la fiche
              contrat. */}
          <ReferentielActivites />
        </TabsContent>
      </Tabs>

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
