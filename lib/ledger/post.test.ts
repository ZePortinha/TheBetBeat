import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { ACCOUNTS, type LedgerLine } from "./accounts";
import { captureGroup } from "./groups";

// post.ts is server-only; the marker package throws outside a server bundle.
vi.mock("server-only", () => ({}));
const { postLedgerGroup } = await import("./post");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fakeClient() {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  return { client: { query } as unknown as PoolClient, query };
}

describe("postLedgerGroup", () => {
  it("inserts every line under one fresh group_id and returns it", async () => {
    const { client, query } = fakeClient();
    const lines = captureGroup(1100, {
      venueId: "venue-1",
      sessionId: "session-1",
      requestId: "req-1",
      memo: "capture",
    });

    const groupId = await postLedgerGroup(client, lines);

    expect(groupId).toMatch(UUID_RE);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("insert into public.ledger_entries");
    expect(sql).toContain(
      "(group_id, account, venue_id, session_id, request_id, amount_cents, memo)",
    );
    // Fully parameterized: 7 placeholders per line, no inlined values.
    expect(sql).toContain("$14");
    expect(params).toHaveLength(14);
    expect(params.slice(0, 7)).toEqual([
      groupId,
      ACCOUNTS.pspClearing,
      "venue-1",
      "session-1",
      "req-1",
      1100,
      "capture",
    ]);
    expect(params.slice(7)).toEqual([
      groupId,
      ACCOUNTS.guestEscrow,
      "venue-1",
      "session-1",
      "req-1",
      -1100,
      "capture",
    ]);
  });

  it("maps missing meta to NULL columns", async () => {
    const { client, query } = fakeClient();
    await postLedgerGroup(client, captureGroup(500, {}));
    const [, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(params.slice(2, 5)).toEqual([null, null, null]);
    expect(params[6]).toBeNull();
  });

  it("generates a different group_id per call", async () => {
    const { client } = fakeClient();
    const a = await postLedgerGroup(client, captureGroup(100, {}));
    const b = await postLedgerGroup(client, captureGroup(100, {}));
    expect(a).not.toBe(b);
  });

  it("refuses an unbalanced group without touching the DB", async () => {
    const { client, query } = fakeClient();
    const unbalanced: LedgerLine[] = [
      { account: ACCOUNTS.pspClearing, amountCents: 500 },
      { account: ACCOUNTS.guestEscrow, amountCents: -400 },
    ];
    await expect(postLedgerGroup(client, unbalanced)).rejects.toThrow(/does not sum to zero/);
    expect(query).not.toHaveBeenCalled();
  });

  it("refuses an empty group", async () => {
    const { client, query } = fakeClient();
    await expect(postLedgerGroup(client, [])).rejects.toThrow(/empty ledger group/);
    expect(query).not.toHaveBeenCalled();
  });
});
