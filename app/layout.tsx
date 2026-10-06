import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { Providers } from "./providers";
import "./globals.css";

/** Fallback for SF Pro off Apple devices; the opsz axis gives it optical sizes. */
const sans = Inter({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-sans",
  display: "swap",
});
const INTRO_SEEN_SCRIPT =
  "try{if(sessionStorage.getItem('bb-intro'))document.documentElement.dataset.intro='seen'}catch(e){}";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const appName = t("appName");
  const description = t("meta.description");
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
    title: { default: `${appName}: ${t("tagline").replace(/\.$/, "")}`, template: `%s · ${appName}` },
    description,
    applicationName: appName,
    // Staff and party screens opt out per segment; the public pages are indexable.
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      siteName: appName,
      locale: locale === "en" ? "en_GB" : "pt_PT",
      title: appName,
      description,
    },
    twitter: { card: "summary_large_image", title: appName, description },
    appleWebApp: { capable: true, title: appName, statusBarStyle: "black-translucent" },
    // Prices and phone numbers are plain text, never auto-linked by iOS.
    formatDetection: { telephone: false, email: false, address: false },
  };
}

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang={locale}
      className={sans.variable}
      // Browser extensions (analytics blockers, translators) inject
      // attributes on <html> before React hydrates; that is not a mismatch
      // we can fix, so keep the dev overlay quiet for this element only.
      suppressHydrationWarning
    >
      <head>
        {/* Before first paint: the boot intro plays once per tab, not on
            every reload or when "/" hands over to a party page. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: INTRO_SEEN_SCRIPT }} />
      </head>
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
