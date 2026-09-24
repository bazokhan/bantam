import { BantamError } from "../errors.js";
import type { GameAdapterV1 } from "../types.js";
import { ColorQuestDailyV1Adapter } from "./color-quest-daily-v1.js";
import { MoonGravityTemplateV1Adapter } from "./moon-gravity-template-v1.js";

const adapters: readonly GameAdapterV1[] = [
  new ColorQuestDailyV1Adapter(),
  new MoonGravityTemplateV1Adapter(),
];

export function adapterById(id: string): GameAdapterV1 {
  const adapter = adapters.find((candidate) => candidate.id === id);
  if (!adapter) throw new BantamError("adapter-not-found", "Adapter not found", 404);
  return adapter;
}

export function allAdapters(): readonly GameAdapterV1[] {
  return adapters;
}
