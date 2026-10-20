import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Activity, Boxes, Trophy, Users } from "lucide-react";

import { api } from "@/lib/api";
import { compactNumber, number, relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
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
import { useGameId } from "./use-game-id";

export function GameOverviewPage() {
  const gameId = useGameId();

  const game = useQuery({
    queryKey: ["admin-game", gameId],
    queryFn: () => api.game(gameId),
  });

  const data = game.data;

  if (game.isLoading) {
    return (
      <>
        <PageHeader title="Game" description="Loading the game configuration…" />
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }

  if (game.isError || !data) {
    return (
      <>
        <PageHeader title="Game" description="Game configuration could not be loaded." />
        <EmptyState
          title="Could not load the game"
          description={game.error instanceof Error ? game.error.message : "Unknown error"}
          action={<Button onClick={() => void game.refetch()}>Retry</Button>}
        />
      </>
    );
  }

  const loadedAdapters = data.adapters.length;

  return (
    <>
      <PageHeader
        title={data.displayName}
        description={`${data.id} · ${data.environment} · ${data.authProvider} authentication.`}
        breadcrumb={data.id}
      />

      <KpiStrip>
        <Metric
          label="Players"
          value={compactNumber(data.players)}
          icon={<Users className="size-4" />}
        />
        <Metric
          label="Leaderboards"
          value={compactNumber(data.boards.length)}
          icon={<Trophy className="size-4" />}
        />
        <Metric
          label="Feature flags"
          value={compactNumber(data.flags)}
          icon={<Boxes className="size-4" />}
        />
        <Metric
          label="Runs today"
          value={compactNumber(data.runsToday)}
          icon={<Activity className="size-4" />}
        />
      </KpiStrip>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Panel title="Status" description="Runtime configuration for this game">
          <dl className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
              <dt className="text-xs text-muted-foreground">Grace period</dt>
              <dd className="font-mono text-sm tabular-nums">{data.gracePeriodHours} h</dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
              <dt className="text-xs text-muted-foreground">Adapters loaded</dt>
              <dd className="font-mono text-sm tabular-nums">
                {number(loadedAdapters)}
                <span className="text-muted-foreground"> / {number(data.adapterCount)}</span>
                {loadedAdapters < data.adapterCount ? (
                  <span className="ml-2 text-xs text-warning">some adapters did not load</span>
                ) : null}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
              <dt className="text-xs text-muted-foreground">Database</dt>
              <dd>
                <StatusBadge
                  value={data.dbReady ? "ready" : "unavailable"}
                  tone={data.dbReady ? "success" : "danger"}
                />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
              <dt className="text-xs text-muted-foreground">Last run</dt>
              <dd className="text-xs text-muted-foreground">{relativeTime(data.lastRunAt)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
              <dt className="text-xs text-muted-foreground">Authentication</dt>
              <dd>
                <StatusBadge
                  value={data.authProvider}
                  tone={data.authProvider === "pgs-v2" ? "success" : "neutral"}
                />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
              <dt className="text-xs text-muted-foreground">Environment</dt>
              <dd>
                <StatusBadge
                  value={data.environment}
                  tone={data.environment === "production" ? "warning" : "neutral"}
                />
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel
          title="Leaderboards"
          description={`${data.boards.length} board${data.boards.length === 1 ? "" : "s"} declared`}
        >
          {data.boards.length === 0 ? (
            <EmptyState
              title="No leaderboards"
              description="Declare a board on an adapter to see it here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide">
                    Board
                  </TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide">
                    Period
                  </TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
                    Entries
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.boards.map((board) => (
                  <TableRow key={board.id} className="hover:bg-muted/25">
                    <TableCell className="px-3 py-3">
                      <Link
                        to="/games/$gameId/boards"
                        params={{ gameId }}
                        className="font-mono text-sm hover:text-primary"
                      >
                        {board.id}
                      </Link>
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <StatusBadge value={board.period} tone="neutral" />
                    </TableCell>
                    <TableCell className="px-3 py-3 text-right font-mono text-sm tabular-nums">
                      {number(board.entries)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Panel title="Adapters" description="Adapters loaded for this game">
          {data.adapters.length === 0 ? (
            <EmptyState
              title="No adapters loaded"
              description="The manifest declares adapters that this runtime could not load."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide">
                    Adapter
                  </TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide">
                    Kind
                  </TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide">
                    Version
                  </TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
                    Boards
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.adapters.map((adapter) => (
                  <TableRow key={adapter.id} className="hover:bg-muted/25">
                    <TableCell className="px-3 py-3 font-mono text-sm">{adapter.id}</TableCell>
                    <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                      {adapter.kind}
                    </TableCell>
                    <TableCell className="px-3 py-3 font-mono text-xs">
                      {adapter.version ?? "—"}
                    </TableCell>
                    <TableCell
                      className="px-3 py-3 text-right font-mono text-sm tabular-nums"
                      title={adapter.boards.join(", ")}
                    >
                      {number(adapter.boards.length)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>

        <Panel title="Required environment" description="Variables this game needs at boot">
          {data.envKeys.length === 0 ? (
            <EmptyState
              title="No required environment"
              description="This game declares no environment variables."
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide">
                      Variable
                    </TableHead>
                    <TableHead className="h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide">
                      State
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.envKeys.map((key) => (
                    <TableRow key={key.name} className="hover:bg-muted/25">
                      <TableCell className="px-3 py-3 font-mono text-sm">{key.name}</TableCell>
                      <TableCell className="px-3 py-3">
                        <StatusBadge
                          value={key.present ? "present" : "missing"}
                          tone={key.present ? "success" : "danger"}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                Variable names only — values are never sent to the console.
              </p>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
