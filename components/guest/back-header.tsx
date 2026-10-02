"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
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
        className="-ml-2 flex size-11 items-center justify-center rounded-full text-text-secondary"
      >
        <ArrowLeft size={24} strokeWidth={1.75} aria-hidden />
      </Pressable>
      <h1
        className="min-w-0 flex-1 truncate text-xl font-bold text-text-primary"
        style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.01em" }}
      >
        {title}
      </h1>
      {trailing}
    </header>
  );
}
