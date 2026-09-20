import { useEffect, useState, type KeyboardEvent, type ReactElement } from "react";
import { AlertTriangle, CalendarPlus } from "lucide-react";

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
import { api } from "@/lib/api";
import { schoolYearLabel } from "@/types";
import type { Seance, Session } from "@/types";

/** Radix refuse la chaîne vide comme valeur d'un `SelectItem` : il faut une
 *  sentinelle pour « pas encore choisi ». Elle ne quitte jamais ce fichier. */
const AUCUNE_CLASSE = "__a_choisir__";

function messageOf(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Une erreur inattendue est survenue.";
}

/** Le jour courant en AAAA-MM-JJ. **Jamais** `toISOString()` : en UTC, un
 *  1er décembre saisi à 00h30 se lirait 30 novembre. */
function today(): string {
  return new Date().toLocaleDateString("sv-SE");
}

/** « mardi 17 novembre 2026 ». En heure locale : `toISOString()` daterait au
 *  30 novembre ce qui est saisi le 1er décembre à 00h30, donc au mauvais
 *  trimestre. */
function jourLong(iso: string): string {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export interface OneOffSeanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Année de la rentrée telle que l'écran l'affiche. Elle filtre les classes
   *  proposées : une classe d'une autre année serait refusée par le backend
   *  sans que l'écran l'ait annoncé. */
  yearStart: number;
  /** Classes connues. Le parent détient la liste (règle 1). */
  sessions: Session[];
  /** Date préremplie, AAAA-MM-JJ : celle de la case cliquée, ou celle de la
   *  journée affichée. */
  defaultDate: string;
  /** Horaire prérempli, `""` quand le geste n'en dit rien. */
  defaultStartTime?: string;
  defaultEndTime?: string;
  /** Appelé avec la séance créée : à l'hôte de recharger ses écrans et, s'il
   *  le veut, d'ouvrir le cahier de texte. */
  onCreated: (seance: Seance) => void | Promise<void>;
}

/**
 * Le **cours ponctuel** : un cours qui n'a lieu qu'une fois.
 *
 * C'est la seule forme du sélecteur d'ajout qui écrive dans `seances`. Les cinq
 * autres n'écrivent que des modèles hebdomadaires ou des rendez-vous datés ;
 * celle-ci fabrique une vraie séance, avec son appel et son cahier de texte, et
 * cette séance compte au dénominateur d'assiduité du bilan remis aux familles.
 * Le dialogue le dit en toutes lettres plutôt que de le laisser découvrir sur
 * un pourcentage.
 *
 * Rien n'est écrit sans ce formulaire et son bouton : aucune création en un
 * clic, aucune création par simple navigation. Et **une seule séance par
 * validation** — il n'y a pas de boucle ici, un remplacement de trois jours se
 * saisit trois fois.
 *
 * Sur une **date passée**, rien n'est refusé — un remplacement se saisit
 * souvent le lendemain — mais le formulaire dit ce que ça coûte, dans les mots
 * mêmes de la confirmation de « Créer et ouvrir » : même écriture, même
 * conséquence. L'avertissement est en ligne et non dans un second dialogue : le
 * formulaire est déjà un geste explicite.
 *
 * Le trimestre n'est pas calculé ici : il vient du backend, dérivé de la date.
 * Deux implémentations de cette règle divergeraient au premier changement de
 * bornes.
 */
