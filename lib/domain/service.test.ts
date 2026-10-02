import { describe, expect, it, vi } from "vitest";

// The service layer is server-only; these unit tests cover the pure DTO
// mappers it publishes with (B12.4). The full orchestration paths run
// against the real local database in tests/integration (SUPABASE_TEST=1).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/security/env", () => ({
  env: { DATABASE_URL: "postgresql://unit:test@localhost:5432/unused" },
}));

const { toGuestRequestDto, toGuestRequestPayload, toPublicNowDto, toStaffRequestDto } =
  await import("./dto");
type RequestRow = import("./dto").RequestRow;

const NOW = 1_700_000_000_000;

function requestRow(overrides: Partial<RequestRow> = {}): RequestRow {
  return {
    id: "req-1",
    venue_id: "venue-1",
    session_id: "sess-1",
    zone_id: "zone-1",
    guest_id: "guest-1",
    quote_id: "quote-1",
    library_track_id: "lt-1",
    track_id: null,
    track_title: "Hidden Signal",
    track_artist: "Arco Verde",
    track_genre: "afro house",
    track_bpm: "123", // numeric comes back as a string from pg
    track_key: "8A",
    track_duration_sec: 360,
    cover_url: null,
    in_library: true,
    fit_score: "0.85",
    fit_label: "fits",
    tier: "SOON",
    amount_cents: 2500,
    status: "paid",
    close_reason: null,
    reject_reason: null,
    message: "parabéns Rita!",
    message_approved: false,
    pinned_next: false,
    sla_missed: false,
    original_tier: null,
    refunded_cents: 0,
    paid_at: new Date(NOW),
    accepted_at: null,
    playing_at: null,
    played_at: null,
    closed_at: null,
    deadline_at: new Date(NOW + 20 * 60_000),
    decision_deadline_at: new Date(NOW + 5 * 60_000),
    created_at: new Date(NOW - 1000),
    updated_at: new Date(NOW),
    ...overrides,
  };
}

describe("toStaffRequestDto", () => {
  const ctx = { betbeatFeeBps: 2000, venueShareBps: 5000, zoneName: "Pista" };

  it("builds the cockpit payload with the DJ share from computeSplit", () => {
    const dto = toStaffRequestDto(requestRow(), ctx);
    // 2500 − 20% fee = 2000; venue 50% = 1000; DJ gets the remainder.
    expect(dto.djShareCents).toBe(1000);
    expect(dto).toMatchObject({
      requestId: "req-1",
      tier: "SOON",
      status: "paid",
      amountCents: 2500,
      trackBpm: 123,
      fitScore: 0.85,
      zoneName: "Pista",
      pinnedNext: false,
      paidAt: new Date(NOW).toISOString(),
    });
  });

  it("never leaks guest PII fields", () => {
    const dto = toStaffRequestDto(requestRow(), ctx) as unknown as Record<string, unknown>;
    for (const key of ["guestId", "guest_id", "phone", "email", "phoneHash"]) {
      expect(dto).not.toHaveProperty(key);
    }
  });

  it("hides guest messages until the DJ approved them (B4.7)", () => {
    expect(toStaffRequestDto(requestRow(), ctx).message).toBeNull();
    expect(
      toStaffRequestDto(requestRow({ message_approved: true }), ctx).message,
    ).toBe("parabéns Rita!");
  });
});

describe("toGuestRequestDto / toGuestRequestPayload", () => {
  it("exposes the demotion only after an SLA miss", () => {
    const normal = toGuestRequestDto(requestRow());
    expect(normal.demotedFrom).toBeNull();

    const demoted = toGuestRequestDto(
      requestRow({
        tier: "QUEUE",
        sla_missed: true,
        original_tier: "SOON",
        amount_cents: 1100,
        refunded_cents: 1400,
      }),
    );
    expect(demoted.demotedFrom).toBe("SOON");
    expect(demoted.refundedCents).toBe(1400);
  });

  it("keeps the realtime payload minimal and matching the contract", () => {
    const payload = toGuestRequestPayload(requestRow());
    expect(payload).toEqual({
      requestId: "req-1",
      status: "paid",
      tier: "SOON",
      queuePosition: null,
      etaMin: null,
      refundedCents: 0,
      demotedFrom: null,
    });
  });
});

describe("toPublicNowDto", () => {
  it("is anonymous by default and converts bpm/startedAt", () => {
    const dto = toPublicNowDto(requestRow(), { handle: null, startedAtMs: NOW });
    expect(dto).toEqual({
      trackTitle: "Hidden Signal",
      trackArtist: "Arco Verde",
      handle: null,
      bpm: 123,
      startedAt: new Date(NOW).toISOString(),
    });
  });

  it("carries the handle only when the caller passed one (opt-in)", () => {
    expect(
      toPublicNowDto(requestRow(), { handle: "ritz", startedAtMs: NOW }).handle,
    ).toBe("ritz");
  });
});
