import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Boxes, Gamepad2, Trophy, Users } from "lucide-react";

import { api } from "@/lib/api";
import { compactNumber, number, relativeTime } from "@/lib/format";
import type { EnvKeyStatus } from "@/lib/types";
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
import {
  DataToolbar,
  EmptyState,
  KpiStrip,
  Metric,
  PageHeader,
  Panel,
  StatusBadge,
} from "./primitives";

function envSummary(keys: EnvKeyStatus[]): string {
  return keys.map((key) => `${key.name}: ${key.present ? "present" : "missing"}`).join("\n");
}

export function GamesPage() {
  const [search, setSearch] = useState("");

  const games = useQuery({
    queryKey: ["admin-games"],
    queryFn: api.games,
  });

  const list = useMemo(() => games.data ?? [], [games.data]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return list;
    return list.filter(
      (game) =>
        game.displayName.toLowerCase().includes(query) || game.id.toLowerCase().includes(query),
    );
  }, [list, search]);

  const totals = useMemo(
    () => ({
      games: list.length,
      players: list.reduce((sum, game) => sum + game.players, 0),
      boards: list.reduce((sum, game) => sum + game.boards.length, 0),
      flags: list.reduce((sum, game) => sum + game.flags, 0),
    }),
    [list],
  );

  if (games.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (games.isError || !games.data) {
    return (
      <>
        <PageHeader title="Games" description="Every game registered in the manifest." />
        <EmptyState
          title="Could not load the games"
          description={games.error instanceof Error ? games.error.message : "Unknown error"}
          action={<Button onClick={() => void games.refetch()}>Retry</Button>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Games"
        description="Every game loaded from the manifest, with its leaderboards, players, and environment status."
      />

      <KpiStrip>
        <Metric
          label="Games"
          value={compactNumber(totals.games)}
          icon={<Gamepad2 className="size-4" />}
        />
        <Metric
          label="Players"
          value={compactNumber(totals.players)}
          icon={<Users className="size-4" />}
        />
        <Metric
          label="Leaderboards"
          value={compactNumber(totals.boards)}
          icon={<Trophy className="size-4" />}
        />
        <Metric
          label="Feature flags"
          value={compactNumber(totals.flags)}
          icon={<Boxes className="size-4" />}
        />
      </KpiStrip>

      <div className="mt-5">
        <Panel title="Games" description="Open a game to inspect boards, players, and runs.">
          <DataToolbar search={search} setSearch={setSearch} placeholder="Search by name or id…" />

          {filtered.length === 0 ? (
            <EmptyState
              title={list.length === 0 ? "No games registered" : "No games match the search"}
              description={
                list.length === 0
                  ? "Add a game to the manifest to see it here."
                  : "Try a different name or id."
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide">
                    Game
                  </TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide">
                    Auth
                  </TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
                    Boards
                  </TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
                    Players
                  </TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
                    Runs today
                  </TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide">
                    Last run
                  </TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide">
                    Database
                  </TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide">
                    Env
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((game) => {
                  const present = game.envKeys.filter((key) => key.present).length;
                  const missing = game.envKeys.length - present;
                  return (
                    <TableRow key={game.id} className="hover:bg-muted/25">
                      <TableCell className="px-3 py-3">
                        <Link
                          to="/games/$gameId"
                          params={{ gameId: game.id }}
                          className="text-sm font-medium hover:text-primary"
                        >
                          {game.displayName}
                        </Link>
                        <div className="font-mono text-[11px] text-muted-foreground">{game.id}</div>
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        <StatusBadge
                          value={game.authProvider}
                          tone={game.authProvider === "pgs-v2" ? "success" : "neutral"}
                        />
                      </TableCell>
                      <TableCell className="px-3 py-3 text-right font-mono text-sm tabular-nums">
                        {number(game.boards.length)}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-right font-mono text-sm tabular-nums">
                        {number(game.players)}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-right font-mono text-sm tabular-nums">
                        {number(game.runsToday)}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                        {relativeTime(game.lastRunAt)}
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        <StatusBadge
                          value={game.dbReady ? "ready" : "unavailable"}
                          tone={game.dbReady ? "success" : "danger"}
                        />
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        {game.envKeys.length === 0 ? (
                          <span className="text-xs text-muted-foreground">none</span>
                        ) : (
                          <span
                            className="whitespace-nowrap font-mono text-xs tabular-nums"
                            title={envSummary(game.envKeys)}
                          >
                            <span className={missing > 0 ? "text-warning" : "text-success"}>
                              {present}
                            </span>
                            <span className="text-muted-foreground">/{game.envKeys.length}</span>
                            {missing > 0 ? (
                              <span className="ml-1 text-destructive">{missing} missing</span>
                            ) : null}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Panel>
      </div>
    </>
  );
}
