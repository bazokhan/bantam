import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { api } from "@/lib/api";
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
import { EmptyState, PageHeader, Panel } from "./primitives";
import { EconomySummaryPanel } from "./economy-summary";
import { GameTabs } from "./game-tabs";
import { useGameId } from "./use-game-id";

const HEAD_CLASS =
  "h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

export function EconomyPage() {
  const gameId = useGameId();

  const economy = useQuery({
    queryKey: ["admin-economy", gameId],
    queryFn: () => api.economy(gameId),
  });

  if (economy.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (economy.isError || !economy.data) {
    return (
      <>
        <PageHeader
          title="Economy"
          description="Currencies, items and store offers declared for this game."
        />
        <GameTabs gameId={gameId} />
        <EmptyState
          title="Could not load the economy catalog"
          description={economy.error instanceof Error ? economy.error.message : "Unknown error"}
          action={<Button onClick={() => void economy.refetch()}>Retry</Button>}
        />
      </>
    );
  }

  const { currencies, items, offers, summary } = economy.data;

  return (
    <>
      <PageHeader
        title="Economy"
        description="Currencies, items and store offers declared for this game."
        breadcrumb={`${gameId} / economy`}
      />

      <GameTabs gameId={gameId} />

      <EconomySummaryPanel summary={summary} />

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Panel title="Currencies" description="Wallet currencies">
          {currencies.length === 0 ? (
            <EmptyState title="No currencies" description="This game declares no currencies." />
          ) : (
            <Table>
              <TableHeader className="bg-muted/20">
                <TableRow>
                  <TableHead className={HEAD_CLASS}>Id</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currencies.map((currency) => (
                  <TableRow key={currency.id}>
                    <TableCell className="px-3 py-2.5 font-mono text-sm">{currency.id}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>

        <Panel title="Items" description="Purchasable items">
          {items.length === 0 ? (
            <EmptyState title="No items" description="This game declares no items." />
          ) : (
            <Table>
              <TableHeader className="bg-muted/20">
                <TableRow>
                  <TableHead className={HEAD_CLASS}>Id</TableHead>
                  <TableHead className={HEAD_CLASS}>Type</TableHead>
                  <TableHead className={HEAD_CLASS}>Stackable</TableHead>
                  <TableHead className={HEAD_CLASS}>Usable</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="px-3 py-2.5 font-mono text-sm">{item.id}</TableCell>
                    <TableCell className="px-3 py-2.5 text-sm">{item.type}</TableCell>
                    <TableCell className="px-3 py-2.5 text-sm">
                      {item.stackable ? "yes" : "no"}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-sm">
                      {item.usable ? "yes" : "no"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>

        <Panel title="Store offers" description="Bundles sold in the store">
          {offers.length === 0 ? (
            <EmptyState title="No offers" description="This game declares no store offers." />
          ) : (
            <Table>
              <TableHeader className="bg-muted/20">
                <TableRow>
                  <TableHead className={HEAD_CLASS}>Id</TableHead>
                  <TableHead className={HEAD_CLASS}>Item</TableHead>
                  <TableHead className={HEAD_CLASS}>Qty</TableHead>
                  <TableHead className={HEAD_CLASS}>Price</TableHead>
                  <TableHead className={HEAD_CLASS}>Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {offers.map((offer) => (
                  <TableRow key={offer.id}>
                    <TableCell className="px-3 py-2.5 font-mono text-sm">{offer.id}</TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-sm">{offer.itemId}</TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-sm tabular-nums">
                      {offer.quantity}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-sm tabular-nums">
                      {offer.priceAmount} {offer.priceCurrencyId}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-sm">
                      {offer.active ? "on" : "off"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        The catalog is defined in the manifest and edited on the{" "}
        <Link to="/settings" className="text-primary hover:underline">
          Settings
        </Link>{" "}
        page.
      </p>
    </>
  );
}
