import { importPKCS8, SignJWT } from "jose";
import { BantamError } from "../errors.js";
import { sha256 } from "../util/crypto.js";

export type IapPurchaseState = "purchased" | "canceled" | "pending";

export type IapVerification = {
  provider: "google_play";
  productId: string;
  orderId: string;
  purchaseState: IapPurchaseState;
  acknowledged: boolean;
  consumptionState: "yet_to_be_consumed" | "consumed";
};

export type IapVerifyInput = {
  packageName: string;
  productId: string;
  purchaseToken: string;
};

export interface IapVerifier {
  verify(input: IapVerifyInput): Promise<IapVerification>;
  acknowledge(input: IapVerifyInput): Promise<void>;
  /** Consume implies acknowledge and allows repurchase of consumable SKUs. */
  consume(input: IapVerifyInput): Promise<void>;
}

export type GooglePlayServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function hashPurchaseToken(provider: string, purchaseToken: string): string {
  return sha256(`${provider}:${purchaseToken}`);
}

export function parseGooglePlayServiceAccount(raw: string, envName: string): GooglePlayServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BantamError("invalid-secret", `Invalid JSON in ${envName}`, 500);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new BantamError("invalid-secret", `${envName} must be a service-account object`, 500);
  const record = parsed as Record<string, unknown>;
  if (typeof record.client_email !== "string" || !record.client_email.includes("@"))
    throw new BantamError("invalid-secret", `${envName} is missing client_email`, 500);
  if (typeof record.private_key !== "string" || !record.private_key.includes("PRIVATE KEY"))
    throw new BantamError("invalid-secret", `${envName} is missing private_key`, 500);
  return {
    client_email: record.client_email,
    private_key: record.private_key,
    ...(typeof record.token_uri === "string" ? { token_uri: record.token_uri } : {}),
  };
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function purchaseStateFromGoogle(value: unknown): IapPurchaseState {
  if (value === 0) return "purchased";
  if (value === 1) return "canceled";
  if (value === 2) return "pending";
  throw new BantamError("iap-invalid", "Provider purchase state was not recognized", 409);
}

export class GooglePlayIapVerifier implements IapVerifier {
  private accessToken: { value: string; expiresAt: number } | undefined;

  constructor(
    private readonly account: GooglePlayServiceAccount,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async verify(input: IapVerifyInput): Promise<IapVerification> {
    const token = await this.access();
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodePath(input.packageName)}/purchases/products/${encodePath(input.productId)}/tokens/${encodePath(input.purchaseToken)}`;
    const response = await this.fetchFn(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 404)
      throw new BantamError("iap-invalid", "Purchase token was not recognized", 409);
    if (!response.ok)
      throw new BantamError("iap-provider-unavailable", "IAP provider verification failed", 503);
    const body = (await response.json()) as Record<string, unknown>;
    return {
      provider: "google_play",
      productId: input.productId,
      orderId: typeof body.orderId === "string" ? body.orderId : "",
      purchaseState: purchaseStateFromGoogle(body.purchaseState),
      acknowledged: body.acknowledgementState === 1,
      consumptionState: body.consumptionState === 1 ? "consumed" : "yet_to_be_consumed",
    };
  }

  async acknowledge(input: IapVerifyInput): Promise<void> {
    const token = await this.access();
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodePath(input.packageName)}/purchases/products/${encodePath(input.productId)}/tokens/${encodePath(input.purchaseToken)}:acknowledge`;
    const response = await this.fetchFn(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    });
    if (response.status === 400) {
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      if (body.error?.message?.toLowerCase().includes("already")) return;
    }
    if (!response.ok) throw new BantamError("iap-acknowledge-failed", "IAP acknowledgment failed", 503);
  }

  async consume(input: IapVerifyInput): Promise<void> {
    const token = await this.access();
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodePath(input.packageName)}/purchases/products/${encodePath(input.productId)}/tokens/${encodePath(input.purchaseToken)}:consume`;
    const response = await this.fetchFn(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    });
    if (response.status === 400) {
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      const message = body.error?.message?.toLowerCase() ?? "";
      if (message.includes("already") || message.includes("consumed")) return;
    }
    if (!response.ok) throw new BantamError("iap-consume-failed", "IAP consumption failed", 503);
  }

  private async access(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && this.accessToken.expiresAt - now > 60_000) return this.accessToken.value;
    const key = await importPKCS8(this.account.private_key, "RS256");
    const assertion = await new SignJWT({ scope: ANDROID_PUBLISHER_SCOPE })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(this.account.client_email)
      .setAudience(this.account.token_uri ?? TOKEN_URL)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(key);
    const response = await this.fetchFn(this.account.token_uri ?? TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!response.ok) throw new BantamError("iap-provider-unavailable", "IAP provider auth failed", 503);
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token)
      throw new BantamError("iap-provider-unavailable", "IAP provider auth failed", 503);
    this.accessToken = {
      value: body.access_token,
      expiresAt: now + (body.expires_in ?? 3600) * 1000,
    };
    return body.access_token;
  }
}

export function verifierFromEnv(
  envName: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: typeof fetch = fetch,
): IapVerifier | undefined {
  const raw = env[envName];
  if (!raw) return undefined;
  return new GooglePlayIapVerifier(parseGooglePlayServiceAccount(raw, envName), fetchFn);
}
