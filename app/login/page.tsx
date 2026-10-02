import { getTranslations } from "next-intl/server";
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
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-12">
      <h1
        className="mb-2 text-3xl font-bold text-text-primary"
        style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.01em" }}
      >
        {t("title")}
      </h1>
      <p className="mb-8 text-sm text-text-secondary">{t("subtitle")}</p>
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
    </main>
  );
}
