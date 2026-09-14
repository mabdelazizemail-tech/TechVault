/** Matches the Users page layout: header, filter bar and table rows (§16.6). */
export default function UsersLoading() {
  return (
    <div className="max-w-6xl" aria-busy="true" aria-label="Loading users">
      <div className="flex items-end justify-between gap-4 pb-3.5">
        <div>
          <div className="bg-surface-sunken h-9 w-32 animate-pulse" />
          <div className="bg-surface-sunken mt-2 h-3.5 w-96 max-w-full animate-pulse" />
        </div>
        <div className="bg-surface-sunken h-9 w-28 animate-pulse" />
      </div>
      <div className="border-border-strong bg-surface border-2">
        <div className="border-border-strong flex gap-2 border-b-2 px-3 py-3">
          {[18, 10, 12, 14].map((width) => (
            <div
              key={width}
              className="bg-surface-sunken h-9 animate-pulse"
              style={{ width: `${width}rem` }}
            />
          ))}
        </div>
        {Array.from({ length: 8 }, (_, index) => (
          <div
            key={index}
            className="border-border flex gap-6 border-b px-3 py-3 last:border-0"
          >
            <div className="bg-surface-sunken h-4 w-56 animate-pulse" />
            <div className="bg-surface-sunken h-4 w-36 animate-pulse" />
            <div className="bg-surface-sunken hidden h-4 w-28 animate-pulse md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
