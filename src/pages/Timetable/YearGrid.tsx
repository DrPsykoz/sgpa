import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { CalendarRange } from "lucide-react";

import { DataState } from "@/components/DataState";
import {
  ColonnesDeFrise,
  EntetesDeFrise,
  LARGEUR_SEMAINE,
  formatDateDeFrise,
} from "@/components/FriseEntetes";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import {
  MOTS_DE_VOIE,
  VOIES,
  activitesParId,
  casesDeVoie,
  indexDesPlages,
  motifDeLaSemaine,
  tranchesParMotif,
} from "@/lib/progression";
import { styleTeinte, styleTeinteActivite, type TableTeintes } from "@/lib/teintes";
import { cn } from "@/lib/utils";
import { schoolYearLabel } from "@/types";
import type { Progression, Session, YearWeek } from "@/types";

/** Largeur de la colonne de gauche : elle porte un nom de classe, pas un nom
 *  de bande, donc elle est plus large que dans la frise qui se peint. */
const LARGEUR_LEGENDE = 164;

function messageOf(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Une erreur inattendue est survenue.";
}

/** Une classe de l'année et sa progression, `null` si elle n'en a pas encore. */
interface Ligne {
  session: Session;
  progression: Progression | null;
}

export interface YearGridProps {
  /** L'année scolaire regardée, celle que l'écran annonce déjà. */
  yearStart: number;
  /** Toutes les classes connues : la vue filtre elle-même sur l'année. */
  sessions: Session[];
  teintes: TableTeintes;
}

/**
 * L'année entière, toutes classes confondues : une ligne par classe, deux
 * bandes par classe, les vraies semaines en colonnes.
 *
 * **Elle montre et ne modifie pas.** Rien ici n'est cliquable sinon le lien
 * qui mène à l'endroit où la progression s'écrit — la fiche de classe, onglet
 * « Progression ». C'est la règle qui a fait supprimer l'onglet « Journée » :
 * deux écrans qui modifient la même chose finissent par ne pas en dire la même
 * chose. Peindre d'ici demanderait en plus de choisir un pinceau parmi les
 * activités de quatre classes à la fois, ce qui n'a pas de sens.
 *
 * Ce qu'elle apporte et que la fiche de classe ne peut pas donner : la
 * comparaison. On voit d'un coup d'œil la semaine où trois classes font toutes
 * du bois, celle où personne n'a rien prévu, et le trou de février.
 *
 * Les colonnes, les trois en-têtes et le découpage des traits viennent des
 * mêmes modules que la frise qui se peint (`components/FriseEntetes`,
 * `lib/progression`) : c'est la même frise, lue deux fois.
 */
