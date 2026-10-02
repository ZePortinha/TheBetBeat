/**
 * Weekly genre multiplier recommendation (BRIEF B5.4).
 *
 * Every Monday (default '0 6 * * 1') the worker looks at each venue's
 * quotes over the last 30 days and, for every genre with at least 30
 * quotes, recommends a new `M_g`:
 *
 *   conversion = paid requests / quotes shown
 *   demand     = genre quote share / average share
 *   +0.05 when conversion > 35% and demand > 1
 *   −0.05 when conversion < 15%
 *   otherwise keep — always clamped to [0.8, 1.3]
 *
 * The recommendation and its metrics land on genre_multipliers
 * (`recommended` + `metrics` jsonb); the LIVE `multiplier` only moves when
 * the venue enabled `auto_apply` — otherwise the Console shows the
 * recommendation and a manager approves or adjusts it (B5.4 "Consola").
 * Genres below the quote floor still get fresh metrics (volume context
 * for the Console) but no recommendation change.
 *
 * One audit_log row per venue records what was recommended and applied.
 */

import { query, withTransaction } from "@/lib/db";
import {
  computeGenreMetrics,
  recommendGenreMultiplier,
  type GenreQuoteStats,
} from "../lib";

export const GENRE_WEEKLY_QUEUE = "genre-weekly";

export interface GenreWeeklyConfig {
  /** Minimum quotes in the window for a recommendation (B5.4 — 30). */
  minQuotes: number;
  /** Lookback window, days (B5.4 — 30). */
  windowDays: number;
}

export interface GenreWeeklyResult {
  venues: number;
  genresEvaluated: number;
  recommendationsWritten: number;
  autoApplied: number;
}

interface QuoteAggregateRow {
  venue_id: string;
  genre: string;
  total: string;
  converted: string;
}

interface MultiplierRow {
  genre: string;
  multiplier: string; // pg numeric comes back as a string
  auto_apply: boolean;
}

/** Runs the weekly job for every venue with quotes in the window. */
export async function runGenreWeekly(
  now: number,
  config: GenreWeeklyConfig,
): Promise<GenreWeeklyResult> {
  // conversion counts PAID requests (B5.4 "paid / quotesShown"), not mere
  // quote→request conversion: a request abandoned at payment is not paid.
  const rows = await query<QuoteAggregateRow>(
    `select s.venue_id, q.track_genre as genre,
            count(*)::bigint as total,
            count(*) filter (where exists (
              select 1 from public.requests r
               where r.quote_id = q.id and r.paid_at is not null
            ))::bigint as converted
       from public.quotes q
       join public.sessions s on s.id = q.session_id
      where q.track_genre is not null
        and q.created_at >= to_timestamp($1 / 1000.0) - make_interval(days => $2)
        and q.created_at < to_timestamp($1 / 1000.0)
      group by s.venue_id, q.track_genre`,
    [now, config.windowDays],
  );

  // Group per venue: demand shares are relative to the venue's own mix.
  const byVenue = new Map<string, Map<string, GenreQuoteStats>>();
  for (const row of rows.rows) {
    let genres = byVenue.get(row.venue_id);
    if (!genres) {
      genres = new Map<string, GenreQuoteStats>();
      byVenue.set(row.venue_id, genres);
    }
    genres.set(row.genre, { total: Number(row.total), converted: Number(row.converted) });
  }

  const result: GenreWeeklyResult = {
    venues: byVenue.size,
    genresEvaluated: 0,
    recommendationsWritten: 0,
    autoApplied: 0,
  };

  for (const [venueId, genreStats] of byVenue) {
    const metrics = computeGenreMetrics(genreStats);

    const currentRes = await query<MultiplierRow>(
      `select genre, multiplier, auto_apply from public.genre_multipliers
        where venue_id = $1`,
      [venueId],
    );
    const current = new Map(currentRes.rows.map((r) => [r.genre, r]));

    const adjustments: Array<{
      genre: string;
      previous: number;
      recommended: number;
      applied: boolean;
      reason: string;
      conversion: number;
      demand: number;
      total: number;
      converted: number;
    }> = [];

    await withTransaction(async (client) => {
      for (const [genre, m] of metrics) {
        result.genresEvaluated += 1;
        if (m.total < config.minQuotes) continue; // not enough signal (B5.4)

        const existing = current.get(genre);
        const previous = existing ? Number(existing.multiplier) : 1.0;
        const recommendation = recommendGenreMultiplier(previous, m);

        const upserted = await client.query<{ multiplier: string; auto_apply: boolean }>(
          `insert into public.genre_multipliers
             (venue_id, genre, multiplier, recommended, metrics, updated_at)
           values ($1, $2, 1.0, $3, $4, now())
           on conflict (venue_id, genre) do update
             set recommended = excluded.recommended,
                 metrics = excluded.metrics,
                 multiplier = case
                   when public.genre_multipliers.auto_apply then excluded.recommended
                   else public.genre_multipliers.multiplier
                 end,
                 updated_at = now()
           returning multiplier, auto_apply`,
          [
            venueId,
            genre,
            recommendation.recommended,
            JSON.stringify({
              windowDays: config.windowDays,
              total: m.total,
              converted: m.converted,
              conversion: m.conversion,
              share: m.share,
              demand: m.demand,
              previousMultiplier: previous,
              recommended: recommendation.recommended,
              delta: recommendation.delta,
              reason: recommendation.reason,
              computedAt: new Date(now).toISOString(),
            }),
          ],
        );
        const written = upserted.rows[0];
        const applied =
          written !== undefined &&
          written.auto_apply &&
          Number(written.multiplier) === recommendation.recommended;

        result.recommendationsWritten += 1;
        if (applied) result.autoApplied += 1;
        adjustments.push({
          genre,
          previous,
          recommended: recommendation.recommended,
          applied,
          reason: recommendation.reason,
          conversion: m.conversion,
          demand: m.demand,
          total: m.total,
          converted: m.converted,
        });
      }

      if (adjustments.length > 0) {
        await client.query(
          `insert into public.audit_log (actor, action, entity, entity_id, venue_id, payload)
           values ('system:worker', 'pricing.genre_weekly', 'venue', $1, $2, $3)`,
          [venueId, venueId, JSON.stringify({ windowDays: config.windowDays, adjustments })],
        );
      }
    });
  }

  console.log(
    `[worker:genre] venues=${result.venues} evaluated=${result.genresEvaluated} ` +
      `recommended=${result.recommendationsWritten} autoApplied=${result.autoApplied}`,
  );
  return result;
}
