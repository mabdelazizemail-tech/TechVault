import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/platform/config/env";

/**
 * Supabase client for Server Components, Server Actions and route handlers.
 *
 * This is the only place (with `middleware.ts` and `client.ts`) that talks to the
 * auth provider. Everything else asks `platform/auth/current-user` who the user
 * is, so swapping the provider later touches three files (CLAUDE.md §11.1).
 *
 * Uses the ANON key only: the service-role key bypasses every policy and must
 * never back a user-facing request.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const env = publicEnv();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. Session refresh is handled by
            // middleware, so ignoring this is correct rather than a swallowed bug.
          }
        },
      },
    },
  );
}
