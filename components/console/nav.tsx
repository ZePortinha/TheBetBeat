"use client";

/**
 * Console left-nav links (B9). Client only for the active-route state;
 * labels are translated server-side and passed down.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function ConsoleNav({
  groups,
  ariaLabel,
}: {
  groups: NavGroup[];
  /** Translated accessible name for the landmark (console.shell.navLabel). */
  ariaLabel: string;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-6" aria-label={ariaLabel} data-testid="console-nav">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p className="label px-3 pb-1 text-text-tertiary">{group.label}</p>
          {group.items.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/console" && pathname.startsWith(`${item.href}/`));
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "rounded-button px-3 py-2 text-sm transition-colors duration-100",
                  active
                    ? "bg-surface-2 font-semibold text-gold-500"
                    : "text-text-secondary hover:bg-surface-1 hover:text-text-primary",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
