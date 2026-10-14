import { NextResponse, type NextRequest } from "next/server";
import { httpStatusFor, isAppError } from "@/lib/errors";
import { getReceiptLink } from "@/modules/committees/contracts/service";
import { getActor } from "@/platform/auth/current-user";
import { logger, newCorrelationId } from "@/platform/observability/logger";

/**
 * Shows an expense's receipt picture: authorises the viewer, audits the view, then
 * redirects to a storage link that expires in minutes. The storage location is never
 * a lasting URL (CLAUDE.md §12.3).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  try {
    const url = await getReceiptLink(await getActor(), id);
    return NextResponse.redirect(url, {
      status: 303,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (isAppError(error)) {
      return new NextResponse(error.message, {
        status: httpStatusFor(error),
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    const traceId = newCorrelationId();
    logger.error("Receipt view failed", {
      module: "committees",
      operation: "committees.expense.receipt",
      traceId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return new NextResponse(`The receipt could not be shown. Reference: ${traceId}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
