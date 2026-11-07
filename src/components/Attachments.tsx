import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { ReactElement, Ref } from "react";
import {
  AlertTriangle,
  ExternalLink,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Loader2,
  Paperclip,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { api } from "@/lib/api";
import type { Depot } from "@/lib/depot";
import { MAX_ATTACHMENT_BYTES } from "@/types";
import type { Attachment } from "@/types";

/**
 * Le seul verbe que ce composant expose à son parent.
 *
 * Il existe pour que la zone de glisser-déposer puisse couvrir **tout** l'écran
 * de rédaction, éditeur compris : c'est là que le geste tombe naturellement,
 * alors que la logique d'acceptation d'un fichier — réduction, plafond, refus
 * nommés — vit ici et nulle part ailleurs. Le parent transmet un geste, il ne
 * réimplémente rien.
 *
 * Remonter la liste des pièces jointes dans le parent aurait marché aussi, mais
 * aurait fait traverser l'écran de la séance par un état dont il n'affiche rien.
 */
export interface AttachmentsHandle {
  deposer: (depot: Depot) => Promise<void>;
}

/** Ce qui porte les pièces : une séance, ou un rendez-vous.
 *
 *  Un couple `{ kind, id }` et non deux props facultatives : « ni l'un ni
 *  l'autre » et « les deux à la fois » n'existent pas, et les rendre
 *  représentables aurait réclamé un refus à l'exécution là où le compilateur
 *  suffit. */
export type PorteurPieces =
  | { kind: "seance"; id: string }
  | { kind: "entree"; id: string };

export interface AttachmentsProps {
  /** Le porteur, par son identifiant seul : ce composant n'a aucune raison de
   *  détenir une entité qui pourrait vieillir dans sa main (règle 1). */
  porteur: PorteurPieces;
  /** Facultatif : prévient l'hôte que le jeu de pièces a changé, pour qu'il
   *  recharge son entité.
   *
   *  Ce n'est pas un raffinement. Depuis le palier 014, porter une pièce suffit
   *  à régler un compte rendu : `has_attachment` décide de l'icône dans la
   *  fiche de classe, du signe `▣` dans la grille, du nag « Compte rendu à
   *  écrire » à l'accueil. Sans ce rappel, joindre la photo du tableau faisait
   *  taire « À reprendre » tout en laissant les listes réclamer le cahier,
   *  jusqu'au prochain chargement de l'écran — le genre de contradiction qui
   *  fait rouvrir une séance déjà traitée. */
  onChanged?: () => void | Promise<void>;
  /** Posée par le parent pour lui passer les fichiers lâchés sur l'écran.
   *  Prop et non `forwardRef` : React 19 passe `ref` comme n'importe quelle
   *  autre prop. */
  ref?: Ref<AttachmentsHandle>;
}

/** Les cinq appels d'un porteur, et les deux mots qui changent à l'écran.
 *
 *  Le backend tient déjà la logique en un seul endroit (`Porteur` dans
 *  `commands/attachments.rs`) : même plafond, même nom assaini, même export en
 *  clair. Ici il ne reste qu'à choisir la famille d'appels — et le reste de ce
 *  fichier, qui est tout ce qui demande du soin, ne sait pas lequel est en
 *  service. */
const APPELS = {
  seance: {
    lister: api.getSeanceAttachments,
    ajouter: api.addSeanceAttachment,
    lire: api.readSeanceAttachment,
    exporter: api.exportSeanceAttachment,
    supprimer: api.deleteSeanceAttachment,
    zone: "cet onglet",
    exemples: "photo du tableau, PDF distribué, énoncé en .docx",
  },
  entree: {
    lister: api.getEntryAttachments,
    ajouter: api.addEntryAttachment,
    lire: api.readEntryAttachment,
    exporter: api.exportEntryAttachment,
    supprimer: api.deleteEntryAttachment,
    zone: "ce compte rendu",
    exemples: "rapport de visite signé, convention scannée, courrier reçu",
  },
} as const;

/** Côté maximal d'une image stockée.
 *
 *  C'est de là que vient tout le gain de place : une photo de téléphone fait 4
 *  à 8 Mo, la même réduite à 1600 px en fait environ 300 Ko, et 1600 px reste
 *  au-delà de ce qu'un écran d'ordinateur portable affiche. L'original n'est
 *  pas conservé — garder les deux reviendrait à n'avoir rien réduit. */
const COTE_MAX = 1600;

/** Qualité JPEG du réencodage. 0,85 ne se distingue pas de l'original à l'œil
 *  sur une photo, et pèse trois fois moins que 1,0. */
const QUALITE_JPEG = 0.85;

/** Types d'images qu'on accepte de réencoder.
 *
 *  `image/gif` en est exclu : réencoder perdrait l'animation. `image/svg+xml`
 *  aussi, parce qu'il est vectoriel — le « réduire » le rasteriserait, c'est-à-dire
 *  le dégraderait pour rien. Les deux partent tels quels, sous le plafond de
 *  10 Mo comme n'importe quel autre fichier. */
const IMAGES_REDUCTIBLES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/bmp",
  "image/avif",
]);

