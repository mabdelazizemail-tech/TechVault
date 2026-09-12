"use client";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/primitives";

/**
 * Error boundary for the authenticated shell (CLAUDE.md §16.6).
 *
 * Shows a user-safe message, an action, and the digest Next.js assigns — which is
 * the reference support needs to find the matching server log. A stack trace, a
 * SQL fragment or a raw Postgres error must never reach a user (§19.3).
 *
 * There is deliberately no client-side logging here: the server already recorded
 * the error with full context, and `digest` ties this screen to that record.
 * Re-logging it in the browser would add noise, not information.
 */
export default function PlatformError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      message="This page could not be loaded. The error has been recorded. If it keeps happening, contact your administrator with the reference below."
      traceId={error.digest}
      action={
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
