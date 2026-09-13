import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/platform/config/env";

/**
 * Supabase client for the browser.
 *
 * Used ONLY for authentication flows (sign in, sign out, password reset). Business
 * data is never read from the browser with this client — it goes through Server
 * Actions and route handlers so the permission model in §11 always applies
 * (CLAUDE.md §8.6).
 */
export function createClientSupabaseClient() {
  const env = publicEnv();
  return createBrowserClient(env.supabaseUrl, env.supabaseKey);
}
