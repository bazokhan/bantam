import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { number, relativeTime } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, StatusBadge } from "./primitives";

export function PlayerEntriesSection({ gameId, playerId }: { gameId: string; playerId: string }) {
  const entries = useQuery({
    queryKey: ["admin-player-entries", gameId, playerId],
    queryFn: () => api.playerEntries(gameId, playerId),
    enabled: !!playerId,
  });

  if (entries.isLoading) {
    return (
      <div className="p-3">
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (entries.isError) {
    return (
      <EmptyState
        title="Could not load the leaderboard entries"
        description={entries.error instanceof Error ? entries.error.message : "Unknown error"}
      />
    );
  }

  const list = entries.data?.entries ?? [];

  if (list.length === 0) {
    return (
      <EmptyState title="No leaderboard entries" description="This player has no scores yet." />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wide">
            Board
          </TableHead>
          <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wide">
            Period
          </TableHead>
          <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wide">
            Rank
          </TableHead>
          <TableHead className="h-8 px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
            Score
          </TableHead>
          <TableHead className="h-8 px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
            Achieved
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {list.map((entry) => (
          <TableRow key={`${entry.boardId}:${entry.period}`}>
            <TableCell className="px-3 py-2 font-mono text-xs">{entry.boardId}</TableCell>
            <TableCell className="px-3 py-2 font-mono text-xs">{entry.period}</TableCell>
            <TableCell className="px-3 py-2">
              {entry.rank === 1 ? (
                <StatusBadge value="#1" tone="success" />
              ) : (
                <span className="font-mono text-sm tabular-nums">#{entry.rank}</span>
              )}
            </TableCell>
            <TableCell className="px-3 py-2 text-right font-mono text-sm tabular-nums">
              {number(entry.value)}
            </TableCell>
            <TableCell className="px-3 py-2 text-right text-xs text-muted-foreground">
              {relativeTime(entry.achievedAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
