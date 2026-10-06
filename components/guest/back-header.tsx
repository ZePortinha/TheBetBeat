"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import { Pressable } from "@/components/ui/pressable";

/** Sub-screen header: back target + screen title (B10.8 "Orientação"). */
export function BackHeader({
  title,
  backHref,
  trailing,
}: {
  title: string;
  backHref: string;
  trailing?: React.ReactNode;
}) {
  const router = useRouter();
  const tc = useTranslations("common");
  return (
    <header className="flex items-center gap-2">
      <Pressable
        onPress={() => router.push(backHref)}
        aria-label={tc("actions.back")}
        className="-ml-3 flex size-11 items-center justify-center rounded-full text-accent-400"
      >
        <ChevronLeft size={28} strokeWidth={2} aria-hidden />
      </Pressable>
      <h1
        className="min-w-0 flex-1 line-clamp-2 text-xl font-semibold leading-tight text-text-primary"
        style={{ fontFamily: "var(--font-display)", letterSpacing: "var(--tracking-heading)" }}
      >
        {title}
      </h1>
      {trailing}
    </header>
  );
}
