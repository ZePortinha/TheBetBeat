import { getTranslations } from "next-intl/server";
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
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-12">
      <h1
        className="mb-2 text-2xl font-bold text-text-primary"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {t("title")}
      </h1>
      <MfaClient
        next={params.next ?? "/console"}
        labels={{
          enrollIntro: t("enrollIntro"),
          verifyIntro: t("verifyIntro"),
          codeLabel: t("codeLabel"),
          submit: t("submit"),
          error: t("error"),
          loading: t("loading"),
        }}
      />
    </main>
  );
}
