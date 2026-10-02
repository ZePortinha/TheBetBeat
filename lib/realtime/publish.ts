import "server-only";

/**
 * Server-side realtime publishing (BRIEF B11 "Tempo real").
 *
 * The server publishes PRE-FILTERED broadcasts; clients never subscribe
 * to table changes. Transport: Supabase Realtime's HTTP broadcast
 * endpoint (`POST /realtime/v1/api/broadcast`), the documented "Broadcast
 * from the server / REST" route. It was chosen over a server-side
 * supabase-js `channel().subscribe()` + `send()` because it is stateless
 * (no socket lifecycle to manage inside route handlers or the worker)
 * and authenticated with the service-role key, which is authorized to
 * write to the private staff/guest channels (RLS policies on
 * realtime.messages gate the SUBSCRIBERS, not this publisher).
 *
 * Publishing is strictly BEST-EFFORT and never throws: realtime is a
 * cache-invalidation hint on top of state that already committed to
 * Postgres. The domain service collects publishes during a transaction
 * and flushes them here AFTER COMMIT, so a broadcast can never announce
 * a state that rolled back.
 */

import { env } from "@/lib/security/env";
import type { RealtimeEvent } from "@/lib/domain/types";
import {
  guestChannel,
  publicChannel,
  staffChannel,
  type EventEnvelope,
  type GuestRequestPayload,
  type PublicNowPayload,
  type StaffRequestPayload,
} from "./events";

/** One broadcast message, ready for the HTTP endpoint. */
export interface OutgoingBroadcast {
  topic: string;
  event: RealtimeEvent;
  payload: unknown;
  private: boolean;
}

function endpoint(): string {
  return `${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "")}/realtime/v1/api/broadcast`;
}

function envelope(event: RealtimeEvent, payload: unknown, nowMs: number): EventEnvelope {
  return { event, payload, at: new Date(nowMs).toISOString() };
}

/**
 * Sends a batch of broadcasts in one HTTP call. Returns true when the
 * endpoint accepted them (HTTP 2xx). Failures are logged (no payload
 * contents — B12.4 "Sem fugas") and swallowed.
 */
export async function publishBroadcasts(
  messages: OutgoingBroadcast[],
  nowMs: number,
): Promise<boolean> {
  if (messages.length === 0) return true;
  try {
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: messages.map((m) => ({
          topic: m.topic,
          event: m.event,
          payload: envelope(m.event, m.payload, nowMs),
          private: m.private,
        })),
      }),
    });
    if (!response.ok) {
      console.error(
        `[realtime] broadcast rejected: HTTP ${response.status} (${messages.length} message(s))`,
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      `[realtime] broadcast failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return false;
  }
}

/** Single-message convenience over `publishBroadcasts`. */
export async function publishToChannel(
  topic: string,
  event: RealtimeEvent,
  payload: unknown,
  options: { private?: boolean; nowMs?: number } = {},
): Promise<boolean> {
  return publishBroadcasts(
    [{ topic, event, payload, private: options.private ?? true }],
    options.nowMs ?? Date.now(),
  );
}

/* ------------------------------------------------------------------ */
/* Channel helpers — payloads are built by lib/domain/dto.ts mappers   */
/* (explicit field lists; djShareCents via computeSplit).              */
/* ------------------------------------------------------------------ */

/** Private staff channel for a session (cockpit + console live views). */
export async function publishStaff(
  sessionId: string,
  event: RealtimeEvent,
  payload: StaffRequestPayload | { sessionId: string },
  nowMs: number,
): Promise<boolean> {
  return publishToChannel(staffChannel(sessionId), event, payload, {
    private: true,
    nowMs,
  });
}

/** Private per-guest channel — only the guest's own request state. */
export async function publishGuest(
  guestId: string,
  event: RealtimeEvent,
  payload: GuestRequestPayload,
  nowMs: number,
): Promise<boolean> {
  return publishToChannel(guestChannel(guestId), event, payload, {
    private: true,
    nowMs,
  });
}

/** Public session channel (venue display, "now on the floor"). */
export async function publishPublic(
  sessionId: string,
  event: RealtimeEvent,
  payload: PublicNowPayload | { sessionId: string },
  nowMs: number,
): Promise<boolean> {
  return publishToChannel(publicChannel(sessionId), event, payload, {
    private: false,
    nowMs,
  });
}
