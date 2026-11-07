import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { AlertTriangle, Trash2 } from "lucide-react";

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
  onSubmit,
  onDelete,
}: SlotDialogProps): ReactElement {
  const [sessionId, setSessionId] = useState(AUCUNE_CLASSE);
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
    setWeekday(String(slot?.weekday ?? defaultWeekday ?? 1));
    setStartTime(slot?.start_time ?? defaultStartTime ?? "");
    setEndTime(slot?.end_time ?? defaultEndTime ?? "");
    setParity(slot?.week_parity ?? "toutes");
    setLabel(slot?.label ?? "");
    setRoom(slot?.room ?? "");
    setError(null);
    setPending(false);
    setConfirmingDelete(false);
  }, [open, slotId, defaultWeekday, defaultStartTime, defaultEndTime]);

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

  const joursProposes = useMemo(() => {
    const jour = slot?.weekday;
    return jour && !JOURS_PROPOSES.includes(jour)
      ? [...JOURS_PROPOSES, jour]
      : JOURS_PROPOSES;
  }, [slot]);

  const horaires = useMemo(() => horairesConnus(slots), [slots]);

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
            <Select value={sessionId} onValueChange={setSessionId}>
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
