import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MapPin, Printer, Trash2 } from "lucide-react";
import { query } from "@/lib/db";
import { env } from "@/lib/security/env";
import { signToken } from "@/lib/security/tokens";
import { EmptyState } from "@/components/ui/empty-state";
import { QRBlock } from "@/components/ui/qr-block";
import { CopyButton } from "@/components/console/copy-button";
import { PageHeader } from "@/components/console/page-header";
import { requireConsole } from "../_lib/context";
import { createZoneAction, deleteZoneAction, renameZoneAction } from "./actions";

export const dynamic = "force-dynamic";

const inputCls =
  "rounded-button border border-line-subtle bg-surface-3 px-3 py-2 text-sm " +
  "text-text-primary focus:border-gold-500 focus:outline-none";

export default async function ZonesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const ctx = await requireConsole("/console/zonas");
  const t = await getTranslations("console.zones");
  const { error } = await searchParams;
  const venue = ctx.activeVenue;
  if (!venue) redirect("/console");

  const zones = (
    await query<{ id: string; name: string; qr_slug: string }>(
      `select id, name, qr_slug from public.zones where venue_id = $1 order by name asc`,
      [venue.id],
    )
  ).rows;

  // Display links: one per non-ended session (B9.2 "link do Ecrã da Casa").
  const sessions = (
    await query<{ id: string; name: string; status: string; display_slug: string }>(
      `select id, name, status, display_slug from public.sessions
        where venue_id = $1 and status <> 'ended'
        order by starts_at desc limit 10`,
      [venue.id],
    )
  ).rows;

  const appUrl = env.NEXT_PUBLIC_APP_URL;
  const zoneUrl = (slug: string) =>
    `${appUrl}/s/${signToken({ kind: "zone", venueId: venue.id, slug })}`;
  const displayUrl = (slug: string) =>
    `${appUrl}/display/${signToken({ kind: "display", venueId: venue.id, slug })}`;

  return (
    <div>
      <PageHeader
        crumbs={[{ label: t("crumbRoot") }, { label: t("title") }]}
        title={t("title")}
        actions={
          zones.length > 0 ? (
            <Link
              href="/console/zonas/imprimir"
              className="inline-flex min-h-11 items-center gap-2 rounded-button border
                border-line-subtle bg-surface-2 px-5 text-base font-semibold
                text-text-primary hover:bg-surface-3"
            >
              <Printer aria-hidden size={20} strokeWidth={1.75} />
              {t("print")}
            </Link>
          ) : undefined
        }
      />

      {error === "inUse" && (
        <p role="alert" className="mb-4 text-sm text-ember-500">
          {t("errorInUse")}
        </p>
      )}

      <form
        action={createZoneAction}
        className="mb-8 flex items-end gap-3 rounded-card border border-line-subtle bg-surface-1 p-5"
      >
        <input type="hidden" name="venueId" value={venue.id} />
        <label className="flex flex-col gap-1.5">
          <span className="label text-text-secondary">{t("newZoneName")}</span>
          <input name="name" required maxLength={60} className={inputCls} />
        </label>
        <button
          type="submit"
          className="min-h-10 rounded-button bg-gold-500 px-4 text-sm font-semibold
            text-text-on-accent transition-transform duration-100 active:scale-[0.97]"
        >
          {t("create")}
        </button>
      </form>

      {zones.length === 0 ? (
        <EmptyState icon={MapPin} title={t("emptyTitle")} hint={t("emptyHint")} />
      ) : (
        <div className="grid grid-cols-2 gap-6 xl:grid-cols-3">
          {zones.map((zone) => {
            const url = zoneUrl(zone.qr_slug);
            return (
              <div
                key={zone.id}
                className="flex flex-col gap-4 rounded-card border border-line-subtle bg-surface-1 p-5"
              >
                <form action={renameZoneAction} className="flex items-center gap-2">
                  <input type="hidden" name="zoneId" value={zone.id} />
                  <input
                    name="name"
                    defaultValue={zone.name}
                    maxLength={60}
                    required
                    aria-label={t("zoneName")}
                    className={`${inputCls} min-w-0 flex-1 font-semibold`}
                  />
                  <button
                    type="submit"
                    className="rounded-button border border-line-subtle bg-surface-2
                      px-3 py-2 text-sm text-text-primary hover:bg-surface-3"
                  >
                    {t("rename")}
                  </button>
                </form>
                <div className="self-center">
                  <QRBlock url={url} size={140} alt={t("qrAlt", { zone: zone.name })} />
                </div>
                <code className="truncate rounded-chip bg-surface-3 px-2 py-1 text-xs text-text-secondary">
                  {url}
                </code>
                <div className="flex items-center justify-between gap-2">
                  <CopyButton value={url} label={t("copyLink")} copiedLabel={t("copied")} />
                  <form action={deleteZoneAction}>
                    <input type="hidden" name="zoneId" value={zone.id} />
                    <button
                      type="submit"
                      aria-label={t("delete", { zone: zone.name })}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-button
                        px-3 text-sm text-ember-500 hover:bg-surface-2"
                    >
                      <Trash2 aria-hidden size={16} strokeWidth={1.75} />
                      {t("deleteShort")}
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <section className="mt-10">
        <h2 className="pb-3 text-lg font-semibold text-text-primary">
          {t("displayLinks")}
        </h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-text-tertiary">{t("noSessions")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {sessions.map((s) => {
              const url = displayUrl(s.display_slug);
              return (
                <li
                  key={s.id}
                  className="flex items-center gap-4 rounded-card border border-line-subtle bg-surface-1 px-5 py-3"
                >
                  <span className="min-w-40 font-semibold text-text-primary">
                    {s.name}
                  </span>
                  <code className="min-w-0 flex-1 truncate rounded-chip bg-surface-3 px-2 py-1 text-xs text-text-secondary">
                    {url}
                  </code>
                  <CopyButton value={url} label={t("copyLink")} copiedLabel={t("copied")} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
