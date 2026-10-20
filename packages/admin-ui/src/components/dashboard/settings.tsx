import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AdminApiError, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, JsonEditor, PageHeader, Panel, StatusBadge } from "./primitives";

export function SettingsPage() {
  const queryClient = useQueryClient();
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
  const isEmpty = Object.keys(data.manifest).length === 0;

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
        <>
          <Panel title="Manifest" description="Server configuration" className="mb-5">
            <div className="border-b border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">
                Saving the manifest reloads the game runtimes. Removing a game from the manifest
                releases its database.
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

          <Panel title="Manifest reference" description="Read-only view of the stored document">
            <div className="border-b border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">
                The manifest is the single source of truth for games, adapters, secret prefixes and
                environment variable names. Game ids, secret prefixes and env-var names are
                validated server-side when the manifest is saved.
              </p>
            </div>
            <div className="p-4">
              <JsonEditor value={data.manifest} title="Manifest (read-only)" readonly />
            </div>
          </Panel>
        </>
      )}

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
