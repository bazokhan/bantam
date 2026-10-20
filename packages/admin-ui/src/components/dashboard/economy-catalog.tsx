import { useState, type ReactNode } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { AdminApiError } from "@/lib/api";
import type {
  EconomyCatalogWrite,
  EconomyGrant,
  EconomyOfferRow,
  EconomyResponse,
  EconomyRewardRow,
} from "@/lib/types";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SimpleSelect } from "./primitives";

const ID_PATTERN = /^[a-z][a-z0-9_-]{0,47}$/;

export type CurrencyEntry = EconomyCatalogWrite["currencies"][number];
export type ItemEntry = EconomyCatalogWrite["items"][number];
export type OfferEntry = EconomyCatalogWrite["offers"][number];
export type RewardEntry = NonNullable<EconomyCatalogWrite["rewards"]>[number];

export interface CurrencyDraft {
  id: string;
}

export interface ItemDraft {
  id: string;
  isNew: boolean;
  type: "consumable" | "permanent";
  stackable: boolean;
  usable: boolean;
}

export interface OfferDraft {
  id: string;
  isNew: boolean;
  itemId: string;
  quantity: string;
  priceCurrencyId: string;
  priceAmount: string;
  active: boolean;
  maxPerPlayer: string;
  startsAtMs: string;
  endsAtMs: string;
  salePriceAmount: string;
  saleStartsAtMs: string;
  saleEndsAtMs: string;
}

export interface GrantDraft {
  kind: "currency" | "item";
  targetId: string;
  amount: string;
}

export interface RewardDraft {
  id: string;
  isNew: boolean;
  grants: GrantDraft[];
  maxClaims: string;
}

