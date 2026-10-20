import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Gauge, Layers } from "lucide-react";

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
import { GameTabs } from "./game-tabs";
import {
  DataToolbar,
  EmptyState,
  KpiStrip,
  Metric,
  PageHeader,
  Panel,
  SimpleSelect,
} from "./primitives";
import { useGameId } from "./use-game-id";

const ALL_BOARDS = "all";

export function RunsPage() {
  const gameId = useGameId();
  const [search, setSearch] = useState("");
  const [boardFilter, setBoardFilter] = useState(ALL_BOARDS);

  const runs = useQuery({
    queryKey: ["admin-runs", gameId],
    queryFn: () => api.runs(gameId, 100),
  });

  const list = useMemo(() => runs.data?.runs ?? [], [runs.data]);

  const boardIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of list) ids.add(run.boardId);
    return [...ids].sort();
  }, [list]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return list.filter((run) => {
      if (boardFilter !== ALL_BOARDS && run.boardId !== boardFilter) return false;
      if (!query) return true;
      return (
        run.boardId.toLowerCase().includes(query) || run.displayName.toLowerCase().includes(query)
      );
    });
  }, [list, search, boardFilter]);

  const bestByBoard = useMemo(() => {
    const best = new Map<string, number>();
    for (const run of filtered) {
      const current = best.get(run.boardId);
      if (current === undefined || run.value > current) best.set(run.boardId, run.value);
    }
    return best;
  }, [filtered]);

  const total = runs.data?.total ?? 0;

  if (runs.isLoading) {
    return (
      <>
        <PageHeader title="Runs" description="Loading the runs of this game…" />
        <GameTabs gameId={gameId} />
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      </>
    );
  }

  if (runs.isError || !runs.data) {
    return (
      <>
        <PageHeader title="Runs" description="Runs could not be loaded." />
        <GameTabs gameId={gameId} />
        <EmptyState
          title="Could not load the runs"
          description={runs.error instanceof Error ? runs.error.message : "Unknown error"}
          action={<Button onClick={() => void runs.refetch()}>Retry</Button>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Runs"
        description="The 100 most recent submitted runs. Runs are read-only here — leaderboard values are derived by the server adapter inside the run transaction."
      />
      <GameTabs gameId={gameId} />

      <KpiStrip>
        <Metric
          label="Total runs"
          value={compactNumber(total)}
          hint={`${number(list.length)} loaded`}
          icon={<Activity className="size-4" />}
        />
        <Metric
          label="Distinct boards"
          value={compactNumber(boardIds.length)}
          hint="across all runs"
          icon={<Layers className="size-4" />}
        />
        <Metric
          label="Boards with a best value"
          value={compactNumber(bestByBoard.size)}
          hint="in current filter"
          icon={<Gauge className="size-4" />}
        />
      </KpiStrip>

      <div className="mt-5">
        <Panel title="Runs" description="Newest evidence first">
          <DataToolbar
            search={search}
            setSearch={setSearch}
            placeholder="Search by board id or player…"
          >
            <SimpleSelect
              className="w-56"
              value={boardFilter}
              onValueChange={setBoardFilter}
              items={[
                { value: ALL_BOARDS, label: "All boards" },
                ...boardIds.map((id) => ({ value: id, label: id })),
              ]}
              placeholder="Filter by board"
            />
          </DataToolbar>

          {filtered.length === 0 ? (
            <EmptyState
              title={list.length === 0 ? "No runs yet" : "No runs match the filter"}
              description={
                list.length === 0
                  ? "Submitted runs appear here once a client sends evidence."
                  : "Try another board or clear the search."
              }
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
                    Value
                  </TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide">
                    Player
                  </TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
                    Submitted
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((run) => (
                  <TableRow key={run.id} className="hover:bg-muted/25">
                    <TableCell className="px-3 py-2.5 font-mono text-xs">{run.boardId}</TableCell>
                    <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
                      {run.period}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-right font-mono text-sm tabular-nums">
                      {number(run.value)}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-sm">{run.displayName}</TableCell>
                    <TableCell className="px-3 py-2.5 text-right text-xs text-muted-foreground">
                      {relativeTime(run.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            Showing {number(filtered.length)} of {number(total)} runs
          </div>
        </Panel>
      </div>
    </>
  );
}
