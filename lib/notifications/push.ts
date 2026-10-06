/**
 * Web push to guests: "someone outbid you" and "you are the winner" reach
 * the phone with the app closed. Rides on the auction broadcasts (same
 * events, same moment: after commit). Best-effort, never throws: realtime
 * and the screen stay the source of truth.
 *
 * Server env, db and web-push load lazily so the pure helpers below stay
 * importable in unit tests.
 */
import ptGuest from "@/messages/pt-PT/guest.json";
import enGuest from "@/messages/en/guest.json";

export type PushKind = "auction.outbid" | "auction.won";

export interface GuestPush {
  guestId: string;
  kind: PushKind;
  slotId: string;
}

/**
 * The server POSTs to whatever endpoint a browser registered, so only the
 * real push services are accepted (no SSRF through a forged subscription).
 */
const PUSH_HOSTS = ["fcm.googleapis.com", "push.apple.com", "push.services.mozilla.com", "notify.windows.com"];

export function isPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "") return false;
  return PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

/** Which of tonight's broadcasts also go out as a push (guest channel topics are `guest:<id>`). */
export function pushesFromBroadcasts(
  messages: Array<{ topic: string; event: string; payload: unknown }>,
): GuestPush[] {
  return messages.flatMap((m) => {
    if (m.event !== "auction.outbid" && m.event !== "auction.won") return [];
    if (!m.topic.startsWith("guest:")) return [];
    const slotId = (m.payload as { slotId?: unknown } | null)?.slotId;
    return [{ guestId: m.topic.slice("guest:".length), kind: m.event, slotId: typeof slotId === "string" ? slotId : "" }];
  });
}

export function pushText(locale: string, kind: PushKind): { title: string; body: string } {
  const copy = (locale.startsWith("en") ? enGuest : ptGuest).auction.push;
  return kind === "auction.outbid"
    ? { title: copy.outbidTitle, body: copy.outbidBody }
    : { title: copy.wonTitle, body: copy.wonBody };
}

/** Sends each push to every device the guest enabled; dead subscriptions are dropped. */
export async function sendGuestPushes(items: GuestPush[]): Promise<void> {
  if (items.length === 0) return;
  try {
    const { env } = await import("@/lib/security/env");
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
    const [{ getPool }, { default: webpush }] = await Promise.all([import("@/lib/db"), import("web-push")]);
    const subs = await getPool().query<{
      id: string;
      guest_id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
      url_path: string;
      locale: string;
    }>(
      `select s.id, s.guest_id, s.endpoint, s.p256dh, s.auth, s.url_path, g.locale
         from public.push_subscriptions s join public.guests g on g.id = s.guest_id
        where s.guest_id = any($1::uuid[])`,
      [[...new Set(items.map((i) => i.guestId))]],
    );
    const vapidDetails = {
      subject: env.VAPID_SUBJECT ?? "mailto:privacidade@betbeat.pt",
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    };
    await Promise.all(
      subs.rows.flatMap((sub) =>
        items
          .filter((item) => item.guestId === sub.guest_id)
          .map(async (item) => {
            const payload = JSON.stringify({ ...pushText(sub.locale, item.kind), url: sub.url_path, tag: `auction-${item.slotId}` });
            try {
              await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
                TTL: 300,
                urgency: "high",
                vapidDetails,
              });
            } catch (error) {
              const status = (error as { statusCode?: number }).statusCode;
              if (status === 404 || status === 410) {
                await getPool().query(`delete from public.push_subscriptions where id = $1`, [sub.id]);
              } else {
                console.error(`[push] send failed: HTTP ${status ?? "network"}`);
              }
            }
          }),
      ),
    );
  } catch (error) {
    console.error("[push] skipped:", (error as Error).message);
  }
}
