import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BookDashed,
  Paperclip,
  Pencil,
  RotateCcw,
  Save,
  X,
} from "lucide-react";

import { Attachments } from "@/components/Attachments";
import type { AttachmentsHandle } from "@/components/Attachments";
import { DataState } from "@/components/DataState";
import { PastilleDeCategorie } from "@/components/PastilleCategorie";
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
import { useZoneDepot } from "@/hooks/useZoneDepot";
import { api } from "@/lib/api";
import { aDuContenu } from "@/lib/contenu";
import { cn } from "@/lib/utils";
import type { AgendaEntry } from "@/types";
import { MAX_ENTRY_CATEGORY_CHARS } from "@/types";

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

/** Jumelle de celle de `SeanceDetail` : `datetime('now')` écrit en UTC, et le
 *  « Z » manquant ferait passer la chaîne pour une heure locale — une décision
 *  prise à 00h30 s'afficherait la veille. */
function formatStamp(stamp: string): string {
  const date = new Date(`${stamp.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("fr-FR");
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
 * Trois écritures disjointes, comme la séance : `updateAgendaEntryMeta`
 * (intitulé, catégorie, date, horaire), `updateAgendaEntryContent` (le texte) et
 * `setAgendaEntryContentWaived` (le « rien à écrire »). La cible — la classe ET
 * l'élève — n'est écrite par aucune des trois : elle est fixée à la création, et
 * le backend refuse de la changer.
 *
 * Les pièces jointes, elles, n'attendent aucun bouton : elles sont écrites dès
 * qu'un fichier est choisi ou lâché. D'où leur carte à part.
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
  const [categoryDraft, setCategoryDraft] = useState("");
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

  // ---- « Rien à écrire » ----
  // Pas d'état local pour la valeur : elle est lue sur l'entrée relue, jamais
  // recopiée. Une copie figée aurait affiché « déclaré » après un échec.
  const [waiveBusy, setWaiveBusy] = useState(false);
  const [waiveError, setWaiveError] = useState<string | null>(null);

  // ---- Glisser-déposer de pièces jointes ----
  // La zone couvre tout le compte rendu, éditeur compris, et ne fait que
  // TRANSMETTRE : `Attachments` garde la réduction, le plafond et les refus.
  // Même hook que le cahier de texte — le même geste doit donner le même
  // résultat des deux côtés.
  const piecesRef = useRef<AttachmentsHandle>(null);
  const zoneDepot = useZoneDepot((depot) => {
    void piecesRef.current?.deposer(depot);
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = await api.getAgendaEntry(entryId);
      setEntry(loaded);
      setTitleDraft(loaded.title);
      setCategoryDraft(loaded.category);
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
      categoryDraft !== entry.category ||
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
        categoryDraft,
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
      setCategoryDraft(saved.category);
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
    setCategoryDraft(entry.category);
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

  /**
   * Déclare — ou retire — le « rien à écrire ».
   *
   * Ne touche pas au brouillon et ne l'enregistre pas à sa place (règle 3) :
   * cliquer ici avec trois lignes tapées et non enregistrées ne les perd pas,
   * mais ne les enregistre pas davantage — le bouton du haut reste le seul
   * chemin du texte, et il reste signalé comme non enregistré.
   *
   * L'en-tête est relu pour afficher l'horodatage réel, celui de SQLite, et la
   * relecture préserve explicitement le corps en cours de frappe.
   */
  const handleWaive = async (next: boolean) => {
    if (!entry) return;
    setWaiveBusy(true);
    setWaiveError(null);
    try {
      await api.setAgendaEntryContentWaived(entry.id, next);
      const relu = await api.getAgendaEntry(entry.id);
      setEntry((current) =>
        current === null
          ? relu
          : { ...relu, content_html: current.content_html },
      );
      await onChanged?.();
    } catch (err) {
      setWaiveError(messageOf(err));
    } finally {
      setWaiveBusy(false);
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
  // La classe s'affiche en plus de l'élève, et non à sa place : ici il y a la
  // place de dire les deux, à l'inverse des cartes de calendrier.
  const classe = entry?.session_name ?? null;

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
            <h3 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
              {entry ? entry.title : "Rendez-vous"}
              {/* À côté de l'intitulé et non dans la ligne grise en dessous :
                  c'est la première chose à lire d'un rendez-vous qui en porte
                  une, et la carte du calendrier la met déjà au même rang. */}
              {entry && <PastilleDeCategorie category={entry.category} />}
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
                {classe && (
                  <>
                    {" · "}
                    {classe}
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
          /* Toute la zone est une cible de dépôt, éditeur compris : un
             enseignant qui glisse le rapport signé vise le compte rendu, pas
             une petite cible dans une carte en bas. Le calque dit alors
             clairement que le fichier sera JOINT et non inséré dans le texte —
             les octets vivent dans la base, pas dans le HTML. */
          <div className="relative space-y-4" {...zoneDepot.props}>
            {zoneDepot.survol && (
              // `pointer-events-none` est vital : un calque qui capterait la
              // souris déclencherait `dragleave` au moment où il apparaît, donc
              // disparaîtrait aussitôt, en boucle.
              <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-primary bg-background/85 text-center">
                <span className="flex items-center gap-2 font-medium">
                  <Paperclip className="h-4 w-4" />
                  Déposez pour joindre à ce rendez-vous
                </span>
                <span className="px-6 text-sm text-muted-foreground">
                  Les fichiers rejoignent «&nbsp;Pièces jointes&nbsp;». Ils ne
                  sont pas insérés dans le texte du compte rendu.
                </span>
              </div>
            )}
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
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="entree-titre">Intitulé</Label>
                        <Input
                          id="entree-titre"
                          value={titleDraft}
                          onChange={(e) => setTitleDraft(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="entree-categorie">
                          Catégorie{" "}
                          <span className="font-normal text-muted-foreground">
                            (facultative)
                          </span>
                        </Label>
                        <Input
                          id="entree-categorie"
                          value={categoryDraft}
                          onChange={(e) => setCategoryDraft(e.target.value)}
                          placeholder="Ex. : alerte à la bombe"
                          maxLength={MAX_ENTRY_CATEGORY_CHARS}
                        />
                      </div>
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
                      s'affiche alors hors de la grille horaire du jour. La
                      catégorie s'affiche en pastille sur les calendriers, à
                      côté de l'intitulé. Ce bouton n'enregistre ni le texte
                      ci-dessous, ni l'élève.
                    </p>
                    {metaError && (
                      <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        {metaError}
                      </p>
                    )}
                  </>
                ) : (
                  <dl className="grid gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs text-muted-foreground">Date</dt>
                      <dd>{formatLongDate(entry.date)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Catégorie
                      </dt>
                      <dd>
                        {entry.category ? (
                          <PastilleDeCategorie category={entry.category} />
                        ) : (
                          <span className="text-muted-foreground">Aucune</span>
                        )}
                      </dd>
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

                {waiveError && (
                  <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    {waiveError}
                  </p>
                )}

                {/* Proposé seulement quand l'éditeur est vide : « rien à
                    écrire » au-dessus d'un paragraphe déjà tapé serait une
                    question absurde. La proposition suit donc le brouillon et
                    non ce qui est enregistré — on la voit disparaître en
                    commençant à écrire, ce qui est la bonne réponse à la
                    question posée. */}
                {entry.content_waived_at !== null ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">
                    <span className="flex items-start gap-2">
                      <BookDashed className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        Marqué «&nbsp;rien à écrire&nbsp;» le{" "}
                        {formatStamp(entry.content_waived_at)}. Ce rendez-vous
                        n'est plus réclamé dans «&nbsp;À reprendre&nbsp;» sur
                        l'accueil, et reste à sa date dans l'emploi du temps.
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={waiveBusy}
                      onClick={() => void handleWaive(false)}
                    >
                      <RotateCcw className="h-4 w-4" />
                      {waiveBusy ? "Retrait…" : "Retirer"}
                    </Button>
                  </div>
                ) : (
                  !aDuContenu(contentDraft) && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                      <span>
                        Rien à écrire pour ce rendez-vous&nbsp;? Réunion
                        d'équipe sans décision, visite où tout va bien,
                        rendez-vous où le rapport signé suffit… Dites-le, et
                        l'accueil cessera d'en réclamer le compte rendu.
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={waiveBusy}
                        onClick={() => void handleWaive(true)}
                      >
                        <BookDashed className="h-4 w-4" />
                        {waiveBusy
                          ? "Enregistrement…"
                          : "Marquer « rien à écrire »"}
                      </Button>
                    </div>
                  )
                )}
              </CardContent>
            </Card>

            {/* Carte distincte, et non une section de la précédente : les deux
                n'enregistrent pas au même moment. Le compte rendu attend son
                bouton, une pièce jointe est écrite dès qu'elle est choisie —
                sous un même en-tête « Enregistrer », l'enseignant croirait
                perdre ses fichiers en quittant sans cliquer. */}
            <Card>
              <CardContent className="p-6">
                <Attachments
                  ref={piecesRef}
                  porteur={{ kind: "entree", id: entry.id }}
                  onChanged={onChanged}
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
