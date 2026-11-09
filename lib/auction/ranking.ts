/**
 * The guest's own place in tonight's ranking (2026-11-06). The ranking
 * counts only money behind songs that played (B6.8), so a guest who has
 * just won is not in it yet. The app therefore shows two things: where the
 * guest is now, and where they land once the songs they won play (their
 * pending money added, everyone else as they stand). Pure: the server
 * computes the places, the app places the guest's row; both unit-tested.
 */

/** Played money per guest, highest first, ties by guest id (the SQL order). */
export interface SpentRow {
  guestId: string;
  spentCents: number;
}

export interface MyRank {
  /** 1-based place among everyone with played money; null with none yet. */
  place: number | null;
  /** Place once the money behind my won, not yet played songs counts. */
  projectedPlace: number | null;
  /** Played money (what the ranking shows for me today). */
  spentCents: number;
  /** Money behind songs I won that have not played yet. */
  pendingCents: number;
  /** How I appear in the ranking (my last public choice tonight). */
  label: string | null;
}

/** My place now and once my pending money counts, from the full table. */
export function placeIn(
  table: readonly SpentRow[],
  guestId: string,
  pendingCents: number,
  label: string | null,
): MyRank {
  const idx = table.findIndex((r) => r.guestId === guestId);
  const spentCents = idx >= 0 ? (table[idx]?.spentCents ?? 0) : 0;
  const total = spentCents + pendingCents;
  let ahead = 0;
  for (const r of table) {
    if (r.guestId === guestId) continue;
    // The same order as the SQL: more money first, then the lower guest id.
    if (r.spentCents > total || (r.spentCents === total && r.guestId < guestId)) ahead += 1;
  }
  return {
    place: idx >= 0 ? idx + 1 : null,
    projectedPlace: total > 0 ? ahead + 1 : null,
    spentCents,
    pendingCents,
    label,
  };
}

export interface RankRow {
  place: number;
  label: string | null;
  spentCents: number;
  /** This row is the guest looking at it. */
  mine: boolean;
  /** Part of `spentCents` that counts once the guest's won songs play. */
  pendingCents: number;
}

/**
 * The public ranking as this guest sees it: their own row marked, at the
 * place they land once their won songs play. The public list has no ids,
 * so the guest's played row is recognised by place, amount and label (and
 * left alone when it cannot be found: a list a moment older than `me`).
 */
export function personalRanking(
  ranking: ReadonlyArray<{ label: string | null; spentCents: number }>,
  me: MyRank | null | undefined,
): RankRow[] {
  const rows = ranking.map((r) => ({ label: r.label, spentCents: r.spentCents, mine: false, pendingCents: 0 }));
  const numbered = (list: typeof rows) => list.map((r, i) => ({ ...r, place: i + 1 }));
  if (!me || me.projectedPlace === null || me.spentCents + me.pendingCents <= 0) return numbered(rows);

  const same = (r: (typeof rows)[number]) => r.spentCents === me.spentCents && r.label === me.label;
  let at = -1;
  if (me.place !== null) {
    const expected = rows[me.place - 1];
    at = expected && same(expected) ? me.place - 1 : rows.findIndex(same);
  }
  if (at >= 0) rows.splice(at, 1);

  const mine = { label: me.label, spentCents: me.spentCents + me.pendingCents, mine: true, pendingCents: me.pendingCents };
  const target = me.projectedPlace - 1;
  if (target <= rows.length) {
    rows.splice(target, 0, mine);
    return numbered(rows);
  }
  // Below the top of the list: after it, with the real place.
  return [...numbered(rows), { ...mine, place: me.projectedPlace }];
}
