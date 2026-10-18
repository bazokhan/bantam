import type { EconomyCatalog, EconomyGrant } from "../services/economy.js";
import { parseEconomyCatalog } from "../services/economy.js";
import { BantamError } from "../errors.js";
import { escapeHtml, field } from "./templates.js";

const EXTRA_CURRENCY = 2;
const EXTRA_ITEM = 2;
const EXTRA_OFFER = 2;
const EXTRA_REWARD = 1;
const EXTRA_IAP = 1;
const EXTRA_GRANT = 2;
const MAX_GRANT = 16;

function str(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}

function intOrEmpty(raw: string): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) ? n : undefined;
}

function boolSelect(name: string, value: boolean, disabled: string): string {
  return `<select name="${escapeHtml(name)}" ${disabled}>
    <option value="false"${value ? "" : " selected"}>no</option>
    <option value="true"${value ? " selected" : ""}>yes</option>
  </select>`;
}

function grantRows(prefix: string, grants: readonly EconomyGrant[], disabled: string): string {
  const slots = Math.min(MAX_GRANT, Math.max(grants.length + EXTRA_GRANT, EXTRA_GRANT));
  const rows: string[] = [];
  for (let i = 0; i < slots; i++) {
    const grant = grants[i];
    const kind = grant?.kind ?? "";
    const target = grant?.kind === "currency" ? grant.currencyId : grant?.kind === "item" ? grant.itemId : "";
    const qty = grant?.kind === "currency" ? grant.amount : grant?.kind === "item" ? grant.quantity : "";
    rows.push(`<div class="inline-fields">
      <label>kind <select name="${escapeHtml(`${prefix}.grant[${i}].kind`)}" ${disabled}>
        <option value="">(empty)</option>
        <option value="currency"${kind === "currency" ? " selected" : ""}>currency</option>
        <option value="item"${kind === "item" ? " selected" : ""}>item</option>
      </select></label>
      <label>id <input type="text" name="${escapeHtml(`${prefix}.grant[${i}].id`)}" value="${escapeHtml(target)}" maxlength="48" pattern="[a-z][a-z0-9_-]*" ${disabled}></label>
      <label>qty <input type="number" name="${escapeHtml(`${prefix}.grant[${i}].qty`)}" value="${escapeHtml(String(qty))}" min="1" step="1" ${disabled}></label>
    </div>`);
  }
  return rows.join("");
}

function parseGrants(body: Record<string, unknown>, prefix: string): EconomyGrant[] {
  const grants: EconomyGrant[] = [];
  for (let i = 0; i < MAX_GRANT; i++) {
    const kind = str(body, `${prefix}.grant[${i}].kind`);
    if (!kind) continue;
    const id = str(body, `${prefix}.grant[${i}].id`);
    const qty = intOrEmpty(str(body, `${prefix}.grant[${i}].qty`));
    if (!id || qty === undefined || qty < 1) {
      throw new BantamError("invalid-config", `${prefix}: grant ${i} needs id and quantity`, 400);
    }
    if (kind === "currency") grants.push({ kind: "currency", currencyId: id, amount: qty });
    else if (kind === "item") grants.push({ kind: "item", itemId: id, quantity: qty });
  }
  return grants;
}

