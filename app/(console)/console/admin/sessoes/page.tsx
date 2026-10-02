import { getTranslations } from "next-intl/server";
import { Radio } from "lucide-react";
import { query } from "@/lib/db";
import { EmptyState } from "@/components/ui/empty-state";
import { Chip } from "@/components/ui/fit-chip";
import { PageHeader } from "@/components/console/page-header";
import { Table, Td, Th, THead, Tr } from "@/components/console/table";
import { formatDateTime, formatEuros, requireAdminConsole } from "../../_lib/context";

export const dynamic = "force-dynamic";

/**
 * Admin BetBeat — Sessões ao vivo across every venue (B9 admin).
 * Read-only aggregates: live/paused sessions with their request load and
 * tonight's captured amount, plus the next 24 h of scheduled sessions.
 */
export default async function AdminLiveSessionsPage() {
  await requireAdminConsole("/console/admin/sessoes");
  const t = await getTranslations("console.admin.live");

  const [liveRes, upcomingRes] = await Promise.all([
    query<{
      id: string;
      name: string;
      status: "live" | "paused";
      requests_open: boolean;
      starts_at: string;
      ends_at: string;
      venue_name: string;
      dj_name: string | null;
      pending: string;
      accepted: string;
      played: string;
      gmv: string;
    }>(
      `select s.id, s.name, s.status, s.requests_open, s.starts_at, s.ends_at,
              v.name as venue_name, st.display_name as dj_name,
              (select count(*) from public.requests r
                where r.session_id = s.id and r.status = 'paid')::bigint as pending,
              (select count(*) from public.requests r
                where r.session_id = s.id and r.status in ('accepted', 'playing'))::bigint
                as accepted,
              (select count(*) from public.requests r
                where r.session_id = s.id and r.status = 'played')::bigint as played,
              coalesce((select sum(r.amount_cents - r.refunded_cents) from public.requests r
                where r.session_id = s.id and r.paid_at is not null), 0)::bigint as gmv
         from public.sessions s
         join public.venues v on v.id = s.venue_id
         left join public.staff st on st.id = s.dj_staff_id
        where s.status in ('live', 'paused')
        order by v.name asc, s.starts_at desc`,
    ),
    query<{
      id: string;
      name: string;
      starts_at: string;
      venue_name: string;
      dj_name: string | null;
    }>(
      `select s.id, s.name, s.starts_at, v.name as venue_name, st.display_name as dj_name
         from public.sessions s
         join public.venues v on v.id = s.venue_id
         left join public.staff st on st.id = s.dj_staff_id
        where s.status = 'scheduled'
          and s.starts_at between now() - interval '2 hours' and now() + interval '24 hours'
        order by s.starts_at asc
        limit 20`,
    ),
  ]);

  const live = liveRes.rows;
  const totalGmv = live.reduce((sum, s) => sum + Number(s.gmv), 0);
  const totalPending = live.reduce((sum, s) => sum + Number(s.pending), 0);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        crumbs={[{ label: t("crumbRoot") }, { label: t("title") }]}
        title={t("title")}
        actions={
          live.length > 0 ? (
            <p className="text-sm text-text-secondary tnum">
              {t("summary", {
                sessions: live.length,
                pending: totalPending,
                gmv: formatEuros(totalGmv),
              })}
            </p>
          ) : undefined
        }
      />

      {live.length === 0 ? (
        <EmptyState icon={Radio} title={t("emptyTitle")} hint={t("emptyHint")} />
      ) : (
        <Table>
          <THead>
            <Th>{t("venue")}</Th>
            <Th>{t("session")}</Th>
            <Th>{t("status")}</Th>
            <Th align="right">{t("pending")}</Th>
            <Th align="right">{t("accepted")}</Th>
            <Th align="right">{t("played")}</Th>
            <Th align="right">{t("gmv")}</Th>
          </THead>
          <tbody>
            {live.map((s) => (
              <Tr key={s.id}>
                <Td className="font-semibold text-text-primary">{s.venue_name}</Td>
                <Td>
                  <p className="font-semibold text-text-primary">{s.name}</p>
                  <p className="text-xs text-text-tertiary tnum">
                    {s.dj_name ?? "—"} · {formatDateTime(s.starts_at)} — {formatDateTime(s.ends_at)}
                  </p>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    <Chip tone={s.status === "live" ? "ember" : "amber"}>
                      {t(`statuses.${s.status}`)}
                    </Chip>
                    {!s.requests_open ? <Chip tone="neutral">{t("requestsClosed")}</Chip> : null}
                  </div>
                </Td>
                <Td align="right" numeric className="text-text-primary">
                  {Number(s.pending)}
                </Td>
                <Td align="right" numeric>
                  {Number(s.accepted)}
                </Td>
                <Td align="right" numeric>
                  {Number(s.played)}
                </Td>
                <Td align="right" numeric className="text-gold-500">
                  {formatEuros(Number(s.gmv))}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      <section>
        <h2 className="pb-3 text-lg font-semibold text-text-primary">{t("upcomingTitle")}</h2>
        {upcomingRes.rows.length === 0 ? (
          <p className="text-sm text-text-tertiary">{t("upcomingEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {upcomingRes.rows.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-card border border-line-subtle bg-surface-1 px-4 py-3 text-sm"
              >
                <span>
                  <span className="font-semibold text-text-primary">{s.venue_name}</span>
                  <span className="text-text-secondary"> · {s.name}</span>
                  {s.dj_name ? <span className="text-text-tertiary"> · {s.dj_name}</span> : null}
                </span>
                <span className="text-text-tertiary tnum">{formatDateTime(s.starts_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
