import type { Metadata } from "next";
import { preconnect } from "react-dom";
import { getLocale } from "next-intl/server";
import { GuestProviders } from "@/components/guest/guest-providers";
import { BootIntro } from "@/components/ui/boot-intro";

/** Guest PWA chrome (B11): own manifest; theme color comes from the root. */
export const metadata: Metadata = {
  manifest: "/manifest-guest.webmanifest",
  // Party links carry a signed, per-venue token: never for search engines.
  robots: { index: false, follow: false },
};

export default async function GuestLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  // The anonymous session and realtime both start on Supabase: warm the
  // connection while the page is still parsing.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    preconnect(process.env.NEXT_PUBLIC_SUPABASE_URL, { crossOrigin: "anonymous" });
  }
  return (
    <div className="guest-type relative isolate mx-auto w-full max-w-md">
      <div aria-hidden className="ambient pointer-events-none fixed inset-0 -z-10" />
      <BootIntro />
      <GuestProviders locale={locale}>{children}</GuestProviders>
    </div>
  );
}
