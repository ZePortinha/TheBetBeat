import { describe, expect, it, vi } from "vitest";
import { isPushEndpoint, pushesFromBroadcasts, pushText, sendGuestPushes } from "./push";

const sent: Array<{ endpoint: string; payload: string }> = [];
const queries: Array<{ sql: string; params: unknown[] }> = [];
vi.mock("@/lib/security/env", () => ({
  env: { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:t@betbeat.test" },
}));
vi.mock("@/lib/db", () => ({
  getPool: () => ({
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return {
        rows: sql.startsWith("select")
          ? [
              { id: "sub-live", guest_id: "g1", endpoint: "https://fcm.googleapis.com/live", p256dh: "k", auth: "a", url_path: "/s/tok", locale: "pt-PT" },
              { id: "sub-dead", guest_id: "g1", endpoint: "https://fcm.googleapis.com/dead", p256dh: "k", auth: "a", url_path: "/s/tok", locale: "pt-PT" },
            ]
          : [],
      };
    },
  }),
}));
vi.mock("web-push", () => ({
  default: {
    sendNotification: async (sub: { endpoint: string }, payload: string) => {
      if (sub.endpoint.endsWith("/dead")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      sent.push({ endpoint: sub.endpoint, payload });
    },
  },
}));

describe("web push", () => {
  it("accepts only the real push services as endpoints", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/QGx")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isPushEndpoint("https://wns2-db5p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isPushEndpoint("https://evilfcm.googleapis.com.attacker.test/x")).toBe(false);
    expect(isPushEndpoint("https://localhost/x")).toBe(false);
    expect(isPushEndpoint("not a url")).toBe(false);
  });

  it("pushes only the outbid and winner notices, to the guest of the channel", () => {
    const pushes = pushesFromBroadcasts([
      { topic: "guest:g1", event: "auction.outbid", payload: { slotId: "s1" } },
      { topic: "guest:g2", event: "auction.won", payload: { slotId: "s1" } },
      { topic: "guest:g1", event: "wallet.changed", payload: {} },
      { topic: "public:sess", event: "auction.updated", payload: { slotId: "s1" } },
    ]);
    expect(pushes).toEqual([
      { guestId: "g1", kind: "auction.outbid", slotId: "s1" },
      { guestId: "g2", kind: "auction.won", slotId: "s1" },
    ]);
  });

  it("speaks the guest's language", () => {
    expect(pushText("pt-PT", "auction.outbid").title).toBe("Passaram-te à frente");
    expect(pushText("en", "auction.won").title).toBe("You're the Winner");
  });
});

describe("sending", () => {
  it("notifies every device of the guest and drops the ones the push service says are gone", async () => {
    await sendGuestPushes([{ guestId: "g1", kind: "auction.outbid", slotId: "s1" }]);
    expect(sent).toEqual([
      {
        endpoint: "https://fcm.googleapis.com/live",
        payload: JSON.stringify({ title: "Passaram-te à frente", body: pushText("pt-PT", "auction.outbid").body, url: "/s/tok", tag: "auction-s1" }),
      },
    ]);
    expect(queries.find((q) => q.sql.startsWith("delete"))?.params).toEqual(["sub-dead"]);
  });
});
