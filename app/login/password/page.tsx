import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { createClient } from "@/lib/supabase/server";
import { MIN_STAFF_PASSWORD } from "@/lib/security/password";
import { safeNextPath } from "@/lib/security/redirect";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Nova palavra-passe" };

export default async function PasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const t = await getTranslations("common.auth.newPassword");
  const params = await searchParams;
  const next = safeNextPath(params.next, "/cockpit");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) redirect(`/login?next=${encodeURIComponent(`/login/password?next=${next}`)}`);

  return (
    <AuthShell title={t("title")} subtitle={t("intro", { min: MIN_STAFF_PASSWORD })}>
      <PasswordForm
        next={next}
        minLength={MIN_STAFF_PASSWORD}
        labels={{
          password: t("password"),
          confirm: t("confirm"),
          submit: t("submit"),
          errorShort: t("errorShort", { min: MIN_STAFF_PASSWORD }),
          errorMismatch: t("errorMismatch"),
          errorSame: t("errorSame"),
          errorFailed: t("errorFailed"),
        }}
      />
    </AuthShell>
  );
}
