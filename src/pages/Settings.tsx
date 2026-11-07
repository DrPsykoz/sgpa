import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Database,
  FolderOpen,
  Info,
  KeyRound,
  Laptop,
  LifeBuoy,
  LoaderCircle,
  Lock,
  Save,
  School,
  ScrollText,
  TriangleAlert,
} from "lucide-react";
import { api } from "@/lib/api";
import { MIN_PASSWORD_LENGTH, passwordLength, PIN_LENGTH } from "@/lib/password";
import {
  AVERAGE_RULE_LABELS,
  REMOVED_POLICY_LABELS,
  schoolYearLabel,
} from "@/types";
import type {
  AppSettings,
  BackupInfo,
  JournalInfo,
  OverallAverageRule,
  RemovedCompetencyPolicy,
  TrimesterBounds,
} from "@/types";
import { useLock } from "@/hooks/useLock";
import {
  LOCK_INHIBIT_EVENT,
  SETTINGS_UPDATED_EVENT,
} from "@/components/layout/AppLayout";
import { DataState } from "@/components/DataState";
import { NeedTagsCard } from "@/components/NeedTagsCard";
import { PinInput } from "@/components/PinInput";
import { RecoveryPhrase } from "@/components/RecoveryPhrase";
import { TrimesterBoundsDialog } from "@/components/TrimesterBoundsDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** L'année scolaire bascule en août : en septembre, le réglage doit proposer
 *  l'année qui commence et non celle qui vient de se terminer. */
