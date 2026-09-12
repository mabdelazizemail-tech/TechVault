import type { NextRequest } from "next/server";
import { updateSession } from "@/platform/auth/supabase/middleware";

/**
 * Runs on every matched request to refresh the Supabase session and gate
 * anonymous access.
 *
 * Next 16 renamed this file convention from `middleware` to `proxy`; the function
 * must be named `proxy`. The implementation lives in platform/auth so the auth
 * provider stays behind one boundary (CLAUDE.md §11.1).
 *
 * This establishes AUTHENTICATION only. Authorization is decided per operation in
 * the service layer (CLAUDE.md §11.4) — never treat a route as safe because this
 * let the request through.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and images. Keeping the health endpoint in
     * scope is harmless — it is listed as a public path — and means one fewer
     * exception to reason about.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
