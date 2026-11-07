import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";

import { estDepotDeFichiers, fichiersDeposes } from "@/lib/depot";
import type { Depot } from "@/lib/depot";

/**
 * Transforme n'importe quel conteneur en zone de glisser-déposer de fichiers.
 *
 * Un seul exemplaire de cette mécanique dans toute l'application, et c'est le
 * but : elle tient en six pièges, chacun venu d'un bug réel, et deux copies
 * divergeraient dès le premier corrigé d'un seul côté. Le cahier de texte d'une
 * séance et le compte rendu d'un rendez-vous l'emploient tous deux — ils
 * partagent déjà l'éditeur, ils partagent maintenant le geste.
 *
 * Le hook ne joint rien et ne connaît ni plafond ni réduction d'image : il
 * **transmet** un `Depot` à `onDepot`. C'est `Attachments` qui décide de son
 * sort, pour qu'un fichier déposé et le même fichier choisi au bouton suivent
 * exactement le même chemin.
 */
export interface ZoneDepot {
  /** Vrai pendant qu'un glissement de fichiers survole la zone. À utiliser pour
   *  afficher le calque — qui doit être `pointer-events-none`, voir plus bas. */
  survol: boolean;
  /** À étaler sur le conteneur : `<div {...zone.props}>`. */
  props: {
    onDragEnterCapture: (event: DragEvent<HTMLElement>) => void;
    onDragOverCapture: (event: DragEvent<HTMLElement>) => void;
    onDragLeaveCapture: (event: DragEvent<HTMLElement>) => void;
    onDropCapture: (event: DragEvent<HTMLElement>) => void;
  };
}

export function useZoneDepot(onDepot: (depot: Depot) => void): ZoneDepot {
  const [survol, setSurvol] = useState(false);

  // Un compteur et non un booléen : `dragleave` se déclenche aussi en passant
  // d'un enfant à l'autre à l'intérieur de la zone. Avec un booléen, le calque
  // clignotait à chaque frontière interne survolée.
  const profondeur = useRef(0);

  // La fonction de dépôt est gardée dans une référence pour que les
  // gestionnaires ne changent pas d'identité à chaque rendu du parent : sans
  // cela, `onDepot` redéfini en ligne dans le JSX réinstallerait le filet
  // ci-dessous à chaque frappe de l'éditeur.
  const depotRef = useRef(onDepot);
  depotRef.current = onDepot;

  const fermer = useCallback(() => {
    profondeur.current = 0;
    setSurvol(false);
  }, []);

  // Filet de sécurité : lâcher le fichier ailleurs dans la fenêtre, ou annuler
  // par Échap, ne déclenche pas forcément un `dragleave` sur la zone — et le
  // calque resterait affiché jusqu'au glissement suivant.
  useEffect(() => {
    if (!survol) return;
    document.addEventListener("drop", fermer);
    document.addEventListener("dragend", fermer);
    return () => {
      document.removeEventListener("drop", fermer);
      document.removeEventListener("dragend", fermer);
    };
  }, [survol, fermer]);

  /**
   * Le filtre que tout traverse, et l'ordre compte.
   *
   * `estDepotDeFichiers` d'abord : un glissement qui ne porte pas de fichiers
   * est un déplacement de texte à l'intérieur de l'éditeur, et il doit passer
   * intact. Sans ce test, la zone avalait la sélection déplacée à la souris.
   *
   * Puis `stopPropagation`, et des gestionnaires posés en phase de **capture**
   * par l'appelant : l'éditeur (ProseMirror) installe ses propres gestionnaires
   * de dépôt sur son nœud, et sans interception en amont il traitait le fichier
   * à sa façon — au mieux rien, au pire le chemin du fichier inséré comme texte
   * dans le compte rendu.
   */
  const porteDesFichiers = (event: DragEvent<HTMLElement>): boolean => {
    if (!estDepotDeFichiers(event.dataTransfer)) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  const onDragEnterCapture = (event: DragEvent<HTMLElement>) => {
    if (!porteDesFichiers(event)) return;
    profondeur.current += 1;
    setSurvol(true);
  };

  const onDragOverCapture = (event: DragEvent<HTMLElement>) => {
    // Le `preventDefault` posé ici est ce qui AUTORISE le dépôt : sans lui,
    // `onDrop` ne se déclenche jamais. Il est dans `porteDesFichiers`.
    if (!porteDesFichiers(event)) return;
    // Le curseur affiche « copier » et non « déplacer » : le fichier d'origine
    // ne bouge pas de son dossier.
    event.dataTransfer.dropEffect = "copy";
  };

  const onDragLeaveCapture = (event: DragEvent<HTMLElement>) => {
    if (!porteDesFichiers(event)) return;
    profondeur.current = Math.max(0, profondeur.current - 1);
    if (profondeur.current === 0) setSurvol(false);
  };

  const onDropCapture = (event: DragEvent<HTMLElement>) => {
    if (!porteDesFichiers(event)) return;
    fermer();
    // Lecture SYNCHRONE du transfert, avant tout `await` : le navigateur vide
    // `dataTransfer` dès que la pile d'appels rend la main.
    depotRef.current(fichiersDeposes(event.dataTransfer));
  };

  return {
    survol,
    props: {
      onDragEnterCapture,
      onDragOverCapture,
      onDragLeaveCapture,
      onDropCapture,
    },
  };
}
