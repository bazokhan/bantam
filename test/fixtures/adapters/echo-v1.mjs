// Reference file adapter used by the adapters-smoke lane and the Docker container
// smoke. Demonstrates the file adapter contract:
//   - default export implements GameAdapterV1 (id, version, boards, validateAndDerive)
//   - payload { value: number } -> board "echo", period "all_time"
// Keep this file minimal: it's the smoke fixture, not a feature.

export default {
  id: "echo-v1",
  version: "1.0.0",
  boards: [{ id: "echo", direction: "higher", period: "all_time" }],
  validateAndDerive(payload) {
    const value = Number(payload?.value);
    if (!Number.isSafeInteger(value)) throw new Error("invalid-value");
    return {
      normalized: { value },
      values: [{ boardId: "echo", periodKey: "all_time", value }],
    };
  },
};
