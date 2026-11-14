import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Ban, Building2, CalendarDays } from "lucide-react";

import { ChampDAjout, LigneDArbre } from "@/components/ArbreReferentiel";
import type { StyleDeNiveau } from "@/components/ArbreReferentiel";
import { CompetencyPicker } from "@/components/CompetencyPicker";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DataState } from "@/components/DataState";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { plural, reorderIds } from "@/lib/referentiel";
import type { Establishment } from "@/types";

function messageOf(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Une erreur inattendue est survenue.";
}

/** Un établissement n'a qu'un niveau : pas de filet d'indentation, et le nom en
 *  demi-gras comme un nœud de tête de référentiel. */
const STYLE_ETABLISSEMENT: StyleDeNiveau = {
  icon: Building2,
  accent: "border-l-border",
  text: "font-medium",
};

/** Ce que la ligne dit d'elle-même : combien de classes, combien de
 *  compétences écartées. Les deux comptes sont le prix d'une suppression et
 *  l'effet d'un réglage — ils doivent être lisibles sans ouvrir quoi que ce
 *  soit, exactement comme `activity_count` sur un domaine de progression. */
function metaDeLEtablissement(etablissement: Establishment): string {
  const classes =
    etablissement.session_count === 0
      ? "aucune classe"
      : plural(etablissement.session_count, "classe", "classes");
  const ecartees =
    etablissement.disabled_count === 0
      ? "aucune compétence écartée"
      : plural(
          etablissement.disabled_count,
          "compétence écartée",
          "compétences écartées",
        );
  const academie =
    etablissement.academie === ""
      ? "académie non renseignée"
      : `académie ${etablissement.academie}`;
  return `${classes} · ${ecartees} · ${academie}${
    etablissement.is_principal ? " · établissement principal" : ""
  }`;
}

interface DialogueDuCalendrierProps {
  etablissement: Establishment;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void>;
}

/**
 * L'académie d'un établissement, et s'il fixe le calendrier — palier 028.
 *
 * **Le calendrier de l'application est unique** : une colonne de jour fermée
 * l'est pour toutes les classes, donc UN établissement — le principal — décide
 * des vacances affichées. L'écran le dit en toutes lettres : sans cela, régler
 * l'académie d'un second établissement semblerait ne rien faire.
 *
 * Les académies sont lues en base (`getAvailableAcademies`), jamais recopiées :
 * une académie sans dates serait un réglage qui a l'air de marcher et ne fait
 * rien. Brouillon local : `key={etablissement.id}` chez l'appelant.
 */