export function renderEconomyFields(
  gameIndex: number,
  catalog: EconomyCatalog | undefined,
  disabled: string,
): string {
  const p = `game[${gameIndex}]`;
  const currencies = [
    ...(catalog?.currencies ?? []),
    ...Array.from({ length: EXTRA_CURRENCY }, () => undefined),
  ];
  const items = [...(catalog?.items ?? []), ...Array.from({ length: EXTRA_ITEM }, () => undefined)];
  const offers = [...(catalog?.offers ?? []), ...Array.from({ length: EXTRA_OFFER }, () => undefined)];
  const rewards = [...(catalog?.rewards ?? []), ...Array.from({ length: EXTRA_REWARD }, () => undefined)];
  const iaps = [...(catalog?.iapProducts ?? []), ...Array.from({ length: EXTRA_IAP }, () => undefined)];
  return `<div class="economy-editor">
    <input type="hidden" name="${escapeHtml(`${p}.economy.edit`)}" value="1">
    <p class="hint">Catalog is optional. Enable it with at least one currency and one item. Empty rows are ignored. Check remove to drop a row.</p>
    <h4>Currencies</h4>
    ${currencies
      .map((row, i) => {
        const n = `${p}.currency[${i}]`;
        return `<div class="inline-fields">
          ${field("Id", `<input type="text" name="${n}.id" value="${escapeHtml(row?.id ?? "")}" maxlength="48" pattern="[a-z][a-z0-9_-]*" ${disabled}>`)}
          <label class="checkbox-row"><input type="checkbox" name="${n}.remove" value="on" ${disabled}> remove</label>
        </div>`;
      })
      .join("")}
    <h4>Items</h4>
    ${items
      .map((row, i) => {
        const n = `${p}.item[${i}]`;
        return `<fieldset class="compact">
          ${field("Id", `<input type="text" name="${n}.id" value="${escapeHtml(row?.id ?? "")}" maxlength="48" pattern="[a-z][a-z0-9_-]*" ${disabled}>`)}
          ${field(
            "Type",
            `<select name="${n}.type" ${disabled}><option value="consumable"${row?.type !== "permanent" ? " selected" : ""}>consumable</option><option value="permanent"${row?.type === "permanent" ? " selected" : ""}>permanent</option></select>`,
          )}
          ${field("Stackable", boolSelect(`${n}.stackable`, row?.stackable ?? false, disabled))}
          ${field("Usable", boolSelect(`${n}.usable`, row?.usable === true, disabled))}
          <label class="checkbox-row"><input type="checkbox" name="${n}.remove" value="on" ${disabled}> remove</label>
        </fieldset>`;
      })
      .join("")}
    <h4>Offers</h4>
    ${offers
      .map((row, i) => {
        const n = `${p}.offer[${i}]`;
        return `<fieldset class="compact">
          ${field("Id", `<input type="text" name="${n}.id" value="${escapeHtml(row?.id ?? "")}" maxlength="48" ${disabled}>`)}
          ${field("Item id", `<input type="text" name="${n}.itemId" value="${escapeHtml(row?.itemId ?? "")}" maxlength="48" ${disabled}>`)}
          ${field("Quantity", `<input type="number" name="${n}.quantity" value="${escapeHtml(String(row?.quantity ?? ""))}" min="1" step="1" ${disabled}>`)}
          ${field("Price currency", `<input type="text" name="${n}.priceCurrencyId" value="${escapeHtml(row?.priceCurrencyId ?? "")}" maxlength="48" ${disabled}>`)}
          ${field("Price amount", `<input type="number" name="${n}.priceAmount" value="${escapeHtml(String(row?.priceAmount ?? ""))}" min="1" step="1" ${disabled}>`)}
          ${field("Active", boolSelect(`${n}.active`, row?.active !== false, disabled))}
          ${field("Max per player", `<input type="number" name="${n}.maxPerPlayer" value="${escapeHtml(row?.maxPerPlayer == null ? "" : String(row.maxPerPlayer))}" min="1" step="1" ${disabled}>`)}
          <label class="checkbox-row"><input type="checkbox" name="${n}.remove" value="on" ${disabled}> remove</label>
        </fieldset>`;
      })
      .join("")}
    <h4>Rewards</h4>
    ${rewards
      .map((row, i) => {
        const n = `${p}.reward[${i}]`;
        return `<fieldset class="compact">
          ${field("Id", `<input type="text" name="${n}.id" value="${escapeHtml(row?.id ?? "")}" maxlength="48" ${disabled}>`)}
          ${field("Max claims", `<input type="number" name="${n}.maxClaims" value="${escapeHtml(row?.maxClaims == null ? "" : String(row.maxClaims))}" min="1" step="1" ${disabled}>`)}
          <div class="field"><label>Grants</label>${grantRows(n, row?.grants ?? [], disabled)}</div>
          <label class="checkbox-row"><input type="checkbox" name="${n}.remove" value="on" ${disabled}> remove</label>
        </fieldset>`;
      })
      .join("")}
    <h4>IAP products</h4>
    ${iaps
      .map((row, i) => {
        const n = `${p}.iap[${i}]`;
        return `<fieldset class="compact">
          ${field("Id", `<input type="text" name="${n}.id" value="${escapeHtml(row?.id ?? "")}" maxlength="48" ${disabled}>`)}
          ${field("Play product id", `<input type="text" name="${n}.providerProductId" value="${escapeHtml(row?.providerProductId ?? "")}" maxlength="128" ${disabled}>`)}
          ${field("Package name", `<input type="text" name="${n}.packageName" value="${escapeHtml(row?.packageName ?? "")}" maxlength="255" ${disabled}>`)}
          <div class="field"><label>Grants</label>${grantRows(n, row?.grants ?? [], disabled)}</div>
          <label class="checkbox-row"><input type="checkbox" name="${n}.remove" value="on" ${disabled}> remove</label>
        </fieldset>`;
      })
      .join("")}
  </div>`;
}

