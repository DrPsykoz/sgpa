import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Briefcase,
  FolderOpen,
  HardHat,
  Wrench,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import type {
  BulkResult,
  Ra16Domain,
  Ra16Field,
  Ra16Item,
  Ra16Kind,
} from "@/types";
import { RA16_LABELS } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataState } from "@/components/DataState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  ChampDAjout,
  LigneDArbre,
  type StyleDeNiveau,
} from "@/components/ArbreReferentiel";
import { plural, reorderIds } from "@/lib/referentiel";

/**
 * Le référentiel des activités professionnelles (RA16), réglable.
 *
 * **Pourquoi un écran.** Le palier 024 a semé le champ Habitat — trois
 * domaines, trente-quatre activités de référence, vingt-et-un métiers — et
 * l'a branché sur les trois menus de la fiche contrat. Mais rien ne permettait
 * de le **lire** ni de le **corriger** : l'enseignant l'a signalé le
 * 2026-11-12, « je n'ai pas d'écran pour voir le RA16 ». Le semis n'est pas
 * sacré — c'est un document national recopié à la main, donc il peut porter
 * une faute, et le champ d'un autre établissement n'y est pas du tout.
 *
 * **Les champs professionnels s'affichent sans se modifier.** Ce n'est pas un
 * oubli : leur liste est l'une des décisions réservées à l'auteur, parce
 * qu'une fiche contrat garde le **libellé figé** du champ qu'elle cite —
 * renommer un champ se verrait sur des documents déjà remis. Ils sont donc
 * des en-têtes, et les quatre champs sans référentiel paraissent quand même :
 * un champ vide n'est pas une panne, c'est l'endroit où commencer.
 *
 * **La suppression ne se refuse jamais**, et c'est l'inverse du référentiel de
 * compétences voisin. Une compétence qui porte des notes est refusée puis
 * archivée : ses notes sont des faits. Une entrée du RA16 citée par une fiche
 * contrat est en `ON DELETE SET NULL` à côté d'un libellé figé — la fiche
 * garde ce qu'elle imprime et perd seulement le lien. Rien d'imprimé ne
 * change, donc il n'y a rien à refuser ; il reste à le **dire**, et c'est
 * pourquoi chaque ligne annonce ses citations avant qu'on clique.
 */

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Les trois niveaux modifiables. Aucun filet coloré : le trait n'est ici que
 *  le guide d'indentation de l'arbre, et une couleur ne dirait rien de plus
 *  que l'icône. */
const STYLES: Record<Ra16Kind, StyleDeNiveau> = {
  domain: {
    icon: FolderOpen,
    accent: "border-l-border",
    text: "text-sm font-semibold",
  },
  activity: { icon: Wrench, accent: "border-l-border", text: "text-sm" },
  career: { icon: HardHat, accent: "border-l-border", text: "text-sm" },
};

/**
 * Les mots de chaque niveau, accordés.
 *
 * Même rôle que `article()` et `demonstratif()` dans
 * `commands/activities.rs`, et pour la même raison : l'interface est
 * intégralement en français, donc « Supprimer ce activité de référence ? » est
 * un défaut, pas une approximation. Un `Record` et non une fonction — il n'y a
 * que trois niveaux, et les lire côte à côte est ce qui fait voir un accord
 * oublié.
 */
const MOTS: Record<
  Ra16Kind,
  { titreSuppression: string; ajouter: string; supprime: string; cite: string }
> = {
  domain: {
    titreSuppression: "Supprimer ce domaine d'activité ?",
    ajouter: "Ajouter un domaine d'activité",
    supprime: "supprimé",
    cite: "cité",
  },
  activity: {
    titreSuppression: "Supprimer cette activité de référence ?",
    ajouter: "Ajouter une activité de référence",
    supprime: "supprimée",
    cite: "citée",
  },
  career: {
    titreSuppression: "Supprimer ce métier ?",
    ajouter: "Ajouter un métier",
    supprime: "supprimé",
    cite: "cité",
  },
};

/** « citée par 2 fiches ». Rend `undefined` quand il n'y a rien à dire : une
 *  ligne sans citation ne porte pas « 0 fiche », qui ferait du bruit sur les
 *  cinquante-cinq entrées du semis. */
function motsDeCitations(n: number, cite: string): string | undefined {
  return n === 0 ? undefined : `${cite} par ${plural(n, "fiche", "fiches")}`;
}

/** Toutes les citations qu'une suppression de domaine ferait tomber. On compte
 *  des **citations** et non des fiches : une même fiche peut citer le domaine
 *  ET une de ses activités, donc annoncer un nombre de fiches mentirait d'un
 *  cran. */
function citationsDuDomaine(domain: Ra16Domain): number {
  return (
    domain.sheet_count +
    domain.activities.reduce((t, a) => t + a.sheet_count, 0) +
    domain.careers.reduce((t, c) => t + c.sheet_count, 0)
  );
}

