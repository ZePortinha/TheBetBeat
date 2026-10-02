"use client";

/**
 * Offline action queue (BRIEF B7 Fiabilidade): failed/offline cockpit
 * actions persist in localStorage and replay IN ORDER on reconnect. The
 * server stays the source of truth — after a replay the caller refetches
 * the full state and reconciles. Storage access is always wrapped: a
 * private tab or cleared site data must never crash the cockpit.
 */
import type { CockpitActionKind, QueuedAction } from "./types";

const STORAGE_KEY = "bb-cockpit-pending-actions";
const MAX_QUEUED = 100;

export function readQueue(): QueuedAction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a): a is QueuedAction =>
        typeof a === "object" &&
        a !== null &&
        typeof (a as QueuedAction).action === "string" &&
        typeof (a as QueuedAction).requestId === "string" &&
        typeof (a as QueuedAction).idemKey === "string",
    );
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedAction[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(-MAX_QUEUED)));
  } catch {
    // Storage unavailable — the action was still attempted online-first.
  }
}

export function enqueueAction(action: QueuedAction): void {
  const queue = readQueue();
  // One pending action per (request, kind): the newest wins.
  const rest = queue.filter(
    (a) => !(a.requestId === action.requestId && a.action === action.action),
  );
  rest.push(action);
  writeQueue(rest);
}

export function clearQueue(): void {
  writeQueue([]);
}

export function queuedCount(): number {
  return readQueue().length;
}

export function actionPath(action: CockpitActionKind, requestId: string): string {
  return `/api/cockpit/requests/${encodeURIComponent(requestId)}/${action}`;
}

/**
 * Replays the stored queue in order. Stops at the first NETWORK failure
 * (still offline) and keeps the remainder; HTTP errors (e.g. 409 — the
 * server already moved on) drop the action: the state refetch wins.
 * Returns how many actions were sent.
 */
export async function replayQueue(): Promise<number> {
  const queue = readQueue();
  if (queue.length === 0) return 0;
  let sent = 0;
  for (let i = 0; i < queue.length; i += 1) {
    const item = queue[i];
    if (!item) continue;
    try {
      await fetch(actionPath(item.action, item.requestId), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": item.idemKey,
        },
        body: JSON.stringify(item.body),
      });
      sent += 1;
    } catch {
      // Network still down: keep this one and everything after it.
      writeQueue(queue.slice(i));
      return sent;
    }
  }
  clearQueue();
  return sent;
}
