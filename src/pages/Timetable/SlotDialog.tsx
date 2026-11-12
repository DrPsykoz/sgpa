import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { AlertTriangle, CopyPlus, Trash2 } from "lucide-react";

import { SelecteurDeGroupe } from "@/components/Groupes";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useGroupesDeClasse } from "@/hooks/useGroupes";
import {
  schoolYearLabel,
  WEEK_PARITIES,
  WEEK_PARITY_LABELS,
  WEEKDAY_LABELS,
} from "@/types";
import type {
  Session,
  TimetableSlot,
  TimetableSlotInput,
  WeekParity,
} from "@/types";

/** Radix refuse la chaîne vide comme valeur d'un `SelectItem` : il faut une
 *  sentinelle pour « aucune classe ». Elle ne quitte jamais ce fichier —
 *  `session_id` part à `null`. */
const AUCUNE_CLASSE = "aucune";

/** Lundi → samedi. Dimanche n'est pas proposé : la grille ne lui ouvre pas de
 *  colonne, et un créneau invisible serait pire qu'un créneau impossible. Un
 *  créneau du dimanche déjà saisi reste modifiable (voir `joursProposes`). */
const JOURS_PROPOSES = [1, 2, 3, 4, 5, 6];

/** Un horaire déjà employé dans l'année, avec le nombre de créneaux qui s'en
 *  servent — c'est lui qui décide des huit pastilles retenues. */
interface HoraireConnu {
  start_time: string;
  end_time: string;
  usages: number;
}

/**
 * Les horaires déjà en place dans l'année : les huit plus employés, rendus
 * dans l'ordre de la journée.
 *
 * Construits depuis les créneaux **déjà chargés** : aucune constante horaire
 * nationale inventée, aucune liste à maintenir. C'est ce qui rend la saisie
 * supportable sans glisser-déposer — un emploi du temps de SEGPA réutilise les
 * six mêmes heures vingt fois.
 *
 * Les couples début–fin sont préférés aux heures isolées : une pastille
 * remplit les deux champs d'un clic, là où une heure seule laisserait
 * l'enseignant deviner lequel des deux champs elle vise.
 */
function horairesConnus(slots: TimetableSlot[]): HoraireConnu[] {
  const compte = new Map<string, HoraireConnu>();
  for (const slot of slots) {
    if (!slot.start_time || !slot.end_time) continue;
    const cle = `${slot.start_time}-${slot.end_time}`;
    const connu = compte.get(cle);
    if (connu) {
      connu.usages += 1;
    } else {
      compte.set(cle, {
        start_time: slot.start_time,
        end_time: slot.end_time,
        usages: 1,
      });
    }
  }
  const parOrdreDeJournee = (a: HoraireConnu, b: HoraireConnu) =>
    a.start_time.localeCompare(b.start_time) ||
    a.end_time.localeCompare(b.end_time);

  // On garde les huit plus employés, mais on les RANGE par heure : une rangée
  // qui se réordonne à chaque créneau ajouté oblige à la relire en entier.
  return [...compte.values()]
    .sort((a, b) => b.usages - a.usages || parOrdreDeJournee(a, b))
    .slice(0, 8)
    .sort(parOrdreDeJournee);
}

/** Une case de grille : un jour, deux heures. Le minimum pour demander
 *  « cette heure est-elle déjà prise ? ». */
interface CaseDeGrille {
  weekday: number;
  start_time: string;
  end_time: string;
}

/**
 * Deux cases du même jour dont les heures se chevauchent.
 *
 * Le chevauchement et non l'égalité : un 8h–9h et un 8h30–10h occupent bel et
 * bien la même bande de grille, et c'est la question posée. Les bornes sont
 * strictes — un cours qui finit à 9h et un qui commence à 9h se suivent sans se
 * superposer. Les heures étant en HH:MM, la comparaison de chaînes suffit.
 */
function seChevauchent(a: CaseDeGrille, b: CaseDeGrille): boolean {
  if (a.weekday !== b.weekday) return false;
  return a.start_time < b.end_time && b.start_time < a.end_time;
}

