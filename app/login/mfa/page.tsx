import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { safeNextPath } from "@/lib/security/redirect";
import { MfaClient } from "./mfa-client";

export const metadata = { title: "Verificação em dois passos" };

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
        next={safeNextPath(params.next, "/console")}
        labels={{
          enrollIntro: t("enrollIntro"),
          verifyIntro: t("verifyIntro"),
          codeLabel: t("codeLabel"),
          submit: t("submit"),
          error: t("error"),
          loading: t("loading"),
        }}
      />
    </AuthShell>
  );
}
