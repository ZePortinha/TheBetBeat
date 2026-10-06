/**
 * Venue / admin console E2E (BRIEF B9 / Phase 7 criterion). Runs on the
 * `desktop` project (1440×900) only.
 *
 * Phase 7 criterion — "criar sessão → gerar QR → sessão ao vivo → fechar
 * → ver receita e payout" — is covered without touching the seeded live
 * session ("Noite Meridiano" must stay live for the guest/cockpit/display
 * specs):
 *   1. the manager creates a NEW session and sees it listed (Agendada);
 *   2. creates a zone (its QR + signed link render), opens the print page
 *      and deletes the zone again;
 *   3. sees the seeded session live (Ao vivo, "Terminar sessão" available,
 *      Ecrã da Casa link);
 *   4. ends the NEW session through the cockpit API (the console's own
 *      "Terminar sessão" form posts the same domain call — a manager holds
 *      cockpit access), sees it as Terminada and opens its statement
 *      (receita + liquidações section).
 * The destructive variant — ending the seeded session from the console
 * button after a captured request, so payouts with amount > 0 appear —
 * is gated behind `E2E_END_SET=1`, exactly like the cockpit spec.
 *
 * NOT verified in the cloud session that wrote this file (no DB / browser
 * there): run locally with a seeded Supabase (`pnpm db:reset`) and
 * `pnpm dev`. Things to double-check on the first local run:
 *   - the session form's default date/times pass server validation in your
 *     timezone (the form defaults to today 23:00–04:00 Europe/Lisbon);
 *   - `createPaidRequest` + accept/play ordering in the gated test;
 *   - the MFA enrolment path in `loginStaff` needs SUPABASE_SERVICE_ROLE_KEY
 *     in `.env.local` when the manager/admin already enrolled TOTP.
 */
import { expect, test, type Page } from "@playwright/test";
import { createPaidRequest, loginStaff, SEED } from "./fixtures";

const DESKTOP_ONLY = "desktop viewport only";
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SIGNED_PATH_RE = /\/(s|display)\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function sessionRow(page: Page, sessionId: string) {
  return page.locator(`[data-testid="session-row"][data-session-id="${sessionId}"]`);
}

function zoneCard(page: Page, zoneName: string) {
  return page.locator(`[data-testid="zone-card"][data-zone-name="${zoneName}"]`);
}

/** Fills the "Nova sessão" form with valid defaults and returns the new id. */
async function createSession(page: Page, name: string): Promise<string> {
  await page.goto("/console/sessoes/nova");
  await expect(page.getByTestId("console-page-title")).toHaveText("Nova sessão");

  const form = page.getByTestId("session-form");
  await form.locator('input[name="name"]').fill(name);
  await form.locator('select[name="djStaffId"]').selectOption({ label: SEED.staff.dj.name });
  await form.locator('input[name="genres"][value="house"]').check();

  const save = form.getByRole("button", { name: "Guardar sessão" });
  await expect(save).toBeEnabled();
  await save.click();

  await page.waitForURL(/\/console\/sessoes\?created=/, { timeout: 20_000 });
  const created = new URL(page.url()).searchParams.get("created") ?? "";
  expect(created).toMatch(UUID_RE);
  return created;
}

