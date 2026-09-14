/** Skeleton matching the dashboard: header, then the widget grid (§16.6). */
export default function DashboardLoading() {
  return (
    <div aria-busy="true" className="animate-pulse">
      <span className="sr-only" role="status">
        Loading…
      </span>
      <div className="bg-surface-sunken mb-2 h-9 w-64" />
      <div className="bg-surface-sunken mb-5 h-4 w-[34rem] max-w-full" />
      <div className="grid grid-cols-12 gap-px">
        <div className="bg-surface-sunken col-span-12 h-56 lg:col-span-5" />
        <div className="bg-surface-sunken col-span-12 h-56 lg:col-span-7" />
        <div className="bg-surface-sunken col-span-12 h-28" />
      </div>
    </div>
  );
}
