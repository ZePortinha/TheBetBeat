"use server";

/**
 * Leilões (2026-10-05): the club's slot-auction rules, stored in
 * venues.settings.auction and snapshotted onto each night when it is
 * planned (a change never touches a night already running). Every value
 * goes through parseAuctionConfig (types strict, insane values clamped);
 * the cases that need a human come back as console.auction.errors.*.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { auctionConfigProblems, parseAuctionConfig, PHASE_NAMES, type AuctionConfig } from "@/lib/auction/config";
import { assertVenueAccess, audit, requireConsole } from "../_lib/context";

const PATH = "/console/leiloes";

export async function saveAuctionConfigAction(formData: FormData): Promise<void> {
  const ctx = await requireConsole(PATH);
  const venueId = assertVenueAccess(ctx, String(formData.get("venueId") ?? ""));

  const n = (name: string) => Number(formData.get(name));
  const cents = (name: string) => Math.round(n(name) * 100);
  const on = (name: string) => formData.get(name) === "on";
  const time = (name: string) => String(formData.get(name) ?? "");

  let config: AuctionConfig;
  try {
    config = parseAuctionConfig({
      phases: PHASE_NAMES.map((name, i) => ({
        name,
        start: i === 0 ? null : time(`${name}Start`),
        slotsPerHour: n(`${name}Slots`),
        minPriceCents: cents(`${name}Min`),
      })),
      specials: {
        firstPeak: { enabled: on("fpEnabled"), at: time("fpAt"), minPriceCents: cents("fpMin"), openMinutesBefore: n("fpOpen") },
        lastSong: {
          enabled: on("lsEnabled"),
          minutesBeforeEnd: n("lsBefore"),
          minPriceCents: cents("lsMin"),
          openMinutesBefore: n("lsOpen"),
        },
      },
      songsPerHour: n("songsPerHour"),
      maxAuctionShareBps: Math.round(n("sharePct") * 100),
      minGapMin: n("minGapMin"),
      auctionDurationSec: Math.round(n("durationMin") * 60),
      firstAuctionFromStart: on("firstFromStart"),
      softClose: { windowSec: n("softWindowSec"), extendSec: n("softExtendSec"), maxExtraSec: Math.round(n("softMaxMin") * 60) },
      minIncrementCents: cents("incEur"),
      minIncrementBps: Math.round(n("incPct") * 100),
      quickBidStepsCents: [cents("quick1"), cents("quick2"), cents("quick3")],
      maxBidCents: cents("maxBidEur"),
      lastMinuteWarningSec: n("warnSec"),
      playTargetMin: n("playTargetMin"),
      refundAfterMin: n("refundAfterMin"),
      keepBalanceDays: n("keepBalanceDays"),
      transition: {
        easyMaxPct: n("trEasyPct"),
        mediumMaxPct: n("trMediumPct"),
        easyBps: Math.round(n("trEasyX") * 10_000),
        mediumBps: Math.round(n("trMediumX") * 10_000),
        hardBps: Math.round(n("trHardX") * 10_000),
        unknownBps: Math.round(n("trUnknownX") * 10_000),
      },
      recognition: {
        screenNameCents: cents("nameEur"),
        announceCents: cents("micEur"),
        specialMomentCents: cents("specialEur"),
        announcementsPerHour: n("micPerHour"),
        showAmountOnScreen: on("showAmount"),
      },
    });
  } catch {
    redirect(`${PATH}?error=invalid`);
  }
  const problem = auctionConfigProblems(config)[0];
  if (problem) redirect(`${PATH}?error=${problem}`);

  await query(
    `update public.venues set settings = settings || jsonb_build_object('auction', $2::jsonb) where id = $1`,
    [venueId, JSON.stringify(config)],
  );
  await audit(ctx, "venue.auction_config_updated", "venue", venueId, venueId, { config });
  revalidatePath(PATH);
  redirect(`${PATH}?saved=1`);
}
