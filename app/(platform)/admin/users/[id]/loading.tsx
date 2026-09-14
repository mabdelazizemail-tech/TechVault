/** Matches the user details layout: header, then two columns of panels (§16.6). */
export default function UserDetailLoading() {
  return (
    <div className="max-w-6xl" aria-busy="true" aria-label="Loading user">
      <div className="pb-3.5">
        <div className="bg-surface-sunken h-9 w-64 animate-pulse" />
        <div className="bg-surface-sunken mt-2 h-3.5 w-48 animate-pulse" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        {[0, 1].map((column) => (
          <div key={column} className="flex flex-col gap-4">
            {[0, 1].map((panel) => (
              <div key={panel} className="border-border-strong bg-surface border-2 p-4">
                <div className="bg-surface-sunken mb-4 h-4 w-32 animate-pulse" />
                {Array.from({ length: 4 }, (_, index) => (
                  <div
                    key={index}
                    className="bg-surface-sunken mb-2.5 h-3.5 animate-pulse"
                  />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
