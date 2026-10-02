import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { query } from "@/lib/db";
import { sessionStatement, type LedgerEntryRow } from "@/lib/ledger/balances";
import { Chip, type ChipTone } from "@/components/ui/fit-chip";
import { PageHeader } from "@/components/console/page-header";
import { Stat } from "@/components/console/stat";
import { formatDateTime, formatEuros, requireConsole } from "../../_lib/context";

export const dynamic = "force-dynamic";

const PAYOUT_TONE: Record<string, ChipTone> = {
  pending: "neutral",
  processing: "amber",
  paid: "green",
  failed: "ember",
};

/** Per-session statement (B9.5) — pure ledger derivation, server-only. */
export default async function SessionStatementPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) notFound();

  const ctx = await requireConsole(`/console/receita/${sessionId}`);
  const t = await getTranslations("console.revenue");
  const venue = ctx.activeVenue;
  if (!venue) redirect("/console");

  const sessionRes = await query<{
    id: string;
    name: string;
    starts_at: string;
    status: string;
  }>(
    `select id, name, starts_at, status from public.sessions
      where id = $1 and venue_id = $2`,
    [sessionId, venue.id],
  );
  const session = sessionRes.rows[0];
  if (!session) notFound();

  const [ledgerRes, payoutsRes, requestsRes] = await Promise.all([
    query<LedgerEntryRow>(
      `select account, amount_cents from public.ledger_entries
        where session_id = $1 and venue_id = $2`,
      [sessionId, venue.id],
    ),
    query<{
      id: string;
      recipient_type: string;
      amount_cents: string;
      status: string;
    }>(
      `select id, recipient_type, amount_cents, status
         from public.payouts where session_id = $1 and venue_id = $2
        order by recipient_type asc`,
      [sessionId, venue.id],
    ),
    query<{ total: string; played: string; refunded: string }>(
      `select count(*)::bigint as total,
              count(*) filter (where status = 'played')::bigint as played,
              count(*) filter (where status = 'refunded')::bigint as refunded
         from public.requests where session_id = $1 and venue_id = $2`,
      [sessionId, venue.id],
    ),
  ]);

  const statement = sessionStatement(ledgerRes.rows);
  const counts = requestsRes.rows[0];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        crumbs={[
          { label: t("crumbRoot") },
          { label: t("title"), href: "/console/receita" },
          { label: session.name },
        ]}
        title={session.name}
      />

      <p className="text-sm text-text-tertiary tnum">
        {formatDateTime(session.starts_at)} · {t(`sessionStatus.${session.status}`)}
      </p>

      <div className="grid grid-cols-5 gap-4">
        <Stat label={t("gmv")} value={formatEuros(statement.gmv)} money testId="statement-gmv" />
        <Stat
          label={t("venueNet")}
          value={formatEuros(statement.venueNet)}
          money
          testId="statement-venue-net"
        />
        <Stat label={t("djNet")} value={formatEuros(statement.djNet)} testId="statement-dj-net" />
        <Stat
          label={t("betbeatFee")}
          value={formatEuros(statement.betbeatFee)}
          testId="statement-betbeat-fee"
        />
        <Stat label={t("refunds")} value={formatEuros(statement.refunds)} testId="statement-refunds" />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat
          label={t("requestsTotal")}
          value={String(counts?.total ?? 0)}
          testId="statement-requests-total"
        />
        <Stat label={t("requestsPlayed")} value={String(counts?.played ?? 0)} />
        <Stat label={t("requestsRefunded")} value={String(counts?.refunded ?? 0)} />
      </div>

      <section data-testid="statement-payouts">
        <h2 className="pb-3 text-lg font-semibold text-text-primary">{t("payouts")}</h2>
        {payoutsRes.rows.length === 0 ? (
          <p data-testid="statement-payouts-empty" className="text-sm text-text-tertiary">
            {t("noPayouts")}
          </p>
        ) : (
          <ul className="flex max-w-xl flex-col gap-2">
            {payoutsRes.rows.map((p) => (
              <li
                key={p.id}
                data-testid="statement-payout"
                data-recipient={p.recipient_type}
                data-status={p.status}
                className="flex items-center justify-between gap-3 rounded-card border border-line-subtle bg-surface-1 px-4 py-3 text-sm"
              >
                <span className="font-semibold text-text-primary">
                  {t(`recipient.${p.recipient_type}`)}
                </span>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-text-primary tnum">
                    {formatEuros(Number(p.amount_cents))}
                  </span>
                  <Chip tone={PAYOUT_TONE[p.status] ?? "neutral"}>
                    {t(`payoutStatus.${p.status}`)}
                  </Chip>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
