import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "./primitives";
import { SimpleSelect } from "./primitives";

const REASON_PATTERN = /^[a-z][a-z0-9_.:-]{0,63}$/;

function newRequestId(): string {
  return `admin:${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

export function EconomyAdjust({ gameId, playerId }: { gameId: string; playerId: string }) {
  const queryClient = useQueryClient();
  const economy = useQuery({
    queryKey: ["admin-economy", gameId],
    queryFn: () => api.economy(gameId),
  });

  const [currencyId, setCurrencyId] = useState("");
  const [amount, setAmount] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  const [itemDirection, setItemDirection] = useState<"grant" | "remove">("grant");
  const [reason, setReason] = useState("admin_adjustment");
  const [currencyRequestId, setCurrencyRequestId] = useState(newRequestId);
  const [itemRequestId, setItemRequestId] = useState(newRequestId);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["admin-player", gameId, playerId] });
  };

  const currency = useMutation({
    mutationFn: () =>
      api.adjustCurrency(gameId, playerId, {
        currencyId,
        amount: Number(amount),
        direction,
        reason,
        requestId: currencyRequestId,
      }),
    onSuccess: async () => {
      toast.success("Currency adjusted");
      setAmount("");
      setCurrencyRequestId(newRequestId());
      await refresh();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Currency adjustment failed");
    },
  });

  const item = useMutation({
    mutationFn: () =>
      api.adjustItem(gameId, playerId, {
        itemId,
        quantity: Number(quantity),
        direction: itemDirection,
        reason,
        requestId: itemRequestId,
      }),
    onSuccess: async () => {
      toast.success("Inventory adjusted");
      setQuantity("");
      setItemRequestId(newRequestId());
      await refresh();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Inventory adjustment failed");
    },
  });

  const reasonValid = REASON_PATTERN.test(reason);
  const amountValid = Number.isSafeInteger(Number(amount)) && Number(amount) > 0;
  const quantityValid = Number.isSafeInteger(Number(quantity)) && Number(quantity) > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Adjust currency" description="Credit or debit a catalog currency">
        {economy.data && economy.data.currencies.length > 0 ? (
          <div className="space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="adjust-currency">Currency</Label>
                <SimpleSelect
                  value={currencyId}
                  onValueChange={setCurrencyId}
                  placeholder="Pick a currency"
                  items={economy.data.currencies.map((row) => ({ value: row.id, label: row.id }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adjust-direction">Direction</Label>
                <SimpleSelect
                  value={direction}
                  onValueChange={(value) => setDirection(value === "debit" ? "debit" : "credit")}
                  items={[
                    { value: "credit", label: "Credit" },
                    { value: "debit", label: "Debit" },
                  ]}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adjust-amount">Amount</Label>
              <Input
                id="adjust-amount"
                type="number"
                min={1}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <Button
              size="sm"
              disabled={!currencyId || !amountValid || !reasonValid || currency.isPending}
              onClick={() => currency.mutate()}
            >
              {currency.isPending ? <Loader2 className="animate-spin" /> : null}
              Apply
            </Button>
          </div>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            This game declares no currencies.
          </p>
        )}
      </Panel>

      <Panel title="Adjust inventory" description="Grant or remove a catalog item">
        {economy.data && economy.data.items.length > 0 ? (
          <div className="space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="adjust-item">Item</Label>
                <SimpleSelect
                  value={itemId}
                  onValueChange={setItemId}
                  placeholder="Pick an item"
                  items={economy.data.items.map((row) => ({ value: row.id, label: row.id }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adjust-item-direction">Direction</Label>
                <SimpleSelect
                  value={itemDirection}
                  onValueChange={(value) =>
                    setItemDirection(value === "remove" ? "remove" : "grant")
                  }
                  items={[
                    { value: "grant", label: "Grant" },
                    { value: "remove", label: "Remove" },
                  ]}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adjust-quantity">Quantity</Label>
              <Input
                id="adjust-quantity"
                type="number"
                min={1}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>
            <Button
              size="sm"
              disabled={!itemId || !quantityValid || !reasonValid || item.isPending}
              onClick={() => item.mutate()}
            >
              {item.isPending ? <Loader2 className="animate-spin" /> : null}
              Apply
            </Button>
          </div>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            This game declares no items.
          </p>
        )}
      </Panel>

      <div className="space-y-1.5 lg:col-span-2">
        <Label htmlFor="adjust-reason">Reason</Label>
        <Input
          id="adjust-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Recorded on the immutable ledger. Lowercase letters, digits and{" "}
          <code className="font-mono">_ . : -</code> only.
          {!reasonValid ? " This reason is not accepted by the server." : null}
        </p>
      </div>
    </div>
  );
}
