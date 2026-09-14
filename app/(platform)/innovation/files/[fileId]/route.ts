import { NextResponse, type NextRequest } from "next/server";
import { httpStatusFor, isAppError } from "@/lib/errors";
import { getFileLink } from "@/modules/innovation/contracts/service";
import { getActor } from "@/platform/auth/current-user";
import { logger, newCorrelationId } from "@/platform/observability/logger";

/**
 * Downloads a Think Tank file: authorises, audits, then redirects to a storage link
 * that expires in a minute. The storage location is never exposed as a lasting URL.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<NextResponse> {
  const { fileId } = await params;
  try {
    const url = await getFileLink(await getActor(), fileId, "download");
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
    logger.error("File download failed", {
      module: "innovation",
      operation: "innovation.file.download",
      traceId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return new NextResponse(`The file could not be downloaded. Reference: ${traceId}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
