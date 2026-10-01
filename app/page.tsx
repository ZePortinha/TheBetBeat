import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signToken } from "@/lib/security/tokens";

export const dynamic = "force-dynamic";

/**
 * Dev index — not a product surface. Lists entry points into the four
 * surfaces using the seeded data, with correctly signed QR/display tokens.
 */
export default async function DevIndex() {
  const t = await getTranslations("common.devIndex");

  let guestHref: string | null = null;
  let displayHref: string | null = null;
  try {
    const supabase = createAdminClient();
    const { data: zone } = await supabase
      .from("zones")
      .select("qr_slug, venue_id")
      .eq("qr_slug", "zone-pista-dev")
      .single();
    const { data: session } = await supabase
      .from("sessions")
      .select("display_slug, venue_id")
      .eq("status", "live")
      .limit(1)
      .single();
    if (zone) {
      guestHref = `/s/${encodeURIComponent(
        signToken({ kind: "zone", venueId: zone.venue_id, slug: zone.qr_slug }),
      )}`;
    }
    if (session) {
      displayHref = `/display/${encodeURIComponent(
        signToken({
          kind: "display",
          venueId: session.venue_id,
          slug: session.display_slug,
        }),
      )}`;
    }
  } catch {
    // Database not up yet — show the static links below.
  }

  const linkCls =
    "block rounded-card bg-surface-1 border border-line-subtle px-6 py-5 " +
    "text-text-primary hover:bg-surface-2 transition-colors";

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-4 py-12">
      <h1
        className="mb-1 text-2xl font-bold text-gold-500"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {t("title")}
      </h1>
      <p className="mb-5 text-sm text-text-secondary">{t("hint")}</p>
      {guestHref ? (
        <Link className={linkCls} href={guestHref}>
          {t("guest")}
        </Link>
      ) : null}
      <Link className={linkCls} href="/cockpit">
        {t("cockpit")}
      </Link>
      {displayHref ? (
        <Link className={linkCls} href={displayHref}>
          {t("display")}
        </Link>
      ) : null}
      <Link className={linkCls} href="/console">
        {t("console")}
      </Link>
    </main>
  );
}
