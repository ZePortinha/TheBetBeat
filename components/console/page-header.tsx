/**
 * Console page header: breadcrumb trail + title + optional actions.
 * Server component — every string arrives already translated.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export interface Crumb {
  label: string;
  href?: string;
}

export function PageHeader({
  crumbs,
  title,
  actions,
}: {
  crumbs: Crumb[];
  title: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2 pb-6">
      <nav aria-label="Breadcrumb">
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
        <h1 className="font-display text-[length:var(--text-32)] font-bold leading-tight tracking-[-0.01em] text-text-primary">
          {title}
        </h1>
        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </div>
    </header>
  );
}
