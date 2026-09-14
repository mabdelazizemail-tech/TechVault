import { NextResponse, type NextRequest } from "next/server";
import { isAppError } from "@/lib/errors";
import { recordLastSeen } from "@/modules/messaging/contracts/service";
import { getActor } from "@/platform/auth/current-user";
import { logger, newCorrelationId } from "@/platform/observability/logger";

/**
 * Records "last seen" when a Messages session connects or its page is closed.
 *
 * A route handler rather than a Server Action because a closing page can only
 * send `navigator.sendBeacon`. It is a cookie-authenticated mutation outside
 * Server Actions' built-in CSRF protection, so it accepts same-origin requests
 * only (CLAUDE.md §18.3). The service throttles writes to one a minute.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get("origin");
  if (
    origin === null ||
    !URL.canParse(origin) ||
    new URL(origin).host !== request.nextUrl.host
  ) {
    return new NextResponse(null, { status: 403 });
  }

  try {
    await recordLastSeen(await getActor());
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (isAppError(error)) return new NextResponse(null, { status: error.httpStatus });
    logger.error("Recording last seen failed", {
      module: "messaging",
      operation: "messaging.presence.lastSeen",
      traceId: newCorrelationId(),
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return new NextResponse(null, { status: 500 });
  }
}
