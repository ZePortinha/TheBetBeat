/**
 * Mock PSP webhook signing & parsing (BRIEF B4.3 "Robustez").
 *
 * The mock provider never confirms a payment in-process: confirmation always
 * travels as a signed webhook (rawBody + HMAC-SHA256 hex signature), exactly
 * like a real PSP, so the app's webhook route behaves identically across
 * processes and across Phase 8's real adapter.
 *
 * Signature scheme: hex(HMAC_SHA256(secret, rawBody)). The same event object
 * always serializes to the same rawBody, so a duplicate delivery of the same
 * event carries the same `id` and the same signature — downstream dedupes on
 * `event.id`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { WebhookEvent } from "./types";

/** Strict allowlist — any extra field invalidates the whole payload. */
export const webhookEventSchema = z
  .object({
    id: z.string().min(1),
    providerRef: z.string().min(1),
    type: z.enum([
      "payment.confirmed",
      "payment.failed",
      "payment.expired",
      "refund.succeeded",
      "refund.failed",
    ]),
    amountCents: z.number().int().nonnegative().optional(),
    raw: z.unknown(),
  })
  .strict();

/** Hex HMAC-SHA256 of the raw webhook body. */
export function signWebhookBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * Serialize + sign a webhook exactly as the mock PSP would deliver it.
 * Used by the dev panel, tests and the simulate script to feed the app's
 * webhook route.
 */
export function buildMockWebhook(
  event: WebhookEvent,
  secret: string,
): { rawBody: string; signature: string } {
  const rawBody = JSON.stringify(event);
  return { rawBody, signature: signWebhookBody(rawBody, secret) };
}

/**
 * Constant-time signature check + strict parse. Returns the parsed event, or
 * null for ANY invalid input (bad signature, bad JSON, unknown/extra fields).
 */
export function verifySignedWebhook(
  rawBody: string,
  signature: string,
  secret: string,
): WebhookEvent | null {
  if (!/^[0-9a-f]{64}$/i.test(signature)) return null;
  const expected = Buffer.from(signWebhookBody(rawBody, secret), "hex");
  const given = Buffer.from(signature, "hex");
  if (given.length !== expected.length || !timingSafeEqual(expected, given)) {
    return null;
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const parsed = webhookEventSchema.safeParse(json);
  if (!parsed.success) return null;
  const { id, providerRef, type, amountCents, raw } = parsed.data;
  const event: WebhookEvent = { id, providerRef, type, raw: raw ?? null };
  if (amountCents !== undefined) event.amountCents = amountCents;
  return event;
}
