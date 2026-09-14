/** Skeleton for Think Tank pages: header, then a list (§16.6). */
export default function InnovationLoading() {
  return (
    <div aria-busy="true" className="animate-pulse">
      <span className="sr-only" role="status">
        Loading…
      </span>
      <div className="bg-surface-sunken mb-2 h-9 w-72" />
      <div className="bg-surface-sunken mb-5 h-4 w-[30rem] max-w-full" />
      <div className="bg-surface-sunken mb-3 h-9 w-full max-w-xl" />
      <div className="bg-border grid gap-px">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="bg-surface-sunken h-20" />
        ))}
      </div>
    </div>
  );
}
