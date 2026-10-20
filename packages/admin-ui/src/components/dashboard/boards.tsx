import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { number, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
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
import { CopyButton, EmptyState, PageHeader, Panel, SimpleSelect, StatusBadge } from "./primitives";
import { useGameId } from "./use-game-id";

export function BoardsPage() {
  const gameId = useGameId();
  const [boardId, setBoardId] = useState<string | null>(null);
  const [period, setPeriod] = useState<string | null>(null);

  const game = useQuery({
    queryKey: ["admin-game", gameId],
    queryFn: () => api.game(gameId),
  });

  const boards = useMemo(() => game.data?.boards ?? [], [game.data]);

  const selected = useMemo(
    () => boards.find((board) => board.id === boardId) ?? boards[0] ?? null,
    [boards, boardId],
  );

  const entries = useQuery({
    queryKey: ["admin-board-entries", gameId, selected?.id ?? "", period],
    queryFn: () => {
      if (!selected) throw new Error("No board selected");
      return api.boardEntries(gameId, selected.id, period ?? undefined);
    },
    enabled: selected !== null,
  });

  const periods = useMemo(() => entries.data?.periods ?? [], [entries.data]);
  const daily = selected?.period === "daily";
  const activePeriod = period ?? entries.data?.period ?? periods[0] ?? "";
  const periodKey = period ?? entries.data?.period ?? selected?.period ?? "—";
  const entryCount = entries.data?.entries.length ?? 0;

  const selectBoard = (id: string) => {
    setBoardId(id);
    setPeriod(null);
  };

  if (game.isLoading) {
    return (
      <>
        <PageHeader title="Leaderboards" description="Loading the game leaderboards…" />
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      </>
    );
  }

  if (game.isError || !game.data) {
    return (
      <>
        <PageHeader title="Leaderboards" description="Game leaderboards could not be loaded." />
        <EmptyState
          title="Could not load the boards"
          description={game.error instanceof Error ? game.error.message : "Unknown error"}
          action={<Button onClick={() => void game.refetch()}>Retry</Button>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Leaderboards"
        description={`Every board declared by the adapters of ${game.data.displayName}.`}
      />

      {boards.length === 0 ? (
        <Panel title="Boards" description="No board is declared for this game">
          <EmptyState
            title="No leaderboards"
            description="Declare a board on an adapter to see it here."
          />
        </Panel>
      ) : (
        <>
          <div className="mb-4 lg:hidden">
            <SimpleSelect
              value={selected?.id ?? ""}
              onValueChange={selectBoard}
              items={boards.map((board) => ({ value: board.id, label: board.id }))}
              placeholder="Select a board"
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
            <Panel
              className="hidden lg:block"
              title="Boards"
              description={`${boards.length} declared`}
            >
              <div className="divide-y divide-border">
                {boards.map((board) => {
                  const active = board.id === selected?.id;
                  return (
                    <button
                      key={board.id}
                      type="button"
                      onClick={() => selectBoard(board.id)}
                      className={cn(
                        "w-full border-l-2 px-3 py-2 text-left transition-colors",
                        active
                          ? "border-primary bg-muted/40"
                          : "border-transparent hover:bg-muted/25",
                      )}
                    >
                      <div className="truncate font-mono text-xs">{board.id}</div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{board.period}</span>
                        <span className="font-mono tabular-nums">
                          {number(board.entries)} entries
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Panel>

            <Panel
              title={selected?.id ?? "Leaderboard"}
              description={selected ? `period ${selected.period}` : undefined}
              actions={selected ? <CopyButton value={selected.id} label="Copy board id" /> : null}
            >
              {daily ? (
                <div className="flex flex-col gap-2 border-b border-border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Period</span>
                  <SimpleSelect
                    className="sm:w-64"
                    value={activePeriod}
                    onValueChange={setPeriod}
                    items={periods.map((value) => ({ value, label: value }))}
                    placeholder="Select a period"
                  />
                </div>
              ) : null}

              {entries.isLoading ? (
                <div className="space-y-2 p-4">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : entries.isError ? (
                <EmptyState
                  title="Could not load the entries"
                  description={
                    entries.error instanceof Error ? entries.error.message : "Unknown error"
                  }
                  action={<Button onClick={() => void entries.refetch()}>Retry</Button>}
                />
              ) : entryCount === 0 ? (
                <EmptyState
                  title="No entries"
                  description="No player has a score on this board for this period yet."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide">
                        Rank
                      </TableHead>
                      <TableHead className="h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide">
                        Player
                      </TableHead>
                      <TableHead className="h-9 whitespace-nowrap px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
                        Value
                      </TableHead>
                      <TableHead className="h-9 whitespace-nowrap px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
                        Updated
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(entries.data?.entries ?? []).map((entry) => (
                      <TableRow
                        key={`${entry.playerId}:${entry.rank}`}
                        className="hover:bg-muted/25"
                      >
                        <TableCell className="px-3 py-2.5 font-mono text-sm tabular-nums">
                          {number(entry.rank)}
                        </TableCell>
                        <TableCell className="px-3 py-2.5 text-sm">{entry.displayName}</TableCell>
                        <TableCell className="px-3 py-2.5 text-right font-mono text-sm tabular-nums">
                          {number(entry.value)}
                        </TableCell>
                        <TableCell className="px-3 py-2.5 text-right text-xs text-muted-foreground">
                          {relativeTime(entry.updatedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2">
                <span className="text-xs text-muted-foreground">
                  {number(entryCount)} entries · period {periodKey}
                </span>
                {selected && !daily ? <StatusBadge value={selected.period} tone="neutral" /> : null}
              </div>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
