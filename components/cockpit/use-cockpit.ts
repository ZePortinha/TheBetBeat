"use client";

/**
 * The cockpit's client brain (BRIEF B7).
 *
 * - Full state from GET /api/cockpit/state (server = source of truth).
 * - Realtime deltas from the private staff channel (B11): payloads are
 *   upserted locally; queue.changed/price.changed trigger a debounced
 *   refetch; sound + toast + card entry fire in the SAME handler tick.
 * - Optimistic actions with rollback (accept/pin/play) and a 5 s undo
 *   window for reject/cancel: the server call is sent ONLY when the
 *   window closes (timer, flushed with keepalive fetch on pagehide).
 * - Offline (B7 Fiabilidade): network-failed actions queue in
 *   localStorage, replay in order on reconnect, then the UI reconciles
 *   from a full state refetch. Deadlines only expire server-side — the
 *   rings here are display only.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import type { RejectReason, Tier } from "@/lib/domain/types";
import { groupByTier } from "@/lib/domain/ordering";
import { staffChannel, type EventEnvelope, type StaffRequestPayload } from "@/lib/realtime/events";
import { useRealtimeChannel, type RealtimeConnectionState } from "@/lib/realtime/client";
import { useToast } from "@/components/ui/toast";
import { formatEurosDisplay } from "./format";
import {
  actionPath,
  enqueueAction,
  queuedCount,
  replayQueue,
} from "./offline-queue";
import { playTierAlert } from "./sounds";
import type {
  CockpitActionKind,
  CockpitNowPlaying,
  CockpitState,
  FeedEntry,
} from "./types";

const UNDO_WINDOW_MS = 5000;
const FEED_LIMIT = 24;

interface PendingUndo {
  kind: "reject" | "cancel";
  reason: RejectReason | null;
  snapshot: StaffRequestPayload;
  idemKey: string;
  timer: ReturnType<typeof setTimeout>;
}

export interface UseCockpitResult {
  state: CockpitState | null;
  loading: boolean;
  connection: RealtimeConnectionState;
  online: boolean;
  queuedOffline: number;
  feed: FeedEntry[];
  /** Request ids that just arrived (drive the 2-pulse gold glow). */
  newIds: ReadonlySet<string>;
  /** Visible requests (pending-undo cards removed). */
  requests: StaffRequestPayload[];
  decide: StaffRequestPayload[];
  queuedGroups: Record<Tier, StaffRequestPayload[]>;
  pinned: StaffRequestPayload | null;
  /** What "Marcar a tocar" acts on: the pinned request or top of queue. */
  playTarget: StaffRequestPayload | null;
  refetch: () => void;
  accept: (id: string) => void;
  reject: (id: string, reason: RejectReason) => void;
  cancel: (id: string, reason: RejectReason) => void;
  undo: (id: string) => void;
  pin: (id: string, pinned: boolean) => void;
  play: (id: string) => void;
  setRequestsOpen: (open: boolean) => void;
}

function orderable(r: StaffRequestPayload) {
  return {
    id: r.requestId,
    tier: r.tier,
    amountCents: r.amountCents,
    paidAt: r.paidAt ?? "1970-01-01T00:00:00.000Z",
    deadlineAt: r.deadlineAt,
  };
}

