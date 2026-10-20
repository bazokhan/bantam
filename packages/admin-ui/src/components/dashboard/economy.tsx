import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { grantLabel, responseToCatalog } from "@/lib/economy";
import { dateTime, number } from "@/lib/format";
import type { EconomyCatalogWrite, EconomyResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
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
import { ConfirmAction, EmptyState, PageHeader, Panel, StatusBadge } from "./primitives";
import { EconomySummaryPanel } from "./economy-summary";
import {
  CurrencyEditor,
  ItemEditor,
  OfferEditor,
  RewardEditor,
  errorText,
  itemDraft,
  newCurrencyDraft,
  newItemDraft,
  newOfferDraft,
  newRewardDraft,
  offerDraft,
  rewardDraft,
  validateCurrencyDraft,
  validateItemDraft,
  validateOfferDraft,
  validateRewardDraft,
  type CurrencyDraft,
  type CurrencyEntry,
  type ItemDraft,
  type ItemEntry,
  type OfferDraft,
  type OfferEntry,
  type RewardDraft,
  type RewardEntry,
} from "./economy-catalog";
import { useGameId } from "./use-game-id";

const HEAD_CLASS =
  "h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

export type EconomySection = "currencies" | "items" | "offers" | "rewards" | "iap";

const SECTION_META: Record<EconomySection, { title: string; description: string }> = {
  currencies: {
    title: "Currencies",
    description: "Wallet currencies players hold and spend.",
  },
  items: {
    title: "Items",
    description: "The grantable and purchasable objects of the catalog.",
  },
  offers: {
    title: "Store offers",
    description: "Bundles sold in the store for a currency amount.",
  },
  rewards: {
    title: "Rewards",
    description: "Claimable rewards and what they grant.",
  },
  iap: {
    title: "IAP products",
    description: "In-app purchase products bound to Google Play product ids.",
  },
};

interface SectionProps {
  response: EconomyResponse;
  commit: (catalog: EconomyCatalogWrite, message: string) => Promise<unknown>;
}

function windowText(startsAtMs: number | null, endsAtMs: number | null): string {
  if (startsAtMs === null && endsAtMs === null) return "always";
  const start = startsAtMs === null ? "—" : dateTime(new Date(startsAtMs).toISOString());
  const end = endsAtMs === null ? "—" : dateTime(new Date(endsAtMs).toISOString());
  return `${start} → ${end}`;
}

function CurrenciesPanel({ response, commit }: SectionProps) {
  const [draft, setDraft] = useState<CurrencyDraft | null>(null);
  const [error, setError] = useState("");

  const supply = new Map(response.summary.currencies.map((entry) => [entry.id, entry] as const));

  const openAdd = () => {
    setError("");
    setDraft(newCurrencyDraft());
  };

  const submit = async (entry: CurrencyEntry) => {
    if (!draft) return;
    const problem = validateCurrencyDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    const catalog = responseToCatalog(response);
    if (catalog.currencies.some((row) => row.id === entry.id)) {
      setError(`Currency ${entry.id} already exists.`);
      return;
    }
    if (catalog.currencies.length >= 16) {
      setError("A game can declare at most 16 currencies.");
      return;
    }
    catalog.currencies.push(entry);
    setError("");
    await commit(catalog, "Currency added");
    setDraft(null);
  };

  const remove = async (id: string) => {
    const catalog = responseToCatalog(response);
    catalog.currencies = catalog.currencies.filter((row) => row.id !== id);
    await commit(catalog, "Currency deleted");
  };

  return (
    <>
      <Panel
        title="Currencies"
        description="Wallet currencies of this game"
        actions={
          <Button size="sm" onClick={openAdd}>
            <Plus />
            Add currency
          </Button>
        }
      >
        {response.currencies.length === 0 ? (
          <EmptyState
            title="No currencies"
            description="This game declares no currencies. Add one to give players a balance to hold."
          />
        ) : (
          <Table className="min-w-[640px]">
            <TableHeader className="bg-muted/20">
              <TableRow>
                <TableHead className={HEAD_CLASS}>Id</TableHead>
                <TableHead className={HEAD_CLASS}>Total held</TableHead>
                <TableHead className={HEAD_CLASS}>Holders</TableHead>
                <TableHead className={HEAD_CLASS} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {response.currencies.map((currency) => {
                const balance = supply.get(currency.id);
                const holders = balance?.holders ?? 0;
                return (
                  <TableRow key={currency.id}>
                    <TableCell className="px-3 py-2.5">
                      <Input
                        readOnly
                        value={currency.id}
                        aria-label={`Currency ${currency.id}`}
                        className="h-8 w-40 font-mono text-xs"
                      />
                    </TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-sm tabular-nums">
                      {balance ? number(balance.amount) : "—"}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-sm tabular-nums">
                      {number(holders)}
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        <ConfirmAction
                          trigger={<Trash2 />}
                          title={`Delete ${currency.id}?`}
                          description={
                            holders > 0
                              ? `${number(holders)} player(s) hold this currency. Deleting it leaves their wallet rows pointing at a currency the game no longer declares.`
                              : "No player holds this currency. It is removed from the catalog."
                          }
                          confirmLabel="Delete"
                          onConfirm={async () => {
                            try {
                              await remove(currency.id);
                            } catch {
                              // The commit already reported the failure.
                            }
                          }}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Panel>

      <p className="mt-3 text-xs text-muted-foreground">
        A currency id is permanent: player wallet rows reference it, so it can only be added or
        removed, never renamed.
      </p>

      {draft ? (
        <CurrencyEditor
          draft={draft}
          error={error}
          onChange={setDraft}
          onSubmit={submit}
          onClose={() => {
            setDraft(null);
            setError("");
          }}
        />
      ) : null}
    </>
  );
}

function ItemsPanel({ response, commit }: SectionProps) {
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [error, setError] = useState("");

  const openAdd = () => {
    setError("");
    setDraft(newItemDraft());
  };

  const submit = async (entry: ItemEntry) => {
    if (!draft) return;
    const problem = validateItemDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    const catalog = responseToCatalog(response);
    const index = catalog.items.findIndex((row) => row.id === entry.id);
    if (draft.isNew) {
      if (index >= 0) {
        setError(`Item ${entry.id} already exists.`);
        return;
      }
      if (catalog.items.length >= 256) {
        setError("A game can declare at most 256 items.");
        return;
      }
      catalog.items.push(entry);
    } else {
      if (index < 0) {
        setError(`Item ${entry.id} is no longer in the catalog.`);
        return;
      }
      catalog.items[index] = entry;
    }
    setError("");
    await commit(catalog, draft.isNew ? "Item added" : "Item updated");
    setDraft(null);
  };

  const remove = async (id: string) => {
    const catalog = responseToCatalog(response);
    catalog.items = catalog.items.filter((row) => row.id !== id);
    await commit(catalog, "Item deleted");
  };

  return (
    <>
      <Panel
        title="Items"
        description="Grantable and purchasable objects"
        actions={
          <Button size="sm" onClick={openAdd}>
            <Plus />
            Add item
          </Button>
        }
      >
        {response.items.length === 0 ? (
          <EmptyState
            title="No items"
            description="This game declares no items. Add one to grant or sell it."
          />
        ) : (
          <Table className="min-w-[720px]">
            <TableHeader className="bg-muted/20">
              <TableRow>
                <TableHead className={HEAD_CLASS}>Id</TableHead>
                <TableHead className={HEAD_CLASS}>Type</TableHead>
                <TableHead className={HEAD_CLASS}>Stackable</TableHead>
                <TableHead className={HEAD_CLASS}>Usable</TableHead>
                <TableHead className={HEAD_CLASS} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {response.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="px-3 py-2.5 font-mono text-sm">{item.id}</TableCell>
                  <TableCell className="px-3 py-2.5 text-sm">{item.type}</TableCell>
                  <TableCell className="px-3 py-2.5 text-sm">
                    {item.stackable ? "yes" : "no"}
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-sm">
                    {item.usable ? "yes" : "no"}
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setError("");
                          setDraft(itemDraft(item));
                        }}
                        aria-label={`Edit ${item.id}`}
                      >
                        <Pencil />
                      </Button>
                      <ConfirmAction
                        trigger={<Trash2 />}
                        title={`Delete ${item.id}?`}
                        description="The item is removed from the catalog. Player inventory rows that still reference it are left pointing at a missing item."
                        confirmLabel="Delete"
                        onConfirm={async () => {
                          try {
                            await remove(item.id);
                          } catch {
                            // The commit already reported the failure.
                          }
                        }}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      {draft ? (
        <ItemEditor
          draft={draft}
          error={error}
          onChange={setDraft}
          onSubmit={submit}
          onClose={() => {
            setDraft(null);
            setError("");
          }}
        />
      ) : null}
    </>
  );
}

function OffersPanel({ response, commit }: SectionProps) {
  const [draft, setDraft] = useState<OfferDraft | null>(null);
  const [error, setError] = useState("");

  const currencyIds = response.currencies.map((row) => row.id);
  const itemIds = response.items.map((row) => row.id);

  const openAdd = () => {
    setError("");
    setDraft(newOfferDraft());
  };

  const submit = async (entry: OfferEntry) => {
    if (!draft) return;
    const problem = validateOfferDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    const catalog = responseToCatalog(response);
    const index = catalog.offers.findIndex((row) => row.id === entry.id);
    if (draft.isNew) {
      if (index >= 0) {
        setError(`Offer ${entry.id} already exists.`);
        return;
      }
      if (catalog.offers.length >= 256) {
        setError("A game can declare at most 256 offers.");
        return;
      }
      catalog.offers.push(entry);
    } else {
      if (index < 0) {
        setError(`Offer ${entry.id} is no longer in the catalog.`);
        return;
      }
      catalog.offers[index] = entry;
    }
    setError("");
    await commit(catalog, draft.isNew ? "Offer added" : "Offer updated");
    setDraft(null);
  };

  const remove = async (id: string) => {
    const catalog = responseToCatalog(response);
    catalog.offers = catalog.offers.filter((row) => row.id !== id);
    await commit(catalog, "Offer deleted");
  };

  return (
    <>
      <Panel
        title="Store offers"
        description="Bundles sold for a currency amount"
        actions={
          <Button size="sm" onClick={openAdd}>
            <Plus />
            Add offer
          </Button>
        }
      >
        {response.offers.length === 0 ? (
          <EmptyState
            title="No offers"
            description="This game declares no store offers. Add one to sell an item."
          />
        ) : (
          <Table className="min-w-[1000px]">
            <TableHeader className="bg-muted/20">
              <TableRow>
                <TableHead className={HEAD_CLASS}>Id</TableHead>
                <TableHead className={HEAD_CLASS}>Item</TableHead>
                <TableHead className={HEAD_CLASS}>Qty</TableHead>
                <TableHead className={HEAD_CLASS}>Price</TableHead>
                <TableHead className={HEAD_CLASS}>Sale price</TableHead>
                <TableHead className={HEAD_CLASS}>Max / player</TableHead>
                <TableHead className={HEAD_CLASS}>Availability</TableHead>
                <TableHead className={HEAD_CLASS}>State</TableHead>
                <TableHead className={HEAD_CLASS} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {response.offers.map((offer) => (
                <TableRow key={offer.id}>
                  <TableCell className="px-3 py-2.5 font-mono text-sm">{offer.id}</TableCell>
                  <TableCell className="px-3 py-2.5 font-mono text-sm">{offer.itemId}</TableCell>
                  <TableCell className="px-3 py-2.5 font-mono text-sm tabular-nums">
                    {offer.quantity}
                  </TableCell>
                  <TableCell className="px-3 py-2.5 font-mono text-sm tabular-nums">
                    {offer.priceAmount} {offer.priceCurrencyId}
                  </TableCell>
                  <TableCell className="px-3 py-2.5 font-mono text-sm tabular-nums">
                    {offer.salePriceAmount === null ? "—" : offer.salePriceAmount}
                  </TableCell>
                  <TableCell className="px-3 py-2.5 font-mono text-sm tabular-nums">
                    {offer.maxPerPlayer === null ? "unlimited" : offer.maxPerPlayer}
                  </TableCell>
                  <TableCell className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                    {windowText(offer.startsAtMs, offer.endsAtMs)}
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <StatusBadge
                      value={offer.active ? "active" : "inactive"}
                      tone={offer.active ? "success" : "neutral"}
                    />
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setError("");
                          setDraft(offerDraft(offer));
                        }}
                        aria-label={`Edit ${offer.id}`}
                      >
                        <Pencil />
                      </Button>
                      <ConfirmAction
                        trigger={<Trash2 />}
                        title={`Delete ${offer.id}?`}
                        description="The offer is removed from the store. Players who bought it keep what they bought."
                        confirmLabel="Delete"
                        onConfirm={async () => {
                          try {
                            await remove(offer.id);
                          } catch {
                            // The commit already reported the failure.
                          }
                        }}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      {draft ? (
        <OfferEditor
          draft={draft}
          error={error}
          currencyIds={currencyIds}
          itemIds={itemIds}
          onChange={setDraft}
          onSubmit={submit}
          onClose={() => {
            setDraft(null);
            setError("");
          }}
        />
      ) : null}
    </>
  );
}

function RewardsPanel({ response, commit }: SectionProps) {
  const [draft, setDraft] = useState<RewardDraft | null>(null);
  const [error, setError] = useState("");

  const currencyIds = response.currencies.map((row) => row.id);
  const itemIds = response.items.map((row) => row.id);

  const openAdd = () => {
    setError("");
    setDraft(newRewardDraft());
  };

  const submit = async (entry: RewardEntry) => {
    if (!draft) return;
    const problem = validateRewardDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    const catalog = responseToCatalog(response);
    const rewards = catalog.rewards ?? [];
    const index = rewards.findIndex((row) => row.id === entry.id);
    if (draft.isNew) {
      if (index >= 0) {
        setError(`Reward ${entry.id} already exists.`);
        return;
      }
      if (rewards.length >= 64) {
        setError("A game can declare at most 64 rewards.");
        return;
      }
      rewards.push(entry);
    } else {
      if (index < 0) {
        setError(`Reward ${entry.id} is no longer in the catalog.`);
        return;
      }
      rewards[index] = entry;
    }
    catalog.rewards = rewards;
    setError("");
    await commit(catalog, draft.isNew ? "Reward added" : "Reward updated");
    setDraft(null);
  };

  const remove = async (id: string) => {
    const catalog = responseToCatalog(response);
    catalog.rewards = (catalog.rewards ?? []).filter((row) => row.id !== id);
    await commit(catalog, "Reward deleted");
  };

  return (
    <>
      <Panel
        title="Rewards"
        description="Claimable rewards and what they grant"
        actions={
          <Button size="sm" onClick={openAdd}>
            <Plus />
            Add reward
          </Button>
        }
      >
        {response.rewards.length === 0 ? (
          <EmptyState
            title="No rewards"
            description="This game declares no rewards. Add one to give players something to claim."
          />
        ) : (
          <Table className="min-w-[860px]">
            <TableHeader className="bg-muted/20">
              <TableRow>
                <TableHead className={HEAD_CLASS}>Id</TableHead>
                <TableHead className={HEAD_CLASS}>Grants</TableHead>
                <TableHead className={HEAD_CLASS}>Max claims</TableHead>
                <TableHead className={HEAD_CLASS} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {response.rewards.map((reward) => (
                <TableRow key={reward.id}>
                  <TableCell className="px-3 py-2.5 font-mono text-sm">{reward.id}</TableCell>
                  <TableCell className="px-3 py-2.5 text-sm">
                    {reward.grants.length === 0
                      ? "—"
                      : reward.grants.map((grant) => grantLabel(grant)).join(" · ")}
                  </TableCell>
                  <TableCell className="px-3 py-2.5 font-mono text-sm tabular-nums">
                    {reward.maxClaims === null ? "unlimited" : reward.maxClaims}
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setError("");
                          setDraft(rewardDraft(reward));
                        }}
                        aria-label={`Edit ${reward.id}`}
                      >
                        <Pencil />
                      </Button>
                      <ConfirmAction
                        trigger={<Trash2 />}
                        title={`Delete ${reward.id}?`}
                        description="The reward is removed from the catalog. Players who already claimed it keep what they were granted."
                        confirmLabel="Delete"
                        onConfirm={async () => {
                          try {
                            await remove(reward.id);
                          } catch {
                            // The commit already reported the failure.
                          }
                        }}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      {draft ? (
        <RewardEditor
          draft={draft}
          error={error}
          currencyIds={currencyIds}
          itemIds={itemIds}
          onChange={setDraft}
          onSubmit={submit}
          onClose={() => {
            setDraft(null);
            setError("");
          }}
        />
      ) : null}
    </>
  );
}

function IapPanel({ response }: { response: EconomyResponse }) {
  return (
    <Panel title="IAP products" description="Managed in the Play Console — not editable here">
      {response.iapProducts.length === 0 ? (
        <EmptyState
          title="No IAP products"
          description="This game declares no in-app purchase products."
        />
      ) : (
        <Table className="min-w-[1000px]">
          <TableHeader className="bg-muted/20">
            <TableRow>
              <TableHead className={HEAD_CLASS}>Id</TableHead>
              <TableHead className={HEAD_CLASS}>Provider</TableHead>
              <TableHead className={HEAD_CLASS}>Product id</TableHead>
              <TableHead className={HEAD_CLASS}>Package</TableHead>
              <TableHead className={HEAD_CLASS}>Grants</TableHead>
              <TableHead className={HEAD_CLASS}>Fulfillment</TableHead>
              <TableHead className={HEAD_CLASS}>Availability</TableHead>
              <TableHead className={HEAD_CLASS}>State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {response.iapProducts.map((product) => (
              <TableRow key={product.id}>
                <TableCell className="px-3 py-2.5 font-mono text-sm">{product.id}</TableCell>
                <TableCell className="px-3 py-2.5 text-sm">{product.provider}</TableCell>
                <TableCell className="px-3 py-2.5 font-mono text-sm">
                  {product.providerProductId}
                </TableCell>
                <TableCell className="px-3 py-2.5 font-mono text-sm">
                  {product.packageName}
                </TableCell>
                <TableCell className="px-3 py-2.5 text-sm">
                  {product.grants.map((grant) => grantLabel(grant)).join(" · ")}
                </TableCell>
                <TableCell className="px-3 py-2.5 text-sm">{product.fulfillment ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                  {windowText(product.startsAtMs, product.endsAtMs)}
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <StatusBadge
                    value={product.active ? "active" : "inactive"}
                    tone={product.active ? "success" : "neutral"}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
        IAP products are managed in the Play Console and are not editable here: they are bound to a
        Google Play product id and an Android package name, and the console cannot change either.
      </p>
    </Panel>
  );
}

export function EconomyPage({ section }: { section: EconomySection }) {
  const gameId = useGameId();
  const queryClient = useQueryClient();
  const economyKey = ["admin-economy", gameId];

  const economy = useQuery({
    queryKey: economyKey,
    queryFn: () => api.economy(gameId),
  });

  const save = useMutation({
    mutationFn: ({ catalog }: { catalog: EconomyCatalogWrite; message: string }) =>
      api.saveEconomy(gameId, catalog),
    onSuccess: (_data, variables) => {
      toast.success(variables.message);
      void queryClient.invalidateQueries({ queryKey: economyKey });
    },
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
        <EmptyState
          title="Could not load the economy catalog"
          description={economy.error instanceof Error ? economy.error.message : "Unknown error"}
          action={<Button onClick={() => void economy.refetch()}>Retry</Button>}
        />
      </>
    );
  }

  const data = economy.data;

  const commit = async (catalog: EconomyCatalogWrite, message: string) => {
    const gap = catalogGap(data, catalog);
    if (gap) {
      toast.error(gap);
      throw new Error(gap);
    }
    try {
      return await save.mutateAsync({ catalog, message });
    } catch (cause) {
      toast.error(errorText(cause));
      throw cause;
    }
  };

  const meta = SECTION_META[section];

  return (
    <>
      <PageHeader
        title="Economy"
        description={meta.description}
        breadcrumb={`${gameId} / economy / ${section}`}
        actions={
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">{sectionCount(data, section)}</span>
            <span>{meta.title.toLowerCase()}</span>
          </div>
        }
      />

      <div className="space-y-5">
        <EconomySummaryPanel summary={data.summary} />

        {section === "currencies" ? <CurrenciesPanel response={data} commit={commit} /> : null}
        {section === "items" ? <ItemsPanel response={data} commit={commit} /> : null}
        {section === "offers" ? <OffersPanel response={data} commit={commit} /> : null}
        {section === "rewards" ? <RewardsPanel response={data} commit={commit} /> : null}
        {section === "iap" ? <IapPanel response={data} /> : null}
      </div>
    </>
  );
}

function sectionCount(response: EconomyResponse, section: EconomySection): number {
  if (section === "currencies") return response.currencies.length;
  if (section === "items") return response.items.length;
  if (section === "offers") return response.offers.length;
  if (section === "rewards") return response.rewards.length;
  return response.iapProducts.length;
}

/**
 * The server rejects a catalog without a currency or without an item, so the
 * console checks the same rule before it sends anything.
 */
function catalogGap(response: EconomyResponse, catalog: EconomyCatalogWrite): string | null {
  if (catalog.currencies.length === 0) {
    return response.currencies.length === 0
      ? "This game declares no economy catalog yet. The server needs at least one currency and one item: seed them from the manifest on the Settings page."
      : "A game must keep at least one currency.";
  }
  if (catalog.items.length === 0) {
    return response.items.length === 0
      ? "This game declares no economy catalog yet. The server needs at least one currency and one item: seed them from the manifest on the Settings page."
      : "A game must keep at least one item.";
  }
  return null;
}
