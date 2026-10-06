import { PhoneLoginScreen } from "@/components/guest/phone-login-screen";

export const dynamic = "force-dynamic";

/** /entrar — party login: phone + SMS code, straight into the party whose guest list holds the number. */
export default function PartyLoginPage() {
  return <PhoneLoginScreen />;
}
