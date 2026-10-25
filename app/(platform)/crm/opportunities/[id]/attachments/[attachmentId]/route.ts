import { NextResponse, type NextRequest } from "next/server";
import { httpStatusFor, isAppError } from "@/lib/errors";
import { getOpportunityAttachmentLink } from "@/modules/crm/contracts/service";
import { getActor } from "@/platform/auth/current-user";
import { logger, newCorrelationId } from "@/platform/observability/logger";

/**
 * Opens a file attached to a deal: authorises the viewer against the deal, audits it,
 * then redirects to a storage link that expires within minutes. The storage location
 * is never a lasting URL (CLAUDE.md §12.3).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
): Promise<NextResponse> {
  const { id, attachmentId } = await params;
  try {
    const url = await getOpportunityAttachmentLink(await getActor(), id, attachmentId);
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
    logger.error("Deal attachment failed to open", {
      module: "crm",
      operation: "crm.opportunity.attachment.open",
      traceId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return new NextResponse(`The file could not be opened. Reference: ${traceId}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
