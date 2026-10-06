import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const t = await getTranslations("common.auth");
  const params = await searchParams;

  return (
    <AuthShell title={t("title")} subtitle={t("subtitle")}>
      {params.error === "forbidden" ? (
        <p
          role="alert"
          className="mb-4 rounded-button border border-line-strong bg-surface-2 px-4 py-3 text-sm text-amber-500"
        >
          {t("forbidden")}
        </p>
      ) : null}
      <LoginForm
        next={params.next ?? "/cockpit"}
        labels={{
          email: t("email"),
          password: t("password"),
          submit: t("submit"),
          errorInvalid: t("errorInvalid"),
          errorRateLimited: t("errorRateLimited"),
          errorBot: t("errorBot"),
        }}
      />
    </AuthShell>
  );
}
