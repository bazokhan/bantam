import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { BantamError } from "../errors.js";

export const ECONOMY_ID_PATTERN = /^[a-z][a-z0-9_-]{0,47}$/;
export const PROVIDER_PRODUCT_ID_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;
export const PACKAGE_NAME_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

const EconomyId = Type.String({ pattern: "^[a-z][a-z0-9_-]{0,47}$" });

export const CurrencyGrantSchema = Type.Object(
  {
    kind: Type.Literal("currency"),
    currencyId: EconomyId,
    amount: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  },
  { additionalProperties: false },
);
export const ItemGrantSchema = Type.Object(
  {
    kind: Type.Literal("item"),
    itemId: EconomyId,
    quantity: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  },
  { additionalProperties: false },
);
export const EconomyGrantSchema = Type.Union([CurrencyGrantSchema, ItemGrantSchema]);

export const EconomyCurrencySchema = Type.Object({ id: EconomyId }, { additionalProperties: false });
export const EconomyItemSchema = Type.Object(
  {
    id: EconomyId,
    type: Type.Union([Type.Literal("consumable"), Type.Literal("permanent")]),
    stackable: Type.Boolean(),
    usable: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export const EconomyOfferSchema = Type.Object(
  {
    id: EconomyId,
    itemId: EconomyId,
    quantity: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    priceCurrencyId: EconomyId,
    priceAmount: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    active: Type.Optional(Type.Boolean()),
    maxPerPlayer: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
  },
  { additionalProperties: false },
);
export const EconomyRewardSchema = Type.Object(
  {
    id: EconomyId,
    grants: Type.Array(EconomyGrantSchema, { minItems: 1, maxItems: 16 }),
    maxClaims: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
  },
  { additionalProperties: false },
);
export const EconomyIapProductSchema = Type.Object(
  {
    id: EconomyId,
    provider: Type.Literal("google_play"),
    providerProductId: Type.String({ pattern: "^[A-Za-z0-9._~-]{1,128}$" }),
    packageName: Type.String({
      pattern: "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$",
      maxLength: 255,
    }),
    grants: Type.Array(EconomyGrantSchema, { minItems: 1, maxItems: 16 }),
  },
  { additionalProperties: false },
);
export const EconomyCatalogSchema = Type.Object(
  {
    currencies: Type.Array(EconomyCurrencySchema, { minItems: 1, maxItems: 16 }),
    items: Type.Array(EconomyItemSchema, { minItems: 1, maxItems: 256 }),
    offers: Type.Array(EconomyOfferSchema, { maxItems: 256 }),
    rewards: Type.Optional(Type.Array(EconomyRewardSchema, { maxItems: 64 })),
    iapProducts: Type.Optional(Type.Array(EconomyIapProductSchema, { maxItems: 64 })),
  },
  { additionalProperties: false },
);

export type CurrencyGrant = Static<typeof CurrencyGrantSchema>;
export type ItemGrant = Static<typeof ItemGrantSchema>;
export type EconomyGrant = Static<typeof EconomyGrantSchema>;
export type EconomyCurrency = Static<typeof EconomyCurrencySchema>;
export type EconomyItem = Static<typeof EconomyItemSchema>;
export type EconomyOffer = Static<typeof EconomyOfferSchema>;
export type EconomyReward = Static<typeof EconomyRewardSchema>;
export type EconomyIapProduct = Static<typeof EconomyIapProductSchema>;
export type EconomyCatalog = Static<typeof EconomyCatalogSchema>;

export type PublicStoreOffer = {
  id: string;
  itemId: string;
  quantity: number;
  priceCurrencyId: string;
  priceAmount: number;
  remainingPurchases: number | null;
};

function uniqueIds(kind: string, ids: string[], path: string): void {
  if (new Set(ids).size !== ids.length)
    throw new BantamError("invalid-config", `${path}: duplicate ${kind} id`, 400);
}

function requireKnown(kind: string, id: string, known: Set<string>, path: string): void {
  if (!known.has(id)) throw new BantamError("invalid-config", `${path}: unknown ${kind} ${id}`, 400);
}

function validateGrants(
  grants: readonly EconomyGrant[],
  currencies: Set<string>,
  items: Set<string>,
  path: string,
): void {
  for (const [index, grant] of grants.entries()) {
    const grantPath = `${path}/grants/${index}`;
    if (grant.kind === "currency") requireKnown("currency", grant.currencyId, currencies, grantPath);
    else requireKnown("item", grant.itemId, items, grantPath);
  }
}

export function parseEconomyCatalog(value: unknown, path: string): EconomyCatalog | undefined {
  if (value === undefined) return undefined;
  if (!Value.Check(EconomyCatalogSchema, value)) {
    const details = [...Value.Errors(EconomyCatalogSchema, value)]
      .map((item) => `${item.path}: ${item.message}`)
      .join("; ");
    throw new BantamError("invalid-config", `${path}: ${details}`, 400);
  }
  const catalog = value;
  uniqueIds(
    "currency",
    catalog.currencies.map((row) => row.id),
    `${path}/currencies`,
  );
  uniqueIds(
    "item",
    catalog.items.map((row) => row.id),
    `${path}/items`,
  );
  uniqueIds(
    "offer",
    catalog.offers.map((row) => row.id),
    `${path}/offers`,
  );
  uniqueIds(
    "reward",
    (catalog.rewards ?? []).map((row) => row.id),
    `${path}/rewards`,
  );
  uniqueIds(
    "iap product",
    (catalog.iapProducts ?? []).map((row) => row.id),
    `${path}/iapProducts`,
  );
  uniqueIds(
    "provider product",
    (catalog.iapProducts ?? []).map((row) => `${row.provider}:${row.providerProductId}`),
    `${path}/iapProducts`,
  );

  const currencies = new Set(catalog.currencies.map((row) => row.id));
  const items = new Set(catalog.items.map((row) => row.id));
  const itemById = new Map(catalog.items.map((row) => [row.id, row]));

  for (const item of catalog.items) {
    if (item.type === "permanent" && item.stackable)
      throw new BantamError(
        "invalid-config",
        `${path}/items/${item.id}: permanent items cannot be stackable`,
        400,
      );
  }
  for (const offer of catalog.offers) {
    requireKnown("item", offer.itemId, items, `${path}/offers/${offer.id}`);
    requireKnown("currency", offer.priceCurrencyId, currencies, `${path}/offers/${offer.id}`);
    const item = itemById.get(offer.itemId);
    if (item?.type === "permanent" && offer.quantity !== 1)
      throw new BantamError(
        "invalid-config",
        `${path}/offers/${offer.id}: permanent items must be sold as quantity 1`,
        400,
      );
  }
  for (const reward of catalog.rewards ?? []) {
    validateGrants(reward.grants, currencies, items, `${path}/rewards/${reward.id}`);
  }
  for (const product of catalog.iapProducts ?? []) {
    validateGrants(product.grants, currencies, items, `${path}/iapProducts/${product.id}`);
  }
  return catalog;
}

export function catalogCurrency(catalog: EconomyCatalog | undefined, currencyId: string): EconomyCurrency {
  const currency = catalog?.currencies.find((row) => row.id === currencyId);
  if (!currency) throw new BantamError("currency-not-found", "Currency is not in this game catalog", 404);
  return currency;
}

export function catalogItem(catalog: EconomyCatalog | undefined, itemId: string): EconomyItem {
  const item = catalog?.items.find((row) => row.id === itemId);
  if (!item) throw new BantamError("item-not-found", "Item is not in this game catalog", 404);
  return item;
}

export function catalogOffer(catalog: EconomyCatalog | undefined, offerId: string): EconomyOffer {
  const offer = catalog?.offers.find((row) => row.id === offerId);
  if (!offer) throw new BantamError("offer-not-found", "Store offer not found", 404);
  return offer;
}

export function catalogReward(catalog: EconomyCatalog | undefined, rewardId: string): EconomyReward {
  const reward = catalog?.rewards?.find((row) => row.id === rewardId);
  if (!reward) throw new BantamError("reward-not-found", "Reward is not claimable", 404);
  return reward;
}

export function catalogIapProduct(
  catalog: EconomyCatalog | undefined,
  providerProductId: string,
  provider = "google_play",
): EconomyIapProduct {
  const product = catalog?.iapProducts?.find(
    (row) => row.provider === provider && row.providerProductId === providerProductId,
  );
  if (!product) throw new BantamError("iap-product-not-found", "IAP product is not configured", 404);
  return product;
}

export function publicOffers(
  catalog: EconomyCatalog | undefined,
  purchasedByOffer: Map<string, number>,
): PublicStoreOffer[] {
  if (!catalog) return [];
  return catalog.offers
    .filter((offer) => offer.active !== false)
    .map((offer) => {
      const used = purchasedByOffer.get(offer.id) ?? 0;
      return {
        id: offer.id,
        itemId: offer.itemId,
        quantity: offer.quantity,
        priceCurrencyId: offer.priceCurrencyId,
        priceAmount: offer.priceAmount,
        remainingPurchases: offer.maxPerPlayer === undefined ? null : Math.max(0, offer.maxPerPlayer - used),
      };
    });
}

export function isUsable(item: EconomyItem): boolean {
  return item.usable === true;
}

export function googlePlayServiceAccountEnv(prefix: string): string {
  return `${prefix}_GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`;
}
