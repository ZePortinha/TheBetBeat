import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { publicAuctionState } from "@/lib/auction/service";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { RankingShareCard, RANKING_CARD_SIZE } from "@/components/ui/ranking-share-card";
import { apiError, rateLimitedResponse } from "../../_lib/http";
import { getGuestIdentity } from "../../_lib/auth";
import { resolveGuestContext } from "../../_lib/context";

export const dynamic = "force-dynamic";

const querySchema = z.object({ token: z.string().min(1).max(1024) }).strict();

/** "€" amounts like the app: "12 €", "12,50 €". */
function euros(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/**
 * GET /api/guest/ranking/card?token=… — tonight's ranking ("Top da noite")
 * as a 1080×1920 Story image. Only what the Ranking tab already shows to
 * everyone at the party (public @ / table / "Anónimo" and amounts).
 */
export async function GET(request: Request) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);
  if (!rateLimit(`ranking-card:${identity.guestId}`, LIMITS.search.limit, LIMITS.search.windowMs).ok) {
    return rateLimitedResponse();
  }
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return apiError("invalid_request", 400);
  const resolved = await resolveGuestContext(query.data.token);
  if (!resolved.ok) return apiError("invalid_token", 404);

  const now = Date.now();
  const state = await publicAuctionState(resolved.ctx.sessionId, now);
  if (!state || state.ranking.length === 0) return apiError("not_found", 404);

  const t = await getTranslations("guest.rankingCard");
  const locale = t("locale");
  const date = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: "Europe/Lisbon" }).format(now).replace(/\.$/, "");

  return new ImageResponse(
    (
      <RankingShareCard
        eyebrow={t("eyebrow")}
        title={t("title")}
        venueName={resolved.ctx.venueName}
        dateLabel={`${date({ weekday: "short" })} ${date({ day: "numeric" })} ${date({ month: "short" })}`}
        entries={state.ranking.slice(0, 8).map((r) => ({ name: r.label ?? t("anonymous"), amount: euros(r.spentCents, locale) }))}
        footnote={t("footnote")}
      />
    ),
    RANKING_CARD_SIZE,
  );
}