export function applyEconomyFromForm(
  body: Record<string, unknown>,
  gameIndex: number,
  current: EconomyCatalog | undefined,
): { touched: boolean; catalog: EconomyCatalog | undefined } {
  const p = `game[${gameIndex}]`;
  if (str(body, `${p}.economy.edit`) !== "1") return { touched: false, catalog: current };
  const currencies: { id: string }[] = [];
  for (let i = 0; i < 18; i++) {
    const id = str(body, `${p}.currency[${i}].id`);
    if (!id || str(body, `${p}.currency[${i}].remove`) === "on") continue;
    currencies.push({ id });
  }
  if (currencies.length === 0) return { touched: true, catalog: undefined };

  const items: EconomyCatalog["items"] = [];
  for (let i = 0; i < 258; i++) {
    const id = str(body, `${p}.item[${i}].id`);
    if (!id) continue;
    if (str(body, `${p}.item[${i}].remove`) === "on") continue;
    const type = str(body, `${p}.item[${i}].type`) === "permanent" ? "permanent" : "consumable";
    const stackable = str(body, `${p}.item[${i}].stackable`) === "true";
    const usable = str(body, `${p}.item[${i}].usable`) === "true";
    items.push({ id, type, stackable, ...(usable ? { usable: true } : {}) });
  }

  const offers: EconomyCatalog["offers"] = [];
  for (let i = 0; i < 258; i++) {
    const id = str(body, `${p}.offer[${i}].id`);
    if (!id) continue;
    if (str(body, `${p}.offer[${i}].remove`) === "on") continue;
    const itemId = str(body, `${p}.offer[${i}].itemId`);
    const quantity = intOrEmpty(str(body, `${p}.offer[${i}].quantity`));
    const priceCurrencyId = str(body, `${p}.offer[${i}].priceCurrencyId`);
    const priceAmount = intOrEmpty(str(body, `${p}.offer[${i}].priceAmount`));
    const maxPerPlayer = intOrEmpty(str(body, `${p}.offer[${i}].maxPerPlayer`));
    const active = str(body, `${p}.offer[${i}].active`) !== "false";
    offers.push({
      id,
      itemId,
      quantity: quantity ?? 0,
      priceCurrencyId,
      priceAmount: priceAmount ?? 0,
      ...(active ? {} : { active: false }),
      ...(maxPerPlayer !== undefined ? { maxPerPlayer } : {}),
    });
  }

  const rewards: NonNullable<EconomyCatalog["rewards"]> = [];
  for (let i = 0; i < 65; i++) {
    const id = str(body, `${p}.reward[${i}].id`);
    if (!id) continue;
    if (str(body, `${p}.reward[${i}].remove`) === "on") continue;
    const maxClaims = intOrEmpty(str(body, `${p}.reward[${i}].maxClaims`));
    rewards.push({
      id,
      grants: parseGrants(body, `${p}.reward[${i}]`),
      ...(maxClaims !== undefined ? { maxClaims } : {}),
    });
  }

  const iapProducts: NonNullable<EconomyCatalog["iapProducts"]> = [];
  for (let i = 0; i < 65; i++) {
    const id = str(body, `${p}.iap[${i}].id`);
    if (!id) continue;
    if (str(body, `${p}.iap[${i}].remove`) === "on") continue;
    iapProducts.push({
      id,
      provider: "google_play",
      providerProductId: str(body, `${p}.iap[${i}].providerProductId`),
      packageName: str(body, `${p}.iap[${i}].packageName`),
      grants: parseGrants(body, `${p}.iap[${i}]`),
    });
  }

  const raw: EconomyCatalog = {
    currencies,
    items,
    offers,
    ...(rewards.length ? { rewards } : {}),
    ...(iapProducts.length ? { iapProducts } : {}),
  };
  return { touched: true, catalog: parseEconomyCatalog(raw, `games/${gameIndex}/economy`) };
}

export function currencyOptions(catalog: EconomyCatalog | undefined): string {
  return (catalog?.currencies ?? [])
    .map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.id)}</option>`)
    .join("");
}

export function itemOptions(catalog: EconomyCatalog | undefined): string {
  return (catalog?.items ?? [])
    .map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.id)}</option>`)
    .join("");
}
