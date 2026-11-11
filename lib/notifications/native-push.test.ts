import { generateKeyPairSync, verify, createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  apnsJwt,
  apnsPayload,
  fcmMessage,
  googleAssertion,
  isDeadToken,
  isNativeDeviceToken,
  nativePushEnabled,
  parseServiceAccount,
  pemFromEnv,
} from "./native-push";

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

describe("native push", () => {
  it("accepts only token shapes the push services issue", () => {
    expect(isNativeDeviceToken("ios", "a".repeat(64))).toBe(true);
    expect(isNativeDeviceToken("ios", "zz".repeat(32))).toBe(false);
    expect(isNativeDeviceToken("ios", "a".repeat(63))).toBe(false);
    expect(isNativeDeviceToken("android", `dGVzdA:APA91b${"x".repeat(140)}`)).toBe(true);
    expect(isNativeDeviceToken("android", `bad token ${"x".repeat(140)}`)).toBe(false);
    expect(isNativeDeviceToken("android", "short")).toBe(false);
  });

  it("signs a valid ES256 APNs provider token", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const jwt = apnsJwt({ keyId: "ABC123DEFG", teamId: "TEAM123456", privateKey: pem.replace(/\n/g, "\\n"), nowSec: 1_700_000_000 });
    const [head, body, sig] = jwt.split(".") as [string, string, string];
    expect(decode(head)).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    expect(decode(body)).toEqual({ iss: "TEAM123456", iat: 1_700_000_000 });
    const ok = verify("sha256", Buffer.from(`${head}.${body}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"));
    expect(ok).toBe(true);
  });

  it("signs a valid RS256 Google assertion scoped to FCM", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const jwt = googleAssertion({ clientEmail: "push@demo-discontrol.iam.gserviceaccount.com", privateKey: pem, nowSec: 100 });
    const [head, body, sig] = jwt.split(".") as [string, string, string];
    const claims = decode(body);
    expect(claims.scope).toBe("https://www.googleapis.com/auth/firebase.messaging");
    expect(claims.exp).toBe(3700);
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${head}.${body}`);
    expect(verifier.verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);
  });

  it("carries the guest link in both payloads", () => {
    const content = { title: "Ultrapassaram-te", body: "Sobe a tua oferta.", url: "/s/tok", tag: "auction-1" };
    expect(JSON.parse(apnsPayload(content))).toMatchObject({ aps: { alert: { title: content.title } }, url: "/s/tok" });
    expect(fcmMessage("t", content).message).toMatchObject({ token: "t", data: { url: "/s/tok" }, android: { priority: "HIGH" } });
  });

  it("drops only devices that are gone for good", () => {
    expect(isDeadToken("ios", 410, "Unregistered")).toBe(true);
    expect(isDeadToken("ios", 400, "BadDeviceToken")).toBe(true);
    expect(isDeadToken("ios", 429, "TooManyRequests")).toBe(false);
    expect(isDeadToken("ios", 0, undefined)).toBe(false);
    expect(isDeadToken("android", 404, "UNREGISTERED")).toBe(true);
    expect(isDeadToken("android", 503, "UNAVAILABLE")).toBe(false);
  });

  it("is off per platform until its keys are set", () => {
    expect(nativePushEnabled({})).toEqual({ ios: false, android: false });
    expect(nativePushEnabled({ APNS_KEY_ID: "k", APNS_PRIVATE_KEY: "p", APPLE_TEAM_ID: "TEAM123456" }).ios).toBe(true);
    expect(nativePushEnabled({ APNS_KEY_ID: "k", APNS_PRIVATE_KEY: "p" }).ios).toBe(false);
    const account = JSON.stringify({ project_id: "demo", client_email: "a@b", private_key: "k" });
    expect(nativePushEnabled({ FCM_SERVICE_ACCOUNT_JSON: account }).android).toBe(true);
    expect(parseServiceAccount("{not json")).toBeNull();
    expect(parseServiceAccount(JSON.stringify({ project_id: "demo" }))).toBeNull();
  });

  it("unescapes single-line PEM values", () => {
    expect(pemFromEnv("a\\nb")).toBe("a\nb");
    expect(pemFromEnv("a\nb")).toBe("a\nb");
  });
});
