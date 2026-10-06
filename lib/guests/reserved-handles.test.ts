import { describe, expect, it } from "vitest";
import { isReservedHandle } from "./reserved-handles";

describe("isReservedHandle", () => {
  it("blocks the house, the staff and look-alikes", () => {
    for (const h of ["betbeat", "@BetBeat", "b3tb34t", "bet.beat", "betbeat_pt", "oficialbetbeat", "dj", "DJ_", "admin1", "suporte", "s3gur4nca"]) {
      expect(isReservedHandle(h), h).toBe(true);
    }
  });

  it("lets ordinary names through", () => {
    for (const h of ["rita.m", "joao_22", "djamila", "marta", "casanova", "tiago-b"]) {
      expect(isReservedHandle(h), h).toBe(false);
    }
  });
});
