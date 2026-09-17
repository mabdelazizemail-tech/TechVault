import type { ReactNode } from "react";

/** One labelled fact in a document's summary panel. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-border flex items-baseline justify-between gap-3 border-b px-4 py-2.5 text-sm last:border-0">
      <dt className="text-foreground-muted shrink-0">{label}</dt>
      <dd className="text-foreground min-w-0 text-end">{children}</dd>
    </div>
  );
}

export function Th({ children, end }: { children: ReactNode; end?: boolean }) {
  return (
    <th
      scope="col"
      className={`label-caps border-border border-b-2 px-4 py-2.5 whitespace-nowrap ${end === true ? "text-end" : "text-start"}`}
    >
      {children}
    </th>
  );
}

/** A numeric table cell: right-aligned, tabular, left-to-right. */
export function Td({ children }: { children: ReactNode }) {
  return (
    <td className="px-4 py-2.5 text-end tabular-nums" dir="ltr">
      {children}
    </td>
  );
}
