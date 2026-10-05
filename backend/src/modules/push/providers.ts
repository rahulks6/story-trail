/**
 * Push providers. Firebase Cloud Messaging (HTTP v1; Android, and iOS through FCM) and
 * Apple Push Notification service (HTTP/2, token-based auth). Both authenticate with
 * short-lived tokens signed locally from credentials supplied by the secret store:
 *  - FCM: OAuth 2.0 JWT-bearer grant with the service account key (RS256);
 *  - APNs: provider token signed with the .p8 key (ES256), refreshed every 50 minutes.
 */
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import * as http2 from "node:http2";

export interface PushMessage {
  title: string;
  body: string;
  /** Deep-link and routing data for the app (strings only, as both providers require). */
  data: Record<string, string>;
  /** Replaces an earlier notification with the same key on the device. */
  collapseKey?: string | undefined;
  /** iOS app-icon badge. */
  badge?: number | undefined;
  /** Groups notifications on iOS. */
  threadId?: string | undefined;
}

export interface PushResult {
  ok: boolean;
  /** The token no longer reaches an app install; stop using it. */
  invalidToken?: boolean;
  retryable?: boolean;
  error?: string;
}

export interface PushProvider {
  readonly name: "fcm" | "apns";
  send(token: string, message: PushMessage): Promise<PushResult>;
  close?(): Promise<void>;
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

function signJwt(header: object, payload: object, key: KeyObject, algorithm: "RS256" | "ES256"): string {
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = algorithm === "RS256"
    ? sign("sha256", Buffer.from(signingInput), key)
    : sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${b64url(signature)}`;
}

/** Accepts PEM text, PEM with literal \n escapes, or base64 of either. */
export function readPem(raw: string): string {
  const text = raw.includes("BEGIN") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return text.replace(/\\n/g, "\n");
}

export interface FcmServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export function parseServiceAccount(raw: string): FcmServiceAccount {
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const parsed = JSON.parse(text) as Partial<FcmServiceAccount>;
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error("FCM_SERVICE_ACCOUNT_JSON must be a Firebase service account key (project_id, client_email, private_key).");
  }
  return parsed as FcmServiceAccount;
}

export class FcmProvider implements PushProvider {
  readonly name = "fcm" as const;
  private readonly key: KeyObject;
  private accessToken: { value: string; expiresAtMs: number } | null = null;

  constructor(private readonly account: FcmServiceAccount, private readonly endpoint = "https://fcm.googleapis.com") {
    this.key = createPrivateKey(readPem(account.private_key));
  }

  private async token(force = false): Promise<string> {
    if (!force && this.accessToken && this.accessToken.expiresAtMs - Date.now() > 60_000) return this.accessToken.value;
    const tokenUri = this.account.token_uri ?? "https://oauth2.googleapis.com/token";
    const now = Math.floor(Date.now() / 1000);
    const assertion = signJwt({ alg: "RS256", typ: "JWT" }, {
      iss: this.account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: tokenUri, iat: now, exp: now + 3600,
    }, this.key, "RS256");
    const res = await fetch(tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    });
    if (!res.ok) throw new Error(`FCM OAuth token request failed (${res.status})`);
    const body = await res.json() as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("FCM OAuth response had no access token");
    this.accessToken = { value: body.access_token, expiresAtMs: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  async send(deviceToken: string, message: PushMessage): Promise<PushResult> {
    const payload = {
      message: {
        token: deviceToken,
        notification: { title: message.title, body: message.body },
        data: message.data,
        android: { priority: "HIGH", ...(message.collapseKey ? { collapse_key: message.collapseKey, notification: { tag: message.collapseKey } } : {}) },
        apns: {
          headers: { "apns-priority": "10", ...(message.collapseKey ? { "apns-collapse-id": message.collapseKey } : {}) },
          payload: { aps: { sound: "default", ...(message.badge !== undefined ? { badge: message.badge } : {}), ...(message.threadId ? { "thread-id": message.threadId } : {}) } },
        },
      },
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${this.endpoint}/v1/projects/${encodeURIComponent(this.account.project_id)}/messages:send`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${await this.token(attempt > 0)}` },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        return { ok: false, retryable: true, error: (error as Error).message };
      }
      if (res.ok) return { ok: true };
      const body = await res.json().catch(() => ({})) as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } };
      const code = body.error?.details?.find((d) => d.errorCode)?.errorCode ?? body.error?.status ?? String(res.status);
      if (res.status === 401 && attempt === 0) continue; // access token rejected: mint a new one once
      if (res.status === 404 || code === "UNREGISTERED") return { ok: false, invalidToken: true, error: code };
      if (res.status === 400 && /registration|token/i.test(body.error?.message ?? "")) return { ok: false, invalidToken: true, error: code };
      return { ok: false, retryable: res.status === 429 || res.status >= 500, error: code };
    }
    return { ok: false, retryable: true, error: "unauthorized" };
  }
}

export interface ApnsOptions {
  keyId: string;
  teamId: string;
  privateKey: string;
  bundleId: string;
  /** https://api.push.apple.com, https://api.sandbox.push.apple.com, or a local h2c test server. */
  host: string;
}

export class ApnsProvider implements PushProvider {
  readonly name = "apns" as const;
  private readonly key: KeyObject;
  private providerToken: { value: string; issuedAtMs: number } | null = null;
  private session: http2.ClientHttp2Session | null = null;

  constructor(private readonly options: ApnsOptions) {
    this.key = createPrivateKey(readPem(options.privateKey));
  }

  private token(force = false): string {
    // Apple: refresh no more often than every 20 minutes, and at least hourly.
    if (!force && this.providerToken && Date.now() - this.providerToken.issuedAtMs < 50 * 60_000) return this.providerToken.value;
    const value = signJwt({ alg: "ES256", kid: this.options.keyId }, { iss: this.options.teamId, iat: Math.floor(Date.now() / 1000) }, this.key, "ES256");
    this.providerToken = { value, issuedAtMs: Date.now() };
    return value;
  }

  private connection(): http2.ClientHttp2Session {
    if (!this.session || this.session.closed || this.session.destroyed) {
      this.session = http2.connect(this.options.host);
      this.session.on("error", () => { this.session = null; });
      this.session.unref();
    }
    return this.session;
  }

  private request(deviceToken: string, body: string, headers: Record<string, string>): Promise<{ status: number; reason: string }> {
    return new Promise((resolve, reject) => {
      const req = this.connection().request({ ":method": "POST", ":path": `/3/device/${encodeURIComponent(deviceToken)}`, ...headers });
      let status = 0, raw = "";
      req.setEncoding("utf8");
      req.on("response", (h) => { status = Number(h[":status"]); });
      req.on("data", (chunk: string) => { raw += chunk; });
      req.on("end", () => {
        let reason = "";
        try { reason = raw ? (JSON.parse(raw) as { reason?: string }).reason ?? "" : ""; } catch { reason = raw.slice(0, 100); }
        resolve({ status, reason });
      });
      req.on("error", reject);
      req.setTimeout(15_000, () => req.close(http2.constants.NGHTTP2_CANCEL));
      req.end(body);
    });
  }

  async send(deviceToken: string, message: PushMessage): Promise<PushResult> {
    const body = JSON.stringify({
      aps: {
        alert: { title: message.title, body: message.body },
        sound: "default",
        ...(message.badge !== undefined ? { badge: message.badge } : {}),
        ...(message.threadId ? { "thread-id": message.threadId } : {}),
      },
      ...message.data,
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      let result: { status: number; reason: string };
      try {
        result = await this.request(deviceToken, body, {
          authorization: `bearer ${this.token(attempt > 0)}`,
          "apns-topic": this.options.bundleId,
          "apns-push-type": "alert",
          "apns-priority": "10",
          ...(message.collapseKey ? { "apns-collapse-id": message.collapseKey.slice(0, 64) } : {}),
        });
      } catch (error) {
        this.session = null;
        return { ok: false, retryable: true, error: (error as Error).message };
      }
      if (result.status === 200) return { ok: true };
      if (result.status === 403 && result.reason === "ExpiredProviderToken" && attempt === 0) continue;
      if (result.status === 410 || ["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"].includes(result.reason)) {
        return { ok: false, invalidToken: true, error: result.reason || String(result.status) };
      }
      return { ok: false, retryable: result.status === 429 || result.status >= 500, error: result.reason || String(result.status) };
    }
    return { ok: false, retryable: true, error: "provider token rejected" };
  }

  async close(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (session && !session.closed) await new Promise<void>((resolve) => session.close(() => resolve()));
  }
}