export function YearGrid({
  yearStart,
  sessions,
  teintes,
}: YearGridProps): ReactElement {
  const [weeks, setWeeks] = useState<YearWeek[]>([]);
  const [progressions, setProgressions] = useState<
    ReadonlyMap<string, Progression | null>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Les classes de CETTE année, dans l'ordre où elles s'affichent partout
   *  ailleurs. La teinte, elle, vient de la table globale passée en prop : une
   *  classe garde sa couleur d'un écran à l'autre. */
  const classes = useMemo(
    () =>
      sessions
        .filter((session) => session.year_start === yearStart)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    [sessions, yearStart],
  );

  const charger = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Le calendrier d'abord : sans lui il n'y a pas de colonnes, et une
      // progression sans colonnes où la poser ne s'affiche pas.
      const annee = await api.getYearCalendar(yearStart);
      const lues = await Promise.all(
        classes.map(async (session) => {
          const progression = await api.getProgression(session.id);
          return [session.id, progression] as const;
        }),
      );
      setWeeks(annee.weeks);
      setProgressions(new Map(lues));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, [yearStart, classes]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const lignes: Ligne[] = useMemo(
    () =>
      classes.map((session) => ({
        session,
        progression: progressions.get(session.id) ?? null,
      })),
    [classes, progressions],
  );

  const periodes = useMemo(
    () => tranchesParMotif(weeks).filter((tranche) => tranche.motif !== ""),
    [weeks],
  );

  return (
    <div className="space-y-4">
      <DataState
        loading={loading}
        error={error}
        onRetry={() => {
          void charger();
        }}
        empty={classes.length === 0}
        emptyLabel={`Aucune classe en ${schoolYearLabel(yearStart)} — la progression se planifie par classe.`}
      >
        {weeks.length === 0 ? (
          <p className="rounded-lg border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
            Aucune semaine à afficher pour cette année scolaire. Vérifiez les
            bornes de trimestre dans Réglages : ce sont elles qui décident de
            l'étendue de l'année.
          </p>
        ) : (
          <div className="overflow-x-auto pb-1">
            <table className="w-max border-collapse text-xs">
              <ColonnesDeFrise weeks={weeks} largeurLegende={LARGEUR_LEGENDE} />
              <EntetesDeFrise weeks={weeks} />

              <tbody>
                {/* Le calendrier, écrit une fois par période et non une fois par
                    semaine : « Vacances de Noël » sur deux colonnes se lit, le
                    même mot répété deux fois ne se lit plus. */}
                <tr>
                  <th className="border-b border-r bg-muted/40 px-2 py-1 text-left font-medium text-muted-foreground">
                    Calendrier
                  </th>
                  {tranchesParMotif(weeks).map((tranche) => (
                    <td
                      key={`c${tranche.debut}`}
                      colSpan={tranche.taille}
                      title={tranche.motif === "" ? undefined : tranche.motif}
                      className={cn(
                        "overflow-hidden border-b border-r px-1 py-1 text-center",
                        tranche.motif === ""
                          ? "bg-muted/20"
                          : "bg-muted font-medium text-muted-foreground",
                      )}
                    >
                      <span className="block truncate">
                        {tranche.motif === "" ? "" : tranche.motif}
                      </span>
                    </td>
                  ))}
                </tr>

                {lignes.map((ligne) => (
                  <LigneDeClasse
                    key={ligne.session.id}
                    ligne={ligne}
                    weeks={weeks}
                    teintes={teintes}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataState>

      {periodes.length > 0 && weeks.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Les semaines pâles sont fermées ou écourtées — elles restent
          planifiables : le calendrier bouge, et l'application ne dicte pas où
          planifier.
        </p>
      )}
    </div>
  );
}

interface LigneDeClasseProps {
  ligne: Ligne;
  weeks: readonly YearWeek[];
  teintes: TableTeintes;
}

/**
 * Les deux bandes d'une classe, ou son absence de progression.
 *
 * Un composant à part parce que le découpage des traits se calcule par classe
 * et qu'un `useMemo` par ligne vaut mieux qu'un tableau de tableaux recalculé
 * en entier dès qu'une seule classe change.
 */
function LigneDeClasse({
  ligne,
  weeks,
  teintes,
}: LigneDeClasseProps): ReactElement {
  const { session, progression } = ligne;

  const parId = useMemo(
    () => (progression === null ? null : activitesParId(progression)),
    [progression],
  );

  const cases = useMemo(() => {
    if (progression === null) return null;
    const plages = indexDesPlages(progression);
    return VOIES.map((voie) => casesDeVoie(weeks, plages, voie));
  }, [progression, weeks]);

  const nom = (
    <span
      style={styleTeinte(teintes, session.id)}
      className="teinte-carte inline-block max-w-full truncate rounded-md border px-2 py-0.5 font-medium"
    >
      {session.name}
    </span>
  );

  if (progression === null || cases === null || parId === null) {
    return (
      <tr>
        <th className="border-b border-r px-2 py-1 text-left align-middle font-normal">
          {nom}
        </th>
        <td
          colSpan={weeks.length}
          className="border-b border-r px-2 py-1.5 text-left text-muted-foreground"
        >
          <span className="inline-flex items-center gap-2">
            <CalendarRange className="h-3.5 w-3.5" />
            Aucune progression pour cette classe.
            <Button asChild variant="link" size="sm" className="h-auto p-0">
              <Link to={`/classes/${session.id}?onglet=progression`}>
                La planifier
              </Link>
            </Button>
          </span>
        </td>
      </tr>
    );
  }

  return (
    <>
      {VOIES.map((voie) => (
        <tr key={voie}>
          {voie === 0 && (
            <th
              rowSpan={VOIES.length}
              className="border-b border-r px-2 py-1 text-left align-middle font-normal"
            >
              <Link
                to={`/classes/${session.id}?onglet=progression`}
                className="block max-w-full rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                title={`Ouvrir la progression de ${session.name}`}
              >
                {nom}
              </Link>
            </th>
          )}
          {weeks.map((week, index) => {
            const { activiteId, debutDeTrait, longueur, memeVoisin } =
              cases[voie][index];
            const activite =
              activiteId === null ? null : (parId.get(activiteId) ?? null);
            const motif = motifDeLaSemaine(week);
            const stage =
              week.sessions_away.find((away) => away.session_id === session.id)
                ?.reason ?? null;

            return (
              <td
                key={week.monday}
                style={
                  activite === null
                    ? undefined
                    : styleTeinteActivite(activite.rang)
                }
                title={[
                  `${session.name} — ${MOTS_DE_VOIE[voie]}`,
                  `Semaine ${week.iso_week} — lundi ${formatDateDeFrise(week.monday)}`,
                  activite === null ? "Libre" : `Activité : ${activite.libelle}`,
                  motif === "" ? null : motif,
                  stage === null ? null : `${stage} — toute la classe`,
                ]
                  .filter((l): l is string => l !== null)
                  .join("\n")}
                className={cn(
                  "relative h-8 border-b p-0",
                  memeVoisin ? "border-r-0" : "border-r",
                  activite !== null && "teinte-carte teinte-appui",
                  activite === null &&
                    (motif !== "" || stage !== null) &&
                    "bg-muted/60",
                )}
              >
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
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
