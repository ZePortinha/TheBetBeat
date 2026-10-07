import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { MfaClient } from "./mfa-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.meta");
  return { title: t("mfa"), robots: { index: false, follow: false } };
}

export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const t = await getTranslations("common.auth.mfa");
  const params = await searchParams;

  return (
    <AuthShell title={t("title")}>
      <MfaClient
        next={params.next ?? "/console"}
        labels={{
          enrollIntro: t("enrollIntro"),
          verifyIntro: t("verifyIntro"),
          codeLabel: t("codeLabel"),
          submit: t("submit"),
          error: t("error"),
          loading: t("loading"),
          qrAlt: t("qrAlt"),
        }}
      />
    </AuthShell>
  );
}
