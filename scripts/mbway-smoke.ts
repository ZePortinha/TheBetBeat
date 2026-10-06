/**
 * pnpm mbway:smoke +3519XXXXXXXX [cents] — go-live check for real MB WAY.
 *
 * With the production ifthenpay keys in the environment, sends ONE real MB
 * WAY request (default 1,00 €) to your own phone, waits for you to approve
 * it in the MB WAY app, then refunds it in full. Proves the MB WAY key, the
 * status API and the backoffice key (refunds) in one go, without the app.
 * The callback is not part of this test: check it from the ifthenpay
 * backoffice once the site is deployed (docs/INTEGRATIONS.md).
 *
 *   IFTHENPAY_MBWAY_KEY=... IFTHENPAY_BACKOFFICE_KEY=... pnpm mbway:smoke +351912345678
 */
import { randomUUID } from "node:crypto";
import { IfthenpayProvider } from "../lib/payments/ifthenpay";

async function main() {
  const [phone, centsArg] = process.argv.slice(2);
  const mbWayKey = process.env.IFTHENPAY_MBWAY_KEY;
  const backofficeKey = process.env.IFTHENPAY_BACKOFFICE_KEY;
  if (!phone || !mbWayKey || !backofficeKey) {
    console.error("usage: IFTHENPAY_MBWAY_KEY=… IFTHENPAY_BACKOFFICE_KEY=… pnpm mbway:smoke +3519XXXXXXXX [cents]");
    process.exit(2);
  }
  const amountCents = Number(centsArg ?? 100);
  if (!Number.isSafeInteger(amountCents) || amountCents < 10) throw new Error("cents must be an integer ≥ 10");

  const provider = new IfthenpayProvider({ mbWayKey, backofficeKey, fallback: null });
  const key = `smoke:${randomUUID()}`;
  const push = await provider.charge({
    idempotencyKey: key,
    requestId: key,
    method: "mbway",
    amountCents,
    currency: "EUR",
    phone,
  });
  if (push.status !== "pending") {
    console.error(`✗ ifthenpay refused the request (${push.status}). Check the MB WAY key and the number.`);
    process.exit(1);
  }
  console.log(`✓ MB WAY request sent (${push.providerRef}). Approve it in the MB WAY app (4 minutes)…`);

  const deadline = Date.now() + 4.5 * 60_000;
  let status = push.status as string;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5_000));
    status = (await provider.getStatus(push.providerRef)).status;
    if (status !== "pending") break;
    process.stdout.write(".");
  }
  console.log("");
  if (status !== "captured") {
    console.error(`✗ payment ended as "${status}" — nothing to refund.`);
    process.exit(1);
  }
  console.log("✓ payment confirmed by the status API. Refunding…");
  await provider.refund(push.providerRef, amountCents, `${key}:refund`);
  console.log("✓ refunded. MB WAY key, status API and backoffice key all work.");
}

main().catch((error: unknown) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
