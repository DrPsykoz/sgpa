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
import type { AgendaEntry, Session } from "@/types";
import { schoolYearLabel } from "@/types";

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
   *  choisie ni affichée en liste, et la classe n'est pas demandée — le backend
   *  prend celle de l'élève. Absent ou `null` : le dialogue demande la classe,
   *  puis l'élève parmi ceux de cette classe seulement. */
  student?: AgendaEntryTarget | null;
  /** Appelé après création, avec l'entrée créée : à l'hôte de recharger sa
   *  liste et, s'il le veut, d'ouvrir l'éditeur sur elle. */
  onCreated: (entry: AgendaEntry) => void | Promise<void>;
}

interface StudentOption {
  id: string;
  name: string;
}

// Radix refuse une valeur vide sur un SelectItem : d'où ces deux sentinelles.
// « Aucune classe » est le cas normal d'une réunion de secteur ou d'une
// formation, « aucun élève » celui d'un conseil de classe.
const NO_SESSION = "__aucune__";
const NO_STUDENT = "__aucun__";

/** Intitulés proposés : le titre EST la catégorie, il n'y a pas de taxonomie. */
const TITLE_SUGGESTIONS = [
  "Conseil de classe",
  "Réunion parents-professeurs",
  "Visite de stage",
  "ESS",
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
 * Création d'un rendez-vous : un conseil de classe, une réunion
 * parents-professeurs, une visite de stage — tout ce qui a lieu une fois, à une
 * date, et qui n'est pas un cours.
 *
 * Aucune ligne créée ici n'entre dans `seances` : le dénominateur d'assiduité
 * des bilans ne bouge pas d'un cheveu.
 *
 * **Classe d'abord, élève ensuite et facultatif.** Un conseil de classe
 * concerne une classe et aucun élève en particulier ; une ESS concerne un
 * élève ; une réunion de secteur, ni l'un ni l'autre. Les élèves ne sont donc
 * chargés que pour la classe choisie — l'ancienne version chargeait toutes les
 * classes, une requête chacune, pour construire une liste où il fallait
 * ensuite retrouver son élève.
 *
 * La cible — classe et élève — est **immuable après création** (le backend
 * refuse de la changer) : c'est ici, et nulle part ailleurs, qu'elle se
 * choisit.
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
  const [sessionId, setSessionId] = useState(NO_SESSION);
  const [studentId, setStudentId] = useState(NO_STUDENT);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Les classes ne sont chargées qu'à la première ouverture sans cible imposée,
  // puis conservées : rouvrir le dialogue ne doit pas rejouer la requête.
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  // Les élèves de la classe choisie, et d'elle seule. `null` = aucune classe
  // choisie, donc rien à proposer.
  const [students, setStudents] = useState<StudentOption[] | null>(null);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [studentsError, setStudentsError] = useState<string | null>(null);

  // Le dialogue reste monté entre deux ouvertures : sans cette
  // réinitialisation, on saisirait la visite du mardi avec les champs du lundi.
  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setDate(defaultDate ?? today());
    setStartTime(defaultStartTime);
    setEndTime(defaultEndTime);
    setSessionId(NO_SESSION);
    setStudentId(NO_STUDENT);
    setStudents(null);
    setStudentsError(null);
    setError(null);
    setPending(false);
  }, [open, defaultTitle, defaultDate, defaultStartTime, defaultEndTime]);

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    setSessionsError(null);
    try {
      setSessions(await api.getSessions());
    } catch (err) {
      setSessionsError(messageOf(err));
      // Liste vide plutôt que `null` : sans cela, l'effet qui déclenche ce
      // chargement se rallumerait indéfiniment sur l'échec, une requête par
      // rendu. Le rendez-vous reste créable sans classe, le message dit
      // pourquoi.
      setSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    if (!open || student || sessions !== null || loadingSessions) return;
    void loadSessions();
  }, [open, student, sessions, loadingSessions, loadSessions]);

  // Chargé depuis le gestionnaire du sélecteur et non depuis un effet : la
  // seule façon qu'une classe soit choisie est que l'enseignant la choisisse,
  // et un effet sur `sessionId` tirerait une requête de trop à chaque
  // ouverture, le temps que la réinitialisation ci-dessus s'applique.
  const chooseSession = (value: string) => {
    setSessionId(value);
    // L'élève retenu appartenait à l'ancienne classe : le garder enverrait au
    // backend un couple qu'il refuse, et à juste titre.
    setStudentId(NO_STUDENT);
    setStudents(null);
    setStudentsError(null);
    if (value === NO_SESSION) return;

    setLoadingStudents(true);
    void (async () => {
      try {
        const liste = await api.getStudents(value);
        setStudents(
          liste.map((candidate) => ({
            id: candidate.id,
            name: fullName(candidate),
          })),
        );
      } catch (err) {
        setStudentsError(messageOf(err));
        setStudents([]);
      } finally {
        setLoadingStudents(false);
      }
    })();
  };

  const handleCreate = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      // Les refus (intitulé vide, heure de fin avant le début, date mal formée,
      // élève d'une autre classe) viennent du backend : une seconde
      // implémentation française des mêmes règles divergerait au premier
      // ajustement.
      const created = await api.createAgendaEntry(
        date,
        startTime,
        endTime,
        title,
        // Élève imposé : `null` dit « la classe de l'élève », que le backend
        // relit lui-même. C'est la seule réponse juste, le dialogue ne
        // connaissant alors pas la classe.
        student !== null || sessionId === NO_SESSION ? null : sessionId,
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

  // Les classes arrivent triées par année décroissante : le regroupement par
  // longueur de suite suffit, et il nomme l'année scolaire. C'est elle qui
  // explique une liste « vide » — une classe de l'année précédente n'est pas
  // une classe manquante.
  const years: { yearStart: number; sessions: Session[] }[] = [];
  for (const session of sessions ?? []) {
    const last = years[years.length - 1];
    if (last && last.yearStart === session.year_start) {
      last.sessions.push(session);
    } else {
      years.push({ yearStart: session.year_start, sessions: [session] });
    }
  }

  const sansClasse = sessionId === NO_SESSION;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajouter une visite ou un rendez-vous</DialogTitle>
          <DialogDescription>
            Un conseil de classe, une réunion parents-professeurs, une visite de
            stage : tout ce qui a lieu une fois, et qui n'est pas un cours. Rien
            de ce qui est saisi ici n'entre dans le calcul d'assiduité.
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

          {student ? (
            <div className="space-y-2">
              <Label htmlFor="entree-nouvelle-eleve">Élève concerné</Label>
              <p
                id="entree-nouvelle-eleve"
                className="rounded-md border bg-muted/40 px-3 py-2 text-sm"
              >
                {fullName(student)}
              </p>
              <p className="text-xs text-muted-foreground">
                La classe est celle de cet élève. L'élève désigné ne pourra plus
                être changé : un texte écrit sur un élève ne doit pas pouvoir
                devenir celui d'un autre.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="entree-nouvelle-classe">Classe concernée</Label>
                <Select value={sessionId} onValueChange={chooseSession}>
                  <SelectTrigger id="entree-nouvelle-classe">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SESSION}>
                      Aucune classe en particulier
                    </SelectItem>
                    {years.map((year) => (
                      <SelectGroup key={year.yearStart}>
                        <SelectLabel>
                          {schoolYearLabel(year.yearStart)}
                        </SelectLabel>
                        {year.sessions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {loadingSessions
                    ? "Chargement des classes…"
                    : "Un conseil de classe ou une réunion parents-professeurs concerne une classe. Une réunion de secteur ou une formation n'en concerne aucune."}
                </p>
                {sessionsError && (
                  <p className="text-xs text-destructive">
                    La liste des classes n'a pas pu être chargée (
                    {sessionsError}). Le rendez-vous peut tout de même être créé
                    sans classe.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="entree-nouvelle-eleve">
                  Élève concerné{" "}
                  <span className="font-normal text-muted-foreground">
                    (facultatif)
                  </span>
                </Label>
                <Select
                  value={studentId}
                  onValueChange={setStudentId}
                  disabled={sansClasse || loadingStudents}
                >
                  <SelectTrigger id="entree-nouvelle-eleve">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_STUDENT}>
                      Aucun élève en particulier
                    </SelectItem>
                    {(students ?? []).map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {sansClasse
                    ? "Choisissez d'abord une classe pour désigner un élève."
                    : loadingStudents
                      ? "Chargement des élèves…"
                      : students && students.length === 0 && !studentsError
                        ? "Cette classe n'a aucun élève inscrit."
                        : "L'élève désigné ne pourra plus être changé : un texte écrit sur un élève ne doit pas pouvoir devenir celui d'un autre."}
                </p>
                {studentsError && (
                  <p className="text-xs text-destructive">
                    La liste des élèves n'a pas pu être chargée (
                    {studentsError}). Choisissez la classe à nouveau pour
                    réessayer ; le rendez-vous peut être créé pour la classe
                    seule.
                  </p>
                )}
              </div>
            </>
          )}

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
