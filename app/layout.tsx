import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "./providers";
import "./globals.css";

/** Fallback for SF Pro off Apple devices; the opsz axis gives it optical sizes. */
const sans = Inter({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-sans",
  display: "swap",
});
export const metadata: Metadata = {
  title: { default: "BetBeat", template: "%s · BetBeat" },
  description: "Pede a tua música ao DJ.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={sans.variable}
      // Browser extensions (analytics blockers, translators) inject
      // attributes on <html> before React hydrates; that is not a mismatch
      // we can fix, so keep the dev overlay quiet for this element only.
      suppressHydrationWarning
    >
      <body>
        {/* data-vaul-drawer-wrapper lets sheets push the page back (B10.4). */}
        <div data-vaul-drawer-wrapper="" className="min-h-dvh bg-bg-base">
          <NextIntlClientProvider locale={locale} messages={messages}>
            <Providers>{children}</Providers>
          </NextIntlClientProvider>
        </div>
      </body>
    </html>
  );
}
