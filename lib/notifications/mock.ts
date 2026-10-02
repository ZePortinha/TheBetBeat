/**
 * Mock SMS/email providers (B4.4 guest notices) — real gateways arrive in
 * Phase 8 behind the same interfaces. Every "sent" message is recorded in an
 * in-memory outbox so unit tests and the dev panel can inspect it.
 *
 * Privacy (B12 / RGPD): logs NEVER contain a full phone number — we log the
 * masked form via lib/security/crypto.maskPhone. That import makes this module
 * server-only, which is correct: providers only ever run on the server.
 */
import { maskPhone } from "@/lib/security/crypto";
import type { EmailProvider, SmsProvider } from "@/lib/notifications/types";

export interface SmsOutboxEntry {
  readonly kind: "sms";
  /** Monotonic ordering for tests/dev panel (no wall clock in domain code). */
  readonly seq: number;
  /** Full recipient kept in memory for assertions — never written to logs. */
  readonly to: string;
  readonly body: string;
  readonly ref: string;
}

export interface EmailOutboxEntry {
  readonly kind: "email";
  readonly seq: number;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly ref: string;
}

/** In-memory outboxes — exported for tests and the dev panel. */
export const smsOutbox: SmsOutboxEntry[] = [];
export const emailOutbox: EmailOutboxEntry[] = [];

let seq = 0;

/** Reset both outboxes (test isolation / dev panel "clear" button). */
export function clearNotificationOutboxes(): void {
  smsOutbox.length = 0;
  emailOutbox.length = 0;
  seq = 0;
}

/** E.164: "+" then 8–15 digits (B4.3 requires +351 for MB WAY phones). */
const E164_RE = /^\+[1-9]\d{7,14}$/;

/** Loose shape check — real validation belongs to the capture form. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function newRef(channel: "sms" | "email"): string {
  return `mock_${channel}_${crypto.randomUUID()}`;
}

/** Mask an email for logs: "g***@example.com". */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

export class MockSmsProvider implements SmsProvider {
  readonly name = "mock-sms";

  async send(toE164: string, body: string): Promise<{ ok: boolean; ref?: string }> {
    if (!E164_RE.test(toE164)) {
      console.warn(
        `[notifications] ${this.name}: rejected send — recipient is not E.164 (${maskPhone(toE164)})`,
      );
      return { ok: false };
    }
    const ref = newRef("sms");
    smsOutbox.push({ kind: "sms", seq: ++seq, to: toE164, body, ref });
    console.info(
      `[notifications] ${this.name}: sent to ${maskPhone(toE164)} ref=${ref} (${body.length} chars)`,
    );
    return { ok: true, ref };
  }
}

export class MockEmailProvider implements EmailProvider {
  readonly name = "mock-email";

  async send(
    to: string,
    subject: string,
    body: string,
  ): Promise<{ ok: boolean; ref?: string }> {
    if (!EMAIL_RE.test(to)) {
      console.warn(
        `[notifications] ${this.name}: rejected send — invalid address (${maskEmail(to)})`,
      );
      return { ok: false };
    }
    const ref = newRef("email");
    emailOutbox.push({ kind: "email", seq: ++seq, to, subject, body, ref });
    console.info(
      `[notifications] ${this.name}: sent to ${maskEmail(to)} ref=${ref} subject="${subject}"`,
    );
    return { ok: true, ref };
  }
}