export function OneOffSeanceDialog({
  open,
  onOpenChange,
  yearStart,
  sessions,
  defaultDate,
  defaultStartTime = "",
  defaultEndTime = "",
  onCreated,
}: OneOffSeanceDialogProps): ReactElement {
  const [sessionId, setSessionId] = useState(AUCUNE_CLASSE);
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState(defaultStartTime);
  const [endTime, setEndTime] = useState(defaultEndTime);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seules les classes de l'année affichée : le backend refuserait les autres,
  // et l'écran ne l'aurait pas annoncé. Même filtre que `SlotDialog`.
  const classesDeLAnnee = sessions.filter((s) => s.year_start === yearStart);
  const sansClasse = classesDeLAnnee.length === 0;

  // Le dialogue peut rester monté entre deux ouvertures : sans cette
  // réinitialisation, on saisirait le remplacement du mardi avec les champs du
  // lundi.
  useEffect(() => {
    if (!open) return;
    setSessionId(AUCUNE_CLASSE);
    setDate(defaultDate);
    setStartTime(defaultStartTime);
    setEndTime(defaultEndTime);
    setTitle("");
    setError(null);
    setPending(false);
  }, [open, defaultDate, defaultStartTime, defaultEndTime]);

  // Une seule classe dans l'année — le cas ordinaire en SEGPA : la sentinelle
  // n'a alors aucune valeur de rechange, elle ne sert qu'à produire un refus et
  // deux clics obligatoires. Dès qu'il y en a deux, on ne choisit pas à la
  // place de l'enseignant : c'est là qu'une erreur coûte cher.
  //
  // Résolu au rendu et non dans un effet : les classes peuvent arriver après
  // l'ouverture du dialogue, et un effet qui se rejouerait à ce moment-là
  // écraserait une saisie déjà commencée.
  const classeChoisie =
    sessionId === AUCUNE_CLASSE && classesDeLAnnee.length === 1
      ? classesDeLAnnee[0].id
      : sessionId;

  // Bornes de l'année scolaire de l'écran, bascule au 1er août — les mêmes que
  // celles du backend (`year_start_for`). Elles ne sont qu'un confort : la
  // garde, seule implémentation de la règle, est côté Rust.
  const debutAnnee = `${yearStart}-08-01`;
  const finAnnee = `${yearStart + 1}-07-31`;

  // Un remplacement se saisit souvent le lendemain : la date passée est
  // fréquente, et légitime. On ne la refuse donc pas — on dit ce qu'elle
  // coûte, comme le fait la confirmation de « Créer et ouvrir ».
  const datePassee = date !== "" && date < today();

  const handleCreate = async () => {
    if (pending) return;
    if (classeChoisie === AUCUNE_CLASSE) {
      setError(
        "Choisissez la classe qui aura ce cours : une séance appartient à une " +
          "classe, c'est elle qui en portera l'appel.",
      );
      return;
    }
    if (!date) {
      setError("Indiquez la date de ce cours.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      // Les refus (intitulé vide, horaire mal formé, heure de fin avant le
      // début) viennent du backend, seule implémentation de ces règles. Le
      // trimestre est passé à `null` : c'est lui qui le déduit de la date.
      const creee = await api.createSeance(
        classeChoisie,
        title,
        date,
        null,
        startTime,
        endTime,
      );
      onOpenChange(false);
      await onCreated(creee);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPending(false);
    }
  };

  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void handleCreate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Ajouter un cours ponctuel</DialogTitle>
          <DialogDescription>
            Un cours qui n'aura lieu qu'une fois : le remplacement d'un collègue
            absent, une séance exceptionnelle. Il crée une vraie séance, avec son
            appel et son cahier de texte, et elle comptera dans le taux de
            présence du bilan.
          </DialogDescription>
        </DialogHeader>

        {sansClasse ? (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              Aucune classe n'existe pour l'année {schoolYearLabel(yearStart)}.
              Un cours ponctuel appartient à une classe : il n'y a rien à créer
              tant qu'il n'y en a pas.
            </p>
            <p>
              Créez d'abord la classe depuis l'écran « Classes », puis revenez
              ici.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ponctuel-classe">Classe</Label>
              <Select value={classeChoisie} onValueChange={setSessionId}>
                <SelectTrigger id="ponctuel-classe">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUCUNE_CLASSE}>
                    Choisissez une classe…
                  </SelectItem>
                  {classesDeLAnnee.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Obligatoire : l'appel de cette séance portera sur les élèves de
                cette classe.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="ponctuel-date">Date</Label>
                {/* `min`/`max` : l'année scolaire de la classe. Un 2028 frappé
                    à la place de 2026 se classait en silence dans un trimestre
                    de cette classe-là. Le refus définitif reste au backend. */}
                <Input
                  id="ponctuel-date"
                  type="date"
                  min={debutAnnee}
                  max={finAnnee}
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ponctuel-debut">Heure de début</Label>
                {/* Pas de `step` : un cours qui commence à 8h32 doit rester
                    saisissable. */}
                <Input
                  id="ponctuel-debut"
                  type="time"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                  onKeyDown={submitOnEnter}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ponctuel-fin">Heure de fin</Label>
                <Input
                  id="ponctuel-fin"
                  type="time"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                  onKeyDown={submitOnEnter}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {date
                ? `Le trimestre sera déduit de la date — ${jourLong(date)} — par SGPA.`
                : "Le trimestre sera déduit de la date par SGPA."}{" "}
              Les deux heures peuvent rester vides.
            </p>

            {/* L'avertissement est EN LIGNE, et non dans un second dialogue :
                le formulaire est déjà un geste explicite, et empiler deux
                modals Radix ferait plus de mal que de bien. Les trois phrases
                sont celles de la confirmation de « Créer et ouvrir » — même
                écriture, même conséquence, donc mêmes mots. */}
            {datePassee && (
              <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <strong className="font-semibold">
                    Cette date est déjà passée.
                  </strong>{" "}
                  Une séance qui existe compte au dénominateur d'assiduité. Tant
                  que son appel n'est pas fait, chaque élève de la classe perd
                  une séance de présence sur le bilan remis à sa famille. Si ce
                  cours n'a pas eu lieu, ne le créez pas — et pensez à faire
                  l'appel dans la foulée s'il a eu lieu.
                </span>
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="ponctuel-titre">Intitulé</Label>
              <Input
                id="ponctuel-titre"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={submitOnEnter}
                placeholder="Ex. : Remplacement — Français"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Obligatoire : c'est le titre de la séance, celui qu'on relit
                dans la liste et dans le cahier de texte.
              </p>
            </div>

            {error && (
              <p className="flex items-start gap-2 whitespace-pre-line rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {sansClasse ? "Fermer" : "Annuler"}
          </Button>
          {!sansClasse && (
            <Button onClick={() => void handleCreate()} disabled={pending}>
              <CalendarPlus className="h-4 w-4" />
              {pending ? "Création…" : "Créer la séance"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Alias par défaut, comme `SlotDialog` : les deux formes d'import marchent. */
export default OneOffSeanceDialog;
