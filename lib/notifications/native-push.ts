/**
 * Push for the App Store / Play builds (Capacitor shell). Their WebView has
 * no web push, so each device registers a native token instead
 * (native_push_tokens, migration 0022): iOS goes straight to APNs with the
 * team's .p8 key, Android through FCM HTTP v1 with a service account.
 *
 * Same contract as web push (push.ts): best-effort, never throws, dead
 * tokens are dropped. Env, db and network load lazily so the pure helpers
 * below stay importable in unit tests.
 */
import { createSign, sign as signRaw } from "node:crypto";
import type { GuestPush } from "./push";

export type NativePlatform = "ios" | "android";

/** APNs tokens are 32 bytes in hex today; FCM registration tokens are long base64url-ish strings. */
export function isNativeDeviceToken(platform: NativePlatform, token: string): boolean {
  return platform === "ios" ? /^[0-9a-f]{64,200}$/i.test(token) : /^[A-Za-z0-9_:\-]{100,4096}$/.test(token);
}

/** Accepts a PEM pasted with literal "\n" escapes (single-line env vars). */
export function pemFromEnv(value: string): string {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** APNs provider token: ES256 JWT, valid up to 1 h (Apple rejects older than that). */
export function apnsJwt(opts: { keyId: string; teamId: string; privateKey: string; nowSec: number }): string {
  const head = base64url(JSON.stringify({ alg: "ES256", kid: opts.keyId }));
  const body = base64url(JSON.stringify({ iss: opts.teamId, iat: opts.nowSec }));
  const signature = signRaw("sha256", Buffer.from(`${head}.${body}`), {
    key: pemFromEnv(opts.privateKey),
    dsaEncoding: "ieee-p1363",
  });
  return `${head}.${body}.${base64url(signature)}`;
}

/** Google OAuth assertion for FCM: RS256 JWT signed with the service account key. */
export function googleAssertion(opts: { clientEmail: string; privateKey: string; nowSec: number }): string {
  const head = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = base64url(
    JSON.stringify({
      iss: opts.clientEmail,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: opts.nowSec,
      exp: opts.nowSec + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${base64url(signer.sign(pemFromEnv(opts.privateKey)))}`;
}

export interface PushContent {
  title: string;
  body: string;
  /** Guest app path a tap opens (/s/<qr token>). */
  url: string;
  /** Collapses repeats for the same auction into one notification. */
  tag: string;
}

export function apnsPayload(content: PushContent): string {
  return JSON.stringify({
    aps: { alert: { title: content.title, body: content.body }, sound: "default", "thread-id": content.tag },
    url: content.url,
  });
}

export function fcmMessage(token: string, content: PushContent) {
  return {
    message: {
      token,
      notification: { title: content.title, body: content.body },
      data: { url: content.url },
      android: { priority: "HIGH", ttl: "300s", collapse_key: content.tag, notification: { tag: content.tag, sound: "default" } },
    },
  };
}

/** Whether a send failure means the device is gone for good (drop its row). */
export function isDeadToken(platform: NativePlatform, status: number, reason: string | undefined): boolean {
  if (platform === "ios") {
    return status === 410 || (status === 400 && (reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic"));
  }
  return status === 404 || reason === "UNREGISTERED";
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export function parseServiceAccount(json: string | undefined): ServiceAccount | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<ServiceAccount>;
    if (typeof parsed.project_id !== "string" || typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") {
      return null;
    }
    return { project_id: parsed.project_id, client_email: parsed.client_email, private_key: parsed.private_key };
  } catch {
    return null;
  }
}

/** Whether the server can send to native devices at all (the app hides its prompt otherwise). */
export function nativePushEnabled(env: {
  APNS_KEY_ID?: string;
  APNS_PRIVATE_KEY?: string;
  APPLE_TEAM_ID?: string;
  FCM_SERVICE_ACCOUNT_JSON?: string;
}): { ios: boolean; android: boolean } {
  return {
    ios: Boolean(env.APNS_KEY_ID && env.APNS_PRIVATE_KEY && env.APPLE_TEAM_ID),
    android: parseServiceAccount(env.FCM_SERVICE_ACCOUNT_JSON) !== null,
  };
}

// Tokens are reused until close to expiry (both are valid for 1 h).
let apnsCache: { jwt: string; at: number } | null = null;
let googleCache: { token: string; expiresAt: number } | null = null;

async function sendApns(
  token: string,
  content: PushContent,
  cfg: { keyId: string; teamId: string; privateKey: string; bundleId: string; sandbox: boolean },
  nowSec: number,
): Promise<{ status: number; reason?: string }> {
  if (!apnsCache || nowSec - apnsCache.at > 50 * 60) {
    apnsCache = { jwt: apnsJwt({ keyId: cfg.keyId, teamId: cfg.teamId, privateKey: cfg.privateKey, nowSec }), at: nowSec };
  }
  const http2 = await import("node:http2");
  const host = cfg.sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  return new Promise((resolve) => {
    const client = http2.connect(host);
    const done = (result: { status: number; reason?: string }) => {
      client.close();
      resolve(result);
    };
    client.on("error", () => done({ status: 0 }));
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${apnsCache!.jwt}`,
      "apns-topic": cfg.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": String(nowSec + 300),
      "apns-collapse-id": content.tag.slice(0, 64),
      "content-type": "application/json",
    });
    let status = 0;
    let raw = "";
    req.setTimeout(10_000, () => req.close());
    req.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
    });
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      let reason: string | undefined;
      try {
        reason = raw ? (JSON.parse(raw) as { reason?: string }).reason : undefined;
      } catch {
        reason = undefined;
      }
      done({ status, reason });
    });
    req.on("error", () => done({ status: 0 }));
    req.end(apnsPayload(content));
  });
}

