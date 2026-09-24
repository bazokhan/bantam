export type SegmentColors = [number, number, number, number];
export type GeneratedChunk = {
  index: number;
  gapPx: number;
  obstacle: {
    id: string;
    kind: "ring" | "square";
    radius: number;
    thickness: number;
    speedDeg: number;
    startAngleDeg: number;
    segmentColorIndices: SegmentColors;
    expectedColorIndex: number;
  };
  switchToColorIndex?: number;
  reward: "star" | "gem" | "shield" | "multiplier" | "none";
};

export const DAILY_ROUTE_LENGTH = 20;
export const DAILY_RULES_VERSION = "daily-v1";
const PIXELS_PER_METER = 10;
const PACE_GRACE_MS = 4_000;
const PACE_BONUS_MAX = 10;

class SeededRandom {
  private state: number;
  constructor(seed: string) {
    this.state = hashSeed(seed) || 0x6d2b79f5;
  }
  next(): number {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }
  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i);
      [result[i], result[j]] = [result[j]!, result[i]!];
    }
    return result;
  }
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function levelForDistance(distancePx: number): number {
  if (distancePx < 850) return 1;
  if (distancePx < 1900) return 2;
  if (distancePx < 3400) return 3;
  if (distancePx < 5200) return 4;
  return 5;
}
function chooseDifferentColor(current: number, rng: SeededRandom): number {
  return (current + rng.int(1, 3)) % 4;
}
function segmentColors(count: 1 | 2 | 3 | 4, expected: number, rng: SeededRandom): SegmentColors {
  const alternatives = rng.shuffle([0, 1, 2, 3].filter((color) => color !== expected));
  if (count === 1) return [expected, expected, expected, expected];
  if (count === 2) return [expected, alternatives[0]!, expected, alternatives[0]!];
  if (count === 3) return [expected, alternatives[0]!, expected, alternatives[1]!];
  return rng.shuffle([expected, ...alternatives]) as SegmentColors;
}

export function generateChunk(
  seed: string,
  index: number,
  distancePx: number,
  incomingColor: number,
): GeneratedChunk {
  const rng = new SeededRandom(`${seed}:chunk:${index}`);
  const level = levelForDistance(distancePx);
  const switchToColorIndex =
    level >= 2 && rng.bool(0.24) ? chooseDifferentColor(incomingColor, rng) : undefined;
  const expected = switchToColorIndex ?? incomingColor;
  const squareChance = level >= 3 ? 0.38 : level === 2 ? 0.22 : 0;
  const kind = rng.bool(squareChance) ? "square" : "ring";
  const gapPx = level <= 1 ? rng.int(470, 540) : level === 2 ? rng.int(440, 520) : rng.int(410, 500);
  const radius = kind === "ring" ? rng.int(115, 145) : rng.int(138, 160);
  const speed = rng.int(28 + level * 7, 48 + level * 9) * (rng.bool() ? 1 : -1);
  const count: 1 | 2 | 3 | 4 = level <= 1 ? 1 : level === 2 ? 2 : level === 3 ? 3 : 4;
  const roll = rng.next();
  const reward =
    roll < 0.18 ? "none" : roll < 0.48 ? "star" : roll < 0.72 ? "gem" : roll < 0.9 ? "shield" : "multiplier";
  return {
    index,
    gapPx,
    ...(switchToColorIndex === undefined ? {} : { switchToColorIndex }),
    reward,
    obstacle: {
      id: `${seed}-${index}`,
      kind,
      radius,
      thickness: kind === "ring" ? 24 : 20,
      speedDeg: speed,
      startAngleDeg: rng.int(0, 359),
      segmentColorIndices: segmentColors(count, expected, rng),
      expectedColorIndex: expected,
    },
  };
}

export function buildDailyDefinition(utcDate: string): {
  utcDate: string;
  seed: string;
  startColorIndex: number;
  chunks: GeneratedChunk[];
  totalDistancePx: number;
} {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(utcDate) ||
    new Date(`${utcDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== utcDate
  )
    throw new Error("invalid-date");
  const seed = `${DAILY_RULES_VERSION}:${utcDate}`;
  const startColorIndex = new SeededRandom(`${seed}:start-color`).int(0, 3);
  const chunks: GeneratedChunk[] = [];
  let color = startColorIndex;
  let distance = 0;
  for (let index = 0; index < DAILY_ROUTE_LENGTH; index += 1) {
    const chunk = generateChunk(seed, index, distance, color);
    chunks.push(chunk);
    color = chunk.obstacle.expectedColorIndex;
    distance += chunk.gapPx;
  }
  return { utcDate, seed, startColorIndex, chunks, totalDistancePx: distance };
}

export function metersFromPixels(value: number): number {
  return Math.max(0, Math.floor(value / PIXELS_PER_METER));
}
export function progressPointsForMeters(value: number): number {
  return Math.max(0, Math.floor(value / 10));
}
export function isPerfectAlignment(value: number): boolean {
  return Number.isFinite(value) && value <= 1 / 3;
}
function comboPermille(combo: number): number {
  return combo >= 10 ? 1500 : combo >= 6 ? 1300 : combo >= 3 ? 1150 : 1000;
}
export function scoreCompetitiveGate(
  result: "regular" | "perfect" | "shielded",
  streak: number,
  combo: number,
  multiplier: number,
  elapsed: number,
) {
  if (result === "shielded")
    return { totalPoints: 8 * multiplier, pacePoints: 0, nextPerfectStreak: 0, nextCombo: 0 };
  const nextCombo = combo + 1;
  const nextPerfectStreak = result === "perfect" ? streak + 1 : 0;
  const base = result === "perfect" ? 12 + Math.min(nextPerfectStreak, 5) : 10;
  const pacePoints = Math.max(0, PACE_BONUS_MAX - Math.floor(Math.max(0, elapsed - PACE_GRACE_MS) / 1000));
  return {
    totalPoints: Math.round((base * comboPermille(nextCombo)) / 1000) * multiplier + pacePoints,
    pacePoints,
    nextPerfectStreak,
    nextCombo,
  };
}
