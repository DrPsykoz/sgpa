import { invoke } from "@tauri-apps/api/core";

/**
 * Journalisation côté interface : ce que seul le front voit part dans
 * `data/logs/sgpa-AAAA-MM-JJ.log`.
 *
 * Ce que cela rattrape, et qui disparaissait entièrement : une exception de
 * rendu React (fenêtre blanche), une promesse rejetée sans `catch`, un module
 * qui ne se charge pas. La console de WebView2 n'est pas ouvrable par
 * l'enseignant, et en release il n'y a pas de console du tout : sans ce chemin,
 * la seule information qui remonte est « ça n'a pas marché ».
 *
 * ### Ce qui ne part JAMAIS d'ici
 *
 * Le journal est un fichier **en clair** sur une clé USB qui contient par
 * ailleurs des données d'élèves mineurs. On n'y écrit donc que des artefacts de
 * **code** — un message d'exception, une pile d'appels, un nom de commande — et
 * jamais une valeur venue de la base.
 *
 * Trois endroits de ce fichier existent uniquement pour cela, et chacun vient
 * d'un chemin de fuite réel :
 *
 *  - une `ApiError` ne livre que son **nom de commande**, jamais son message :
 *    plusieurs messages d'erreur français interpolent une valeur de la base, et
 *    l'un d'eux nomme un élève ;
 *  - l'URL d'une ressource en échec n'est réduite qu'à son **schéma** : les
 *    pièces jointes s'affichent par des URL `data:`, donc journaliser l'URL
 *    d'une image qui n'a pas pu se charger aurait recopié la photo dans le
 *    fichier ;
 *  - rien n'est jamais lu du DOM ni de l'état React.
 *
 * ### Il n'échoue jamais, et il ne noie jamais
 *
 * Aucune fonction ne lève : une journalisation qui casse l'écran qu'elle
 * observe est pire que son absence. Et tout est plafonné — une boucle de rendu
 * en défaut journalise des milliers de fois par seconde, ce qui remplirait la
 * clé de l'enseignant.
 */

/** Événements envoyés au plus par session. */
const PLAFOND_TOTAL = 200;

/** Envois au plus pour un même événement : la deuxième occurrence confirme
 *  qu'il se répète, la centième n'apprend rien. */
const PLAFOND_PAR_EVENEMENT = 5;

/** Un détail plus long n'apporte rien : le début d'une pile d'appels porte
 *  toute l'information. Le Rust replafonne de son côté. */
const DETAIL_MAX = 1500;

let total = 0;
const vus = new Map<string, number>();

/**
 * Décide si un événement passe, et le compte.
 *
 * Les deux plafonds ont des rôles distincts : celui par événement empêche une
 * boucle de rendu de noyer le fichier, celui du total empêche cent erreurs
 * distinctes de faire la même chose.
 */
function autorise(signature: string): boolean {
  if (total >= PLAFOND_TOTAL) return false;
  const deja = vus.get(signature) ?? 0;
  if (deja >= PLAFOND_PAR_EVENEMENT) return false;
  vus.set(signature, deja + 1);
  total += 1;
  return true;
}

/**
 * Envoie sans attendre et sans jamais lever.
 *
 * Le `catch` vide est volontaire, à rebours de la règle habituelle du projet :
 * il n'y a personne à qui remonter l'échec d'une journalisation, et surtout pas
 * l'enseignant. Un `console.error` ici serait d'ailleurs sans effet — c'est
 * justement parce que la console n'existe pas que ce fichier existe.
 */
function envoyer(commande: string, args: Record<string, unknown>): void {
  void invoke(commande, args).catch(() => {});
}

/** Une commande Tauri a échoué. Seul son **nom** part au journal. */
export function journaliserEchecDeCommande(commande: string): void {
  if (!autorise(`commande:${commande}`)) return;
  envoyer("log_command_failure", { command: commande });
}

