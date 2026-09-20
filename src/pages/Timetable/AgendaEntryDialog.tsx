import {
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import type { AgendaEntry } from "@/types";

/** Ce qu'il faut savoir d'un élève pour le désigner : `Student` s'y conforme. */
export interface AgendaEntryTarget {
  id: string;
  first_name: string;
  last_name: string;
}

export interface AgendaEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Jour pré-rempli, AAAA-MM-JJ. Défaut : aujourd'hui, en heure locale. */
  defaultDate?: string;
  /** Horaire pré-rempli. `""` = heure à caler, et c'est une saisie valide. */
  defaultStartTime?: string;
  defaultEndTime?: string;
  /** Intitulé pré-rempli. Le titre porte la catégorie : il n'y a pas de type. */
  defaultTitle?: string;
  /** Élève imposé (ouverture depuis sa fiche) : la cible n'est alors ni
   *  choisie ni affichée en liste. Absent ou `null` : le dialogue charge
   *  lui-même les élèves de toutes les classes. */
  student?: AgendaEntryTarget | null;
  /** Appelé après création, avec l'entrée créée : à l'hôte de recharger sa
   *  liste et, s'il le veut, d'ouvrir l'éditeur sur elle. */
  onCreated: (entry: AgendaEntry) => void | Promise<void>;
}

interface StudentOption {
  id: string;
  name: string;
  sessionName: string;
}

// Radix refuse une valeur vide sur un SelectItem : d'où cette sentinelle pour
// « aucun élève », qui est le cas normal d'une réunion ou d'un conseil.
const NO_STUDENT = "__aucun__";

/** Intitulés proposés : le titre EST la catégorie, il n'y a pas de taxonomie. */
const TITLE_SUGGESTIONS = [
  "Visite de stage",
  "Conseil de classe",
  "Réunion parents",
];

/** Date du jour en heure locale. `toISOString()` daterait une entrée créée le
 *  1er décembre à 00h30 au 30 novembre. */
function today(): string {
  return new Date().toLocaleDateString("sv-SE");
}

function messageOf(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Une erreur inattendue est survenue.";
}

function fullName(student: AgendaEntryTarget): string {
  return `${student.last_name} ${student.first_name}`.trim();
}

/**
 * Création d'un rendez-vous : une visite de stage, un conseil de classe, une
 * réunion — tout ce qui a lieu une fois, à une date, et qui n'est pas un cours.
 *
 * Aucune ligne créée ici n'entre dans `seances` : le dénominateur d'assiduité
 * des bilans ne bouge pas d'un cheveu.
 *
 * L'élève désigné est **immuable après création** (le backend refuse de le
 * changer) : c'est ici, et nulle part ailleurs, qu'il se choisit.
 */
