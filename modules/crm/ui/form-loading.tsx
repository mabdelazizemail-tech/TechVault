/**
 * Shown inside a dialog while its form code loads on first open. Forms load on
 * demand so the shared validation schemas stay out of every page's first load.
 */
export function FormLoading() {
  return (
    <p role="status" className="text-foreground-muted py-8 text-center text-sm">
      Loading form…
    </p>
  );
}
