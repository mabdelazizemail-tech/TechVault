"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
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
        className="hover:bg-surface-hover flex shrink-0 items-center gap-2.5 px-1 py-1 text-start"
      >
        <span
          aria-hidden="true"
          className="bg-foreground text-canvas grid size-[30px] place-items-center text-[11px] font-extrabold"
        >
          {initials}
        </span>
        <span className="hidden min-w-0 leading-tight sm:block">
          <span className="text-foreground block max-w-44 truncate text-xs font-extrabold">
            {displayName}
          </span>
          <span className="text-foreground-muted block max-w-44 truncate text-[10.5px]">
            {email}
          </span>
        </span>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="border-border-strong bg-surface-raised z-50 min-w-56 border p-1 shadow-[0_12px_32px_color-mix(in_srgb,#2d2b2b_22%,transparent)]"
        >
          <div className="px-2 py-1.5">
            <p className="text-foreground truncate text-sm font-extrabold">
              {displayName}
            </p>
            <p className="text-foreground-muted truncate text-xs">{email}</p>
          </div>

          <DropdownMenu.Separator className="bg-border my-1 h-px" />

          <DropdownMenu.Item asChild>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  await onSignOut();
                });
              }}
              className="text-foreground data-highlighted:bg-surface-hover w-full cursor-pointer px-2 py-1.5 text-start text-sm outline-none disabled:opacity-45"
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
