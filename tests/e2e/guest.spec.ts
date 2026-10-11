/**
 * Guest app E2E — slot auctions (2026-10-05). Runs on the `phone`
 * project (393×852) only.
 *
 * Covers: the logo intro, bidding in ≤ 4 taps from the QR, being outbid
 * (money back to the balance) and raising, "Vencedor" when the auction
 * closes, the DJ playing it, the last-30-seconds flash, MB WAY declined,
 * PT/EN, the public screens, axe and reduced motion.
 *
 * Needs: local Supabase seeded (`pnpm db:reset`) and `pnpm dev`. Auctions
 * are driven through the dev-only /api/dev/auction (open, close + tick);
 * payments through the mock PSP (card at once, MB WAY via the dev panel).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { auctionState, bidViaApi, closeAuction, enterParty, freshClientIp, getGuestUrl, loginStaff, openAuction } from "./fixtures";

const PHONE_ONLY = "phone viewport only";

test.describe("guest app · leilões", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "phone", PHONE_ONLY);
    // `pnpm dev` compiles each route on first use: the flows need headroom.
    test.setTimeout(120_000);
  });

  /** Open the guest app, wait for the logo intro to leave, sign in by phone. */
  async function openGuest(page: Page): Promise<string> {
    const guestUrl = await getGuestUrl(page);
    await page.goto(guestUrl);
    // Gone from the page, not just faded (its short fade-out may still run).
    await expect(page.getByTestId("boot-intro")).toHaveCount(0, { timeout: 10_000 });
    await enterParty(page);
    return guestUrl;
  }

  test("a intro do logótipo bate e dá lugar à app", async ({ page }) => {
    const guestUrl = await getGuestUrl(page);
    // Watch from the first bytes: the splash plays while the page loads.
    await page.goto(guestUrl, { waitUntil: "commit" });
    await expect(page.getByTestId("boot-intro")).toBeVisible();
    await expect(page.getByTestId("boot-intro")).toBeHidden({ timeout: 10_000 });
    await enterParty(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("licitar em ≤ 4 toques, ser ultrapassado, subir e ser Vencedor; o DJ toca", async ({ page, browser, request }) => {
    const slotId = await openAuction(request, 600);
    await openGuest(page);
    let taps = 0;
    const tap = async (locator: ReturnType<Page["locator"]>) => {
      taps += 1;
      await locator.click();
    };

    // 1. "Licitar faixa" on the live auction (home).
    await tap(page.getByRole("button", { name: /^licitar faixa$|^bid a track$/i }));
    await expect(page).toHaveURL(/\/search$/);
    // 2. A track.
    await tap(page.getByRole("button").filter({ hasText: /^.*licitar$|bid$/i }).first());
    await expect(page).toHaveURL(/\/track\//);
    // "Público · @" is preselected with the @ picked at the front door: nothing to type.
    await expect(page.getByRole("button", { name: /público · @|public · @/i })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /o meu @|my @/i })).toHaveCount(0);
    // 3. Card, 4. "Licitar 2 €" (the minimum is preselected).
    await tap(page.getByRole("radio", { name: /cartão|card/i }));
    await tap(page.getByRole("button", { name: /^licitar \d|^bid \d/i }));
    await expect(page.getByText(/licitação feita|bid placed/i)).toBeVisible({ timeout: 15_000 });
    expect(taps).toBeLessThanOrEqual(4);

    await page.getByRole("button", { name: /^feito$|^done$/i }).click();
    await expect(page.getByText(/^vais à frente$|^you are in the lead$/i)).toBeVisible({ timeout: 15_000 });

    // Someone else outbids: the money goes back to the balance.
    const before = await auctionState(request);
    const top = before.open.find((s) => s.id === slotId)!;
    await bidViaApi(request, { slotId, totalCents: top.minNextCents });
    await expect(page.getByText(/foste ultrapassado|you were outbid/i).first()).toBeVisible({ timeout: 15_000 });
    // The balance shows up, small, top right.
    await expect(page.getByRole("button", { name: /^saldo|^balance/i })).toBeVisible();

    // Raise: the balance pays part, the card the rest.
    await page.getByRole("button", { name: /subir para|raise to/i }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText(/do saldo|from balance/i)).toBeVisible();
    await sheet.getByRole("radio", { name: /cartão|card/i }).click();
    await sheet.getByRole("button", { name: /^licitar|^bid/i }).click();
    await expect(sheet.getByText(/licitação feita|bid placed/i)).toBeVisible({ timeout: 15_000 });
    await sheet.getByRole("button", { name: /^feito$|^done$/i }).click();
    await expect(page.getByText(/^vais à frente$|^you are in the lead$/i)).toBeVisible({ timeout: 15_000 });

    // The auction closes: "Vencedor".
    await closeAuction(request, slotId);
    await expect(page.getByRole("dialog", { name: /vencedor|winner/i })).toBeVisible({ timeout: 20_000 });
    // "Partilhar no Instagram": the story image is theirs to share.
    await expect(page.getByRole("button", { name: /partilhar no instagram|share on instagram/i })).toBeVisible();
    const card = await page.request.get(`/api/guest/auction/${slotId}/card?format=story`);
    expect(card.ok()).toBeTruthy();
    expect(card.headers()["content-type"]).toContain("image/png");
    // The outbid toast sits over "Fechar" and pauses while the pointer rests
    // on it (it appeared under the last tap): move away and let it go first.
    await page.mouse.move(8, 8);
    await expect(page.getByText(/foste ultrapassado|you were outbid/i)).toHaveCount(0, { timeout: 15_000 });
    await page.getByRole("button", { name: /^fechar$|^close$/i }).click();

    // The DJ plays it; "As minhas licitações" says it played.
    const dj = await browser.newContext();
    try {
      const djPage = await dj.newPage();
      await loginStaff(djPage, "dj", "/cockpit");
      for (const action of ["accept", "playing", "played"]) {
        expect((await djPage.request.post(`/api/cockpit/auction/${slotId}`, { data: { action } })).ok()).toBeTruthy();
      }
    } finally {
      await dj.close();
    }
    await page.getByRole("navigation").getByRole("link", { name: /^agora$|^now$/i }).click();
    await page.getByRole("button", { name: /as minhas licitações|my bids/i }).click();
    await expect(page.getByText(/^tocou$|^played$/i).first()).toBeVisible({ timeout: 15_000 });

    // No gambling vocabulary anywhere (B1.7).
    const text = (await page.locator("body").innerText()).toLowerCase();
    expect(text).not.toMatch(/\b(aposta|apostar|odds|ganhar)\b/);
  });

  test("login: o mesmo número noutro telemóvel entra direto, com o mesmo @", async ({ page, browser }) => {
    const guestUrl = await getGuestUrl(page);
    await page.goto(guestUrl);
    const first = await enterParty(page);
    const mine = (await (await page.request.get("/api/guest/profile")).json()) as { handle: string | null };
    expect(mine.handle).toBe(first.handle);

    // Another phone: number + code, no @ to pick, same account.
    const other = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
    try {
      const page2 = await other.newPage();
      const ip = freshClientIp();
      await page2.route("**/api/guest/phone", (route) =>
        route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": ip } }),
      );
      await page2.goto(guestUrl);
      await page2.locator("#gate-phone").fill(first.digits);
      await page2.getByRole("button", { name: /enviar código|send code/i }).click();
      const dev = (await page2.getByText(/código de teste|test code/i).textContent({ timeout: 15_000 })) ?? "";
      await page2.getByRole("textbox", { name: /código de 6 dígitos|6-digit code/i }).fill(/\d{6}/.exec(dev)?.[0] ?? "");
      await expect(page2.getByRole("navigation")).toBeVisible({ timeout: 20_000 });
      await expect(page2.locator("#gate-handle")).toHaveCount(0);
      const theirs = (await (await page2.request.get("/api/guest/profile")).json()) as { handle: string | null };
      expect(theirs.handle).toBe(first.handle);
      // The @ chosen first is for good.
      const change = await page2.request.post("/api/guest/profile", { data: { handle: "outro-nome" } });
      expect(change.status()).toBe(409);
    } finally {
      await other.close();
    }
  });

  test("saldo: painel no canto superior direito, com as regras e Levantar", async ({ page }) => {
    await openGuest(page);
    const pill = page.getByRole("button", { name: /^saldo|^balance/i });
    await expect(pill).toBeVisible();
    await pill.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText(/^disponível$|^available$/i)).toBeVisible();
    await expect(sheet.getByText(/próximo leilão|next auction/i).first()).toBeVisible();
    await expect(sheet.getByRole("button", { name: /levantar saldo|withdraw balance/i })).toBeDisabled();
  });

  test("últimos 30 segundos: o ecrã pisca vermelho e branco", async ({ page, request }) => {
    await openAuction(request, 25);
    await openGuest(page);
    await expect(page.locator(".auction-flash-frame")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".auction-flash-card")).toBeVisible();
  });

  test("MB WAY recusado: nada cobrado, a licitação não entra", async ({ page, request }) => {
    await openAuction(request, 600);
    await openGuest(page);
    await page.getByRole("button", { name: /^licitar faixa$|^bid a track$/i }).click();
    // Wait for the search page: the home button also ends in "licitar".
    await expect(page).toHaveURL(/\/search$/, { timeout: 20_000 });
    await page.getByRole("button").filter({ hasText: /licitar$|bid$/i }).first().click();
    await expect(page.getByRole("button", { name: /público · @|public · @/i })).toBeVisible();
    await page.getByRole("radio", { name: /mb way/i }).click();
    await page.getByRole("textbox", { name: /mb way/i }).fill("912345678");
    await page.getByRole("button", { name: /^licitar \d|^bid \d/i }).click();
    await expect(page.getByText(/confirma na app mb way|confirm in the mb way app/i)).toBeVisible({ timeout: 15_000 });
    // The guest declines in the MB WAY app (the dev PSP delivers the signed webhook).
    const list = (await (await page.request.get("/api/dev/psp")).json()) as { payments: Array<{ paymentId: string; status: string }> };
    const pending = list.payments.find((p) => p.status === "pending")!;
    expect((await page.request.post("/api/dev/psp", { data: { paymentId: pending.paymentId, action: "decline" } })).ok()).toBeTruthy();
    await expect(page.getByText(/o pagamento não passou|did not go through/i)).toBeVisible({ timeout: 15_000 });
  });

  test("PT/EN: o convidado troca de língua", async ({ page }) => {
    await openGuest(page);
    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link", { name: "Leilão" })).toBeVisible();
    await page.getByRole("group", { name: /language/i }).getByRole("button", { name: "EN" }).click();
    await expect(nav.getByRole("link", { name: "Auction" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("group", { name: /language/i }).getByRole("button", { name: "PT" }).click();
    await expect(nav.getByRole("link", { name: "Leilão" })).toBeVisible({ timeout: 15_000 });
  });

  test("barra: Leilão ao centro e Ranking com pódio", async ({ page }) => {
    await openGuest(page);
    await page.getByRole("navigation").getByRole("link", { name: /^leilão$|^auction$/i }).click();
    await expect(page).toHaveURL(/\/auction$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /^leilão$|^auction$/i })).toBeVisible();
    await page.getByRole("navigation").getByRole("link", { name: /^ranking$/i }).click();
    await expect(page).toHaveURL(/\/top$/, { timeout: 20_000 });
    await expect(page.getByText(/quem mais gastou|top spenders|ainda ninguém|nobody is in/i).first()).toBeVisible();
  });

  test("QR inválido mostra erro amigável, sem CTA", async ({ page }) => {
    await page.goto("/s/not-a-real-token.aaaa");
    await expect(page.getByText(/este qr já não é válido|no longer valid/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /licitar faixa|bid a track/i })).toHaveCount(0);
  });

  test("axe: início e licitação sem violações graves", async ({ page, request }) => {
    await openAuction(request, 600);
    await openGuest(page);
    const home = await new AxeBuilder({ page }).analyze();
    expect(home.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);

    await page.getByRole("button", { name: /^licitar faixa$|^bid a track$/i }).click();
    // Wait for the search page: the home button also ends in "licitar".
    await expect(page).toHaveURL(/\/search$/, { timeout: 20_000 });
    await page.getByRole("button").filter({ hasText: /licitar$|bid$/i }).first().click();
    // A catalog track measures its BPM on first open (dev compiles too).
    await expect(page.getByRole("radiogroup").first()).toBeVisible({ timeout: 45_000 });
    const bid = await new AxeBuilder({ page }).analyze();
    expect(bid.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });

  test.describe("preferências do sistema (B10.6)", () => {
    test.use({ reducedMotion: "reduce" });

    test("reduced motion: nada anima e o fluxo continua inteiro", async ({ page, request }) => {
      await openAuction(request, 600);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openGuest(page);
      const animated = await page.evaluate(
        () => document.getAnimations().filter((a) => a.playState === "running").length,
      );
      expect(animated).toBe(0);
      await page.getByRole("button", { name: /licitar faixa|bid a track/i }).click();
      await expect(page).toHaveURL(/\/search$/);
    });
  });
});
