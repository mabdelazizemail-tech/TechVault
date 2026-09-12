import { NextResponse } from "next/server";
import { checkReadiness } from "../route";

/**
 * Readiness probe (CLAUDE.md §22): can this instance actually serve traffic?
 *
 * Returns 503 when a required dependency is unavailable, so a load balancer stops
 * sending traffic to an instance that cannot answer.
 */
export async function GET() {
  const result = await checkReadiness();

  return NextResponse.json(
    { status: result.ready ? "ready" : "not-ready", checks: result.checks },
    { status: result.ready ? 200 : 503 },
  );
}

export const dynamic = "force-dynamic";
