import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { Eraser } from "lucide-react";

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

/** Le pinceau « gomme ». Sentinelle locale : elle ne quitte pas ce fichier. */
const GOMME = "gomme";

interface Trace {
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
 * auraient laissé une frise à moitié peinte en cas d'échec au cinquième.
 */
export function FriseProgression({
  progression,
  weeks,
  sessionId,
  onChanged,
}: FriseProgressionProps): ReactElement {
  const [pinceau, setPinceau] = useState<string>(GOMME);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plages = useMemo(() => indexDesPlages(progression), [progression]);
  const parId = useMemo(() => activitesParId(progression), [progression]);

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

  const poserTrace = (suivante: Trace | null) => {
    traceRef.current = suivante;
    setTrace(suivante);
  };

  const peindre = async (voie: 0 | 1, debut: number, fin: number) => {
    const premier = Math.min(debut, fin);
    const dernier = Math.max(debut, fin);
    const lundis = weeks.slice(premier, dernier + 1).map((w) => w.monday);
    if (lundis.length === 0) return;
    setPending(true);
    setError(null);
    try {
      if (pinceau === GOMME) {
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
    void peindre(encours.voie, encours.debut, encours.fin);
  };

  useEffect(() => {
    terminerRef.current = terminer;
  });

  useEffect(() => {
    const relache = () => terminerRef.current();
    window.addEventListener("pointerup", relache);
    window.addEventListener("pointercancel", relache);
    return () => {
      window.removeEventListener("pointerup", relache);
      window.removeEventListener("pointercancel", relache);
    };
  }, []);

  const activitePeinte = pinceau === GOMME ? null : (parId.get(pinceau) ?? null);

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
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Pinceau</span>
          <Select value={pinceau} onValueChange={setPinceau}>
            <SelectTrigger className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={GOMME}>Gomme — vider les semaines</SelectItem>
              {progression.etapes.map((etape) => (
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

        {activitePeinte === null ? (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Eraser className="h-4 w-4" />
            Glissez sur une bande pour vider ces semaines.
          </span>
        ) : (
          <span
            style={styleTeinteActivite(activitePeinte.rang)}
            className="teinte-carte teinte-appui rounded-md border px-2.5 py-1 text-sm"
          >
            {activitePeinte.libelle}
          </span>
        )}
      </div>

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
                            : `Activité : ${activite.libelle}`,
                          ...raisons,
                        ].join("\n")}
                        className="absolute inset-0 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        onPointerDown={(event) => {
                          event.preventDefault();
                          poserTrace({ voie, debut: index, fin: index });
                        }}
                        onPointerEnter={() => {
                          const encours = traceRef.current;
                          if (encours === null || encours.voie !== voie) return;
                          poserTrace({ ...encours, fin: index });
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          void peindre(voie, index, index);
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
                        <div className="pointer-events-none absolute inset-0 z-20 bg-primary/25" />
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
