/**
 * DJ cockpit E2E — slot auctions (2026-10-05). Runs on the `ipad`
 * project (1194×834, touch) only.
 *
 * Covers: the auction board ("Abrir leilão agora"), the winner card
 * (accept → playing → played), reject reopens the auction, the mic alert
 * from 150 €, "pausar pedidos" also pausing bids, the "Terminar set"
 * sheet (summary, cancel, a short hold does NOT end) and — gated — the
 * full hold that ends the set and gives the money back.
 *
 * Auctions are driven through the dev-only /api/dev/auction; guests bid
 * through the public guest API with the mock card (fixtures.bidViaApi).
 *
 * `E2E_END_SET=1` enables the destructive end-set test: it ends the seeded
 * live session, so run it LAST (or `pnpm db:reset` afterwards).
 */
import { expect, test } from "@playwright/test";
import { auctionState, bidViaApi, closeAuction, loginStaff, openAuction, SEED, walletBalance } from "./fixtures";

const IPAD_ONLY = "iPad viewport only";

/** Opens an auction, a guest bids, the auction closes: a winner waits for the DJ. */
async function winnerWaiting(request: Parameters<typeof openAuction>[0], totalCents = 500, handle?: string) {
  const slotId = await openAuction(request, 600);
  const bid = await bidViaApi(request, { slotId, totalCents, ...(handle ? { handle } : {}) });
  await closeAuction(request, slotId);
  return { slotId, ...bid };
}

/** Winners left waiting by earlier runs (or someone testing by hand) would take the card first. */
async function clearWaitingWinners(page: import("@playwright/test").Page, request: Parameters<typeof openAuction>[0]) {
  for (let i = 0; i < 10; i += 1) {
    const upNext = (await auctionState(request)).upNext;
    if (!upNext) return;
    for (const action of ["accept", "playing", "played"]) {
      await page.request.post(`/api/cockpit/auction/${upNext.slotId}`, { data: { action } });
    }
  }
}

