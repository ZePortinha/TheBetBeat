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
