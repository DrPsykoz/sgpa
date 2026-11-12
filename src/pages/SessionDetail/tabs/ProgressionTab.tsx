import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { CalendarRange, Download, FileText } from "lucide-react";

import { DataState } from "@/components/DataState";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EnteteDialog } from "@/pages/SessionDetail/progression/EnteteDialog";
import { EtapesEditor } from "@/pages/SessionDetail/progression/EtapesEditor";
import { FriseProgression } from "@/pages/SessionDetail/progression/FriseProgression";
import { api } from "@/lib/api";
import { exportProgressionPDF } from "@/lib/pdf";
import { schoolYearLabel } from "@/types";
import type {
  Progression,
  Session,
  YearCalendar,
} from "@/types";

export interface ProgressionTabProps {
  session: Session;
}

function messageOf(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Une erreur inattendue est survenue.";
}

/**
 * La progression annuelle d'une classe : **le seul endroit où elle s'écrit.**
 *
 * La vue « Année » de l'emploi du temps montre la même frise et n'y touche pas.
 * Deux écrans qui modifient la même chose finissent par ne pas en dire la même
 * chose — c'est ce qui a fait supprimer l'onglet « Journée » de l'emploi du
 * temps, et la règle vaut ici telle quelle.
 *
 * Une seule progression par classe, donc une classe sans progression est un
 * état normal et non une erreur : `get_progression` rend `null`, et c'est cet
 * écran qui propose de la créer. La lecture n'en crée aucune — ouvrir un onglet
 * ne doit pas écrire.
 */
