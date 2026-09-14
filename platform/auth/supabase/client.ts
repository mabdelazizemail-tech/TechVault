import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
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

/**
 * Reads the session carried by an emailed invitation or password-reset link, so
 * the account holder can choose a password.
 *
 * Implicit flow: those links put the tokens in the URL fragment, and are often
 * opened on a different device from the one that requested them, where a PKCE
 * verifier could never match. The session is held in memory only and ended as
 * soon as the password is set.
 */
export function createLinkSessionClient() {
  const env = publicEnv();
  return createClient(env.supabaseUrl, env.supabaseKey, {
    auth: {
      flowType: "implicit",
      detectSessionInUrl: true,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
