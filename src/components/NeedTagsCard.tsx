import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Check, HeartHandshake, Pencil, Plus, Trash2, X } from "lucide-react";

import { DataState } from "@/components/DataState";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { api } from "@/lib/api";
import type { NeedTag } from "@/types";

function messageOf(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Une erreur inattendue est survenue.";
}

/**
 * Le vocabulaire des besoins particuliers, dans l'écran Réglages.
 *
 * Extrait de `Settings.tsx` et non écrit dedans : cette carte charge sa propre
 * liste et porte ses propres erreurs, là où tout le reste de l'écran partage un
 * seul formulaire d'`app_settings`. L'y mêler aurait fait dépendre
 * l'enregistrement du nom de l'établissement d'une lecture sans rapport.
 *
 * **C'est le seul écran où une étiquette se renomme ou se supprime.** Le
 * dialogue d'un élève sait en créer une — on crée l'étiquette dont on a besoin
 * au moment où on la pose — mais renommer touche toutes les classes et toutes
 * les années : ce geste appartient aux réglages, pas à une fiche d'élève.
 */
export function NeedTagsCard(): ReactElement {
  const [tags, setTags] = useState<NeedTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [shortLabel, setShortLabel] = useState("");
  const [creating, setCreating] = useState(false);

  // L'identifiant en cours de renommage, et les deux champs de la ligne
  // ouverte. Une seule ligne à la fois : deux renommages simultanés
  // demanderaient un brouillon par ligne pour rien.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editShort, setEditShort] = useState("");
  const [saving, setSaving] = useState(false);

  const [deleting, setDeleting] = useState<NeedTag | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setTags(await api.getNeedTags());
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    const propre = label.trim();
    if (propre === "") return;
    setCreating(true);
    setActionError(null);
    try {
      await api.createNeedTag(propre, shortLabel.trim());
      setLabel("");
      setShortLabel("");
      await load();
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (tag: NeedTag) => {
    setActionError(null);
    setEditingId(tag.id);
    setEditLabel(tag.label);
    setEditShort(tag.short_label);
  };

  const handleSave = async () => {
    if (editingId === null) return;
    const propre = editLabel.trim();
    if (propre === "") {
      setActionError("Le libellé d'une étiquette ne peut pas être vide.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await api.updateNeedTag(editingId, propre, editShort.trim());
      setEditingId(null);
      await load();
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    await api.deleteNeedTag(deleting.id);
    setDeleting(null);
    await load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HeartHandshake className="h-4 w-4" />
          Besoins particuliers
        </CardTitle>
        <CardDescription>
          Vos étiquettes : dysorthographie, dyscalculie, AESH, PAP… SGPA n'en
          propose aucune d'avance, parce que les libellés justes sont ceux des
          notifications et des PAP de votre établissement. Elles servent à
          toutes vos classes et à toutes les années. Vous les posez sur un élève
          depuis l'onglet « Élèves » de sa classe, et elles s'affichent ensuite
          à l'appel, dans les grilles de notation et dans les bilans à l'écran.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          Ces informations ne figurent sur{" "}
          <span className="font-medium text-foreground">
            aucun document imprimé
          </span>{" "}
          : ni bulletin, ni fiche contrat, ni liste d'appel exportée. Ce sont
          des données de santé concernant des mineurs, et un PDF oublié en salle
          des profs ne doit rien en dire.
        </p>

        <DataState
          loading={loading}
          error={error}
          onRetry={() => {
            void load();
          }}
        >
          {tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune étiquette pour l'instant.
            </p>
          ) : (
            <div className="divide-y rounded-md border">
              {tags.map((tag) =>
                editingId === tag.id ? (
                  <div
                    key={tag.id}
                    className="flex flex-wrap items-center gap-2 p-2"
                  >
                    <Input
                      value={editLabel}
                      onChange={(event) => setEditLabel(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleSave();
                        }
                      }}
                      className="min-w-40 flex-1"
                      aria-label="Libellé de l'étiquette"
                      autoFocus
                    />
                    <Input
                      value={editShort}
                      onChange={(event) => setEditShort(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleSave();
                        }
                      }}
                      className="w-28"
                      placeholder="Abrégé"
                      aria-label="Abréviation de l'étiquette"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      title="Enregistrer"
                      aria-label="Enregistrer l'étiquette"
                      disabled={saving}
                      onClick={() => void handleSave()}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      title="Annuler"
                      aria-label="Annuler le renommage"
                      disabled={saving}
                      onClick={() => setEditingId(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div
                    key={tag.id}
                    className="flex flex-wrap items-center justify-between gap-2 p-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {tag.label}
                        {tag.short_label && (
                          <span className="ml-2 font-normal text-muted-foreground">
                            ({tag.short_label})
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {tag.student_count === 0
                          ? "Posée sur aucun élève"
                          : `Posée sur ${tag.student_count} élève${tag.student_count > 1 ? "s" : ""}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        title="Renommer"
                        aria-label={`Renommer « ${tag.label} »`}
                        onClick={() => openEdit(tag)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        title="Supprimer"
                        aria-label={`Supprimer « ${tag.label} »`}
                        onClick={() => {
                          setActionError(null);
                          setDeleting(tag);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ),
              )}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2 border-t pt-4">
            <div className="min-w-40 flex-1 space-y-2">
              <Label htmlFor="besoin-tag-label">Nouvelle étiquette</Label>
              <Input
                id="besoin-tag-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleCreate();
                  }
                }}
                placeholder="Dysorthographie"
              />
            </div>
            <div className="w-28 space-y-2">
              <Label htmlFor="besoin-tag-short">Abrégé</Label>
              <Input
                id="besoin-tag-short"
                value={shortLabel}
                onChange={(event) => setShortLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleCreate();
                  }
                }}
                placeholder="Dys-o"
              />
            </div>
            <Button
              onClick={() => void handleCreate()}
              disabled={creating || label.trim() === ""}
            >
              <Plus className="h-4 w-4" />
              {creating ? "Ajout…" : "Ajouter"}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            L'abrégé s'affiche là où la place manque — une grille de notation,
            une feuille d'appel. Laissez-le vide et le libellé complet est
            affiché partout. Ne l'abrégez pas au point de le rendre ambigu :
            « Dys » ne distingue pas une dyscalculie d'une dysorthographie, qui
            ne demandent pas les mêmes aménagements.
          </p>
        </DataState>

        {actionError && (
          <p className="whitespace-pre-line rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {actionError}
          </p>
        )}
      </CardContent>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Supprimer l'étiquette"
        description={
          <>
            <p>
              « {deleting?.label} » disparaîtra du vocabulaire
              {deleting && deleting.student_count > 0
                ? ` et des ${deleting.student_count} élève${deleting.student_count > 1 ? "s" : ""} qui la porte${deleting.student_count > 1 ? "nt" : ""}.`
                : "."}
            </p>
            <p>
              Les notes, les appels et les bilans ne changent pas : une
              étiquette n'entre dans aucun calcul. Si le libellé est seulement à
              corriger, renommez-la plutôt — le renommage conserve les élèves.
            </p>
          </>
        }
        onConfirm={handleDelete}
      />
    </Card>
  );
}
