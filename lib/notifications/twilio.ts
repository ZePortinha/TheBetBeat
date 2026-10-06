/**
 * Twilio SMS adapter (2026-10-06) — real SMS for the phone sign-in code and
 * refund notices. Plain REST (no SDK):
 *   POST https://api.twilio.com/2010-04-01/Accounts/{Sid}/Messages.json
 *   Basic auth Sid:Token, form body To / From / Body → { sid } (HTTP 201).
 * `from` is a Twilio number in E.164 or an alphanumeric sender ("BetBeat"),
 * which Portugal accepts.
 */
import type { SmsProvider } from "./types";

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  from: string;
  fetchImpl?: typeof fetch;
}

export class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: TwilioConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  async send(toE164: string, body: string): Promise<{ ok: boolean; ref?: string }> {
    try {
      const res = await this.fetchImpl(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.cfg.accountSid)}/Messages.json`,
        {
          method: "POST",
          headers: {
            authorization: `Basic ${Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString("base64")}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ To: toE164, From: this.cfg.from, Body: body }).toString(),
          signal: AbortSignal.timeout(10_000),
        },
      );
      const json = (await res.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string };
      if (!res.ok || !json.sid) {
        // No phone number in logs (RGPD): only Twilio's error code.
        console.error(`[sms] twilio refused: HTTP ${res.status} code ${json.code ?? "?"}`);
        return { ok: false };
      }
      return { ok: true, ref: json.sid };
    } catch (error) {
      console.error(`[sms] twilio unreachable: ${error instanceof Error ? error.message : "unknown"}`);
      return { ok: false };
    }
  }
}
