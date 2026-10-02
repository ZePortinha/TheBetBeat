"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { Pressable } from "@/components/ui/pressable";
import { apiFetch } from "./api";

const LOCALES = [
  { code: "pt-PT", label: "PT" },
  { code: "en", label: "EN" },
] as const;

/** PT/EN switch — sets the `bb-locale` cookie and re-renders (B6). */
export function LocaleToggle({ className }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();

  function setLocale(code: string) {
    if (code === locale) return;
    document.cookie = `bb-locale=${code};path=/;max-age=31536000;samesite=lax`;
    // Remember on the guest row too (receipt emails, SMS copy).
    void apiFetch("/api/guest/profile", {
      method: "POST",
      body: JSON.stringify({ locale: code }),
    });
    router.refresh();
  }

  return (
    <div
      className={`flex items-center gap-1 rounded-full border border-line-subtle bg-surface-1 p-1 ${className ?? ""}`}
      role="group"
      aria-label="Language"
    >
      {LOCALES.map((l) => (
        <Pressable
          key={l.code}
          onPress={() => setLocale(l.code)}
          aria-pressed={locale === l.code}
          className={`rounded-full px-2.5 py-1 text-xs font-semibold tnum ${
            locale === l.code
              ? "bg-surface-3 text-text-primary"
              : "text-text-tertiary"
          }`}
        >
          {l.label}
        </Pressable>
      ))}
    </div>
  );
}
