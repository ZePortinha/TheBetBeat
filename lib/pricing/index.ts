/**
 * Pricing engine (BRIEF B5) — pure functions only. The quote service lives
 * outside this module and adds quoteId/expiresAt + persistence.
 */
export * from "./compute";
export * from "./eta";
export * from "./fit";
export type * from "./types";