test.describe("console · painel da casa", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", DESKTOP_ONLY);
  });

  test("manager lands on Sessões with the seeded session live", async ({ page }) => {
    await loginStaff(page, "manager", "/console");
    await expect(page).toHaveURL(/\/console\/sessoes$/);
    await expect(page.getByTestId("console-page-title")).toHaveText("Sessões");

    // Shell: translated landmarks, venue switcher scoped to the manager's venue.
    await expect(page.getByRole("navigation", { name: "Navegação da consola" })).toBeVisible();
    await expect(page.locator("#console-venue")).toHaveValue(SEED.venueId);
    await expect(page.getByText(SEED.staff.manager.name)).toBeVisible();
    // Managers never see the Admin BetBeat group.
    await expect(page.getByRole("link", { name: "Casas e contratos" })).toHaveCount(0);

    const live = sessionRow(page, SEED.sessionId);
    await expect(live).toBeVisible();
    await expect(live).toHaveAttribute("data-session-status", "live");
    await expect(live).toContainText(SEED.sessionName);
    await expect(live).toContainText("Ao vivo");
    await expect(live.getByTestId("session-end-button")).toBeVisible();
  });

  test("Phase 7: criar sessão → gerar QR → sessão ao vivo → fechar → receita e liquidações", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const stamp = Date.now().toString(36);
    const sessionName = `E2E Sessão ${stamp}`;
    const zoneName = `E2E Zona ${stamp}`;

    await loginStaff(page, "manager", "/console");

    /* 1. Create a session — it is listed as Agendada (the seed stays live). */
    const sessionId = await createSession(page, sessionName);
    const row = sessionRow(page, sessionId);
    await expect(row).toBeVisible();
    await expect(row).toContainText(sessionName);
    await expect(row).toContainText(SEED.staff.dj.name);
    await expect(row).toHaveAttribute("data-session-status", "scheduled");
    await expect(row).toContainText("Agendada");
    await expect(row.getByTestId("session-end-button")).toHaveCount(0);

    // Detail page: editable form + signed Ecrã da Casa link.
    await row.getByRole("link", { name: "Editar" }).click();
    await expect(page).toHaveURL(new RegExp(`/console/sessoes/${sessionId}$`));
    await expect(page.getByTestId("console-page-title")).toHaveText(sessionName);
    await expect(page.getByTestId("session-display-link")).toHaveText(SIGNED_PATH_RE);
    await expect(page.getByTestId("session-form").locator('input[name="name"]')).toHaveValue(
      sessionName,
    );

    /* 2. Zones & QR: create a zone, its QR + signed link render, print page. */
    await page.goto("/console/zonas");
    await expect(page.getByTestId("console-page-title")).toHaveText("Zonas e QR");
    for (const seeded of ["Pista", "Bar", "Mezzanine"]) {
      await expect(zoneCard(page, seeded)).toBeVisible();
    }

    await page.getByLabel("Nova zona").fill(zoneName);
    await page.getByRole("button", { name: "Criar zona" }).click();
    const card = zoneCard(page, zoneName);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByTestId("zone-link")).toHaveText(SIGNED_PATH_RE);
    const qr = card.getByRole("img", { name: `Código QR da zona ${zoneName}` });
    await expect(qr).toBeVisible({ timeout: 10_000 });
    await expect(qr).toHaveAttribute("src", /^data:image\/png/);
    await expect(card.getByRole("button", { name: "Copiar link" })).toBeVisible();

    // Ecrã da Casa links: one per non-ended session, the seeded one included.
    const displayLinks = page.getByTestId("display-link");
    await expect(displayLinks.first()).toBeVisible();
    await expect(
      page.locator(`[data-testid="display-link"][data-session-id="${SEED.sessionId}"]`),
    ).toContainText(SEED.sessionName);

    // Print page: one A5 card per zone with the QR, plus the print trigger.
    const printLink = page.getByTestId("zones-print-link");
    await expect(printLink).toHaveAttribute("href", "/console/zonas/imprimir");
    await printLink.click();
    await expect(page).toHaveURL(/\/console\/zonas\/imprimir$/);
    await expect(page.getByTestId("console-page-title")).toHaveText("Imprimir QR das zonas");
    await expect(page.getByRole("button", { name: "Imprimir" })).toBeVisible();
    const printCard = page.locator(
      `[data-testid="zone-print-card"][data-zone-name="${zoneName}"]`,
    );
    await expect(printCard).toBeVisible();
    await expect(printCard).toContainText(`${SEED.venueName} · ${zoneName}`);
    await expect(printCard).toContainText("Pede a tua música ao DJ");
    await expect(
      printCard.getByRole("img", { name: `Código QR da zona ${zoneName}` }),
    ).toBeVisible({ timeout: 10_000 });
    expect(await page.getByTestId("zone-print-card").count()).toBeGreaterThanOrEqual(4);

    // Clean up the zone (no requests reference it, so the delete succeeds).
    await page.goto("/console/zonas");
    await zoneCard(page, zoneName)
      .getByRole("button", { name: `Apagar a zona ${zoneName}` })
      .click();
    await expect(zoneCard(page, zoneName)).toHaveCount(0, { timeout: 15_000 });

    /* 3. The seeded session is live: Ao vivo chip, end control, display link. */
    await page.goto(`/console/sessoes/${SEED.sessionId}`);
    await expect(page.getByTestId("console-page-title")).toHaveText(SEED.sessionName);
    await expect(page.getByText("Ao vivo", { exact: true })).toBeVisible();
    await expect(page.getByTestId("session-end-button")).toBeVisible();
    await expect(page.getByTestId("session-display-link")).toHaveText(/\/display\//);

    /* 4. Close the NEW session (same domain call as the console button) and
          read its statement. */
    const end = await page.request.post("/api/cockpit/session/end", {
      data: { sessionId },
    });
    expect(end.ok()).toBeTruthy();
    const ended = (await end.json()) as {
      ok: boolean;
      alreadyEnded: boolean;
      statement: { gmv: number; venueNet: number; djNet: number };
    };
    expect(ended.ok).toBe(true);
    expect(ended.alreadyEnded).toBe(false);
    expect(ended.statement.gmv).toBe(0);

    await page.goto("/console/sessoes");
    await expect(row).toHaveAttribute("data-session-status", "ended");
    await expect(row).toContainText("Terminada");
    await expect(row.getByTestId("session-end-button")).toHaveCount(0);
    await row.getByRole("link", { name: "Ver" }).click();
    await expect(page.getByText("Esta sessão terminou. Os dados ficam só de leitura.")).toBeVisible();

    await page.getByTestId("session-statement-link").click();
    await expect(page).toHaveURL(new RegExp(`/console/receita/${sessionId}$`));
    await expect(page.getByTestId("console-page-title")).toHaveText(sessionName);
    await expect(page.getByText("Terminada")).toBeVisible();
    await expect(page.getByTestId("statement-gmv-value")).toHaveText("0 €");
    await expect(page.getByTestId("statement-venue-net-value")).toHaveText("0 €");
    await expect(page.getByTestId("statement-dj-net-value")).toHaveText("0 €");
    await expect(page.getByTestId("statement-requests-total-value")).toHaveText("0");
    // A session without captured revenue creates no payout rows (B4.5):
    // the liquidações section states it instead of showing amounts.
    await expect(page.getByTestId("statement-payouts")).toBeVisible();
    await expect(page.getByTestId("statement-payouts-empty")).toBeVisible();

    // Receita overview lists the closed session with its statement link.
    await page.goto("/console/receita");
    await expect(page.getByTestId("console-page-title")).toHaveText("Receita");
    await expect(page.getByTestId("revenue-gmv-value")).toContainText("€");
    const revenueRow = page.locator(
      `[data-testid="revenue-session-row"][data-session-id="${sessionId}"]`,
    );
    await expect(revenueRow).toContainText(sessionName);
    await expect(revenueRow.getByRole("link", { name: "Ver extrato" })).toHaveAttribute(
      "href",
      `/console/receita/${sessionId}`,
    );
  });

  test("Receita: the seeded live session has a statement with ledger-derived numbers", async ({
    page,
  }) => {
    await loginStaff(page, "manager", "/console/receita");
    await expect(page.getByTestId("console-page-title")).toHaveText("Receita");
    for (const id of ["revenue-gmv-value", "revenue-venue-net-value"]) {
      await expect(page.getByTestId(id)).toContainText("€");
    }
    const seededRow = page.locator(
      `[data-testid="revenue-session-row"][data-session-id="${SEED.sessionId}"]`,
    );
    await expect(seededRow).toContainText(SEED.sessionName);
    await seededRow.getByRole("link", { name: "Ver extrato" }).click();

    await expect(page).toHaveURL(new RegExp(`/console/receita/${SEED.sessionId}$`));
    await expect(page.getByTestId("console-page-title")).toHaveText(SEED.sessionName);
    await expect(page.getByText("Ao vivo")).toBeVisible();
    for (const id of [
      "statement-gmv-value",
      "statement-venue-net-value",
      "statement-dj-net-value",
      "statement-betbeat-fee-value",
      "statement-refunds-value",
    ]) {
      await expect(page.getByTestId(id)).toContainText("€");
    }
    await expect(page.getByTestId("statement-payouts")).toBeVisible();
  });

  test("every venue page renders its translated title", async ({ page }) => {
    await loginStaff(page, "manager", "/console");
    const pages: Array<[string, string]> = [
      ["/console/sessoes", "Sessões"],
      ["/console/zonas", "Zonas e QR"],
      ["/console/precos", "Preços"],
      ["/console/equipa", "Equipa"],
      ["/console/receita", "Receita"],
      ["/console/analise", "Análise"],
    ];
    for (const [path, title] of pages) {
      await page.goto(path);
      await expect(page.getByTestId("console-page-title")).toHaveText(title);
      await expect(page.getByRole("link", { name: title, exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
    // Equipa lists the seeded manager as "(tu)" and the DJs (the sidebar
    // also shows the manager's name, hence the table scope).
    await page.goto("/console/equipa");
    const team = page.locator("table");
    await expect(team.getByText(SEED.staff.manager.name)).toBeVisible();
    await expect(team.getByText("(tu)")).toBeVisible();
    await expect(team.getByText(SEED.staff.dj.name)).toBeVisible();
    // Preços: the simulator computes client-side from lib/pricing.
    await page.goto("/console/precos");
    await expect(page.getByRole("img", { name: "Evolução dos preços por nível" })).toBeVisible();
    await expect(page.getByText("Como se chega ao preço")).toBeVisible({ timeout: 10_000 });
  });

  test("Terminar sessão from the console closes the seeded session and creates payouts", async ({
    page,
    request,
  }) => {
    test.skip(
      process.env.E2E_END_SET !== "1",
      "destructive: ends the seeded live session (set E2E_END_SET=1 and run last)",
    );
    test.setTimeout(120_000);

    // Captured revenue first: two paid requests, both marked playing — the
    // second `play` closes the first as `played` (B4.2), so the ledger
    // holds a capture and the end-of-set payouts have amount > 0.
    const first = await createPaidRequest(request);
    const second = await createPaidRequest(request, { guest: first.guest });

    await loginStaff(page, "manager", `/console/sessoes/${SEED.sessionId}`);
    for (const paid of [first, second]) {
      const accept = await page.request.post(`/api/cockpit/requests/${paid.requestId}/accept`, {
        data: {},
      });
      expect(accept.ok()).toBeTruthy();
      const play = await page.request.post(`/api/cockpit/requests/${paid.requestId}/play`, {
        data: {},
      });
      expect(play.ok()).toBeTruthy();
    }

    await page.getByTestId("session-end-button").click();
    await page.waitForURL(/\/console\/sessoes\?ended=1$/, { timeout: 30_000 });
    const row = sessionRow(page, SEED.sessionId);
    await expect(row).toHaveAttribute("data-session-status", "ended");
    await expect(row).toContainText("Terminada");

    await page.goto(`/console/receita/${SEED.sessionId}`);
    await expect(page.getByTestId("statement-gmv-value")).not.toHaveText("0 €");
    const payouts = page.getByTestId("statement-payout");
    await expect(payouts.first()).toBeVisible();
    await expect(payouts.filter({ hasText: "Casa" })).toContainText("Pendente");
    await expect(page.locator('[data-testid="statement-payout"][data-recipient="dj"]')).toHaveCount(
      1,
    );

    await page.goto("/console/receita");
    await expect(page.getByTestId("revenue-payout").first()).toContainText(SEED.sessionName);
  });
});

test.describe("console · admin gates", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", DESKTOP_ONLY);
  });

  test("a manager is sent away from Admin BetBeat pages", async ({ page }) => {
    await loginStaff(page, "manager", "/console");
    for (const path of [
      "/console/admin/casas",
      "/console/admin/sessoes",
      "/console/admin/falhas",
      "/console/admin/reconciliacao",
      "/console/admin/flags",
      "/console/admin/auditoria",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login\?next=.*&error=forbidden/);
      await expect(page.getByText("A tua conta não tem acesso a esta área.")).toBeVisible();
    }
  });

  test("a platform admin reaches Casas e contratos", async ({ page }) => {
    await loginStaff(page, "admin", "/console/admin/casas");
    await expect(page).toHaveURL(/\/console\/admin\/casas$/);
    await expect(page.getByTestId("console-page-title")).toHaveText("Casas e contratos");
    await expect(page.getByRole("navigation", { name: "Navegação da consola" })).toContainText(
      "Admin BetBeat",
    );
    // The venue switcher also lists the venue name, hence the table scope.
    const venues = page.locator("table");
    await expect(venues.getByText(SEED.venueName)).toBeVisible();
    await expect(venues.getByText("club-meridiano")).toBeVisible();
    await expect(page.getByRole("button", { name: "Criar casa" })).toBeVisible();

    // The other admin pages open for the platform admin too.
    await page.goto("/console/admin/sessoes");
    await expect(page.getByTestId("console-page-title")).toHaveText("Sessões ao vivo");
    await expect(page.locator("table").getByText(SEED.sessionName)).toBeVisible();
    await page.goto("/console/admin/auditoria");
    await expect(page.getByTestId("console-page-title")).toHaveText("Auditoria");
    await expect(page.getByRole("button", { name: "Filtrar" })).toBeVisible();
  });
});
