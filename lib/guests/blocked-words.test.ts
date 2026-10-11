import { describe, expect, it } from "vitest";
import { hasBlockedWord, isOffensiveHandle } from "./blocked-words";

describe("isOffensiveHandle", () => {
  it("blocks insults and slurs in Portuguese and English, disguised or not", () => {
    for (const h of [
      "caralho",
      "@Caralho",
      "o.caralho_22",
      "c4r4lh0",
      "f0d4",
      "fodase",
      "merdas",
      "porra",
      "filho.da.puta",
      "puta",
      "rita.cona",
      "cona_22",
      "cu",
      "pi.la",
      "paneleiro",
      "fuck",
      "fuuuck",
      "xfuckx",
      "sh1t",
      "b1tch",
      "nigger",
      "faggot",
      "nazi88",
      "h1tler",
      "dick",
      "big.dick",
      "kkk",
      "s3x0",
    ]) {
      expect(isOffensiveHandle(h), h).toBe(true);
    }
  });

  it("lets innocent names that contain those letters through", () => {
    for (const h of [
      "rita.m",
      "joao_22",
      "computador",
      "pilates",
      "sexta.feira",
      "torpedo",
      "incorporar",
      "assis",
      "cocktail",
      "dickens",
      "analise",
      "cumbia",
      "therapist",
      "fukuoka",
      "maconaria",
      "casanova",
      "marta",
      "kiko",
    ]) {
      expect(isOffensiveHandle(h), h).toBe(false);
    }
  });
});

describe("hasBlockedWord (free text)", () => {
  it("checks short messages word by word", () => {
    expect(hasBlockedWord("vai cona")).toBe(true);
    expect(hasBlockedWord("f0d4-s3")).toBe(true);
    expect(hasBlockedWord("boa noite!")).toBe(false);
    expect(hasBlockedWord("sexta top")).toBe(false);
  });
});
