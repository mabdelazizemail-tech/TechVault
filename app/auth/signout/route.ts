import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/platform/auth/supabase/server";

/**
 * Ends the Supabase session of an account TechVault has disabled, then sends the
 * visitor to sign-in with an explanation (see `requireUser`).
 *
 * A route handler because only a route handler or Server Action can clear the
 * session cookies. It changes nothing except ending the caller's own session, so
 * a forged request to it can do no more than sign someone out.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut({ scope: "local" });

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  // A fixed value only — the login page maps it to its own message.
  if (request.nextUrl.searchParams.get("reason") === "disabled") {
    loginUrl.searchParams.set("reason", "disabled");
  }
  return NextResponse.redirect(loginUrl);
}
