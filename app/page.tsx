import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronRight, Disc3 } from "lucide-react";
import { query } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { signToken } from "@/lib/security/tokens";
import { BootIntro } from "@/components/ui/boot-intro";
import { DevStrip } from "@/components/landing/landing";
import { QrScanner } from "@/components/landing/qr-scanner";

export const dynamic = "force-dynamic";

/** Signed QR/display links from the seeded data — development only. */
async function devLinks(): Promise<{
  guestHref: string | null;
  displayHref: string | null;
}> {
  let guestHref: string | null = null;
  let displayHref: string | null = null;
  try {
    const supabase = createAdminClient();
    const { data: zone } = await supabase
      .from("zones")
      .select("qr_slug, venue_id")
      .eq("qr_slug", "zone-pista-dev")
      .single();
    const { data: session } = await supabase
      .from("sessions")
      .select("display_slug, venue_id")
      .eq("status", "live")
      .limit(1)
      .single();
    if (zone) {
      guestHref = `/s/${encodeURIComponent(
        signToken({ kind: "zone", venueId: zone.venue_id, slug: zone.qr_slug }),
      )}`;
    }
    if (session) {
      displayHref = `/display/${encodeURIComponent(
        signToken({
          kind: "display",
          venueId: session.venue_id,
          slug: session.display_slug,
        }),
      )}`;
    }
  } catch {
    // Database not up yet; the static links still render.
  }
  return { guestHref, displayHref };
}

interface LiveEvent {
  id: string;
  name: string;
  venue_id: string;
  venue_name: string;
  dj_name: string | null;
  now_title: string | null;
  now_artist: string | null;
  open_auctions: number;
}

/** Every event live on BetBeat right now, newest first. */
async function liveEvents(): Promise<LiveEvent[]> {
  try {
    const res = await query<LiveEvent>(
      `select s.id, s.name, s.venue_id, v.name as venue_name, st.display_name as dj_name,
              now_t.title as now_title, now_t.artist as now_artist,
              (select count(*) from public.auction_slots a where a.session_id = s.id and a.status = 'open')::int as open_auctions
         from public.sessions s
         join public.venues v on v.id = s.venue_id
         left join public.staff st on st.id = s.dj_staff_id
         left join lateral (select title, artist from public.session_tracks t
                             where t.session_id = s.id order by t.started_at desc limit 1) now_t on true
        where s.status in ('live', 'paused')
        order by s.starts_at desc
        limit 30`,
    );
    return res.rows;
  } catch {
    return [];
  }
}

/**
 * "/" — the guests' front door (2026-10-06): the camera reads the event's
 * QR first; below it, every event live on BetBeat right now. Clubs find
 * BetBeat at /casas.
 */
export default async function Home() {
  const t = await getTranslations("guest.entry");
  const tc = await getTranslations("common");
  const [events, dev] = await Promise.all([
    liveEvents(),
    // The E2E suite reads these links off this page; production never shows them.
    process.env.NODE_ENV !== "production" ? devLinks() : Promise.resolve(null),
  ]);

  return (
    <div className="guest-type relative isolate mx-auto min-h-dvh w-full max-w-md">
      <div aria-hidden className="ambient pointer-events-none fixed inset-0 -z-10" />
      <BootIntro />
      <main className="flex flex-col gap-6 px-4 pb-10 pt-5">
        <header className="flex items-center justify-between">
          <span className="text-lg font-bold text-accent-400">{tc("appName")}</span>
          <Link href="/casas" className="text-sm font-semibold text-text-secondary">
            {t("forVenues")}
          </Link>
        </header>

        <div>
          <h1 className="text-3xl font-bold text-text-primary">{t("title")}</h1>
          <p className="mt-1.5 text-base text-text-secondary">{t("hint")}</p>
        </div>

        <QrScanner />

        <section aria-labelledby="live-events" className="flex flex-col gap-2">
          <h2 id="live-events" className="label flex items-center gap-1.5 text-accent-400">
            <span aria-hidden className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
            {t("liveTitle")}
          </h2>
          {events.length === 0 ? (
            <p className="rounded-card border border-line-subtle bg-surface-1 px-4 py-5 text-center text-sm text-text-secondary">
              {t("liveEmpty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {events.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/s/${encodeURIComponent(signToken({ kind: "session", venueId: e.venue_id, slug: e.id }))}`}
                    className="flex min-h-16 items-center gap-3 rounded-card border border-line-subtle bg-surface-1 px-4 py-3 transition-transform duration-100 active:scale-[0.99]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-semibold text-text-primary">{e.venue_name}</span>
                      <span className="block truncate text-sm text-text-secondary">
                        {e.name}
                        {e.dj_name ? ` · ${e.dj_name}` : ""}
                      </span>
                      {e.now_title ? (
                        <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-text-tertiary">
                          <Disc3 size={12} aria-hidden className="shrink-0 text-accent-400" />
                          <span className="truncate">
                            {e.now_title} · {e.now_artist}
                          </span>
                        </span>
                      ) : null}
                    </span>
                    {e.open_auctions > 0 ? (
                      <span className="shrink-0 rounded-chip bg-accent-500 px-2 py-1 text-xs font-semibold text-text-on-accent">
                        {t("auctionLive")}
                      </span>
                    ) : null}
                    <ChevronRight size={20} className="shrink-0 text-text-tertiary" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      {dev ? <DevStrip {...dev} /> : null}
    </div>
  );
}
