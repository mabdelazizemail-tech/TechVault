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
    <main className="bg-canvas flex min-h-dvh flex-col items-start justify-center gap-2 px-12">
      <p className="text-foreground text-[34px] leading-tight font-extrabold tracking-[-0.015em]">
        Not available
      </p>
      <p className="text-foreground-muted max-w-md text-[13px]">
        This page does not exist, or you do not have access to it.
      </p>
      <Link
        href="/dashboard"
        className="text-primary-ink mt-2 text-sm font-extrabold underline-offset-3 hover:underline"
      >
        Back to the dashboard
      </Link>
    </main>
  );
}
