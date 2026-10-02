import { getTranslations } from "next-intl/server";
import { Scale } from "lucide-react";
import { query } from "@/lib/db";
import { EmptyState } from "@/components/ui/empty-state";
import { Chip } from "@/components/ui/fit-chip";
import { PageHeader } from "@/components/console/page-header";
import { Stat } from "@/components/console/stat";
import { Table, Td, Th, THead, Tr } from "@/components/console/table";
import { formatDateTime, formatEuros, requireAdminConsole } from "../../_lib/context";

export const dynamic = "force-dynamic";

/** Shape written by worker/jobs/reconciliation.ts (audit_log payload). */
interface ReconciliationPayload {
  day?: string;
  windowStart?: string;
  windowEnd?: string;
  ok?: boolean;
  activity?: {
    capturedCents?: number;
    refundedCents?: number;
    recognizedCents?: number;
    payoutCents?: number;
  };
  totals?: {
    paymentsCapturedCents?: number;
    ledgerCapturedCents?: number;
    refundsSucceededCents?: number;
    ledgerRefundedCents?: number;
    payoutsPaidCents?: number;
    ledgerPayoutCents?: number;
  };
  mismatches?: Array<{
    kind?: string;
    tableCents?: number;
    ledgerCents?: number;
    deltaCents?: number;
  }>;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Admin BetBeat — Reconciliação (B9 admin / B4.3): renders the latest
 * daily reconciliation report (audit_log 'reconciliation.daily') and the
 * last two weeks of verdicts. Read-only — the worker is the author.
 */
export default async function AdminReconciliationPage() {
  await requireAdminConsole("/console/admin/reconciliacao");
  const t = await getTranslations("console.admin.reconciliation");

  const history = (
    await query<{ id: string; entity_id: string | null; payload: ReconciliationPayload; created_at: string }>(
      `select id, entity_id, payload, created_at
         from public.audit_log
        where action = 'reconciliation.daily'
        order by created_at desc
        limit 14`,
    )
  ).rows;

  const latest = history[0];

  if (!latest) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader crumbs={[{ label: t("crumbRoot") }, { label: t("title") }]} title={t("title")} />
        <EmptyState icon={Scale} title={t("emptyTitle")} hint={t("emptyHint")} />
      </div>
    );
  }

  const report = latest.payload ?? {};
  const ok = report.ok === true;
  const activity = report.activity ?? {};
  const totals = report.totals ?? {};
  const mismatches = report.mismatches ?? [];

  const pairs: Array<{ kind: string; table: number; ledger: number }> = [
    {
      kind: "captures",
      table: num(totals.paymentsCapturedCents),
      ledger: num(totals.ledgerCapturedCents),
    },
    {
      kind: "refunds",
      table: num(totals.refundsSucceededCents),
      ledger: num(totals.ledgerRefundedCents),
    },
    {
      kind: "payouts",
      table: num(totals.payoutsPaidCents),
      ledger: num(totals.ledgerPayoutCents),
    },
  ];

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        crumbs={[{ label: t("crumbRoot") }, { label: t("title") }]}
        title={t("title")}
        actions={
          <Chip tone={ok ? "green" : "ember"}>{ok ? t("verdict.ok") : t("verdict.mismatch")}</Chip>
        }
      />

      <section className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary tnum">
          {t("reportFor", {
            day: report.day ?? latest.entity_id ?? "—",
            at: formatDateTime(latest.created_at),
          })}
        </p>
        <div className="grid grid-cols-4 gap-4">
          <Stat label={t("activity.captured")} value={formatEuros(num(activity.capturedCents))} money />
          <Stat label={t("activity.refunded")} value={formatEuros(num(activity.refundedCents))} />
          <Stat
            label={t("activity.recognized")}
            value={formatEuros(num(activity.recognizedCents))}
          />
          <Stat label={t("activity.payout")} value={formatEuros(num(activity.payoutCents))} />
        </div>
        <p className="text-xs text-text-tertiary">{t("activity.hint")}</p>
      </section>

      <section>
        <h2 className="pb-3 text-lg font-semibold text-text-primary">{t("totals.title")}</h2>
        <Table>
          <THead>
            <Th>{t("totals.flow")}</Th>
            <Th align="right">{t("totals.table")}</Th>
            <Th align="right">{t("totals.ledger")}</Th>
            <Th align="right">{t("totals.delta")}</Th>
            <Th>{t("totals.state")}</Th>
          </THead>
          <tbody>
            {pairs.map((p) => {
              const delta = p.table - p.ledger;
              return (
                <Tr key={p.kind}>
                  <Td className="font-semibold text-text-primary">{t(`flows.${p.kind}`)}</Td>
                  <Td align="right" numeric>
                    {formatEuros(p.table)}
                  </Td>
                  <Td align="right" numeric>
                    {formatEuros(p.ledger)}
                  </Td>
                  <Td align="right" numeric className={delta === 0 ? undefined : "text-ember-500"}>
                    {formatEuros(delta)}
                  </Td>
                  <Td>
                    <Chip tone={delta === 0 ? "green" : "ember"}>
                      {delta === 0 ? t("verdict.ok") : t("verdict.mismatch")}
                    </Chip>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
        <p className="pt-2 text-xs text-text-tertiary">{t("totals.hint")}</p>
      </section>

      {mismatches.length > 0 ? (
        <section className="rounded-card border border-ember-500/40 bg-surface-1 p-5">
          <h2 className="pb-2 text-lg font-semibold text-ember-500">{t("mismatches.title")}</h2>
          <p className="pb-3 text-sm text-text-secondary">{t("mismatches.hint")}</p>
          <ul className="flex flex-col gap-1 text-sm tnum">
            {mismatches.map((m, i) => (
              <li key={`${m.kind ?? "?"}-${i}`} className="text-text-primary">
                {t.has(`flows.${m.kind ?? ""}`) ? t(`flows.${m.kind ?? ""}`) : (m.kind ?? "?")}
                {": "}
                {t("mismatches.line", {
                  table: formatEuros(num(m.tableCents)),
                  ledger: formatEuros(num(m.ledgerCents)),
                  delta: formatEuros(num(m.deltaCents)),
                })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="pb-3 text-lg font-semibold text-text-primary">{t("history.title")}</h2>
        <Table>
          <THead>
            <Th>{t("history.day")}</Th>
            <Th>{t("history.ranAt")}</Th>
            <Th align="right">{t("activity.captured")}</Th>
            <Th align="right">{t("activity.refunded")}</Th>
            <Th>{t("history.verdict")}</Th>
          </THead>
          <tbody>
            {history.map((row) => {
              const p = row.payload ?? {};
              return (
                <Tr key={row.id}>
                  <Td numeric className="font-semibold text-text-primary">
                    {p.day ?? row.entity_id ?? "—"}
                  </Td>
                  <Td numeric>{formatDateTime(row.created_at)}</Td>
                  <Td align="right" numeric>
                    {formatEuros(num(p.activity?.capturedCents))}
                  </Td>
                  <Td align="right" numeric>
                    {formatEuros(num(p.activity?.refundedCents))}
                  </Td>
                  <Td>
                    <Chip tone={p.ok === true ? "green" : "ember"}>
                      {p.ok === true ? t("verdict.ok") : t("verdict.mismatch")}
                    </Chip>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