/** The server text first, its extra details after it. */
export function errorText(cause: unknown): string {
  if (cause instanceof AdminApiError) {
    return cause.details.length > 0
      ? `${cause.message} (${cause.details.join(" · ")})`
      : cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return "Unknown error";
}

function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

function optionalWholeNumber(text: string): number | null {
  return text.trim() === "" ? null : wholeNumber(text);
}

export function validateCatalogId(id: string): string | null {
  const trimmed = id.trim();
  if (trimmed === "") return "Id is required.";
  if (!ID_PATTERN.test(trimmed))
    return "Id must start with a lowercase letter and use only a-z, 0-9, _ and - (48 characters max).";
  return null;
}

export function validateCurrencyDraft(draft: CurrencyDraft): string | null {
  return validateCatalogId(draft.id);
}

export function validateItemDraft(draft: ItemDraft): string | null {
  const idProblem = validateCatalogId(draft.id);
  if (idProblem) return idProblem;
  if (draft.type === "permanent" && draft.stackable) return "A permanent item cannot be stackable.";
  return null;
}

export function validateOfferDraft(draft: OfferDraft): string | null {
  const idProblem = validateCatalogId(draft.id);
  if (idProblem) return idProblem;
  if (draft.itemId === "") return "Select the item this offer sells.";
  const quantity = wholeNumber(draft.quantity);
  if (quantity === null || quantity < 1) return "Quantity must be a whole number of at least 1.";
  if (draft.priceCurrencyId === "") return "Select the currency the price is charged in.";
  const priceAmount = wholeNumber(draft.priceAmount);
  if (priceAmount === null || priceAmount < 1) return "Price must be a whole number of at least 1.";

  const maxPerPlayer = optionalWholeNumber(draft.maxPerPlayer);
  if (draft.maxPerPlayer.trim() !== "" && (maxPerPlayer === null || maxPerPlayer < 1))
    return "Max per player must be a whole number of at least 1.";

  const startsAtMs = optionalWholeNumber(draft.startsAtMs);
  const endsAtMs = optionalWholeNumber(draft.endsAtMs);
  if (draft.startsAtMs.trim() !== "" && startsAtMs === null)
    return "Starts at must be epoch milliseconds.";
  if (draft.endsAtMs.trim() !== "" && endsAtMs === null)
    return "Ends at must be epoch milliseconds.";
  if (startsAtMs !== null && endsAtMs !== null && startsAtMs >= endsAtMs)
    return "The offer starts at must be before it ends.";

  const salePriceAmount = optionalWholeNumber(draft.salePriceAmount);
  if (draft.salePriceAmount.trim() !== "" && (salePriceAmount === null || salePriceAmount < 1))
    return "Sale price must be a whole number of at least 1.";
  if (salePriceAmount !== null && salePriceAmount >= priceAmount)
    return "The sale price must be lower than the list price.";

  const saleStartsAtMs = optionalWholeNumber(draft.saleStartsAtMs);
  const saleEndsAtMs = optionalWholeNumber(draft.saleEndsAtMs);
  if (draft.saleStartsAtMs.trim() !== "" && saleStartsAtMs === null)
    return "Sale starts at must be epoch milliseconds.";
  if (draft.saleEndsAtMs.trim() !== "" && saleEndsAtMs === null)
    return "Sale ends at must be epoch milliseconds.";
  if (saleStartsAtMs !== null && saleEndsAtMs !== null && saleStartsAtMs >= saleEndsAtMs)
    return "The sale starts at must be before it ends.";
  return null;
}

export function validateRewardDraft(draft: RewardDraft): string | null {
  const idProblem = validateCatalogId(draft.id);
  if (idProblem) return idProblem;
  if (draft.grants.length === 0) return "A reward needs at least one grant.";
  if (draft.grants.length > 16) return "A reward can hold at most 16 grants.";
  for (const grant of draft.grants) {
    if (grant.targetId === "")
      return grant.kind === "currency"
        ? "Select the currency to grant."
        : "Select the item to grant.";
    const amount = wholeNumber(grant.amount);
    if (amount === null || amount < 1)
      return grant.kind === "currency"
        ? "Grant amount must be a whole number of at least 1."
        : "Grant quantity must be a whole number of at least 1.";
  }
  const maxClaims = optionalWholeNumber(draft.maxClaims);
  if (draft.maxClaims.trim() !== "" && (maxClaims === null || maxClaims < 1))
    return "Max claims must be a whole number of at least 1.";
  return null;
}

export function newCurrencyDraft(): CurrencyDraft {
  return { id: "" };
}

export function newItemDraft(): ItemDraft {
  return { id: "", isNew: true, type: "consumable", stackable: true, usable: false };
}

export function newOfferDraft(): OfferDraft {
  return {
    id: "",
    isNew: true,
    itemId: "",
    quantity: "1",
    priceCurrencyId: "",
    priceAmount: "1",
    active: true,
    maxPerPlayer: "",
    startsAtMs: "",
    endsAtMs: "",
    salePriceAmount: "",
    saleStartsAtMs: "",
    saleEndsAtMs: "",
  };
}

export function newRewardDraft(): RewardDraft {
  return {
    id: "",
    isNew: true,
    grants: [{ kind: "currency", targetId: "", amount: "" }],
    maxClaims: "",
  };
}

export function itemDraft(row: EconomyResponse["items"][number]): ItemDraft {
  return {
    id: row.id,
    isNew: false,
    type: row.type === "permanent" ? "permanent" : "consumable",
    stackable: row.stackable,
    usable: row.usable,
  };
}

export function offerDraft(row: EconomyOfferRow): OfferDraft {
  return {
    id: row.id,
    isNew: false,
    itemId: row.itemId,
    quantity: String(row.quantity),
    priceCurrencyId: row.priceCurrencyId,
    priceAmount: String(row.priceAmount),
    active: row.active,
    maxPerPlayer: row.maxPerPlayer === null ? "" : String(row.maxPerPlayer),
    startsAtMs: row.startsAtMs === null ? "" : String(row.startsAtMs),
    endsAtMs: row.endsAtMs === null ? "" : String(row.endsAtMs),
    salePriceAmount: row.salePriceAmount === null ? "" : String(row.salePriceAmount),
    saleStartsAtMs: row.saleStartsAtMs === null ? "" : String(row.saleStartsAtMs),
    saleEndsAtMs: row.saleEndsAtMs === null ? "" : String(row.saleEndsAtMs),
  };
}

export function rewardDraft(row: EconomyRewardRow): RewardDraft {
  return {
    id: row.id,
    isNew: false,
    grants: row.grants.map((grant) => ({
      kind: grant.kind,
      targetId: grant.kind === "currency" ? (grant.currencyId ?? "") : (grant.itemId ?? ""),
      amount: String(grant.kind === "currency" ? (grant.amount ?? 0) : (grant.quantity ?? 0)),
    })),
    maxClaims: row.maxClaims === null ? "" : String(row.maxClaims),
  };
}

export function toCurrencyEntry(draft: CurrencyDraft): CurrencyEntry {
  return { id: draft.id.trim() };
}

export function toItemEntry(draft: ItemDraft): ItemEntry {
  return {
    id: draft.id.trim(),
    type: draft.type,
    stackable: draft.stackable,
    usable: draft.usable,
  };
}

export function toOfferEntry(draft: OfferDraft): OfferEntry {
  const entry: OfferEntry = {
    id: draft.id.trim(),
    itemId: draft.itemId,
    quantity: Number(draft.quantity),
    priceCurrencyId: draft.priceCurrencyId,
    priceAmount: Number(draft.priceAmount),
    active: draft.active,
  };
  const maxPerPlayer = optionalWholeNumber(draft.maxPerPlayer);
  if (maxPerPlayer !== null) entry.maxPerPlayer = maxPerPlayer;
  const startsAtMs = optionalWholeNumber(draft.startsAtMs);
  if (startsAtMs !== null) entry.startsAtMs = startsAtMs;
  const endsAtMs = optionalWholeNumber(draft.endsAtMs);
  if (endsAtMs !== null) entry.endsAtMs = endsAtMs;
  const salePriceAmount = optionalWholeNumber(draft.salePriceAmount);
  if (salePriceAmount !== null) entry.salePriceAmount = salePriceAmount;
  const saleStartsAtMs = optionalWholeNumber(draft.saleStartsAtMs);
  if (saleStartsAtMs !== null) entry.saleStartsAtMs = saleStartsAtMs;
  const saleEndsAtMs = optionalWholeNumber(draft.saleEndsAtMs);
  if (saleEndsAtMs !== null) entry.saleEndsAtMs = saleEndsAtMs;
  return entry;
}

export function toRewardEntry(draft: RewardDraft): RewardEntry {
  const grants: EconomyGrant[] = draft.grants.map(
    (grant): EconomyGrant =>
      grant.kind === "currency"
        ? { kind: "currency", currencyId: grant.targetId, amount: Number(grant.amount) }
        : { kind: "item", itemId: grant.targetId, quantity: Number(grant.amount) },
  );
  const entry: RewardEntry = { id: draft.id.trim(), grants };
  const maxClaims = optionalWholeNumber(draft.maxClaims);
  if (maxClaims !== null) entry.maxClaims = maxClaims;
  return entry;
}

function EditorDialog({
  open,
  title,
  description,
  error,
  onClose,
  onSave,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  error: string;
  onClose: () => void;
  onSave: () => Promise<void>;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">{children}</div>

        {error || failure ? <p className="text-xs text-destructive">{error || failure}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setFailure("");
              void (async () => {
                try {
                  await onSave();
                } catch (cause) {
                  setFailure(errorText(cause));
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CurrencyEditor({
  draft,
  error,
  onChange,
  onSubmit,
  onClose,
}: {
  draft: CurrencyDraft;
  error: string;
  onChange: (draft: CurrencyDraft) => void;
  onSubmit: (entry: CurrencyEntry) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <EditorDialog
      open
      title="Add currency"
      description="Currencies are the wallet balances players hold."
      error={error}
      onClose={onClose}
      onSave={() => onSubmit(toCurrencyEntry(draft))}
    >
      <div className="space-y-1.5">
        <Label htmlFor="currency-id">Id</Label>
        <Input
          id="currency-id"
          value={draft.id}
          onChange={(event) => onChange({ ...draft, id: event.target.value })}
          className="font-mono"
          placeholder="gold"
        />
        <p className="text-xs text-muted-foreground">
          Lowercase letters, digits, _ and - only. A currency id cannot be renamed later: player
          wallet rows reference it.
        </p>
      </div>
    </EditorDialog>
  );
}

export function ItemEditor({
  draft,
  error,
  onChange,
  onSubmit,
  onClose,
}: {
  draft: ItemDraft;
  error: string;
  onChange: (draft: ItemDraft) => void;
  onSubmit: (entry: ItemEntry) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <EditorDialog
      open
      title={draft.isNew ? "Add item" : "Edit item"}
      description="Items are the grantable and purchasable objects of the catalog."
      error={error}
      onClose={onClose}
      onSave={() => onSubmit(toItemEntry(draft))}
    >
      <div className="space-y-1.5">
        <Label htmlFor="item-id">Id</Label>
        <Input
          id="item-id"
          value={draft.id}
          readOnly={!draft.isNew}
          onChange={(event) => onChange({ ...draft, id: event.target.value })}
          className="font-mono"
          placeholder="potion"
        />
        <p className="text-xs text-muted-foreground">
          {draft.isNew
            ? "Lowercase letters, digits, _ and - only."
            : "An item id cannot be changed: player inventory rows reference it."}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Type</Label>
        <SimpleSelect
          value={draft.type}
          onValueChange={(value) =>
            onChange({ ...draft, type: value === "permanent" ? "permanent" : "consumable" })
          }
          items={[
            { value: "consumable", label: "Consumable" },
            { value: "permanent", label: "Permanent" },
          ]}
        />
      </div>

      <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2">
        <Label htmlFor="item-stackable">Stackable</Label>
        <Switch
          id="item-stackable"
          checked={draft.stackable}
          onCheckedChange={(checked) => onChange({ ...draft, stackable: checked })}
        />
      </div>

      <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2">
        <Label htmlFor="item-usable">Usable</Label>
        <Switch
          id="item-usable"
          checked={draft.usable}
          onCheckedChange={(checked) => onChange({ ...draft, usable: checked })}
        />
      </div>
    </EditorDialog>
  );
}

export function OfferEditor({
  draft,
  error,
  currencyIds,
  itemIds,
  onChange,
  onSubmit,
  onClose,
}: {
  draft: OfferDraft;
  error: string;
  currencyIds: string[];
  itemIds: string[];
  onChange: (draft: OfferDraft) => void;
  onSubmit: (entry: OfferEntry) => Promise<void>;
  onClose: () => void;
}) {
  const currencyOptions = currencyIds.map((id) => ({ value: id, label: id }));
  const itemOptions = itemIds.map((id) => ({ value: id, label: id }));

  return (
    <EditorDialog
      open
      title={draft.isNew ? "Add offer" : "Edit offer"}
      description="An offer sells a quantity of one item for a currency amount."
      error={error}
      onClose={onClose}
      onSave={() => onSubmit(toOfferEntry(draft))}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="offer-id">Id</Label>
          <Input
            id="offer-id"
            value={draft.id}
            readOnly={!draft.isNew}
            onChange={(event) => onChange({ ...draft, id: event.target.value })}
            className="font-mono"
            placeholder="starter_pack"
          />
          <p className="text-xs text-muted-foreground">
            {draft.isNew
              ? "Lowercase letters, digits, _ and - only."
              : "An offer id cannot be changed: player purchases reference it."}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Item</Label>
          <SimpleSelect
            value={draft.itemId}
            onValueChange={(value) => onChange({ ...draft, itemId: value })}
            placeholder="Pick an item"
            items={itemOptions}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="offer-quantity">Quantity</Label>
          <Input
            id="offer-quantity"
            type="number"
            min={1}
            step={1}
            value={draft.quantity}
            onChange={(event) => onChange({ ...draft, quantity: event.target.value })}
            className="font-mono tabular-nums"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Price currency</Label>
          <SimpleSelect
            value={draft.priceCurrencyId}
            onValueChange={(value) => onChange({ ...draft, priceCurrencyId: value })}
            placeholder="Pick a currency"
            items={currencyOptions}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="offer-price">Price amount</Label>
          <Input
            id="offer-price"
            type="number"
            min={1}
            step={1}
            value={draft.priceAmount}
            onChange={(event) => onChange({ ...draft, priceAmount: event.target.value })}
            className="font-mono tabular-nums"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="offer-max">Max per player</Label>
          <Input
            id="offer-max"
            type="number"
            min={1}
            step={1}
            value={draft.maxPerPlayer}
            onChange={(event) => onChange({ ...draft, maxPerPlayer: event.target.value })}
            className="font-mono tabular-nums"
            placeholder="unlimited"
          />
        </div>

        <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2 sm:col-span-2">
          <Label htmlFor="offer-active">Active</Label>
          <Switch
            id="offer-active"
            checked={draft.active}
            onCheckedChange={(checked) => onChange({ ...draft, active: checked })}
          />
        </div>

        <div className="sm:col-span-2">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Availability window — epoch milliseconds, empty means no limit
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="offer-starts">Starts at</Label>
              <Input
                id="offer-starts"
                type="number"
                min={0}
                step={1}
                value={draft.startsAtMs}
                onChange={(event) => onChange({ ...draft, startsAtMs: event.target.value })}
                className="font-mono tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="offer-ends">Ends at</Label>
              <Input
                id="offer-ends"
                type="number"
                min={0}
                step={1}
                value={draft.endsAtMs}
                onChange={(event) => onChange({ ...draft, endsAtMs: event.target.value })}
                className="font-mono tabular-nums"
              />
            </div>
          </div>
        </div>

        <div className="sm:col-span-2">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Sale — empty means the offer never goes on sale
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="offer-sale-price">Sale price</Label>
              <Input
                id="offer-sale-price"
                type="number"
                min={1}
                step={1}
                value={draft.salePriceAmount}
                onChange={(event) => onChange({ ...draft, salePriceAmount: event.target.value })}
                className="font-mono tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="offer-sale-starts">Sale starts at</Label>
              <Input
                id="offer-sale-starts"
                type="number"
                min={0}
                step={1}
                value={draft.saleStartsAtMs}
                onChange={(event) => onChange({ ...draft, saleStartsAtMs: event.target.value })}
                className="font-mono tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="offer-sale-ends">Sale ends at</Label>
              <Input
                id="offer-sale-ends"
                type="number"
                min={0}
                step={1}
                value={draft.saleEndsAtMs}
                onChange={(event) => onChange({ ...draft, saleEndsAtMs: event.target.value })}
                className="font-mono tabular-nums"
              />
            </div>
          </div>
        </div>
      </div>
    </EditorDialog>
  );
}

export function RewardEditor({
  draft,
  error,
  currencyIds,
  itemIds,
  onChange,
  onSubmit,
  onClose,
}: {
  draft: RewardDraft;
  error: string;
  currencyIds: string[];
  itemIds: string[];
  onChange: (draft: RewardDraft) => void;
  onSubmit: (entry: RewardEntry) => Promise<void>;
  onClose: () => void;
}) {
  const updateGrant = (index: number, patch: Partial<GrantDraft>) => {
    onChange({
      ...draft,
      grants: draft.grants.map((grant, position) =>
        position === index ? { ...grant, ...patch } : grant,
      ),
    });
  };

  return (
    <EditorDialog
      open
      title={draft.isNew ? "Add reward" : "Edit reward"}
      description="A reward grants currency or items to a player who claims it."
      error={error}
      onClose={onClose}
      onSave={() => onSubmit(toRewardEntry(draft))}
    >
      <div className="space-y-1.5">
        <Label htmlFor="reward-id">Id</Label>
        <Input
          id="reward-id"
          value={draft.id}
          readOnly={!draft.isNew}
          onChange={(event) => onChange({ ...draft, id: event.target.value })}
          className="font-mono"
          placeholder="daily_bonus"
        />
        <p className="text-xs text-muted-foreground">
          {draft.isNew
            ? "Lowercase letters, digits, _ and - only."
            : "A reward id cannot be changed: reward claims reference it."}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Grants</Label>
          <Button
            variant="outline"
            size="sm"
            disabled={draft.grants.length >= 16}
            onClick={() =>
              onChange({
                ...draft,
                grants: [...draft.grants, { kind: "currency", targetId: "", amount: "" }],
              })
            }
          >
            <Plus />
            Add grant
          </Button>
        </div>

        {draft.grants.length === 0 ? (
          <p className="text-xs text-muted-foreground">A reward needs at least one grant.</p>
        ) : null}

        {draft.grants.map((grant, index) => (
          <div
            key={index}
            className="grid gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-2"
          >
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <SimpleSelect
                value={grant.kind}
                onValueChange={(value) =>
                  updateGrant(index, {
                    kind: value === "item" ? "item" : "currency",
                    targetId: "",
                  })
                }
                items={[
                  { value: "currency", label: "Currency" },
                  { value: "item", label: "Item" },
                ]}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{grant.kind === "currency" ? "Currency" : "Item"}</Label>
              <SimpleSelect
                value={grant.targetId}
                onValueChange={(value) => updateGrant(index, { targetId: value })}
                placeholder={grant.kind === "currency" ? "Pick a currency" : "Pick an item"}
                items={
                  grant.kind === "currency"
                    ? currencyIds.map((id) => ({ value: id, label: id }))
                    : itemIds.map((id) => ({ value: id, label: id }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`grant-amount-${index}`}>
                {grant.kind === "currency" ? "Amount" : "Quantity"}
              </Label>
              <Input
                id={`grant-amount-${index}`}
                type="number"
                min={1}
                step={1}
                value={grant.amount}
                onChange={(event) => updateGrant(index, { amount: event.target.value })}
                className="font-mono tabular-nums"
              />
            </div>

            <div className="flex items-end">
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove grant ${index + 1}`}
                onClick={() =>
                  onChange({
                    ...draft,
                    grants: draft.grants.filter((_, position) => position !== index),
                  })
                }
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="reward-max-claims">Max claims</Label>
        <Input
          id="reward-max-claims"
          type="number"
          min={1}
          step={1}
          value={draft.maxClaims}
          onChange={(event) => onChange({ ...draft, maxClaims: event.target.value })}
          className="font-mono tabular-nums"
          placeholder="unlimited"
        />
      </div>
    </EditorDialog>
  );
}
