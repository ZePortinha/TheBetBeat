import { getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";
import { query } from "@/lib/db";
import { EmptyState } from "@/components/ui/empty-state";
import { Chip } from "@/components/ui/fit-chip";
import { PageHeader } from "@/components/console/page-header";
import { Table, Td, Th, THead, Tr } from "@/components/console/table";
import { formatDateTime, formatEuros, requireAdminConsole } from "../../_lib/context";
import { retryRefundAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Admin BetBeat — Falhas de pagamento e de reembolso (B9 admin).
 * Failed payments are informational (the guest simply never paid);
 * failed refunds are money owed to a guest (B4.4) and carry "Repetir".
 */
export default async function AdminFailuresPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; retried?: string }>;
}) {
  await requireAdminConsole("/console/admin/falhas");
  const t = await getTranslations("console.admin.failures");
  const { error, retried } = await searchParams;

  const [paymentsRes, refundsRes] = await Promise.all([
    query<{
      id: string;
      status: string;
      method: string;
      provider: string;
      amount_cents: number;
      created_at: string;
      venue_name: string;
      session_name: string;
      track_title: string;
      track_artist: string;
    }>(
      `select p.id, p.status::text, p.method::text, p.provider, p.amount_cents, p.created_at,
              v.name as venue_name, s.name as session_name,
              r.track_title, r.track_artist
         from public.payments p
         join public.requests r on r.id = p.request_id
         join public.sessions s on s.id = r.session_id
         join public.venues v on v.id = r.venue_id
        where p.status = 'failed'
        order by p.created_at desc
        limit 100`,
    ),
    query<{
      id: string;
      status: string;
      amount_cents: number;
      reason: string;
      attempts: number;
      last_error: string | null;
      updated_at: string;
      created_at: string;
      venue_name: string;
      session_name: string;
      track_title: string;
      track_artist: string;
      has_provider_ref: boolean;
    }>(
      `select rf.id, rf.status::text, rf.amount_cents, rf.reason, rf.attempts, rf.last_error,
              rf.updated_at, rf.created_at,
              v.name as venue_name, s.name as session_name,
              r.track_title, r.track_artist,
              (p.provider_ref is not null) as has_provider_ref
         from public.refunds rf
         join public.payments p on p.id = rf.payment_id
         join public.requests r on r.id = rf.request_id
         join public.sessions s on s.id = r.session_id
         join public.venues v on v.id = r.venue_id
        where rf.status = 'failed'
           or (rf.status in ('pending', 'processing')
               and rf.updated_at < now() - interval '10 minutes')
        order by rf.updated_at desc
        limit 100`,
    ),
  ]);

  const failedRefunds = refundsRes.rows;
  const owedCents = failedRefunds
    .filter((r) => r.status === "failed")
    .reduce((sum, r) => sum + r.amount_cents, 0);

  return (
    <div className="flex flex-col gap-10">
      <PageHeader crumbs={[{ label: t("crumbRoot") }, { label: t("title") }]} title={t("title")} />

      {error ? (
        <p role="alert" className="text-sm text-ember-500">
          {t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.invalid")}
        </p>
      ) : null}
      {retried ? (
        <p role="status" className="text-sm text-green-500">
          {t("retried")}
        </p>
      ) : null}

      <section>
        <div className="flex items-baseline justify-between pb-3">
          <h2 className="text-lg font-semibold text-text-primary">{t("refunds.title")}</h2>
          {owedCents > 0 ? (
            <p className="text-sm text-ember-500 tnum">
              {t("refunds.owed", { amount: formatEuros(owedCents) })}
            </p>
          ) : null}
        </div>
        {failedRefunds.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title={t("refunds.emptyTitle")}
            hint={t("refunds.emptyHint")}
          />
        ) : (
          <Table>
            <THead>
              <Th>{t("when")}</Th>
              <Th>{t("where")}</Th>
              <Th>{t("track")}</Th>
              <Th align="right">{t("amount")}</Th>
              <Th>{t("refunds.reason")}</Th>
              <Th>{t("refunds.state")}</Th>
              <Th align="right">{t("actions")}</Th>
            </THead>
            <tbody>
              {failedRefunds.map((r) => (
                <Tr key={r.id}>
                  <Td numeric>{formatDateTime(r.updated_at)}</Td>
                  <Td>
                    <p className="text-text-primary">{r.venue_name}</p>
                    <p className="text-xs text-text-tertiary">{r.session_name}</p>
                  </Td>
                  <Td>
                    <p className="text-text-primary">{r.track_title}</p>
                    <p className="text-xs text-text-tertiary">{r.track_artist}</p>
                  </Td>
                  <Td align="right" numeric className="font-semibold text-text-primary">
                    {formatEuros(r.amount_cents)}
                  </Td>
                  <Td>
                    {t.has(`refundReason.${r.reason}`) ? t(`refundReason.${r.reason}`) : r.reason}
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-1">
                      <Chip tone={r.status === "failed" ? "ember" : "amber"}>
                        {t(`refundStatus.${r.status}`)}
                        {" · "}
                        {t("refunds.attempts", { count: r.attempts })}
                      </Chip>
                      {r.last_error ? (
                        <p className="max-w-xs truncate text-xs text-text-tertiary" title={r.last_error}>
                          {r.last_error}
                        </p>
                      ) : null}
                      {!r.has_provider_ref ? (
                        <p className="text-xs text-amber-500">{t("refunds.noProviderRef")}</p>
                      ) : null}
                    </div>
                  </Td>
                  <Td align="right">
                    {r.status === "failed" ? (
                      <form action={retryRefundAction}>
                        <input type="hidden" name="refundId" value={r.id} />
                        <button
                          type="submit"
                          className="min-h-9 rounded-button bg-gold-500 px-3 text-sm font-semibold
                            text-text-on-accent transition-transform duration-100 active:scale-[0.97]"
                        >
                          {t("refunds.retry")}
                        </button>
                      </form>
                    ) : (
                      <span className="text-xs text-text-tertiary">{t("refunds.inFlight")}</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="pt-2 text-xs text-text-tertiary">{t("refunds.retryHint")}</p>
      </section>

      <section>
        <h2 className="pb-3 text-lg font-semibold text-text-primary">{t("payments.title")}</h2>
        {paymentsRes.rows.length === 0 ? (
          <p className="text-sm text-text-tertiary">{t("payments.empty")}</p>
        ) : (
          <Table>
            <THead>
              <Th>{t("when")}</Th>
              <Th>{t("where")}</Th>
              <Th>{t("track")}</Th>
              <Th>{t("payments.method")}</Th>
              <Th align="right">{t("amount")}</Th>
            </THead>
            <tbody>
              {paymentsRes.rows.map((p) => (
                <Tr key={p.id}>
                  <Td numeric>{formatDateTime(p.created_at)}</Td>
                  <Td>
                    <p className="text-text-primary">{p.venue_name}</p>
                    <p className="text-xs text-text-tertiary">{p.session_name}</p>
                  </Td>
                  <Td>
                    <p className="text-text-primary">{p.track_title}</p>
                    <p className="text-xs text-text-tertiary">{p.track_artist}</p>
                  </Td>
                  <Td>
                    {t.has(`paymentMethod.${p.method}`) ? t(`paymentMethod.${p.method}`) : p.method}
                    <span className="text-xs text-text-tertiary"> · {p.provider}</span>
                  </Td>
                  <Td align="right" numeric className="text-text-primary">
                    {formatEuros(p.amount_cents)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="pt-2 text-xs text-text-tertiary">{t("payments.hint")}</p>
      </section>
    </div>
  );
}
