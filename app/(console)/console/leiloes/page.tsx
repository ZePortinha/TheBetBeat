import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { query } from "@/lib/db";
import { DEFAULT_AUCTION_CONFIG, parseAuctionConfig, type AuctionConfig } from "@/lib/auction/config";
import { planNight } from "@/lib/auction/schedule";
import { localParts, nextWallClock } from "@/lib/auction/time";
import { PageHeader } from "@/components/console/page-header";
import { Stat } from "@/components/console/stat";
import { Table, THead, Th, Td, Tr } from "@/components/console/table";
import { formatDateTime, formatEuros, requireConsole } from "../_lib/context";
import { saveAuctionConfigAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Leilões (2026-10-05): the club's auction rules (phases, specials,
 * prices, increments, timings, recognition tiers, privacy) and the
 * metrics per night and per slot (auction_slot_metrics) to compare nights.
 */
export default async function AuctionsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; night?: string }>;
}) {
  const ctx = await requireConsole("/console/leiloes");
  const t = await getTranslations("console.auction");
  const venue = ctx.activeVenue;
  if (!venue) redirect("/console");
  const params = await searchParams;

  const [venueRow, nights] = await Promise.all([
    query<{ auction: unknown }>(`select settings -> 'auction' as auction from public.venues where id = $1`, [venue.id]),
    query<{
      session_id: string;
      name: string;
      starts_at: Date;
      slots: number;
      won: number;
      no_winner: number;
      played: number;
      refunded: number;
      revenue_cents: string;
      avg_final_cents: string | null;
      avg_bids: string | null;
      avg_bidders: string | null;
      extended: number;
    }>(
      `select m.session_id, s.name, s.starts_at,
              count(*) filter (where m.status = 'closed')::int as slots,
              count(*) filter (where m.outcome = 'won')::int as won,
              count(*) filter (where m.outcome = 'no_winner')::int as no_winner,
              count(*) filter (where m.play_status = 'played')::int as played,
              count(*) filter (where m.play_status = 'refunded')::int as refunded,
              coalesce(sum(m.revenue_cents), 0)::bigint as revenue_cents,
              avg(m.final_price_cents) filter (where m.outcome = 'won') as avg_final_cents,
              avg(m.bids) filter (where m.status = 'closed') as avg_bids,
              avg(m.bidders) filter (where m.status = 'closed') as avg_bidders,
              count(*) filter (where m.extensions > 0)::int as extended
         from public.auction_slot_metrics m
         join public.sessions s on s.id = m.session_id
        where m.venue_id = $1
        group by m.session_id, s.name, s.starts_at
        order by s.starts_at desc
        limit 12`,
      [venue.id],
    ),
  ]);

  let config: AuctionConfig = DEFAULT_AUCTION_CONFIG;
  try {
    config = parseAuctionConfig(venueRow.rows[0]?.auction ?? {});
  } catch {
    // Keep the defaults on screen; saving writes a clean config.
  }

  // Preview: tonight-like night 23:00 → 06:00 with these rules.
  const tz = config.timezone;
  const startMs = nextWallClock(Date.now(), "23:00", tz);
  const endMs = nextWallClock(startMs, "06:00", tz);
  const plan = planNight(startMs, endMs, config);
  const hm = (ms: number) => {
    const p = localParts(ms, tz);
    return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  };

  const selectedNight = params.night ?? nights.rows[0]?.session_id ?? null;
  const slots = selectedNight
    ? await query<{
        slot_id: string;
        kind: string;
        phase: string;
        closes_at: Date;
        min_price_cents: number;
        final_price_cents: number | null;
        bids: number;
        bidders: number;
        extensions: number;
        outcome: string | null;
        play_status: string | null;
        status: string;
        close_to_play_sec: number | null;
      }>(
        `select slot_id, kind, phase, closes_at, min_price_cents, final_price_cents, bids, bidders,
                extensions, outcome, play_status, status, close_to_play_sec
           from public.auction_slot_metrics
          where venue_id = $1 and session_id = $2
          order by closes_at`,
        [venue.id, selectedNight],
      )
    : null;

  const eur = (cents: number) => String(cents / 100);
  const field =
    "w-24 rounded-button border border-line-subtle bg-surface-3 px-2 py-1.5 text-sm text-text-primary tnum focus:border-accent-500 focus:outline-none";
  const Num = ({ name, value, step = 1, label }: { name: string; value: number | string; step?: number; label: string }) => (
    <label className="flex items-center justify-between gap-4 py-1.5 text-sm text-text-secondary">
      {label}
      <input type="number" name={name} defaultValue={value} step={step} min={0} required className={field} />
    </label>
  );
  const Check = ({ name, checked, label }: { name: string; checked: boolean; label: string }) => (
    <label className="flex items-center justify-between gap-4 py-1.5 text-sm text-text-secondary">
      {label}
      <input type="checkbox" name={name} defaultChecked={checked} className="size-5 accent-[var(--color-accent-500)]" />
    </label>
  );
  const Card = ({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) => (
    <fieldset className="rounded-card border border-line-subtle bg-surface-1 p-5">
      <legend className="px-1 text-base font-semibold text-text-primary">{title}</legend>
      {hint ? <p className="pb-2 text-xs text-text-tertiary">{hint}</p> : null}
      {children}
    </fieldset>
  );
  const [fp, ls] = [config.specials.firstPeak, config.specials.lastSong];
  const rec = config.recognition;

  return (
    <div className="flex flex-col gap-10">
      <PageHeader crumbs={[{ label: t("crumbRoot") }, { label: t("title") }]} title={t("title")} />

      {params.saved ? <p role="status" className="text-sm text-accent-400">{t("saved")}</p> : null}
      {params.error ? (
        <p role="alert" className="text-sm text-ember-500">
          {t(`errors.${["invalid", "firstPhaseStartsAtOpening", "onlyFirstPhaseWithoutStart", "duplicatePhase"].includes(params.error) ? params.error : "invalid"}`)}
        </p>
      ) : null}

      <form action={saveAuctionConfigAction} className="flex flex-col gap-6">
        <input type="hidden" name="venueId" value={venue.id} />
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={t("phases.title")} hint={t("phases.hint")}>
            <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 gap-y-2 text-sm">
              <span className="label text-text-tertiary">{t("phases.phase")}</span>
              <span className="label text-text-tertiary">{t("phases.start")}</span>
              <span className="label text-text-tertiary">{t("phases.perHour")}</span>
              <span className="label text-text-tertiary">{t("phases.minEur")}</span>
              {config.phases.map((p) => (
                <div key={p.name} className="contents">
                  <span className="text-text-primary">{t(`phases.names.${p.name}`)}</span>
                  {p.start === null ? (
                    <span className="w-24 text-text-tertiary">{t("phases.opening")}</span>
                  ) : (
                    <input type="time" name={`${p.name}Start`} defaultValue={p.start} required className={field} aria-label={t("phases.start")} />
                  )}
                  <input type="number" name={`${p.name}Slots`} defaultValue={p.slotsPerHour} min={0} max={12} required className={field} aria-label={t("phases.perHour")} />
                  <input type="number" name={`${p.name}Min`} defaultValue={eur(p.minPriceCents)} min={0} step={0.5} required className={field} aria-label={t("phases.minEur")} />
                </div>
              ))}
            </div>
          </Card>

          <Card title={t("specials.title")} hint={t("specials.hint")}>
            <Check name="fpEnabled" checked={fp.enabled} label={t("specials.firstPeak")} />
            <label className="flex items-center justify-between gap-4 py-1.5 text-sm text-text-secondary">
              {t("specials.at")}
              <input type="time" name="fpAt" defaultValue={fp.at} required className={field} />
            </label>
            <Num name="fpMin" value={eur(fp.minPriceCents)} step={0.5} label={t("specials.minEur")} />
            <Num name="fpOpen" value={fp.openMinutesBefore} label={t("specials.openMin")} />
            <div className="my-2 border-t border-line-subtle" />
            <Check name="lsEnabled" checked={ls.enabled} label={t("specials.lastSong")} />
            <Num name="lsBefore" value={ls.minutesBeforeEnd} label={t("specials.beforeEnd")} />
            <Num name="lsMin" value={eur(ls.minPriceCents)} step={0.5} label={t("specials.minEur")} />
            <Num name="lsOpen" value={ls.openMinutesBefore} label={t("specials.openMin")} />
          </Card>

          <Card title={t("bidding.title")}>
            <Num name="durationMin" value={config.auctionDurationSec / 60} step={0.5} label={t("bidding.durationMin")} />
            <Check name="firstFromStart" checked={config.firstAuctionFromStart} label={t("bidding.firstFromStart")} />
            <Num name="incEur" value={eur(config.minIncrementCents)} step={0.5} label={t("bidding.incEur")} />
            <Num name="incPct" value={config.minIncrementBps / 100} step={0.5} label={t("bidding.incPct")} />
            <Num name="quick1" value={eur(config.quickBidStepsCents[0])} step={0.5} label={t("bidding.quick", { n: 1 })} />
            <Num name="quick2" value={eur(config.quickBidStepsCents[1])} step={0.5} label={t("bidding.quick", { n: 2 })} />
            <Num name="quick3" value={eur(config.quickBidStepsCents[2])} step={0.5} label={t("bidding.quick", { n: 3 })} />
            <Num name="maxBidEur" value={eur(config.maxBidCents)} label={t("bidding.maxBidEur")} />
            <Num name="softWindowSec" value={config.softClose.windowSec} label={t("bidding.softWindowSec")} />
            <Num name="softExtendSec" value={config.softClose.extendSec} label={t("bidding.softExtendSec")} />
            <Num name="softMaxMin" value={config.softClose.maxExtraSec / 60} step={0.5} label={t("bidding.softMaxMin")} />
            <Num name="warnSec" value={config.lastMinuteWarningSec} label={t("bidding.warnSec")} />
          </Card>

          <Card title={t("recognition.title")} hint={t("recognition.hint")}>
            <Num name="nameEur" value={eur(rec.screenNameCents)} label={t("recognition.nameEur")} />
            <Num name="micEur" value={eur(rec.announceCents)} label={t("recognition.micEur")} />
            <Num name="specialEur" value={eur(rec.specialMomentCents)} label={t("recognition.specialEur")} />
            <Num name="micPerHour" value={rec.announcementsPerHour} label={t("recognition.micPerHour")} />
            <Check name="showAmount" checked={rec.showAmountOnScreen} label={t("recognition.showAmount")} />
          </Card>

          <Card title={t("dj.title")} hint={t("dj.hint")}>
            <Num name="playTargetMin" value={config.playTargetMin} label={t("dj.playTargetMin")} />
            <Num name="refundAfterMin" value={config.refundAfterMin} label={t("dj.refundAfterMin")} />
            <div className="my-2 border-t border-line-subtle" />
            <Check name="keepBalance" checked={config.keepBalanceAllowed} label={t("dj.keepBalance")} />
            <Num name="keepBalanceDays" value={config.keepBalanceDays} label={t("dj.keepBalanceDays")} />
            <p className="text-xs text-text-tertiary">{t("dj.keepBalanceHint")}</p>
          </Card>

          <Card title={t("transition.title")} hint={t("transition.hint")}>
            <Num name="trEasyPct" value={config.transition.easyMaxPct} step={0.5} label={t("transition.easyPct")} />
            <Num name="trMediumPct" value={config.transition.mediumMaxPct} step={0.5} label={t("transition.mediumPct")} />
            <Num name="trEasyX" value={config.transition.easyBps / 10_000} step={0.1} label={t("transition.easyX")} />
            <Num name="trMediumX" value={config.transition.mediumBps / 10_000} step={0.1} label={t("transition.mediumX")} />
            <Num name="trHardX" value={config.transition.hardBps / 10_000} step={0.1} label={t("transition.hardX")} />
            <Num name="trUnknownX" value={config.transition.unknownBps / 10_000} step={0.1} label={t("transition.unknownX")} />
          </Card>

          <Card title={t("cap.title")} hint={t("cap.hint")}>
            <Num name="songsPerHour" value={config.songsPerHour} label={t("cap.songsPerHour")} />
            <Num name="sharePct" value={config.maxAuctionShareBps / 100} step={0.5} label={t("cap.sharePct")} />
            <Num name="minGapMin" value={config.minGapMin} label={t("cap.minGapMin")} />
            <p className={`pt-2 text-sm ${plan.withinCap ? "text-text-secondary" : "text-ember-500"}`}>
              {t("cap.preview", { slots: plan.slots.length, max: plan.maxSlots, songs: plan.estimatedSongs })}
            </p>
            <p className="tnum pt-1 text-xs text-text-tertiary">{plan.slots.map((s) => hm(s.closesAtMs)).join(" · ")}</p>
          </Card>
        </div>
        <div>
          <button
            type="submit"
            className="rounded-button bg-accent-500 px-5 py-2.5 font-semibold text-text-on-accent transition-transform duration-100 active:scale-[0.97]"
          >
            {t("save")}
          </button>
          <p className="pt-2 text-xs text-text-tertiary">{t("saveHint")}</p>
        </div>
      </form>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-text-primary">{t("metrics.title")}</h2>
        {nights.rows.length === 0 ? (
          <p className="text-sm text-text-tertiary">{t("metrics.empty")}</p>
        ) : (
          <>
            {(() => {
              const n = nights.rows.find((r) => r.session_id === selectedNight) ?? nights.rows[0]!;
              const closed = Math.max(1, n.slots);
              return (
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <Stat label={t("metrics.revenue")} value={formatEuros(Number(n.revenue_cents))} money />
                  <Stat label={t("metrics.avgFinal")} value={n.avg_final_cents ? formatEuros(Math.round(Number(n.avg_final_cents))) : "—"} money />
                  <Stat label={t("metrics.wonRate")} value={`${Math.round((n.won / closed) * 100)}%`} hint={t("metrics.noWinner", { count: n.no_winner })} />
                  <Stat label={t("metrics.avgBidders")} value={n.avg_bidders ? Number(n.avg_bidders).toFixed(1) : "—"} hint={t("metrics.avgBids", { n: n.avg_bids ? Number(n.avg_bids).toFixed(1) : "0" })} />
                </div>
              );
            })()}

            <Table>
              <THead>
                <Th>{t("metrics.night")}</Th>
                <Th align="right">{t("metrics.slots")}</Th>
                <Th align="right">{t("metrics.won")}</Th>
                <Th align="right">{t("metrics.played")}</Th>
                <Th align="right">{t("metrics.refunded")}</Th>
                <Th align="right">{t("metrics.extended")}</Th>
                <Th align="right">{t("metrics.avgFinal")}</Th>
                <Th align="right">{t("metrics.revenue")}</Th>
              </THead>
              <tbody>
                {nights.rows.map((r) => (
                  <Tr key={r.session_id}>
                    <Td>
                      <a href={`/console/leiloes?night=${r.session_id}`} className="font-semibold text-text-primary hover:text-accent-400">
                        {r.name}
                      </a>
                      <p className="text-xs text-text-tertiary">{formatDateTime(r.starts_at)}</p>
                    </Td>
                    <Td align="right" numeric>{r.slots}</Td>
                    <Td align="right" numeric>{r.won}</Td>
                    <Td align="right" numeric>{r.played}</Td>
                    <Td align="right" numeric>{r.refunded}</Td>
                    <Td align="right" numeric>{r.extended}</Td>
                    <Td align="right" numeric>{r.avg_final_cents ? formatEuros(Math.round(Number(r.avg_final_cents))) : "—"}</Td>
                    <Td align="right" numeric className="text-accent-400">{formatEuros(Number(r.revenue_cents))}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>

            {slots && slots.rows.length > 0 ? (
              <>
                <h3 className="pt-2 text-base font-semibold text-text-primary">{t("metrics.perSlot")}</h3>
                <Table>
                  <THead>
                    <Th>{t("metrics.closes")}</Th>
                    <Th>{t("metrics.phase")}</Th>
                    <Th align="right">{t("metrics.minPrice")}</Th>
                    <Th align="right">{t("metrics.final")}</Th>
                    <Th align="right">{t("metrics.bids")}</Th>
                    <Th align="right">{t("metrics.bidders")}</Th>
                    <Th align="right">{t("metrics.extensions")}</Th>
                    <Th align="right">{t("metrics.closeToPlay")}</Th>
                    <Th>{t("metrics.result")}</Th>
                  </THead>
                  <tbody>
                    {slots.rows.map((s) => (
                      <Tr key={s.slot_id}>
                        <Td numeric>{hm(s.closes_at.getTime())}</Td>
                        <Td>
                          {t(`phases.names.${s.phase}`)}
                          {s.kind !== "regular" ? <span className="ml-2 text-xs text-accent-400">{t(`specials.kinds.${s.kind}`)}</span> : null}
                        </Td>
                        <Td align="right" numeric>{formatEuros(s.min_price_cents)}</Td>
                        <Td align="right" numeric>{s.final_price_cents ? formatEuros(s.final_price_cents) : "—"}</Td>
                        <Td align="right" numeric>{s.bids}</Td>
                        <Td align="right" numeric>{s.bidders}</Td>
                        <Td align="right" numeric>{s.extensions}</Td>
                        <Td align="right" numeric>{s.close_to_play_sec !== null ? `${Math.round(s.close_to_play_sec / 60)} min` : "—"}</Td>
                        <Td>{t(`metrics.results.${s.play_status ?? s.outcome ?? s.status}`)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
