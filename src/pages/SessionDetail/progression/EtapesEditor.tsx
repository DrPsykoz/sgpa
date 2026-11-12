import { useMemo, useState, type ReactElement } from "react";
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { ActiviteDialog } from "@/pages/SessionDetail/progression/ActiviteDialog";
import { EtapeDialog } from "@/pages/SessionDetail/progression/EtapeDialog";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { styleTeinteActivite } from "@/lib/teintes";
import { MOTS_DE_NATURE } from "@/types";
import type {
  CompetencyInfo,
  NatureDActivite,
  Progression,
  ProgressionActivite,
  ProgressionEtape,
} from "@/types";

export interface EtapesEditorProps {
  progression: Progression;
  /** Combien de semaines portent cette activité, par identifiant d'activité. */
  semainesParActivite: ReadonlyMap<string, number>;
  /** Le parent recharge la progression entière après chaque écriture. */
  onChanged: () => Promise<void>;
}

function messageOf(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Une erreur inattendue est survenue.";
}

/** Les compétences d'une ligne, **comptées et non listées**.
 *
 *  La ligne tient sur deux ou trois lignes de texte dans une liste qui peut en
 *  compter trente : huit phrases entières y feraient perdre la lecture de
 *  l'année, qui est ce que cet écran sert. Le détail est dans le formulaire,
 *  et en entier sur le document imprimé — c'est lui qu'on relit compétence par
 *  compétence. Rend `""` à zéro, donc rien à tester chez l'appelant. */
function phraseCompetences(count: number): string {
  if (count === 0) return "";
  return ` · ${count} compétence${count > 1 ? "s" : ""}`;
}

function phraseSemaines(count: number): string {
  if (count === 0) return "Posée sur aucune semaine";
  return count > 1 ? `${count} semaines` : "1 semaine";
}

/** Déplace un élément d'un cran dans une liste d'identifiants, et rend la
 *  nouvelle liste. Rend `null` si le cran sort de la liste — le bouton est alors
 *  désactivé, et ce `null` n'est qu'une ceinture. */
function deplacer(ids: string[], index: number, pas: -1 | 1): string[] | null {
  const cible = index + pas;
  if (cible < 0 || cible >= ids.length) return null;
  const suivant = [...ids];
  [suivant[index], suivant[cible]] = [suivant[cible], suivant[index]];
  return suivant;
}

/** Les compétences cochées dans le référentiel, dans l'ordre du référentiel.
 *
 *  Une liste de phrases et non des pastilles : ce sont des phrases entières, et
 *  huit rectangles colorés auraient fait une mosaïque — la pastille de
 *  catégorie reste le seul aplat de couleur de l'application. Le champ est écrit
 *  en petit à côté, parce qu'une compétence lue hors de l'arbre ne dit pas d'où
 *  elle vient ; « archivée » aussi, sinon une compétence retirée du référentiel
 *  resterait dans le plan sans qu'on sache pourquoi elle a disparu du
 *  sélecteur. */