/**
 * La périodicité qui **complète** celle d'un créneau, proposée au second.
 *
 * `paires` ↔ `impaires` : c'est l'alternance d'une semaine sur deux, le seul
 * cas où deux cours partagent une bande sans jamais tomber la même semaine.
 *
 * `toutes` → `paires`, faute de mieux : un créneau qui vaut toutes les semaines
 * n'a pas de complément, et c'est bien le problème — il faudra le passer en
 * « impaires » pour que l'alternance soit vraie. Rien ne le fait d'ici : écrire
 * en douce la ligne existante au moment où l'on en ouvre une autre est
 * exactement la modification qu'on ne retrouve jamais, et elle resterait à
 * moitié faite si l'enseignant annulait la création. C'est la phrase sous la
 * liste qui le dit, et lui qui tranche.
 */
function pariteComplementaire(parity: WeekParity): WeekParity {
  if (parity === "paires") return "impaires";
  if (parity === "impaires") return "paires";
  return "paires";
}

/** Ce que la porte « un autre cours à cet horaire » transmet à l'hôte : la case
 *  de grille, et la périodicité proposée. Rien de plus — le reste du créneau
 *  (classe, groupe, intitulé, salle) est précisément ce qui va différer, et le
 *  groupe plus que tout : c'est lui qu'on vient changer quand on pose le second
 *  créneau d'une semaine A / semaine B. */
export interface AutreCreneauAuMemeHoraire {
  weekday: number;
  startTime: string;
  endTime: string;
  week_parity: WeekParity;
}

export interface SlotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Année de la rentrée. Elle n'est pas modifiable ici : le backend la relit
   *  sur la ligne existante à chaque mise à jour. */
  yearStart: number;
  /** `null` = création. */
  slot: TimetableSlot | null;
  /** Classes connues. Le parent détient la liste (règle 1) ; seules celles de
   *  `yearStart` sont proposées, les autres seraient refusées en Rust. */
  sessions: Session[];
  /** Tous les créneaux de l'année : source de « Heures déjà utilisées ». */
  slots: TimetableSlot[];
  /** Préremplissage en création, depuis un clic sur une bande vide. */
  defaultWeekday?: number;
  defaultStartTime?: string;
  defaultEndTime?: string;
  /** Périodicité préremplie en création. Elle ne vient que d'un endroit : la
   *  porte « un autre cours à cet horaire », qui propose le complément de la
   *  périodicité du créneau déjà en place. Ailleurs, « Toutes les semaines ». */
  defaultParity?: WeekParity;
  /** Absent : la porte « un autre cours à cet horaire » n'apparaît pas. Elle
   *  n'a de sens qu'en modification, et c'est l'hôte qui ouvre le second
   *  dialogue — celui-ci ne se change pas en formulaire de création sous les
   *  doigts de l'enseignant. */
  onAddAnother?: (modele: AutreCreneauAuMemeHoraire) => void;
  /** Le parent écrit et recharge sa liste ; le dialogue affiche l'erreur. */
  onSubmit: (input: TimetableSlotInput) => Promise<void>;
  /** Absent : le bouton « Supprimer » n'apparaît pas. */
  onDelete?: (slot: TimetableSlot) => Promise<void>;
}

/**
 * Saisie d'un créneau de l'emploi du temps type.
 *
 * Le créneau est un **modèle hebdomadaire**, pas un cours : rien n'est engendré
 * ici, et le dialogue le dit en clair. C'est ce qui protège le dénominateur
 * d'assiduité du bilan remis aux familles — une séance qui existe compte.
 */
