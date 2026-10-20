import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Code2, X } from "lucide-react";

import { api } from "@/lib/api";
import { dateTime, number, relativeTime, shortId } from "@/lib/format";
import type { AuditEntry } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAdmin } from "./app-context";
import { CodeBlock, EmptyState, PageHeader, Panel, SimpleSelect, StatusBadge } from "./primitives";

const ACTIONS = [
  "flag.write",
  "flag.toggle",
  "flag.delete",
  "player.delete",
  "currency.credit",
  "currency.debit",
  "item.grant",
  "item.remove",
  "manifest.save",
] as const;

const ALL = "all";
const LIMIT = 200;

const HEAD_CLASS =
  "h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

type Tone = "success" | "danger" | "warning" | "neutral";

function toneForAction(action: string): Tone {
  if (action.endsWith(".delete")) return "danger";
  if (action === "currency.credit" || action === "item.grant") return "success";
  if (action === "currency.debit" || action === "item.remove") return "warning";
  return "neutral";
}

function parseDetails(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function signedAmount(value: number): string {
  if (value > 0) return `+${number(value)}`;
  if (value < 0) return `−${number(Math.abs(value))}`;
  return number(0);
}

function summarize(entry: AuditEntry): string {
  const details = parseDetails(entry.details);
  if (!details) return entry.details.trim() || "—";

  const reason = typeof details["reason"] === "string" ? details["reason"] : "";
  const withReason = (head: string) => (reason ? `${head} (${reason})` : head);

  switch (entry.action) {
    case "currency.credit":
    case "currency.debit": {
      const currency =
        typeof details["currencyId"] === "string" ? details["currencyId"] : "currency";
      const amount = typeof details["amount"] === "number" ? details["amount"] : null;
      if (amount === null) return withReason(currency);
      return withReason(
        `${currency} ${signedAmount(entry.action === "currency.debit" ? -amount : amount)}`,
      );
    }
    case "item.grant":
    case "item.remove": {
      const item = typeof details["itemId"] === "string" ? details["itemId"] : "item";
      const quantity = typeof details["quantity"] === "number" ? details["quantity"] : null;
      if (quantity === null) return withReason(item);
      return withReason(
        `${item} ${signedAmount(entry.action === "item.remove" ? -quantity : quantity)}`,
      );
    }
    case "flag.write": {
      const enabled =
        details["enabled"] === true ? "enabled" : details["enabled"] === false ? "disabled" : null;
      const rollout =
        typeof details["rolloutPercent"] === "number"
          ? `${details["rolloutPercent"]}% rollout`
          : null;
      return [enabled, rollout].filter((part) => part !== null).join(" · ") || "—";
    }
    case "flag.toggle":
      return details["enabled"] === true
        ? "enabled"
        : details["enabled"] === false
          ? "disabled"
          : "—";
    case "manifest.save": {
      const environment = typeof details["environment"] === "string" ? details["environment"] : "";
      const games =
        typeof details["games"] === "number"
          ? `${details["games"]} game${details["games"] === 1 ? "" : "s"}`
          : "";
      return [environment, games].filter(Boolean).join(" · ") || "—";
    }
    default: {
      const parts: string[] = [];
      for (const [key, value] of Object.entries(details)) {
        if (typeof value === "string" || typeof value === "number") {
          parts.push(`${key}=${value}`);
        }
      }
      return parts.join(" · ") || "—";
    }
  }
}

export function AuditPage() {
  const { games } = useAdmin();
  const [action, setAction] = useState<string>(ALL);
  const [gameId, setGameId] = useState<string>(ALL);
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  const audit = useQuery({
    queryKey: ["admin-audit", action, gameId],
    queryFn: () =>
      api.audit({
        limit: LIMIT,
        action: action === ALL ? undefined : action,
        gameId: gameId === ALL ? undefined : gameId,
      }),
  });

  const actionItems = useMemo(
    () => [
      { value: ALL, label: "All actions" },
      ...ACTIONS.map((value) => ({ value, label: value })),
    ],
    [],
  );

  const gameItems = useMemo(
    () => [
      { value: ALL, label: "All games" },
      ...games.map((game) => ({ value: game.id, label: game.displayName })),
    ],
    [games],
  );

  const gameNames = useMemo(
    () => new Map(games.map((game) => [game.id, game.displayName])),
    [games],
  );

  if (audit.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (audit.isError || !audit.data) {
    return (
      <>
        <PageHeader
          title="Audit trail"
          description="Every action an operator took through the admin API, newest first."
        />
        <EmptyState
          title="Could not load the audit trail"
          description={audit.error instanceof Error ? audit.error.message : "Unknown error"}
          action={<Button onClick={() => void audit.refetch()}>Retry</Button>}
        />
      </>
    );
  }

  const entries = audit.data.entries;
  const total = audit.data.total;
  const filtered = action !== ALL || gameId !== ALL;

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Every action an operator took through the admin API, newest first. Entries are written by the server after the action it describes has committed."
        actions={
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">{number(total)}</span>
            <span>action{total === 1 ? "" : "s"} recorded</span>
          </div>
        }
      />

      <Panel title="Operator actions" description="Newest first">
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/20 p-3">
          <SimpleSelect
            className="w-full sm:w-56"
            value={action}
            onValueChange={setAction}
            items={actionItems}
          />
          <SimpleSelect
            className="w-full sm:w-56"
            value={gameId}
            onValueChange={setGameId}
            items={gameItems}
          />
          {filtered ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAction(ALL);
                setGameId(ALL);
              }}
            >
              <X />
              Clear filters
            </Button>
          ) : null}
        </div>

        {entries.length === 0 ? (
          <EmptyState
            title="No audit entries yet"
            description="The trail fills as operators act on this instance."
          />
        ) : (
          <Table className="min-w-[900px]">
            <TableHeader className="bg-muted/20">
              <TableRow>
                <TableHead className={HEAD_CLASS}>When</TableHead>
                <TableHead className={HEAD_CLASS}>Action</TableHead>
                <TableHead className={HEAD_CLASS}>Actor</TableHead>
                <TableHead className={HEAD_CLASS}>Game</TableHead>
                <TableHead className={HEAD_CLASS}>Target</TableHead>
                <TableHead className={HEAD_CLASS}>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="px-3 py-2.5">
                    <div className="text-xs">{relativeTime(entry.createdAt)}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {dateTime(entry.createdAt)}
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <StatusBadge value={entry.action} tone={toneForAction(entry.action)} />
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-sm">{entry.adminUsername}</TableCell>
                  <TableCell className="px-3 py-2.5">
                    {entry.gameId ? (
                      <>
                        <div className="text-sm">{gameNames.get(entry.gameId) ?? entry.gameId}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {entry.gameId}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell
                    className="px-3 py-2.5 font-mono text-xs"
                    title={entry.target ?? undefined}
                  >
                    {entry.target ? shortId(entry.target) : "—"}
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{summarize(entry)}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        aria-label="Show the raw details"
                        onClick={() => setSelected(entry)}
                      >
                        <Code2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Showing {number(entries.length)} of {number(total)} entries
        </div>
      </Panel>

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selected?.action ?? "Details"}</DialogTitle>
            <DialogDescription>The details exactly as the server recorded them.</DialogDescription>
          </DialogHeader>
          <CodeBlock>{selected?.details ?? ""}</CodeBlock>
        </DialogContent>
      </Dialog>
    </>
  );
}
