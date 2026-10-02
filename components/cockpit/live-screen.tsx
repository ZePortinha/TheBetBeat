"use client";

/**
 * Ao Vivo — the cockpit's default screen (BRIEF B7).
 *
 * Left ~35% "Agora": NowPlaying + the "Próxima" slot + the primary
 * "Marcar a tocar". Right ~65%: "Decidir" (paid, by decision deadline,
 * CountdownRing to auto-refund) and "Alinhados" (accepted, grouped
 * NEXT → SOON → QUEUE per B5.5). Bottom: discreet payment/refund feed.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { Disc3, Inbox, ListMusic, Pin } from "lucide-react";
import type { RejectReason } from "@/lib/domain/types";
import type { StaffRequestPayload } from "@/lib/realtime/events";
import { TIER_PLAY_ORDER } from "@/lib/domain/ordering";
import { springMove } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { NowPlaying } from "@/components/ui/now-playing";
import { Skeleton } from "@/components/ui/skeleton";
import { CockpitRequestCard, NEW_GLOW_CSS } from "./cockpit-request-card";
import { formatEurosDisplay } from "./format";
import { RejectSheet } from "./reject-sheet";
import { TopBar } from "./top-bar";
import { useCockpit } from "./use-cockpit";
import type { FeedEntry } from "./types";

function matchesSearch(r: StaffRequestPayload, query: string): boolean {
  if (query.length === 0) return true;
  const q = query.toLowerCase();
  return (
    r.trackTitle.toLowerCase().includes(q) ||
    r.trackArtist.toLowerCase().includes(q) ||
    (r.trackGenre ?? "").toLowerCase().includes(q)
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-base font-bold tracking-[0.01em] text-text-secondary"
      style={{ fontFamily: "var(--font-display)" }}
    >
      {children}
    </h2>
  );
}

function FeedBar({ feed }: { feed: FeedEntry[] }) {
  const t = useTranslations("cockpit.feed");
  return (
    <footer
      className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-t border-line-subtle bg-bg-raised px-4"
      aria-label={t("title")}
    >
      {feed.length === 0 ? (
        <span className="text-sm text-text-tertiary">{t("empty")}</span>
      ) : (
        feed.map((entry) => (
          <span
            key={entry.id}
            className="tnum shrink-0 whitespace-nowrap rounded-chip bg-surface-1 px-2.5 py-1 text-sm text-text-secondary"
          >
            {t(entry.kind === "paid" ? "paid" : entry.kind === "played" ? "played" : entry.kind === "sla_missed" ? "slaMissed" : "refunded", {
              amount: formatEurosDisplay(entry.amountCents),
              track: entry.track,
            })}
          </span>
        ))
      )}
    </footer>
  );
}

export function LiveScreen({ sessionId }: { sessionId: string | null }) {
  const t = useTranslations("cockpit");
  const cockpit = useCockpit(sessionId);
  const [search, setSearch] = React.useState("");
  const [declining, setDeclining] = React.useState<{
    request: StaffRequestPayload;
    mode: "reject" | "cancel";
  } | null>(null);

  const { state, loading } = cockpit;

  if (loading && !state) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <Skeleton height={64} rounded="card" />
        <div className="flex flex-1 gap-4">
          <Skeleton className="w-[35%]" height="60%" rounded="card" />
          <Skeleton className="flex-1" height="60%" rounded="card" />
        </div>
      </div>
    );
  }

  if (!state?.session) {
    return (
      <EmptyState
        icon={Disc3}
        title={t("session.none")}
        hint={t("session.noneHint")}
        className="flex-1"
      />
    );
  }

  const { session, nowPlaying, revenue } = state;
  const config = session.config;

  const decide = cockpit.decide.filter((r) => matchesSearch(r, search));
  const groups = cockpit.queuedGroups;
  const queuedTotal =
    groups.NEXT.length + groups.SOON.length + groups.QUEUE.length;
  const onReason = (requestId: string, reason: RejectReason) => {
    if (!declining) return;
    if (declining.mode === "reject") cockpit.reject(requestId, reason);
    else cockpit.cancel(requestId, reason);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <style>{NEW_GLOW_CSS}</style>
      <TopBar
        sessionName={session.name}
        requestsOpen={session.requestsOpen}
        onToggleOpen={cockpit.setRequestsOpen}
        search={search}
        onSearch={setSearch}
        revenueCents={revenue.totalCents}
        djCents={revenue.djCents}
        connection={cockpit.connection}
        online={cockpit.online}
        endsAt={session.endsAt}
      />

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        {/* ─── Agora (left ~35%) ─────────────────────────────────── */}
        <section className="flex w-[35%] min-w-0 flex-col gap-3 overflow-y-auto">
          <SectionTitle>{t("now.title")}</SectionTitle>
          {nowPlaying ? (
            <NowPlaying
              title={nowPlaying.title}
              artist={nowPlaying.artist}
              bpm={nowPlaying.bpm}
              startedAt={Date.parse(nowPlaying.startedAt)}
              durationSec={nowPlaying.durationSec ?? 0}
              amountCents={nowPlaying.amountCents}
            />
          ) : (
            <EmptyState
              icon={Disc3}
              title={t("now.nothingPlaying")}
              hint={t("now.nothingPlayingHint")}
              className="rounded-card border border-line-subtle bg-surface-1 py-8"
            />
          )}

          <SectionTitle>{t("now.nextSlot")}</SectionTitle>
          <AnimatePresence mode="popLayout" initial={false}>
            {cockpit.pinned ? (
              <CockpitRequestCard
                key={cockpit.pinned.requestId}
                request={cockpit.pinned}
                mode="queued"
                config={config}
                actions={
                  <>
                    <Button
                      variant="secondary"
                      size="lg"
                      className="flex-1"
                      onPress={() => cockpit.pin(cockpit.pinned!.requestId, false)}
                    >
                      {t("queued.unpin")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="lg"
                      className="flex-1 text-ember-500"
                      onPress={() =>
                        setDeclining({ request: cockpit.pinned!, mode: "cancel" })
                      }
                    >
                      {t("queued.cancel")}
                    </Button>
                  </>
                }
              />
            ) : (
              <motion.p
                key="next-empty"
                layout
                transition={springMove}
                className="rounded-card border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-tertiary"
              >
                {t("now.nextEmpty")}
              </motion.p>
            )}
          </AnimatePresence>

          <Button
            size="lg"
            fullWidth
            disabled={cockpit.playTarget === null}
            onPress={() => {
              if (cockpit.playTarget) cockpit.play(cockpit.playTarget.requestId);
            }}
          >
            {t("now.markPlaying")}
          </Button>
        </section>

        {/* ─── Decidir + Alinhados (right ~65%) ──────────────────── */}
        <section className="flex min-w-0 flex-1 gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <SectionTitle>
              {t("decide.title")}
              {decide.length > 0 ? (
                <span className="tnum ml-2 text-text-tertiary">{decide.length}</span>
              ) : null}
            </SectionTitle>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
              <AnimatePresence initial={false}>
                {decide.length === 0 ? (
                  <EmptyState
                    icon={Inbox}
                    title={t("decide.empty")}
                    hint={t("decide.emptyHint")}
                  />
                ) : (
                  decide.map((request) => (
                    <CockpitRequestCard
                      key={request.requestId}
                      request={request}
                      mode="decide"
                      config={config}
                      isNew={cockpit.newIds.has(request.requestId)}
                      actions={
                        <>
                          <Button
                            size="lg"
                            className="flex-1"
                            onPress={() => cockpit.accept(request.requestId)}
                          >
                            {t("decide.accept")}
                          </Button>
                          <Button
                            variant="secondary"
                            size="lg"
                            className="flex-1"
                            onPress={() => setDeclining({ request, mode: "reject" })}
                          >
                            {t("decide.reject")}
                          </Button>
                        </>
                      }
                    />
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <SectionTitle>
              {t("queued.title")}
              {queuedTotal > 0 ? (
                <span className="tnum ml-2 text-text-tertiary">{queuedTotal}</span>
              ) : null}
            </SectionTitle>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
              {queuedTotal === 0 ? (
                <EmptyState
                  icon={ListMusic}
                  title={t("queued.empty")}
                  hint={t("queued.emptyHint")}
                />
              ) : (
                TIER_PLAY_ORDER.map((tier) => {
                  const items = groups[tier].filter((r) => matchesSearch(r, search));
                  if (items.length === 0) return null;
                  return (
                    <div key={tier} className="flex flex-col gap-3">
                      <AnimatePresence initial={false}>
                        {items.map((request) => (
                          <CockpitRequestCard
                            key={request.requestId}
                            request={request}
                            mode="queued"
                            config={config}
                            actions={
                              <>
                                <Button
                                  variant="secondary"
                                  size="lg"
                                  className="flex-1"
                                  onPress={() => cockpit.pin(request.requestId, true)}
                                >
                                  <Pin size={18} strokeWidth={1.75} aria-hidden />
                                  {t("queued.pin")}
                                </Button>
                                <Button
                                  size="lg"
                                  className="flex-1"
                                  onPress={() => cockpit.play(request.requestId)}
                                >
                                  {t("queued.play")}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="lg"
                                  className="shrink-0 text-ember-500"
                                  onPress={() => setDeclining({ request, mode: "cancel" })}
                                >
                                  {t("queued.cancel")}
                                </Button>
                              </>
                            }
                          />
                        ))}
                      </AnimatePresence>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </div>

      <FeedBar feed={cockpit.feed} />

      <RejectSheet
        request={declining?.request ?? null}
        mode={declining?.mode ?? "reject"}
        onClose={() => setDeclining(null)}
        onReason={onReason}
      />
    </div>
  );
}
