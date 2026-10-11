import { getTranslations } from "next-intl/server";
import { Building2 } from "lucide-react";
import { query } from "@/lib/db";
import { EmptyState } from "@/components/ui/empty-state";
import { Chip } from "@/components/ui/fit-chip";
import { PageHeader } from "@/components/console/page-header";
import { Table, Td, Th, THead, Tr } from "@/components/console/table";
import { formatEuros, requireAdminConsole } from "../../_lib/context";
import { createVenueAction, updateVenueContractAction } from "./actions";

export const dynamic = "force-dynamic";

const inputCls =
  "w-24 rounded-button border border-line-subtle bg-surface-3 px-2 py-1.5 text-sm " +
  "text-text-primary tnum focus:border-accent-500 focus:outline-none focus:ring-4 focus:ring-accent-500/25";

/**
 * Admin BetBeat — Casas & contratos (B9 admin). Platform admins only.
 * Fee/split live on the venue row; sessions inherit the fee at creation
 * (sessoes/actions.ts never trusts a client-provided fee).
 */
export default async function AdminVenuesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdminConsole("/console/admin/casas");
  const t = await getTranslations("console.admin.venues");
  const { error } = await searchParams;

  const venues = (
    await query<{
      id: string;
      name: string;
      slug: string;
      betbeat_fee_bps: number;
      default_share_bps: number | null;
      sessions: string;
      live: string;
      staff: string;
      gmv_30d: string;
    }>(
      `select v.id, v.name, v.slug, v.betbeat_fee_bps,
              (v.settings->>'defaultVenueShareBps')::int as default_share_bps,
              (select count(*) from public.sessions s where s.venue_id = v.id)::bigint as sessions,
              (select count(*) from public.sessions s
                where s.venue_id = v.id and s.status in ('live', 'paused'))::bigint as live,
              (select count(*) from public.staff st where st.venue_id = v.id)::bigint as staff,
              coalesce((select sum(r.amount_cents - r.refunded_cents) from public.requests r
                where r.venue_id = v.id and r.paid_at >= now() - interval '30 days'), 0)::bigint
                as gmv_30d
         from public.venues v
        order by v.name asc`,
    )
  ).rows;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader crumbs={[{ label: t("crumbRoot") }, { label: t("title") }]} title={t("title")} />

      {error ? (
        <p role="alert" className="text-sm text-ember-500">
          {t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.invalid")}
        </p>
      ) : null}

      <form
        action={createVenueAction}
        className="flex flex-wrap items-end gap-3 rounded-card border border-line-subtle bg-surface-1 p-5"
      >
        <h2 className="w-full text-lg font-semibold text-text-primary">{t("createTitle")}</h2>
        <label className="flex flex-col gap-1.5">
          <span className="label text-text-secondary">{t("name")}</span>
          <input
            name="name"
            required
            maxLength={80}
            className={`${inputCls} w-64`}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label text-text-secondary">{t("slug")}</span>
          <input
            name="slug"
            required
            pattern="[a-z0-9-]{3,60}"
            maxLength={60}
            placeholder={t("slugPlaceholder")}
            className={`${inputCls} w-56`}
          />
        </label>
        <button
          type="submit"
          className="min-h-10 rounded-button bg-accent-500 px-4 text-sm font-semibold
            text-text-on-accent transition-transform duration-100 active:scale-[0.97]"
        >
          {t("create")}
        </button>
        <p className="w-full text-xs text-text-tertiary">{t("createHint")}</p>
      </form>

      {venues.length === 0 ? (
        <EmptyState icon={Building2} title={t("emptyTitle")} hint={t("emptyHint")} />
      ) : (
        <Table>
          <THead>
            <Th>{t("venue")}</Th>
            <Th align="right">{t("sessions")}</Th>
            <Th align="right">{t("staff")}</Th>
            <Th align="right">{t("gmv30d")}</Th>
            <Th>{t("contract")}</Th>
          </THead>
          <tbody>
            {venues.map((v) => (
              <Tr key={v.id}>
                <Td>
                  <p className="font-semibold text-text-primary">{v.name}</p>
                  <p className="text-xs text-text-tertiary">
                    <code>{v.slug}</code>
                  </p>
                  {Number(v.live) > 0 ? (
                    <Chip tone="ember" className="mt-2">
                      {t("liveNow", { count: Number(v.live) })}
                    </Chip>
                  ) : null}
                </Td>
                <Td align="right" numeric>
                  {Number(v.sessions)}
                </Td>
                <Td align="right" numeric>
                  {Number(v.staff)}
                </Td>
                <Td align="right" numeric className="text-accent-400">
                  {formatEuros(Number(v.gmv_30d))}
                </Td>
                <Td>
                  <form action={updateVenueContractAction} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="venueId" value={v.id} />
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-text-tertiary">{t("feePct")}</span>
                      <input
                        type="number"
                        name="betbeatFeePct"
                        min={0}
                        max={50}
                        step={0.5}
                        defaultValue={v.betbeat_fee_bps / 100}
                        required
                        className={inputCls}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-text-tertiary">{t("defaultSharePct")}</span>
                      <input
                        type="number"
                        name="defaultVenueSharePct"
                        min={0}
                        max={100}
                        step={1}
                        defaultValue={(v.default_share_bps ?? 5000) / 100}
                        required
                        className={inputCls}
                      />
                    </label>
                    <button
                      type="submit"
                      className="min-h-9 rounded-button border border-line-subtle bg-surface-2
                        px-3 text-sm text-text-primary hover:bg-surface-3"
                    >
                      {t("save")}
                    </button>
                  </form>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="text-xs text-text-tertiary">{t("contractHint")}</p>
    </div>
  );
}
