/**
 * @handles nobody can pick (2026-10-06). The @ shows on the venue screen
 * and in the ranking, so a guest calling themselves "@ritmo" or "@dj"
 * could pass for the house or the staff. Compared without separators or
 * digits, so "@dj.oficial" or "@b3tbeat_" are caught too. The client gets
 * the same answer as a taken @ ("handle_taken").
 */

const RESERVED = [
  // The brand (Ritmo since 2026-10-13; "ritmo" is also a common word, so only
  // the brand-like spellings are blocked, not every @ that contains it).
  "ritmo",
  "theritmo",
  "ritmoapp",
  "ritmopt",
  "ritmooficial",
  "oficialritmo",
  "ritmoofficial",
  "officialritmo",
  "equiparitmo",
  "teamritmo",
  // The old name.
  "betbeat",
  "thebetbeat",
  "admin",
  "administrador",
  "administrator",
  "staff",
  "equipa",
  "dj",
  "thedj",
  "djoficial",
  "oficial",
  "official",
  "suporte",
  "support",
  "ajuda",
  "help",
  "moderador",
  "moderator",
  "gerente",
  "manager",
  "casa",
  "seguranca",
  "security",
  "sistema",
  "system",
  "root",
  "anonimo",
  "anonymous",
];

/** Collapses look-alikes: separators out, common digit swaps back to letters. */
function normalise(handle: string): string {
  return handle
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[._-]/g, "")
    // Trailing numbers first ("admin1"), then digits used as letters ("b3tb34t").
    .replace(/\d+$/, "")
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t");
}

const RESERVED_SET = new Set(RESERVED);

export function isReservedHandle(handle: string): boolean {
  const n = normalise(handle);
  if (RESERVED_SET.has(n)) return true;
  // The old brand anywhere in the name ("@betbeatpt", "@oficialbetbeat").
  return n.includes("betbeat");
}