export function SlotDialog({
  open,
  onOpenChange,
  yearStart,
  slot,
  sessions,
  slots,
  defaultWeekday,
  defaultStartTime,
  defaultEndTime,
  defaultParity,
  onSubmit,
  onDelete,
  onAddAnother,
}: SlotDialogProps): ReactElement {
  const [sessionId, setSessionId] = useState(AUCUNE_CLASSE);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [weekday, setWeekday] = useState("1");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [parity, setParity] = useState<WeekParity>("toutes");
  const [label, setLabel] = useState("");
  const [room, setRoom] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Le dialogue reste monté entre deux créneaux : sans cette réinitialisation à
  // chaque ouverture, on modifierait le mardi avec les champs du lundi.
  //
  // La dépendance porte sur l'**identifiant** du créneau, pas sur l'objet : le
  // parent le dérive maintenant de sa liste (règle 1), donc une simple
  // relecture des créneaux en fabrique un nouveau. Dépendre de l'objet
  // effacerait la saisie en cours à chaque rechargement — c'est le brouillon
  // que la règle 2 protège.
  const slotId = slot?.id ?? null;
  useEffect(() => {
    if (!open) return;
    setSessionId(slot?.session_id ?? AUCUNE_CLASSE);
    setGroupId(slot?.group_id ?? null);
    setWeekday(String(slot?.weekday ?? defaultWeekday ?? 1));
    setStartTime(slot?.start_time ?? defaultStartTime ?? "");
    setEndTime(slot?.end_time ?? defaultEndTime ?? "");
    setParity(slot?.week_parity ?? defaultParity ?? "toutes");
    setLabel(slot?.label ?? "");
    setRoom(slot?.room ?? "");
    setError(null);
    setPending(false);
    setConfirmingDelete(false);
  }, [
    open,
    slotId,
    defaultWeekday,
    defaultStartTime,
    defaultEndTime,
    defaultParity,
  ]);

  /**
   * Changer de classe efface le groupe choisi.
   *
   * Un groupe appartient à une classe : garder son identifiant en passant de la
   * 4ᵉ A à la 3ᵉ B enverrait au backend un couple qu'il refuse — en français,
   * mais à l'enregistrement, c'est-à-dire longtemps après le geste qui l'a
   * produit. Le sélecteur se recharge de toute façon sur la nouvelle classe :
   * sans cet effacement, il afficherait une valeur qui n'est dans aucune de ses
   * deux listes.
   */
  const changerDeClasse = (valeur: string) => {
    setSessionId(valeur);
    setGroupId(null);
  };

  const classesDeLAnnee = useMemo(
    () => sessions.filter((s) => s.year_start === yearStart),
    [sessions, yearStart],
  );

  // Une classe d'une autre année ne doit pas disparaître du sélecteur quand on
  // ouvre un créneau qui la désigne : le champ paraîtrait vide, et l'erreur du
  // backend serait incompréhensible.
  const classesProposees = useMemo(() => {
    const attacheeId = slot?.session_id ?? null;
    const attachee = attacheeId
      ? sessions.find((s) => s.id === attacheeId)
      : undefined;
    return attachee && !classesDeLAnnee.some((s) => s.id === attachee.id)
      ? [...classesDeLAnnee, attachee]
      : classesDeLAnnee;
  }, [classesDeLAnnee, sessions, slot]);

  /**
   * Les groupes de la classe **choisie dans ce dialogue**, et non de celle du
   * créneau enregistré : le sélecteur doit suivre le champ « Classe » pendant
   * la saisie, pas l'état d'avant.
   *
   * `null` quand le créneau n'a pas de classe — une coordination n'a pas de
   * groupe, et le crochet ne lit alors rien du tout.
   */
  const classeChoisie = sessionId === AUCUNE_CLASSE ? null : sessionId;
  const { groupes, erreur: erreurGroupes } = useGroupesDeClasse(classeChoisie);

  const joursProposes = useMemo(() => {
    const jour = slot?.weekday;
    return jour && !JOURS_PROPOSES.includes(jour)
      ? [...JOURS_PROPOSES, jour]
      : JOURS_PROPOSES;
  }, [slot]);

  const horaires = useMemo(() => horairesConnus(slots), [slots]);

  /**
   * Les créneaux qui occupent déjà la case en cours de saisie.
   *
   * Calculés sur les **brouillons** et non sur le créneau enregistré : passer
   * le champ « Jour » du lundi au mardi doit changer la liste tout de suite,
   * sinon elle décrit une case qu'on vient de quitter.
   *
   * Rien ici ne refuse rien, et c'est le point : deux créneaux au même horaire
   * sont **légitimes** — c'est la quinzaine, et c'est le besoin signalé. Ce que
   * la liste apporte, c'est de les montrer : la grille empile bien les cartes
   * côte à côte, mais au moment de la saisie l'enseignant ne voyait pas ce qui
   * est déjà là, donc ne pouvait pas choisir la périodicité qui l'évite.
   */
  const voisins = useMemo(() => {
    if (startTime === "" || endTime === "" || endTime <= startTime) return [];
    const saisie: CaseDeGrille = {
      weekday: Number(weekday),
      start_time: startTime,
      end_time: endTime,
    };
    return slots.filter((s) => s.id !== slotId && seChevauchent(s, saisie));
  }, [slots, slotId, weekday, startTime, endTime]);

  /** Ceux des voisins qui tomberont la **même semaine** que la saisie en cours.
   *  « toutes » d'un côté ou de l'autre suffit à les faire se rencontrer. */
  const voisinsSimultanes = useMemo(
    () =>
      voisins.filter(
        (v) =>
          parity === "toutes" ||
          v.week_parity === "toutes" ||
          v.week_parity === parity,
      ),
    [voisins, parity],
  );

  const handleSubmit = async () => {
    const intitule = label.trim();
    if (intitule === "") {
      setError(
        "Donnez un libellé au créneau, par exemple « Atelier » ou " +
          "« Coordination » : c'est lui qui titrera la séance créée depuis ce créneau.",
      );
      return;
    }
    if (startTime === "" || endTime === "") {
      setError("Indiquez l'heure de début et l'heure de fin du créneau.");
      return;
    }
    // Les heures sont au format HH:MM : la comparaison de chaînes suffit.
    if (endTime <= startTime) {
      setError(
        `L'heure de fin (${endTime}) doit suivre l'heure de début (${startTime}).`,
      );
      return;
    }

    setPending(true);
    setError(null);
    try {
      await onSubmit({
        session_id: sessionId === AUCUNE_CLASSE ? null : sessionId,
        // Jamais de groupe sans classe : le backend le refuse, et le sélecteur
        // a déjà disparu de l'écran. La condition est tout de même écrite ici,
        // parce qu'elle est la règle et non une conséquence de l'ordre des
        // gestes — lequel peut changer, pas elle.
        group_id: sessionId === AUCUNE_CLASSE ? null : groupId,
        label: intitule,
        room: room.trim(),
        weekday: Number(weekday),
        start_time: startTime,
        end_time: endTime,
        week_parity: parity,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const handleDelete = async () => {
    if (!slot || !onDelete) return;
    setPending(true);
    setError(null);
    try {
      await onDelete(slot);
      onOpenChange(false);
    } catch (err) {
      // L'erreur reste sur l'écran de confirmation, à côté du bouton qui vient
      // d'échouer : la renvoyer vers le formulaire la couperait de son geste.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleSubmit();
    }
  };

  const messageErreur = error && (
    <p className="flex items-start gap-2 whitespace-pre-line rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{error}</span>
    </p>
  );

  // --- Confirmation de suppression, dans le dialogue lui-même --------------
  // Elle remplace le formulaire au lieu d'ouvrir un second dialogue par-dessus :
  // le texte qui suit est ce qui décidera si l'enseignant ose corriger sa grille
  // en cours d'année, il doit être lu, pas balayé.
  if (confirmingDelete && slot) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer ce créneau ?</DialogTitle>
            <DialogDescription>
              {slot.label}
              {slot.session_name ? ` — ${slot.session_name}` : ""} ·{" "}
              {(WEEKDAY_LABELS[slot.weekday] ?? "").toLowerCase()}{" "}
              {slot.start_time} – {slot.end_time}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              Les séances déjà tenues sur ce créneau sont conservées, avec leur
              appel et leur cahier de texte ; elles ne seront simplement plus
              rattachées à un cours de l'emploi du temps.
            </p>
            <p>
              Aucun pourcentage d'assiduité ne change : cette suppression
              n'efface ni séance, ni appel, ni cahier de texte. Seul le modèle
              hebdomadaire disparaît de la grille.
            </p>
            {messageErreur}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmingDelete(false)}
              disabled={pending}
            >
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={pending}
            >
              <Trash2 className="h-4 w-4" />
              {pending ? "Suppression…" : "Supprimer le créneau"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Sept champs : sur un écran de portable de salle des profs, le dialogue
          doit défiler plutôt que déborder sous le bord de la fenêtre. */}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {slot ? "Modifier le créneau" : "Ajouter un créneau"}
          </DialogTitle>
          <DialogDescription>
            Un créneau est un modèle hebdomadaire de l'année{" "}
            {schoolYearLabel(yearStart)} : il n'engendre aucune séance, et
            n'entre dans aucun calcul d'assiduité.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="slot-session">Classe</Label>
            <Select value={sessionId} onValueChange={changerDeClasse}>
              <SelectTrigger id="slot-session">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* « hebdomadaire » n'est pas un ornement : sans lui, on lit
                    « réunion » et on croit tenir la visite ponctuelle. */}
                <SelectItem value={AUCUNE_CLASSE}>
                  Aucune — coordination, réunion hebdomadaire, trou
                </SelectItem>
                {classesProposees.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Une liste réduite au seul « Aucune » est une impasse muette :
                l'enseignant conclut que le sélecteur est cassé. Elle a deux
                causes bien distinctes, et le message les sépare — il n'y a
                aucune classe, ou il n'y en a aucune DANS CETTE ANNÉE-LÀ, ce
                que la grille ne dit pas d'elle-même. */}
            {classesProposees.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {sessions.length === 0
                  ? "Aucune classe n'existe encore. Créez-la depuis l'écran « Classes » : un créneau sans classe reste un modèle, il n'ouvre rien."
                  : `Aucune de vos classes n'est rattachée à l'année ${schoolYearLabel(yearStart)}, la seule que cette grille accepte. Créez la classe pour cette année depuis l'écran « Classes », ou ramenez la grille sur une semaine de l'année où elle existe.`}
              </p>
            )}
            {sessionId === AUCUNE_CLASSE && (
              <p className="text-xs text-muted-foreground">
                Le créneau marque l'occupation dans la grille, mais il n'y a
                rien à ouvrir derrière un modèle.
              </p>
            )}
            {classesDeLAnnee.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Aucune classe n'existe pour l'année{" "}
                {schoolYearLabel(yearStart)} : seuls des créneaux sans classe
                sont saisissables tant qu'il n'y en a pas.
              </p>
            )}
          </div>

          {/* Le groupe, juste sous la classe dont il dépend, et absent tant
              qu'elle n'en a aucun — `SelecteurDeGroupe` rend `null` de
              lui-même, il n'y a rien à tester ici. Un créneau sans classe n'en
              propose jamais : `classeChoisie` vaut alors `null`, le crochet ne
              lit rien, et la liste reste vide.

              Le créneau porte un **réglage** et non un fait : il ne convoque
              personne par lui-même, il décide seulement du groupe que portera
              chaque séance créée depuis lui. C'est pour cela que la clé
              étrangère est en SET NULL de ce côté-ci et en RESTRICT sur
              `seances`. */}
          <SelecteurDeGroupe
            id="slot-group"
            groups={groupes}
            value={groupId}
            onChange={setGroupId}
            disabled={pending}
            nomDeSecours={slot?.group_name ?? null}
            aide="Les séances créées depuis ce créneau ne convoqueront que ce groupe, et sortiront de l'assiduité des autres élèves. Pour une semaine A / semaine B, posez deux créneaux au même horaire, de périodicités complémentaires, et donnez un groupe à chacun."
          />
          {erreurGroupes && (
            <p className="text-xs text-destructive">
              Les groupes de cette classe n'ont pas pu être lus : {erreurGroupes}
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="slot-weekday">Jour</Label>
              <Select value={weekday} onValueChange={setWeekday}>
                <SelectTrigger id="slot-weekday">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {joursProposes.map((jour) => (
                    <SelectItem key={jour} value={String(jour)}>
                      {WEEKDAY_LABELS[jour]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="slot-parity">Périodicité</Label>
              <Select
                value={parity}
                onValueChange={(value) => setParity(value as WeekParity)}
              >
                <SelectTrigger id="slot-parity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEK_PARITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {WEEK_PARITY_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="slot-start">Début</Label>
                {/* Pas de `step` : un horaire à 8h32 doit rester saisissable. */}
                <Input
                  id="slot-start"
                  type="time"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                  onKeyDown={submitOnEnter}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slot-end">Fin</Label>
                <Input
                  id="slot-end"
                  type="time"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                  onKeyDown={submitOnEnter}
                />
              </div>
            </div>

            {horaires.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  Heures déjà utilisées
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {horaires.map((h) => {
                    const actif =
                      h.start_time === startTime && h.end_time === endTime;
                    return (
                      <Button
                        key={`${h.start_time}-${h.end_time}`}
                        type="button"
                        variant={actif ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => {
                          setStartTime(h.start_time);
                          setEndTime(h.end_time);
                          setError(null);
                        }}
                      >
                        {h.start_time} – {h.end_time}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Ce que la case contient déjà. Ni avertissement ni refus :
              superposer deux créneaux est le geste demandé. C'est une
              information que la saisie ne donnait pas — et sans elle, choisir
              une périodicité complémentaire relève de la mémoire. */}
          {voisins.length > 0 && (
            <div className="space-y-1.5 rounded-md border bg-muted/40 px-3 py-2">
              <p className="text-xs font-medium">
                {voisins.length > 1
                  ? `${voisins.length} créneaux occupent déjà cet horaire`
                  : "Un créneau occupe déjà cet horaire"}
              </p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {voisins.map((v) => (
                  <li key={v.id}>
                    {v.label.trim() || "Créneau sans intitulé"}
                    {v.session_name ? ` — ${v.session_name}` : ""} ·{" "}
                    {v.start_time} – {v.end_time} ·{" "}
                    {WEEK_PARITY_LABELS[v.week_parity].toLowerCase()}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                {voisinsSimultanes.length > 0
                  ? "Ils tomberont la même semaine que celui-ci, et la grille les affichera côte à côte. Pour une alternance d'une semaine sur deux, donnez à chacun sa périodicité : « paires » à l'un, « impaires » à l'autre."
                  : "Les périodicités se complètent : ces cours ne tomberont jamais la même semaine."}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="slot-label">Intitulé</Label>
            <Input
              id="slot-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={submitOnEnter}
              placeholder="Atelier HAS, Français, Coordination…"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Obligatoire : c'est lui qui titrera la séance créée depuis ce
              créneau.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="slot-room">Salle</Label>
            <Input
              id="slot-room"
              value={room}
              onChange={(event) => setRoom(event.target.value)}
              onKeyDown={submitOnEnter}
              placeholder="B12"
            />
          </div>

          {/* La porte vers un second créneau au même horaire.
              La grille en ouvre une autre depuis : un glissé par-dessus une
              carte amorce une création à cet horaire. Mais le CLIC sur une
              carte, lui, ouvre forcément cette modification — la carte couvre
              la bande —, donc ce bouton reste le chemin de qui a cliqué, et le
              seul chemin au clavier. Il est aussi le seul à prérégler la
              périodicité complémentaire : c'est le seul des deux gestes qui
              dise « l'autre semaine », un glissé ne disant que l'horaire.
              C'est enfin par elle que passe la semaine A / semaine B **par
              groupe** : rien n'a été ajouté au schéma pour ça, deux créneaux au
              même horaire de parités complémentaires, un groupe à chacun, et
              l'atelier tourne.
              Elle n'enregistre rien et ne touche pas au créneau ouvert : elle
              ferme ce dialogue et en ouvre un de création, préréglé sur la même
              case et sur la périodicité complémentaire. Le brouillon en cours
              est donc perdu, et c'est volontaire — le transporter ferait croire
              que les deux formulaires n'en sont qu'un. La phrase le dit avant
              le clic. */}
          {slot && onAddAnother && (
            <div className="space-y-2 rounded-md border border-dashed px-3 py-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() =>
                  onAddAnother({
                    weekday: Number(weekday),
                    startTime: startTime || slot.start_time,
                    endTime: endTime || slot.end_time,
                    week_parity: pariteComplementaire(slot.week_parity),
                  })
                }
              >
                <CopyPlus className="h-4 w-4" />
                Un autre cours à cet horaire
              </Button>
              <p className="text-xs text-muted-foreground">
                Pour une alternance d'une semaine sur deux. Le nouveau créneau
                sera préréglé sur{" "}
                {(WEEKDAY_LABELS[Number(weekday)] ?? "").toLowerCase()}, même
                horaire, en{" "}
                {WEEK_PARITY_LABELS[
                  pariteComplementaire(slot.week_parity)
                ].toLowerCase()}
                . Ce créneau-ci n'est pas modifié, et ce que vous venez de
                saisir ici sans l'enregistrer ne sera pas repris.
                {groupes.length > 0 && (
                  <>
                    {" "}
                    C'est aussi le chemin de la semaine A / semaine B par
                    groupe : donnez l'autre groupe au nouveau créneau, et chaque
                    semaine ne convoquera que la moitié de la classe.
                  </>
                )}
              </p>
            </div>
          )}

          {messageErreur}
        </div>

        {/* « Supprimer » à gauche, loin de « Enregistrer » : les deux boutons
            ne doivent pas se toucher. */}
        <DialogFooter className="sm:justify-between sm:space-x-0">
          {slot && onDelete ? (
            <Button
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                setError(null);
                setConfirmingDelete(true);
              }}
              disabled={pending}
            >
              <Trash2 className="h-4 w-4" />
              Supprimer
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Annuler
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={pending}>
              {pending
                ? "Enregistrement…"
                : slot
                  ? "Enregistrer"
                  : "Ajouter le créneau"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Alias par défaut : les deux formes d'import fonctionnent. */
export default SlotDialog;
