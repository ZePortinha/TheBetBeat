/**
 * Guest flows the main guest spec does not walk through (2026-10-07). Runs
 * on the `phone` project (393×852) only.
 *
 * Covers: entering from the front door's "Eventos em direto" list, finding a
 * song by typing in the search and bidding on it, and backing the leading
 * song ("Apoiar esta faixa"), whose total grows while the leader stays.
 *
 * Needs: local Supabase seeded (`pnpm db:reset`) and `pnpm dev`. Auctions
 * are driven through the dev-only /api/dev/auction; payments through the
 * mock PSP (card at once).
 */
import { expect, test, type Page } from "@playwright/test";
import {
  auctionState,
  bidViaApi,
  getGuestPath,
  getGuestUrl,
  openAuction,
  searchTracks,
  signInAnonymousGuest,
  tokenFromGuestPath,
} from "./fixtures";

const PHONE_ONLY = "phone viewport only";

test.describe("guest app · outros fluxos", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "phone", PHONE_ONLY);
    // `pnpm dev` compiles each route on first use: the flows need headroom.
    test.setTimeout(120_000);
  });

  /** Gone from the page, not just faded (its short fade-out may still run). */
  async function introGone(page: Page) {
    await expect(page.getByTestId("boot-intro")).toHaveCount(0, { timeout: 10_000 });
  }

  /** Card is preselected only sometimes: pick it, then place the bid shown on the button. */
  async function payByCard(scope: Page | ReturnType<Page["getByRole"]>, button: RegExp) {
    await scope.getByRole("radio", { name: /cartão|card/i }).click();
    await scope.getByRole("button", { name: button }).click();
    await expect(scope.getByText(/licitação feita|bid placed/i)).toBeVisible({
      timeout: 15_000,
    });
    await scope.getByRole("button", { name: /^feito$|^done$/i }).click();
  }

  test("entrada: a lista de eventos em direto leva à festa", async ({
    page,
    request,
  }) => {
    await openAuction(request, 600);
    await page.goto("/");
    const live = page.getByRole("region", { name: /eventos em direto|live now/i });
    const event = live.getByRole("link").filter({ hasText: "Club Meridiano" }).first();
    await expect(event).toBeVisible();
    // The seeded night has an auction open: the list says so.
    await expect(event).toContainText(/leilão aberto|auction open/i);
    await event.click();
    await expect(page).toHaveURL(/\/s\/[^/]+$/, { timeout: 20_000 });
    await introGone(page);
    await expect(
      page.getByRole("button", { name: /^licitar faixa$|^bid a track$/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("pesquisa: escrever o título, abrir a faixa e licitar", async ({
    page,
    request,
  }) => {
    const slotId = await openAuction(request, 600);
    // A library song that can take a bid now, and a word of its title to type.
    const token = tokenFromGuestPath(await getGuestPath(request));
    const probe = await signInAnonymousGuest(request);
    const longestWord = (title: string) =>
      title.split(/\s+/).sort((a, b) => b.length - a.length)[0]!;
    const song = (await searchTracks(request, probe, token, "a")).find(
      (s) => s.available && s.source === "library",
    );
    expect(song, "the seeded library has a song that can take a bid").toBeTruthy();
    const word = longestWord(song!.title);

    await page.goto(await getGuestUrl(page));
    await introGone(page);
    await page.getByRole("button", { name: /^licitar faixa$|^bid a track$/i }).click();
    await expect(page).toHaveURL(/\/search$/, { timeout: 20_000 });
    await page.getByRole("searchbox").fill(word);
    const row = page
      .getByRole("button")
      .filter({ hasText: song!.title })
      .filter({ hasText: song!.artist })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    // (A long-lived dev DB can hold the same title + artist twice: any of them will do.)
    await expect(page).toHaveURL(/\/track\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(page.getByText(song!.title).first()).toBeVisible();

    await page.getByRole("button", { name: /^anónimo$|^anonymous$/i }).click();
    await payByCard(page, /^licitar \d|^bid \d/i);
    await expect(page.getByText(/^vais à frente$|^you are in the lead$/i)).toBeVisible({
      timeout: 15_000,
    });
    const top = (await auctionState(request)).open.find((s) => s.id === slotId)?.top;
    expect(top).toBeTruthy();
  });

  test("apoiar: somar à faixa de quem vai à frente", async ({ page, request }) => {
    const slotId = await openAuction(request, 600);
    await bidViaApi(request, { slotId, totalCents: 500, handle: "e2e_lider" });
    const before = (await auctionState(request)).open.find((s) => s.id === slotId)!.top!;

    await page.goto(await getGuestUrl(page));
    await introGone(page);
    await page.getByRole("button", { name: /^ver leilão$|^see the auction$/i }).click();
    await expect(page.getByText("@e2e_lider").first()).toBeVisible({ timeout: 15_000 });
    await page
      .getByRole("button", { name: /^apoiar esta faixa$|^back this track$/i })
      .click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await payByCard(sheet, /^apoiar com|^back with/i);

    // Same song, same leader, a bigger total; the backer is counted.
    await expect
      .poll(
        async () => (await auctionState(request)).open.find((s) => s.id === slotId)?.top,
        { timeout: 15_000 },
      )
      .toMatchObject({ bidId: before.bidId });
    const after = (await auctionState(request)).open.find((s) => s.id === slotId)!.top!;
    expect(after.totalCents).toBeGreaterThan(before.totalCents);
    await expect(page.getByText(/2 apoiantes|2 backers/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
