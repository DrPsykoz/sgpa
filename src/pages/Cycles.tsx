import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import type { Cycle, Domain, Field, Competency } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, BookOpen, Layers, FolderOpen, Bookmark, GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";

// ---- Inline editable row ----
function TreeRow({
  name,
  icon: Icon,
  onEdit,
  onDelete,
  children,
  collapsible = false,
  depth = 0,
  accent = "border-l-primary",
}: {
  name: string;
  icon: React.ElementType;
  onEdit: (newName: string) => void;
  onDelete: () => void;
  children?: React.ReactNode;
  collapsible?: boolean;
  depth?: number;
  accent?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(name);
  const [expanded, setExpanded] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSave = () => {
    if (editName.trim()) {
      onEdit(editName.trim());
      setEditing(false);
    }
  };

  const fontSizes = ["text-base font-semibold", "text-sm font-semibold", "text-sm font-medium", "text-sm"];

  return (
    <div className={cn(depth > 0 && "border-l-2 ml-3", accent)}>
      <div className={cn(
        "group flex items-center gap-2 py-2 pr-2 rounded-r-md transition-colors",
        depth > 0 ? "pl-4 hover:bg-muted/50" : "pl-2 hover:bg-muted/50"
      )}>
        {collapsible ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />

        {editing ? (
          <div className="flex-1 flex items-center gap-2">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") { setEditing(false); setEditName(name); }
              }}
              autoFocus
              className="h-7 text-sm"
            />
            <Button size="sm" variant="default" className="h-7 text-xs px-2" onClick={handleSave}>OK</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => { setEditing(false); setEditName(name); }}>
              Annuler
            </Button>
          </div>
        ) : (
          <>
            <span className={cn("flex-1", fontSizes[depth] || "text-sm")}>{name}</span>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditName(name); setEditing(true); }}>
                <Pencil className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </>
        )}
      </div>

      {expanded && children && <div className="pb-1">{children}</div>}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              Supprimer « {name} » et tout son contenu ? Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>Supprimer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---- Add button ----
function AddButton({ label, onAdd, className }: { label: string; onAdd: (name: string) => void; className?: string }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const handleAdd = () => {
    if (name.trim()) {
      onAdd(name.trim());
      setName("");
      setAdding(false);
    }
  };

  if (adding) {
    return (
      <div className={cn("flex items-center gap-2 py-1", className)}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
            if (e.key === "Escape") { setAdding(false); setName(""); }
          }}
          placeholder={label}
          autoFocus
          className="h-7 text-sm max-w-[260px]"
        />
        <Button size="sm" variant="default" className="h-7 text-xs px-2" onClick={handleAdd}>OK</Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => { setAdding(false); setName(""); }}>Annuler</Button>
      </div>
    );
  }

  return (
    <button onClick={() => setAdding(true)} className={cn("flex items-center gap-1 text-xs text-primary font-medium hover:underline cursor-pointer py-1", className)}>
      <Plus className="h-3 w-3" />
      {label}
    </button>
  );
}

// ---- Competencies level ----
function CompetenciesBlock({ fieldId }: { fieldId: string }) {
  const [competencies, setCompetencies] = useState<Competency[]>([]);

  const load = useCallback(async () => {
    const data = await api.getCompetencies(fieldId);
    setCompetencies(data);
  }, [fieldId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      {competencies.map((c) => (
        <TreeRow
          key={c.id}
          name={c.name}
          icon={GraduationCap}
          depth={3}
          accent="border-l-emerald-300"
          onEdit={async (newName) => { await api.updateCompetency(c.id, newName); load(); }}
          onDelete={async () => { await api.deleteCompetency(c.id); load(); }}
        />
      ))}
      <AddButton className="ml-12" label="Ajouter une compétence" onAdd={async (name) => { await api.createCompetency(fieldId, name); load(); }} />
    </div>
  );
}

// ---- Fields level ----
function FieldsBlock({ domainId }: { domainId: string }) {
  const [fields, setFields] = useState<Field[]>([]);

  const load = useCallback(async () => {
    const data = await api.getFields(domainId);
    setFields(data);
  }, [domainId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      {fields.map((f) => (
        <TreeRow
          key={f.id}
          name={f.name}
          icon={Bookmark}
          depth={2}
          accent="border-l-blue-300"
          collapsible
          onEdit={async (newName) => { await api.updateField(f.id, newName); load(); }}
          onDelete={async () => { await api.deleteField(f.id); load(); }}
        >
          <CompetenciesBlock fieldId={f.id} />
        </TreeRow>
      ))}
      <AddButton className="ml-9" label="Ajouter un champ" onAdd={async (name) => { await api.createField(domainId, name); load(); }} />
    </div>
  );
}

// ---- Domains level ----
function DomainsBlock({ cycleId }: { cycleId: string }) {
  const [domains, setDomains] = useState<Domain[]>([]);

  const load = useCallback(async () => {
    const data = await api.getDomains(cycleId);
    setDomains(data);
  }, [cycleId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      {domains.map((d) => (
        <TreeRow
          key={d.id}
          name={d.name}
          icon={FolderOpen}
          depth={1}
          accent="border-l-amber-400"
          collapsible
          onEdit={async (newName) => { await api.updateDomain(d.id, newName); load(); }}
          onDelete={async () => { await api.deleteDomain(d.id); load(); }}
        >
          <FieldsBlock domainId={d.id} />
        </TreeRow>
      ))}
      <AddButton className="ml-6" label="Ajouter un domaine" onAdd={async (name) => { await api.createDomain(cycleId, name); load(); }} />
    </div>
  );
}

// ---- Main Cycles Page ----
export default function Cycles() {
  const { user } = useAuth();
  const [cycles, setCycles] = useState<Cycle[]>([]);

  const loadCycles = useCallback(async () => {
    if (!user) return;
    const data = await api.getCycles(user.id);
    setCycles(data);
  }, [user]);

  useEffect(() => { loadCycles(); }, [loadCycles]);

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Cycles & Compétences</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Gérez votre référentiel : Cycles → Domaines → Champs → Compétences
          </p>
        </div>
      </div>

      {cycles.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Aucun cycle créé</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {cycles.map((cycle) => (
            <Card key={cycle.id} className="overflow-hidden">
              <CardContent className="p-3">
                <TreeRow
                  name={cycle.name}
                  icon={Layers}
                  depth={0}
                  accent="border-l-primary"
                  collapsible
                  onEdit={async (newName) => { await api.updateCycle(cycle.id, newName); loadCycles(); }}
                  onDelete={async () => { await api.deleteCycle(cycle.id); loadCycles(); }}
                >
                  <DomainsBlock cycleId={cycle.id} />
                </TreeRow>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-4">
        <AddButton
          label="Ajouter un cycle"
          onAdd={async (name) => {
            if (!user) return;
            await api.createCycle(user.id, name);
            loadCycles();
          }}
        />
      </div>
    </div>
  );
}
