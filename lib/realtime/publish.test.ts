import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/security/env", () => ({ env: {} }));

import { boardSessions } from "./publish";

const S1 = "dddddddd-0000-4000-8000-000000000001";
const S2 = "dddddddd-0000-4000-8000-000000000002";

describe("boardSessions", () => {
  it("one board per night whose auction changed, never for other events", () => {
    expect(
      boardSessions([
        { topic: `session:${S1}:public`, event: "auction.updated", payload: { slotId: "a" }, private: false },
        { topic: `session:${S1}:public`, event: "auction.updated", payload: { slotId: "b" }, private: false },
        { topic: `session:${S1}:staff`, event: "auction.updated", payload: {}, private: true },
        { topic: `session:${S2}:public`, event: "queue.changed", payload: {}, private: false },
        { topic: `guest:${S2}`, event: "auction.outbid", payload: {}, private: true },
      ]),
    ).toEqual([S1]);
  });
});
