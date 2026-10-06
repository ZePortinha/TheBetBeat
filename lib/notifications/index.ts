/**
 * Notifications (B4.4): provider factories + the guest refund notice.
 *
 * Provider selection reads the server env LAZILY (dynamic import) so that the
 * pure helpers below — formatEuros, buildRefundMessage — stay importable in
 * unit tests and client-adjacent code without a configured server environment.
 */
import type { CloseReason } from "@/lib/domain/types";
import type { EmailProvider, SmsProvider } from "@/lib/notifications/types";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Format integer cents as pt-PT euros: 1100 → "11 €", 1250 → "12,50 €",
 * 0 → "0 €", 123456 → "1.234,56 €". Whole-euro amounts drop the decimals
 * (SMS space is scarce); negative amounts keep a leading "-".
 */
export function formatEuros(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`formatEuros expects integer cents, got ${String(cents)}`);
  }
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const euros = Math.trunc(abs / 100).toString();
  // pt-PT thousands grouping: 1.234,56 €
  const grouped = euros.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const rem = abs % 100;
  return rem === 0
    ? `${sign}${grouped} €`
    : `${sign}${grouped},${String(rem).padStart(2, "0")} €`;
}

/**
 * Why the guest is being refunded. Reuses the domain CloseReason vocabulary
 * (minus payment_timeout — nothing was charged there) and adds the partial
 * refund case of B4.2: SOON/NEXT demoted to QUEUE refunds the difference.
 */
export type RefundNoticeReason =
  | Exclude<CloseReason, "payment_timeout">
  | "tier_demoted";

/**
 * pt-PT copy for SMS/email bodies. This is server-sent message text, not UI
 * copy, so it lives here instead of messages/*.json (which the guest PWA owns);
 * the on-screen notice itself is rendered by the guest surface via realtime.
 */
const REASON_COPY_PT: Record<RefundNoticeReason, string> = {
  rejected_by_dj: "o DJ não aceitou o pedido",
  dj_timeout: "o pedido expirou sem resposta do DJ",
  cancelled_by_dj: "o DJ cancelou o pedido",
  session_ended: "a sessão terminou antes de a música tocar",
  tier_demoted: "a música não tocou no prazo prometido",
};

export interface GuestRefundNotice {
  /** Amount returned to the guest, integer cents (full or difference). */
  amountCents: number;
  /** Track title as the guest saw it when requesting. */
  trackTitle: string;
  reason: RefundNoticeReason;
  /** E.164 phone, only if the guest provided it with consent (B6). */
  phoneE164?: string;
  /** Email, only if the guest provided it with consent (B6). */
  email?: string;
}

/** Pure message builder — exported so the dev panel/tests can preview copy. */
export function buildRefundMessage(
  notice: Pick<GuestRefundNotice, "amountCents" | "trackTitle" | "reason">,
): string {
  return (
    `BetBeat: devolvemos ${formatEuros(notice.amountCents)} ` +
    `do teu pedido «${notice.trackTitle}». ` +
    `Motivo: ${REASON_COPY_PT[notice.reason]}.`
  );
}

const REFUND_EMAIL_SUBJECT_PT = "BetBeat — reembolso do teu pedido";

/** SMS body for the guest phone sign-in code. */
export function buildLoginCodeMessage(code: string): string {
  return `BetBeat: o teu código é ${code}. Expira em 5 minutos. Não o partilhes.`;
}

// ---------------------------------------------------------------------------
// Provider factories (lazy env import, singletons)
// ---------------------------------------------------------------------------

let smsSingleton: SmsProvider | undefined;
let emailSingleton: EmailProvider | undefined;

async function instantiateSms(kind: "mock"): Promise<SmsProvider> {
  switch (kind) {
    case "mock": {
      const { MockSmsProvider } = await import("@/lib/notifications/mock");
      return new MockSmsProvider();
    }
  }
}

async function instantiateEmail(kind: "mock"): Promise<EmailProvider> {
  switch (kind) {
    case "mock": {
      const { MockEmailProvider } = await import("@/lib/notifications/mock");
      return new MockEmailProvider();
    }
  }
}

export async function getSmsProvider(): Promise<SmsProvider> {
  if (!smsSingleton) {
    const { env } = await import("@/lib/security/env");
    smsSingleton = await instantiateSms(env.SMS_PROVIDER);
  }
  return smsSingleton;
}

export async function getEmailProvider(): Promise<EmailProvider> {
  if (!emailSingleton) {
    const { env } = await import("@/lib/security/env");
    emailSingleton = await instantiateEmail(env.EMAIL_PROVIDER);
  }
  return emailSingleton;
}

// ---------------------------------------------------------------------------
// Guest refund notice (B4.4)
// ---------------------------------------------------------------------------

export interface GuestRefundNoticeResult {
  /** The exact message sent (and shown on screen by the guest surface). */
  message: string;
  /** Present when an SMS was attempted. */
  sms?: { ok: boolean; ref?: string };
  /** Present when an email was attempted. */
  email?: { ok: boolean; ref?: string };
}

/**
 * B4.4: the guest sees the refund on screen, "e também por SMS ou email se os
 * tiver dado". SMS is the preferred channel (guests gave +351 numbers for
 * MB WAY); email is the fallback when there is no phone or the SMS send fails.
 * With neither contact given, only the message is returned for on-screen use.
 * Callers handle retry/backoff and admin alerts (worker, per B4.4).
 */
export async function notifyGuestRefund(
  notice: GuestRefundNotice,
): Promise<GuestRefundNoticeResult> {
  const message = buildRefundMessage(notice);
  const result: GuestRefundNoticeResult = { message };

  if (notice.phoneE164) {
    const sms = await getSmsProvider();
    result.sms = await sms.send(notice.phoneE164, message);
    if (result.sms.ok) return result;
  }

  if (notice.email) {
    const email = await getEmailProvider();
    result.email = await email.send(notice.email, REFUND_EMAIL_SUBJECT_PT, message);
  }

  return result;
}
