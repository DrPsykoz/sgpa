import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ColonnesDeFrise,
  EntetesDeFrise,
  LARGEUR_SEMAINE,
  formatDateDeFrise,
} from "@/components/FriseEntetes";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { styleTeinteActivite } from "@/lib/teintes";
import {
  MOTS_DE_VOIE,
  VOIES,
  activitesParId,
  casesDeVoie,
  indexDesPlages,
  motifDeLaSemaine,
  semainePlanifiable,
} from "@/lib/progression";
import type { Progression, YearWeek } from "@/types";

/** Largeur de la colonne des en-têtes de ligne, à gauche. La largeur d'une
 *  colonne de semaine, elle, est partagée avec la vue annuelle : c'est la même
 *  frise, lue deux fois. */
const LARGEUR_LEGENDE = 124;

/** Ce que fait le geste en cours, décidé par le bouton de la souris et non
 *  plus par une entrée « gomme » du sélecteur. Sentinelle locale : elle ne
 *  quitte pas ce fichier, et le backend n'en sait rien — il a ses deux
 *  commandes, `set_progression_plages` et `clear_progression_plages`, depuis le
 *  palier 019. */
type Mode = "poser" | "effacer";

interface Trace {
  mode: Mode;
  voie: 0 | 1;
  debut: number;
  fin: number;
}

export interface FriseProgressionProps {
  progression: Progression;
  /** Les vraies semaines de l'année, rendues par `get_year_calendar`. */
  weeks: YearWeek[];
  sessionId: string;
  /** Le parent recharge la progression entière après chaque écriture. */
  onChanged: () => Promise<void>;
}

function messageOf(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Une erreur inattendue est survenue.";
}

/** Un groupe de semaines consécutives partageant le même motif de fermeture ou
 *  le même stage, pour la liste sous la frise. */
interface Periode {
  motif: string;
  premiere: YearWeek;
  derniere: YearWeek;
}

function regrouper(
  weeks: readonly YearWeek[],
  motifDe: (week: YearWeek) => string,
): Periode[] {
  const periodes: Periode[] = [];
  let precedentIndex = -2;
  for (const [index, week] of weeks.entries()) {
    const motif = motifDe(week);
    if (motif === "") continue;
    const dernier = periodes[periodes.length - 1];
    if (dernier && dernier.motif === motif && precedentIndex === index - 1) {
      dernier.derniere = week;
    } else {
      periodes.push({ motif, premiere: week, derniere: week });
    }
    precedentIndex = index;
  }
  return periodes;
}

function phrasePeriode(periode: Periode): string {
  if (periode.premiere.monday === periode.derniere.monday) {
    return `semaine ${periode.premiere.iso_week}`;
  }
  return `semaines ${periode.premiere.iso_week} à ${periode.derniere.iso_week}`;
}

/**
 * La frise de l'année : quarante-cinq colonnes, deux bandes, un pinceau.
 *
 * **Les colonnes sont les vraies semaines**, pas quatre par mois. Le document
 * d'origine en comptait quarante — dix mois de quatre semaines —, et une
 * progression bâtie sur ce compte rond déborde en juin sans qu'une seule case
 * l'annonce. Chaque colonne porte donc son numéro ISO, et le mois d'une semaine
 * est celui de son **jeudi** : une partition, décidée en Rust, que le front ne
 * recalcule pas.
 *
 * **Les vacances et les stages sont lus, pas peints.** Une académie qui déplace
 * les vacances déplace la colonne pâle, sans que personne ait à repasser sur la
 * frise. C'est aussi pourquoi poser une activité sur une semaine fermée n'est
 * **pas refusé** : le calendrier bouge, et un refus aurait effacé en silence une
 * plage déjà posée au premier changement. La frise le dit en pâlissant la
 * colonne, et laisse l'enseignant décider — une semaine de stage peut très bien
 * porter « Rapports de stage ».
 *
 * Le geste est le glissement : on enfonce sur la première semaine, on relâche
 * sur la dernière, et **une seule** commande écrit la bande entière. Huit appels
 * auraient laissé une frise à moitié peinte en cas d'échec au cinquième. Le
 * relâchement s'écoute sur la fenêtre, et `blur`, `Échap` et `pointercancel`
 * **abandonnent** le tracé sans rien écrire : sans eux, un Alt-Tab en plein
 * glissement laissait le tracé accroché au curseur, et le premier relâchement
 * suivant — n'importe où sur la page — peignait une bande que personne n'avait
 * voulue. Même doctrine que les bandes de `WeekGrid`, et même liste d'écouteurs.
 *
 * **Le bouton de la souris décide du geste**, demandé le 2026-11-09 : clic
 * gauche pose l'activité choisie, clic droit l'efface. Le pinceau « gomme »
 * était une entrée du sélecteur, et effacer deux semaines au milieu d'une année
 * peinte demandait trois gestes — changer de pinceau, gommer, retrouver son
 * activité dans une liste groupée par étape. Il n'est pas retiré sans
 * remplaçant : le clic droit à la souris, **`Suppr` ou `Retour arrière` au
 * clavier**, les cases restant atteignables par tabulation. Un geste de souris
 * sans équivalent au clavier aurait rendu la moitié de la frise inatteignable
 * sans souris, et c'est la raison même qui fait vivre « Un autre cours à cet
 * horaire » dans `SlotDialog`.
 *
 * **Les deux gestes ont la même portée**, et c'est délibéré : une case cliquée
 * est une semaine, un glissement est une bande. Le clic droit n'efface donc
 * **pas** le trait entier sous le curseur — sur un trait de vingt semaines, un
 * clic aurait emporté la moitié d'une année sans rien demander, et la frise n'a
 * pas d'annulation.
 */
