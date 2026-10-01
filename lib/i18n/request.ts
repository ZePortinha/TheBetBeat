import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

export const LOCALES = ["pt-PT", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "pt-PT";

const NAMESPACES = ["common", "guest", "cockpit", "display", "console"] as const;

type Messages = Record<string, unknown>;

async function loadMessages(locale: Locale): Promise<Messages> {
  const out: Messages = {};
  for (const ns of NAMESPACES) {
    try {
      const mod = (await import(`@/messages/${locale}/${ns}.json`)) as {
        default: Messages;
      };
      out[ns] = mod.default;
    } catch {
      out[ns] = {};
    }
  }
  return out;
}

function deepMerge(base: Messages, over: Messages): Messages {
  const out: Messages = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    if (
      v &&
      b &&
      typeof v === "object" &&
      typeof b === "object" &&
      !Array.isArray(v) &&
      !Array.isArray(b)
    ) {
      out[k] = deepMerge(b as Messages, v as Messages);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get("bb-locale")?.value;
  const locale: Locale = (LOCALES as readonly string[]).includes(cookieLocale ?? "")
    ? (cookieLocale as Locale)
    : DEFAULT_LOCALE;

  // pt-PT is the complete base; EN overlays it (staff surfaces are pt-PT only).
  const base = await loadMessages(DEFAULT_LOCALE);
  const messages =
    locale === DEFAULT_LOCALE ? base : deepMerge(base, await loadMessages(locale));

  return { locale, messages, timeZone: "Europe/Lisbon" };
});
