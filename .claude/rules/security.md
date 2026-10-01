# Security (summary of BRIEF B12 — applies to every session)

- Secrets only in env vars validated by `lib/security/env.ts` (zod, boot-fail).
  Never in code, git, or `NEXT_PUBLIC_*`. Service-role key: server only, modules
  import `server-only`. Client gets the anon key only.
- RLS enabled on EVERY public table, default deny. Policies always scoped by
  owner (`auth.uid()`) or venue role — never `USING (true)` except on data that
  is truly public. Anonymous guests are also `authenticated`: staff policies
  must check venue roles, never just `authenticated`.
- Money tables (payments, refunds, ledger_entries, payouts, invoices, audit_log):
  clients never write — server only.
- Every external input (routes, server actions, webhooks, jobs) is validated
  with a strict zod schema (field allowlist). Price, status, role, venue_id and
  amounts NEVER come from the client.
- No concatenated SQL — parameterized queries / RPC only.
- Cockpit & console require staff sessions, validated server-side per request;
  MFA for managers/admin. Cookies httpOnly/secure/sameSite.
- All responses carry security headers (CSP with nonce, DENY framing, nosniff,
  strict referrer, minimal permissions). HTTPS + HSTS.
- Rate limiting + Turnstile on public sensitive endpoints (anon session, search,
  quotes, payments, login).
- Minimal DTOs — never `select *` to the client; no phones/emails of others.
  Generic errors with correlation id; no stack traces or PII in logs (phones
  masked, hashed with salt for limits).
- Sensitive data (phones, IBANs, third-party tokens) encrypted at rest
  (AES-256-GCM, key outside the DB).
- Dependencies: verify exact name/publisher before install; lockfile committed;
  install scripts blocked by default; `pnpm audit` clean of high vulns.
- `pnpm db:audit` must pass (RLS everywhere, no generic-true policies, no excess
  anon/authenticated privileges).
