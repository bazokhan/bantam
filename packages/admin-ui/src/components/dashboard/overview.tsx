import { Suspense, lazy } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Gamepad2, Trophy, Users } from "lucide-react";

import { api } from "@/lib/api";
import { compactNumber, number, relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdmin } from "./app-context";
import { EmptyState, KpiStrip, Metric, PageHeader, Panel, StatusBadge } from "./primitives";
import { Link } from "@tanstack/react-router";

const ActivityChart = lazy(() =>
  import("./activity-chart").then((m) => ({ default: m.ActivityChart })),
);

export function OverviewPage() {
  const { selectedGameId, setSelectedGameId } = useAdmin();

  const overview = useQuery({
    queryKey: ["admin-overview"],
    queryFn: api.overview,
    refetchInterval: 30_000,
  });

  if (overview.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (overview.isError || !overview.data) {
    return (
      <>
        <PageHeader
          title="Overview"
          description="Operational health across every registered game."
        />
        <EmptyState
          title="Could not load the overview"
          description={overview.error instanceof Error ? overview.error.message : "Unknown error"}
          action={<Button onClick={() => void overview.refetch()}>Retry</Button>}
        />
      </>
    );
  }

  const data = overview.data;
  const scoped = selectedGameId
    ? data.games.filter((game) => game.id === selectedGameId)
    : data.games;
  const players = scoped.reduce((sum, game) => sum + game.players, 0);
  const boards = scoped.reduce((sum, game) => sum + game.boards.length, 0);
  const flags = scoped.reduce((sum, game) => sum + game.flags, 0);
  const runsToday = scoped.reduce((sum, game) => sum + game.runsToday, 0);
  const recentRuns = selectedGameId
    ? data.recentRuns.filter((run) => run.gameId === selectedGameId)
    : data.recentRuns;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Operational health for every registered game served by this instance."
        actions={
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="size-2 rounded-full bg-success" />
            {data.totals.games} game{data.totals.games === 1 ? "" : "s"} loaded
          </div>
        }
      />

      <KpiStrip>
        <Metric
          label="Total players"
          value={compactNumber(players)}
          icon={<Users className="size-4" />}
        />
        <Metric
          label="Runs today"
          value={compactNumber(runsToday)}
          icon={<Activity className="size-4" />}
        />
        <Metric
          label="Leaderboards"
          value={compactNumber(boards)}
          icon={<Trophy className="size-4" />}
        />
        <Metric
          label="Feature flags"
          value={compactNumber(flags)}
          icon={<Gamepad2 className="size-4" />}
        />
      </KpiStrip>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.7fr_1fr]">
        <Panel title="Player activity" description="Daily volume · last 7 days">
          {data.activity.length === 0 ? (
            <EmptyState title="No activity yet" description="Runs and sign-ins will appear here." />
          ) : (
            <div className="h-72 p-4">
              <Suspense fallback={<Skeleton className="h-full w-full" />}>
                <ActivityChart data={data.activity} />
              </Suspense>
            </div>
          )}
        </Panel>

        <Panel title="Recent runs" description="Newest submitted evidence">
          {recentRuns.length === 0 ? (
            <EmptyState title="No runs yet" description="Submitted runs will stream in here." />
          ) : (
            <div className="divide-y divide-border">
              {recentRuns.slice(0, 10).map((run) => (
                <div
                  key={`${run.gameId}:${run.id}`}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{run.boardId}</div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {run.gameId} · {run.period}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm tabular-nums">{number(run.value)}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {relativeTime(run.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-5">
        <Panel
          title="Games"
          description="Every game registered in the manifest"
          actions={
            selectedGameId ? (
              <Button variant="outline" size="sm" onClick={() => setSelectedGameId(null)}>
                Show all games
              </Button>
            ) : null
          }
        >
          {data.games.length === 0 ? (
            <EmptyState
              title="No games registered"
              description="Add a game to the manifest to see it here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b border-border bg-muted/35">
                    {["Game", "Auth", "Boards", "Players", "Runs today", "Last run", "State"].map(
                      (head) => (
                        <th
                          key={head}
                          className="h-9 whitespace-nowrap px-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          {head}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.games.map((game) => (
                    <tr key={game.id} className="hover:bg-muted/25">
                      <td className="px-3 py-3">
                        <Link
                          to="/games/$gameId"
                          params={{ gameId: game.id }}
                          className="text-sm font-medium hover:text-primary"
                        >
                          {game.displayName}
                        </Link>
                        <div className="font-mono text-[11px] text-muted-foreground">{game.id}</div>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge
                          value={game.authProvider}
                          tone={game.authProvider === "pgs-v2" ? "success" : "neutral"}
                        />
                      </td>
                      <td className="px-3 py-3 font-mono text-sm tabular-nums">
                        {game.boards.length}
                      </td>
                      <td className="px-3 py-3 font-mono text-sm tabular-nums">
                        {number(game.players)}
                      </td>
                      <td className="px-3 py-3 font-mono text-sm tabular-nums">
                        {number(game.runsToday)}
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {relativeTime(game.lastRunAt)}
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge
                          value={game.dbReady ? "ready" : "unavailable"}
                          tone={game.dbReady ? "success" : "danger"}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
