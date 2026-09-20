import { useCallback, useEffect, useState, type ReactElement } from "react";
import { AlertTriangle, ArrowLeft, Pencil, Save, X } from "lucide-react";

import { DataState } from "@/components/DataState";
import { RichEditor } from "@/components/RichEditor";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDraftGuard } from "@/hooks/useDrafts";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AgendaEntry } from "@/types";

export interface AgendaEntryEditorProps {
  /** L'éditeur relit l'entrée complète : les listes ne portent pas le corps
   *  rédigé, et une entité passée en prop se figerait. */
  entryId: string;
  /** Facultatif : la flèche de retour n'est rendue que s'il est fourni. */
  onBack?: () => void;
  /** Facultatif : prévient l'hôte qu'il doit recharger sa liste — l'intitulé,
   *  la date et la pastille « texte rédigé » y changent. */
  onChanged?: () => void | Promise<void>;
}

function messageOf(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Une erreur inattendue est survenue.";
}

function formatLongDate(iso: string): string {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatShortDate(iso: string): string {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR");
}

/** Les deux heures vides = heure à caler : l'entrée existe sans horaire. */
function formatSchedule(start: string, end: string): string {
  if (!start) return "heure à caler";
  return end ? `${start} – ${end}` : `à partir de ${start}`;
}

function studentName(entry: AgendaEntry): string | null {
  if (entry.student_id === null) return null;
  const name = `${entry.student_last_name ?? ""} ${entry.student_first_name ?? ""}`;
  return name.trim() || "Élève sans nom";
}

/**
 * Compte rendu d'un rendez-vous — le rapport de visite de stage, d'abord.
 *
 * Composant hébergé, pas une route : les routes du projet sont toutes de
 * premier niveau sous `HashRouter`, et c'est l'hôte (fiche élève, emploi du
 * temps) qui garde la liste, dérive l'entrée et monte cet éditeur avec
 * `key={entry.id}`.
 *
 * Deux écritures disjointes, comme la séance : `updateAgendaEntryMeta`
 * (intitulé, date, horaire) et `updateAgendaEntryContent` (le texte). La cible
 * — l'élève — n'est écrite par aucune des deux : elle est fixée à la création.
 */
export function AgendaEntryEditor({
  entryId,
  onBack,
  onChanged,
}: AgendaEntryEditorProps): ReactElement {
  const [entry, setEntry] = useState<AgendaEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- En-tête : intitulé, date, horaire ----
  // Ces champs ne partent QUE par api.updateAgendaEntryMeta.
  const [metaOpen, setMetaOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [dateDraft, setDateDraft] = useState("");
  const [startDraft, setStartDraft] = useState("");
  const [endDraft, setEndDraft] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  // ---- Corps rédigé ----
  // Ce brouillon ne part QUE par api.updateAgendaEntryContent, et n'est jamais
  // réinitialisé par une relecture de l'entrée : écraser le texte en cours de
  // frappe par une version relue du serveur est le bug que la règle 1 interdit.
  const [contentDraft, setContentDraft] = useState("");
  const [savedContent, setSavedContent] = useState("");
  // TipTap renormalise le HTML au chargement : sans ce drapeau, une entrée
  // jamais modifiée s'afficherait d'emblée comme « non enregistrée ».
  const [contentTouched, setContentTouched] = useState(false);
  const [savingContent, setSavingContent] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const [leaveOpen, setLeaveOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = await api.getAgendaEntry(entryId);
      setEntry(loaded);
      setTitleDraft(loaded.title);
      setDateDraft(loaded.date);
      setStartDraft(loaded.start_time);
      setEndDraft(loaded.end_time);
      setContentDraft(loaded.content_html);
      setSavedContent(loaded.content_html);
      setContentTouched(false);
    } catch (err) {
      setLoadError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, [entryId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!justSaved) return;
    const timer = window.setTimeout(() => setJustSaved(false), 3000);
    return () => window.clearTimeout(timer);
  }, [justSaved]);

  const metaDirty =
    entry !== null &&
    metaOpen &&
    (titleDraft !== entry.title ||
      dateDraft !== entry.date ||
      startDraft !== entry.start_time ||
      endDraft !== entry.end_time);

  const contentDirty = contentTouched && contentDraft !== savedContent;

  /** N'écrit que l'en-tête. Les messages de refus viennent du backend, seule
   *  implémentation des règles de date et d'horaire. */
  const persistMeta = async () => {
    if (!entry) return;
    setSavingMeta(true);
    setMetaError(null);
    try {
      const saved = await api.updateAgendaEntryMeta(
        entry.id,
        dateDraft,
        startDraft,
        endDraft,
        titleDraft,
      );
      // On réadopte l'entrée relue — elle porte l'intitulé nettoyé et
      // `updated_at` — mais on garde le corps rédigé de l'état local, qui peut
      // avoir avancé depuis le chargement.
      setEntry((current) =>
        current === null
          ? saved
          : { ...saved, content_html: current.content_html },
      );
      setTitleDraft(saved.title);
      setDateDraft(saved.date);
      setStartDraft(saved.start_time);
      setEndDraft(saved.end_time);
      setMetaOpen(false);
      await onChanged?.();
    } catch (err) {
      setMetaError(messageOf(err));
    } finally {
      setSavingMeta(false);
    }
  };

  const cancelMeta = () => {
    if (!entry) return;
    setTitleDraft(entry.title);
    setDateDraft(entry.date);
    setStartDraft(entry.start_time);
    setEndDraft(entry.end_time);
    setMetaError(null);
    setMetaOpen(false);
  };

  /** Écrit le texte et laisse remonter l'échec : le registre des brouillons
   *  doit savoir si l'enregistrement est réellement passé. */
  const persistContent = async () => {
    setSavingContent(true);
    setContentError(null);
    try {
      await api.updateAgendaEntryContent(entryId, contentDraft);
      setSavedContent(contentDraft);
      setContentTouched(false);
      setJustSaved(true);
    } finally {
      setSavingContent(false);
    }
  };

  const handleSaveContent = async () => {
    if (savingContent) return;
    try {
      await persistContent();
      await onChanged?.();
    } catch (err) {
      setContentError(messageOf(err));
    }
  };

  // Le brouillon peut représenter une demi-heure de frappe au retour d'une
  // visite. Inscrit au registre, il part avant tout verrouillage — automatique,
  // bouton ou raccourci. `onChanged()` n'est volontairement pas rappelé ici :
  // l'arbre est démonté dans la foulée, et l'échec d'un rechargement de liste
  // se ferait passer pour une perte de saisie.
  useDraftGuard(`entree-agenda:${entryId}`, contentDirty, {
    label: entry
      ? `Rendez-vous — ${entry.title} du ${formatShortDate(entry.date)}`
      : "Rendez-vous",
    flush: persistContent,
  });

  const handleBack = () => {
    if (!onBack) return;
    if (metaDirty || contentDirty) {
      setLeaveOpen(true);
      return;
    }
    onBack();
  };

  const target = entry ? studentName(entry) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {onBack && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBack}
              title="Retour à la liste"
              aria-label="Retour"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">
              {entry ? entry.title : "Rendez-vous"}
            </h3>
            {entry && (
              <p className="text-sm text-muted-foreground">
                {formatLongDate(entry.date)} ·{" "}
                {formatSchedule(entry.start_time, entry.end_time)}
                {target && (
                  <>
                    {" · "}
                    <span className="font-medium text-foreground">
                      {target}
                    </span>
                  </>
                )}
              </p>
            )}
          </div>
        </div>

        {entry && (
          <div className="flex items-center gap-3">
            {contentDirty ? (
              <Badge
                variant="outline"
                className="border-amber-300 bg-amber-50 text-amber-800"
              >
                Modifications non enregistrées
              </Badge>
            ) : justSaved ? (
              <span className="text-sm text-green-700">Texte enregistré</span>
            ) : null}
            <Button
              onClick={() => void handleSaveContent()}
              disabled={savingContent || !contentDirty}
            >
              <Save className="h-4 w-4" />
              {savingContent ? "Enregistrement…" : "Enregistrer le texte"}
            </Button>
          </div>
        )}
      </div>

      <DataState loading={loading} error={loadError} onRetry={() => void load()}>
        {entry && (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">Informations</CardTitle>
                  {metaOpen ? (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={cancelMeta}
                        disabled={savingMeta}
                      >
                        <X className="h-4 w-4" />
                        Annuler
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void persistMeta()}
                        disabled={savingMeta || !metaDirty}
                      >
                        <Save className="h-4 w-4" />
                        {savingMeta ? "Enregistrement…" : "Enregistrer"}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setMetaError(null);
                        setMetaOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                      Modifier
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {metaOpen ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="entree-titre">Intitulé</Label>
                      <Input
                        id="entree-titre"
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="entree-date">Date</Label>
                        <Input
                          id="entree-date"
                          type="date"
                          value={dateDraft}
                          onChange={(e) => setDateDraft(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="entree-debut">Heure de début</Label>
                        <Input
                          id="entree-debut"
                          type="time"
                          value={startDraft}
                          onChange={(e) => setStartDraft(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="entree-fin">Heure de fin</Label>
                        <Input
                          id="entree-fin"
                          type="time"
                          value={endDraft}
                          onChange={(e) => setEndDraft(e.target.value)}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Les deux heures peuvent rester vides : le rendez-vous
                      s'affiche alors hors de la grille horaire du jour. Ce
                      bouton n'enregistre ni le texte ci-dessous, ni l'élève.
                    </p>
                    {metaError && (
                      <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        {metaError}
                      </p>
                    )}
                  </>
                ) : (
                  <dl className="grid gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-xs text-muted-foreground">Date</dt>
                      <dd>{formatLongDate(entry.date)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Horaire</dt>
                      <dd>{formatSchedule(entry.start_time, entry.end_time)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Élève</dt>
                      <dd>
                        {target ?? (
                          <span className="text-muted-foreground">
                            Aucun élève désigné
                          </span>
                        )}
                      </dd>
                    </div>
                  </dl>
                )}

                {target && (
                  <p className="text-xs text-muted-foreground">
                    L'élève désigné n'est pas modifiable : un texte écrit sur{" "}
                    {target} ne doit pas pouvoir devenir celui d'un autre élève.
                    En cas d'erreur, supprimez ce rendez-vous et recréez-le.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Compte rendu</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Même éditeur que le cahier de texte. Le bouton du haut
                  n'enregistre que ce texte.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {contentError && (
                  <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    {contentError}
                  </p>
                )}
                <RichEditor
                  content={contentDraft}
                  onChange={(html) => {
                    setContentDraft(html);
                    setContentTouched(true);
                  }}
                />
              </CardContent>
            </Card>
          </div>
        )}
      </DataState>

      <AlertDialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quitter sans enregistrer ?</AlertDialogTitle>
            <AlertDialogDescription>
              {contentDirty
                ? "Le texte saisi n'est pas encore enregistré : quitter maintenant le perdrait."
                : "Les informations modifiées ne sont pas encore enregistrées : quitter maintenant les perdrait."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Rester sur ce rendez-vous</AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: "destructive" }))}
              onClick={() => {
                setLeaveOpen(false);
                onBack?.();
              }}
            >
              Quitter sans enregistrer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
