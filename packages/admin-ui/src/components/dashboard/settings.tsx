import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AdminApiError, api } from "@/lib/api";
import type { AuthProvider, GameSettingsWriteRequest, ManifestResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, JsonEditor, PageHeader, Panel, SimpleSelect, StatusBadge } from "./primitives";
import { useAdmin } from "./app-context";

type Environment = ManifestResponse["environment"];

interface ManifestGame {
  id: string;
  displayName: string;
  authProvider: AuthProvider;
  secretPrefix: string;
  gracePeriodHours: number;
}

interface SettingsDraft {
  displayName: string;
  authProvider: AuthProvider;
  gracePeriodHours: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function readManifestGames(manifest: Record<string, unknown>): ManifestGame[] {
  const entries = manifest["games"];
  if (!isUnknownArray(entries)) return [];
  const games: ManifestGame[] = [];
  for (const entry of entries) {
    if (!isPlainObject(entry)) continue;
    const id = entry["id"];
    if (typeof id !== "string") continue;
    const displayName = entry["displayName"];
    const authProvider = entry["authProvider"];
    const secretPrefix = entry["secretPrefix"];
    const gracePeriodHours = entry["gracePeriodHours"];
    games.push({
      id,
      displayName: typeof displayName === "string" ? displayName : id,
      authProvider: authProvider === "development" ? "development" : "pgs-v2",
      secretPrefix: typeof secretPrefix === "string" ? secretPrefix : "—",
      gracePeriodHours: typeof gracePeriodHours === "number" ? gracePeriodHours : 0,
    });
  }
  return games;
}

function GameSettingsPanel({
  manifestGames,
  environment,
}: {
  manifestGames: ManifestGame[];
  environment: Environment;
}) {
  const { games, selectedGameId, setSelectedGameId } = useAdmin();
  const queryClient = useQueryClient();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const options = useMemo(() => {
    if (games.length > 0) {
      return games.map((game) => ({ value: game.id, label: `${game.displayName} · ${game.id}` }));
    }
    return manifestGames.map((game) => ({
      value: game.id,
      label: `${game.displayName} · ${game.id}`,
    }));
  }, [games, manifestGames]);

  const fallbackId =
    selectedGameId && options.some((option) => option.value === selectedGameId)
      ? selectedGameId
      : (options[0]?.value ?? "");
  const activeId = pickedId ?? fallbackId;

  const manifestGame = manifestGames.find((game) => game.id === activeId) ?? null;
  const summary = games.find((game) => game.id === activeId) ?? null;
  const displayName = manifestGame?.displayName ?? summary?.displayName ?? "";
  const authProvider = manifestGame?.authProvider ?? summary?.authProvider ?? "pgs-v2";
  const gracePeriodHours = manifestGame?.gracePeriodHours ?? 0;
  const secretPrefix = manifestGame?.secretPrefix ?? summary?.secretPrefix ?? "—";

  const initial = useMemo<SettingsDraft>(
    () => ({
      displayName,
      authProvider: environment === "production" ? "pgs-v2" : authProvider,
      gracePeriodHours: String(gracePeriodHours),
    }),
    [displayName, authProvider, gracePeriodHours, environment],
  );

  const [draft, setDraft] = useState<SettingsDraft>(initial);
  const [seed, setSeed] = useState<SettingsDraft>(initial);
  if (initial !== seed) {
    setSeed(initial);
    setDraft(initial);
  }

  const authItems = useMemo(() => {
    const items = [{ value: "pgs-v2", label: "pgs-v2" }];
    if (environment !== "production") items.push({ value: "development", label: "development" });
    return items;
  }, [environment]);

  const save = useMutation({
    mutationFn: (body: GameSettingsWriteRequest) => api.saveGameSettings(activeId, body),
    onSuccess: (settings) => {
      toast.success(`${settings.displayName} saved`);
      setError("");
      setDraft({
        displayName: settings.displayName,
        authProvider: settings.authProvider,
        gracePeriodHours: String(settings.gracePeriodHours),
      });
      void queryClient.invalidateQueries({ queryKey: ["admin-games"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-manifest"] });
    },
    onError: (cause) => {
      if (cause instanceof AdminApiError) {
        toast.error(
          cause.message,
          cause.details.length > 0 ? { description: cause.details.join(" · ") } : undefined,
        );
        return;
      }
      toast.error(cause.message || "Could not save the game settings");
    },
  });

  const savedSettings = save.data && save.data.id === activeId ? save.data : null;
  const saved: SettingsDraft = savedSettings
    ? {
        displayName: savedSettings.displayName,
        authProvider: savedSettings.authProvider,
        gracePeriodHours: String(savedSettings.gracePeriodHours),
      }
    : initial;

  const dirty =
    draft.displayName !== saved.displayName ||
    draft.authProvider !== saved.authProvider ||
    draft.gracePeriodHours !== saved.gracePeriodHours;

  const submit = () => {
    const name = draft.displayName.trim();
    if (name.length < 1 || name.length > 80) {
      setError("The display name must be between 1 and 80 characters.");
      return;
    }
    const rawGrace = draft.gracePeriodHours.trim();
    const grace = Number(rawGrace);
    if (rawGrace === "" || !Number.isInteger(grace) || grace < 0 || grace > 168) {
      setError("The grace period must be a whole number of hours between 0 and 168.");
      return;
    }
    if (environment === "production" && draft.authProvider === "development") {
      setError("Development auth is refused in production. Use pgs-v2.");
      return;
    }
    setError("");
    save.mutate({ displayName: name, authProvider: draft.authProvider, gracePeriodHours: grace });
  };

  if (!activeId) return null;

  return (
    <Panel
      title="Game settings"
      description="Typed fields for one game"
      actions={
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Environment</span>
          <StatusBadge value={environment} />
        </div>
      }
    >
      <div className="border-b border-border px-4 py-3">
        <p className="text-xs text-muted-foreground">
          One Bantam deployment serves one manifest environment, so the environment is read-only
          here. Saving rewrites the manifest and reloads the game runtimes.
        </p>
      </div>

      <div className="space-y-1.5 border-b border-border px-4 py-3">
        <Label>Game</Label>
        <SimpleSelect
          value={activeId}
          onValueChange={(value) => {
            setPickedId(value);
            setSelectedGameId(value);
            setError("");
          }}
          items={options}
          placeholder="Select a game"
        />
      </div>

      <div className="grid gap-5 p-4 lg:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="settings-display-name">Display name</Label>
          <Input
            id="settings-display-name"
            value={draft.displayName}
            maxLength={80}
            onChange={(event) => {
              setDraft((current) => ({ ...current, displayName: event.target.value }));
              setError("");
            }}
          />
          <p className="text-xs text-muted-foreground">1 to 80 characters.</p>
        </div>

        <div className="space-y-1.5">
          <Label>Auth provider</Label>
          <SimpleSelect
            value={draft.authProvider}
            onValueChange={(value) => {
              const next: AuthProvider = value === "development" ? "development" : "pgs-v2";
              setDraft((current) => ({ ...current, authProvider: next }));
              setError("");
            }}
            items={authItems}
          />
          {environment === "production" ? (
            <p className="text-xs text-muted-foreground">
              Development auth is refused in production: the server rejects a development auth
              provider in a production manifest.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              pgs-v2 authenticates with Google Play Games v2; development accepts a local
              authorization code.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="settings-grace-period">Grace period (hours)</Label>
          <Input
            id="settings-grace-period"
            type="number"
            min={0}
            max={168}
            step={1}
            value={draft.gracePeriodHours}
            onChange={(event) => {
              setDraft((current) => ({ ...current, gracePeriodHours: event.target.value }));
              setError("");
            }}
            className="font-mono tabular-nums"
          />
          <p className="text-xs text-muted-foreground">
            A whole number of hours between 0 and 168.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="settings-game-id">Game id</Label>
          <Input id="settings-game-id" value={activeId} readOnly className="font-mono" />
          <p className="text-xs text-muted-foreground">
            The id is the database path of this game. It cannot be changed from the console.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="settings-secret-prefix">Secret prefix</Label>
          <Input id="settings-secret-prefix" value={secretPrefix} readOnly className="font-mono" />
          <p className="text-xs text-muted-foreground">
            The prefix names the environment variables the server reads for this game. Changing it
            here would orphan the secrets already deployed.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
        {error ? <p className="mr-auto text-xs text-destructive">{error}</p> : null}
        <Button
          variant="outline"
          onClick={() => {
            setDraft(saved);
            setError("");
          }}
          disabled={!dirty || save.isPending}
        >
          Cancel
        </Button>
        <Button onClick={submit} disabled={!dirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </Panel>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { games } = useAdmin();
  const manifestKey = ["admin-manifest"];

  const manifest = useQuery({
    queryKey: manifestKey,
    queryFn: api.manifest,
  });

  const save = useMutation({
    mutationFn: (value: Record<string, unknown>) => api.saveManifest(value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: manifestKey });
    },
    onError: (error) => {
      if (error instanceof AdminApiError) {
        toast.error(
          error.message,
          error.details.length > 0 ? { description: error.details.join(" · ") } : undefined,
        );
        return;
      }
      toast.error(error.message || "Could not save the manifest");
    },
  });

  if (manifest.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (manifest.isError || !manifest.data) {
    return (
      <>
        <PageHeader
          title="Settings"
          description="The manifest is the single source of truth for every registered game."
        />
        <EmptyState
          title="Could not load the manifest"
          description={manifest.error instanceof Error ? manifest.error.message : "Unknown error"}
          action={<Button onClick={() => void manifest.refetch()}>Retry</Button>}
        />
      </>
    );
  }

  const data = manifest.data;
  const manifestGames = readManifestGames(data.manifest);
  const isEmpty = manifestGames.length === 0 && games.length === 0;

  return (
    <>
      <PageHeader
        title="Settings"
        description="The manifest is the single source of truth for every registered game."
        actions={
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Environment</span>
            <StatusBadge value={data.environment} />
          </div>
        }
      />

      {isEmpty ? (
        <Panel title="Manifest" description="Server configuration">
          <EmptyState
            title="The manifest is empty"
            description="No game is registered on this instance yet. Add one to the manifest file to get started."
          />
        </Panel>
      ) : (
        <GameSettingsPanel manifestGames={manifestGames} environment={data.environment} />
      )}

      <div className="mt-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Advanced
        </h2>
        <Panel
          title="Raw manifest"
          description="Escape hatch for the fields the typed form does not cover"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">
              The raw editor is the escape hatch for changes the typed form cannot express — the
              adapters array and the per-game economy catalog. Saving the manifest reloads the game
              runtimes. Removing a game from the manifest releases its database.
            </p>
          </div>
          <div className="p-4">
            <JsonEditor
              value={data.manifest}
              title="Manifest"
              onSave={async (value) => {
                await save.mutateAsync(value);
              }}
            />
          </div>
        </Panel>
      </div>

      <div className="mt-5">
        <Panel title="Manifest reference" description="Read-only view of the stored document">
          <div className="border-b border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">
              The manifest is the single source of truth for games, adapters, secret prefixes and
              environment variable names. Game ids, secret prefixes and env-var names are validated
              server-side when the manifest is saved.
            </p>
          </div>
          <div className="p-4">
            <JsonEditor value={data.manifest} title="Manifest (read-only)" readonly />
          </div>
        </Panel>
      </div>

      <div className="mt-5">
        <Panel title="Operator notes" description="How this console treats your data">
          <ul className="list-disc space-y-2 px-5 py-4 text-xs text-muted-foreground">
            <li>
              The console never displays secret values. It only reports whether an environment
              variable is present.
            </li>
            <li>
              Leaderboard values are always derived server-side by the versioned adapter and are
              read-only here.
            </li>
            <li>
              The manifest is written to the data volume of the server, or to the file pointed at by{" "}
              <span className="font-mono">BANTAM_CONFIG_FILE</span> when that variable is set.
            </li>
          </ul>
        </Panel>
      </div>
    </>
  );
}
