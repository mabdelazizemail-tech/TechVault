/**
 * Fallback skeleton for any platform page without a closer one: page header, then
 * a content panel. It exists so a navigation shows its destination at once rather
 * than holding the old page until the server finishes (§16.6).
 */
export default function PlatformLoading() {
  return (
    <div aria-busy="true" className="animate-pulse">
      <span className="sr-only" role="status">
        Loading…
      </span>
      <div className="bg-surface-sunken mb-2 h-9 w-56" />
      <div className="bg-surface-sunken mb-5 h-4 w-96 max-w-full" />
      <div className="bg-surface-sunken h-72" />
    </div>
  );
}
