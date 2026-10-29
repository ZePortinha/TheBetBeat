import { describe, expect, it } from "vitest";
import { isReservedHandle } from "./reserved-handles";

describe("isReservedHandle", () => {
  it("blocks the house, the staff and look-alikes", () => {
    for (const h of ["discontrol", "@Discontrol", "d1sc0ntr0l", "discontrol_pt", "oficial.discontrol", "ritma", "@Ritma", "ritma_oficial", "r1tm4.pt", "theritma", "ritmo", "ritmo_oficial", "betbeat", "@BetBeat", "b3tb34t", "bet.beat", "betbeat_pt", "oficialbetbeat", "dj", "DJ_", "admin1", "suporte", "s3gur4nca"]) {
      expect(isReservedHandle(h), h).toBe(true);
    }
  });

  it("lets ordinary names through", () => {
    for (const h of ["rita.m", "joao_22", "djamila", "marta", "casanova", "tiago-b", "ritmoquente", "disco_lover", "control.freak"]) {
      expect(isReservedHandle(h), h).toBe(false);
    }
  });
});
