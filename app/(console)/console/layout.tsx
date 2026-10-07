import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/login/actions";
import { ConsoleNav, type NavGroup } from "@/components/console/nav";
import { VenueSwitcher } from "@/components/console/venue-switcher";
import { BrandMark } from "@/components/ui/brand-mark";
import { requireConsole } from "./_lib/context";

export async function generateMetadata() {
  const t = await getTranslations("console.shell");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

/**
 * Console shell (B9): staff-only desktop surface. The layout gates
 * manager/admin (DJs never enter) and every page re-gates itself —
 * layouts do not re-run on soft navigation, so pages own their checks.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const ctx = await requireConsole("/console");
  const t = await getTranslations("console");

  const groups: NavGroup[] = [
    {
      label: t("nav.venue"),
      items: [
        { href: "/console/sessoes", label: t("nav.sessions") },
        { href: "/console/zonas", label: t("nav.zones") },
        { href: "/console/leiloes", label: t("nav.auctions") },
        { href: "/console/equipa", label: t("nav.team") },
        { href: "/console/receita", label: t("nav.revenue") },
        { href: "/console/analise", label: t("nav.analytics") },
      ],
    },
  ];
  if (ctx.isAdmin) {
    groups.push({
      label: t("nav.admin"),
      items: [
        { href: "/console/admin/casas", label: t("nav.adminVenues") },
        { href: "/console/admin/sessoes", label: t("nav.adminLive") },
        { href: "/console/admin/falhas", label: t("nav.adminFailures") },
        { href: "/console/admin/reconciliacao", label: t("nav.adminReconciliation") },
        { href: "/console/admin/flags", label: t("nav.adminFlags") },
        { href: "/console/admin/auditoria", label: t("nav.adminAudit") },
      ],
    });
  }

  const displayName =
    ctx.staff.memberships.find((m) => m.role !== "dj")?.displayName ??
    ctx.staff.email ??
    "";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1440px]">
      <aside className="sticky top-0 flex h-dvh w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r border-line-subtle bg-bg-raised px-4 py-6 print:hidden">
        <p className="font-display flex items-center gap-2 px-3 text-xl font-extrabold tracking-tight text-text-primary">
          <BrandMark className="size-7 shrink-0" />
          BetBeat{" "}
          <span className="text-sm font-semibold text-text-tertiary">
            {t("shell.console")}
          </span>
        </p>
        <VenueSwitcher
          venues={ctx.venues}
          activeVenueId={ctx.activeVenue?.id ?? null}
          label={t("shell.venue")}
        />
        <ConsoleNav groups={groups} ariaLabel={t("shell.navLabel")} />
        <div className="mt-auto flex flex-col gap-3 border-t border-line-subtle pt-4">
          <p className="truncate px-3 text-xs text-text-tertiary">{displayName}</p>
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-button px-3 py-2
                text-sm text-text-secondary transition-colors duration-100
                hover:bg-surface-1 hover:text-text-primary"
            >
              <LogOut aria-hidden size={16} strokeWidth={1.75} />
              {t("shell.logout")}
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
