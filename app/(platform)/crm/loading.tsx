/** Skeleton matching the CRM page shape: header, figure row, content (§16.6). */
export default function CrmLoading() {
  return (
    <div aria-busy="true" className="animate-pulse">
      <span className="sr-only" role="status">
        Loading…
      </span>
      <div className="bg-surface-sunken mb-2 h-9 w-56" />
      <div className="bg-surface-sunken mb-5 h-4 w-96 max-w-full" />
      <div className="mb-4 grid grid-cols-2 gap-px lg:grid-cols-4">
        {[0, 1, 2, 3].map((cell) => (
          <div key={cell} className="bg-surface-sunken h-20" />
        ))}
      </div>
      <div className="bg-surface-sunken h-72" />
    </div>
  );
}
