import { buildDailyDefinition as buildBantam } from "../src/adapters/example-title-core.js";
import { pathToFileURL } from "node:url";
const path = process.env.EXAMPLE_REPO ?? "D:/Gamercury/color_quest";
const client = (await import(
  pathToFileURL(`${path.replaceAll("\\", "/")}/src/game/competitive.ts`).href
)) as { buildDailyDefinition(date: string): unknown };
const dates = ["2026-01-01", "2026-09-23", "2028-02-29", "2027-12-31"];
for (const date of dates) {
  let left: unknown, right: unknown;
  try {
    left = buildBantam(date);
  } catch (error) {
    left = { error: error instanceof Error ? error.message : String(error) };
  }
  try {
    right = client.buildDailyDefinition(date);
  } catch (error) {
    right = { error: error instanceof Error ? error.message : String(error) };
  }
  const select = (value: unknown) => {
    const route = value as {
      seed?: string;
      startColorIndex?: number;
      chunks?: unknown[];
      totalDistancePx?: number;
      error?: string;
    };
    return route.error
      ? route
      : {
          seed: route.seed,
          startColorIndex: route.startColorIndex,
          chunks: route.chunks,
          totalDistancePx: route.totalDistancePx,
        };
  };
  if (JSON.stringify(select(left)) !== JSON.stringify(select(right)))
    throw new Error(`Example route contract drift for ${date}`);
}
console.log(`Example deterministic route contract matches for ${dates.length} fixtures.`);
