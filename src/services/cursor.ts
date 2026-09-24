import { BantamError } from "../errors.js";
import { hmac, safeEqual } from "../util/crypto.js";

export function encodeCursor(ordinal: number, secret: string): string {
  const body = Buffer.from(JSON.stringify({ v: 1, o: ordinal })).toString("base64url");
  return `${body}.${hmac(body, secret)}`;
}

export function decodeCursor(cursor: string | undefined, secret: string): number {
  if (!cursor) return 0;
  const [body, signature] = cursor.split(".");
  if (!body || !signature || !safeEqual(hmac(body, secret), signature))
    throw new BantamError("invalid-cursor", "Invalid pagination cursor");
  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { v?: number; o?: number };
    if (value.v !== 1 || !Number.isSafeInteger(value.o) || (value.o ?? -1) < 0) throw new Error("invalid");
    return value.o!;
  } catch {
    throw new BantamError("invalid-cursor", "Invalid pagination cursor");
  }
}
