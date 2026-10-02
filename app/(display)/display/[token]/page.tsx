import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { verifyToken } from "@/lib/security/tokens";
import { getDisplayState } from "@/app/api/display/_lib/state";
import { DisplayScreen } from "@/components/display/display-screen";

/**
 * /display/[token] — the venue screen (BRIEF B8).
 *
 * Server component: verifies the signed display token (kind "display");
 * an invalid or unknown token renders a friendly static error — never a
 * stack trace, never data. The token grants PUBLIC data only; all reads go
 * through the display read model which selects explicit public fields.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("display");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function FriendlyError() {
  const t = await getTranslations("display");
  return (
    <main className="fixed inset-0 flex flex-col items-center justify-center gap-[2vmin] bg-bg-base p-[8vmin] text-center text-text-primary">
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "clamp(2rem, 6vmin, var(--text-56))",
          fontWeight: 800,
          lineHeight: 1.1,
        }}
      >
        {t("error.title")}
      </h1>
      <p
        className="max-w-[40ch] text-text-secondary"
        style={{ fontSize: "clamp(1.125rem, 2.8vmin, var(--text-24))" }}
      >
        {t("error.subtitle")}
      </p>
      <span
        className="mt-[4vmin] text-text-tertiary"
        style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
        aria-hidden="true"
      >
        BetBeat
      </span>
    </main>
  );
}

export default async function DisplayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let raw = token;
  try {
    raw = decodeURIComponent(token);
  } catch {
    // Malformed escape — verify will reject it below.
  }

  const payload = verifyToken(raw);
  if (!payload || payload.kind !== "display") {
    return <FriendlyError />;
  }

  const state = await getDisplayState(payload);
  if (!state) {
    return <FriendlyError />;
  }

  return (
    <DisplayScreen sessionId={state.sessionId} token={raw} initial={state.dto} />
  );
}
