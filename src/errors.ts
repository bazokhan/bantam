export class BantamError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "BantamError";
  }
}

export function invariant(condition: unknown, code: string, message = code): asserts condition {
  if (!condition) throw new BantamError(code, message);
}
