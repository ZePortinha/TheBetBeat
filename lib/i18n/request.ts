import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

export const LOCALES = ["pt-PT", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "pt-PT";

type Messages = Record<string, unknown>;
type Loader = () => Promise<{ default: Messages }>;

/**
 * Explicit import map (literal paths work in both webpack and Turbopack;
 * template-literal dynamic imports do not). pt-PT is the complete base;
 * EN exists only for the guest surface and overlays pt-PT.
 */
const LOADERS: Record<Locale, Record<string, Loader>> = {
  "pt-PT": {
    common: () => import("@/messages/pt-PT/common.json"),
    guest: () => import("@/messages/pt-PT/guest.json"),
    cockpit: () => import("@/messages/pt-PT/cockpit.json"),
    display: () => import("@/messages/pt-PT/display.json"),
    console: () => import("@/messages/pt-PT/console.json"),
  },
  en: {
    common: () => import("@/messages/en/common.json"),
    guest: () => import("@/messages/en/guest.json"),
  },
};

async function loadMessages(locale: Locale): Promise<Messages> {
  const out: Messages = {};
  for (const [ns, load] of Object.entries(LOADERS[locale])) {
    try {
      out[ns] = (await load()).default;
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

  const base = await loadMessages(DEFAULT_LOCALE);
  const messages =
    locale === DEFAULT_LOCALE ? base : deepMerge(base, await loadMessages(locale));

  return { locale, messages, timeZone: "Europe/Lisbon" };
});