export function FriseProgression({
  progression,
  weeks,
  sessionId,
  onChanged,
}: FriseProgressionProps): ReactElement {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plages = useMemo(() => indexDesPlages(progression), [progression]);
  const parId = useMemo(() => activitesParId(progression), [progression]);

  /** Les étapes qui ont au moins une activité : une étape vide n'a rien à
   *  offrir au sélecteur, et son intitulé seul y passerait pour un choix. */
  const etapesPeignables = useMemo(
    () => progression.etapes.filter((etape) => etape.activites.length > 0),
    [progression],
  );
  const premiereActivite = etapesPeignables[0]?.activites[0]?.id ?? "";

  const [pinceau, setPinceau] = useState<string>(premiereActivite);

  // Le pinceau est un **identifiant**, pas une activité figée (règle 1) : il
  // peut disparaître sous nos pieds, l'éditeur juste au-dessus pouvant
  // supprimer l'activité ou l'étape qui la portait. On retombe alors sur la
  // première activité — un identifiant mort aurait fait échouer l'écriture avec
  // un message de clé étrangère au lieu d'une phrase en français.
  useEffect(() => {
    if (pinceau !== "" && parId.has(pinceau)) return;
    if (pinceau === premiereActivite) return;
    setPinceau(premiereActivite);
  }, [pinceau, parId, premiereActivite]);

  /** Les traits de chaque bande, calculés une fois : le découpage est
   *  partagé avec la vue annuelle, qui lit la même frise sans la peindre. */
  const cases = useMemo(
    () => VOIES.map((voie) => casesDeVoie(weeks, plages, voie)),
    [weeks, plages],
  );

  const fermetures = useMemo(
    () => regrouper(weeks, motifDeLaSemaine),
    [weeks],
  );
  const horsCours = useMemo(
    () =>
      regrouper(
        weeks,
        (week) =>
          week.sessions_away.find((away) => away.session_id === sessionId)
            ?.reason ?? "",
      ),
    [weeks, sessionId],
  );

  // Le relâchement arrive souvent hors de la case où il a commencé — et parfois
  // hors du tableau. Il s'écoute donc sur la fenêtre, et la trace passe par une
  // référence pour que l'écouteur, posé une seule fois, lise toujours la
  // dernière.
  const traceRef = useRef<Trace | null>(null);
  const terminerRef = useRef<() => void>(() => {});
  /** Vrai entre l'enfoncement du bouton droit et le `contextmenu` qui le suit.
   *  Voir l'écouteur `menu` plus bas : il ne supprime le menu du système que
   *  pour un clic droit qui nous était destiné. */
  const clicDroitRef = useRef(false);

  const poserTrace = (suivante: Trace | null) => {
    traceRef.current = suivante;
    setTrace(suivante);
  };

  const peindre = async (
    mode: Mode,
    voie: 0 | 1,
    debut: number,
    fin: number,
  ) => {
    const premier = Math.min(debut, fin);
    const dernier = Math.max(debut, fin);
    const lundis = weeks.slice(premier, dernier + 1).map((w) => w.monday);
    if (lundis.length === 0) return;
    if (mode === "poser" && pinceau === "") {
      setError(
        "Choisissez d'abord une activité : la frise place ce qui a été défini " +
          "au-dessus, elle ne l'invente pas.",
      );
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (mode === "effacer") {
        await api.clearProgressionPlages(progression.id, lundis, voie);
      } else {
        await api.setProgressionPlages(progression.id, lundis, voie, pinceau);
      }
      await onChanged();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPending(false);
    }
  };

  const terminer = () => {
    const encours = traceRef.current;
    if (encours === null) return;
    poserTrace(null);
    void peindre(encours.mode, encours.voie, encours.debut, encours.fin);
  };

  useEffect(() => {
    terminerRef.current = terminer;
  });

  useEffect(() => {
    const relache = () => terminerRef.current();

    // Abandonner, c'est oublier le tracé **sans écrire**. `pointercancel`
    // couvre le doigt que le navigateur reprend pour défiler ; `blur`, l'Alt-Tab
    // en plein glissement ; `Échap`, le repentir.
    const abandon = () => {
      if (traceRef.current === null) return;
      traceRef.current = null;
      setTrace(null);
    };
    const touche = (event: KeyboardEvent) => {
      if (event.key === "Escape") abandon();
    };

    // Le menu contextuel de WebView2 n'a rien à faire par-dessus la frise : ici
    // le clic droit est un geste de l'application. Il n'est supprimé que pour
    // ce geste-là — ailleurs dans la page, le clic droit reste celui du
    // système. Sous Windows l'événement arrive **après** `pointerup`, donc la
    // trace est déjà consommée quand il passe : c'est un drapeau posé à
    // l'enfoncement qui dit « ce clic droit était pour nous », et il se rend au
    // premier enfoncement suivant.
    const menu = (event: MouseEvent) => {
      if (!clicDroitRef.current) return;
      clicDroitRef.current = false;
      event.preventDefault();
    };

    window.addEventListener("pointerup", relache);
    window.addEventListener("pointercancel", abandon);
    window.addEventListener("blur", abandon);
    window.addEventListener("keydown", touche);
    window.addEventListener("contextmenu", menu);
    return () => {
      window.removeEventListener("pointerup", relache);
      window.removeEventListener("pointercancel", abandon);
      window.removeEventListener("blur", abandon);
      window.removeEventListener("keydown", touche);
      window.removeEventListener("contextmenu", menu);
    };
  }, []);

  const activitePeinte = pinceau === "" ? null : (parId.get(pinceau) ?? null);

  if (weeks.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
        Aucune semaine à afficher pour cette année scolaire. Vérifiez les bornes
        de trimestre dans Réglages : ce sont elles qui décident de l'étendue de
        la frise.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {premiereActivite === "" ? (
        <p className="text-sm text-muted-foreground">
          Aucune activité à poser. Créez-en une dans « Étapes et activités »,
          juste au-dessus : la frise place ce qui y est défini, elle ne l'invente
          pas.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Activité</span>
            <Select value={pinceau} onValueChange={setPinceau}>
              <SelectTrigger className="w-72">
                <SelectValue placeholder="Choisissez une activité" />
              </SelectTrigger>
              <SelectContent>
                {etapesPeignables.map((etape) => (
                  <SelectGroup key={etape.id}>
                    <SelectLabel>{etape.libelle}</SelectLabel>
                    {etape.activites.map((activite) => (
                      <SelectItem key={activite.id} value={activite.id}>
                        {activite.libelle}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          {activitePeinte !== null && (
            <span
              style={styleTeinteActivite(activitePeinte.rang)}
              className="teinte-carte teinte-appui rounded-md border px-2.5 py-1 text-sm"
            >
              {activitePeinte.libelle}
            </span>
          )}

          {/* Les mots du geste vivent ici, à portée de la main qui le fait, et
              nulle part ailleurs : le pavé de la section au-dessus a cessé de
              les redire, deux rédactions du même geste divergeant au premier
              bouton ajouté. */}
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Clic gauche</span> pose
            cette activité,{" "}
            <span className="font-medium text-foreground">clic droit</span>{" "}
            efface. Glissez pour couvrir plusieurs semaines d'un coup. Au
            clavier : <span className="font-medium text-foreground">Entrée</span>{" "}
            pose, <span className="font-medium text-foreground">Suppr</span>{" "}
            efface.
          </p>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      <div className="overflow-x-auto pb-1">
        <table
          className={cn(
            "w-max border-collapse select-none text-xs",
            pending && "opacity-60",
          )}
        >
          <ColonnesDeFrise weeks={weeks} largeurLegende={LARGEUR_LEGENDE} />
          <EntetesDeFrise weeks={weeks} />

          <tbody>
            {VOIES.map((voie) => (
              <tr key={voie}>
                <th className="border-b border-r px-2 py-1 text-left font-medium text-muted-foreground">
                  {MOTS_DE_VOIE[voie]}
                </th>
                {weeks.map((week, index) => {
                  const { activiteId, debutDeTrait, longueur, memeVoisin } =
                    cases[voie][index];
                  const activite =
                    activiteId === null
                      ? null
                      : (parId.get(activiteId) ?? null);


                  const dansLaTrace =
                    trace !== null &&
                    trace.voie === voie &&
                    index >= Math.min(trace.debut, trace.fin) &&
                    index <= Math.max(trace.debut, trace.fin);

                  const planifiable = semainePlanifiable(week, sessionId);
                  const motif = motifDeLaSemaine(week);
                  const stage =
                    week.sessions_away.find(
                      (away) => away.session_id === sessionId,
                    )?.reason ?? null;

                  const raisons = [
                    motif === "" ? null : motif,
                    stage === null ? null : `${stage} — toute la classe`,
                  ].filter((r): r is string => r !== null);

                  return (
                    <td
                      key={week.monday}
                      style={
                        activite === null
                          ? undefined
                          : styleTeinteActivite(activite.rang)
                      }
                      className={cn(
                        "relative h-9 border-b p-0",
                        memeVoisin ? "border-r-0" : "border-r",
                        activite !== null && "teinte-carte teinte-appui",
                        activite === null && !planifiable && "bg-muted/60",
                      )}
                    >
                      <button
                        type="button"
                        disabled={pending}
                        aria-label={`${MOTS_DE_VOIE[voie]}, semaine ${week.iso_week} du ${formatDateDeFrise(week.monday)}${activite === null ? " — libre" : ` — ${activite.libelle}`}`}
                        title={[
                          `Semaine ${week.iso_week} — lundi ${formatDateDeFrise(week.monday)}`,
                          activite === null
                            ? "Libre"
                            : `Activité : ${activite.libelle} — clic droit pour l'effacer`,
                          ...raisons,
                        ].join("\n")}
                        className="absolute inset-0 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        onPointerDown={(event) => {
                          // Le bouton du milieu colle la sélection sous X11 et
                          // ouvre un onglet ailleurs : il n'a pas de geste ici,
                          // et en inventer un serait une surprise.
                          if (event.button !== 0 && event.button !== 2) return;
                          event.preventDefault();
                          clicDroitRef.current = event.button === 2;
                          poserTrace({
                            mode: event.button === 2 ? "effacer" : "poser",
                            voie,
                            debut: index,
                            fin: index,
                          });
                        }}
                        onPointerEnter={() => {
                          const encours = traceRef.current;
                          if (encours === null || encours.voie !== voie) return;
                          poserTrace({ ...encours, fin: index });
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            void peindre("poser", voie, index, index);
                            return;
                          }
                          // Le remplaçant clavier du clic droit. Les deux
                          // touches, parce que « Suppr » manque à certains
                          // portables.
                          if (
                            event.key === "Delete" ||
                            event.key === "Backspace"
                          ) {
                            event.preventDefault();
                            void peindre("effacer", voie, index, index);
                          }
                        }}
                      />

                      {debutDeTrait && activite !== null && (
                        <div
                          className="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center overflow-hidden px-1"
                          style={{ width: longueur * LARGEUR_SEMAINE - 2 }}
                        >
                          <span className="truncate text-[11px] font-medium leading-none">
                            {activite.libelle}
                          </span>
                        </div>
                      )}

                      {dansLaTrace && (
                        <div
                          className={cn(
                            "pointer-events-none absolute inset-0 z-20",
                            trace?.mode === "effacer"
                              ? "bg-destructive/20"
                              : "bg-primary/25",
                          )}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(fermetures.length > 0 || horsCours.length > 0) && (
        <div className="grid gap-x-8 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
          {fermetures.map((periode) => (
            <p key={`f${periode.premiere.monday}`}>
              <span className="font-medium">{periode.motif}</span> —{" "}
              {phrasePeriode(periode)}
            </p>
          ))}
          {horsCours.map((periode) => (
            <p key={`s${periode.premiere.monday}`}>
              <span className="font-medium">{periode.motif}</span> —{" "}
              {phrasePeriode(periode)}, toute la classe
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
