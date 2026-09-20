import { useState, type ReactElement } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AgendaEntryDialog } from "@/pages/Timetable/AgendaEntryDialog";
import { OneOffSeanceDialog } from "@/pages/Timetable/OneOffSeanceDialog";
import { SlotDialog } from "@/pages/Timetable/SlotDialog";
import type {
  AgendaEntry,
  Seance,
  Session,
  TimetableSlot,
  TimetableSlotInput,
} from "@/types";

/**
 * Les six formes proposées.
 *
 * Le type ne vit **que le temps du clic** : aucune colonne ne le stocke, ni sur
 * `timetable_slots`, ni sur `agenda_entries`, ni sur `seances`. Il n'aiguille
 * que le formulaire. Conséquence assumée : rouvrir une ligne n'affichera jamais
 * « Réunion parents-professeurs » — seul l'intitulé le dit.
 */
export type TypePlanning =
  | "cours"
  | "occupation"
  | "visite"
  | "parents"
  | "rendezvous"
  | "ponctuel";

interface Choix {
  type: TypePlanning;
  titre: string;
  detail: string;
}

/** Hebdomadaires : ils entrent dans la grille et n'engendrent aucune séance. */
const CHAQUE_SEMAINE: Choix[] = [
  {
    type: "cours",
    titre: "Cours",
    detail: "une classe, un intitulé — chaque semaine",
  },
  {
    type: "occupation",
    titre: "Réunion ou occupation",
    detail: "coordination, surveillance, trou",
  },
];

/** Datés : ils vont dans `agenda_entries`, hors de tout calcul d'assiduité. */
const A_UNE_DATE: Choix[] = [
  {
    type: "visite",
    titre: "Visite de stage",
    detail: "une fois, à une date, avec l'élève concerné",
  },
  {
    type: "parents",
    titre: "Réunion parents-professeurs",
    detail: "la classe s'écrit dans l'intitulé",
  },
  {
    type: "rendezvous",
    titre: "Réunion ou rendez-vous",
    detail: "ESS, entretien, conseil de classe",
  },
];

/** La seule forme du module qui écrive dans `seances`. Voir le commentaire de
 *  tête du composant : c'est la frontière que ce groupe rend visible. */
const UNE_SEULE_FOIS: Choix[] = [
  {
    type: "ponctuel",
    titre: "Cours ponctuel",
    detail: "remplacement, séance exceptionnelle",
  },
];

/**
 * Intitulé prérempli des formes datées. Il est posé **à l'ouverture, une fois**
 * : rien ne le réécrit ensuite, et l'enseignant reste libre de le vider. « ESS,
 * entretien, conseil de classe » ne se préremplit pas — trois mots pour une
 * seule case, les pastilles du dialogue les proposent déjà.
 */
const INTITULE_PAR_DEFAUT: Record<"visite" | "parents" | "rendezvous", string> =
  {
    visite: "Visite de stage",
    parents: "Réunion parents-professeurs",
    rendezvous: "",
  };

/** Prédicats de type, pas de simples booléens : c'est le second qui laisse
 *  TypeScript garantir que `INTITULE_PAR_DEFAUT` n'est indexé que par une forme
 *  datée — le cours ponctuel, lui, n'y a pas d'entrée. */
function estHebdomadaire(
  type: TypePlanning,
): type is "cours" | "occupation" {
  return type === "cours" || type === "occupation";
}

function estDatee(
  type: TypePlanning,
): type is "visite" | "parents" | "rendezvous" {
  return type === "visite" || type === "parents" || type === "rendezvous";
}

/** « mardi 17 novembre 2026 ». En heure locale : `toISOString()` daterait au
 *  30 novembre ce qui est ouvert le 1er décembre à 00h30. */