function CompetencesCochees({
  competences,
}: {
  competences: CompetencyInfo[];
}): ReactElement | null {
  if (competences.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Compétences
      </p>
      <ul className="space-y-0.5 text-sm">
        {competences.map((competence) => (
          <li
            key={competence.id}
            className="flex flex-wrap items-baseline gap-x-2"
          >
            <span>{competence.name}</span>
            <span className="text-xs text-muted-foreground">
              {competence.field_name}
              {competence.archived && " · archivée"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Un bloc de texte libre, affiché seulement s'il porte quelque chose. */
function Champ({
  titre,
  valeur,
}: {
  titre: string;
  valeur: string;
}): ReactElement | null {
  if (valeur.trim() === "") return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {titre}
      </p>
      <p className="whitespace-pre-line text-sm">{valeur}</p>
    </div>
  );
}

/**
 * Les étapes de l'année et leurs activités : le seul endroit où elles s'écrivent.
 *
 * **Il vient avant la frise dans la page, et non après** : une frise se peint
 * avec des activités qui existent déjà, donc on définit, puis on place. C'est la
 * même séparation que « l'emploi du temps définit, l'accueil ouvre ». Sur le
 * papier l'ordre s'inverse — la frise ouvre le document — parce qu'on y lit
 * l'année finie, et non en train de se faire.
 *
 * L'ordre des étapes, puis celui des activités dans chacune, **est** le rang qui
 * donne sa couleur à chaque activité : les flèches ne rangent donc pas une liste,
 * elles recolorient la frise. Chaque réordonnancement est suivi d'un
 * rechargement complet, et jamais d'un réarrangement local — la couleur est
 * calculée en Rust, et deux parcours de la même liste finiraient par différer.
 */
export function EtapesEditor({
  progression,
  semainesParActivite,
  onChanged,
}: EtapesEditorProps): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Aucun dialogue ne détient l'entité : on garde l'identifiant et on la dérive
  // de la progression (règle 1), pour qu'un rechargement la rafraîchisse.
  const [etapeDialogOpen, setEtapeDialogOpen] = useState(false);
  const [etapeEnCours, setEtapeEnCours] = useState<string | null>(null);
  const [etapeASupprimer, setEtapeASupprimer] = useState<string | null>(null);

  const [activiteDialogOpen, setActiviteDialogOpen] = useState(false);
  const [activiteEnCours, setActiviteEnCours] = useState<string | null>(null);
  const [etapeDAccueil, setEtapeDAccueil] = useState("");
  const [activiteASupprimer, setActiviteASupprimer] = useState<string | null>(
    null,
  );

  const etapes = progression.etapes;
  const idsDEtapes = useMemo(() => etapes.map((e) => e.id), [etapes]);

  const toutesLesActivites = useMemo(() => {
    const index = new Map<string, ProgressionActivite>();
    for (const etape of etapes) {
      for (const activite of etape.activites) index.set(activite.id, activite);
    }
    return index;
  }, [etapes]);

  const etapeEditee: ProgressionEtape | null =
    etapes.find((e) => e.id === etapeEnCours) ?? null;
  const etapeSupprimee: ProgressionEtape | null =
    etapes.find((e) => e.id === etapeASupprimer) ?? null;
  const activiteEditee: ProgressionActivite | null =
    (activiteEnCours ? toutesLesActivites.get(activiteEnCours) : null) ?? null;
  const activiteSupprimee: ProgressionActivite | null =
    (activiteASupprimer ? toutesLesActivites.get(activiteASupprimer) : null) ??
    null;


  /** Une écriture, un rechargement complet, une erreur montrée dans la page.
   *  Les dialogues portent eux-mêmes l'erreur de leur propre soumission. */
  const ecrire = async (action: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPending(false);
    }
  };

  const bougerEtape = (index: number, pas: -1 | 1) => {
    const suivant = deplacer(idsDEtapes, index, pas);
    if (suivant === null) return;
    void ecrire(async () => {
      await api.reorderProgressionEtapes(progression.id, suivant);
    });
  };

  const bougerActivite = (etape: ProgressionEtape, index: number, pas: -1 | 1) => {
    const suivant = deplacer(
      etape.activites.map((a) => a.id),
      index,
      pas,
    );
    if (suivant === null) return;
    void ecrire(async () => {
      await api.reorderProgressionActivites(etape.id, suivant);
    });
  };

  /** Création d'une étape : deux commandes, et c'est voulu.
   *  `create_progression_etape` ne prend que l'intitulé — il n'a à connaître ni
   *  les textes ni les compétences —, et le reste du formulaire suit par la
   *  commande qui l'écrit déjà, dans sa transaction. */
  const soumettreEtape = async (champs: {
    libelle: string;
    competences: string;
    connaissances: string;
    priorites: string;
    objectifs: string;
    metierCap: string;
    competencyIds: string[];
  }) => {
    const id =
      etapeEditee?.id ??
      (await api.createProgressionEtape(progression.id, champs.libelle)).id;
    await api.updateProgressionEtape(
      id,
      champs.libelle,
      champs.competences,
      champs.connaissances,
      champs.priorites,
      champs.objectifs,
      champs.metierCap,
      champs.competencyIds,
    );
    await onChanged();
  };

  const soumettreActivite = async (champs: {
    libelle: string;
    domaineId: string | null;
    etapeId: string;
    nature: NatureDActivite;
    objectif: string;
    competencyIds: string[];
  }) => {
    if (activiteEditee === null) {
      await api.createProgressionActivite(
        champs.etapeId,
        champs.libelle,
        champs.domaineId,
        champs.nature,
        champs.objectif,
        champs.competencyIds,
      );
    } else {
      await api.updateProgressionActivite(
        activiteEditee.id,
        champs.libelle,
        champs.domaineId,
        champs.nature,
        champs.objectif,
        champs.competencyIds,
      );
      // Le déplacement est une seconde commande : elle ne touche pas les mêmes
      // colonnes, et c'est elle qui refuse l'étape d'une autre progression.
      if (champs.etapeId !== activiteEditee.etape_id) {
        await api.setProgressionActiviteEtape(activiteEditee.id, champs.etapeId);
      }
    }
    await onChanged();
  };

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      {etapes.length === 0 ? (
        <p className="rounded-lg border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
          Aucune étape pour l'instant. La première décrit ce que la classe
          aborde en premier : ses compétences, prises dans le référentiel, puis
          ses connaissances et ses priorités, avec vos mots.
        </p>
      ) : (
        <ul className="space-y-3">
          {etapes.map((etape, index) => (
            <li key={etape.id} className="rounded-lg border bg-card">
              <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{etape.libelle}</p>
                  <p className="text-xs text-muted-foreground">
                    Étape {index + 1} sur {etapes.length} ·{" "}
                    {etape.activites.length > 1
                      ? `${etape.activites.length} activités`
                      : `${etape.activites.length} activité`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    aria-label={`Monter l'étape « ${etape.libelle} »`}
                    title="Monter — recolorie la frise"
                    disabled={pending || index === 0}
                    onClick={() => bougerEtape(index, -1)}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    aria-label={`Descendre l'étape « ${etape.libelle} »`}
                    title="Descendre — recolorie la frise"
                    disabled={pending || index === etapes.length - 1}
                    onClick={() => bougerEtape(index, 1)}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    aria-label={`Modifier l'étape « ${etape.libelle} »`}
                    title="Modifier l'étape"
                    disabled={pending}
                    onClick={() => {
                      setEtapeEnCours(etape.id);
                      setEtapeDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    aria-label={`Supprimer l'étape « ${etape.libelle} »`}
                    title="Supprimer l'étape"
                    disabled={pending}
                    onClick={() => setEtapeASupprimer(etape.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-4 px-4 py-3">
                <CompetencesCochees competences={etape.competences_ref} />
                {/* Le texte d'avant le palier 021, nommé pour ce qu'il est :
                    sans ce titre il passerait pour une seconde liste de
                    compétences, alors qu'il est la même chose écrite à la main
                    et en voie d'effacement. */}
                <Champ
                  titre="Compétences saisies à la main"
                  valeur={etape.competences}
                />
                <Champ titre="Objectifs" valeur={etape.objectifs} />
                <Champ
                  titre="Métier et CAP découverts"
                  valeur={etape.metier_cap}
                />
                <Champ titre="Connaissances" valeur={etape.connaissances} />
                <Champ titre="Priorités" valeur={etape.priorites} />

                <div className="space-y-2">
                  {etape.activites.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Aucune activité : rien ne peut encore se poser sur la
                      frise pour cette étape.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {etape.activites.map((activite, rangLocal) => {
                        const posees =
                          semainesParActivite.get(activite.id) ?? 0;
                        return (
                          <li
                            key={activite.id}
                            style={styleTeinteActivite(activite.rang)}
                            className={cn(
                              "flex items-center justify-between gap-3 rounded-md border px-3 py-2",
                              "teinte-carte teinte-appui",
                            )}
                          >
                            <div className="min-w-0">
                              {/* La nature est écrite devant l'intitulé, pas
                                  derrière : c'est elle qui dit de quelle sorte
                                  de ligne il s'agit, et le document l'imprime
                                  au même endroit. En clair et non en pastille
                                  — la pastille de catégorie reste le seul aplat
                                  de couleur de l'application. */}
                              <p className="truncate text-sm font-medium">
                                <span className="font-normal opacity-70">
                                  {MOTS_DE_NATURE[activite.nature]} ·{" "}
                                </span>
                                {activite.libelle}
                              </p>
                              <p className="truncate text-xs opacity-80">
                                {phraseSemaines(posees)}
                                {phraseCompetences(
                                  activite.competences_ref.length,
                                )}
                              </p>
                              {activite.objectif.trim() !== "" && (
                                <p className="truncate text-xs opacity-80">
                                  Objectif : {activite.objectif}
                                </p>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                aria-label={`Monter l'activité « ${activite.libelle} »`}
                                title="Monter — recolorie la frise"
                                disabled={pending || rangLocal === 0}
                                onClick={() =>
                                  bougerActivite(etape, rangLocal, -1)
                                }
                              >
                                <ChevronUp className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                aria-label={`Descendre l'activité « ${activite.libelle} »`}
                                title="Descendre — recolorie la frise"
                                disabled={
                                  pending ||
                                  rangLocal === etape.activites.length - 1
                                }
                                onClick={() =>
                                  bougerActivite(etape, rangLocal, 1)
                                }
                              >
                                <ChevronDown className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                aria-label={`Modifier l'activité « ${activite.libelle} »`}
                                title="Modifier l'activité"
                                disabled={pending}
                                onClick={() => {
                                  setActiviteEnCours(activite.id);
                                  setEtapeDAccueil(etape.id);
                                  setActiviteDialogOpen(true);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                aria-label={`Supprimer l'activité « ${activite.libelle} »`}
                                title="Supprimer l'activité"
                                disabled={pending}
                                onClick={() =>
                                  setActiviteASupprimer(activite.id)
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      setActiviteEnCours(null);
                      setEtapeDAccueil(etape.id);
                      setActiviteDialogOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    Ajouter une activité
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Button
        variant="outline"
        disabled={pending}
        onClick={() => {
          setEtapeEnCours(null);
          setEtapeDialogOpen(true);
        }}
      >
        <Plus className="h-4 w-4" />
        Nouvelle étape
      </Button>

      <EtapeDialog
        // Le dialogue tient un brouillon : sans cette clé, passer d'une étape à
        // l'autre réutiliserait l'instance et l'on enregistrerait les
        // compétences de la première sous l'identifiant de la seconde (règle 2).
        key={`etape:${etapeEnCours ?? "nouvelle"}`}
        open={etapeDialogOpen}
        onOpenChange={setEtapeDialogOpen}
        etape={etapeEditee}
        onSubmit={soumettreEtape}
      />

      <ActiviteDialog
        key={`activite:${activiteEnCours ?? `nouvelle:${etapeDAccueil}`}`}
        open={activiteDialogOpen}
        onOpenChange={setActiviteDialogOpen}
        activite={activiteEditee}
        etapeParDefaut={etapeDAccueil}
        etapes={etapes}
        sessionId={progression.session_id}
        onSubmit={soumettreActivite}
      />

      <ConfirmDialog
        open={etapeSupprimee !== null}
        onOpenChange={(open) => {
          if (!open) setEtapeASupprimer(null);
        }}
        title="Supprimer cette étape ?"
        description={
          etapeSupprimee && (
            <>
              <p>« {etapeSupprimee.libelle} »</p>
              <p>
                {etapeSupprimee.activites.length === 0
                  ? "Elle ne porte aucune activité."
                  : etapeSupprimee.activites.length > 1
                    ? `Ses ${etapeSupprimee.activites.length} activités partent avec elle, et les semaines où elles sont posées se vident.`
                    : "Son activité part avec elle, et les semaines où elle est posée se vident."}
              </p>
              <p>
                Aucune séance, aucun appel et aucun bilan n'est touché : la
                progression est un plan, pas un enregistrement.
              </p>
            </>
          )
        }
        onConfirm={async () => {
          if (etapeSupprimee === null) return;
          await api.deleteProgressionEtape(etapeSupprimee.id);
          await onChanged();
        }}
      />

      <ConfirmDialog
        open={activiteSupprimee !== null}
        onOpenChange={(open) => {
          if (!open) setActiviteASupprimer(null);
        }}
        title="Supprimer cette activité ?"
        description={
          activiteSupprimee && (
            <>
              <p>« {activiteSupprimee.libelle} »</p>
              <p>
                {(semainesParActivite.get(activiteSupprimee.id) ?? 0) === 0
                  ? "Elle n'est posée sur aucune semaine."
                  : `Les ${semainesParActivite.get(activiteSupprimee.id)} semaines où elle est posée se videront.`}
              </p>
              <p>
                Les activités suivantes changeront de couleur : la couleur vient
                du rang dans l'année, et ce rang se resserre.
              </p>
            </>
          )
        }
        onConfirm={async () => {
          if (activiteSupprimee === null) return;
          await api.deleteProgressionActivite(activiteSupprimee.id);
          await onChanged();
        }}
      />
    </div>
  );
}
