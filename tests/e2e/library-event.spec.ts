/**
 * 2026-10-11: the DJ's own library and the BPM of the songs being bid on
 * (cockpit, `ipad`), the event form with styles, BPM range and the
 * promoter split (console, `desktop`), and guests seeing the event's style
 * first (guest API, `phone`). The seeded night "Noite Meridiano" has the
 * styles house, afro house and deep house.
 */
import { expect, test } from "@playwright/test";
import {
  bidViaApi,
  getGuestPath,
  loginStaff,
  openAuction,
  SEED,
  signInGuest,
  tokenFromGuestPath,
} from "./fixtures";

const RUN = Date.now().toString(36);

// One test per staff login: the suite logs the DJ in many times and the
// login limit is 10 per account every 10 minutes.
test.describe("cockpit · biblioteca e BPM", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== "ipad", "iPad viewport only");
    test.setTimeout(120_000);
    await loginStaff(page, "dj", "/cockpit");
  });

  test("o DJ adiciona uma música, encontra-a por artista, álbum e estilo, e vê o BPM no leilão", async ({ page, request }) => {
    await page.goto("/cockpit/library");
    await expect(page.getByRole("heading", { name: /Biblioteca/ })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("library-summary")).toContainText("músicas");

    await page.getByRole("button", { name: "Adicionar música" }).click();
    const form = page.getByTestId("library-track-form");
    await form.locator('input[name="title"]').fill(`Cadência ${RUN}`);
    await form.locator('input[name="artist"]').fill(`Duque do Norte ${RUN}`);
    await form.locator('input[name="album"]').fill(`Esquina ${RUN}`);
    await form.locator('input[name="genre"]').fill("funk");
    await form.locator('input[name="bpm"]').fill("108");
    await form.locator('input[name="key"]').fill("2B");
    await form.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Música adicionada")).toBeVisible({ timeout: 15_000 });

    // Same song again: refused, the library never duplicates.
    await page.getByRole("button", { name: "Adicionar música" }).click();
    await form.locator('input[name="title"]').fill(`CADÊNCIA ${RUN}`);
    await form.locator('input[name="artist"]').fill(`Duque do Norte ${RUN}`);
    await form.locator('input[name="genre"]').fill("funk");
    await form.getByRole("button", { name: "Guardar" }).click();
    await expect(form.getByRole("alert")).toHaveText("Essa música já está na biblioteca");
    await page.keyboard.press("Escape");

    // Artists → tap the artist → their songs, with BPM and key.
    await page.getByRole("radio", { name: "Artistas" }).click();
    await page.getByPlaceholder("Procurar na biblioteca").fill(RUN);
    await page.getByTestId("library-groups").getByText(`Duque do Norte ${RUN}`).click();
    await expect(page.getByTestId("library-filter")).toHaveText(`Artista: Duque do Norte ${RUN}`);
    const row = page.getByTestId("library-tracks").getByRole("button", { name: new RegExp(`Cadência ${RUN}`) });
    await expect(row).toContainText("108 BPM · 2B");
    await expect(row).toContainText(`Esquina ${RUN}`);

    // Albums and styles list it too.
    await page.getByRole("radio", { name: "Álbuns" }).click();
    await expect(page.getByTestId("library-groups")).toContainText(`Esquina ${RUN}`);
    await page.getByRole("radio", { name: "Estilos" }).click();
    await page.getByPlaceholder("Procurar na biblioteca").fill("");
    await expect(page.getByTestId("library-groups")).toContainText("funk");

    // Edit, then remove it (never bid on: it is really deleted).
    await page.getByRole("radio", { name: "Músicas" }).click();
    await page.getByPlaceholder("Procurar na biblioteca").fill(RUN);
    await page.getByTestId("library-tracks").getByRole("button", { name: new RegExp(`Cadência ${RUN}`) }).click();
    await page.getByRole("button", { name: "Remover da biblioteca" }).click();
    await expect(page.getByText("Música removida")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Nada encontrado com estes filtros.")).toBeVisible();

    // Same login (staff logins are limited per account): the open auction
    // shows the BPM of the song that is winning.
    const slotId = await openAuction(request, 600);
    await bidViaApi(request, { slotId, totalCents: 700 });
    await page.goto("/cockpit");
    await expect(page.getByTestId("auction-tempo").first().getByTestId("contender-bpm").first()).toHaveText(
      /\d+ BPM|BPM a medir/,
      { timeout: 30_000 },
    );
  });
});