function DialogueDuCalendrier({
  etablissement,
  onOpenChange,
  onChanged,
}: DialogueDuCalendrierProps): ReactElement {
  const [academie, setAcademie] = useState(etablissement.academie);
  const [principal, setPrincipal] = useState(etablissement.is_principal);
  const [academies, setAcademies] = useState<string[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);

  useEffect(() => {
    api
      .getAvailableAcademies()
      .then(setAcademies)
      // Le calendrier est une couche d'affichage : son absence ne doit pas
      // empêcher d'ouvrir la fenêtre. La valeur enregistrée reste affichée.
      .catch(() => setAcademies([]));
  }, []);

  const enregistrer = async () => {
    setEnregistrement(true);
    setErreur(null);
    try {
      await api.updateEstablishmentCalendar(
        etablissement.id,
        academie,
        principal,
      );
      await onChanged();
      onOpenChange(false);
    } catch (err) {
      setErreur(messageOf(err));
    } finally {
      setEnregistrement(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Académie — {etablissement.name}</DialogTitle>
          <DialogDescription>
            L'académie détermine les dates de vacances scolaires affichées par
            l'emploi du temps. Les jours fériés, eux, sont calculés et n'en
            dépendent pas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="academie-etablissement">Académie</Label>
            <Select
              value={academie === "" ? "aucune" : academie}
              onValueChange={(valeur) =>
                setAcademie(valeur === "aucune" ? "" : valeur)
              }
            >
              <SelectTrigger id="academie-etablissement">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aucune">Non renseignée</SelectItem>
                {academies.map((nom) => (
                  <SelectItem key={nom} value={nom}>
                    {nom}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {academies.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {academies.length} académies disponibles dans le calendrier
                embarqué.
              </p>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={principal}
              onChange={(e) => setPrincipal(e.target.checked)}
            />
            <span>
              <span className="font-medium">
                Établissement principal
              </span>
              <span className="block text-muted-foreground">
                Le calendrier de l'emploi du temps est unique. Il suit
                l'académie des classes de l'année ; si elles relèvent de
                plusieurs académies, c'est celle de l'établissement principal
                qui décide. Cocher cette case le retire à l'établissement qui
                l'était. Sans classe rattachée, SGPA reprend l'académie des
                Réglages d'avant ce changement.
              </span>
            </span>
          </label>

          {erreur && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {erreur}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={enregistrement}
          >
            Annuler
          </Button>
          <Button onClick={() => void enregistrer()} disabled={enregistrement}>
            {enregistrement ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DialogueDesCompetencesProps {
  etablissement: Establishment;
  onOpenChange: (open: boolean) => void;
  /** Recharge la liste du parent : les deux compteurs de la ligne changent. */
  onChanged: () => Promise<void>;
}

/**
 * « Quelles compétences cet établissement n'emploie-t-il pas ? »
 *
 * ⚠ **Le sens des coches est inversé par rapport à partout ailleurs**, et c'est
 * le seul écran où il l'est : dans une évaluation ou dans une étape, une coche
 * veut dire « je m'en sers » ; ici elle veut dire « ne me la propose plus ».
 * L'ambiguïté se paierait cher — un enseignant qui comprend l'inverse écarte
 * exactement la moitié du référentiel qu'il voulait garder —, donc elle est
 * levée trois fois : par le titre, par la phrase au-dessus du sélecteur, et par
 * le compte réécrit en mots français sous le mot « sélectionnées » que
 * `CompetencyPicker` emploie, lui, sans le savoir.
 *
 * Le sélecteur est appelé **sans `sessionId`** : il faut voir le référentiel
 * entier pour pouvoir en écarter n'importe quelle part. Lui passer une classe
 * aurait caché ce qu'on vient précisément régler.
 */
function DialogueDesCompetences({
  etablissement,
  onOpenChange,
  onChanged,
}: DialogueDesCompetencesProps): ReactElement {
  const [brouillon, setBrouillon] = useState<string[] | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      setBrouillon(
        await api.getEstablishmentDisabledCompetencies(etablissement.id),
      );
    } catch (err) {
      setErreur(messageOf(err));
    } finally {
      setChargement(false);
    }
  }, [etablissement.id]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const enregistrer = async () => {
    if (brouillon === null) return;
    setEnregistrement(true);
    setErreur(null);
    try {
      await api.setEstablishmentDisabledCompetencies(
        etablissement.id,
        brouillon,
      );
      await onChanged();
      onOpenChange(false);
    } catch (err) {
      setErreur(messageOf(err));
    } finally {
      setEnregistrement(false);
    }
  };

  const compte = brouillon?.length ?? 0;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Compétences à ne pas proposer — {etablissement.name}
          </DialogTitle>
          <DialogDescription>
            Cochez ici les compétences que cet établissement{" "}
            <span className="font-medium">n'emploie pas</span>. Elles cesseront
            d'être proposées quand vous composerez une évaluation ou une étape de
            progression dans une classe rattachée.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            C'est un filtre de saisie, et rien d'autre.{" "}
            <span className="font-medium text-foreground">
              Aucune note n'est supprimée, aucune moyenne ne change, aucun
              document imprimé ne bouge.
            </span>{" "}
            Une compétence écartée mais déjà cochée dans une évaluation ou une
            étape y reste affichée avec ses notes : ce réglage ne fait jamais
            disparaître de l'écran un travail déjà fait.
          </p>

          <DataState
            loading={chargement}
            error={erreur}
            onRetry={() => void charger()}
          >
            {brouillon !== null && (
              <>
                <p className="text-sm">
                  {compte === 0
                    ? "Aucune compétence écartée pour l'instant : tout le référentiel est proposé."
                    : `${plural(compte, "compétence cochée", "compétences cochées")} — elles ne seront plus proposées.`}
                </p>
                <CompetencyPicker
                  selected={brouillon}
                  onChange={setBrouillon}
                />
              </>
            )}
          </DataState>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={enregistrement}
          >
            Annuler
          </Button>
          <Button
            onClick={() => void enregistrer()}
            disabled={enregistrement || brouillon === null}
          >
            {enregistrement ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Les établissements, dans l'écran Réglages — palier 025.
 *
 * Carte à part et non fondue dans `Settings.tsx`, pour la raison même qui a
 * sorti `NeedTagsCard` : elle charge sa propre liste et porte ses propres
 * erreurs, là où tout le reste de l'écran partage un seul formulaire
 * d'`app_settings`. L'y mêler aurait fait dépendre l'enregistrement du nom
 * affiché d'une lecture sans rapport.
 *
 * **Ne pas confondre avec le champ « Établissement » de la carte Identité.**
 * Celui-là est `app_settings.school_name`, le nom imprimé en tête des bilans,
 * et ce palier n'y touche pas : un bilan réimprimé porte le même nom qu'avant,
 * au caractère près. Ceux-ci sont des entités auxquelles on rattache des
 * classes, pour n'y proposer que les compétences qu'on y emploie. Savoir si le
 * premier doit devenir le second sur les documents imprimés appartient à
 * l'auteur, pas au code.
 *
 * **Livrée vide**, comme `professional_fields`, `progression_domaines` et les
 * étiquettes de besoins : personne d'autre que l'enseignant ne connaît le nom
 * de son collège.
 */
export function EtablissementsCard(): ReactElement {
  const [etablissements, setEtablissements] = useState<Establishment[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [erreurDAction, setErreurDAction] = useState<string | null>(null);

  // Deux cibles, deux identifiants et non deux entités : la ligne est dérivée
  // de la liste, donc un rechargement la rafraîchit (première règle
  // d'architecture). Un établissement figé aurait gardé ses compteurs d'avant.
  const [reglageId, setReglageId] = useState<string | null>(null);
  const [calendrierId, setCalendrierId] = useState<string | null>(null);
  const [suppressionId, setSuppressionId] = useState<string | null>(null);

  const charger = useCallback(async () => {
    setErreur(null);
    try {
      setEtablissements(await api.getEstablishments());
    } catch (err) {
      setErreur(messageOf(err));
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  const reglage =
    etablissements.find((etab) => etab.id === reglageId) ?? null;
  const calendrier =
    etablissements.find((etab) => etab.id === calendrierId) ?? null;
  const suppression =
    etablissements.find((etab) => etab.id === suppressionId) ?? null;

  const agir = async (action: () => Promise<unknown>) => {
    setErreurDAction(null);
    try {
      await action();
      await charger();
    } catch (err) {
      setErreurDAction(messageOf(err));
    }
  };

  const deplacer = (id: string, direction: -1 | 1) => {
    // `reorderIds` rend l'ordre COMPLET du niveau : aucun établissement n'est
    // caché ici, mais la fonction est celle des référentiels et la liste
    // complète est ce que `reorder_establishments` attend.
    const ordre = reorderIds(etablissements, etablissements, id, direction);
    if (ordre === null) return;
    void agir(() => api.reorderEstablishments(ordre));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          Établissements
        </CardTitle>
        <CardDescription>
          Vos établissements, pour chacun son académie — donc les vacances
          affichées — et les compétences qu'on n'y emploie pas. Vous rattachez ensuite une classe à l'un d'eux depuis l'écran
          Classes, et la saisie d'une évaluation ou d'une étape de progression
          ne proposera plus, dans cette classe, les compétences écartées. SGPA
          n'en propose aucun d'avance : les noms justes sont ceux de vos
          établissements.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          Tant qu'une classe n'est rattachée à rien — ce qui est son état par
          défaut —{" "}
          <span className="font-medium text-foreground">
            rien ne change pour elle
          </span>
          . Et ce réglage ne touche ni les notes, ni les moyennes, ni les
          documents imprimés : le nom d'établissement en tête des bilans reste
          celui de la carte « Identité » des Réglages.
        </p>

        <DataState
          loading={chargement}
          error={erreur}
          onRetry={() => {
            void charger();
          }}
        >
          {etablissements.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun établissement pour l'instant.
            </p>
          ) : (
            <div className="rounded-md border">
              {etablissements.map((etablissement, index) => (
                <LigneDArbre
                  key={etablissement.id}
                  style={STYLE_ETABLISSEMENT}
                  name={etablissement.name}
                  depth={0}
                  meta={metaDeLEtablissement(etablissement)}
                  metaSousLeNom
                  canMoveUp={index > 0}
                  canMoveDown={index < etablissements.length - 1}
                  onMove={(direction) => deplacer(etablissement.id, direction)}
                  onRename={(nom) =>
                    void agir(() =>
                      api.renameEstablishment(etablissement.id, nom),
                    )
                  }
                  onDelete={() => {
                    setErreurDAction(null);
                    setSuppressionId(etablissement.id);
                  }}
                  actions={
                    <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 px-2 text-xs"
                      title={`Académie et calendrier de ${etablissement.name}`}
                      onClick={() => {
                        setErreurDAction(null);
                        setCalendrierId(etablissement.id);
                      }}
                    >
                      <CalendarDays className="h-3.5 w-3.5" />
                      Académie
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 px-2 text-xs"
                      title={`Compétences non employées à ${etablissement.name}`}
                      onClick={() => {
                        setErreurDAction(null);
                        setReglageId(etablissement.id);
                      }}
                    >
                      <Ban className="h-3.5 w-3.5" />
                      Compétences
                    </Button>
                    </>
                  }
                />
              ))}
            </div>
          )}

          <ChampDAjout
            libelle="Ajouter un établissement"
            onAjouter={async (noms) => {
              const resultat = await api.createEstablishmentsBulk(noms);
              await charger();
              return resultat;
            }}
          />
        </DataState>

        {erreurDAction && (
          <p className="whitespace-pre-line rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {erreurDAction}
          </p>
        )}
      </CardContent>

      {calendrier && (
        <DialogueDuCalendrier
          key={calendrier.id}
          etablissement={calendrier}
          onOpenChange={(open) => {
            if (!open) setCalendrierId(null);
          }}
          onChanged={charger}
        />
      )}

      {reglage && (
        <DialogueDesCompetences
          // Le dialogue tient un brouillon : sans cette clé, passer d'un
          // établissement à l'autre réutiliserait l'instance et l'on
          // enregistrerait les compétences du premier sous l'identifiant du
          // second (deuxième règle d'architecture).
          key={reglage.id}
          etablissement={reglage}
          onOpenChange={(open) => {
            if (!open) setReglageId(null);
          }}
          onChanged={charger}
        />
      )}

      <ConfirmDialog
        open={suppression !== null}
        onOpenChange={(open) => {
          if (!open) setSuppressionId(null);
        }}
        title="Supprimer l'établissement"
        description={
          <>
            <p>
              « {suppression?.name} » disparaîtra, avec les{" "}
              {suppression?.disabled_count ?? 0} compétence
              {(suppression?.disabled_count ?? 0) > 1 ? "s" : ""} qu'il
              écartait.
            </p>
            <p>
              {suppression && suppression.session_count > 0
                ? `Ses ${suppression.session_count} classe${suppression.session_count > 1 ? "s" : ""} ${suppression.session_count > 1 ? "reviennent" : "revient"} à « aucun établissement » : tout le référentiel y sera de nouveau proposé. Aucune note, aucune moyenne, aucun document imprimé ne change — c'est l'état qu'${suppression.session_count > 1 ? "elles avaient" : "elle avait"} avant que vous ne créiez cet établissement.`
                : "Aucune classe n'y est rattachée."}
            </p>
            <p>
              Si le nom est seulement à corriger, renommez-le plutôt — le
              renommage conserve les classes et les compétences écartées.
            </p>
          </>
        }
        onConfirm={async () => {
          if (!suppression) return;
          await api.deleteEstablishment(suppression.id);
          setSuppressionId(null);
          await charger();
        }}
      />
    </Card>
  );
}
