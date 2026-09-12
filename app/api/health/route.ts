import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/platform/observability/logger";

/**
 * Liveness probe (CLAUDE.md §22).
 *
 * Deliberately reveals nothing about the deployment: no version, no environment,
 * no dependency hostnames. A health endpoint is reachable by anything that can
 * route to the service.
 */
export async function GET() {
  return NextResponse.json({ status: "ok" }, { status: 200 });
}

export const dynamic = "force-dynamic";

/**
 * Readiness probe — checks the dependencies the app cannot serve without.
 *
 * Exposed at `/api/health/ready`; see that route. Kept here as the shared
 * implementation so both probes stay consistent.
 */
export async function checkReadiness(): Promise<{
  ready: boolean;
  checks: Record<string, "ok" | "failed">;
}> {
  const checks: Record<string, "ok" | "failed"> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch (error) {
    checks.database = "failed";
    logger.error("Readiness check failed: database unreachable", {
      module: "platform",
      operation: "health.ready",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    ready: Object.values(checks).every((value) => value === "ok"),
    checks,
  };
}
