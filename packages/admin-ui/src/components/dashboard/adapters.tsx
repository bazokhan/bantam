import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { number } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
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
import { EmptyState, KpiStrip, Metric, PageHeader, Panel } from "./primitives";

const HEAD_CLASS =
  "h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

const CHIP_CLASS =
  "inline-flex items-center rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground";

export function AdaptersPage() {
  const adapters = useQuery({
    queryKey: ["admin-adapters"],
    queryFn: api.adapters,
  });

  if (adapters.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (adapters.isError || !adapters.data) {
    return (
      <>
        <PageHeader
          title="Adapters"
          description="Versioned adapters loaded by this instance and the boards they serve."
        />
        <EmptyState
          title="Could not load the adapters"
          description={adapters.error instanceof Error ? adapters.error.message : "Unknown error"}
          action={<Button onClick={() => void adapters.refetch()}>Retry</Button>}
        />
      </>
    );
  }

  const rows = adapters.data.adapters;
  const kinds = new Set(rows.map((adapter) => adapter.kind));
  const boards = new Set(rows.flatMap((adapter) => adapter.boards));
  const games = new Set(rows.flatMap((adapter) => adapter.games));

  return (
    <>
      <PageHeader
        title="Adapters"
        description="Versioned adapters loaded by this instance and the boards they serve."
        actions={
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">{rows.length}</span>
            <span>adapter{rows.length === 1 ? "" : "s"}</span>
          </div>
        }
      />

      <KpiStrip>
        <Metric label="Adapters" value={number(rows.length)} />
        <Metric label="Kinds" value={number(kinds.size)} />
        <Metric label="Boards covered" value={number(boards.size)} />
        <Metric label="Games using adapters" value={number(games.size)} />
      </KpiStrip>

      <div className="mt-5">
        <Panel title="Loaded adapters" description="Served by the runtimes in this instance">
          {rows.length === 0 ? (
            <EmptyState
              title="No adapters loaded"
              description="No adapter is registered for this instance. The built-in generic adapter is the fallback for trivial games."
            />
          ) : (
            <Table className="min-w-[880px]">
              <TableHeader className="bg-muted/20">
                <TableRow>
                  <TableHead className={HEAD_CLASS}>Adapter</TableHead>
                  <TableHead className={HEAD_CLASS}>Kind</TableHead>
                  <TableHead className={HEAD_CLASS}>Version</TableHead>
                  <TableHead className={HEAD_CLASS}>Boards</TableHead>
                  <TableHead className={HEAD_CLASS}>Games</TableHead>
                  <TableHead className={HEAD_CLASS}>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((adapter) => (
                  <TableRow key={adapter.id}>
                    <TableCell className="px-3 py-2.5">
                      <span className="font-mono text-sm">{adapter.id}</span>
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <Badge variant="outline" className="font-mono">
                        {adapter.kind}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-sm tabular-nums">
                      {adapter.version ?? "—"}
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <div className="font-mono text-xs tabular-nums text-muted-foreground">
                        {adapter.boards.length}
                      </div>
                      {adapter.boards.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {adapter.boards.map((board) => (
                            <span key={board} className={CHIP_CLASS}>
                              {board}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      {adapter.games.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {adapter.games.map((game) => (
                            <span key={game} className={CHIP_CLASS}>
                              {game}
                            </span>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <div
                        className="max-w-[240px] truncate font-mono text-xs text-muted-foreground"
                        title={adapter.source ?? undefined}
                      >
                        {adapter.source ?? "—"}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      </div>
    </>
  );
}
