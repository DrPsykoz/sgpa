/**
 * « Ce cahier de texte est-il vide ? » — une seule définition.
 *
 * Un document vide ne vaut pas `""` : l'éditeur rend `<p></p>`, et un `<p></p>`
 * de plus par ligne laissée blanche. Un cahier rempli puis effacé repart donc
 * avec un paragraphe vide, et le test naïf `html === ""` le déclarerait rempli.
 *
 * **Le backend applique la même règle**, en SQL, dans `SEANCES_PASSEES` et
 * `ENTREES_PASSEES` (`src-tauri/src/commands/home.rs`) : c'est elle qui décide
 * si une séance atterrit dans « À reprendre » sur l'accueil. Les deux doivent
 * donc dire la même chose — un écran qui marque « vide » pendant que l'accueil
 * déclare la séance faite envoie l'enseignant chercher un travail déjà fait.
 * Si cette fonction change, la requête change avec elle.
 */
export function aDuContenu(html: string): boolean {
  return (
    html
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim().length > 0
  );
}

/** Ce que les listes portent d'un compte rendu : le texte, la renonciation, les
 *  pièces. `DaySeance` et `AgendaEntrySummary` exposent exactement ces trois
 *  champs, et c'est tout ce qu'il faut pour décider. */
export interface EtatCompteRendu {
  has_content: boolean;
  content_waived: boolean;
  has_attachment: boolean;
}

/** Pourquoi un compte rendu est réglé — ou pourquoi il ne l'est pas.
 *
 * `vide` est le seul état qui réclame quelque chose. Les trois autres sont les
 * trois sorties que le backend accorde dans `home.rs` (`content_missing &&
 * !content_waived && !has_attachment`), **dans le même ordre de priorité** :
 * un compte rendu rédigé se dit rédigé même s'il porte en plus une pièce
 * jointe.
 *
 * Une seule fonction pour toute l'interface, et c'est l'essentiel : le bouton
 * « rien à écrire » ne vaut que si TOUS les écrans cessent de réclamer. Un
 * calendrier qui garderait sa propre version de la règle afficherait « compte
 * rendu à écrire » à côté d'un accueil qui vient d'arrêter de le demander —
 * sur le même écran, l'accueil portant les deux.
 */
export type EtatRendu = "redige" | "renonce" | "piece" | "vide";

export function etatDuCompteRendu(etat: EtatCompteRendu): EtatRendu {
  if (etat.has_content) return "redige";
  if (etat.content_waived) return "renonce";
  if (etat.has_attachment) return "piece";
  return "vide";
}

/**
 * La même règle vue depuis l'entité complète.
 *
 * La fiche de classe liste des `Seance` entières — le corps rédigé, et
 * l'horodatage de la renonciation —, là où les calendriers n'en portent qu'un
 * résumé déjà réduit à trois booléens. Deux formes en entrée, **un seul juge**
 * ensuite : c'est tout l'objet de cette fonction, qui ne décide rien et se
 * contente de traduire.
 */
export function renduDeLaSeance(seance: {
  content_html: string;
  content_waived_at: string | null;
  has_attachment: boolean;
}): EtatCompteRendu {
  return {
    has_content: aDuContenu(seance.content_html),
    content_waived: seance.content_waived_at !== null,
    has_attachment: seance.has_attachment,
  };
}

/** Vrai dès que plus rien n'est attendu. Jumelle du filtre de `home.rs`. */
export function compteRenduRegle(etat: EtatCompteRendu): boolean {
  return etatDuCompteRendu(etat) !== "vide";
}

/**
 * Les mots de chaque état, dits une seule fois.
 *
 * Deux vocabulaires parce que ce sont deux objets : une séance a un **cahier
 * de texte**, un rendez-vous un **compte rendu**. Et deux registres parce que
 * ce sont deux places : `carte` est ce qu'une case de 7 rem a la place
 * d'écrire, `infobulle` ce que le `title=` dit en toutes lettres.
 *
 * Ces libellés vivent ici, à côté de la règle, et non dans
 * `pages/Timetable/journee.ts` : les deux calendriers ne sont pas seuls à les
 * afficher — la liste des rendez-vous d'un élève, dans la fiche de classe, dit
 * la même chose et n'a rien à voir avec une journée.
 */
export interface MotsDuRendu {
  /** Pour une carte de calendrier. En minuscules pour le cahier — il suit
   *  l'appel, séparé par « · » ; capitalisé pour le compte rendu, seul sur sa
   *  ligne. */
  carte: string;
  /** Pour une infobulle : la phrase, sans point final — l'appelant l'enchaîne
   *  aux autres. */
  infobulle: string;
}

const MOTS_DU_CAHIER: Record<EtatRendu, MotsDuRendu> = {
  redige: { carte: "cahier écrit", infobulle: "cahier de texte rempli" },
  renonce: {
    carte: "rien à écrire",
    infobulle: "cahier de texte : rien à écrire",
  },
  piece: {
    carte: "cahier en pièce jointe",
    infobulle: "cahier de texte porté par une pièce jointe",
  },
  vide: { carte: "cahier vide", infobulle: "cahier de texte vide" },
};

const MOTS_DU_COMPTE_RENDU: Record<EtatRendu, MotsDuRendu> = {
  redige: { carte: "Compte rendu écrit", infobulle: "compte rendu rédigé" },
  renonce: {
    carte: "Rien à écrire",
    infobulle: "compte rendu : rien à écrire",
  },
  piece: {
    carte: "Compte rendu joint",
    infobulle: "compte rendu porté par une pièce jointe",
  },
  vide: { carte: "Compte rendu à écrire", infobulle: "compte rendu vide" },
};

export function motsDuCahier(etat: EtatCompteRendu): MotsDuRendu {
  return MOTS_DU_CAHIER[etatDuCompteRendu(etat)];
}

export function motsDuCompteRendu(etat: EtatCompteRendu): MotsDuRendu {
  return MOTS_DU_COMPTE_RENDU[etatDuCompteRendu(etat)];
}
