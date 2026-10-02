/**
 * Console data table primitives (B9 tables). Server-component safe —
 * no hooks, no client boundary; every string arrives already translated.
 */

import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto rounded-card border border-line-subtle", className)}>
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-line-subtle bg-surface-1 text-text-tertiary">{children}</tr>
    </thead>
  );
}

export function Th({
  children,
  align = "left",
  className,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" }) {
  return (
    <th
      {...rest}
      className={cx("label px-4 py-3", align === "right" && "text-right", className)}
    >
      {children}
    </th>
  );
}

export function Tr({ children }: { children: ReactNode }) {
  return <tr className="border-b border-line-subtle last:border-0">{children}</tr>;
}

export function Td({
  children,
  align = "left",
  numeric = false,
  className,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & {
  align?: "left" | "right";
  numeric?: boolean;
}) {
  return (
    <td
      {...rest}
      className={cx(
        "px-4 py-3 align-top text-text-secondary",
        align === "right" && "text-right",
        numeric && "tnum",
        className,
      )}
    >
      {children}
    </td>
  );
}
