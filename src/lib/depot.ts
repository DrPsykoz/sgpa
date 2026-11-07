/**
 * Le glisser-déposer de fichiers, en un seul endroit.
 *
 * SGPA désactive le gestionnaire de dépôt de Tauri — `disable_drag_drop_handler()`
 * sur le constructeur de fenêtre, dans `src-tauri/src/lib.rs`. C'est ce choix qui
 * rend ce module à la fois possible et obligatoire.
 *
 * **Possible** : WebView2 livre alors au DOM de vrais objets `File`, avec leurs
 * octets. L'événement de Tauri, lui, ne donne que des chemins — il aurait fallu
 * lire le fichier en Rust, donc sauter la réduction à 1600 px que fait le front,
 * et une photo de téléphone déposée aurait été refusée à 8 Mo quand la même,
 * choisie au bouton, passe à 300 Ko.
 *
 * **Obligatoire** : privé du gestionnaire de Tauri, WebView2 applique le
 * comportement par défaut d'un navigateur et **navigue vers le fichier lâché**.
 * Lâcher un PDF sur le menu remplacerait l'application par ce PDF, et il n'y a
 * pas de barre d'adresse pour revenir. D'où `interdireNavigationParDepot`, posé
 * une fois pour toute la fenêtre.
 */

/**
 * Ce glissement transporte-t-il des fichiers venus du disque ?
 *
 * On interroge `types` et non `files` : pendant `dragover`, le navigateur cache
 * encore le contenu — `files` est vide jusqu'au `drop`, et s'y fier ferait
 * passer tout survol pour un glissement de texte.
 *
 * C'est la question qui protège l'éditeur du cahier de texte : déplacer une
 * sélection de texte à la souris est aussi un glissement, mais ses types sont
 * `text/html` et `text/plain`. Sans ce test, une zone de dépôt avalerait ce
 * geste et le déplacement de paragraphe ne marcherait plus.
 */
export function estDepotDeFichiers(transfert: DataTransfer | null): boolean {
  if (!transfert) return false;
  // `types` est un `DOMStringList` sur les vieux moteurs, pas un tableau : on
  // passe par `Array.from` plutôt que par `includes`.
  return Array.from(transfert.types).includes("Files");
}

/** Ce qu'un dépôt a réellement apporté. */
export interface Depot {
  fichiers: File[];
  /** Noms des dossiers lâchés. Un dossier n'est pas un fichier : il n'a pas
   *  d'octets à joindre, et le refuser en le nommant vaut mieux que le laisser
   *  échouer plus loin sous un message qui parlerait de fichier vide. */
  dossiers: string[];
}

/**
 * Trie le contenu d'un dépôt entre fichiers et dossiers.
 *
 * **À appeler de façon synchrone dans le gestionnaire de `drop`.** Le
 * `DataTransfer` est vidé dès que la pile d'appels rend la main : un seul
 * `await` placé avant cette ligne et les fichiers ont disparu.
 */
export function fichiersDeposes(transfert: DataTransfer | null): Depot {
  const fichiers: File[] = [];
  const dossiers: string[] = [];
  if (!transfert) return { fichiers, dossiers };

  for (const item of Array.from(transfert.items ?? [])) {
    if (item.kind !== "file") continue;
    // `webkitGetAsEntry` est le seul moyen de distinguer un dossier d'un
    // fichier vide : les deux arrivent avec une taille de zéro octet.
    const entree = item.webkitGetAsEntry?.();
    if (entree?.isDirectory) {
      dossiers.push(entree.name);
      continue;
    }
    const fichier = item.getAsFile();
    if (fichier) fichiers.push(fichier);
  }

  // Repli si `items` n'a rien donné — il n'est pas garanti partout, alors que
  // `files` l'est. On ne replie que sur un dépôt entièrement muet : un dossier
  // seul a bien été vu, et le repli le ferait réapparaître comme fichier vide.
  if (fichiers.length === 0 && dossiers.length === 0) {
    return { fichiers: Array.from(transfert.files ?? []), dossiers };
  }
  return { fichiers, dossiers };
}

/**
 * Empêche la fenêtre de naviguer vers un fichier lâché hors d'une zone de dépôt.
 *
 * Posé sur `document` en phase de remontée, donc **après** les zones : celle qui
 * a traité le dépôt a déjà appelé `preventDefault`, et on la laisse tranquille.
 * Partout ailleurs, le curseur affiche un refus et le `drop` n'a pas lieu.
 *
 * Un glissement qui ne transporte pas de fichiers n'est jamais touché : c'est le
 * déplacement de texte dans l'éditeur, et l'avaler le casserait.
 *
 * @returns la fonction de retrait, à rendre depuis l'effet qui l'a posé.
 */
export function interdireNavigationParDepot(): () => void {
  const avaler = (event: DragEvent) => {
    if (!estDepotDeFichiers(event.dataTransfer)) return;
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (event.dataTransfer) {
      // `preventDefault` seul AUTORISE le dépôt — c'est son sens sur
      // `dragover`. C'est `dropEffect = "none"` qui le refuse, et qui met le
      // curseur barré : ici, lâcher ne fera rien, et on le dit avant le clic.
      event.dataTransfer.dropEffect = "none";
    }
  };

  document.addEventListener("dragover", avaler);
  document.addEventListener("drop", avaler);
  return () => {
    document.removeEventListener("dragover", avaler);
    document.removeEventListener("drop", avaler);
  };
}
