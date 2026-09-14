import Link from "next/link";

/** The TechVault mark: the red TV square and the name, linking home. */
export function Brand() {
  return (
    <Link href="/dashboard" className="text-foreground flex shrink-0 items-center gap-2">
      <span
        aria-hidden="true"
        className="bg-brand text-brand-foreground grid size-7 place-items-center text-[13px] font-bold"
      >
        TV
      </span>
      <span className="text-base font-bold tracking-tight">TechVault</span>
    </Link>
  );
}
