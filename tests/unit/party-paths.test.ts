import { describe, expect, it } from "vitest";
import { isWinPath, rankingPath, winPath, winSlotFrom } from "@/components/guest/party-paths";

describe("party paths", () => {
  it("reads the auction back from a winner's page address", () => {
    const path = winPath("tok.en", "c7a41c5f-f855-49da-a42c-ff8aea4f42b2");
    expect(winSlotFrom(path)).toBe("c7a41c5f-f855-49da-a42c-ff8aea4f42b2");
    expect(isWinPath(path)).toBe(true);
  });

  it("is null on every other party page", () => {
    for (const p of ["/s/tok", "/s/tok/top", "/s/tok/auction", "/s/tok/win", "/s/tok/requests/abc"]) {
      expect(winSlotFrom(p)).toBeNull();
    }
    expect(rankingPath("tok", { me: true })).toBe("/s/tok/top?me=1");
  });
});
