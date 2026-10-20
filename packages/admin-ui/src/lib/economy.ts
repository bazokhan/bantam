/**
 * Conversion between the economy catalog the console edits and the flat row
 * shapes the admin API returns.
 *
 * The response flattens a grant into one row shape (kind + the two fields
 * that kind uses) so the tables render both kinds in one place. The write
 * endpoint takes the catalog's own shape back. These two helpers are the only
 * place that knows about the difference, so a schema change shows up here
 * rather than in every table.
 */

import type { EconomyCatalogWrite, EconomyGrant, EconomyGrantRow, EconomyResponse } from "./types";

/** Flatten one catalog grant into the row shape the API returns. */
export function grantToRow(grant: EconomyGrant): EconomyGrantRow {
  return grant.kind === "currency"
    ? { kind: "currency", currencyId: grant.currencyId, amount: grant.amount }
    : { kind: "item", itemId: grant.itemId, quantity: grant.quantity };
}

/** Rebuild one catalog grant from the row shape the API returns. */
export function rowToGrant(row: EconomyGrantRow): EconomyGrant {
  if (row.kind === "currency") {
    if (row.currencyId === undefined || row.amount === undefined)
      throw new Error(`Malformed currency grant: ${JSON.stringify(row)}`);
    return { kind: "currency", currencyId: row.currencyId, amount: row.amount };
  }
  if (row.itemId === undefined || row.quantity === undefined)
    throw new Error(`Malformed item grant: ${JSON.stringify(row)}`);
  return { kind: "item", itemId: row.itemId, quantity: row.quantity };
}

/** Human label for a grant, e.g. "100 gold" or "3 x potion". */
export function grantLabel(row: EconomyGrantRow): string {
  return row.kind === "currency"
    ? `${row.amount ?? 0} ${row.currencyId ?? "?"}`
    : `${row.quantity ?? 0} × ${row.itemId ?? "?"}`;
}

/**
 * Turn the catalog the API returned into the body the write endpoint accepts.
 * Optional fields that were absent come back absent, so a round-trip does not
 * invent defaults the game never declared.
 */
export function responseToCatalog(response: EconomyResponse): EconomyCatalogWrite {
  return {
    currencies: response.currencies.map((currency) => ({ id: currency.id })),
    items: response.items.map((item) => ({
      id: item.id,
      type: item.type === "permanent" ? "permanent" : "consumable",
      stackable: item.stackable,
      usable: item.usable,
    })),
    offers: response.offers.map((offer) => ({
      id: offer.id,
      itemId: offer.itemId,
      quantity: offer.quantity,
      priceCurrencyId: offer.priceCurrencyId,
      priceAmount: offer.priceAmount,
      active: offer.active,
      ...(offer.maxPerPlayer !== null ? { maxPerPlayer: offer.maxPerPlayer } : {}),
      ...(offer.startsAtMs !== null ? { startsAtMs: offer.startsAtMs } : {}),
      ...(offer.endsAtMs !== null ? { endsAtMs: offer.endsAtMs } : {}),
      ...(offer.salePriceAmount !== null ? { salePriceAmount: offer.salePriceAmount } : {}),
      ...(offer.saleStartsAtMs !== null ? { saleStartsAtMs: offer.saleStartsAtMs } : {}),
      ...(offer.saleEndsAtMs !== null ? { saleEndsAtMs: offer.saleEndsAtMs } : {}),
    })),
    rewards: response.rewards.map((reward) => ({
      id: reward.id,
      grants: reward.grants.map(rowToGrant),
      ...(reward.maxClaims !== null ? { maxClaims: reward.maxClaims } : {}),
    })),
    iapProducts: response.iapProducts.map((product) => ({
      id: product.id,
      provider: "google_play",
      providerProductId: product.providerProductId,
      packageName: product.packageName,
      grants: product.grants.map(rowToGrant),
      active: product.active,
      ...(product.startsAtMs !== null ? { startsAtMs: product.startsAtMs } : {}),
      ...(product.endsAtMs !== null ? { endsAtMs: product.endsAtMs } : {}),
      ...(product.fulfillment !== null ? { fulfillment: product.fulfillment } : {}),
    })),
  };
}
