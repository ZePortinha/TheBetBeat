/**
 * Portuguese mobile numbers (MB WAY / SMS): accepts what staff paste
 * ("912 345 678", "+351912345678", "00351 912-345-678") and returns E.164.
 */

/** One number → "+3519XXXXXXXX", or null when it is not a PT mobile. */
export function normalizePtMobile(raw: string): string | null {
  const digits = raw.replace(/[\s().-]/g, "").replace(/^(\+|00)/, "");
  const national = digits.length === 12 && digits.startsWith("351") ? digits.slice(3) : digits;
  return /^9\d{8}$/.test(national) ? `+351${national}` : null;
}

/** A pasted list (lines, commas or semicolons) → unique valid + the rejects. */
export function parsePtMobiles(text: string): { valid: string[]; invalid: string[] } {
  const valid = new Set<string>();
  const invalid: string[] = [];
  for (const entry of text.split(/[\n,;]+/)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const phone = normalizePtMobile(trimmed);
    if (phone) valid.add(phone);
    else invalid.push(trimmed);
  }
  return { valid: [...valid], invalid };
}
