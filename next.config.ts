import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Metadata is cheap (translations only): put it in <head> for every
  // client instead of streaming it into <body>, so link previews, readers
  // and audits that do not run JS all see the title, description and card.
  htmlLimitedBots: /.*/,
  // Dev only: testing on a phone through a temporary cloudflared tunnel.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // Security headers that do not depend on a per-request nonce.
  // CSP (with nonce) is set in middleware.ts.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value:
              // camera: the guests' front door reads the event QR.
              "camera=(self), microphone=(), geolocation=(), payment=(self), usb=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
