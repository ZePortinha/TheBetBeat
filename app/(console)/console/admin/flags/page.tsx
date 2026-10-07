import { getTranslations } from "next-intl/server";
import { ToggleLeft } from "lucide-react";
import { query } from "@/lib/db";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/console/page-header";
import { requireAdminConsole } from "../../_lib/context";
import { saveFlagsAction } from "./actions";
import { BOOLEAN_CHOICES, FLAGS, FLAG_KEYS } from "./flags";

export const dynamic = "force-dynamic";

const selectCls =
  "rounded-button border border-line-subtle bg-surface-3 px-3 py-2 text-sm " +
  "text-text-primary focus:border-accent-500 focus:outline-none focus:ring-4 focus:ring-accent-500/25";

/**
 * Admin BetBeat — Feature flags (B9 admin): per-venue editor over the
 * allowlisted keys of venues.settings. Other keys are shown read-only.
 */
export default async function AdminFlagsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireAdminConsole("/console/admin/flags");
  const t = await getTranslations("console.admin.flags");
  const { error, saved } = await searchParams;

  const venues = (
    await query<{ id: string; name: string; settings: Record<string, unknown> }>(
      `select id, name, settings from public.venues order by name asc`,
    )
  ).rows;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader crumbs={[{ label: t("crumbRoot") }, { label: t("title") }]} title={t("title")} />
      <p className="max-w-2xl text-sm text-text-tertiary">{t("hint")}</p>

      {error ? (
        <p role="alert" className="text-sm text-ember-500">
          {t("errors.invalid")}
        </p>
      ) : null}

      {venues.length === 0 ? (
        <EmptyState icon={ToggleLeft} title={t("emptyTitle")} />
      ) : (
        venues.map((venue) => {
          const settings = venue.settings ?? {};
          const otherKeys = Object.keys(settings).filter((k) => !FLAG_KEYS.includes(k));
          return (
            <form
              key={venue.id}
              action={saveFlagsAction}
              className="flex flex-col gap-4 rounded-card border border-line-subtle bg-surface-1 p-5"
            >
              <input type="hidden" name="venueId" value={venue.id} />
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-text-primary">{venue.name}</h2>
                {saved === venue.id ? (
                  <p role="status" className="text-sm text-green-500">
                    {t("saved")}
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-x-8 gap-y-3 xl:grid-cols-3">
                {FLAGS.map((flag) => {
                  const current = settings[flag.key];
                  const id = `${venue.id}-${flag.key}`;
                  return (
                    <label key={flag.key} htmlFor={id} className="flex flex-col gap-1.5">
                      <span className="text-sm font-semibold text-text-primary">
                        {t(`keys.${flag.key}.label`)}
                      </span>
                      <span className="text-xs text-text-tertiary">
                        {t(`keys.${flag.key}.hint`)}
                      </span>
                      {flag.kind === "boolean" ? (
                        <select
                          id={id}
                          name={flag.key}
                          defaultValue={
                            current === true ? "on" : current === false ? "off" : "inherit"
                          }
                          className={selectCls}
                        >
                          {BOOLEAN_CHOICES.map((choice) => (
                            <option key={choice} value={choice}>
                              {t(`choices.${choice}`)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={id}
                          type="number"
                          name={flag.key}
                          min={flag.min}
                          max={flag.max}
                          step={1}
                          defaultValue={typeof current === "number" ? current : ""}
                          placeholder={t("choices.inherit")}
                          className={`${selectCls} tnum`}
                        />
                      )}
                    </label>
                  );
                })}
              </div>

              {otherKeys.length > 0 ? (
                <details className="text-xs text-text-tertiary">
                  <summary className="cursor-pointer">
                    {t("otherKeys", { count: otherKeys.length })}
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-card bg-surface-2 p-3 text-text-secondary">
                    {JSON.stringify(
                      Object.fromEntries(otherKeys.map((k) => [k, settings[k]])),
                      null,
                      2,
                    )}
                  </pre>
                </details>
              ) : null}

              <button
                type="submit"
                className="min-h-10 self-start rounded-button bg-accent-500 px-5 text-sm
                  font-semibold text-text-on-accent transition-transform duration-100
                  active:scale-[0.97]"
              >
                {t("save")}
              </button>
            </form>
          );
        })
      )}
    </div>
  );
}
