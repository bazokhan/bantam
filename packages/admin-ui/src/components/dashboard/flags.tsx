import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import type { FeatureFlagRow, FlagWriteRequest } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmAction, EmptyState, PageHeader, Panel, StatusBadge } from "./primitives";
import { GameTabs } from "./game-tabs";
import { useGameId } from "./use-game-id";

interface FlagDraft {
  key: string;
  description: string;
  enabled: boolean;
  rollout: string;
  targeting: string;
  targetingTouched: boolean;
  error: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const HEAD_CLASS =
  "h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

export function FlagsPage() {
  const gameId = useGameId();
  const queryClient = useQueryClient();
  const flagsKey = ["admin-flags", gameId];

  const flags = useQuery({
    queryKey: flagsKey,
    queryFn: () => api.flags(gameId),
  });

  const [draft, setDraft] = useState<FlagDraft | null>(null);

  const toggle = useMutation<
    FeatureFlagRow,
    Error,
    { key: string },
    { previous: FeatureFlagRow[] | undefined }
  >({
    mutationFn: ({ key }) => api.toggleFlag(gameId, key),
    onMutate: async ({ key }) => {
      await queryClient.cancelQueries({ queryKey: flagsKey });
      const previous = queryClient.getQueryData<FeatureFlagRow[]>(flagsKey);
      queryClient.setQueryData<FeatureFlagRow[]>(flagsKey, (rows) =>
        rows?.map((row) => (row.key === key ? { ...row, enabled: !row.enabled } : row)),
      );
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData<FeatureFlagRow[]>(flagsKey, context.previous);
      toast.error(error.message || "Could not toggle the flag");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: flagsKey });
    },
  });

  const save = useMutation({
    mutationFn: ({ key, body }: { key: string; body: FlagWriteRequest }) =>
      api.writeFlag(gameId, key, body),
    onSuccess: () => {
      toast.success("Flag updated");
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: flagsKey });
    },
    onError: (error) => {
      toast.error(error.message || "Could not update the flag");
    },
  });

  const remove = useMutation({
    mutationFn: (key: string) => api.deleteFlag(gameId, key),
    onSuccess: () => {
      toast.success("Flag deleted");
      void queryClient.invalidateQueries({ queryKey: flagsKey });
    },
    onError: (error) => {
      toast.error(error.message || "Could not delete the flag");
    },
  });

  const openEditor = (flag: FeatureFlagRow) => {
    setDraft({
      key: flag.key,
      description: flag.description,
      enabled: flag.enabled,
      rollout: "100",
      targeting: "{}",
      targetingTouched: false,
      error: "",
    });
  };

  const patch = (changes: Partial<FlagDraft>) => {
    setDraft((current) => (current ? { ...current, ...changes } : current));
  };

  const submit = () => {
    if (!draft) return;

    const rolloutText = draft.rollout.trim();
    const rollout = rolloutText === "" ? 100 : Number(rolloutText);
    if (!Number.isFinite(rollout) || rollout < 0 || rollout > 100) {
      patch({ error: "Rollout must be a number between 0 and 100." });
      return;
    }

    const body: FlagWriteRequest = { enabled: draft.enabled, description: draft.description };

    if (draft.targetingTouched) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(draft.targeting);
      } catch (cause) {
        patch({ error: cause instanceof Error ? cause.message : "Invalid JSON" });
        return;
      }
      if (!isPlainObject(parsed)) {
        patch({ error: "Targeting must be a JSON object." });
        return;
      }
      body.targeting = { rolloutPercent: rollout, ...parsed };
    }

    patch({ error: "" });
    save.mutate({ key: draft.key, body });
  };

  if (flags.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (flags.isError || !flags.data) {
    return (
      <>
        <PageHeader
          title="Feature flags"
          description="Operator-defined switches for this game, resolved server-side."
        />
        <GameTabs gameId={gameId} />
        <EmptyState
          title="Could not load the feature flags"
          description={flags.error instanceof Error ? flags.error.message : "Unknown error"}
          action={<Button onClick={() => void flags.refetch()}>Retry</Button>}
        />
      </>
    );
  }

  const rows = flags.data;

  return (
    <>
      <PageHeader
        title="Feature flags"
        description="Operator-defined switches for this game. Every value is resolved server-side."
        breadcrumb={`${gameId} / flags`}
        actions={
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">{rows.length}</span>
            <span>flag{rows.length === 1 ? "" : "s"}</span>
          </div>
        }
      />

      <GameTabs gameId={gameId} />

      <Panel title="Flags" description="Toggle, edit or delete a flag">
        {rows.length === 0 ? (
          <EmptyState
            title="No feature flags"
            description="This game has no flags yet. Flags defined in the manifest appear here."
          />
        ) : (
          <Table className="min-w-[900px]">
            <TableHeader className="bg-muted/20">
              <TableRow>
                <TableHead className={HEAD_CLASS}>Flag</TableHead>
                <TableHead className={HEAD_CLASS}>State</TableHead>
                <TableHead className={HEAD_CLASS}>Description</TableHead>
                <TableHead className={HEAD_CLASS}>Targeting</TableHead>
                <TableHead className={HEAD_CLASS}>Updated</TableHead>
                <TableHead className={HEAD_CLASS}>Environment</TableHead>
                <TableHead className={HEAD_CLASS} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((flag) => (
                <TableRow key={flag.key}>
                  <TableCell className="px-3 py-2.5">
                    <span className="font-mono text-sm">{flag.key}</span>
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <Switch
                      checked={flag.enabled}
                      disabled={toggle.isPending}
                      onCheckedChange={() => toggle.mutate({ key: flag.key })}
                      aria-label={`Toggle ${flag.key}`}
                    />
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-sm text-muted-foreground">
                    {flag.description || "—"}
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
                    <div className="max-w-[220px] truncate" title={flag.targeting}>
                      {flag.targeting || "—"}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                    {relativeTime(flag.updatedAt)}
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <StatusBadge value={flag.environment} />
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditor(flag)}
                        aria-label={`Edit ${flag.key}`}
                      >
                        <Pencil />
                      </Button>
                      <ConfirmAction
                        trigger={<Trash2 />}
                        title={`Delete ${flag.key}?`}
                        description="The flag is removed for this game and clients stop receiving it."
                        confirmLabel="Delete"
                        onConfirm={async () => {
                          try {
                            await remove.mutateAsync(flag.key);
                          } catch {
                            // The mutation handler already reported the failure.
                          }
                        }}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit flag</DialogTitle>
            <DialogDescription>
              Flags are operator-defined. The key cannot be changed once the flag exists.
            </DialogDescription>
          </DialogHeader>

          {draft ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="flag-key">Key</Label>
                <Input id="flag-key" value={draft.key} readOnly className="font-mono" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="flag-description">Description</Label>
                <Input
                  id="flag-description"
                  value={draft.description}
                  onChange={(event) => patch({ description: event.target.value })}
                />
              </div>

              <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2">
                <Label htmlFor="flag-enabled">Enabled</Label>
                <Switch
                  id="flag-enabled"
                  checked={draft.enabled}
                  onCheckedChange={(checked) => patch({ enabled: checked })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="flag-rollout">Rollout percent</Label>
                <Input
                  id="flag-rollout"
                  type="number"
                  min={0}
                  max={100}
                  value={draft.rollout}
                  onChange={(event) =>
                    patch({ rollout: event.target.value, targetingTouched: true, error: "" })
                  }
                  className="font-mono tabular-nums"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="flag-targeting">Targeting (JSON)</Label>
                <Textarea
                  id="flag-targeting"
                  value={draft.targeting}
                  spellCheck={false}
                  onChange={(event) =>
                    patch({ targeting: event.target.value, targetingTouched: true, error: "" })
                  }
                  className="min-h-[120px] font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Leave untouched to keep the targeting rules the server already resolved.
                </p>
              </div>

              {draft.error ? <p className="text-xs text-destructive">{draft.error}</p> : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
