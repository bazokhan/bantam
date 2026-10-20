import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { grantLabel } from "@/lib/economy";
import { number, relativeTime, shortId } from "@/lib/format";
import type { EconomyRewardRow, PlayerRewardClaim, RewardClaimRequest } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EconomyAdjust } from "./economy-adjust";
import { PlayerEntriesSection } from "./player-entries";
import {
  ConfirmAction,
  DataToolbar,
  EmptyState,
  PageHeader,
  Panel,
  StatusBadge,
} from "./primitives";
import { useGameId } from "./use-game-id";

const LEDGER_LIMIT = 25;
const REASON_MAX_LENGTH = 64;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border border-border bg-card">
      <h3 className="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function RewardClaimRow({
  gameId,
  playerId,
  reward,
  claim,
}: {
  gameId: string;
  playerId: string;
  reward: EconomyRewardRow;
  claim: PlayerRewardClaim | undefined;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const claims = claim?.claims ?? 0;
  const maxClaims = reward.maxClaims ?? 1;
  const limitReached = claims >= maxClaims;

  const claimReward = useMutation({
    mutationFn: () => {
      const body: RewardClaimRequest = {};
      const trimmed = reason.trim();
      if (trimmed) body.reason = trimmed;
      return api.claimReward(gameId, playerId, reward.id, body);
    },
    onSuccess: async (result) => {
      toast.success(`Reward ${result.rewardId} claimed`);
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["admin-player", gameId, playerId] });
      await queryClient.invalidateQueries({ queryKey: ["admin-economy", gameId] });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  return (
    <TableRow>
      <TableCell className="px-3 py-2 font-mono text-xs">{reward.id}</TableCell>
      <TableCell className="px-3 py-2 text-xs">
        {reward.grants.length === 0 ? "—" : reward.grants.map(grantLabel).join(", ")}
      </TableCell>
      <TableCell className="px-3 py-2 text-right font-mono text-sm tabular-nums">
        {number(claims)}
      </TableCell>
      <TableCell className="px-3 py-2 text-right font-mono text-sm tabular-nums">
        {number(maxClaims)}
      </TableCell>
      <TableCell className="px-3 py-2">
        <div className="flex items-center justify-end gap-2">
          {limitReached ? (
            <span className="text-xs text-muted-foreground">claim limit reached</span>
          ) : null}
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="support compensation"
            aria-label={`Reason for claiming ${reward.id}`}
            maxLength={REASON_MAX_LENGTH}
            disabled={limitReached || claimReward.isPending}
            className="h-8 w-44 text-xs"
          />
          <Button
            size="sm"
            disabled={limitReached || claimReward.isPending}
            onClick={() => claimReward.mutate()}
          >
            {claimReward.isPending ? <Loader2 className="animate-spin" /> : null}
            Claim
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function PlayerRewards({
  gameId,
  playerId,
  claims,
}: {
  gameId: string;
  playerId: string;
  claims: PlayerRewardClaim[];
}) {
  const economy = useQuery({
    queryKey: ["admin-economy", gameId],
    queryFn: () => api.economy(gameId),
  });

  if (economy.isLoading) {
    return (
      <div className="p-3">
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (economy.isError) {
    return (
      <EmptyState
        title="Could not load the rewards"
        description={economy.error instanceof Error ? economy.error.message : "Unknown error"}
      />
    );
  }

  const rewards = economy.data?.rewards ?? [];

  if (rewards.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        This game declares no rewards.
      </p>
    );
  }

  const claimsByReward = new Map<string, PlayerRewardClaim>();
  for (const claim of claims) {
    claimsByReward.set(claim.rewardId, claim);
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wide">
            Reward
          </TableHead>
          <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wide">
            Grants
          </TableHead>
          <TableHead className="h-8 px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
            Claims
          </TableHead>
          <TableHead className="h-8 px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
            Limit
          </TableHead>
          <TableHead className="h-8 px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
            Claim
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rewards.map((reward) => (
          <RewardClaimRow
            key={reward.id}
            gameId={gameId}
            playerId={playerId}
            reward={reward}
            claim={claimsByReward.get(reward.id)}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function DeletePlayerAction({
  playerId,
  onDelete,
}: {
  playerId: string;
  onDelete: (playerId: string) => Promise<void>;
}) {
  return (
    <ConfirmAction
      trigger={
        <>
          <Trash2 />
          Delete player
        </>
      }
      title="Delete this player?"
      description={`Player ${playerId} will be removed together with its sessions, leaderboard entries, runs, and economy data. This cannot be undone.`}
      confirmLabel="Delete player"
      onConfirm={async () => {
        try {
          await onDelete(playerId);
        } catch {
          // surfaced as a toast by the mutation error handler
        }
      }}
    />
  );
}

export function PlayersPage() {
  const gameId = useGameId();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const players = useQuery({
    queryKey: ["admin-players", gameId],
    queryFn: () => api.players(gameId),
  });

  const detail = useQuery({
    queryKey: ["admin-player", gameId, selectedId],
    queryFn: () => {
      if (!selectedId) throw new Error("No player selected");
      return api.player(gameId, selectedId);
    },
    enabled: selectedId !== null,
  });

  const remove = useMutation({
    mutationFn: (playerId: string) => api.deletePlayer(gameId, playerId),
    onSuccess: () => {
      toast.success("Player deleted");
      setSelectedId(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-players", gameId] });
      void queryClient.invalidateQueries({ queryKey: ["admin-player", gameId] });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const list = useMemo(() => players.data?.players ?? [], [players.data]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return list;
    return list.filter(
      (player) =>
        player.displayName.toLowerCase().includes(query) || player.id.toLowerCase().includes(query),
    );
  }, [list, search]);

  const total = players.data?.total ?? 0;

  if (players.isLoading) {
    return (
      <>
        <PageHeader title="Players" description="Loading the players of this game…" />
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      </>
    );
  }

  if (players.isError || !players.data) {
    return (
      <>
        <PageHeader title="Players" description="Players could not be loaded." />
        <EmptyState
          title="Could not load the players"
          description={players.error instanceof Error ? players.error.message : "Unknown error"}
          action={<Button onClick={() => void players.refetch()}>Retry</Button>}
        />
      </>
    );
  }

  const selected = list.find((player) => player.id === selectedId) ?? null;

  return (
    <>
      <PageHeader
        title="Players"
        description="Every account that signed into this game. Open a player to inspect its wallet, ledger, and purchases."
      />

      <Panel title="Players" description={`${number(total)} registered`}>
        <DataToolbar
          search={search}
          setSearch={setSearch}
          placeholder="Search by display name or id…"
        />

        {filtered.length === 0 ? (
          <EmptyState
            title={list.length === 0 ? "No players yet" : "No players match the search"}
            description={
              list.length === 0
                ? "Players appear here after their first sign-in."
                : "Try a different display name or id."
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide">
                  Display name
                </TableHead>
                <TableHead className="h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide">
                  Id
                </TableHead>
                <TableHead className="h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide">
                  Provider
                </TableHead>
                <TableHead className="h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide">
                  Created
                </TableHead>
                <TableHead className="h-9 whitespace-nowrap px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
                  Runs
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((player) => (
                <TableRow
                  key={player.id}
                  className="cursor-pointer hover:bg-muted/25"
                  onClick={() => setSelectedId(player.id)}
                >
                  <TableCell className="px-3 py-3">
                    <button
                      type="button"
                      className="text-left text-sm font-medium hover:text-primary"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedId(player.id);
                      }}
                    >
                      {player.displayName}
                    </button>
                  </TableCell>
                  <TableCell className="px-3 py-3 font-mono text-xs text-muted-foreground">
                    {shortId(player.id)}
                  </TableCell>
                  <TableCell className="px-3 py-3">
                    <StatusBadge
                      value={player.provider}
                      tone={player.provider === "pgs-v2" ? "success" : "neutral"}
                    />
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                    {relativeTime(player.createdAt)}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-right font-mono text-sm tabular-nums">
                    {number(player.runs)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Showing {number(filtered.length)} of {number(total)} players
        </div>
      </Panel>

      <Dialog
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {detail.data?.displayName ?? selected?.displayName ?? "Player"}
            </DialogTitle>
            <DialogDescription>
              {selectedId ? shortId(selectedId) : ""} ·{" "}
              {detail.data?.provider ?? selected?.provider ?? "—"}
            </DialogDescription>
          </DialogHeader>

          {detail.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : detail.isError || !detail.data ? (
            <EmptyState
              title="Could not load the player"
              description={detail.error instanceof Error ? detail.error.message : "Unknown error"}
              action={<Button onClick={() => void detail.refetch()}>Retry</Button>}
            />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-4">
                <div className="border border-border bg-card px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Runs
                  </div>
                  <div className="mt-1 font-mono text-lg tabular-nums">
                    {number(detail.data.runs)}
                  </div>
                </div>
                <div className="border border-border bg-card px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Created
                  </div>
                  <div className="mt-1 font-mono text-lg tabular-nums">
                    {relativeTime(detail.data.createdAt)}
                  </div>
                </div>
                <div className="border border-border bg-card px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Balances
                  </div>
                  <div className="mt-1 font-mono text-lg tabular-nums">
                    {number(detail.data.wallet.length)}
                  </div>
                </div>
                <div className="border border-border bg-card px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Ledger
                  </div>
                  <div className="mt-1 font-mono text-lg tabular-nums">
                    {number(detail.data.ledger.length)}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Section title="Wallet">
                  {detail.data.wallet.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                      No currency balance.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wide">
                            Currency
                          </TableHead>
                          <TableHead className="h-8 px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
                            Amount
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.data.wallet.map((balance) => (
                          <TableRow key={balance.currency}>
                            <TableCell className="px-3 py-2 font-mono text-sm">
                              {balance.currency}
                            </TableCell>
                            <TableCell className="px-3 py-2 text-right font-mono text-sm tabular-nums">
                              {number(balance.amount)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Section>

                <Section title="Inventory">
                  {detail.data.inventory.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                      The inventory is empty.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wide">
                            Item
                          </TableHead>
                          <TableHead className="h-8 px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
                            Quantity
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.data.inventory.map((item) => (
                          <TableRow key={item.item}>
                            <TableCell className="px-3 py-2 font-mono text-sm">
                              {item.item}
                            </TableCell>
                            <TableCell className="px-3 py-2 text-right font-mono text-sm tabular-nums">
                              {number(item.quantity)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Section>
              </div>

              <Section title="Leaderboards">
                {selectedId ? <PlayerEntriesSection gameId={gameId} playerId={selectedId} /> : null}
              </Section>

              <Section title={`Ledger · latest ${LEDGER_LIMIT}`}>
                {detail.data.ledger.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                    No ledger entry.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wide">
                          Reason
                        </TableHead>
                        <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wide">
                          Currency
                        </TableHead>
                        <TableHead className="h-8 px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
                          Amount
                        </TableHead>
                        <TableHead className="h-8 px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
                          Balance
                        </TableHead>
                        <TableHead className="h-8 px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
                          When
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.data.ledger.slice(0, LEDGER_LIMIT).map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className="px-3 py-2 text-sm">{entry.reason}</TableCell>
                          <TableCell className="px-3 py-2 font-mono text-xs">
                            {entry.currency}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-right font-mono text-sm tabular-nums">
                            {number(entry.amount)}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-right font-mono text-sm tabular-nums">
                            {number(entry.balance)}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-right text-xs text-muted-foreground">
                            {relativeTime(entry.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Section>

              <Section title={`Inventory ledger · latest ${LEDGER_LIMIT}`}>
                {detail.data.inventoryLedger.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                    No inventory movement yet.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wide">
                          Item
                        </TableHead>
                        <TableHead className="h-8 px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
                          Change
                        </TableHead>
                        <TableHead className="h-8 px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
                          Balance after
                        </TableHead>
                        <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wide">
                          Reason
                        </TableHead>
                        <TableHead className="h-8 px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
                          When
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.data.inventoryLedger.slice(0, LEDGER_LIMIT).map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className="px-3 py-2 font-mono text-xs">
                            {entry.item}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "px-3 py-2 text-right font-mono text-sm tabular-nums font-semibold",
                              entry.amount > 0
                                ? "text-success"
                                : entry.amount < 0
                                  ? "text-destructive"
                                  : "text-muted-foreground",
                            )}
                          >
                            {entry.amount > 0 ? "+" : entry.amount < 0 ? "−" : ""}
                            {number(Math.abs(entry.amount))}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-right font-mono text-sm tabular-nums">
                            {number(entry.balance)}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-sm">{entry.reason}</TableCell>
                          <TableCell className="px-3 py-2 text-right text-xs text-muted-foreground">
                            {relativeTime(entry.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Section>

              <div className="grid gap-4 lg:grid-cols-2">
                <Section title="Purchases">
                  {detail.data.purchases.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                      No purchase yet.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wide">
                            Offer
                          </TableHead>
                          <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wide">
                            Item
                          </TableHead>
                          <TableHead className="h-8 px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
                            Qty
                          </TableHead>
                          <TableHead className="h-8 px-3 text-right text-[11px] font-semibold uppercase tracking-wide">
                            Price
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.data.purchases.map((purchase) => (
                          <TableRow key={purchase.id}>
                            <TableCell className="px-3 py-2 font-mono text-xs">
                              {purchase.offerId}
                            </TableCell>
                            <TableCell className="px-3 py-2 font-mono text-xs">
                              {purchase.itemId}
                            </TableCell>
                            <TableCell className="px-3 py-2 text-right font-mono text-sm tabular-nums">
                              {number(purchase.quantity)}
                            </TableCell>
                            <TableCell className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                              {purchase.currencyId} {number(purchase.priceAmount)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Section>

                <Section title="IAP purchases">
                  {detail.data.iapPurchases.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                      No IAP purchase yet.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wide">
                            Product
                          </TableHead>
                          <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wide">
                            Provider
                          </TableHead>
                          <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wide">
                            Verification
                          </TableHead>
                          <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wide">
                            Fulfillment
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.data.iapPurchases.map((purchase) => (
                          <TableRow key={purchase.id}>
                            <TableCell className="px-3 py-2 font-mono text-xs">
                              {purchase.productId}
                            </TableCell>
                            <TableCell className="px-3 py-2 text-xs text-muted-foreground">
                              {purchase.provider}
                            </TableCell>
                            <TableCell className="px-3 py-2">
                              <StatusBadge
                                value={purchase.verificationState}
                                tone={
                                  purchase.verificationState.toLowerCase().includes("verified")
                                    ? "success"
                                    : "neutral"
                                }
                              />
                            </TableCell>
                            <TableCell className="px-3 py-2">
                              <StatusBadge
                                value={purchase.fulfillmentState}
                                tone={
                                  purchase.fulfillmentState.toLowerCase().includes("fulfilled")
                                    ? "success"
                                    : "neutral"
                                }
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Section>
              </div>

              <Section title="Rewards">
                {selectedId ? (
                  <PlayerRewards
                    gameId={gameId}
                    playerId={selectedId}
                    claims={detail.data.rewardClaims ?? []}
                  />
                ) : null}
              </Section>

              {selectedId ? <EconomyAdjust gameId={gameId} playerId={selectedId} /> : null}
            </div>
          )}

          <DialogFooter>
            {selectedId ? (
              <DeletePlayerAction playerId={selectedId} onDelete={remove.mutateAsync} />
            ) : null}
            <Button variant="outline" onClick={() => setSelectedId(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
