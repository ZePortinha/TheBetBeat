import type { Metadata, Viewport } from "next";
import { Unbounded, Instrument_Serif } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "./providers";
import "./globals.css";

const unbounded = Unbounded({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-editorial",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "BetBeat", template: "%s · BetBeat" },
  description: "Pede a tua música ao DJ.",
};

export const viewport: Viewport = {
  themeColor: "#0A0806",
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
      className={`${unbounded.variable} ${instrumentSerif.variable}`}
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
