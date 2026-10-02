"use client";

/**
 * Copy-to-clipboard button for signed links (zone QR / display URLs).
 * Instant feedback on press (B10.6-1); swaps to a check for 1.6 s.
 */

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyButton({
  value,
  label,
  copiedLabel,
}: {
  value: string;
  label: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API unavailable (http dev contexts) — select-less fallback.
      const el = document.createElement("textarea");
      el.value = value;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-button border
        border-line-subtle bg-surface-2 px-3 text-sm text-text-primary
        transition-transform duration-100 hover:bg-surface-3 active:scale-[0.97]"
    >
      {copied ? (
        <Check aria-hidden size={16} strokeWidth={1.75} className="text-green-500" />
      ) : (
        <Copy aria-hidden size={16} strokeWidth={1.75} />
      )}
      {copied ? copiedLabel : label}
    </button>
  );
}
