/**
 * DJ cockpit E2E (BRIEF B7 / Phase 5 criteria). Runs on the `ipad`
 * project (1194×834, touch) only.
 *
 * Covers: new paid request appears live (payment → cockpit alert),
 * accept, reject with and without "Desfazer" (the server call only goes
 * out after the 5 s window), pin as next, mark playing, cancel, pause /
 * resume requests, the offline banner + queued action replay, the
 * "Terminar set" sheet (summary, cancel, short hold does NOT end) and —
 * gated — the full hold that ends the set.
 *
 * Paid requests are produced through the public guest API + dev PSP
 * panel (see fixtures.createPaidRequest): the same path real guests use.
 *
 * `E2E_END_SET=1` enables the destructive end-set test: it ends the seeded
 * live session, so run it LAST (or `pnpm db:reset` afterwards).
 *
 * NOT verified in the cloud session that wrote this file (no DB there).
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createPaidRequest, loginStaff, SEED, type PaidRequest } from "./fixtures";

const IPAD_ONLY = "iPad viewport only";
const UNDO_WINDOW_MS = 5000;

function card(page: Page, requestId: string) {
  return page.locator(`[data-request-id="${requestId}"]`);
}

async function guestStatus(request: APIRequestContext, paid: PaidRequest) {
  const res = await request.get(`/api/guest/requests/${paid.requestId}`, {
    headers: { authorization: `Bearer ${paid.guest.accessToken}` },
  });
  return (await res.json()) as { status: string; closeReason: string | null; tier: string };
}

async function waitForStatus(
  request: APIRequestContext,
  paid: PaidRequest,
  status: string,
  timeoutMs = 10_000,
) {
  const until = Date.now() + timeoutMs;
  let last = await guestStatus(request, paid);
  while (last.status !== status && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 300));
    last = await guestStatus(request, paid);
  }
  return last;
}

test.describe("cockpit", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== "ipad", IPAD_ONLY);
    await loginStaff(page, "dj", "/cockpit");
    await page.goto("/cockpit");
    await expect(page.getByRole("heading", { name: /^Decidir/ })).toBeVisible({ timeout: 20_000 });
  });

  test("um pagamento confirmado aparece em Decidir ao vivo", async ({ page, request }) => {
    const paid = await createPaidRequest(request);
    // B1.5: < 1 s from the confirmed payment (the helper returns once the
    // webhook is accepted) to the card on the cockpit. Measured in the dev
    // server, so the budget is 2 s; `pnpm simulate` reports the strict p95.
    const t0 = Date.now();
    const arrived = card(page, paid.requestId);
    await expect(arrived).toBeVisible({ timeout: 10_000 });
    const latencyMs = Date.now() - t0;
    expect(latencyMs).toBeLessThan(2000);
    test.info().annotations.push({ type: "latency", description: `${latencyMs} ms (confirmed payment → card)` });

    await expect(arrived.getByText(paid.trackTitle)).toBeVisible();
    await expect(arrived.getByRole("button", { name: "Aceitar" })).toBeVisible();
    await expect(arrived.getByRole("button", { name: "Recusar" })).toBeVisible();
    // Feed shows the payment (B7 bottom bar).
    await expect(page.getByText(new RegExp(`Pago .*${paid.trackTitle.slice(0, 12)}`))).toBeVisible();
  });

  test("aceitar → fixar como próxima → marcar a tocar", async ({ page, request }) => {
    const paid = await createPaidRequest(request);
    const c = card(page, paid.requestId);
    await expect(c).toBeVisible({ timeout: 10_000 });

    await c.getByRole("button", { name: "Aceitar" }).click();
    await expect(c.getByRole("button", { name: "Fixar como próxima" })).toBeVisible({ timeout: 10_000 });
    expect((await waitForStatus(request, paid, "accepted")).status).toBe("accepted");

    await c.getByRole("button", { name: "Fixar como próxima" }).click();
    await expect(c.getByRole("button", { name: "Soltar" })).toBeVisible({ timeout: 10_000 });
    await expect(c.getByText("Próxima", { exact: true }).first()).toBeVisible();

    // The big primary acts on the pinned request.
    await page.getByRole("button", { name: "Marcar a tocar" }).first().click();
    expect((await waitForStatus(request, paid, "playing")).status).toBe("playing");
    await expect(page.getByText(paid.trackTitle).first()).toBeVisible({ timeout: 10_000 });
  });

  test("recusar com Desfazer mantém o pedido pago", async ({ page, request }) => {
    const paid = await createPaidRequest(request);
    const c = card(page, paid.requestId);
    await expect(c).toBeVisible({ timeout: 10_000 });

    await c.getByRole("button", { name: "Recusar" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Recusar pedido")).toBeVisible();
    await sheet.getByRole("button", { name: "Fora do estilo" }).click();

    // Card collapses, toast with "Desfazer" appears, nothing sent yet.
    await expect(c).toBeHidden();
    const undo = page.getByRole("status").getByRole("button", { name: "Desfazer" });
    await expect(undo).toBeVisible();
    await undo.click();
    await expect(c).toBeVisible();

    await page.waitForTimeout(UNDO_WINDOW_MS + 500);
    expect((await guestStatus(request, paid)).status).toBe("paid");
  });

  test("recusar sem Desfazer reembolsa depois da janela de 5 s", async ({ page, request }) => {
    const paid = await createPaidRequest(request);
    const c = card(page, paid.requestId);
    await expect(c).toBeVisible({ timeout: 10_000 });

    await c.getByRole("button", { name: "Recusar" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Já tocou" }).click();
    await expect(c).toBeHidden();

    // Still paid during the window (the decision is not sent yet)…
    expect((await guestStatus(request, paid)).status).toBe("paid");
    // …refunded once it closes (B4.2 rejected_by_dj → refunded, B4.4 automatic).
    const final = await waitForStatus(request, paid, "refunded", UNDO_WINDOW_MS + 8000);
    expect(final.status).toBe("refunded");
    expect(final.closeReason).toBe("rejected_by_dj");
    await expect(page.getByText(/Reembolsado · /).first()).toBeVisible({ timeout: 10_000 });
  });

  test("cancelar um pedido aceite reembolsa na totalidade", async ({ page, request }) => {
    const paid = await createPaidRequest(request);
    const c = card(page, paid.requestId);
    await expect(c).toBeVisible({ timeout: 10_000 });
    await c.getByRole("button", { name: "Aceitar" }).click();
    await expect(c.getByRole("button", { name: "Cancelar" })).toBeVisible({ timeout: 10_000 });

    await c.getByRole("button", { name: "Cancelar" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Cancelar pedido")).toBeVisible();
    await sheet.getByRole("button", { name: "Outro" }).click();
    await expect(c).toBeHidden();

    const final = await waitForStatus(request, paid, "refunded", UNDO_WINDOW_MS + 8000);
    expect(final.status).toBe("refunded");
    expect(final.closeReason).toBe("cancelled_by_dj");
  });

  test("pausar e reabrir pedidos", async ({ page, request }) => {
    const toggle = page.getByRole("switch", { name: "Abrir ou pausar pedidos" });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.getByText("Pedidos em pausa").first()).toBeVisible();

    // Guests are refused while paused (B7 top bar switch).
    await expect(createPaidRequest(request)).rejects.toThrow(/requests_closed|could not create/);

    await toggle.click();
    await expect(page.getByText("Pedidos abertos").first()).toBeVisible();
    // The switch is optimistic: poll until the server has the new state.
    await expect
      .poll(async () => {
        const state = await page.request.get("/api/cockpit/state");
        return ((await state.json()) as { session: { requestsOpen: boolean } }).session.requestsOpen;
      })
      .toBe(true);
  });

  test("offline: a ação fica guardada e sincroniza ao reconectar", async ({ page, request, context }) => {
    const paid = await createPaidRequest(request);
    const c = card(page, paid.requestId);
    await expect(c).toBeVisible({ timeout: 10_000 });

    await context.setOffline(true);
    await c.getByRole("button", { name: "Aceitar" }).click();
    await expect(page.getByText("Sem ligação — ações guardadas")).toBeVisible({ timeout: 10_000 });
    expect((await guestStatus(request, paid)).status).toBe("paid");

    await context.setOffline(false);
    // Replayed in order with its idempotency key, then reconciled.
    expect((await waitForStatus(request, paid, "accepted", 20_000)).status).toBe("accepted");
    await expect(page.getByText("Sem ligação — ações guardadas")).toBeHidden({ timeout: 15_000 });
  });

  test("Definições: Terminar set mostra o resumo e só termina com 2 s premidos", async ({ page, request }) => {
    const paid = await createPaidRequest(request);
    await page.goto("/cockpit/settings");
    await expect(page.getByTestId("settings-screen")).toBeVisible({ timeout: 20_000 });

    await page.getByTestId("end-set-open").click();
    const sheet = page.getByTestId("end-set-sheet");
    await expect(sheet).toBeVisible();
    // Summary names how many requests get refunded (our paid one included).
    await expect(page.getByTestId("end-set-preview")).toContainText(/pedidos por tocar|Não há pedidos/, { timeout: 10_000 });
    await expect(page.getByTestId("end-set-preview")).toContainText(/[1-9]\d* pedidos por tocar/);

    // A short press must NOT end the set (hold-to-confirm, B7).
    const hold = page.getByTestId("end-set-hold").getByRole("button");
    const box = (await hold.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    await page.waitForTimeout(500);
    const state = await page.request.get("/api/cockpit/state");
    expect(((await state.json()) as { session: { status: string } }).session.status).toBe("live");
    expect((await guestStatus(request, paid)).status).toBe("paid");

    await page.getByRole("button", { name: "Cancelar" }).last().click();
    await expect(sheet).toBeHidden();
  });

  test("Terminar set: manter premido 2 s fecha a sessão e reembolsa os pedidos por tocar", async ({ page, request }) => {
    test.skip(process.env.E2E_END_SET !== "1", "destructive: ends the seeded live session (set E2E_END_SET=1 and run last)");
    const paid = await createPaidRequest(request);
    await page.goto("/cockpit/settings");
    await page.getByTestId("end-set-open").click();
    await expect(page.getByTestId("end-set-preview")).toContainText(/pedidos por tocar/, { timeout: 10_000 });

    const hold = page.getByTestId("end-set-hold").getByRole("button");
    const box = (await hold.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(2400);
    await page.mouse.up();

    await expect(page.getByTestId("end-set-summary")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Set terminado").first()).toBeVisible();
    const final = await waitForStatus(request, paid, "refunded", 15_000);
    expect(final.status).toBe("refunded");
    expect(final.closeReason).toBe("session_ended");

    const state = await page.request.get(`/api/cockpit/state?sessionId=${SEED.sessionId}`);
    expect(((await state.json()) as { session: { status: string } }).session.status).toBe("ended");
  });
});
