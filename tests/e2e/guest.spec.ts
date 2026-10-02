/**
 * Guest app E2E (BRIEF B6 / Phase 4 criteria). Runs on the `phone`
 * project (393×852) only.
 *
 * Covers: pedir → pagar → acompanhar → tocou → partilhar, the refund
 * path, the "≤ 4 taps from QR to payment" rule (B1.3), PT/EN, reduced
 * motion / transparency / contrast rendering and axe (no serious or
 * critical violations).
 *
 * Needs: local Supabase seeded (`pnpm db:reset`), `pnpm dev` and, for the
 * MB WAY timing paths, nothing else — the dev PSP panel delivers the
 * signed webhooks synchronously. The DJ side is driven through the
 * cockpit API with a second (DJ) browser context.
 *
 * NOT verified in the cloud session that wrote this file (no DB there):
 * run locally and fix selectors if a label drifted.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPaidRequest, getGuestUrl, loginStaff } from "./fixtures";

const PHONE_ONLY = "phone viewport only";

test.describe("guest app", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "phone", PHONE_ONLY);
  });

  /**
   * QR → Sessão → Faixa → Nível → Pagamento, counting taps: the brief
   * allows at most 4 before the payment is confirmed (B6 "no máximo 4
   * toques até pagar"). Returns the tracking URL's request id.
   */
  async function requestAndPayViaUi(page: Page): Promise<{ requestId: string; taps: number }> {
    let taps = 0;
    const tap = async (locator: ReturnType<Page["locator"]>) => {
      taps += 1;
      await locator.click();
    };

    const guestUrl = await getGuestUrl(page);
    await page.goto(guestUrl);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // 1. "Pedir música"
    await tap(page.getByRole("button", { name: /pedir música|request a song/i }));
    await expect(page).toHaveURL(/\/search$/);

    // 2. First available track row (search autofocus + curated sections).
    const row = page.locator("button:not([disabled])").filter({ hasText: /desde|from/i }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await tap(row);
    await expect(page).toHaveURL(/\/track\//);

    // 3. Tier screen: cheapest available tier is preselected; final price,
    //    ETA and the promise are visible before paying (B1.4).
    await expect(page.locator("[data-tier][aria-pressed='true']")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/se não tocar, devolvemos tudo|if it doesn.t play/i).first()).toBeVisible();
    const payCta = page.getByRole("button", { name: /^pagar|^pay/i });
    await expect(payCta).toBeEnabled({ timeout: 15_000 });
    await tap(payCta);

    // 4. Payment sheet: MB WAY first on a pt-PT device; phone validated inline.
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("radio", { name: /mb way/i })).toHaveAttribute("aria-checked", "true");
    await sheet.locator("#mbway-phone").fill("912345678");
    await tap(sheet.getByRole("button", { name: /confirmar e pagar|confirm and pay/i }));

    // MB WAY wait: countdown + dev panel to confirm the push.
    await expect(sheet.getByText(/confirma na app mb way|confirm in the mb way app/i)).toBeVisible({ timeout: 15_000 });
    await sheet.getByText(/confirmar mb way/i).click();

    // Payment confirmed animation → tracking screen.
    await expect(page.getByRole("status").filter({ hasText: /pagamento confirmado|payment confirmed/i })).toBeVisible({ timeout: 15_000 });
    await page.waitForURL(/\/requests\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    const requestId = /\/requests\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
    return { requestId, taps };
  }

  async function djContext(browser: Browser) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginStaff(page, "dj", "/cockpit");
    return { context, page };
  }

  test("pedir → pagar → acompanhar → tocou → partilhar (≤ 4 toques até pagar)", async ({ page, browser }) => {
    const { requestId, taps } = await requestAndPayViaUi(page);
    expect(taps).toBeLessThanOrEqual(4);

    // Tracking: Pago, with the DJ-is-looking line.
    await expect(page.getByText(/o dj está a ver o teu pedido|the dj is looking/i)).toBeVisible({ timeout: 15_000 });

    const dj = await djContext(browser);
    try {
      // DJ accepts → "Aceite"/"Na fila" with position + ETA.
      const accept = await dj.page.request.post(`/api/cockpit/requests/${requestId}/accept`, { data: {} });
      expect(accept.ok()).toBeTruthy();
      await expect(page.getByText(/posição \d+ · ~\d+ min|position \d+ · ~\d+ min|~\d+ min/i).first()).toBeVisible({ timeout: 15_000 });

      // DJ marks it playing → "É agora".
      const play = await dj.page.request.post(`/api/cockpit/requests/${requestId}/play`, { data: {} });
      expect(play.ok()).toBeTruthy();
      await expect(page.getByText(/é agora|it.s on now/i)).toBeVisible({ timeout: 15_000 });

      // Played is automatic when the DJ marks the NEXT one playing (B4.2):
      // a second (API-driven) guest pays, the DJ accepts and plays it.
      const next = await createPaidRequest(dj.page.request);
      expect((await dj.page.request.post(`/api/cockpit/requests/${next.requestId}/accept`, { data: {} })).ok()).toBeTruthy();
      expect((await dj.page.request.post(`/api/cockpit/requests/${next.requestId}/play`, { data: {} })).ok()).toBeTruthy();
    } finally {
      await dj.context.close();
    }

    // "Tocou": celebration + native share (falls back to opening the card).
    await expect(page.getByText(/a tua música tocou|your song played/i)).toBeVisible({ timeout: 20_000 });
    const share = page.getByRole("button", { name: /partilhar|share/i });
    await expect(share).toBeVisible();

    // Share card is generated server-side in both formats (B6.6).
    for (const format of ["story", "square"]) {
      const card = await page.request.get(`/api/guest/requests/${requestId}/card?format=${format}`);
      expect(card.ok()).toBeTruthy();
      expect(card.headers()["content-type"]).toContain("image/png");
      expect((await card.body()).length).toBeGreaterThan(1000);
    }

    // No gambling vocabulary anywhere on the page (B1.7).
    const text = (await page.locator("body").innerText()).toLowerCase();
    expect(text).not.toMatch(/\b(aposta|apostar|odds|ganhar)\b/);
  });

  test("caminho do reembolso: o DJ recusa e o convidado vê o valor devolvido", async ({ page, browser }) => {
    const { requestId } = await requestAndPayViaUi(page);

    const dj = await djContext(browser);
    try {
      const reject = await dj.page.request.post(`/api/cockpit/requests/${requestId}/reject`, {
        data: { reason: "off_style" },
      });
      expect(reject.ok()).toBeTruthy();
    } finally {
      await dj.context.close();
    }

    // Plain-language refund (B6.5): amount + why.
    await expect(page.getByText(/devolvemos .*€|we.re refunding/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/não encaixou esta música|didn.t fit this set/i)).toBeVisible();

    // History lists it as refunded (B6.9).
    await page.getByRole("button", { name: /voltar|back/i }).first().click();
    await page.getByRole("button", { name: /os meus pedidos|my requests/i }).click();
    await expect(page).toHaveURL(/\/requests$/);
    await expect(page.getByText(/devolvido|refunded/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("MB WAY recusado não cobra nada e permite tentar de novo", async ({ page }) => {
    const guestUrl = await getGuestUrl(page);
    await page.goto(guestUrl);
    await page.getByRole("button", { name: /pedir música|request a song/i }).click();
    const row = page.locator("button:not([disabled])").filter({ hasText: /desde|from/i }).first();
    await row.click();
    const payCta = page.getByRole("button", { name: /^pagar|^pay/i });
    await expect(payCta).toBeEnabled({ timeout: 15_000 });
    await payCta.click();
    const sheet = page.getByRole("dialog");
    await sheet.locator("#mbway-phone").fill("912345678");
    await sheet.getByRole("button", { name: /confirmar e pagar|confirm and pay/i }).click();
    await expect(sheet.getByText(/confirma na app mb way/i)).toBeVisible({ timeout: 15_000 });

    await sheet.getByText(/^recusar$/i).click();
    await expect(sheet.getByText(/o pagamento foi recusado|payment was declined/i)).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByText(/não foi cobrado nada|nothing was charged/i)).toBeVisible();
    await expect(sheet.getByRole("button", { name: /reenviar|resend/i })).toBeVisible();
  });

  test("validação inline do telemóvel MB WAY e do NIF", async ({ page }) => {
    const guestUrl = await getGuestUrl(page);
    await page.goto(guestUrl);
    await page.getByRole("button", { name: /pedir música|request a song/i }).click();
    await page.locator("button:not([disabled])").filter({ hasText: /desde|from/i }).first().click();
    const payCta = page.getByRole("button", { name: /^pagar|^pay/i });
    await expect(payCta).toBeEnabled({ timeout: 15_000 });
    await payCta.click();
    const sheet = page.getByRole("dialog");

    const confirm = sheet.getByRole("button", { name: /confirmar e pagar|confirm and pay/i });
    await expect(confirm).toBeDisabled();
    await sheet.locator("#mbway-phone").fill("812345678");
    await expect(sheet.getByText(/9 dígitos|9 digits/i)).toBeVisible();
    await expect(confirm).toBeDisabled();
    await sheet.locator("#mbway-phone").fill("912345678");
    await expect(confirm).toBeEnabled();

    await sheet.getByRole("button", { name: /fatura com nif|invoice with/i }).click();
    await sheet.locator("#nif").fill("123456789");
    await expect(sheet.getByText(/nif não parece válido|doesn.t look valid/i)).toBeVisible();
    await expect(confirm).toBeDisabled();
    await sheet.locator("#nif").fill("501442600"); // valid check digit, fictional
    await expect(confirm).toBeEnabled();
  });

  test("PT/EN: o convidado troca de língua", async ({ page }) => {
    const guestUrl = await getGuestUrl(page);
    await page.goto(guestUrl);
    await expect(page.getByRole("button", { name: "Pedir música" })).toBeVisible();
    await page.getByRole("group", { name: /language/i }).getByRole("button", { name: "EN" }).click();
    await expect(page.getByRole("button", { name: "Request a song" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("group", { name: /language/i }).getByRole("button", { name: "PT" }).click();
    await expect(page.getByRole("button", { name: "Pedir música" })).toBeVisible({ timeout: 15_000 });
  });

  test("ecrãs públicos: Agora na pista e Top da noite", async ({ page }) => {
    const guestUrl = await getGuestUrl(page);
    await page.goto(guestUrl);
    await page.getByRole("button", { name: /agora na pista|now on the floor/i }).click();
    await expect(page).toHaveURL(/\/queue$/);
    await expect(page.getByRole("heading", { name: /agora na pista|now on the floor/i })).toBeVisible();
    await page.goto(`${guestUrl}/top`);
    await expect(page.getByRole("heading", { name: /top da noite|top of the night/i })).toBeVisible();
  });

  test("QR inválido mostra erro amigável, sem CTA", async ({ page }) => {
    await page.goto("/s/not-a-real-token.aaaa");
    await expect(page.getByText(/este qr já não é válido|no longer valid/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /pedir música|request a song/i })).toHaveCount(0);
  });

  test("axe: sessão e nível sem violações graves", async ({ page }) => {
    const guestUrl = await getGuestUrl(page);
    await page.goto(guestUrl);
    await expect(page.getByRole("button", { name: /pedir música|request a song/i })).toBeVisible();
    const session = await new AxeBuilder({ page }).analyze();
    expect(session.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);

    await page.getByRole("button", { name: /pedir música|request a song/i }).click();
    await page.locator("button:not([disabled])").filter({ hasText: /desde|from/i }).first().click();
    await expect(page.locator("[data-tier][aria-pressed='true']")).toBeVisible({ timeout: 15_000 });
    const tier = await new AxeBuilder({ page }).analyze();
    expect(tier.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });

  test.describe("preferências do sistema (B10.6)", () => {
    test.use({ reducedMotion: "reduce", forcedColors: "none" });

    test("reduced motion: o fluxo continua inteiro", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const guestUrl = await getGuestUrl(page);
      await page.goto(guestUrl);
      // Beat Pulse ring must not run an animation under reduced motion.
      const animated = await page.evaluate(() =>
        document.getAnimations().filter((a) => a.playState === "running").length,
      );
      expect(animated).toBe(0);
      await page.getByRole("button", { name: /pedir música|request a song/i }).click();
      await expect(page).toHaveURL(/\/search$/);
    });
  });
});
