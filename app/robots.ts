import type { MetadataRoute } from "next";

/** Only the public front door and the venues page are for search engines. */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/casas"],
      disallow: ["/api/", "/s/", "/display/", "/cockpit", "/console", "/login", "/entrar", "/dev/"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