/** Une exception de l'interface. `origine` situe le chemin de capture. */
export function journaliserErreurInterface(
  origine: string,
  detail: string,
): void {
  const abrege = detail.slice(0, DETAIL_MAX);
  // La signature ignore la fin du détail : deux piles d'appels qui ne diffèrent
  // que par un numéro de colonne sont le même défaut.
  if (!autorise(`${origine}:${abrege.slice(0, 200)}`)) return;
  envoyer("log_ui_error", { origin: origine, detail: abrege });
}

/** Message et pile d'une valeur levée, qui n'est pas toujours une `Error`. */
function decrire(valeur: unknown): string {
  if (valeur instanceof Error) {
    // `name` est utile : « TypeError » et « SyntaxError » ne se diagnostiquent
    // pas au même endroit.
    const pile = valeur.stack ? ` ⏎ ${valeur.stack}` : "";
    return `${valeur.name}: ${valeur.message}${pile}`;
  }
  if (typeof valeur === "string") return valeur;
  return Object.prototype.toString.call(valeur);
}

/**
 * Le nom de la commande d'une `ApiError`, si c'en est une.
 *
 * Reconnue par sa forme et non par `instanceof` : importer `ApiError` depuis
 * `api.ts` fermerait un cycle, puisque c'est `api.ts` qui appelle ce module.
 */
function commandeDUneApiError(valeur: unknown): string | null {
  if (valeur instanceof Error && valeur.name === "ApiError") {
    const commande = (valeur as { command?: unknown }).command;
    return typeof commande === "string" ? commande : "inconnue";
  }
  return null;
}

/**
 * Schéma d'une URL, sans l'URL.
 *
 * C'est le seul fragment qu'on a le droit d'inscrire : il distingue un chemin
 * d'asset cassé (`tauri:`, `http:`) d'une pièce jointe illisible (`data:`,
 * `blob:`) — ce qui suffit à savoir où chercher — sans recopier le contenu
 * d'une image d'élève, qu'une URL `data:` porte en entier.
 */
function schemaDe(url: string): string {
  const fin = url.indexOf(":");
  return fin > 0 ? url.slice(0, fin) : "relatif";
}

/**
 * Pose les deux filets globaux et rend la fonction qui les retire.
 *
 * Installé dans `main.tsx`, donc **avant** le premier rendu de React : une
 * exception levée pendant le montage initial est exactement celle qu'on ne
 * verrait jamais autrement.
 */
export function installerCaptureDErreurs(): () => void {
  const surErreur = (ev: Event) => {
    if (ev instanceof ErrorEvent) {
      const lieu = ev.filename ? ` (${ev.filename}:${ev.lineno})` : "";
      journaliserErreurInterface(
        "exception",
        `${ev.error ? decrire(ev.error) : ev.message}${lieu}`,
      );
      return;
    }

    // Pas une `ErrorEvent` : c'est une ressource qui n'a pas pu se charger.
    // L'événement ne remonte pas jusqu'à `window` par propagation, d'où la
    // capture plus bas.
    const cible = ev.target;
    if (!(cible instanceof HTMLElement)) return;
    const url =
      cible.getAttribute("src") ?? cible.getAttribute("href") ?? "";
    journaliserErreurInterface(
      "ressource",
      `<${cible.tagName.toLowerCase()}> non chargé, schéma « ${schemaDe(url)} »`,
    );
  };

  const surRejet = (ev: PromiseRejectionEvent) => {
    const commande = commandeDUneApiError(ev.reason);
    if (commande !== null) {
      // Le message est déjà écarté par construction : `log_command_failure` n'a
      // pas de paramètre où le mettre.
      journaliserEchecDeCommande(commande);
      return;
    }
    journaliserErreurInterface("promesse", decrire(ev.reason));
  };

  // Phase de **capture** pour les deux : les erreurs de chargement de ressource
  // ne se propagent pas, et ne seraient donc jamais vues en phase de bouillon.
  window.addEventListener("error", surErreur, true);
  window.addEventListener("unhandledrejection", surRejet);

  return () => {
    window.removeEventListener("error", surErreur, true);
    window.removeEventListener("unhandledrejection", surRejet);
  };
}
