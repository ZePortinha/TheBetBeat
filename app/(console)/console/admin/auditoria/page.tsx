import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { ScrollText } from "lucide-react";
import { query } from "@/lib/db";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/console/page-header";
import { Table, Td, Th, THead, Tr } from "@/components/console/table";
import { formatDateTime, pageOffset, requireAdminConsole } from "../../_lib/context";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/** Query-string filters — strict allowlist, every value bounded. */
const filterSchema = z
  .object({
    action: z.string().trim().max(80).optional(),
    entity: z.string().trim().max(40).optional(),
    actor: z.string().trim().max(120).optional(),
    venue: z.string().uuid().optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional(),
  })
  .strip();

const inputCls =
  "rounded-button border border-line-subtle bg-surface-3 px-3 py-2 text-sm " +
  "text-text-primary focus:border-gold-500 focus:outline-none";

/** Escape LIKE wildcards so a filter is a literal prefix/substring. */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Admin BetBeat — Auditoria (B9 admin): filterable, paginated audit_log.
 * Parameterized WHERE built from an allowlist of filters; payload shown
 * collapsed (it may carry money/ops details — admins only, B12.2).
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminConsole("/console/admin/auditoria");
  const t = await getTranslations("console.admin.audit");

  const sp = await searchParams;
  const single = Object.fromEntries(
    Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  const parsed = filterSchema.safeParse(single);
  const f = parsed.success ? parsed.data : {};
  const page = f.page ?? 1;

  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace("?", `$${params.length}`));
  };
  if (f.action) add(`a.action like ? escape '\\'`, `${likeEscape(f.action)}%`);
  if (f.entity) add(`a.entity = ?`, f.entity);
  if (f.actor) add(`a.actor ilike ? escape '\\'`, `%${likeEscape(f.actor)}%`);
  if (f.venue) add(`a.venue_id = ?`, f.venue);
  if (f.from) add(`a.created_at >= (?::date)::timestamptz`, f.from);
  if (f.to) add(`a.created_at < ((?::date) + interval '1 day')::timestamptz`, f.to);
  const whereSql = where.length > 0 ? `where ${where.join(" and ")}` : "";

  const offset = pageOffset(page, PAGE_SIZE);
  const [rowsRes, countRes, venuesRes, entitiesRes] = await Promise.all([
    query<{
      id: string;
      actor: string;
      action: string;
      entity: string;
      entity_id: string | null;
      venue_name: string | null;
      payload: unknown;
      created_at: string;
    }>(
      `select a.id, a.actor, a.action, a.entity, a.entity_id, v.name as venue_name,
              a.payload, a.created_at
         from public.audit_log a
         left join public.venues v on v.id = a.venue_id
        ${whereSql}
        order by a.created_at desc, a.id desc
        limit ${PAGE_SIZE} offset $${params.length + 1}`,
      [...params, offset],
    ),
    query<{ n: string }>(`select count(*)::bigint as n from public.audit_log a ${whereSql}`, params),
    query<{ id: string; name: string }>(`select id, name from public.venues order by name asc`),
    query<{ entity: string }>(
      `select distinct entity from public.audit_log order by entity asc limit 50`,
    ),
  ]);

  const total = Number(countRes.rows[0]?.n ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (n: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) {
      if (k !== "page" && v !== undefined && v !== "") qs.set(k, String(v));
    }
    qs.set("page", String(n));
    return `/console/admin/auditoria?${qs.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[{ label: t("crumbRoot") }, { label: t("title") }]}
        title={t("title")}
        actions={<p className="text-sm text-text-secondary tnum">{t("total", { count: total })}</p>}
      />

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-card border border-line-subtle bg-surface-1 p-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="label text-text-secondary">{t("filters.action")}</span>
          <input
            name="action"
            defaultValue={f.action ?? ""}
            maxLength={80}
            placeholder="session."
            className={`${inputCls} w-44`}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label text-text-secondary">{t("filters.entity")}</span>
          <select name="entity" defaultValue={f.entity ?? ""} className={`${inputCls} w-40`}>
            <option value="">{t("filters.any")}</option>
            {entitiesRes.rows.map((e) => (
              <option key={e.entity} value={e.entity}>
                {e.entity}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label text-text-secondary">{t("filters.venue")}</span>
          <select name="venue" defaultValue={f.venue ?? ""} className={`${inputCls} w-44`}>
            <option value="">{t("filters.any")}</option>
            {venuesRes.rows.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label text-text-secondary">{t("filters.actor")}</span>
          <input
            name="actor"
            defaultValue={f.actor ?? ""}
            maxLength={120}
            className={`${inputCls} w-44`}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label text-text-secondary">{t("filters.from")}</span>
          <input type="date" name="from" defaultValue={f.from ?? ""} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label text-text-secondary">{t("filters.to")}</span>
          <input type="date" name="to" defaultValue={f.to ?? ""} className={inputCls} />
        </label>
        <button
          type="submit"
          className="min-h-10 rounded-button bg-gold-500 px-4 text-sm font-semibold
            text-text-on-accent transition-transform duration-100 active:scale-[0.97]"
        >
          {t("filters.apply")}
        </button>
        <Link
          href="/console/admin/auditoria"
          className="min-h-10 rounded-button border border-line-subtle bg-surface-2 px-4
            py-2.5 text-sm text-text-primary hover:bg-surface-3"
        >
          {t("filters.clear")}
        </Link>
      </form>

      {rowsRes.rows.length === 0 ? (
        <EmptyState icon={ScrollText} title={t("emptyTitle")} hint={t("emptyHint")} />
      ) : (
        <Table>
          <THead>
            <Th>{t("columns.when")}</Th>
            <Th>{t("columns.actor")}</Th>
            <Th>{t("columns.action")}</Th>
            <Th>{t("columns.entity")}</Th>
            <Th>{t("columns.venue")}</Th>
            <Th>{t("columns.payload")}</Th>
          </THead>
          <tbody>
            {rowsRes.rows.map((row) => {
              const payloadJson = JSON.stringify(row.payload ?? {}, null, 2);
              const empty = payloadJson === "{}";
              return (
                <Tr key={row.id}>
                  <Td numeric className="whitespace-nowrap">
                    {formatDateTime(row.created_at)}
                  </Td>
                  <Td className="max-w-48 truncate" title={row.actor}>
                    {row.actor}
                  </Td>
                  <Td>
                    <code className="text-text-primary">{row.action}</code>
                  </Td>
                  <Td>
                    <p>{row.entity}</p>
                    {row.entity_id ? (
                      <p className="max-w-56 truncate text-xs text-text-tertiary" title={row.entity_id}>
                        {row.entity_id}
                      </p>
                    ) : null}
                  </Td>
                  <Td>{row.venue_name ?? "—"}</Td>
                  <Td>
                    {empty ? (
                      <span className="text-text-tertiary">—</span>
                    ) : (
                      <details>
                        <summary className="cursor-pointer text-xs text-gold-500">
                          {t("columns.showPayload")}
                        </summary>
                        <pre className="mt-2 max-h-64 max-w-md overflow-auto rounded-card bg-surface-2 p-3 text-xs text-text-secondary">
                          {payloadJson}
                        </pre>
                      </details>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {pages > 1 ? (
        <nav aria-label={t("pagination.label")} className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="text-gold-500 hover:text-gold-300">
              {t("pagination.prev")}
            </Link>
          ) : (
            <span className="text-text-tertiary">{t("pagination.prev")}</span>
          )}
          <span className="text-text-secondary tnum">{t("pagination.page", { page, pages })}</span>
          {page < pages ? (
            <Link href={pageHref(page + 1)} className="text-gold-500 hover:text-gold-300">
              {t("pagination.next")}
            </Link>
          ) : (
            <span className="text-text-tertiary">{t("pagination.next")}</span>
          )}
        </nav>
      ) : null}
    </div>
  );
}