export function useCockpit(initialSessionId: string | null): UseCockpitResult {
  const t = useTranslations("cockpit");
  const { toast } = useToast();

  const [state, setState] = React.useState<CockpitState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [online, setOnline] = React.useState(true);
  const [queuedOffline, setQueuedOffline] = React.useState(0);
  const [feed, setFeed] = React.useState<FeedEntry[]>([]);
  const [newIds, setNewIds] = React.useState<Set<string>>(new Set());
  const [hiddenIds, setHiddenIds] = React.useState<Set<string>>(new Set());

  const pendingUndoRef = React.useRef<Map<string, PendingUndo>>(new Map());
  const refetchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const sessionId = state?.session?.id ?? initialSessionId;

  /* ---------------------------------------------------------------- */
  /* Fetching                                                          */
  /* ---------------------------------------------------------------- */

  const refetch = React.useCallback(() => {
    const url = sessionId
      ? `/api/cockpit/state?sessionId=${encodeURIComponent(sessionId)}`
      : "/api/cockpit/state";
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`state ${res.status}`);
        const data = (await res.json()) as CockpitState;
        setState(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [sessionId]);

  React.useEffect(() => {
    refetch();
  }, [refetch]);

  const scheduleRefetch = React.useCallback(() => {
    if (refetchTimer.current !== null) return;
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      refetch();
    }, 400);
  }, [refetch]);

  React.useEffect(
    () => () => {
      if (refetchTimer.current !== null) clearTimeout(refetchTimer.current);
    },
    [],
  );

  /* ---------------------------------------------------------------- */
  /* Online / offline + replay                                         */
  /* ---------------------------------------------------------------- */

  React.useEffect(() => {
    setOnline(navigator.onLine);
    setQueuedOffline(queuedCount());
    const replay = () => {
      setOnline(true);
      void replayQueue().then((sent) => {
        setQueuedOffline(queuedCount());
        if (sent > 0) {
          toast({ title: t("offline.replayed"), variant: "success" });
          refetch();
        }
      });
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", replay);
    window.addEventListener("offline", onOffline);
    // Try once on mount too (a previous session may have left a queue).
    if (navigator.onLine && queuedCount() > 0) replay();
    return () => {
      window.removeEventListener("online", replay);
      window.removeEventListener("offline", onOffline);
    };
  }, [refetch, t, toast]);

  /* ---------------------------------------------------------------- */
  /* Local mutations                                                   */
  /* ---------------------------------------------------------------- */

  const upsertRequest = React.useCallback((payload: StaffRequestPayload) => {
    setState((prev) => {
      if (!prev) return prev;
      const exists = prev.requests.some((r) => r.requestId === payload.requestId);
      const active =
        payload.status === "paid" ||
        payload.status === "accepted" ||
        payload.status === "playing";
      const requests = active
        ? exists
          ? prev.requests.map((r) => (r.requestId === payload.requestId ? payload : r))
          : [...prev.requests, payload]
        : prev.requests.filter((r) => r.requestId !== payload.requestId);
      return { ...prev, requests };
    });
  }, []);

  const patchRequest = React.useCallback(
    (id: string, patch: Partial<StaffRequestPayload>) => {
      setState((prev) =>
        prev
          ? {
              ...prev,
              requests: prev.requests.map((r) =>
                r.requestId === id ? { ...r, ...patch } : r,
              ),
            }
          : prev,
      );
    },
    [],
  );

  const removeRequest = React.useCallback((id: string) => {
    setState((prev) =>
      prev
        ? { ...prev, requests: prev.requests.filter((r) => r.requestId !== id) }
        : prev,
    );
  }, []);

  const restoreRequest = React.useCallback((snapshot: StaffRequestPayload) => {
    setState((prev) => {
      if (!prev) return prev;
      if (prev.requests.some((r) => r.requestId === snapshot.requestId)) return prev;
      return { ...prev, requests: [...prev.requests, snapshot] };
    });
  }, []);

  const pushFeed = React.useCallback((entry: FeedEntry) => {
    setFeed((prev) => [entry, ...prev].slice(0, FEED_LIMIT));
  }, []);

  /* ---------------------------------------------------------------- */
  /* Realtime                                                          */
  /* ---------------------------------------------------------------- */

  const handleEnvelope = React.useCallback(
    (envelope: EventEnvelope) => {
      const { event, payload, at } = envelope;
      if (event === "queue.changed" || event === "price.changed") {
        scheduleRefetch();
        return;
      }
      if (event === "session.paused") {
        const p = payload as { requestsOpen?: boolean };
        setState((prev) =>
          prev && prev.session
            ? {
                ...prev,
                session: { ...prev.session, requestsOpen: p.requestsOpen ?? false },
              }
            : prev,
        );
        return;
      }
      if (event === "session.ended") {
        scheduleRefetch();
        return;
      }

      const r = payload as StaffRequestPayload;
      if (!r || typeof r.requestId !== "string") return;
      const track = r.trackTitle;

      switch (event) {
        case "request.paid": {
          // Sound + toast + card entry on the SAME tick (B10.7).
          upsertRequest(r);
          setNewIds((prev) => new Set(prev).add(r.requestId));
          setTimeout(
            () =>
              setNewIds((prev) => {
                const next = new Set(prev);
                next.delete(r.requestId);
                return next;
              }),
            2400,
          );
          playTierAlert(r.tier);
          pushFeed({
            id: `${r.requestId}-paid-${at}`,
            kind: "paid",
            track,
            amountCents: r.amountCents,
            at,
          });
          break;
        }
        case "request.accepted":
        case "request.pinned":
          upsertRequest(r);
          break;
        case "request.playing":
          upsertRequest(r);
          scheduleRefetch(); // pulls the fresh nowPlaying snapshot
          break;
        case "request.played":
          upsertRequest(r);
          pushFeed({
            id: `${r.requestId}-played-${at}`,
            kind: "played",
            track,
            amountCents: r.amountCents,
            at,
          });
          scheduleRefetch();
          break;
        case "request.refunded":
          upsertRequest(r);
          pushFeed({
            id: `${r.requestId}-refunded-${at}`,
            kind: "refunded",
            track,
            amountCents: r.amountCents,
            at,
          });
          break;
        case "request.sla_missed":
          upsertRequest(r);
          pushFeed({
            id: `${r.requestId}-sla-${at}`,
            kind: "sla_missed",
            track,
            amountCents: r.amountCents,
            at,
          });
          break;
        default:
          break;
      }
    },
    [pushFeed, scheduleRefetch, upsertRequest],
  );

  const connection = useRealtimeChannel(
    sessionId ? staffChannel(sessionId) : null,
    { private: true },
    handleEnvelope,
  );

  // Reconcile after every reconnection — events may have been missed.
  const prevConnection = React.useRef<RealtimeConnectionState>("connecting");
  React.useEffect(() => {
    if (connection === "connected" && prevConnection.current !== "connected") {
      void replayQueue().then(() => {
        setQueuedOffline(queuedCount());
        refetch();
      });
    }
    prevConnection.current = connection;
  }, [connection, refetch]);

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  const sendAction = React.useCallback(
    async (
      kind: CockpitActionKind,
      requestId: string,
      body: Record<string, unknown>,
      idemKey: string,
      keepalive = false,
    ): Promise<"ok" | "http_error" | "network_error"> => {
      try {
        const res = await fetch(actionPath(kind, requestId), {
          method: "POST",
          keepalive,
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idemKey,
          },
          body: JSON.stringify(body),
        });
        return res.ok ? "ok" : "http_error";
      } catch {
        return "network_error";
      }
    },
    [],
  );

  /** Fire-now action with optimistic patch + rollback (accept/pin/play). */
  const runOptimistic = React.useCallback(
    (
      kind: CockpitActionKind,
      requestId: string,
      body: Record<string, unknown>,
      apply: () => void,
      rollback: () => void,
      failTitle: string,
    ) => {
      const idemKey = crypto.randomUUID();
      apply();
      void sendAction(kind, requestId, body, idemKey).then((outcome) => {
        if (outcome === "ok") return;
        if (outcome === "network_error") {
          enqueueAction({ action: kind, requestId, idemKey, body, at: Date.now() });
          setQueuedOffline(queuedCount());
          toast({ title: t("toast.actionQueued") });
          return;
        }
        rollback();
        toast({ title: failTitle, variant: "error" });
        scheduleRefetch();
      });
    },
    [scheduleRefetch, sendAction, t, toast],
  );

  const accept = React.useCallback(
    (id: string) => {
      const snapshot = state?.requests.find((r) => r.requestId === id);
      if (!snapshot || snapshot.status !== "paid") return;
      runOptimistic(
        "accept",
        id,
        {},
        () => patchRequest(id, { status: "accepted", decisionDeadlineAt: null }),
        () => patchRequest(id, { status: snapshot.status, decisionDeadlineAt: snapshot.decisionDeadlineAt }),
        t("toast.acceptFailed"),
      );
    },
    [patchRequest, runOptimistic, state, t],
  );

  const pin = React.useCallback(
    (id: string, pinned: boolean) => {
      const snapshot = state?.requests.find((r) => r.requestId === id);
      if (!snapshot) return;
      runOptimistic(
        "pin",
        id,
        { pinned },
        () =>
          setState((prev) =>
            prev
              ? {
                  ...prev,
                  requests: prev.requests.map((r) =>
                    r.requestId === id
                      ? { ...r, pinnedNext: pinned }
                      : pinned
                        ? { ...r, pinnedNext: false }
                        : r,
                  ),
                }
              : prev,
          ),
        () => patchRequest(id, { pinnedNext: snapshot.pinnedNext }),
        t("toast.pinFailed"),
      );
    },
    [patchRequest, runOptimistic, state, t],
  );

  const play = React.useCallback(
    (id: string) => {
      const snapshot = state?.requests.find((r) => r.requestId === id);
      if (!snapshot || snapshot.status !== "accepted") return;
      runOptimistic(
        "play",
        id,
        {},
        () => patchRequest(id, { status: "playing" }),
        () => patchRequest(id, { status: snapshot.status }),
        t("toast.playFailed"),
      );
    },
    [patchRequest, runOptimistic, state, t],
  );

  /* --- reject / cancel with the 5 s undo window (B7, B10.6 #10) ---- */

  const flushPending = React.useCallback(
    (id: string, keepalive = false) => {
      const pending = pendingUndoRef.current.get(id);
      if (!pending) return;
      pendingUndoRef.current.delete(id);
      clearTimeout(pending.timer);
      const kind: CockpitActionKind = pending.kind;
      const body = pending.kind === "reject" ? { reason: pending.reason } : {};
      void sendAction(kind, id, body, pending.idemKey, keepalive).then((outcome) => {
        if (outcome === "network_error") {
          enqueueAction({
            action: kind,
            requestId: id,
            idemKey: pending.idemKey,
            body,
            at: Date.now(),
          });
          setQueuedOffline(queuedCount());
        } else if (outcome === "http_error") {
          scheduleRefetch();
        }
      });
    },
    [scheduleRefetch, sendAction],
  );

  const startUndoable = React.useCallback(
    (kind: "reject" | "cancel", id: string, reason: RejectReason) => {
      const snapshot = state?.requests.find((r) => r.requestId === id);
      if (!snapshot) return;
      // Collapse the card now; the server call waits for the window.
      setHiddenIds((prev) => new Set(prev).add(id));
      const idemKey = crypto.randomUUID();
      const timer = setTimeout(() => {
        setHiddenIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        removeRequest(id);
        flushPending(id);
      }, UNDO_WINDOW_MS);
      pendingUndoRef.current.set(id, {
        kind,
        reason: kind === "reject" ? reason : null,
        snapshot,
        idemKey,
        timer,
      });
      toast({
        title: kind === "reject" ? t("toast.rejected") : t("toast.cancelled"),
        description: `${snapshot.trackTitle} · ${formatEurosDisplay(snapshot.amountCents)}`,
        durationMs: UNDO_WINDOW_MS,
        action: {
          label: t("toast.undo"),
          onAction: () => undoRef.current(id),
        },
      });
    },
    [flushPending, removeRequest, state, t, toast],
  );

  const undo = React.useCallback(
    (id: string) => {
      const pending = pendingUndoRef.current.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingUndoRef.current.delete(id);
      setHiddenIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      restoreRequest(pending.snapshot);
    },
    [restoreRequest],
  );
  const undoRef = React.useRef(undo);
  undoRef.current = undo;

  const reject = React.useCallback(
    (id: string, reason: RejectReason) => startUndoable("reject", id, reason),
    [startUndoable],
  );
  const cancel = React.useCallback(
    (id: string, reason: RejectReason) => startUndoable("cancel", id, reason),
    [startUndoable],
  );

  // Flush pending (not-yet-sent) decisions when the page hides (B7):
  // keepalive fetch survives the unload.
  React.useEffect(() => {
    const flushAll = () => {
      for (const id of Array.from(pendingUndoRef.current.keys())) {
        flushPending(id, true);
      }
    };
    window.addEventListener("pagehide", flushAll);
    return () => {
      window.removeEventListener("pagehide", flushAll);
      flushAll(); // unmount (navigation inside the app) sends them too
    };
  }, [flushPending]);

  /* ---------------------------------------------------------------- */
  /* Session open/pause switch                                         */
  /* ---------------------------------------------------------------- */

  const setRequestsOpen = React.useCallback(
    (open: boolean) => {
      if (!sessionId) return;
      const previous = state?.session?.requestsOpen ?? true;
      setState((prev) =>
        prev && prev.session
          ? { ...prev, session: { ...prev.session, requestsOpen: open } }
          : prev,
      );
      fetch(`/api/cockpit/session/${open ? "resume" : "pause"}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ sessionId }),
      })
        .then((res) => {
          if (!res.ok) throw new Error("http");
          toast({ title: open ? t("toast.resumed") : t("toast.paused") });
        })
        .catch(() => {
          setState((prev) =>
            prev && prev.session
              ? { ...prev, session: { ...prev.session, requestsOpen: previous } }
              : prev,
          );
          toast({ title: t("toast.actionFailed"), variant: "error" });
        });
    },
    [sessionId, state, t, toast],
  );

  /* ---------------------------------------------------------------- */
  /* Derivations                                                       */
  /* ---------------------------------------------------------------- */

  const visibleRequests = React.useMemo(
    () => (state?.requests ?? []).filter((r) => !hiddenIds.has(r.requestId)),
    [hiddenIds, state],
  );

  const { decide, queuedGroups, pinned, playTarget } = React.useMemo(() => {
    const now = Date.now();
    const paid = visibleRequests.filter((r) => r.status === "paid");
    paid.sort((a, b) => {
      const da = a.decisionDeadlineAt ? Date.parse(a.decisionDeadlineAt) : Infinity;
      const db = b.decisionDeadlineAt ? Date.parse(b.decisionDeadlineAt) : Infinity;
      return da - db;
    });
    const accepted = visibleRequests.filter((r) => r.status === "accepted");
    const pinnedRequest = accepted.find((r) => r.pinnedNext) ?? null;
    const rest = accepted.filter((r) => !r.pinnedNext);
    const ordered = new Map(rest.map((r) => [r.requestId, r]));
    const groups = groupByTier(rest.map(orderable), now);
    const byTier: Record<Tier, StaffRequestPayload[]> = {
      NEXT: groups.NEXT.map((o) => ordered.get(o.id)!),
      SOON: groups.SOON.map((o) => ordered.get(o.id)!),
      QUEUE: groups.QUEUE.map((o) => ordered.get(o.id)!),
    };
    const top =
      pinnedRequest ??
      byTier.NEXT[0] ??
      byTier.SOON[0] ??
      byTier.QUEUE[0] ??
      null;
    return {
      decide: paid,
      queuedGroups: byTier,
      pinned: pinnedRequest,
      playTarget: top,
    };
  }, [visibleRequests]);

  return {
    state,
    loading,
    connection,
    online,
    queuedOffline,
    feed,
    newIds,
    requests: visibleRequests,
    decide,
    queuedGroups,
    pinned,
    playTarget,
    refetch,
    accept,
    reject,
    cancel,
    undo,
    pin,
    play,
    setRequestsOpen,
  };
}

export type { CockpitNowPlaying };
