import Link from "next/link";

/**
 * 404.
 *
 * Note that a 404 is also the correct response when a user may not know a record
 * exists (CLAUDE.md §11.6) — so this page must not imply the thing definitely
 * does not exist.
 */
export default function NotFound() {
  return (
    <main className="bg-canvas flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-foreground text-sm font-semibold">Not available</p>
      <p className="text-foreground-muted max-w-md text-xs">
        This page does not exist, or you do not have access to it.
      </p>
      <Link href="/dashboard" className="text-primary mt-2 text-sm hover:underline">
        Back to the dashboard
      </Link>
    </main>
  );
}
