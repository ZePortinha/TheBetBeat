"use client";

/**
 * Ao Vivo — the cockpit's default screen (BRIEF B7).
 *
 * Left ~35% "Agora": NowPlaying + the auction winner "A seguir" with its
 * play target and actions. Right ~65%: the slot auctions (open auctions,
 * schedule, "Abrir leilão agora"). Bottom: discreet payment/refund feed.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { Disc3 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { NowPlaying } from "@/components/ui/now-playing";
import { Skeleton } from "@/components/ui/skeleton";
import { AuctionBoard, AuctionNext, useCockpitAuction } from "./auction-panel";
import { formatEurosDisplay } from "./format";
import { TopBar } from "./top-bar";
import { useCockpit } from "./use-cockpit";
import type { FeedEntry } from "./types";

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

  const { state, loading } = cockpit;
  const auction = useCockpitAuction(state?.session?.id ?? sessionId);

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
  return (
    <div className="flex min-h-0 flex-1 flex-col">
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

          <SectionTitle>{t("auction.upNextTitle")}</SectionTitle>
          <AuctionNext a={auction} />
        </section>

        {/* ─── Leilões (right ~65%) ─────────────────────────────── */}
        <section className="flex min-w-0 flex-1">
          <AuctionBoard a={auction} />
        </section>
      </div>

      <FeedBar feed={cockpit.feed} />

    </div>
  );
}
