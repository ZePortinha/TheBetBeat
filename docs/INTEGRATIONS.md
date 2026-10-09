# Real MB WAY and SMS

Both are built and tested (`lib/payments/ifthenpay.ts`, `lib/notifications/twilio.ts`).
They switch on with environment variables. Put the keys in `.env.local` (local)
or in the hosting provider's secrets (production). Never commit them.

## MB WAY — ifthenpay

What the app does with it: every bid that needs money sends a real MB WAY
request to the guest's phone ("pedido MB WAY"). The guest has 4 minutes to
approve it in the MB WAY app. Approved money goes to the guest's BetBeat balance
and places the bid. Balances and unplayed winners are refunded through
ifthenpay's refund API.

1. Sign a contract with ifthenpay (https://ifthenpay.com, MB WAY). They issue:
   - an **MB WAY key** → `IFTHENPAY_MBWAY_KEY`
   - a **Backoffice key** (needed for refunds) → `IFTHENPAY_BACKOFFICE_KEY`
2. Choose a random anti-phishing key of 16+ characters → `IFTHENPAY_ANTI_PHISHING_KEY`.
3. Set `PAYMENT_PROVIDER=ifthenpay`.
4. Activate the callback for the MB WAY key (ifthenpay backoffice, or their
   `/v2/callback/activation` API) with this URL:

   ```
   https://<your-domain>/api/webhooks/ifthenpay?key=[ANTI_PHISHING_KEY]&orderId=[ORDER_ID]&amount=[AMOUNT]&requestId=[REQUEST_ID]&payment_datetime=[PAYMENT_DATETIME]
   ```

   The app checks the key, then double-checks the payment with ifthenpay's
   status API before crediting anything. The worker also polls pending MB WAY
   payments every 15 seconds, so a lost callback does not lose a payment.
   Keep `orderId=[ORDER_ID]` in the URL: it is how orphan payments are found
   (below). ifthenpay activates callbacks on request (suporte@ifthenpay.com).
5. Run `pnpm db:reset` (or apply migration 0013) and restart `pnpm worker`.
6. Go-live check, before opening to guests:

   ```
   IFTHENPAY_MBWAY_KEY=… IFTHENPAY_BACKOFFICE_KEY=… pnpm mbway:smoke +3519XXXXXXXX
   ```

   It sends one real 1,00 € MB WAY request to your phone, waits for you to
   approve it and refunds it. That proves the MB WAY key, the status API and
   the refund key. Then make one real bid on the deployed site and check that
   the callback arrives (audit_log `webhook.payment.confirmed`, or the
   callback log in the ifthenpay backoffice).

### Exactly-once with a PSP that has no idempotency keys

ifthenpay does not deduplicate requests, so the app does it
(`lib/payments/journal.ts`, table `psp_operations`):

- Every MB WAY request and every refund records its key before the call and
  its outcome after. The same key is never sent twice, even after a restart.
- No guest is ever refunded more than they paid for one MB WAY payment,
  whatever the reason or key.
- **Unknown outcome.** If ifthenpay does not answer (timeout, network, 5xx),
  the money may or may not have moved. The app does not guess and never
  retries on its own: the refund is marked failed with
  `outcome unknown` and the admin gets a `refund.failed.alert` in the audit
  log. To settle one, look up the payment in the ifthenpay backoffice
  (Refunds), then record what happened and hand the refund back to the worker:

  ```sql
  -- 'done' if the refund went through, 'refused' if it did not
  update public.psp_operations set state = 'done' where idempotency_key = '<refund key>';
  update public.refunds set status = 'failed', attempts = 0 where idempotency_key = '<refund key>';
  ```

  The worker picks it up within a minute: `done` is booked (ledger) without
  calling ifthenpay again; `refused` is sent again.
- **Orphan payments.** If the MB WAY request call times out but ifthenpay
  had sent it, the guest can approve a payment the app never recorded. The
  callback finds it by `orderId`, and the worker refunds it in full a minute
  later (audit_log `payment.orphan_detected` → `payment.orphan_refunded`).
  If that refund fails 5 times or its outcome is unknown, the audit log gets
  `payment.orphan_refund_failed` for the admin.

Limits to know:
- **Refunds only come out of money ifthenpay has not paid out to you yet**
  (roughly everything since 20:00 the day before). End-of-night refunds are
  fine. Refunding a balance kept for days can fail ("insufficient funds"); the
  refund then retries and alerts the admin. This is one more reason to leave
  "guardar saldo para outra noite" off.
- MB WAY is for Portuguese numbers (+351 9…).
- Cards, Apple Pay and Google Pay still use the simulator in development and are
  hidden in production until a card gateway is added.

## SMS — Twilio

What the app does with it: the 6-digit sign-in code and refund notices are
sent as real SMS.

1. Create a Twilio account (https://www.twilio.com). The trial only sends to
   verified numbers; upgrade to send to anyone.
2. Copy the **Account SID** → `TWILIO_ACCOUNT_SID` and the **Auth Token** → `TWILIO_AUTH_TOKEN`.
3. Sender → `TWILIO_FROM`: either the name `BetBeat` (alphanumeric sender,
   accepted in Portugal) or a Twilio phone number in E.164.
4. Set `SMS_PROVIDER=twilio`.

Each SMS is paid (see Twilio's price list for Portugal). The sign-in route is
rate limited and protected by Turnstile.

## Web push (outbid / winner notices)

No account needed: the browser's own push service (Google FCM, Apple, Mozilla, Windows) delivers it.

1. Generate a key pair once: `pnpm exec web-push generate-vapid-keys`.
2. Put `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:` contact) in the server env. Never commit them. Changing the pair invalidates every saved subscription.
3. Guests see "Ativar avisos" after their first bid. On iPhone, push works only once the app is added to the home screen (iOS 16.4+); the prompt hides itself elsewhere.

Leaving the keys empty turns push off: nothing is asked and nothing is sent.
