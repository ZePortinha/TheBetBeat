import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isCrossSiteApiWrite } from "@/lib/security/csrf";

/**
 * Security middleware (B12.4): per-request CSP nonce + strict headers,
 * plus a cheap auth gate for staff surfaces (roles are enforced again in
 * server layouts/routes — the client never decides permissions).
 */
export async function middleware(request: NextRequest) {
  if (isCrossSiteApiWrite(request.method, request.nextUrl.pathname, request.headers)) {
    return NextResponse.json({ error: { code: "forbidden_origin", id: "csrf" } }, { status: 403 });
  }

  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
    "base64",
  );
  const isDev = process.env.NODE_ENV !== "production";

  const csp = [
    `default-src 'self'`,
    // next/font inlines styles; Tailwind injects a style tag in dev.
    `style-src 'self' 'unsafe-inline'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
    `frame-src https://challenges.cloudflare.com`,
    // Cockpit service worker (public/sw-cockpit.js) — same origin only.
    `worker-src 'self'`,
    // Catalog covers (Deezer's image CDN).
    `img-src 'self' data: blob: https://cdn-images.dzcdn.net https://e-cdns-images.dzcdn.net`,
    `font-src 'self'`,
    `connect-src 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""} ${
      (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace("http", "ws")
    } https://challenges.cloudflare.com`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `manifest-src 'self'`,
    ...(isDev ? [] : [`upgrade-insecure-requests`]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Lets server layouts redirect to login/MFA with the real deep link.
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  // Staff surfaces: require a Supabase session (role checks happen server-side
  // in the layouts; this is only the cheap outer gate).
  const path = request.nextUrl.pathname;
  const needsStaff = path.startsWith("/cockpit") || path.startsWith("/console");

  if (needsStaff) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: (cookies) => {
            cookies.forEach(({ name, value }) => request.cookies.set(name, value));
            response = NextResponse.next({ request: { headers: requestHeaders } });
            cookies.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
          },
        },
      },
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // Anonymous guests also have sessions — staff gate requires a non-anonymous user.
    if (!user || user.is_anonymous) {
      const login = request.nextUrl.clone();
      login.pathname = "/login";
      login.searchParams.set("next", path);
      const redirect = NextResponse.redirect(login);
      redirect.headers.set("Content-Security-Policy", csp);
      return redirect;
    }
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets.
    "/((?!_next/static|_next/image|favicon.ico|icons|manifest).*)",
  ],
};