function jourLong(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export interface NewPlanningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Année de la rentrée, `null` tant que la journée n'a pas été lue : les deux
   *  formes hebdomadaires et le cours ponctuel sont alors indisponibles — les
   *  trois ont besoin de l'année pour proposer les bonnes classes. Les formes
   *  datées, qui ne désignent aucune classe, restent. */
  yearStart: number | null;
  /** Classes connues, passées telles quelles à `SlotDialog` (règle 1 : le
   *  parent détient la liste). */
  sessions: Session[];
  /** Tous les créneaux de l'année : source des pastilles « Heures déjà
   *  utilisées » de `SlotDialog`. */
  slots: TimetableSlot[];
  /** Jour ISO prérempli des formes hebdomadaires (1 = lundi). */
  defaultWeekday: number;
  /** Date préremplie des formes datées, AAAA-MM-JJ. */
  defaultDate: string;
  /** Horaires préremplis, `undefined` quand le geste n'en dit rien.
   *
   *  Ils viennent de la case cliquée ou de la plage tracée dans la grille, et
   *  ils valent pour les **six** formes : l'enseignant qui trace 14h–15h30
   *  puis choisit « Visite de stage » a déjà dit son horaire, le lui
   *  redemander serait lui faire répéter le geste qu'il vient de faire. */
  defaultStartTime?: string;
  defaultEndTime?: string;
  /** Création d'un créneau — **création seule**, jamais une modification : le
   *  parent ne doit pas faire transiter ce chemin par l'identifiant du créneau
   *  qu'il éditait juste avant. */
  onCreateSlot: (input: TimetableSlotInput) => Promise<void>;
  onCreatedEntry: (entry: AgendaEntry) => void | Promise<void>;
  /** Appelé après la création d'un cours ponctuel — **la seule séance que ce
   *  module engendre**. L'hôte recharge ses écrans et l'ouvre. */
  onCreatedSeance: (seance: Seance) => void | Promise<void>;
}

/**
 * Le point d'entrée unique de « Ajouter… » : six boutons, puis le dialogue
 * existant, monté tel quel.
 *
 * Ce fichier ne contient **aucun formulaire**. `SlotDialog`,
 * `AgendaEntryDialog` et `OneOffSeanceDialog` restent entiers et gardent leurs
 * appelants : fusionner les deux premiers rouvrirait la fiche élève, qui n'a
 * rien à voir ici.
 *
 * **Cinq des six chemins ne créent aucune séance** : deux écrivent dans
 * `timetable_slots` (un modèle hebdomadaire n'est pas un cours), trois dans
 * `agenda_entries`. Le sixième, « Cours ponctuel », écrit une ligne — une
 * seule — dans `seances` : c'est un vrai cours, avec son appel et son cahier de
 * texte, et il entre donc au dénominateur d'assiduité du bilan remis aux
 * familles. C'est la fonction demandée par l'enseignant pour un remplacement ;
 * elle est normale, et le troisième groupe de boutons le dit sans détour plutôt
 * que de le laisser découvrir sur un pourcentage.
 */
