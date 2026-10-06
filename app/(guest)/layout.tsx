import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { GuestProviders } from "@/components/guest/guest-providers";
import { BootIntro } from "@/components/ui/boot-intro";

/** Guest PWA chrome (B11): own manifest; theme color comes from the root. */
export const metadata: Metadata = {
  manifest: "/manifest-guest.webmanifest",
};

export default async function GuestLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <div className="relative isolate mx-auto w-full max-w-md">
      <div aria-hidden className="ambient pointer-events-none fixed inset-0 -z-10" />
      <BootIntro />
      <GuestProviders locale={locale}>{children}</GuestProviders>
    </div>
  );
}