test.describe("console · criar evento", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "desktop viewport only");
    test.setTimeout(120_000);
    await loginStaff(page, "manager", "/console");
  });

  test("estilos, BPM e divisão com promotor: 11% fixos, o DJ fica com o resto", async ({ page }) => {
    await page.goto("/console/sessoes/nova");
    const form = page.getByTestId("session-form");
    await form.locator('input[name="name"]').fill(`Funk Night ${RUN}`);
    await form.locator('select[name="djStaffId"]').selectOption({ label: SEED.staff.dj.name });
    await form.locator('input[name="genres"][value="funk"]').check();
    await form.locator('input[name="customGenres"]').fill("funk carioca");
    await form.locator('input[name="bpmMin"]').fill("100");
    await form.locator('input[name="bpmMax"]').fill("130");

    const split = page.getByTestId("event-split");
    await expect(split).toContainText("Taxa Discontrol 11%");
    await form.locator('input[name="venueSharePct"]').fill("30");
    await form.locator('input[name="promoterSharePct"]').fill("20");
    await expect(page.getByTestId("dj-share")).toHaveText("50%");
    // 100 €: 11 € Discontrol, then 30% / 20% / 50% of 89 €.
    const example = page.getByTestId("split-example");
    await expect(example).toContainText("11,00");
    await expect(example).toContainText("26,70");
    await expect(example).toContainText("17,80");
    await expect(example).toContainText("44,50");

    // A promoter share needs a name; club + promoter over 100% is refused.
    const save = form.getByRole("button", { name: "Guardar sessão" });
    await expect(save).toBeDisabled();
    await form.locator('input[name="promoterName"]').fill("Promotora Lua Cheia");
    await form.locator('input[name="promoterSharePct"]').fill("80");
    await expect(page.getByText("Casa e promotor juntos não podem passar de 100%.")).toBeVisible();
    await form.locator('input[name="promoterSharePct"]').fill("20");
    await expect(save).toBeEnabled();
    await save.click();
    await page.waitForURL(/\/console\/sessoes\?created=/, { timeout: 20_000 });
    const created = new URL(page.url()).searchParams.get("created");

    // Everything kept on the event.
    await page.goto(`/console/sessoes/${created}`);
    await expect(form.locator('input[name="promoterName"]')).toHaveValue("Promotora Lua Cheia");
    await expect(form.locator('input[name="promoterSharePct"]')).toHaveValue("20");
    await expect(form.locator('input[name="bpmMin"]')).toHaveValue("100");
    await expect(form.locator('input[name="genres"][value="funk"]')).toBeChecked();
    await expect(form.locator('input[name="genres"][value="funk carioca"]')).toBeChecked();
  });

  test("Casas: a taxa Discontrol é fixa", async ({ page }) => {
    await page.context().clearCookies();
    await loginStaff(page, "admin", "/console/admin/casas");
    await page.goto("/console/admin/casas");
    await expect(page.getByText("11% (fixa)").first()).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("convidado · estilo da noite primeiro", () => {
  test("as recomendações começam pelo estilo do evento", async ({ request }) => {
    test.skip(test.info().project.name !== "phone", "phone only");
    const token = tokenFromGuestPath(await getGuestPath(request));
    const guest = await signInGuest(request);
    const res = await request.get(`/api/guest/search?${new URLSearchParams({ token })}`, {
      headers: { authorization: `Bearer ${guest.accessToken}` },
    });
    expect(res.ok()).toBe(true);
    const data = (await res.json()) as { sections: Array<{ key: string; tracks: Array<{ genre: string | null }> }> };
    expect(data.sections[0]?.key).toBe("style");
    // "Noite Meridiano": house, afro house, deep house.
    for (const t of data.sections[0]!.tracks) expect(t.genre?.toLowerCase()).toMatch(/house/);
  });
});