export function NewPlanningDialog({
  open,
  onOpenChange,
  yearStart,
  sessions,
  slots,
  defaultWeekday,
  defaultDate,
  defaultStartTime,
  defaultEndTime,
  onCreateSlot,
  onCreatedEntry,
  onCreatedSeance,
}: NewPlanningDialogProps): ReactElement {
  const [type, setType] = useState<TypePlanning | null>(null);

  /** Fermeture, d'où qu'elle vienne : le type retombe à `null`, sinon rouvrir
   *  « Ajouter… » afficherait le formulaire précédent au lieu du sélecteur de
   *  forme. Pas de décompte ici : il se périmerait au premier ajout, c'est
   *  précisément ce qui est arrivé à la version « les cinq boutons ». */
  const fermer = (ouvert: boolean) => {
    if (ouvert) return;
    setType(null);
    onOpenChange(false);
  };

  /**
   * **Le contrat numérique de ce module, écrit en une fonction.**
   *
   * Un seul type écrit `session_id` : « Cours ». Aucun autre chemin ne peut en
   * écrire un. Sinon une « réunion » rattachée à une classe reviendrait chaque
   * semaine dans l'onglet Journée avec son bouton « Créer et ouvrir » — et
   * chaque séance ainsi créée compterait au dénominateur d'assiduité du bilan
   * remis aux familles.
   *
   * Le refus est **explicite, jamais silencieux** : `SlotDialog` affiche le
   * message levé ici à côté du bouton qui vient d'échouer. Remettre
   * `session_id` à `null` sans rien dire ferait disparaître une classe choisie
   * à l'écran, ce qui est exactement le genre d'écart qu'on ne retrouve jamais.
   */
  const creerSansClasse = async (input: TimetableSlotInput) => {
    if (input.session_id !== null) {
      throw new Error(
        "Ce créneau a été ouvert comme « Réunion ou occupation » : il ne peut " +
          "pas porter de classe.\nRemettez « Aucune » dans le champ Classe, ou " +
          "fermez ce dialogue et choisissez « Cours ».",
      );
    }
    await onCreateSlot(input);
  };

  const bouton = (choix: Choix, desactive = false) => (
    <Button
      key={choix.type}
      variant="outline"
      disabled={desactive}
      className="h-auto w-full flex-col items-start gap-1 whitespace-normal px-4 py-3 text-left"
      onClick={() => setType(choix.type)}
    >
      <span className="text-sm font-semibold">{choix.titre}</span>
      <span className="text-xs font-normal text-muted-foreground">
        {choix.detail}
      </span>
    </Button>
  );

  return (
    <>
      <Dialog open={open && type === null} onOpenChange={fermer}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Ajouter à l'emploi du temps</DialogTitle>
            {/* Quand le geste vient de la grille, l'horaire est déjà choisi :
                l'annoncer ici évite d'ouvrir le formulaire pour vérifier que
                la plage tracée a bien été retenue. */}
            <DialogDescription>
              {defaultStartTime && defaultEndTime
                ? `Les champs seront préremplis sur ${jourLong(defaultDate)}, de ${defaultStartTime} à ${defaultEndTime}.`
                : `Les champs seront préremplis depuis le jour affiché : ${jourLong(defaultDate)}.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Chaque semaine
              </p>
              <p className="text-xs text-muted-foreground">
                Entre dans la grille, ne crée aucune séance.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {CHAQUE_SEMAINE.map((choix) => bouton(choix, yearStart === null))}
              </div>
              {yearStart === null && (
                <p className="text-xs text-muted-foreground">
                  L'année scolaire de la journée affichée n'a pas encore été
                  lue : rechargez la journée pour ajouter un créneau
                  hebdomadaire.
                </p>
              )}
            </div>

            {/* Ce trait n'est pas décoratif : il sépare le modèle hebdomadaire
                de l'occurrence datée. */}
            <div className="space-y-2 border-t pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                À une date
              </p>
              <p className="text-xs text-muted-foreground">
                N'entre dans aucun calcul d'assiduité.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {A_UNE_DATE.map((choix) => bouton(choix))}
              </div>
            </div>

            {/* Le second trait sépare ce qui compte de ce qui ne compte pas.
                C'est la frontière la plus lourde du module : les cinq formes
                au-dessus ne touchent pas aux chiffres du bilan, celle-ci si. */}
            <div className="space-y-2 border-t pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Un cours, une seule fois
              </p>
              <p className="text-xs text-muted-foreground">
                Un vrai cours, avec son appel et son cahier de texte : il
                comptera dans le taux de présence du bilan, comme les autres
                cours de la classe.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {UNE_SEULE_FOIS.map((choix) => bouton(choix, yearStart === null))}
              </div>
              {yearStart === null && (
                <p className="text-xs text-muted-foreground">
                  L'année scolaire de la journée affichée n'a pas encore été
                  lue : rechargez la journée pour ajouter un cours ponctuel.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => fermer(false)}>
              Annuler
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* `key={type}` : sans elle, passer d'une forme à l'autre réutiliserait
          l'instance React et ferait ressortir les valeurs de la précédente. */}
      {type !== null && estHebdomadaire(type) && yearStart !== null && (
        <SlotDialog
          key={type}
          open
          onOpenChange={fermer}
          yearStart={yearStart}
          slot={null}
          sessions={sessions}
          slots={slots}
          defaultWeekday={defaultWeekday}
          defaultStartTime={defaultStartTime}
          defaultEndTime={defaultEndTime}
          onSubmit={type === "cours" ? onCreateSlot : creerSansClasse}
        />
      )}

      {type !== null && estDatee(type) && (
        <AgendaEntryDialog
          key={type}
          open
          onOpenChange={fermer}
          defaultDate={defaultDate}
          defaultStartTime={defaultStartTime}
          defaultEndTime={defaultEndTime}
          defaultTitle={INTITULE_PAR_DEFAUT[type]}
          onCreated={onCreatedEntry}
        />
      )}

      {/* La sixième forme, et la seule qui écrive dans `seances`. `key` pour la
          même raison que les autres : le dialogue tient un brouillon. */}
      {type === "ponctuel" && yearStart !== null && (
        <OneOffSeanceDialog
          key={type}
          open
          onOpenChange={fermer}
          yearStart={yearStart}
          sessions={sessions}
          defaultDate={defaultDate}
          defaultStartTime={defaultStartTime}
          defaultEndTime={defaultEndTime}
          onCreated={onCreatedSeance}
        />
      )}
    </>
  );
}

/** Alias par défaut, comme `SlotDialog` : les deux formes d'import marchent. */
export default NewPlanningDialog;
