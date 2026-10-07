import { BantamError } from "../../errors.js";
import type { AdapterContext, AdapterResult, BoardDefinition, GameAdapterV1 } from "../../types.js";

// Built-in synthesized adapter for trivial games. The game dev declares
// boards in `games.json`; the server builds one instance per game at boot.
// Payload contract: `{ [boardId]: safeInteger }`. Anything else rejects.
//
// periodKey derivation:
//   daily      -> today UTC date (YYYY-MM-DD)
//   all_time   -> "all_time"
//
// If a game needs deterministic historical periodKey or richer validation,
// write a real file-based adapter — `kind: "file"` in the manifest.
export class GenericAdapter implements GameAdapterV1 {
  readonly id: string;
  readonly version = "1.0.0";
  readonly boards: readonly BoardDefinition[];

  constructor(boards: BoardDefinition[]) {
    this.boards = Object.freeze([...boards]);
    this.id = `generic:${boards
      .map((b) => b.id)
      .sort()
      .join(",")}`;
  }

  validateAndDerive(payload: unknown, context: AdapterContext): AdapterResult {
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new BantamError("invalid-payload", "Payload must be an object");
    const value = payload as Record<string, unknown>;
    const allowed = new Set(this.boards.map((b) => b.id));
    for (const key of Object.keys(value))
      if (!allowed.has(key)) throw new BantamError("unknown-field", `Unknown payload field: ${key}`);
    const today = new Date(context.nowMs).toISOString().slice(0, 10);
    const derived: object[] = [];
    for (const board of this.boards) {
      const raw = value[board.id];
      if (raw === undefined) {
        if (board.completedOnly) continue;
        throw new BantamError("invalid-value", `Missing required value for board ${board.id}`);
      }
      if (typeof raw !== "number" || !Number.isSafeInteger(raw))
        throw new BantamError("invalid-value", `Value for board ${board.id} must be a safe integer`);
      derived.push({
        boardId: board.id,
        periodKey: board.period === "daily" ? today : "all_time",
        value: raw,
      });
    }
    return { normalized: value, values: derived as never };
  }
}
