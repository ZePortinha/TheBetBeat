import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Users } from "lucide-react";
import { query } from "@/lib/db";
import { EmptyState } from "@/components/ui/empty-state";
import { Chip } from "@/components/ui/fit-chip";
import { InviteForm } from "@/components/console/invite-form";
import { PageHeader } from "@/components/console/page-header";
import { requireConsole } from "../_lib/context";
import { changeRoleAction, removeStaffAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const ctx = await requireConsole("/console/equipa");
  const t = await getTranslations("console.team");
  const { error } = await searchParams;
  const venue = ctx.activeVenue;
  if (!venue) redirect("/console");

  // Email via auth join — server-side only, minimal DTO (B12.4).
  const staff = (
    await query<{
      id: string;
      role: "dj" | "manager" | "admin";
      display_name: string;
      email: string | null;
      user_id: string;
    }>(
      `select s.id, s.role, s.display_name, u.email, s.user_id
         from public.staff s
         join auth.users u on u.id = s.user_id
        where s.venue_id = $1
        order by s.role desc, s.display_name asc`,
      [venue.id],
    )
  ).rows;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        crumbs={[{ label: t("crumbRoot") }, { label: t("title") }]}
        title={t("title")}
      />

      {error ? (
        <p role="alert" className="text-sm text-ember-500">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      <InviteForm venueId={venue.id} />

      {staff.length === 0 ? (
        <EmptyState icon={Users} title={t("emptyTitle")} hint={t("emptyHint")} />
      ) : (
        <div className="overflow-hidden rounded-card border border-line-subtle">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line-subtle bg-surface-1 text-text-tertiary">
                <th className="label px-4 py-3">{t("name")}</th>
                <th className="label px-4 py-3">{t("email")}</th>
                <th className="label px-4 py-3">{t("role")}</th>
                <th className="label px-4 py-3 text-right">{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((member) => {
                const isSelf = member.user_id === ctx.staff.userId;
                return (
                  <tr key={member.id} className="border-b border-line-subtle last:border-0">
                    <td className="px-4 py-3 font-semibold text-text-primary">
                      {member.display_name}
                      {isSelf ? (
                        <span className="pl-2 text-xs font-normal text-text-tertiary">
                          {t("you")}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{member.email}</td>
                    <td className="px-4 py-3">
                      <Chip tone={member.role === "manager" ? "accent" : "neutral"}>
                        {t(`roles.${member.role}`)}
                      </Chip>
                    </td>
                    <td className="px-4 py-3">
                      {member.role !== "admin" && !isSelf ? (
                        <div className="flex items-center justify-end gap-2">
                          <form action={changeRoleAction} className="flex items-center gap-1.5">
                            <input type="hidden" name="staffId" value={member.id} />
                            <input
                              type="hidden"
                              name="role"
                              value={member.role === "dj" ? "manager" : "dj"}
                            />
                            <button
                              type="submit"
                              className="rounded-button border border-line-subtle bg-surface-2
                                px-3 py-1.5 text-text-primary hover:bg-surface-3"
                            >
                              {member.role === "dj"
                                ? t("makeManager")
                                : t("makeDj")}
                            </button>
                          </form>
                          <form action={removeStaffAction}>
                            <input type="hidden" name="staffId" value={member.id} />
                            <button
                              type="submit"
                              className="rounded-button px-3 py-1.5 text-ember-500 hover:bg-surface-2"
                            >
                              {t("remove")}
                            </button>
                          </form>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
