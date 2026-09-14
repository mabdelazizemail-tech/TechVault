/**
 * Skeleton matching the administration screens: header, then a table panel.
 * The Users screens keep their own, more specific skeletons (§16.6).
 */
export default function AdminLoading() {
  return (
    <div aria-busy="true" className="max-w-6xl animate-pulse">
      <span className="sr-only" role="status">
        Loading…
      </span>
      <div className="bg-surface-sunken mb-2 h-9 w-48" />
      <div className="bg-surface-sunken mb-5 h-4 w-96 max-w-full" />
      <div className="border-border-strong border-2">
        <div className="bg-surface-sunken h-9" />
        {Array.from({ length: 8 }, (_, index) => (
          <div
            key={index}
            className="border-border flex gap-6 border-b px-3 py-3 last:border-0"
          >
            <div className="bg-surface-sunken h-4 w-48" />
            <div className="bg-surface-sunken h-4 w-32" />
            <div className="bg-surface-sunken hidden h-4 w-24 md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
