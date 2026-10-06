import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PhoneLoginScreen } from "@/components/guest/phone-login-screen";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.meta");
  return { title: t("partyLogin") };
}

/** /entrar — party login: phone + SMS code, straight into the party whose guest list holds the number. */
export default function PartyLoginPage() {
  return <PhoneLoginScreen />;
}