test.describe("cockpit · leilões", () => {
  test.beforeEach(async ({ page, request }) => {
    test.skip(test.info().project.name !== "ipad", IPAD_ONLY);
    // `pnpm dev` compiles each route on first use: the flows need headroom.
    test.setTimeout(120_000);
    await openAuction(request, 600);
    await loginStaff(page, "dj", "/cockpit");
    await clearWaitingWinners(page, request);
    await page.goto("/cockpit");
    await expect(page.getByRole("heading", { name: "Leilões", exact: true })).toBeVisible({ timeout: 60_000 });
  });

  test("Sessão: o DJ gera o QR do evento para partilhar", async ({ page }) => {
    await page.goto("/cockpit/session");
    await page.getByTestId("event-qr-generate").click();
    await expect(page.getByTestId("event-qr").getByRole("img")).toBeVisible({ timeout: 15_000 });
  });

  test("o quadro mostra o leilão aberto e “Abrir leilão agora” abre outro", async ({ page }) => {
    await expect(page.getByText(/Sem licitações\. Mínimo/).first()).toBeVisible({ timeout: 15_000 });
    const before = await page.getByText(/Sem licitações\. Mínimo/).count();
    await page.getByRole("button", { name: "Abrir leilão agora" }).click();
    await expect.poll(() => page.getByText(/Sem licitações\. Mínimo/).count(), { timeout: 15_000 }).toBeGreaterThan(before);
  });

  test("vencedor: aceitar → pôr a tocar → tocou", async ({ page, request }) => {
    await winnerWaiting(request, 700);
    await expect(page.getByRole("button", { name: "Aceitar" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("7 €").first()).toBeVisible();
    await page.getByRole("button", { name: "Aceitar" }).click();
    await page.getByRole("button", { name: "Pôr a tocar" }).click();
    await expect(page.getByText("A tocar agora").first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Tocou" }).click();
    await expect(page.getByText(/Nenhum vencedor à espera/)).toBeVisible({ timeout: 15_000 });
  });

  test("recusar devolve o dinheiro e reabre o leilão", async ({ page, request }) => {
    const { guest } = await winnerWaiting(request, 600);
    await page.getByRole("button", { name: "Recusar e reabrir o leilão" }).click();
    await expect(page.getByText(/Nenhum vencedor à espera/)).toBeVisible({ timeout: 15_000 });
    // The winner's money is back in their balance, and a fresh auction is open.
    await expect.poll(async () => (await auctionState(request, guest)).me?.walletCents ?? 0, { timeout: 15_000 }).toBe(600);
    expect((await auctionState(request)).open.length).toBeGreaterThan(0);
  });

  test("150 € ou mais: alerta para anunciar ao microfone", async ({ page, request }) => {
    await winnerWaiting(request, 15_000, "e2e_mic");
    const alert = page.getByRole("alert").filter({ hasText: "Anunciar ao microfone" });
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText("@e2e_mic");
    await alert.getByRole("button", { name: "Anunciado" }).click();
    await expect(alert).toBeHidden({ timeout: 15_000 });
    // Clean up: play it so the next test starts with no winner waiting.
    await page.getByRole("button", { name: "Pôr a tocar" }).click();
    await page.getByRole("button", { name: "Tocou" }).click();
  });

  test("pausar pedidos também pausa as licitações", async ({ page, request }) => {
    const toggle = page.getByRole("switch", { name: "Abrir ou pausar pedidos" });
    await toggle.click();
    await expect(page.getByText("Pedidos em pausa").first()).toBeVisible();
    await expect
      .poll(async () => ((await (await page.request.get("/api/cockpit/state")).json()) as { session: { requestsOpen: boolean } }).session.requestsOpen)
      .toBe(false);
    const slotId = (await auctionState(request)).open[0]!.id;
    await expect(bidViaApi(request, { slotId, totalCents: 500 })).rejects.toThrow(/requests_closed/);

    await toggle.click();
    await expect
      .poll(async () => ((await (await page.request.get("/api/cockpit/state")).json()) as { session: { requestsOpen: boolean } }).session.requestsOpen)
      .toBe(true);
  });

  test("Definições: Terminar set mostra o que volta e só termina com 2 s premidos", async ({ page, request }) => {
    const slotId = (await auctionState(request)).open[0]!.id;
    await bidViaApi(request, { slotId, totalCents: 500 });
    await page.goto("/cockpit/settings");
    await expect(page.getByTestId("settings-screen")).toBeVisible({ timeout: 20_000 });

    await page.getByTestId("end-set-open").click();
    const sheet = page.getByTestId("end-set-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("end-set-preview")).toContainText(/convidados? receb/, { timeout: 10_000 });

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

    await page.getByRole("button", { name: "Cancelar" }).last().click();
    await expect(sheet).toBeHidden();
  });

  test("Terminar set: manter premido 2 s fecha a sessão e devolve o dinheiro ao saldo", async ({ page, request }) => {
    test.skip(process.env.E2E_END_SET !== "1", "destructive: ends the seeded live session (set E2E_END_SET=1 and run last)");
    const slotId = (await auctionState(request)).open[0]!.id;
    const { guest } = await bidViaApi(request, { slotId, totalCents: 500 });
    await page.goto("/cockpit/settings");
    await page.getByTestId("end-set-open").click();
    await expect(page.getByTestId("end-set-preview")).toContainText(/convidados? receb/, { timeout: 10_000 });

    const hold = page.getByTestId("end-set-hold").getByRole("button");
    const box = (await hold.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(2400);
    await page.mouse.up();

    await expect(page.getByTestId("end-set-summary")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Set terminado").first()).toBeVisible();
    // The open bid came back to the guest's balance (withdrawable for 7 days,
    // not refunded tonight: 2026-10-10).
    // (At least the 5 € asked: the bid helper may climb to the track's own floor.)
    expect(await walletBalance(request, guest.guestId)).toBeGreaterThanOrEqual(500);
    const ended = await page.request.get(`/api/cockpit/state?sessionId=${SEED.sessionId}`);
    expect(((await ended.json()) as { session: { status: string } }).session.status).toBe("ended");
  });
});