function currentSchoolYearStart(): number {
  const now = new Date();
  return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** SQLite renvoie « AAAA-MM-JJ HH:MM:SS » en UTC. Sans le « Z » explicite, le
 *  navigateur lit cet horodatage comme une heure locale et décale l'affichage. */
function parseTimestamp(value: string): Date | null {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTimestamp(value: string): string {
  const date = parseTimestamp(value);
  if (!date) return value;
  return `${date.toLocaleDateString("fr-FR")} à ${date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR");
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}

export default function Settings() {
  const { status, applyStatus } = useLock();

  // L'indice ne fait plus partie des réglages : il vit dans `data/sgpa.keys`,
  // hors de la base, pour rester lisible session verrouillée. Il est donc suivi
  // à part, mais enregistré par le même bouton — l'enseignant n'a pas à savoir
  // que ces deux valeurs ne dorment pas dans le même fichier.
  const initialHint = status?.password_hint ?? "";
  const [hint, setHint] = useState(initialHint);
  const [savedHint, setSavedHint] = useState(initialHint);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [form, setForm] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmNext, setConfirmNext] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);

  // Le code PIN de ce poste. `pin_available` dit s'il est actif ICI : l'état
  // vient du statut du verrou et non d'un drapeau local, parce qu'il dépend de
  // deux choses à la fois — l'enveloppe sur la clé USB et le secret rangé dans
  // le profil Windows — et que le backend est seul à voir les deux.
  const pinEnabled = status?.pin_available ?? false;
  const [pinPassword, setPinPassword] = useState("");
  const [pinCode, setPinCode] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinMessage, setPinMessage] = useState<string | null>(null);

  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  /** Non nulle = la nouvelle phrase attend d'être notée. */
  const [newPhrase, setNewPhrase] = useState<string | null>(null);

  const [boundsYear, setBoundsYear] = useState(currentSchoolYearStart);
  const [bounds, setBounds] = useState<TrimesterBounds | null>(null);
  const [boundsError, setBoundsError] = useState<string | null>(null);
  const [boundsOpen, setBoundsOpen] = useState(false);

  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);

  const [journal, setJournal] = useState<JournalInfo | null>(null);
  const [journalError, setJournalError] = useState<string | null>(null);
  /** Les dernières lignes sont repliées par défaut : la carte doit dire d'abord
   *  qu'il n'y a rien à signaler, pas étaler un fichier technique au milieu
   *  d'un écran de réglages. */
  const [journalOuvert, setJournalOuvert] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getSettings();
      setSettings(data);
      setForm(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBackups = useCallback(async () => {
    setBackupError(null);
    try {
      setBackups(await api.listBackups());
    } catch (err) {
      setBackupError(errorMessage(err));
    }
  }, []);

  const loadJournal = useCallback(async () => {
    setJournalError(null);
    try {
      setJournal(await api.getJournalInfo());
    } catch (err) {
      setJournalError(errorMessage(err));
    }
  }, []);

  const loadBounds = useCallback(async (yearStart: number) => {
    setBoundsError(null);
    setBounds(null);
    try {
      setBounds(await api.getTrimesterBounds(yearStart));
    } catch (err) {
      setBoundsError(errorMessage(err));
    }
  }, []);

  // Les académies que le calendrier embarqué couvre réellement. Lues en base,
  // jamais recopiées d'une liste administrative : mesuré, le jeu du ministère
  // porte 36 valeurs distinctes mais seules 34 ont des dates — Caen et Rouen
  // sont fusionnées dans Normandie depuis 2020. Une liste recopiée proposerait
  // donc des académies sans dates, c'est-à-dire un réglage qui a l'air de
  // marcher et ne fait rien.
  const [academies, setAcademies] = useState<string[]>([]);

  const loadAcademies = useCallback(async () => {
    try {
      setAcademies(await api.getAvailableAcademies());
    } catch {
      // Le calendrier est une couche d'affichage : son absence ne doit pas
      // empêcher de régler le délai de verrouillage. Le champ se contentera
      // d'afficher la valeur enregistrée.
      setAcademies([]);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadBackups();
    void loadAcademies();
    void loadJournal();
  }, [load, loadBackups, loadAcademies, loadJournal]);

  useEffect(() => {
    void loadBounds(boundsYear);
  }, [boundsYear, loadBounds]);

  // Tant que la nouvelle phrase est à l'écran, le verrouillage par inactivité
  // est suspendu : il démonterait l'arbre et emporterait la seule occasion de
  // la lire, alors même que l'ancienne vient d'être invalidée.
  useEffect(() => {
    if (newPhrase === null) return;
    // Corps à accolades : `dispatchEvent` renvoie un booléen, et React refuse
    // une fonction de nettoyage qui renvoie autre chose que `void`.
    const inhibit = (on: boolean) => {
      window.dispatchEvent(new CustomEvent(LOCK_INHIBIT_EVENT, { detail: on }));
    };
    inhibit(true);
    return () => inhibit(false);
  }, [newPhrase]);

  const setField = (patch: Partial<AppSettings>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
    setSaveMessage(null);
    setSaveError(null);
  };

  const dirty =
    (form !== null &&
      settings !== null &&
      JSON.stringify(form) !== JSON.stringify(settings)) ||
    hint.trim() !== savedHint;

  const handleSave = async () => {
    if (!form) return;
    if (!form.teacher_display_name.trim()) {
      setSaveError("Le nom affiché ne peut pas être vide.");
      return;
    }
    // Bornes du backend (`commands/lock.rs`, et le CHECK du schéma) : plus
    // large ici, la saisie passait la validation du front pour être refusée à
    // l'enregistrement.
    if (form.lock_timeout_minutes < 1 || form.lock_timeout_minutes > 120) {
      setSaveError("Le délai d'inactivité doit être compris entre 1 et 120 minutes.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      const saved = await api.updateSettings({
        ...form,
        teacher_display_name: form.teacher_display_name.trim(),
        school_name: form.school_name.trim(),
      });
      setSettings(saved);
      setForm(saved);

      // L'indice part dans une seconde commande : il n'habite pas la base mais
      // le fichier d'enveloppes. Écrit après les réglages, pour qu'un refus de
      // ces derniers n'ait rien laissé derrière lui.
      const trimmedHint = hint.trim();
      if (trimmedHint !== savedHint) {
        await api.setPasswordHint(trimmedHint);
        setSavedHint(trimmedHint);
        setHint(trimmedHint);
        // L'écran de déverrouillage lit l'indice dans le statut du verrou, qui
        // n'est pas relu au verrouillage : sans cette relecture, le nouvel
        // indice n'apparaîtrait qu'au prochain démarrage de SGPA. Et c'est
        // `applyStatus`, non `refresh()` : ce dernier démontait cet écran le
        // temps de l'aller-retour, et « Réglages enregistrés. » se perdait avec
        // lui dès que l'indice avait changé.
        applyStatus(await api.getLockStatus());
      }

      setSaveMessage("Réglages enregistrés.");
      // La barre latérale tient le minuteur d'inactivité et l'écoute de la
      // réduction de fenêtre : sans cet événement, le nouveau délai n'entrerait
      // en vigueur qu'au prochain déverrouillage. Elle y relit aussi le nom
      // affiché.
      window.dispatchEvent(new Event(SETTINGS_UPDATED_EVENT));
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordError(null);
    setPasswordMessage(null);
    if (!current) {
      setPasswordError("Saisissez votre mot de passe actuel.");
      return;
    }
    if (passwordLength(next) < MIN_PASSWORD_LENGTH) {
      setPasswordError(
        `Le nouveau mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`,
      );
      return;
    }
    if (next !== confirmNext) {
      setPasswordError("Les deux nouveaux mots de passe ne correspondent pas.");
      return;
    }
    setPasswordBusy(true);
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirmNext("");
      setPasswordMessage(
        "Mot de passe modifié. Votre phrase de récupération reste valable.",
      );
    } catch (err) {
      setPasswordError(errorMessage(err));
    } finally {
      setPasswordBusy(false);
    }
  };

  const handleEnablePin = async () => {
    setPinError(null);
    setPinMessage(null);
    if (!pinPassword) {
      setPinError(
        "Saisissez votre mot de passe : lui seul déballe la clé maître, et la session ouverte ne la garde pas en mémoire.",
      );
      return;
    }
    if (pinCode.length !== PIN_LENGTH) {
      setPinError(
        `Le code PIN doit contenir exactement ${PIN_LENGTH} chiffres.`,
      );
      return;
    }
    if (pinCode !== pinConfirm) {
      setPinError("Les deux codes PIN ne correspondent pas.");
      return;
    }
    setPinBusy(true);
    try {
      // `applyStatus` et non `refresh()` : celui-ci démonterait cet écran le
      // temps de l'aller-retour, donc le message qui suit.
      applyStatus(await api.enablePin(pinPassword, pinCode));
      setPinPassword("");
      setPinCode("");
      setPinConfirm("");
      setPinMessage(
        pinEnabled
          ? "Code PIN remplacé. L'ancien ne fonctionne plus."
          : "Code PIN activé sur ce poste.",
      );
    } catch (err) {
      setPinError(errorMessage(err));
    } finally {
      setPinBusy(false);
    }
  };

  const handleDisablePin = async () => {
    setPinError(null);
    setPinMessage(null);
    setPinBusy(true);
    try {
      applyStatus(await api.disablePin());
      setPinPassword("");
      setPinCode("");
      setPinConfirm("");
      setPinMessage(
        "Ce poste est oublié : le déverrouillage y redemandera le mot de passe.",
      );
    } catch (err) {
      setPinError(errorMessage(err));
    } finally {
      setPinBusy(false);
    }
  };

  const handleRegenerateRecovery = async () => {
    setRecoveryError(null);
    if (!recoveryPassword) {
      setRecoveryError("Saisissez votre mot de passe pour confirmer.");
      return;
    }
    setRecoveryBusy(true);
    try {
      const phrase = await api.regenerateRecovery(recoveryPassword);
      setRecoveryPassword("");
      setNewPhrase(phrase);
    } catch (err) {
      setRecoveryError(errorMessage(err));
    } finally {
      setRecoveryBusy(false);
    }
  };

  const handleBackup = async () => {
    setBackupBusy(true);
    setBackupError(null);
    setBackupMessage(null);
    try {
      const info = await api.createBackup();
      setBackupMessage(`Sauvegarde créée : ${info.file_name}.`);
      // Le backend met à jour `last_backup_at` de son côté. On recopie la seule
      // valeur concernée au lieu de recharger les réglages : un rechargement
      // complet écraserait les modifications en cours de saisie.
      setSettings((prev) =>
        prev ? { ...prev, last_backup_at: info.created_at } : prev,
      );
      setForm((prev) =>
        prev ? { ...prev, last_backup_at: info.created_at } : prev,
      );
      await loadBackups();
    } catch (err) {
      setBackupError(errorMessage(err));
    } finally {
      setBackupBusy(false);
    }
  };

  const handleReveal = async () => {
    setBackupError(null);
    try {
      await api.revealDataDir();
    } catch (err) {
      setBackupError(errorMessage(err));
    }
  };

  const handleRevealLogs = async () => {
    setJournalError(null);
    try {
      await api.revealLogsDir();
    } catch (err) {
      setJournalError(errorMessage(err));
    }
  };

  const lastBackup = settings?.last_backup_at
    ? parseTimestamp(settings.last_backup_at)
    : null;
  const daysSinceBackup = lastBackup
    ? Math.floor((Date.now() - lastBackup.getTime()) / 86_400_000)
    : null;
  const backupStale = daysSinceBackup === null || daysSinceBackup > 30;

  const yearStartRef = currentSchoolYearStart();
  const years = Array.from({ length: 8 }, (_, i) => yearStartRef - 4 + i);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Réglages</h1>
        <p className="text-sm text-muted-foreground">
          Identité, verrouillage, trimestres et sauvegarde de vos données.
        </p>
      </header>

      <DataState loading={loading} error={error} onRetry={load}>
        {form && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <School className="h-4 w-4" />
                  Identité
                </CardTitle>
                <CardDescription>
                  Le nom de l'établissement est imprimé en tête des bilans
                  exportés.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="teacher-name">Nom affiché</Label>
                    <Input
                      id="teacher-name"
                      value={form.teacher_display_name}
                      onChange={(e) =>
                        setField({ teacher_display_name: e.target.value })
                      }
                      placeholder="Mme Dupont"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="school-name">Établissement</Label>
                    <Input
                      id="school-name"
                      value={form.school_name}
                      onChange={(e) => setField({ school_name: e.target.value })}
                      placeholder="Collège Jean Moulin"
                    />
                  </div>
                </div>

                {/* L'académie décide des dates de vacances affichées par
                    l'emploi du temps. Elle vit ici et non sur une classe : une
                    clé USB, une base, un enseignant. */}
                <div className="space-y-1.5">
                  <Label htmlFor="academie">Académie</Label>
                  <Select
                    value={form.academie === "" ? "aucune" : form.academie}
                    onValueChange={(valeur) =>
                      setField({ academie: valeur === "aucune" ? "" : valeur })
                    }
                  >
                    <SelectTrigger id="academie">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="aucune">
                        Non renseignée — aucune vacance affichée
                      </SelectItem>
                      {academies.map((nom) => (
                        <SelectItem key={nom} value={nom}>
                          {nom}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Elle détermine les dates de vacances scolaires affichées par
                    l'emploi du temps, qui cesse alors d'y proposer des cours.
                    Tant qu'elle n'est pas renseignée, aucune vacance n'est
                    affichée — des dates fausses seraient pires que pas de
                    dates. Les jours fériés, eux, sont calculés et ne dépendent
                    pas de ce réglage.
                    {academies.length > 0 &&
                      ` ${academies.length} académies disponibles dans le calendrier embarqué.`}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  Verrouillage
                </CardTitle>
                <CardDescription>
                  Verrouiller ferme la base : la clé de déchiffrement quitte la
                  mémoire, et il faut le mot de passe pour la rouvrir.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="lock-timeout">
                      Délai d'inactivité (minutes)
                    </Label>
                    <Input
                      id="lock-timeout"
                      type="number"
                      min={1}
                      max={120}
                      value={form.lock_timeout_minutes}
                      onChange={(e) =>
                        setField({
                          lock_timeout_minutes: Number(e.target.value) || 0,
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Un bandeau prévient 30 secondes avant l'échéance, et tout
                      mouvement de souris l'annule. Les saisies en cours (cahier
                      de texte, fiche contrat, appréciation) sont enregistrées
                      avant le verrouillage.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password-hint">
                      Indice de mot de passe (facultatif)
                    </Label>
                    <Input
                      id="password-hint"
                      value={hint}
                      onChange={(e) => {
                        setHint(e.target.value);
                        setSaveMessage(null);
                        setSaveError(null);
                      }}
                      placeholder="Affiché après trois essais manqués"
                    />
                    <p className="text-xs text-muted-foreground">
                      Il est le seul texte à rester lisible hors de la base
                      chiffrée, c'est ce qui lui permet d'être affiché avant le
                      déverrouillage : n'y écrivez pas le mot de passe.
                    </p>
                  </div>
                </div>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 cursor-pointer rounded border-input accent-primary"
                    checked={form.lock_on_minimize}
                    onChange={(e) =>
                      setField({ lock_on_minimize: e.target.checked })
                    }
                  />
                  <span>
                    Verrouiller quand la fenêtre est réduite
                    <span className="block text-xs text-muted-foreground">
                      Utile en salle de classe : un clic sur « Réduire » suffit à
                      masquer les noms des élèves.
                    </span>
                  </span>
                </label>
              </CardContent>
            </Card>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={handleSave} disabled={!dirty || saving}>
                {saving ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Enregistrer
              </Button>
              {dirty && !saving && (
                <span className="text-sm text-muted-foreground">
                  Modifications non enregistrées.
                </span>
              )}
              {saveMessage && (
                <span className="flex items-center gap-1.5 text-sm text-green-700">
                  <Check className="h-4 w-4" />
                  {saveMessage}
                </span>
              )}
              {saveError && (
                <span className="flex items-center gap-1.5 text-sm text-destructive">
                  <TriangleAlert className="h-4 w-4" />
                  {saveError}
                </span>
              )}
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4" />
                  Changer le mot de passe
                </CardTitle>
                <CardDescription>
                  Huit caractères minimum, aucune règle de complexité : une
                  phrase longue et facile à retaper protège mieux qu'un mot court
                  et tordu. Seul le fichier de clés est réécrit — la base et vos
                  sauvegardes déjà prises restent ouvrables, et votre phrase de
                  récupération ne change pas.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="pw-current">Mot de passe actuel</Label>
                    <Input
                      id="pw-current"
                      type="password"
                      value={current}
                      onChange={(e) => setCurrent(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pw-next">Nouveau mot de passe</Label>
                    <Input
                      id="pw-next"
                      type="password"
                      value={next}
                      onChange={(e) => setNext(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pw-confirm">Confirmation</Label>
                    <Input
                      id="pw-confirm"
                      type="password"
                      value={confirmNext}
                      onChange={(e) => setConfirmNext(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="secondary"
                    onClick={handleChangePassword}
                    disabled={passwordBusy}
                  >
                    {passwordBusy && (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    )}
                    Modifier le mot de passe
                  </Button>
                  {passwordMessage && (
                    <span className="flex items-center gap-1.5 text-sm text-green-700">
                      <Check className="h-4 w-4" />
                      {passwordMessage}
                    </span>
                  )}
                  {passwordError && (
                    <span className="flex items-start gap-1.5 whitespace-pre-line text-sm text-destructive">
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      {passwordError}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <Laptop className="h-4 w-4" />
                  Code PIN sur ce poste
                  <Badge variant={pinEnabled ? "secondary" : "outline"}>
                    {pinEnabled ? "Activé" : "Inactif"}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Six chiffres pour ouvrir la session plus vite, sur cet
                  ordinateur et sous ce compte Windows uniquement. Ce n'est pas
                  un second mot de passe : un million de combinaisons ne
                  protégeraient rien contre quelqu'un qui emporte la clé USB. Ce
                  qui tient, c'est que l'autre moitié du secret reste ici, dans
                  votre profil Windows, et ne part pas avec la clé.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-2 rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Le mot de passe reste la clé : il ouvre la base partout, le
                    code PIN nulle part ailleurs — sur un autre ordinateur,
                    l'écran de déverrouillage ne propose même pas le champ.
                    Activer le PIN écrit un petit fichier illisible dans votre
                    profil Windows, le seul de SGPA à sortir de la clé USB. Dix
                    essais manqués le suppriment et renvoient au mot de passe.
                  </span>
                </div>

                {pinEnabled && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Changer le mot de passe{" "}
                      <strong className="font-medium">ne retire pas</strong> ce
                      code PIN : les deux ouvrent la même clé maître, et elle ne
                      bouge jamais. Si le code a pu être vu, ou si cet
                      ordinateur n'est plus le vôtre, c'est « Oublier ce poste »
                      qu'il faut.
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap items-end gap-6">
                  <div className="space-y-1.5">
                    <Label htmlFor="pin-password">
                      Mot de passe, pour confirmer
                    </Label>
                    <Input
                      id="pin-password"
                      type="password"
                      className="w-64"
                      value={pinPassword}
                      onChange={(e) => setPinPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pin-code">
                      {pinEnabled ? "Nouveau code PIN" : "Code PIN"}
                    </Label>
                    <PinInput
                      id="pin-code"
                      value={pinCode}
                      onChange={setPinCode}
                      // Le sixième chiffre envoie sur la confirmation : c'est
                      // ce que six cases laissent attendre. Par l'identifiant
                      // plutôt que par une ref, le composant n'en expose pas.
                      onComplete={() =>
                        document.getElementById("pin-confirm")?.focus()
                      }
                      disabled={pinBusy}
                      label={`Code PIN à ${PIN_LENGTH} chiffres`}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pin-confirm">Confirmation</Label>
                    <PinInput
                      id="pin-confirm"
                      value={pinConfirm}
                      onChange={setPinConfirm}
                      disabled={pinBusy}
                      invalid={
                        pinConfirm.length === PIN_LENGTH &&
                        pinConfirm !== pinCode
                      }
                      label="Confirmation du code PIN"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => void handleEnablePin()}
                    disabled={pinBusy}
                  >
                    {pinBusy && (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    )}
                    {pinEnabled
                      ? "Modifier le code PIN"
                      : "Activer le code PIN"}
                  </Button>
                  {pinEnabled && (
                    <Button
                      variant="outline"
                      onClick={() => void handleDisablePin()}
                      disabled={pinBusy}
                    >
                      Oublier ce poste
                    </Button>
                  )}
                  {pinMessage && (
                    <span className="flex items-center gap-1.5 text-sm text-green-700">
                      <Check className="h-4 w-4" />
                      {pinMessage}
                    </span>
                  )}
                  {pinError && (
                    <span className="flex items-start gap-1.5 whitespace-pre-line text-sm text-destructive">
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      {pinError}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <LifeBuoy className="h-4 w-4" />
                  Phrase de récupération
                </CardTitle>
                <CardDescription>
                  C'est le second moyen d'ouvrir vos données, celui qui sert le
                  jour où le mot de passe se dérobe. Régénérez-la si vous avez
                  perdu la vôtre, ou si quelqu'un a pu la voir.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    La nouvelle phrase remplace l'ancienne :{" "}
                    <strong className="font-medium">
                      celle que vous avez notée cessera de fonctionner
                    </strong>
                    . La nouvelle ne sera affichée qu'une fois, juste après. Vos
                    données, elles, ne bougent pas.
                  </span>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="recovery-password">
                      Mot de passe, pour confirmer
                    </Label>
                    <Input
                      id="recovery-password"
                      type="password"
                      className="w-64"
                      value={recoveryPassword}
                      onChange={(e) => setRecoveryPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => void handleRegenerateRecovery()}
                    disabled={recoveryBusy}
                  >
                    {recoveryBusy && (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    )}
                    Régénérer la phrase
                  </Button>
                  {recoveryError && (
                    <span className="flex items-start gap-1.5 whitespace-pre-line text-sm text-destructive">
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      {recoveryError}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Trimestres</CardTitle>
                <CardDescription>
                  Les bornes servent à classer automatiquement les séances et les
                  évaluations dont le trimestre n'a pas été forcé à la main.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="bounds-year">Année scolaire</Label>
                    <Select
                      value={String(boundsYear)}
                      onValueChange={(v) => setBoundsYear(Number(v))}
                    >
                      <SelectTrigger id="bounds-year" className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {years.map((y) => (
                          <SelectItem key={y} value={String(y)}>
                            {schoolYearLabel(y)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => setBoundsOpen(true)}
                    disabled={!bounds}
                  >
                    Modifier les bornes…
                  </Button>
                </div>

                {boundsError ? (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{boundsError}</span>
                  </div>
                ) : bounds ? (
                  <dl className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                    {[
                      { label: "Trimestre 1", value: bounds.t1_start },
                      { label: "Trimestre 2", value: bounds.t2_start },
                      { label: "Trimestre 3", value: bounds.t3_start },
                      { label: "Fin de l'année", value: bounds.year_end },
                    ].map((b) => (
                      <div key={b.label} className="rounded-lg border p-3">
                        <dt className="text-xs text-muted-foreground">
                          {b.label}
                        </dt>
                        <dd className="text-sm font-medium">
                          {formatDate(b.value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Chargement des bornes…
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Sauvegarde
                </CardTitle>
                <CardDescription>
                  Une copie complète de la base est écrite dans le sous-dossier
                  « backups ». Les 10 plus récentes sont conservées.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  className={
                    backupStale
                      ? "flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                      : "flex items-start gap-2 rounded-md border p-3 text-sm"
                  }
                >
                  {backupStale ? (
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-700" />
                  )}
                  <span>
                    {settings?.last_backup_at ? (
                      <>
                        Dernière sauvegarde le{" "}
                        {formatTimestamp(settings.last_backup_at)}
                        {daysSinceBackup !== null && daysSinceBackup > 30 && (
                          <>
                            , il y a {daysSinceBackup} jours. Une clé USB qui
                            tombe en panne emporte toute l'année : sauvegardez
                            maintenant.
                          </>
                        )}
                        .
                      </>
                    ) : (
                      <>
                        Aucune sauvegarde n'a encore été effectuée. Une clé USB
                        qui tombe en panne emporte toute l'année.
                      </>
                    )}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={handleBackup} disabled={backupBusy}>
                    {backupBusy ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Database className="h-4 w-4" />
                    )}
                    Sauvegarder maintenant
                  </Button>
                  <Button variant="outline" onClick={handleReveal}>
                    <FolderOpen className="h-4 w-4" />
                    Ouvrir le dossier de données
                  </Button>
                  {backupMessage && (
                    <span className="flex items-center gap-1.5 text-sm text-green-700">
                      <Check className="h-4 w-4" />
                      {backupMessage}
                    </span>
                  )}
                  {backupError && (
                    <span className="flex items-center gap-1.5 text-sm text-destructive">
                      <TriangleAlert className="h-4 w-4" />
                      {backupError}
                    </span>
                  )}
                </div>

                {backups.length > 0 && (
                  <>
                    <Separator />
                    <ul className="space-y-1 text-sm">
                      {backups.map((b) => (
                        <li
                          key={b.file_name}
                          className="flex items-center justify-between gap-4 rounded-md px-2 py-1 hover:bg-muted/50"
                        >
                          <span className="font-mono text-xs">
                            {b.file_name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatTimestamp(b.created_at)} ·{" "}
                            {formatSize(b.size_bytes)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Ces deux règles décident de la façon dont les notes sont
                agrégées, et de rien d'autre : aucune des deux n'écrit ni
                n'efface une note. Les moyennes sont calculées à la lecture,
                donc changer de règle recalcule aussi les bilans déjà établis —
                c'est dit dans la carte, parce qu'un trimestre déjà imprimé ne
                correspondrait plus à ce que l'écran affiche. */}
            <Card>
              <CardHeader>
                <CardTitle>Règles de calcul</CardTitle>
                <CardDescription>
                  Elles ne touchent à aucune note saisie : elles décident
                  seulement de la façon dont les notes se combinent. Les
                  modifier recalcule les bilans déjà établis, y compris ceux des
                  trimestres passés.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-1.5">
                  <Label htmlFor="regle-moyenne">Moyenne générale</Label>
                  <Select
                    value={form.overall_average_rule}
                    onValueChange={(valeur) =>
                      setField({
                        overall_average_rule: valeur as OverallAverageRule,
                      })
                    }
                  >
                    <SelectTrigger id="regle-moyenne">
                      <SelectValue />
                    </SelectTrigger>
                    {/* Les intitulés sortent de la même table que les bilans et
                        les PDF : réécrits ici, la même règle porterait deux noms
                        selon l'écran. */}
                    <SelectContent>
                      <SelectItem value="unweighted_mean">
                        {AVERAGE_RULE_LABELS.unweighted_mean}
                      </SelectItem>
                      <SelectItem value="weighted_by_count">
                        {AVERAGE_RULE_LABELS.weighted_by_count}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Non pondérée, une compétence évaluée une seule fois compte
                    autant qu'une compétence évaluée huit fois. Pondérée, chaque
                    compétence pèse à proportion de son nombre de notes.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="regle-retirees">
                    Compétences retirées d'une évaluation
                  </Label>
                  <Select
                    value={form.removed_competency_policy}
                    onValueChange={(valeur) =>
                      setField({
                        removed_competency_policy:
                          valeur as RemovedCompetencyPolicy,
                      })
                    }
                  >
                    <SelectTrigger id="regle-retirees">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="keep">
                        {REMOVED_POLICY_LABELS.keep}
                      </SelectItem>
                      <SelectItem value="ignore">
                        {REMOVED_POLICY_LABELS.ignore}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Dans les deux cas les notes restent dans la base : rien
                    n'est supprimé, et remettre la compétence dans l'évaluation
                    les fait revenir dans le calcul. Le choix ne porte que sur
                    leur comptage.
                  </p>
                </div>
              </CardContent>
            </Card>

            <NeedTagsCard />

            {/* Le journal existe pour une raison précise : en release,
                `windows_subsystem = "windows"` supprime la console, donc une
                panique Rust, une exception de rendu ou un palier de migration
                en échec ne laissaient aucune trace. Il est en clair et hors de
                la base — la panne qu'il doit couvrir inclut « la base ne
                s'ouvre plus » —, et c'est pourquoi il ne porte RIEN de
                personnel. La carte le dit, parce que c'est la question que se
                posera l'enseignant avant d'envoyer le fichier. */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ScrollText className="h-4 w-4" />
                  Journal de diagnostic
                </CardTitle>
                <CardDescription>
                  Quand quelque chose se passe mal, SGPA l'inscrit dans un
                  fichier par jour, dans le sous-dossier « logs ». Envoyez ce
                  fichier pour faire corriger le problème : il ne contient aucun
                  nom d'élève, aucune note et aucun mot de passe — seulement des
                  messages techniques et l'heure à laquelle ils sont survenus.
                  Les fichiers de plus de quinze jours s'effacent d'eux-mêmes.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {journal ? (
                  <>
                    <dl className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Fichier du jour
                        </dt>
                        <dd className="font-mono text-xs font-medium">
                          {journal.today_file}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Taille
                        </dt>
                        <dd className="text-sm font-medium">
                          {formatSize(journal.today_bytes)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Fichiers conservés
                        </dt>
                        <dd className="text-sm font-medium">
                          {journal.file_count}
                        </dd>
                      </div>
                    </dl>

                    <div className="flex flex-wrap items-center gap-3">
                      <Button variant="outline" onClick={handleRevealLogs}>
                        <FolderOpen className="h-4 w-4" />
                        Ouvrir le dossier des journaux
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setJournalOuvert((o) => !o);
                          void loadJournal();
                        }}
                      >
                        <ScrollText className="h-4 w-4" />
                        {journalOuvert
                          ? "Masquer les dernières lignes"
                          : "Voir les dernières lignes"}
                      </Button>
                      {journalError && (
                        <span className="flex items-center gap-1.5 text-sm text-destructive">
                          <TriangleAlert className="h-4 w-4" />
                          {journalError}
                        </span>
                      )}
                    </div>

                    {journalOuvert && (
                      <>
                        <Separator />
                        {journal.recent_lines.length > 0 ? (
                          // Rendu tel quel, dans l'ordre du fichier : le format
                          // d'une ligne est décidé en Rust, et redécoupé ici il
                          // divergerait au premier changement.
                          <pre className="max-h-64 overflow-auto rounded-md bg-muted px-3 py-2 text-xs leading-relaxed">
                            {journal.recent_lines.join("\n")}
                          </pre>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Le fichier du jour est vide : rien n'a été signalé.
                          </p>
                        )}
                      </>
                    )}
                  </>
                ) : journalError ? (
                  <p className="flex items-center gap-1.5 text-sm text-destructive">
                    <TriangleAlert className="h-4 w-4" />
                    {journalError}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Lecture du journal…
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Info className="h-4 w-4" />À propos
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>
                  La base de données vit dans le dossier « data », à côté de
                  l'exécutable de SGPA. Copiez ce dossier pour emporter ou
                  archiver toutes vos données — le fichier{" "}
                  <span className="font-mono">data/sgpa.keys</span> en fait
                  partie : sans lui, la base ne s'ouvre plus.
                </p>
                <p>
                  Votre mot de passe{" "}
                  <strong className="font-medium text-foreground">
                    chiffre la base
                  </strong>{" "}
                  et les sauvegardes : branchée sur un autre poste, la clé ne
                  livre rien, pas même avec un logiciel SQLite.
                </p>
                <p>
                  Restent en clair sur la clé : les PDF que vous exportez dans{" "}
                  <span className="font-mono">exports/</span> — ce sont des
                  bilans nominatifs — et l'historique de navigation de{" "}
                  <span className="font-mono">data/webview/</span>. Activez
                  BitLocker To Go sur la clé pour les couvrir aussi.
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </DataState>

      <TrimesterBoundsDialog
        key={boundsYear}
        yearStart={boundsYear}
        open={boundsOpen}
        onOpenChange={setBoundsOpen}
        onSaved={() => void loadBounds(boundsYear)}
      />

      <Dialog
        open={newPhrase !== null}
        onOpenChange={(open) => {
          if (!open) setNewPhrase(null);
        }}
      >
        <DialogContent
          className="max-h-[90vh] max-w-2xl overflow-y-auto"
          // Un clic à côté ou une touche Échap fermeraient le seul écran où la
          // nouvelle phrase est lisible : elle ne se relit nulle part ensuite.
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Votre nouvelle phrase de récupération</DialogTitle>
            <DialogDescription>
              L'ancienne ne fonctionne plus. Celle-ci ne sera plus jamais
              affichée.
            </DialogDescription>
          </DialogHeader>
          {newPhrase !== null && (
            <RecoveryPhrase
              phrase={newPhrase}
              confirmLabel="J'ai noté la nouvelle phrase"
              regenerated
              onConfirm={() => setNewPhrase(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
