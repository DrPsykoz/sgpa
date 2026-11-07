import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { DataState } from "@/components/DataState";
import { NeedsProvider } from "@/hooks/useNeeds";
import { StudentsTab } from "@/pages/SessionDetail/tabs/StudentsTab";
import { EvaluationsTab } from "@/pages/SessionDetail/tabs/EvaluationsTab";
import { SeancesTab } from "@/pages/SessionDetail/tabs/SeancesTab";
import { AbsencesTab } from "@/pages/SessionDetail/tabs/AbsencesTab";
import { BilansTab } from "@/pages/SessionDetail/tabs/BilansTab";
import { api } from "@/lib/api";
import type { Session, Student } from "@/types";
import { LEVEL_LABELS, schoolYearLabel } from "@/types";

/** Les onglets de l'écran, dans l'ordre d'affichage. */
type Onglet = "eleves" | "evaluations" | "seances" | "absences" | "bilans";

const ONGLETS: readonly Onglet[] = [
  "eleves",
  "evaluations",
  "seances",
  "absences",
  "bilans",
];

function ongletValide(valeur: string | null): Onglet | null {
  return ONGLETS.includes(valeur as Onglet) ? (valeur as Onglet) : null;
}

export default function SessionDetail(): ReactElement {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  /**
   * La cible demandée par l'adresse : `?onglet=seances&ouvrir=<id>`.
   *
   * C'est par là que l'accueil ouvre un cas précis — un appel à terminer, une
   * grille à finir de noter — sans que le tableau de bord ait à héberger
   * l'écran qui sait écrire. Une seule fois : l'initialiseur de `useState` ne
   * rejoue pas, et l'adresse est nettoyée juste après.
   *
   * Pourquoi la nettoyer : les onglets de Radix démontent le contenu inactif.
   * Si `?ouvrir=` restait dans l'adresse, changer d'onglet puis revenir
   * **réouvrirait** la séance qu'on venait de fermer, indéfiniment. Le
   * paramètre est un passage de relais, pas un état.
   */
  const [cible] = useState(() => ({
    onglet: ongletValide(searchParams.get("onglet")),
    ouvrir: searchParams.get("ouvrir"),
  }));
  const [onglet, setOnglet] = useState<Onglet>(cible.onglet ?? "eleves");

  useEffect(() => {
    if (cible.onglet === null && cible.ouvrir === null) return;
    setSearchParams({}, { replace: true });
  }, [cible, setSearchParams]);

  const [session, setSession] = useState<Session | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Rechargement silencieux, sans repasser par `loading`.
   *
   * Un passage par l'état de chargement remplacerait l'arbre des onglets par le
   * squelette de `DataState` : la séance ouverte serait démontée et le brouillon
   * du cahier de texte en cours de saisie partirait avec elle.
   */
  const reload = useCallback(async () => {
    if (!sessionId) return;
    const [nextSession, nextStudents] = await Promise.all([
      api.getSession(sessionId),
      api.getStudents(sessionId),
    ]);
    setSession(nextSession);
    setStudents(nextStudents);
  }, [sessionId]);

  const load = useCallback(async () => {
    if (!sessionId) {
      setError("Classe introuvable : l'adresse ne désigne aucune classe.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId, reload]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8 flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Retour aux classes"
          onClick={() => navigate("/classes")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{session ? session.name : "Classe"}</h1>
          {session && (
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">
                {LEVEL_LABELS[session.level_code]}
              </Badge>
              <span>{schoolYearLabel(session.year_start)}</span>
              <span aria-hidden="true">·</span>
              <span>
                {session.student_count}{" "}
                {session.student_count > 1 ? "élèves" : "élève"}
              </span>
            </div>
          )}
        </div>
      </div>

      <DataState
        loading={loading}
        error={error}
        onRetry={() => {
          void load();
        }}
      >
        {session && (
          /* Les besoins particuliers sont chargés ici, une fois pour les
             quatre onglets qui les affichent. Radix démonte le contenu
             inactif : un chargement par onglet relirait le vocabulaire à
             chaque aller-retour, et une étiquette renommée dans la liste des
             élèves ne serait pas à jour dans la grille de notation. */
          <NeedsProvider sessionId={session.id}>
            <Tabs
              value={onglet}
              onValueChange={(valeur) => {
                const suivant = ongletValide(valeur);
                if (suivant) setOnglet(suivant);
              }}
            >
              <TabsList>
                <TabsTrigger value="eleves">Élèves</TabsTrigger>
                <TabsTrigger value="evaluations">Évaluations</TabsTrigger>
                <TabsTrigger value="seances">Séances</TabsTrigger>
                {/* Un onglet nommé, entre les séances qu'il écarte et les bilans
                    qu'il corrige : c'est le seul endroit qui se retrouve sans
                    chercher quand les dates de stage arrivent, des mois plus tard. */}
                <TabsTrigger value="absences">Stages et absences</TabsTrigger>
                <TabsTrigger value="bilans">Bilans</TabsTrigger>
              </TabsList>

              <TabsContent value="eleves" className="mt-6">
                <StudentsTab
                  session={session}
                  students={students}
                  reload={reload}
                />
              </TabsContent>

              {/* `key` sur la cible, et pas seulement `openId` en prop : sans
                  elle, l'onglet déjà monté garderait sa propre sélection et le
                  cas demandé ne s'ouvrirait pas. */}
              <TabsContent value="evaluations" className="mt-6">
                <EvaluationsTab
                  key={`eval:${cible.ouvrir ?? ""}`}
                  session={session}
                  students={students}
                  openId={cible.onglet === "evaluations" ? cible.ouvrir : null}
                />
              </TabsContent>

              <TabsContent value="seances" className="mt-6">
                <SeancesTab
                  key={`seance:${cible.ouvrir ?? ""}`}
                  session={session}
                  students={students}
                  openId={cible.onglet === "seances" ? cible.ouvrir : null}
                />
              </TabsContent>

              <TabsContent value="absences" className="mt-6">
                <AbsencesTab session={session} students={students} />
              </TabsContent>

              <TabsContent value="bilans" className="mt-6">
                <BilansTab session={session} />
              </TabsContent>
            </Tabs>
          </NeedsProvider>
        )}
      </DataState>
    </div>
  );
}