interface Preparee {
  fileName: string;
  mimeType: string;
  base64: string;
  taille: number;
}

function messageOf(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Une erreur inattendue est survenue.";
}

/** Taille lisible à l'écran. Jumelle de `attachments::human_size` côté Rust,
 *  qui sert aux messages d'erreur — un message d'erreur doit se suffire à
 *  lui-même, il ne peut pas compter sur le front pour être formaté. */
function formatTaille(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

function formatDate(stamp: string): string {
  // `datetime('now')` écrit « 2026-11-06 14:32:01 » en UTC : le « Z » manquant
  // ferait interpréter la chaîne comme une heure locale, et une pièce jointe
  // ajoutée à 00h30 s'afficherait la veille.
  const date = new Date(`${stamp.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
}

/** Le type MIME ne sert QU'À choisir une icône et un mode d'aperçu. Il vient du
 *  navigateur, il peut mentir, et aucune décision de sécurité ne s'appuie
 *  dessus : SGPA n'exécute jamais une pièce jointe. */
type Famille = "image" | "audio" | "video" | "pdf" | "autre";

function familleDe(mimeType: string): Famille {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType === "application/pdf") return "pdf";
  return "autre";
}

const ICONES: Record<Famille, typeof FileText> = {
  image: FileImage,
  audio: FileAudio,
  video: FileVideo,
  pdf: FileText,
  autre: Paperclip,
};

/** Lit un `Blob` en base64 sans en-tête `data:`.
 *
 *  Par `FileReader` et non par `btoa(String.fromCharCode(...bytes))` : l'étalement
 *  d'un tableau de dix millions d'octets en arguments d'appel fait déborder la
 *  pile, et le plantage ne ressemble en rien à sa cause. */
function enBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("Le fichier n'a pas pu être lu depuis le disque."));
    reader.onload = () => {
      const url = String(reader.result);
      const virgule = url.indexOf(",");
      resolve(virgule >= 0 ? url.slice(virgule + 1) : "");
    };
    reader.readAsDataURL(blob);
  });
}

/** Réduit l'image si elle dépasse `COTE_MAX`, sinon rend le fichier intact.
 *
 *  Le réencodage suit le type d'origine : un PNG reste un PNG, tout le reste
 *  part en JPEG. Ce n'est pas une préférence de format — un PNG est presque
 *  toujours une capture d'écran ou un schéma, où le JPEG baverait sur le texte,
 *  tandis qu'une photo en PNG pèserait dix fois son poids en JPEG. */
async function reduire(file: File): Promise<Blob> {
  if (!IMAGES_REDUCTIBLES.has(file.type)) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Image illisible par le moteur : elle part telle quelle. Refuser ici
    // perdrait un fichier que l'enseignant veut peut-être juste conserver.
    return file;
  }

  const facteur = Math.min(
    1,
    COTE_MAX / Math.max(bitmap.width, bitmap.height),
  );
  if (facteur >= 1) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * facteur);
  canvas.height = Math.round(bitmap.height * facteur);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const sortie = file.type === "image/png" ? "image/png" : "image/jpeg";
  const reduite = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, sortie, QUALITE_JPEG),
  );

  // Une réduction qui pèse plus lourd que l'original n'est pas une réduction :
  // cela arrive sur une petite image déjà très compressée.
  return reduite && reduite.size < file.size ? reduite : file;
}

async function preparer(file: File): Promise<Preparee> {
  const blob = await reduire(file);

  if (blob.size === 0) {
    throw new Error(`Le fichier « ${file.name} » est vide : rien à joindre.`);
  }
  // Refus AVANT l'encodage : fabriquer 13 Mo de base64 pour s'entendre dire non
  // fige la fenêtre une seconde entière. Le refus qui fait foi reste celui du
  // backend, celui-ci n'est qu'une politesse.
  if (blob.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `Le fichier « ${file.name} » fait ${formatTaille(blob.size)} : la ` +
        `limite est de ${formatTaille(MAX_ATTACHMENT_BYTES)} par pièce jointe.`,
    );
  }

  // Le nom garde son extension d'origine même si le réencodage a changé le
  // format : « tableau.heic » devenu JPEG resterait illisible sous son ancien
  // nom le jour où la pièce est exportée.
  const renomme =
    blob !== file && blob.type && blob.type !== file.type
      ? `${file.name.replace(/\.[^.]+$/, "")}.${blob.type === "image/png" ? "png" : "jpg"}`
      : file.name;

  return {
    fileName: renomme,
    mimeType: blob.type || file.type,
    base64: await enBase64(blob),
    taille: blob.size,
  };
}

interface Apercu {
  piece: Attachment;
  url: string;
}

/**
 * Pièces jointes d'un compte rendu : la photo du tableau, le PDF distribué,
 * l'énoncé en .docx, un enregistrement audio — ou, pour un rendez-vous, le
 * rapport de visite signé par le tuteur.
 *
 * Les octets vivent dans la base chiffrée (palier 012), et c'est ce qui décide
 * de tout le reste de cet écran :
 *
 * - **l'aperçu se fait dans la fenêtre** — image, son, vidéo et PDF se lisent
 *   d'une URL `blob:` révoquée à la fermeture, donc sans qu'aucune copie en
 *   clair n'existe sur le support ;
 * - **« Ouvrir » écrit une copie en clair** dans `exports/`, parce qu'aucune
 *   application du poste ne sait lire dans une base SQLCipher. L'écran le dit,
 *   et donne le chemin : il y aura quelque chose à effacer.
 */
export function Attachments({
  porteur,
  onChanged,
  ref,
}: AttachmentsProps): ReactElement {
  const appels = APPELS[porteur.kind];

  const [pieces, setPieces] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  // Deux erreurs distinctes : celle du chargement remplace la liste, celle
  // d'une action s'affiche au-dessus sans faire disparaître les pièces déjà là.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [apercu, setApercu] = useState<Apercu | null>(null);
  const [aSupprimer, setASupprimer] = useState<Attachment | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Gardée en référence, et non lue en dépendance : `deposer` est publié par
  // `useImperativeHandle`, et un `onChanged` défini en ligne dans le JSX de
  // l'hôte le redéfinirait à chaque frappe de l'éditeur voisin.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const charger = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setPieces(await appels.lister(porteur.id));
    } catch (err) {
      setLoadError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, [appels, porteur.id]);

  useEffect(() => {
    void charger();
  }, [charger]);

  // Une URL `blob:` garde les octets déchiffrés en mémoire jusqu'à sa
  // révocation. Dans une application qui chiffre tout au repos, les laisser
  // vivre après la fermeture de l'aperçu serait exactement la fuite qu'on
  // cherche à éviter.
  useEffect(() => {
    if (!apercu) return;
    return () => URL.revokeObjectURL(apercu.url);
  }, [apercu]);

  /**
   * Joint tout ce qu'un dépôt apporte — bouton ou glisser-déposer, même chemin.
   *
   * Les deux entrées convergent ici volontairement : c'est la seule façon qu'un
   * fichier déposé et le même fichier choisi au bouton soient réduits de la même
   * manière, refusés sur le même plafond et nommés de la même façon.
   */
  const deposer = useCallback(
    async (depot: Depot) => {
      if (depot.fichiers.length === 0 && depot.dossiers.length === 0) return;

      setBusy(true);
      setActionError(null);
      setNote(null);

      // Un dossier est refusé en le nommant, et sans interrompre les fichiers
      // lâchés à côté de lui : on lâche souvent une sélection mêlée.
      const refus = depot.dossiers.map(
        (nom) =>
          `« ${nom} » est un dossier : ouvrez-le et déposez les fichiers ` +
          `qu'il contient.`,
      );

      for (const file of depot.fichiers) {
        try {
          const prete = await preparer(file);
          await appels.ajouter(
            porteur.id,
            prete.fileName,
            prete.mimeType,
            prete.base64,
          );
        } catch (err) {
          // On ne s'arrête pas au premier refus : joindre cinq fichiers dont un
          // trop gros doit joindre les quatre autres, et nommer celui qui reste.
          refus.push(messageOf(err));
        }
      }

      if (depot.fichiers.length > 0) {
        await charger();
        await onChangedRef.current?.();
      }
      setBusy(false);
      if (refus.length > 0) setActionError(refus.join("\n"));
    },
    [appels, porteur.id, charger],
  );

  useImperativeHandle(ref, () => ({ deposer }), [deposer]);

  const handleApercu = async (piece: Attachment) => {
    setBusy(true);
    setActionError(null);
    setNote(null);
    try {
      const contenu = await appels.lire(piece.id);
      const brut = atob(contenu.content_base64);
      const octets = new Uint8Array(brut.length);
      for (let i = 0; i < brut.length; i += 1) octets[i] = brut.charCodeAt(i);
      const url = URL.createObjectURL(
        new Blob([octets], { type: contenu.mime_type || undefined }),
      );
      setApercu({ piece, url });
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const handleOuvrir = async (piece: Attachment) => {
    setBusy(true);
    setActionError(null);
    setNote(null);
    try {
      const chemin = await appels.exporter(piece.id, true);
      setNote(
        `Une copie de « ${piece.file_name} » a été écrite en clair dans ` +
          `${chemin}. Effacez-la quand vous n'en avez plus besoin : seule ` +
          `celle qui vit dans la base est chiffrée.`,
      );
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSupprimer = async () => {
    if (!aSupprimer) return;
    // La boîte de confirmation referme sur son `onConfirm` : un refus du
    // backend s'y perdrait sans ce `try`, et la pièce semblerait supprimée
    // jusqu'au rechargement.
    try {
      setActionError(null);
      setNote(null);
      await appels.supprimer(aSupprimer.id);
      setASupprimer(null);
      await charger();
      await onChangedRef.current?.();
    } catch (err) {
      setASupprimer(null);
      setActionError(messageOf(err));
    }
  };

  const total = pieces.reduce((somme, piece) => somme + piece.size_bytes, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-base font-medium font-titre">
            <Paperclip className="h-4 w-4 text-muted-foreground" />
            Pièces jointes
            {pieces.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground">
                {pieces.length} · {formatTaille(total)}
              </span>
            )}
          </h3>
          <p className="text-sm text-muted-foreground">
            Glissez-les n'importe où dans {appels.zone}, ou utilisez le
            bouton. Elles sont enregistrées tout de suite, et vivent dans la
            base chiffrée : les sauvegardes les emportent.
          </p>
        </div>
        <div>
          {/* Le vrai champ reste caché : son apparence native n'est pas
              stylable, et son libellé « Choisir des fichiers » est en anglais
              sur certaines installations de Windows. */}
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              void deposer({
                fichiers: Array.from(event.target.files ?? []),
                dossiers: [],
              });
              // Remis à zéro pour que joindre deux fois le même fichier
              // déclenche bien deux fois l'événement.
              event.target.value = "";
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Paperclip className="h-4 w-4" />
            )}
            Joindre des fichiers
          </Button>
        </div>
      </div>

      {actionError && (
        <p className="flex items-start gap-2 whitespace-pre-line rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {actionError}
        </p>
      )}

      {note && (
        <p className="rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">
          {note}
        </p>
      )}

      {loadError ? (
        <div className="flex flex-col items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">{loadError}</p>
          <Button variant="outline" size="sm" onClick={() => void charger()}>
            Réessayer
          </Button>
        </div>
      ) : loading ? (
        <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement…
        </p>
      ) : pieces.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Aucune pièce jointe. Déposez vos fichiers ici — {appels.exemples}.
          Les images sont réduites à {COTE_MAX} px avant d'être enregistrées,
          {formatTaille(MAX_ATTACHMENT_BYTES)} au plus par fichier.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {pieces.map((piece) => {
            const famille = familleDe(piece.mime_type);
            const Icone = ICONES[famille];
            const previsualisable = famille !== "autre";
            return (
              <li
                key={piece.id}
                className="flex items-center gap-3 bg-card px-3 py-2 text-sm"
              >
                <Icone className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  {previsualisable ? (
                    <button
                      type="button"
                      className="block w-full truncate text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      disabled={busy}
                      onClick={() => void handleApercu(piece)}
                    >
                      {piece.file_name}
                    </button>
                  ) : (
                    <p className="truncate font-medium">{piece.file_name}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {formatTaille(piece.size_bytes)}
                    {piece.created_at && ` · ajoutée le ${formatDate(piece.created_at)}`}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Ouvrir avec une application de ce poste (écrit une copie en clair dans exports)"
                  disabled={busy}
                  onClick={() => void handleOuvrir(piece)}
                >
                  <ExternalLink className="h-4 w-4" />
                  <span className="sr-only">Ouvrir hors de SGPA</span>
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Supprimer cette pièce jointe"
                  disabled={busy}
                  onClick={() => setASupprimer(piece)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                  <span className="sr-only">Supprimer</span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={apercu !== null}
        onOpenChange={(open) => {
          if (!open) setApercu(null);
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-8">
              {apercu?.piece.file_name}
            </DialogTitle>
          </DialogHeader>
          {apercu && <Contenu apercu={apercu} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={aSupprimer !== null}
        onOpenChange={(open) => {
          if (!open) setASupprimer(null);
        }}
        title="Supprimer cette pièce jointe ?"
        description={
          aSupprimer
            ? `« ${aSupprimer.file_name} » sera effacée de la base. Les sauvegardes déjà prises la contiennent encore.`
            : ""
        }
        confirmLabel="Supprimer"
        onConfirm={handleSupprimer}
      />
    </div>
  );
}

function Contenu({ apercu }: { apercu: Apercu }): ReactElement {
  const famille = familleDe(apercu.piece.mime_type);
  switch (famille) {
    case "image":
      return (
        <img
          src={apercu.url}
          alt={apercu.piece.file_name}
          className="max-h-[70vh] w-full rounded-md object-contain"
        />
      );
    case "audio":
      return <audio src={apercu.url} controls className="w-full" />;
    case "video":
      return (
        <video
          src={apercu.url}
          controls
          className="max-h-[70vh] w-full rounded-md"
        />
      );
    case "pdf":
      // WebView2 embarque son lecteur PDF : l'iframe suffit, et rien n'est
      // téléchargé — le document reste l'URL `blob:` révoquée à la fermeture.
      return (
        <iframe
          src={apercu.url}
          title={apercu.piece.file_name}
          className="h-[70vh] w-full rounded-md border border-border"
        />
      );
    case "autre":
      return (
        <p className="text-sm text-muted-foreground">
          Ce format ne s'affiche pas dans SGPA. Utilisez « Ouvrir hors de SGPA ».
        </p>
      );
  }
}
