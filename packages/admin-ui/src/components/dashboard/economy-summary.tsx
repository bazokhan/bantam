import { useMemo } from "react";

import { number } from "@/lib/format";
import type { EconomySummary } from "@/lib/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, Metric, Panel } from "./primitives";

const HEAD_CLASS =
  "h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

export function EconomySummaryPanel({ summary }: { summary: EconomySummary }) {
  const currencyTotal = useMemo(
    () => summary.currencies.reduce((sum, currency) => sum + currency.amount, 0),
    [summary.currencies],
  );

  const itemTotal = useMemo(
    () => summary.items.reduce((sum, item) => sum + item.quantity, 0),
    [summary.items],
  );

  return (
    <div className="space-y-5">
      {/* Five metrics, so the strip is 5-up rather than the 4-up KpiStrip. */}
      <section className="grid overflow-hidden border border-border bg-card sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Currency in circulation" value={number(currencyTotal)} />
        <Metric label="Items in circulation" value={number(itemTotal)} />
        <Metric label="Players with balance" value={number(summary.playersWithBalance)} />
        <Metric
          label="Wallet tx today"
          value={number(summary.walletTransactions.today)}
          hint={`${number(summary.walletTransactions.total)} total`}
        />
        <Metric
          label="Inventory tx today"
          value={number(summary.inventoryTransactions.today)}
          hint={`${number(summary.inventoryTransactions.total)} total`}
        />
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Currency supply" description="Outstanding balance per currency">
          {summary.currencies.length === 0 ? (
            <EmptyState
              title="No currency in circulation"
              description="No player holds a balance of this game's currencies."
            />
          ) : (
            <Table>
              <TableHeader className="bg-muted/20">
                <TableRow>
                  <TableHead className={HEAD_CLASS}>Currency</TableHead>
                  <TableHead className={HEAD_CLASS}>Outstanding</TableHead>
                  <TableHead className={HEAD_CLASS}>Holders</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.currencies.map((currency) => (
                  <TableRow key={currency.id}>
                    <TableCell className="px-3 py-2.5 font-mono text-sm">{currency.id}</TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-sm tabular-nums">
                      {number(currency.amount)}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-sm tabular-nums">
                      {number(currency.holders)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>

        <Panel title="Item supply" description="Quantity held across players">
          {summary.items.length === 0 ? (
            <EmptyState
              title="No items in circulation"
              description="No player holds an item of this game's catalog."
            />
          ) : (
            <Table>
              <TableHeader className="bg-muted/20">
                <TableRow>
                  <TableHead className={HEAD_CLASS}>Item</TableHead>
                  <TableHead className={HEAD_CLASS}>Quantity</TableHead>
                  <TableHead className={HEAD_CLASS}>Holders</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="px-3 py-2.5 font-mono text-sm">{item.id}</TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-sm tabular-nums">
                      {number(item.quantity)}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-sm tabular-nums">
                      {number(item.holders)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      </div>

      <p className="text-xs text-muted-foreground">
        Derived from the game's own SQLite ledgers — the same rows the economy endpoints read.
      </p>
    </div>
  );
}
