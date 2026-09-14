import { Fragment, type ReactNode } from "react";

/**
 * A record's fields as label/value pairs. Empty values render as a quiet dash, so
 * a sparse record still reads as a complete form rather than a broken one.
 */
export function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-3 text-[13px]">
      {items.map((item) => (
        <Fragment key={item.label}>
          <dt className="text-foreground-muted">{item.label}</dt>
          <dd className="text-foreground min-w-0 break-words" dir="auto">
            {item.value === null || item.value === undefined || item.value === "" ? (
              <span className="text-foreground-subtle">—</span>
            ) : (
              item.value
            )}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}
