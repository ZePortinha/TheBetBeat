/**
 * Venue display E2E (BRIEF B8 / Phase 6).
 * Runs on the tv-landscape (1920×1080) and tv-portrait (1080×1920) projects.
 * The QR container carries data-testid="display-qr" + data-qr-url so the
 * integrator can decode the QR from a screenshot and verify the target.
 */
import { expect, test, type Page } from "@playwright/test";

const TV_PROJECTS = ["tv-landscape", "tv-portrait"];

test.describe("venue display", () => {
  test.beforeEach(() => {
    test.skip(
      !TV_PROJECTS.includes(test.info().project.name),
      "TV viewports only",
    );
  });

  /** Grab the correctly signed display link from the dev index page. */
  async function getDisplayPath(page: Page): Promise<string> {
    await page.goto("/");
    const href = await page
      .locator('a[href^="/display/"]')
      .first()
      .getAttribute("href", { timeout: 10_000 });
    if (!href) {
      throw new Error("Dev index has no display link — is the session live?");
    }
    return href;
  }

  test("renders now playing and a stable, decodable QR", async ({ page }) => {
    const path = await getDisplayPath(page);
    await page.goto(path);

    // QR: visible, ≥320px, stable region, encoded URL exposed for decoding.
    const qr = page.getByTestId("display-qr");
    await expect(qr).toBeVisible();
    const qrUrl = await qr.getAttribute("data-qr-url");
    expect(qrUrl).toMatch(/\/s\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    const qrImage = qr.locator("img");
    await expect(qrImage).toBeVisible();
    const box = await qrImage.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(320);
    expect(box!.height).toBeGreaterThanOrEqual(320);

    // Now playing headline is present and non-empty (seed plays a set).
    const nowTitle = page.getByTestId("display-now-title");
    await expect(nowTitle).toBeVisible();
    await expect(nowTitle).not.toBeEmpty();

    // Caption invites the guest to request a song.
    await expect(page.getByText("Pede a tua música")).toBeVisible();

    // Poll endpoint returns the same public DTO the page renders.
    const token = path.replace("/display/", "");
    const res = await page.request.get(`/api/display/${token}/state`);
    expect(res.ok()).toBeTruthy();
    const dto = (await res.json()) as {
      session: { name: string; live: boolean };
      qrUrl: string;
      now: { title: string } | null;
    };
    expect(dto.qrUrl).toBe(qrUrl);
    expect(dto.session.live).toBe(true);
    expect(dto.now?.title?.length ?? 0).toBeGreaterThan(0);
  });

  test("invalid token shows a friendly static error, no QR", async ({ page }) => {
    await page.goto("/display/not-a-real-token.aaaa");
    await expect(page.getByText("Este ecrã não está ligado")).toBeVisible();
    await expect(page.getByTestId("display-qr")).toHaveCount(0);

    const res = await page.request.get("/api/display/not-a-real-token.aaaa/state");
    expect(res.status()).toBe(404);
  });
});
