import { cn } from "@/lib/cn";
import { initialsOf } from "./format";

/**
 * A person's initials, with an optional presence marker. Decorative: the name and
 * the online state are always also written out beside it.
 */
export function Avatar({
  name,
  online,
  className,
}: {
  name: string;
  /** Omit to show no presence marker at all (for example, a deactivated account). */
  online?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "bg-surface-sunken text-foreground relative inline-grid size-9 shrink-0 place-items-center text-xs font-extrabold",
        className,
      )}
    >
      {initialsOf(name)}
      {online !== undefined && (
        <span
          className={cn(
            "border-surface absolute -end-0.5 -bottom-0.5 size-3 border-2",
            online ? "bg-success" : "bg-foreground-subtle",
          )}
        />
      )}
    </span>
  );
}
