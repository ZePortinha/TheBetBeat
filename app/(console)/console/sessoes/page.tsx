import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarPlus, Music2 } from "lucide-react";
import { query } from "@/lib/db";
import { EmptyState } from "@/components/ui/empty-state";
import { Chip } from "@/components/ui/fit-chip";
import { PageHeader } from "@/components/console/page-header";
import { formatDateTime, requireConsole } from "../_lib/context";
import { endSessionAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_TONE = {
  scheduled: "neutral",
  live: "ember",
  paused: "amber",
  ended: "neutral",
} as const;

export default async function SessionsPage() {
  const ctx = await requireConsole("/console/sessoes");
  const t = await getTranslations("console.sessions");
  const venue = ctx.activeVenue;

  const sessions = venue
    ? (
        await query<{
          id: string;
          name: string;
          status: keyof typeof STATUS_TONE;
          genres: string[];
          starts_at: string;
          ends_at: string;
          dj_name: string | null;
        }>(
          `select s.id, s.name, s.status, s.genres, s.starts_at, s.ends_at,
                  st.display_name as dj_name
             from public.sessions s
             left join public.staff st on st.id = s.dj_staff_id
            where s.venue_id = $1
            order by s.starts_at desc
            limit 50`,
          [venue.id],
        )
      ).rows
    : [];

  return (
    <div>
      <PageHeader
        crumbs={[{ label: t("crumbRoot") }, { label: t("title") }]}
        title={t("title")}
        actions={
          <Link
            href="/console/sessoes/nova"
            data-testid="sessions-new-link"
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-accent-500
              px-5 text-base font-semibold text-text-on-accent transition-transform
              duration-100 active:scale-[0.97]"
          >
            <CalendarPlus aria-hidden size={20} strokeWidth={1.75} />
            {t("new")}
          </Link>
        }
      />

      {sessions.length === 0 ? (
        <EmptyState icon={Music2} title={t("emptyTitle")} hint={t("emptyHint")} />
      ) : (
        <div className="overflow-hidden rounded-card border border-line-subtle">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line-subtle bg-surface-1 text-text-tertiary">
                <th className="label px-4 py-3">{t("table.session")}</th>
                <th className="label px-4 py-3">{t("table.dj")}</th>
                <th className="label px-4 py-3">{t("table.when")}</th>
                <th className="label px-4 py-3">{t("table.status")}</th>
                <th className="label px-4 py-3 text-right">{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr
                  key={s.id}
                  data-testid="session-row"
                  data-session-id={s.id}
                  data-session-status={s.status}
                  className="border-b border-line-subtle last:border-0"
                >
                  <td className="px-4 py-3">
                    <p className="font-semibold text-text-primary">{s.name}</p>
                    <p className="text-xs text-text-tertiary">{s.genres.join(" · ")}</p>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{s.dj_name ?? "—"}</td>
                  <td className="px-4 py-3 text-text-secondary tnum">
                    {formatDateTime(s.starts_at)}
                  </td>
                  <td className="px-4 py-3">
                    <Chip tone={STATUS_TONE[s.status]}>{t(`status.${s.status}`)}</Chip>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/console/sessoes/${s.id}`}
                        className="rounded-full border border-line-subtle bg-surface-2
                          px-3 py-1.5 text-text-primary hover:bg-surface-3"
                      >
                        {s.status === "ended" ? t("view") : t("edit")}
                      </Link>
                      {(s.status === "live" || s.status === "paused") && (
                        <form action={endSessionAction}>
                          <input type="hidden" name="sessionId" value={s.id} />
                          <button
                            type="submit"
                            data-testid="session-end-button"
                            className="rounded-full bg-ember-500 px-3 py-1.5
                              font-semibold text-text-on-accent transition-transform
                              duration-100 active:scale-[0.97]"
                          >
                            {t("end")}
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
