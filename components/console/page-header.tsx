/**
 * Console page header: breadcrumb trail + title + optional actions.
 * Async server component — crumbs/title arrive already translated; the
 * breadcrumb landmark name is resolved here (console.shell.breadcrumbLabel).
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { ChevronRight } from "lucide-react";

export interface Crumb {
  label: string;
  href?: string;
}

export async function PageHeader({
  crumbs,
  title,
  actions,
}: {
  crumbs: Crumb[];
  title: string;
  actions?: ReactNode;
}) {
  const t = await getTranslations("console.shell");
  return (
    <header className="flex flex-col gap-2 pb-6">
      <nav aria-label={t("breadcrumbLabel")}>
        <ol className="flex items-center gap-1 text-sm text-text-tertiary">
          {crumbs.map((crumb, i) => (
            <li key={`${crumb.label}-${i}`} className="flex items-center gap-1">
              {i > 0 && <ChevronRight aria-hidden size={14} strokeWidth={1.75} />}
              {crumb.href ? (
                <Link
                  href={crumb.href}
                  className="rounded px-0.5 hover:text-text-primary"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current="page" className="text-text-secondary">
                  {crumb.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <div className="flex items-end justify-between gap-4">
        <h1
          data-testid="console-page-title"
          className="font-display text-[length:var(--text-32)] font-bold leading-tight tracking-[-0.01em] text-text-primary"
        >
          {title}
        </h1>
        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </div>
    </header>
  );
}
