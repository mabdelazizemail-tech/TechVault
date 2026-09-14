"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown } from "lucide-react";
import { useTransition } from "react";

/**
 * The user menu (CLAUDE.md §16.2).
 *
 * Built on a headless primitive so focus management, Escape handling and
 * keyboard navigation are correct without hand-rolling them (§17.5).
 */
export function UserMenu({
  fullName,
  email,
  onSignOut,
}: {
  fullName: string | null;
  email: string;
  /** Server Action that ends the session. */
  onSignOut: () => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();
  const displayName = fullName ?? email;
  const initials = initialsFor(displayName);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Account menu for ${displayName}`}
        className="border-border hover:bg-surface-hover flex shrink-0 cursor-pointer items-center gap-2 border-2 px-2 py-1.5 text-start"
      >
        <span
          aria-hidden="true"
          className="bg-primary text-primary-foreground grid size-7 place-items-center text-xs font-bold"
        >
          {initials}
        </span>
        <span className="hidden min-w-0 leading-tight sm:block">
          <span className="text-foreground block max-w-44 truncate text-sm font-semibold">
            {displayName}
          </span>
          <span className="text-foreground-muted block max-w-44 truncate text-[11px]">
            {email}
          </span>
        </span>
        <ChevronDown aria-hidden="true" className="text-foreground size-4" />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="panel z-50 min-w-56 p-1"
        >
          <div className="px-2 py-1.5">
            <p className="text-foreground truncate text-sm font-semibold">
              {displayName}
            </p>
            <p className="text-foreground-muted truncate text-xs">{email}</p>
          </div>

          <DropdownMenu.Separator className="bg-border my-1 h-0.5" />

          <DropdownMenu.Item asChild>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  await onSignOut();
                });
              }}
              className="text-foreground data-highlighted:bg-surface-hover w-full cursor-pointer px-2 py-1.5 text-start text-sm font-medium outline-none disabled:opacity-45"
            >
              {isPending ? "Signing out…" : "Sign out"}
            </button>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function initialsFor(name: string): string {
  const parts = name
    .trim()
    .split(/[\s@.]+/)
    .filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "?";
  const second = parts.length > 1 ? (parts[1]?.charAt(0) ?? "") : "";
  return `${first}${second}`.toUpperCase();
}
