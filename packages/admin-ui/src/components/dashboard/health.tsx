import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, KpiStrip, Metric, PageHeader, Panel, StatusBadge } from "./primitives";

const HEAD_CLASS =
  "h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

function humanizeUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function StatusMetric({ label, badge }: { label: string; badge: ReactNode }) {
  return (
    <div className="border-r border-border px-5 py-4 last:border-r-0">
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>{label}</span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">{badge}</div>
    </div>
  );
}

export function HealthPage() {
  const health = useQuery({
    queryKey: ["admin-health"],
    queryFn: api.health,
    refetchInterval: 30_000,
  });

  if (health.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (health.isError || !health.data) {
    return (
      <>
        <PageHeader
          title="Health"
          description="Runtime readiness of this instance and of every registered game."
        />
        <EmptyState
          title="Could not load the health report"
          description={health.error instanceof Error ? health.error.message : "Unknown error"}
          action={<Button onClick={() => void health.refetch()}>Retry</Button>}
        />
      </>
    );
  }

  const data = health.data;
  const degraded = data.status === "degraded";

  return (
    <>
      <PageHeader
        title="Health"
        description="Runtime readiness of this instance and of every registered game."
        actions={
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">{data.games.length}</span>
            <span>game{data.games.length === 1 ? "" : "s"}</span>
          </div>
        }
      />

      {degraded ? (
        <Alert className="mb-5 border-warning/40 bg-warning/10">
          <AlertTitle className="text-warning">Some games are not fully ready</AlertTitle>
          <AlertDescription>
            One or more games have missing adapters, an unavailable database or an incomplete
            environment. Check the table below before handing traffic to this instance.
          </AlertDescription>
        </Alert>
      ) : null}

      <KpiStrip>
        <StatusMetric
          label="Status"
          badge={<StatusBadge value={data.status} tone={degraded ? "warning" : "success"} />}
        />
        <Metric label="Environment" value={data.environment} />
        <Metric label="Uptime" value={humanizeUptime(data.uptimeSeconds)} />
        <Metric label="Version" value={data.version} />
      </KpiStrip>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.7fr_1fr]">
        <Panel title="Games" description="Readiness per registered game">
          {data.games.length === 0 ? (
            <EmptyState
              title="No games registered"
              description="Add a game to the manifest to see its readiness here."
            />
          ) : (
            <Table className="min-w-[680px]">
              <TableHeader className="bg-muted/20">
                <TableRow>
                  <TableHead className={HEAD_CLASS}>Game</TableHead>
                  <TableHead className={HEAD_CLASS}>Adapters</TableHead>
                  <TableHead className={HEAD_CLASS}>Database</TableHead>
                  <TableHead className={HEAD_CLASS}>Environment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.games.map((game) => {
                  const mismatch = game.declaredAdapters !== game.loadedAdapters;
                  return (
                    <TableRow key={game.id}>
                      <TableCell className="px-3 py-2.5">
                        <div className="text-sm">{game.displayName}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{game.id}</div>
                      </TableCell>
                      <TableCell className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm tabular-nums">
                            {game.declaredAdapters} / {game.loadedAdapters}
                          </span>
                          {mismatch ? <StatusBadge value="mismatch" tone="warning" /> : null}
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-2.5">
                        <StatusBadge
                          value={game.dbReady ? "ready" : "unavailable"}
                          tone={game.dbReady ? "success" : "danger"}
                        />
                      </TableCell>
                      <TableCell className="px-3 py-2.5">
                        <StatusBadge
                          value={game.envComplete ? "complete" : "incomplete"}
                          tone={game.envComplete ? "success" : "danger"}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Panel>

        <Panel title="Allowed origins" description="CORS allow-list">
          {data.allowedOrigins.length === 0 ? (
            <EmptyState
              title="No origins allowed"
              description="Every cross-origin request is rejected by this instance."
            />
          ) : (
            <>
              <div className="divide-y divide-border">
                {data.allowedOrigins.map((origin) => (
                  <div key={origin} className="px-4 py-2.5 font-mono text-xs">
                    {origin}
                  </div>
                ))}
              </div>
              <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
                Requests from any other origin are rejected. The allow-list is read from the server
                configuration and is not editable here.
              </p>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
