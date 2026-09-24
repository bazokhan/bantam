import { BantamError } from "../errors.js";
import type { AdapterContext, AdapterResult, GameAdapterV1 } from "../types.js";

export class MoonGravityTemplateV1Adapter implements GameAdapterV1 {
  readonly id = "moon-gravity-template-v1";
  readonly version = "1.0.0-template";
  readonly boards = [
    { id: "moon_altitude", direction: "higher", period: "all_time" },
    { id: "moon_landing_time", direction: "lower", period: "all_time" },
  ] as const;
  validateAndDerive(_payload: unknown, _context: AdapterContext): AdapterResult {
    throw new BantamError(
      "adapter-not-implemented",
      "This adapter is a registration template and accepts no runs",
      501,
    );
  }
}
