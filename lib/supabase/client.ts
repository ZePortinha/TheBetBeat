"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/security/public-env";

/** Browser Supabase client — anon key only; RLS is the boundary. */
export function createClient() {
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
