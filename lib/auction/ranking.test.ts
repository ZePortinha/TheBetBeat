import { describe, expect, it } from "vitest";
import { personalRanking, placeIn, type MyRank, type SpentRow } from "./ranking";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const ME = "00000000-0000-4000-8000-0000000000ee";

const table: SpentRow[] = [
  { guestId: A, spentCents: 9000 },
  { guestId: B, spentCents: 4000 },
  { guestId: ME, spentCents: 1500 },
  { guestId: C, spentCents: 1000 },
];

describe("placeIn", () => {
  it("gives my place now and once my won song plays", () => {
    expect(placeIn(table, ME, 5360, "@vougaboss")).toEqual({
      place: 3,
      projectedPlace: 2,
      spentCents: 1500,
      pendingCents: 5360,
      label: "@vougaboss",
    });
  });

  it("puts a guest with nothing played yet in by their pending win alone", () => {
    expect(placeIn(table.filter((r) => r.guestId !== ME), ME, 1200, null)).toMatchObject({ place: null, projectedPlace: 3 });
  });

  it("has no place without any money", () => {
    expect(placeIn(table, "00000000-0000-4000-8000-0000000000ff", 0, null)).toMatchObject({ place: null, projectedPlace: null });
  });

  it("breaks ties by guest id, like the SQL", () => {
    expect(placeIn([{ guestId: A, spentCents: 1000 }], ME, 1000, null).projectedPlace).toBe(2);
    expect(placeIn([{ guestId: "ffffffff-0000-4000-8000-000000000000", spentCents: 1000 }], ME, 1000, null).projectedPlace).toBe(1);
  });
});

describe("personalRanking", () => {
  const ranking = [
    { label: "@rita", spentCents: 9000 },
    { label: "Mesa 12", spentCents: 4000 },
    { label: "@vougaboss", spentCents: 1500 },
    { label: null, spentCents: 1000 },
  ];
  const me = (over: Partial<MyRank>): MyRank => ({
    place: 3,
    projectedPlace: 3,
    spentCents: 1500,
    pendingCents: 0,
    label: "@vougaboss",
    ...over,
  });

  it("marks my row where it is when nothing is pending", () => {
    const rows = personalRanking(ranking, me({}));
    expect(rows.map((r) => [r.place, r.label, r.mine])).toEqual([
      [1, "@rita", false],
      [2, "Mesa 12", false],
      [3, "@vougaboss", true],
      [4, null, false],
    ]);
  });

  it("moves my row up to where my won song takes me", () => {
    const rows = personalRanking(ranking, me({ projectedPlace: 2, pendingCents: 5360 }));
    expect(rows.map((r) => [r.place, r.label, r.spentCents, r.mine])).toEqual([
      [1, "@rita", 9000, false],
      [2, "@vougaboss", 6860, true],
      [3, "Mesa 12", 4000, false],
      [4, null, 1000, false],
    ]);
    expect(rows[1]?.pendingCents).toBe(5360);
  });

  it("adds me when I am not in the ranking yet", () => {
    const rows = personalRanking(ranking.slice(0, 2), me({ place: null, spentCents: 0, pendingCents: 5000, projectedPlace: 2 }));
    expect(rows.map((r) => [r.place, r.mine])).toEqual([
      [1, false],
      [2, true],
      [3, false],
    ]);
  });

  it("finds my row by amount and name when the list is a moment older", () => {
    const rows = personalRanking(ranking, me({ place: 2, projectedPlace: 1, pendingCents: 9000 }));
    expect(rows.filter((r) => r.label === "@vougaboss")).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mine: true, place: 1 });
  });

  it("puts me after the list, with my real place, when I am below it", () => {
    const rows = personalRanking(ranking.slice(0, 2), me({ place: null, spentCents: 0, pendingCents: 100, projectedPlace: 57 }));
    expect(rows.at(-1)).toMatchObject({ place: 57, mine: true });
  });

  it("leaves the public list alone without a rank", () => {
    expect(personalRanking(ranking, null).every((r) => !r.mine)).toBe(true);
  });
});
