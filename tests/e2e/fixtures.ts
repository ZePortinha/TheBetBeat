/**
 * Shared E2E fixtures — mirrors supabase/seed.sql (fictional dev data).
 */
import type { Page } from "@playwright/test";

export const SEED = {
  venueId: "aaaaaaaa-0000-4000-8000-000000000001",
  venueName: "Club Meridiano",
  sessionId: "dddddddd-0000-4000-8000-000000000001",
  sessionName: "Noite Meridiano",
  displaySlug: "display-dev",
  zones: {
    pista: { id: "bbbbbbbb-0000-4000-8000-000000000001", qrSlug: "zone-pista-dev" },
    bar: { id: "bbbbbbbb-0000-4000-8000-000000000002", qrSlug: "zone-bar-dev" },
  },
  staff: {
    dj: { email: "dj.helix@betbeat.local", password: "betbeat-dev", name: "DJ Helix" },
    manager: { email: "manager@betbeat.local", password: "betbeat-dev" },
    admin: { email: "admin@betbeat.local", password: "betbeat-dev" },
  },
} as const;

/** Sign a dev QR token by asking the dev index page for its guest link. */
export async function getGuestUrl(page: Page): Promise<string> {
  await page.goto("/");
  const href = await page
    .locator('a[href^="/s/"]')
    .first()
    .getAttribute("href", { timeout: 10_000 });
  if (!href) throw new Error("Dev index has no guest link — is the DB seeded?");
  return href;
}

export async function loginStaff(
  page: Page,
  who: keyof typeof SEED.staff,
  next = "/cockpit",
): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByRole("textbox").first().fill(SEED.staff[who].email);
  await page.locator('input[type="password"]').fill(SEED.staff[who].password);
  await page.getByRole("button", { name: /entrar|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 15_000,
  });
}