export function AgendaEntryDialog({
  open,
  onOpenChange,
  defaultDate,
  defaultStartTime = "",
  defaultEndTime = "",
  defaultTitle = "",
  student = null,
  onCreated,
}: AgendaEntryDialogProps): ReactElement {
  const [title, setTitle] = useState(defaultTitle);
  const [date, setDate] = useState(defaultDate ?? today());
  const [startTime, setStartTime] = useState(defaultStartTime);
  const [endTime, setEndTime] = useState(defaultEndTime);
  const [studentId, setStudentId] = useState(NO_STUDENT);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // La liste des élèves n'est chargée qu'à la première ouverture sans cible
  // imposée, puis conservée : rouvrir le dialogue ne doit pas rejouer une
  // requête par classe.
  const [options, setOptions] = useState<StudentOption[] | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  // Le dialogue reste monté entre deux ouvertures : sans cette
  // réinitialisation, on saisirait la visite du mardi avec les champs du lundi.
  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setDate(defaultDate ?? today());
    setStartTime(defaultStartTime);
    setEndTime(defaultEndTime);
    setStudentId(NO_STUDENT);
    setError(null);
    setPending(false);
  }, [open, defaultTitle, defaultDate, defaultStartTime, defaultEndTime]);

  const loadOptions = useCallback(async () => {
    setLoadingOptions(true);
    setOptionsError(null);
    try {
      const sessions = await api.getSessions();
      const collected: StudentOption[] = [];
      // Séquentiel : le backend n'a qu'une `Connection` sous `Mutex`, et une
      // classe de retard sur l'autre n'apporterait rien.
      for (const session of sessions) {
        const students = await api.getStudents(session.id);
        for (const candidate of students) {
          collected.push({
            id: candidate.id,
            name: fullName(candidate),
            sessionName: session.name,
          });
        }
      }
      setOptions(collected);
    } catch (err) {
      setOptionsError(messageOf(err));
      // Liste vide plutôt que `null` : sans cela, l'effet qui déclenche ce
      // chargement se rallumerait indéfiniment sur l'échec, une requête par
      // rendu. L'entrée reste créable sans élève, le message dit pourquoi.
      setOptions([]);
    } finally {
      setLoadingOptions(false);
    }
  }, []);

  useEffect(() => {
    if (!open || student || options !== null || loadingOptions) return;
    void loadOptions();
  }, [open, student, options, loadingOptions, loadOptions]);

  const handleCreate = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      // Les refus (intitulé vide, heure de fin avant le début, date mal formée)
      // viennent du backend : une seconde implémentation française des mêmes
      // règles divergerait au premier ajustement.
      const created = await api.createAgendaEntry(
        date,
        startTime,
        endTime,
        title,
        student ? student.id : studentId === NO_STUDENT ? null : studentId,
      );
      onOpenChange(false);
      await onCreated(created);
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

  // Les classes sont conservées dans l'ordre de la liste ; les élèves sont
  // regroupés dessous, pour que deux « MARTIN Hugo » de deux classes se
  // distinguent.
  const groups: { sessionName: string; students: StudentOption[] }[] = [];
  for (const option of options ?? []) {
    const last = groups[groups.length - 1];
    if (last && last.sessionName === option.sessionName) {
      last.students.push(option);
    } else {
      groups.push({ sessionName: option.sessionName, students: [option] });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajouter une visite ou un rendez-vous</DialogTitle>
          <DialogDescription>
            Une visite de stage, un conseil de classe, une réunion : tout ce qui
            a lieu une fois, et qui n'est pas un cours. Rien de ce qui est saisi
            ici n'entre dans le calcul d'assiduité.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="entree-nouvelle-titre">Intitulé</Label>
            <Input
              id="entree-nouvelle-titre"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={submitOnEnter}
              placeholder="Ex. : Visite de stage — entreprise Durand"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Intitulés courants — ou écrivez le vôtre.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {TITLE_SUGGESTIONS.map((suggestion) => (
                <Button
                  key={suggestion}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs font-normal"
                  onClick={() => setTitle(suggestion)}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="entree-nouvelle-date">Date</Label>
              <Input
                id="entree-nouvelle-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entree-nouvelle-debut">Heure de début</Label>
              <Input
                id="entree-nouvelle-debut"
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entree-nouvelle-fin">Heure de fin</Label>
              <Input
                id="entree-nouvelle-fin"
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Les heures peuvent rester vides : le rendez-vous s'affiche alors
            hors de la grille horaire, en attendant d'être calé.
          </p>

          <div className="space-y-2">
            <Label htmlFor="entree-nouvelle-eleve">Élève concerné</Label>
            {student ? (
              <p
                id="entree-nouvelle-eleve"
                className="rounded-md border bg-muted/40 px-3 py-2 text-sm"
              >
                {fullName(student)}
              </p>
            ) : (
              <Select value={studentId} onValueChange={setStudentId}>
                <SelectTrigger id="entree-nouvelle-eleve">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_STUDENT}>
                    Aucun élève en particulier
                  </SelectItem>
                  {groups.map((group) => (
                    <SelectGroup key={group.sessionName}>
                      <SelectLabel>{group.sessionName}</SelectLabel>
                      {group.students.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">
              {loadingOptions
                ? "Chargement des élèves…"
                : "L'élève désigné ne pourra plus être changé : un texte écrit sur un élève ne doit pas pouvoir devenir celui d'un autre."}
            </p>
            {optionsError && (
              <p className="text-xs text-destructive">
                La liste des élèves n'a pas pu être chargée ({optionsError}).
                Le rendez-vous peut tout de même être créé sans élève.
              </p>
            )}
          </div>

          {error && (
            <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Annuler
          </Button>
          <Button onClick={() => void handleCreate()} disabled={pending}>
            <CalendarPlus className="h-4 w-4" />
            {pending ? "Ajout…" : "Ajouter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
