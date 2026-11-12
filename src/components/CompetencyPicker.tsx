import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import type { CycleNode } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DataState } from "@/components/DataState";
import { cn } from "@/lib/utils";

interface CompetencyPickerProps {
  selected: string[];
  onChange: (ids: string[]) => void;
  /** La classe dans laquelle on compose — palier 025, facultatif.
   *
   *  Fourni, il retire des propositions les compétences que
   *  l'établissement de cette classe n'emploie pas. Omis, rien n'est
   *  retiré : c'est le comportement d'avant le palier, et celui de toute
   *  classe sans établissement.
   *
   *  **C'est un filtre de saisie et jamais un masque sur des faits** : une
   *  compétence désactivée mais DÉJÀ cochée reste affichée, cochée,
   *  décochable. Un réglage posé en janvier ne doit pas faire disparaître
   *  de l'écran une compétence notée en novembre — une note qui existe
   *  encore mais que plus aucun écran n'affiche est la panne qu'on ne voit
   *  pas. C'est le même geste que pour `archived` juste en dessous, et ce
   *  n'est pas un hasard : les deux disent « ne me la propose plus », l'un
   *  pour toute la base, l'autre pour un établissement. */
  sessionId?: string;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Recherche insensible à la casse ET aux accents : « evaluer » doit trouver
 *  « Évaluer », sinon la recherche paraît cassée dès le premier essai. */
function fold(text: string): string {
  return text
    .toLocaleLowerCase("fr-FR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Replie tout sauf les branches contenant déjà une compétence cochée : à la
 *  réouverture d'une évaluation, on voit sa sélection sans rien déplier. */
function collapsedForSelection(
  tree: CycleNode[],
  selected: Set<string>,
): Set<string> {
  const collapsed = new Set<string>();
  if (selected.size === 0) return collapsed;
  for (const cycle of tree) {
    let cycleHas = false;
    for (const domain of cycle.domains) {
      let domainHas = false;
      for (const field of domain.fields) {
        const fieldHas = field.competencies.some((c) => selected.has(c.id));
        if (!fieldHas) collapsed.add(`field:${field.id}`);
        domainHas = domainHas || fieldHas;
      }
      if (!domainHas) collapsed.add(`domain:${domain.id}`);
      cycleHas = cycleHas || domainHas;
    }
    if (!cycleHas) collapsed.add(`cycle:${cycle.id}`);
  }
  return collapsed;
}

function CheckBox({ state }: { state: "on" | "off" | "partial" }) {
  return (
    <div
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
        state === "on" && "border-primary bg-primary",
        state === "partial" && "border-primary bg-primary/30",
        state === "off" && "border-muted-foreground/40",
      )}
    >
      {state === "on" && <Check className="h-3 w-3 text-primary-foreground" />}
    </div>
  );
}

export function CompetencyPicker({
  selected,
  onChange,
  sessionId,
}: CompetencyPickerProps) {
  const [tree, setTree] = useState<CycleNode[]>([]);
  const [desactivees, setDesactivees] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // La sélection initiale sert à choisir ce qui est déplié au chargement, mais
  // ne doit pas relancer le chargement à chaque coche : d'où la référence.
  const initialSelection = useRef(selected);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // L'arbre complet arrive assemblé côté Rust, et la liste des
      // compétences écartées par l'établissement avec lui : deux lectures
      // en parallèle, parce qu'une attente en série ferait clignoter un
      // arbre complet avant de le raboter sous les yeux de l'enseignant.
      const [data, ecartees] = await Promise.all([
        api.getReferentialTree(),
        sessionId === undefined
          ? Promise.resolve<string[]>([])
          : api.getDisabledCompetenciesForSession(sessionId),
      ]);
      setTree(data);
      setDesactivees(new Set(ecartees));
      setCollapsed(
        collapsedForSelection(data, new Set(initialSelection.current)),
      );
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const query = fold(search.trim());

  const filtered = useMemo(() => {
    const keep = (name: string) => query.length === 0 || fold(name).includes(query);
    return tree
      .map((cycle) => {
        const cycleMatch = keep(cycle.name);
        const domains = cycle.domains
          .map((domain) => {
            const domainMatch = cycleMatch || keep(domain.name);
            const fields = domain.fields
              .map((field) => {
                const fieldMatch = domainMatch || keep(field.name);
                const competencies = field.competencies.filter(
                  (c) =>
                    // Une compétence archivée n'est plus proposée, sauf si
                    // l'évaluation la référence déjà : la retirer d'office
                    // supprimerait des notes sans le dire.
                    (!c.archived || selectedSet.has(c.id)) &&
                    // Même règle, autre portée : l'établissement de cette
                    // classe ne l'emploie pas (palier 025). La même
                    // exception, pour la même raison.
                    (!desactivees.has(c.id) || selectedSet.has(c.id)) &&
                    (fieldMatch || keep(c.name)),
                );
                return { ...field, competencies };
              })
              .filter((field) => field.competencies.length > 0);
            return { ...domain, fields };
          })
          .filter((domain) => domain.fields.length > 0);
        return { ...cycle, domains };
      })
      .filter((cycle) => cycle.domains.length > 0);
  }, [tree, query, selectedSet, desactivees]);

  /**
   * Combien de compétences l'établissement retire de cette liste.
   *
   * Il faut le dire, et pas seulement le faire : une compétence attendue et
   * introuvable passe pour un défaut de l'application, et l'enseignant la
   * recréerait en double dans le référentiel. Les archivées ne sont pas
   * comptées — elles sont déjà retirées pour toute la base, et les compter
   * ici attribuerait à l'établissement un retrait qu'il n'a pas demandé.
   */
  const masquees = useMemo(() => {
    if (desactivees.size === 0) return 0;
    let compte = 0;
    for (const cycle of tree) {
      for (const domain of cycle.domains) {
        for (const field of domain.fields) {
          for (const competency of field.competencies) {
            if (
              desactivees.has(competency.id) &&
              !selectedSet.has(competency.id) &&
              !competency.archived
            ) {
              compte += 1;
            }
          }
        }
      }
    }
    return compte;
  }, [tree, desactivees, selectedSet]);

  const toggleNode = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Pendant une recherche, tout est déplié : un résultat caché dans une
  // branche repliée passerait pour une absence de résultat.
  const isExpanded = (key: string) => query.length > 0 || !collapsed.has(key);

  const toggleCompetency = (id: string) => {
    if (selectedSet.has(id)) onChange(selected.filter((s) => s !== id));
    else onChange([...selected, id]);
  };

  const toggleField = (ids: string[]) => {
    const allSelected = ids.every((id) => selectedSet.has(id));
    if (allSelected) {
      onChange(selected.filter((id) => !ids.includes(id)));
    } else {
      const next = new Set(selected);
      for (const id of ids) next.add(id);
      onChange(Array.from(next));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une compétence…"
            className="h-8 pl-7 text-sm"
          />
          {search.length > 0 && (
            <button
              type="button"
              title="Effacer la recherche"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {selected.length === 0
            ? "Aucune sélection"
            : `${selected.length} sélectionnée${selected.length > 1 ? "s" : ""}`}
        </span>
        {selected.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => onChange([])}
          >
            Tout décocher
          </Button>
        )}
      </div>

      {masquees > 0 && (
        <p className="text-xs text-muted-foreground">
          {masquees} compétence{masquees > 1 ? "s" : ""} ne sont pas
          proposée{masquees > 1 ? "s" : ""} ici : l'établissement de cette
          classe ne les emploie pas. Le réglage est dans Réglages ›
          Établissements, et celles qui sont déjà cochées restent visibles.
        </p>
      )}

      <DataState
        loading={loading}
        error={error}
        empty={tree.length === 0}
        emptyLabel="Aucun référentiel. Créez vos cycles depuis l'écran Référentiel."
        onRetry={() => void load()}
      >
        <ScrollArea className="h-[300px] rounded-md border">
          <div className="space-y-0.5 p-2">
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Aucune compétence ne correspond à « {search.trim()} ».
              </p>
            ) : (
              filtered.map((cycle) => {
                const cycleKey = `cycle:${cycle.id}`;
                return (
                  <div key={cycle.id}>
                    <button
                      type="button"
                      onClick={() => toggleNode(cycleKey)}
                      className="flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm font-semibold hover:bg-muted"
                    >
                      {isExpanded(cycleKey) ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                      )}
                      {cycle.name}
                    </button>

                    {isExpanded(cycleKey) &&
                      cycle.domains.map((domain) => {
                        const domainKey = `domain:${domain.id}`;
                        return (
                          <div key={domain.id} className="pl-4">
                            <button
                              type="button"
                              onClick={() => toggleNode(domainKey)}
                              className="flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-left text-sm font-medium text-muted-foreground hover:bg-muted"
                            >
                              {isExpanded(domainKey) ? (
                                <ChevronDown className="h-3 w-3 shrink-0" />
                              ) : (
                                <ChevronRight className="h-3 w-3 shrink-0" />
                              )}
                              {domain.name}
                            </button>

                            {isExpanded(domainKey) &&
                              domain.fields.map((field) => {
                                const fieldKey = `field:${field.id}`;
                                const ids = field.competencies.map((c) => c.id);
                                const selectedHere = ids.filter((id) =>
                                  selectedSet.has(id),
                                ).length;
                                return (
                                  <div key={field.id} className="pl-4">
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => toggleNode(fieldKey)}
                                        className="flex flex-1 cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-left text-xs font-medium hover:bg-muted"
                                      >
                                        {isExpanded(fieldKey) ? (
                                          <ChevronDown className="h-3 w-3 shrink-0" />
                                        ) : (
                                          <ChevronRight className="h-3 w-3 shrink-0" />
                                        )}
                                        {field.name}
                                      </button>
                                      <button
                                        type="button"
                                        title="Tout cocher / tout décocher"
                                        onClick={() => toggleField(ids)}
                                        className="shrink-0 cursor-pointer p-1"
                                      >
                                        <CheckBox
                                          state={
                                            selectedHere === ids.length
                                              ? "on"
                                              : selectedHere > 0
                                                ? "partial"
                                                : "off"
                                          }
                                        />
                                      </button>
                                    </div>

                                    {isExpanded(fieldKey) &&
                                      field.competencies.map((competency) => {
                                        const isSelected = selectedSet.has(
                                          competency.id,
                                        );
                                        return (
                                          <button
                                            key={competency.id}
                                            type="button"
                                            onClick={() =>
                                              toggleCompetency(competency.id)
                                            }
                                            className={cn(
                                              "flex w-full cursor-pointer items-center gap-2 rounded py-1 pl-8 pr-2 text-left text-xs",
                                              isSelected
                                                ? "bg-primary/10 font-medium text-primary"
                                                : "text-muted-foreground hover:bg-muted",
                                            )}
                                          >
                                            <CheckBox
                                              state={isSelected ? "on" : "off"}
                                            />
                                            <span className="flex-1">
                                              {competency.name}
                                            </span>
                                            {competency.archived && (
                                              <span className="shrink-0 text-[10px] italic text-muted-foreground">
                                                archivée
                                              </span>
                                            )}
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
              })
            )}
          </div>
        </ScrollArea>
      </DataState>
    </div>
  );
}
