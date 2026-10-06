"use client";

/**
 * Client-side realtime subscription hook (BRIEF B11 "Tempo real").
 *
 * Clients only ever listen to server-published broadcasts — never to
 * table changes. Private channels (staff/guest) are authorized by the
 * RLS policies on `realtime.messages`; supabase-js attaches the current
 * auth session's access token to the socket automatically, and the hook
 * refreshes it defensively before each (re)subscribe.
 *
 * Reconnection: the hook resubscribes with exponential backoff + jitter
 * on CHANNEL_ERROR / TIMED_OUT / unexpected CLOSED, and reports a
 * connection state the cockpit uses for its offline indicator (B7).
 */

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { EventEnvelope } from "./events";

export type RealtimeConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline";

export interface UseRealtimeChannelOptions {
  /** Private channels require RLS authorization (staff/guest). */
  private: boolean;
  /** Backoff cap in ms (default 30s). */
  maxBackoffMs?: number;
  /** Attempts before reporting "offline" (keeps retrying regardless). */
  offlineAfterAttempts?: number;
  /**
   * Public channels only carry "something changed, refetch" hints, and on a
   * public channel ANY client can broadcast. Coalesces events so a flood of
   * fake hints costs at most one refetch per interval (the last one wins).
   */
  minIntervalMs?: number;
}

const DEFAULT_MAX_BACKOFF_MS = 30_000;
/** Public "refetch" hints: at most two refetches a second per screen. */
export const PUBLIC_HINT_MS = 500;
const DEFAULT_OFFLINE_AFTER = 4;

function backoffDelayMs(attempt: number, maxMs: number): number {
  const base = Math.min(maxMs, 1000 * 2 ** Math.min(attempt, 10));
  // Full jitter: avoids a thundering herd when a venue's Wi-Fi blips.
  return Math.floor(base / 2 + Math.random() * (base / 2));
}

/**
 * Subscribes to a broadcast channel and feeds every event envelope to
 * `onEvent`. Returns the connection state for UI indicators.
 *
 * `topic` may be null to idle the hook (e.g. before the session loads).
 * `onEvent` is kept in a ref — a new callback identity does NOT
 * resubscribe the socket.
 */
export function useRealtimeChannel(
  topic: string | null,
  options: UseRealtimeChannelOptions,
  onEvent: (envelope: EventEnvelope) => void,
): RealtimeConnectionState {
  const [state, setState] = useState<RealtimeConnectionState>(
    topic ? "connecting" : "offline",
  );

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const minIntervalMs = options.minIntervalMs ?? 0;

  const isPrivate = options.private;
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const offlineAfter = options.offlineAfterAttempts ?? DEFAULT_OFFLINE_AFTER;

  useEffect(() => {
    if (!topic) {
      setState("offline");
      return;
    }

    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let disposed = false;
    let lastDelivered = 0;
    let pending: EventEnvelope | null = null;
    let coalesceTimer: ReturnType<typeof setTimeout> | null = null;

    const deliver = (envelope: EventEnvelope) => {
      if (minIntervalMs <= 0) {
        onEventRef.current(envelope);
        return;
      }
      pending = envelope;
      if (coalesceTimer !== null) return;
      const wait = Math.max(0, lastDelivered + minIntervalMs - Date.now());
      coalesceTimer = setTimeout(() => {
        coalesceTimer = null;
        if (disposed || !pending) return;
        lastDelivered = Date.now();
        const next = pending;
        pending = null;
        onEventRef.current(next);
      }, wait);
    };

    setState("connecting");

    const teardownChannel = () => {
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    };

    const scheduleRetry = () => {
      if (disposed || retryTimer !== null) return;
      attempts += 1;
      setState(attempts >= offlineAfter ? "offline" : "reconnecting");
      retryTimer = setTimeout(() => {
        retryTimer = null;
        subscribe();
      }, backoffDelayMs(attempts, maxBackoffMs));
    };

    const subscribe = () => {
      if (disposed) return;
      teardownChannel();

      // The socket must carry the user's access token BEFORE joining a private
      // (RLS-authorized) channel; joining first fails and waits for a retry.
      void supabase.realtime
        .setAuth()
        .catch(() => undefined)
        .then(join);
    };

    const join = () => {
      if (disposed) return;
      channel = supabase
        .channel(topic, { config: { private: isPrivate } })
        .on("broadcast", { event: "*" }, (message) => {
          const envelope = message.payload as EventEnvelope | undefined;
          if (envelope && typeof envelope === "object" && "event" in envelope) {
            deliver(envelope);
          }
        })
        .subscribe((status) => {
          if (disposed) return;
          switch (status) {
            case "SUBSCRIBED":
              attempts = 0;
              setState("connected");
              break;
            case "CHANNEL_ERROR":
            case "TIMED_OUT":
            case "CLOSED":
              // CLOSED also fires on intentional teardown; `disposed`
              // was checked above, so any CLOSED here is unexpected.
              scheduleRetry();
              break;
          }
        });
    };

    subscribe();

    return () => {
      disposed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      if (coalesceTimer !== null) clearTimeout(coalesceTimer);
      teardownChannel();
    };
  }, [topic, isPrivate, maxBackoffMs, offlineAfter, minIntervalMs]);

  return state;
}