export function ProgressionTab({ session }: ProgressionTabProps): ReactElement {
  const [progression, setProgression] = useState<Progression | null>(null);
  const [annee, setAnnee] = useState<YearCalendar | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [enteteOpen, setEnteteOpen] = useState(false);

  /** Le nom de l'établissement, en tête du PDF. Lu une fois (voir `load`). */
  const [schoolName, setSchoolName] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  /** Faux par défaut, comme pour les bilans : ouvrir le PDF inscrit son chemin
   *  dans les documents récents du poste, et ce document nomme une classe. */
  const [openAfterExport, setOpenAfterExport] = useState(false);

  /**
   * Rechargement silencieux, sans repasser par `loading`.
   *
   * Un passage par l'état de chargement démonterait la frise entre deux coups
   * de pinceau : la page sauterait, la barre de défilement horizontale
   * reviendrait à gauche, et il faudrait la refaire glisser pour peindre la
   * semaine suivante.
   */
  const recharger = useCallback(async () => {
    const [p, a] = await Promise.all([
      api.getProgression(session.id),
      api.getYearCalendar(session.year_start),
    ]);
    setProgression(p);
    setAnnee(a);
  }, [session.id, session.year_start]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Les réglages sont lus ICI et non dans `recharger` : `recharger` rejoue
      // à chaque coup de pinceau sur la frise, et le nom de l'établissement ne
      // change pas entre deux semaines peintes.
      const [, reglages] = await Promise.all([recharger(), api.getSettings()]);
      setSchoolName(reglages.school_name);
    } catch (err) {
      setLoadError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, [recharger]);

  useEffect(() => {
    void load();
  }, [load]);

  const semainesParActivite = useMemo(() => {
    const compte = new Map<string, number>();
    for (const plage of progression?.plages ?? []) {
      compte.set(plage.activite_id, (compte.get(plage.activite_id) ?? 0) + 1);
    }
    return compte;
  }, [progression]);

  const exporter = async () => {
    if (progression === null || annee === null) return;
    setExporting(true);
    setExportError(null);
    setExportNotice(null);
    try {
      const chemin = await exportProgressionPDF({
        progression,
        session,
        // Le calendrier déjà chargé, celui que la frise affiche : le document
        // imprimé doit être la frise qu'on a sous les yeux, pas une relecture.
        calendar: annee,
        schoolName,
        openAfter: openAfterExport,
      });
      setExportNotice(`Progression enregistrée : ${chemin}`);
    } catch (err) {
      setExportError(messageOf(err));
    } finally {
      setExporting(false);
    }
  };

  const creer = async () => {
    setPending(true);
    setError(null);
    try {
      await api.createProgression(session.id);
      await recharger();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Progression {schoolYearLabel(session.year_start)}</CardTitle>
            <CardDescription>
              Les séquences de l'année, découpées en activités, posées sur
              les semaines réelles du calendrier. Un plan, et non un
              enregistrement : rien ici ne touche une séance, un appel ou un
              bilan.
            </CardDescription>
          </div>
          {progression !== null && (
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEnteteOpen(true)}
              >
                <FileText className="h-4 w-4" />
                En-tête du document
              </Button>
            </div>
          )}
        </CardHeader>

        <CardContent>
          <DataState
            loading={loading}
            error={loadError}
            onRetry={() => {
              void load();
            }}
          >
            {error && (
              <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive">
                {error}
              </p>
            )}

            {progression === null ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <CalendarRange className="h-6 w-6 text-muted-foreground" />
                <p className="max-w-prose text-sm text-muted-foreground">
                  Cette classe n'a pas encore de progression. En créer une ouvre
                  une frise vide sur l'année scolaire : vous y posez vos étapes,
                  vos activités, et les semaines où elles tombent.
                </p>
                <Button
                  disabled={pending}
                  onClick={() => {
                    void creer();
                  }}
                >
                  Planifier l'année
                </Button>
              </div>
            ) : (
              <div className="space-y-8">
                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold">
                      Étapes et activités
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      On définit ici, on place sur la frise. L'ordre des étapes,
                      puis des activités dans chacune, décide de leur couleur.
                    </p>
                  </div>
                  <EtapesEditor
                    progression={progression}
                    semainesParActivite={semainesParActivite}
                    onChanged={recharger}
                  />
                </section>

                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold">Frise de l'année</h3>
                    <p className="text-xs text-muted-foreground">
                      On place ici ce qui a été défini au-dessus. Les
                      colonnes sont les vraies semaines : les vacances et les
                      stages y sont pâles, et restent peignables — le calendrier
                      bouge, et l'application ne vous dicte pas où planifier.
                    </p>
                  </div>
                  <FriseProgression
                    progression={progression}
                    weeks={annee?.weeks ?? []}
                    sessionId={session.id}
                    onChanged={recharger}
                  />
                </section>

                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold">Le document</h3>
                    <p className="text-xs text-muted-foreground">
                      Une feuille A4 en paysage : la frise en haut, le tableau
                      des étapes en bas, et le <strong>numéro</strong> d'une
                      activité pour relier les deux — il survit à une
                      photocopie en noir et blanc, la couleur non. Le PDF part
                      dans <code>exports/</code>, sur la clé.
                    </p>
                  </div>

                  {exportError && (
                    <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive">
                      {exportError}
                    </p>
                  )}
                  {exportNotice && (
                    <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                      {exportNotice}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={exporting || annee === null}
                      onClick={() => {
                        void exporter();
                      }}
                    >
                      <Download />
                      {exporting ? "Export en cours…" : "Exporter en PDF"}
                    </Button>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={openAfterExport}
                        onChange={(event) => {
                          setOpenAfterExport(event.target.checked);
                        }}
                        disabled={exporting}
                      />
                      Ouvrir le PDF après l'export
                    </label>
                  </div>
                </section>
              </div>
            )}
          </DataState>
        </CardContent>
      </Card>

      {progression !== null && (
        <>
          <EnteteDialog
            // Le dialogue tient un brouillon : la clé le réinitialise si la
            // progression change d'identité sous lui (règle 2).
            key={`entete:${progression.id}`}
            open={enteteOpen}
            onOpenChange={setEnteteOpen}
            progression={progression}
            onSubmit={async (titre, intituleGroupe, devise) => {
              await api.updateProgressionMeta(
                progression.id,
                titre,
                intituleGroupe,
                devise,
              );
              await recharger();
            }}
          />
        </>
      )}
    </div>
  );
}
