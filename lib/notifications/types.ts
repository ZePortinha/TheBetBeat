/** SMS/email providers (mock until Phase 8). Consent-gated (B6, RGPD). */
export interface SmsProvider {
  readonly name: string;
  send(toE164: string, body: string): Promise<{ ok: boolean; ref?: string }>;
}

export interface EmailProvider {
  readonly name: string;
  send(
    to: string,
    subject: string,
    body: string,
  ): Promise<{ ok: boolean; ref?: string }>;
}
