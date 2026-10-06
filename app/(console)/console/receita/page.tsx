import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Banknote } from "lucide-react";
import { query } from "@/lib/db";
import { sessionStatement, type LedgerEntryRow } from "@/lib/ledger/balances";
import { EmptyState } from "@/components/ui/empty-state";
import { Chip, type ChipTone } from "@/components/ui/fit-chip";
import { PageHeader } from "@/components/console/page-header";
import { Stat } from "@/components/console/stat";
import { formatDateTime, formatEuros, requireConsole } from "../_lib/context";

export const dynamic = "force-dynamic";

const PAYOUT_TONE: Record<string, ChipTone> = {
  pending: "neutral",
  processing: "amber",
  paid: "green",
  failed: "ember",
};

/**
 * Receita (B9.5): every money number is derived SERVER-SIDE from the
 * immutable double-entry ledger (sessionStatement) — read-only DTOs,
 * no client ever recomputes money.
 */
export default async function RevenuePage() {
  const ctx = await requireConsole("/console/receita");
  const t = await getTranslations("console.revenue");
  const venue = ctx.activeVenue;
  if (!venue) redirect("/console");

  const [ledgerRes, sessionsRes, payoutsRes, refundsRes, invoicesRes] =
    await Promise.all([
      query<LedgerEntryRow & { session_id: string | null }>(
        `select account, amount_cents, session_id
           from public.ledger_entries
          where venue_id = $1`,
        [venue.id],
      ),
      query<{ id: string; name: string; starts_at: string; status: string }>(
        `select id, name, starts_at, status from public.sessions
          where venue_id = $1 order by starts_at desc limit 50`,
        [venue.id],
      ),
      query<{
        id: string;
        recipient_type: string;
        amount_cents: string;
        status: string;
        created_at: string;
        session_name: string;
      }>(
        `select p.id, p.recipient_type, p.amount_cents, p.status, p.created_at,
                s.name as session_name
           from public.payouts p
           join public.sessions s on s.id = p.session_id
          where p.venue_id = $1
          order by p.created_at desc limit 20`,
        [venue.id],
      ),
      query<{
        id: string;
        amount_cents: number;
        reason: string;
        status: string;
        created_at: string;
      }>(
        `select rf.id, rf.amount_cents, rf.reason, rf.status, rf.created_at
           from public.refunds rf
           join public.payments p on p.id = rf.payment_id
           left join public.requests r on r.id = rf.request_id
          where coalesce(p.venue_id, r.venue_id) = $1
          order by rf.created_at desc limit 20`,
        [venue.id],
      ),
      query<{
        id: string;
        amount_cents: number;
        status: string;
        provider_ref: string | null;
        created_at: string;
      }>(
        `select i.id, i.amount_cents, i.status, i.provider_ref, i.created_at
           from public.invoices i
           left join public.requests r on r.id = i.request_id
           left join public.auction_slots s on s.id = i.auction_slot_id
          where coalesce(r.venue_id, s.venue_id) = $1
          order by i.created_at desc limit 20`,
        [venue.id],
      ),
    ]);

  const overall = sessionStatement(ledgerRes.rows);

  // Per-session statements from the same ledger rows.
  const bySession = new Map<string, LedgerEntryRow[]>();
  for (const row of ledgerRes.rows) {
    if (!row.session_id) continue;
    const list = bySession.get(row.session_id) ?? [];
    list.push(row);
    bySession.set(row.session_id, list);
  }

  return (
    <div className="flex flex-col gap-10">
      <div>
        <PageHeader
          crumbs={[{ label: t("crumbRoot") }, { label: t("title") }]}
          title={t("title")}
        />
        <div className="grid grid-cols-5 gap-4">
          <Stat label={t("gmv")} value={formatEuros(overall.gmv)} money testId="revenue-gmv" />
          <Stat
            label={t("venueNet")}
            value={formatEuros(overall.venueNet)}
            money
            testId="revenue-venue-net"
          />
          <Stat label={t("djNet")} value={formatEuros(overall.djNet)} />
          <Stat label={t("betbeatFee")} value={formatEuros(overall.betbeatFee)} />
          <Stat label={t("refunds")} value={formatEuros(overall.refunds)} />
        </div>
      </div>

      <section>
        <h2 className="pb-3 text-lg font-semibold text-text-primary">{t("bySession")}</h2>
        {sessionsRes.rows.length === 0 ? (
          <EmptyState icon={Banknote} title={t("emptyTitle")} hint={t("emptyHint")} />
        ) : (
          <div className="overflow-hidden rounded-card border border-line-subtle">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line-subtle bg-surface-1 text-text-tertiary">
                  <th className="label px-4 py-3">{t("session")}</th>
                  <th className="label px-4 py-3 text-right">{t("gmv")}</th>
                  <th className="label px-4 py-3 text-right">{t("venueNet")}</th>
                  <th className="label px-4 py-3 text-right">{t("djNet")}</th>
                  <th className="label px-4 py-3 text-right">{t("refunds")}</th>
                  <td className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {sessionsRes.rows.map((s) => {
                  const st = sessionStatement(bySession.get(s.id) ?? []);
                  return (
                    <tr
                      key={s.id}
                      data-testid="revenue-session-row"
                      data-session-id={s.id}
                      className="border-b border-line-subtle last:border-0"
                    >
                      <td className="px-4 py-3">
                        <p className="font-semibold text-text-primary">{s.name}</p>
                        <p className="text-xs text-text-tertiary tnum">
                          {formatDateTime(s.starts_at)}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right text-accent-400 tnum">
                        {formatEuros(st.gmv)}
                      </td>
                      <td className="px-4 py-3 text-right text-text-primary tnum">
                        {formatEuros(st.venueNet)}
                      </td>
                      <td className="px-4 py-3 text-right text-text-secondary tnum">
                        {formatEuros(st.djNet)}
                      </td>
                      <td className="px-4 py-3 text-right text-text-secondary tnum">
                        {formatEuros(st.refunds)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/console/receita/${s.id}`}
                          className="font-semibold text-accent-400 hover:text-accent-300"
                        >
                          {t("statement")}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-8">
        <div>
          <h2 className="pb-3 text-lg font-semibold text-text-primary">{t("payouts")}</h2>
          {payoutsRes.rows.length === 0 ? (
            <p data-testid="revenue-payouts-empty" className="text-sm text-text-tertiary">
              {t("noPayouts")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {payoutsRes.rows.map((p) => (
                <li
                  key={p.id}
                  data-testid="revenue-payout"
                  data-recipient={p.recipient_type}
                  data-status={p.status}
                  className="flex items-center justify-between gap-3 rounded-card border border-line-subtle bg-surface-1 px-4 py-3 text-sm"
                >
                  <div>
                    <p className="font-semibold text-text-primary">
                      {t(`recipient.${p.recipient_type}`)} · {p.session_name}
                    </p>
                    <p className="text-xs text-text-tertiary tnum">
                      {formatDateTime(p.created_at)}
                    </p>
                  </div>
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
        </div>
        <div>
          <h2 className="pb-3 text-lg font-semibold text-text-primary">
            {t("refundsTitle")}
          </h2>
          {refundsRes.rows.length === 0 ? (
            <p className="text-sm text-text-tertiary">{t("noRefunds")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {refundsRes.rows.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-card border border-line-subtle bg-surface-1 px-4 py-3 text-sm"
                >
                  <div>
                    <p className="font-semibold text-text-primary">
                      {t.has(`refundReason.${r.reason}`)
                        ? t(`refundReason.${r.reason}`)
                        : r.reason}
                    </p>
                    <p className="text-xs text-text-tertiary tnum">
                      {formatDateTime(r.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-text-primary tnum">
                      {formatEuros(r.amount_cents)}
                    </span>
                    <Chip tone={r.status === "failed" ? "ember" : "neutral"}>
                      {t(`refundStatus.${r.status}`)}
                    </Chip>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <h2 className="pb-3 text-lg font-semibold text-text-primary">{t("invoices")}</h2>
        {invoicesRes.rows.length === 0 ? (
          <p className="text-sm text-text-tertiary">{t("noInvoices")}</p>
        ) : (
          <div className="overflow-hidden rounded-card border border-line-subtle">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line-subtle bg-surface-1 text-text-tertiary">
                  <th className="label px-4 py-3">{t("invoiceRef")}</th>
                  <th className="label px-4 py-3 text-right">{t("amount")}</th>
                  <th className="label px-4 py-3">{t("status")}</th>
                  <th className="label px-4 py-3">{t("date")}</th>
                </tr>
              </thead>
              <tbody>
                {invoicesRes.rows.map((inv) => (
                  <tr key={inv.id} className="border-b border-line-subtle last:border-0">
                    <td className="px-4 py-3 text-text-primary">
                      {inv.provider_ref ?? inv.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 text-right text-text-primary tnum">
                      {formatEuros(inv.amount_cents)}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{t(`invoiceStatus.${inv.status}`)}</td>
                    <td className="px-4 py-3 text-text-secondary tnum">
                      {formatDateTime(inv.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
