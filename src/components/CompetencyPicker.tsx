import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import type { Cycle, Domain, Field, Competency } from "@/types";
import { ChevronDown, ChevronRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface CompetencyPickerProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

interface TreeData {
  cycles: Cycle[];
  domains: Record<string, Domain[]>;
  fields: Record<string, Field[]>;
  competencies: Record<string, Competency[]>;
}

export function CompetencyPicker({ selectedIds, onChange }: CompetencyPickerProps) {
  const { user } = useAuth();
  const [tree, setTree] = useState<TreeData>({
    cycles: [],
    domains: {},
    fields: {},
    competencies: {},
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const loadTree = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const cycles = await api.getCycles(user.id);
      const domains: Record<string, Domain[]> = {};
      const fields: Record<string, Field[]> = {};
      const competencies: Record<string, Competency[]> = {};

      for (const cycle of cycles) {
        const doms = await api.getDomains(cycle.id);
        domains[cycle.id] = doms;
        for (const dom of doms) {
          const flds = await api.getFields(dom.id);
          fields[dom.id] = flds;
          for (const fld of flds) {
            const comps = await api.getCompetencies(fld.id);
            competencies[fld.id] = comps;
          }
        }
      }

      setTree({ cycles, domains, fields, competencies });
      // Auto-expand cycles that contain selected competencies
      if (selectedIds.length > 0) {
        const expandSet = new Set<string>();
        for (const cycle of cycles) {
          for (const dom of domains[cycle.id] || []) {
            for (const fld of fields[dom.id] || []) {
              const hasSelected = (competencies[fld.id] || []).some((c) =>
                selectedIds.includes(c.id)
              );
              if (hasSelected) {
                expandSet.add(`cycle-${cycle.id}`);
                expandSet.add(`domain-${dom.id}`);
                expandSet.add(`field-${fld.id}`);
              }
            }
          }
        }
        setExpanded(expandSet);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [user, selectedIds]);

  useEffect(() => {
    loadTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleCompetency = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((s) => s !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const toggleAllInField = (fieldId: string) => {
    const comps = tree.competencies[fieldId] || [];
    const allSelected = comps.every((c) => selectedIds.includes(c.id));
    if (allSelected) {
      onChange(selectedIds.filter((id) => !comps.some((c) => c.id === id)));
    } else {
      const newIds = new Set(selectedIds);
      comps.forEach((c) => newIds.add(c.id));
      onChange(Array.from(newIds));
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground py-4 text-center">Chargement...</p>;
  }

  if (tree.cycles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        Aucun référentiel créé. Allez dans « Cycles & Compétences » pour en créer.
      </p>
    );
  }

  return (
    <ScrollArea className="h-[300px] border rounded-md">
      <div className="p-2 space-y-0.5">
        {tree.cycles.map((cycle) => {
          const cycleKey = `cycle-${cycle.id}`;
          const isExpanded = expanded.has(cycleKey);
          return (
            <div key={cycle.id}>
              <button
                type="button"
                className="flex items-center gap-1.5 w-full text-left px-2 py-1.5 rounded hover:bg-muted text-sm font-semibold cursor-pointer"
                onClick={() => toggle(cycleKey)}
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                )}
                {cycle.name}
              </button>
              {isExpanded &&
                (tree.domains[cycle.id] || []).map((domain) => {
                  const domainKey = `domain-${domain.id}`;
                  const domExpanded = expanded.has(domainKey);
                  return (
                    <div key={domain.id} className="pl-4">
                      <button
                        type="button"
                        className="flex items-center gap-1.5 w-full text-left px-2 py-1 rounded hover:bg-muted text-sm font-medium text-muted-foreground cursor-pointer"
                        onClick={() => toggle(domainKey)}
                      >
                        {domExpanded ? (
                          <ChevronDown className="h-3 w-3 shrink-0" />
                        ) : (
                          <ChevronRight className="h-3 w-3 shrink-0" />
                        )}
                        {domain.name}
                      </button>
                      {domExpanded &&
                        (tree.fields[domain.id] || []).map((field) => {
                          const fieldKey = `field-${field.id}`;
                          const fldExpanded = expanded.has(fieldKey);
                          const comps = tree.competencies[field.id] || [];
                          const allSelected =
                            comps.length > 0 &&
                            comps.every((c) => selectedIds.includes(c.id));
                          const someSelected =
                            comps.some((c) => selectedIds.includes(c.id));
                          return (
                            <div key={field.id} className="pl-4">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  className="flex items-center gap-1.5 flex-1 text-left px-2 py-1 rounded hover:bg-muted text-xs font-medium cursor-pointer"
                                  onClick={() => toggle(fieldKey)}
                                >
                                  {fldExpanded ? (
                                    <ChevronDown className="h-3 w-3 shrink-0" />
                                  ) : (
                                    <ChevronRight className="h-3 w-3 shrink-0" />
                                  )}
                                  {field.name}
                                </button>
                                {comps.length > 0 && (
                                  <button
                                    type="button"
                                    className={cn(
                                      "h-4 w-4 rounded border shrink-0 flex items-center justify-center cursor-pointer",
                                      allSelected
                                        ? "bg-primary border-primary"
                                        : someSelected
                                          ? "bg-primary/30 border-primary"
                                          : "border-muted-foreground/30"
                                    )}
                                    onClick={() => toggleAllInField(field.id)}
                                    title="Tout sélectionner/désélectionner"
                                  >
                                    {allSelected && (
                                      <Check className="h-3 w-3 text-primary-foreground" />
                                    )}
                                  </button>
                                )}
                              </div>
                              {fldExpanded &&
                                comps.map((comp) => {
                                  const isSelected = selectedIds.includes(comp.id);
                                  return (
                                    <button
                                      key={comp.id}
                                      type="button"
                                      className={cn(
                                        "flex items-center gap-2 w-full text-left pl-10 pr-2 py-1 rounded text-xs cursor-pointer",
                                        isSelected
                                          ? "bg-primary/10 text-primary font-medium"
                                          : "hover:bg-muted text-muted-foreground"
                                      )}
                                      onClick={() => toggleCompetency(comp.id)}
                                    >
                                      <div
                                        className={cn(
                                          "h-3.5 w-3.5 rounded border shrink-0 flex items-center justify-center",
                                          isSelected
                                            ? "bg-primary border-primary"
                                            : "border-muted-foreground/40"
                                        )}
                                      >
                                        {isSelected && (
                                          <Check className="h-2.5 w-2.5 text-primary-foreground" />
                                        )}
                                      </div>
                                      {comp.name}
                                    </button>
                                  );
                                })}
                            </div>
                          );
                        })}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