interface CibleRa16 {
  kind: Ra16Kind;
  id: string;
  name: string;
  /** Ce que la suppression emporte avec elle, déjà rédigé. Calculé au clic à
   *  partir de l'arbre affiché : le dialogue n'a pas à le retrouver. */
  cascade?: string;
  citations: number;
}

interface ActionsRa16 {
  replies: Set<string>;
  plier: (cle: string) => void;
  onRenommer: (kind: Ra16Kind, id: string, name: string) => void;
  onSupprimer: (cible: CibleRa16) => void;
  onDeplacer: (kind: Ra16Kind, parentId: string, orderedIds: string[]) => void;
  onAjouter: (
    kind: Ra16Kind,
    parentId: string,
    names: string[],
  ) => Promise<BulkResult>;
}

// ---------------------------------------------------------------------------
// Une liste sœur : les activités de référence, ou les métiers
// ---------------------------------------------------------------------------

/** Les deux listes d'un domaine, **côte à côte et non imbriquées** : un métier
 *  n'appartient pas à une activité de référence, les deux pendent du domaine.
 *  C'est aussi pourquoi le backend lit l'arbre en quatre requêtes et regroupe
 *  en Rust — une jointure aurait multiplié les douze activités par les huit
 *  métiers. */
function ListeSoeur({
  kind,
  items,
  parentId,
  actions,
}: {
  kind: "activity" | "career";
  items: Ra16Item[];
  parentId: string;
  actions: ActionsRa16;
}) {
  return (
    <div className="ml-3 border-l-2 border-l-border pl-3 pt-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {RA16_LABELS[kind].many}
        <span className="ml-1 font-normal normal-case tracking-normal">
          ({items.length})
        </span>
      </p>

      {items.map((item, index) => (
        <LigneDArbre
          key={item.id}
          style={STYLES[kind]}
          name={item.name}
          depth={0}
          meta={motsDeCitations(item.sheet_count, MOTS[kind].cite)}
          canMoveUp={index > 0}
          canMoveDown={index < items.length - 1}
          onMove={(direction) => {
            const ordered = reorderIds(items, items, item.id, direction);
            if (ordered) actions.onDeplacer(kind, parentId, ordered);
          }}
          onRename={(name) => actions.onRenommer(kind, item.id, name)}
          onDelete={() =>
            actions.onSupprimer({
              kind,
              id: item.id,
              name: item.name,
              citations: item.sheet_count,
            })
          }
        />
      ))}

      <ChampDAjout
        libelle={MOTS[kind].ajouter}
        onAjouter={(noms) => actions.onAjouter(kind, parentId, noms)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Un domaine d'activité
// ---------------------------------------------------------------------------

function DomaineBlock({
  domain,
  all,
  fieldId,
  actions,
}: {
  domain: Ra16Domain;
  all: Ra16Domain[];
  fieldId: string;
  actions: ActionsRa16;
}) {
  const cle = `ra16-domain:${domain.id}`;
  const ouvert = !actions.replies.has(cle);
  const index = all.findIndex((d) => d.id === domain.id);
  const citations = citationsDuDomaine(domain);

  return (
    <LigneDArbre
      style={STYLES.domain}
      name={domain.name}
      depth={1}
      collapsible
      expanded={ouvert}
      onToggle={() => actions.plier(cle)}
      meta={[
        plural(domain.activities.length, "activité", "activités"),
        plural(domain.careers.length, "métier", "métiers"),
        motsDeCitations(citations, MOTS.domain.cite),
      ]
        .filter(Boolean)
        .join(" · ")}
      canMoveUp={index > 0}
      canMoveDown={index < all.length - 1}
      onMove={(direction) => {
        const ordered = reorderIds(all, all, domain.id, direction);
        if (ordered) actions.onDeplacer("domain", fieldId, ordered);
      }}
      onRename={(name) => actions.onRenommer("domain", domain.id, name)}
      onDelete={() =>
        actions.onSupprimer({
          kind: "domain",
          id: domain.id,
          name: domain.name,
          cascade: `${plural(
            domain.activities.length,
            "activité de référence",
            "activités de référence",
          )} et ${plural(domain.careers.length, "métier", "métiers")}`,
          citations,
        })
      }
    >
      <ListeSoeur
        kind="activity"
        items={domain.activities}
        parentId={domain.id}
        actions={actions}
      />
      <ListeSoeur
        kind="career"
        items={domain.careers}
        parentId={domain.id}
        actions={actions}
      />
    </LigneDArbre>
  );
}

// ---------------------------------------------------------------------------
// Un champ professionnel — en-tête, sans geste d'écriture
// ---------------------------------------------------------------------------

function ChampBlock({
  field,
  actions,
}: {
  field: Ra16Field;
  actions: ActionsRa16;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Briefcase className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate text-base font-semibold">
            {field.name}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {plural(
              field.domains.length,
              "domaine d'activité",
              "domaines d'activité",
            )}
          </span>
        </div>

        {field.domains.length === 0 && (
          <p className="ml-3 border-l-2 border-l-border py-2 pl-3 text-xs text-muted-foreground">
            Aucun domaine d'activité pour ce champ. Seul le champ Habitat est
            livré avec son référentiel ; ajoutez ici les domaines du vôtre, et
            les trois menus de la fiche contrat s'en serviront aussitôt.
          </p>
        )}

        {field.domains.map((domain) => (
          <DomaineBlock
            key={domain.id}
            domain={domain}
            all={field.domains}
            fieldId={field.id}
            actions={actions}
          />
        ))}

        <ChampDAjout
          libelle={MOTS.domain.ajouter}
          onAjouter={(noms) => actions.onAjouter("domain", field.id, noms)}
          className="ml-7"
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Le panneau
// ---------------------------------------------------------------------------

export function ReferentielActivites() {
  const [fields, setFields] = useState<Ra16Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [replies, setReplies] = useState<Set<string>>(new Set());
  const [cible, setCible] = useState<CibleRa16 | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFields(await api.getActivityReferentialTree());
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
      setFields(await api.getActivityReferentialTree());
    } catch (err) {
      setActionError(messageOf(err));
    }
  }, []);

  const onAjouter = useCallback(
    async (kind: Ra16Kind, parentId: string, names: string[]) => {
      setActionError(null);
      const result = await api.createActivityNodesBulk(kind, parentId, names);
      setFields(await api.getActivityReferentialTree());
      return result;
    },
    [],
  );

  const plier = useCallback((cle: string) => {
    setReplies((prev) => {
      const next = new Set(prev);
      if (next.has(cle)) next.delete(cle);
      else next.add(cle);
      return next;
    });
  }, []);

  const actions = useMemo<ActionsRa16>(
    () => ({
      replies,
      plier,
      onRenommer: (kind, id, name) =>
        void run(() => api.renameActivityNode(kind, id, name)),
      onSupprimer: setCible,
      onDeplacer: (kind, parentId, orderedIds) =>
        void run(() => api.reorderActivityNodes(kind, parentId, orderedIds)),
      onAjouter,
    }),
    [replies, plier, run, onAjouter],
  );

  const toutesLesCles = useMemo(
    () =>
      fields.flatMap((field) =>
        field.domains.map((domain) => `ra16-domain:${domain.id}`),
      ),
    [fields],
  );

  const total = useMemo(
    () =>
      fields.reduce(
        (t, field) =>
          t +
          field.domains.reduce(
            (parChamp, domain) =>
              parChamp + domain.activities.length + domain.careers.length,
            0,
          ),
        0,
      ),
    [fields],
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Champ professionnel → Domaine d'activité → Activités de référence et
          métiers. C'est ce référentiel que les trois menus de la fiche contrat
          proposent. Les <strong>champs</strong> ne se modifient pas ici : une
          fiche déjà remise garde le libellé du champ qu'elle cite.
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReplies(new Set(toutesLesCles))}
            disabled={toutesLesCles.length === 0}
          >
            Tout replier
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReplies(new Set())}
            disabled={toutesLesCles.length === 0}
          >
            Tout déplier
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
          {fields.map((field) => (
            <ChampBlock key={field.id} field={field} actions={actions} />
          ))}
          <p className="px-1 text-xs text-muted-foreground">
            {plural(total, "entrée", "entrées")} sous{" "}
            {plural(
              fields.length,
              "champ professionnel",
              "champs professionnels",
            )}
            . Collez une liste dans un champ d'ajout pour créer toute une
            colonne d'un coup.
          </p>
        </div>
      </DataState>

      <ConfirmDialog
        open={cible !== null}
        onOpenChange={(open) => {
          if (!open) setCible(null);
        }}
        title={cible ? MOTS[cible.kind].titreSuppression : ""}
        description={
          cible && (
            <>
              <p>
                « {cible.name} » sera {MOTS[cible.kind].supprime} définitivement
                {cible.cascade ? `, ainsi que ses ${cible.cascade}` : ""}.
              </p>
              {cible.citations > 0 ? (
                <p>
                  {cible.citations === 1
                    ? "Une fiche contrat le cite"
                    : `${cible.citations} citations dans des fiches contrat`}{" "}
                  : elles <strong>gardent le libellé déjà imprimé</strong> et
                  perdent seulement le lien vers le référentiel. Rien de ce qui
                  a été remis à un élève ne change.
                </p>
              ) : (
                <p>Aucune fiche contrat ne le cite.</p>
              )}
            </>
          )
        }
        onConfirm={async () => {
          if (!cible) return;
          const { kind, id } = cible;
          setCible(null);
          await api.deleteActivityNode(kind, id);
          setFields(await api.getActivityReferentialTree());
        }}
      />
    </div>
  );
}