async function googleAccessToken(account: ServiceAccount, nowSec: number): Promise<string | null> {
  if (googleCache && googleCache.expiresAt - 120 > nowSec) return googleCache.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: googleAssertion({ clientEmail: account.client_email, privateKey: account.private_key, nowSec }),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;
  googleCache = { token: json.access_token, expiresAt: nowSec + (json.expires_in ?? 3600) };
  return json.access_token;
}

async function sendFcm(
  token: string,
  content: PushContent,
  account: ServiceAccount,
  nowSec: number,
): Promise<{ status: number; reason?: string }> {
  const access = await googleAccessToken(account, nowSec);
  if (!access) return { status: 0 };
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
    body: JSON.stringify(fcmMessage(token, content)),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) return { status: res.status };
  const json = (await res.json().catch(() => null)) as {
    error?: { status?: string; details?: Array<{ errorCode?: string }> };
  } | null;
  const reason = json?.error?.details?.find((d) => d.errorCode)?.errorCode ?? json?.error?.status;
  return { status: res.status, reason };
}

/** Sends each push to every native device the guest enabled; dead tokens are dropped. */
export async function sendNativePushes(items: GuestPush[], nowMs: number = Date.now()): Promise<void> {
  if (items.length === 0) return;
  try {
    const { env } = await import("@/lib/security/env");
    const enabled = nativePushEnabled(env);
    if (!enabled.ios && !enabled.android) return;
    const account = parseServiceAccount(env.FCM_SERVICE_ACCOUNT_JSON);
    const [{ getPool }, { pushText }] = await Promise.all([import("@/lib/db"), import("./push")]);
    const rows = await getPool().query<{
      id: string;
      guest_id: string;
      platform: NativePlatform;
      token: string;
      url_path: string;
      locale: string;
    }>(
      `select t.id, t.guest_id, t.platform, t.token, t.url_path, g.locale
         from public.native_push_tokens t join public.guests g on g.id = t.guest_id
        where t.guest_id = any($1::uuid[])`,
      [[...new Set(items.map((i) => i.guestId))]],
    );
    const nowSec = Math.floor(nowMs / 1000);
    await Promise.allSettled(
      rows.rows.flatMap((row) =>
        items
          .filter((item) => item.guestId === row.guest_id)
          .map(async (item) => {
            const content: PushContent = { ...pushText(row.locale, item.kind), url: row.url_path, tag: `auction-${item.slotId}` };
            let result: { status: number; reason?: string };
            if (row.platform === "ios") {
              if (!enabled.ios) return;
              result = await sendApns(
                row.token,
                content,
                {
                  keyId: env.APNS_KEY_ID!,
                  teamId: env.APPLE_TEAM_ID!,
                  privateKey: env.APNS_PRIVATE_KEY!,
                  bundleId: env.APNS_BUNDLE_ID,
                  sandbox: env.APNS_ENV === "sandbox",
                },
                nowSec,
              );
            } else {
              if (!account) return;
              result = await sendFcm(row.token, content, account, nowSec);
            }
            if (result.status >= 200 && result.status < 300) return;
            if (isDeadToken(row.platform, result.status, result.reason)) {
              await getPool().query(`delete from public.native_push_tokens where id = $1`, [row.id]);
            } else {
              console.error(`[push:${row.platform}] send failed: HTTP ${result.status || "network"} ${result.reason ?? ""}`.trim());
            }
          }),
      ),
    );
  } catch (error) {
    console.error("[push:native] skipped:", (error as Error).message);
  }
}
