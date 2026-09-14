"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Modal dialog and slide-over panel (CLAUDE.md §17.5).
 *
 * Built on Radix so focus is trapped, Escape closes, and focus returns to the
 * trigger — none of which is hand-rolled. `variant="sheet"` slides in from the
 * inline end for longer forms that should keep the page visible behind them.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  variant = "modal",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  variant?: "modal" | "sheet";
  children: ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="animate-tv-fade fixed inset-0 z-40 bg-[color-mix(in_srgb,#2d2b2b_50%,transparent)]" />
        <RadixDialog.Content
          className={cn(
            "bg-surface-raised text-foreground fixed z-50 flex flex-col shadow-[0_12px_32px_color-mix(in_srgb,#2d2b2b_22%,transparent)] focus:outline-none",
            variant === "modal"
              ? "animate-tv-fade top-1/2 left-1/2 max-h-[calc(100dvh-2rem)] w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2"
              : "border-border-strong animate-tv-fade inset-y-0 end-0 w-full max-w-lg border-s-2",
          )}
        >
          <div className="border-border-strong flex items-start justify-between gap-4 border-b-2 px-5 pt-4 pb-3">
            <div className="min-w-0">
              <RadixDialog.Title className="text-foreground text-lg font-extrabold tracking-[-0.01em]">
                {title}
              </RadixDialog.Title>
              {description !== undefined ? (
                <RadixDialog.Description className="text-foreground-muted mt-0.5 text-[13px]">
                  {description}
                </RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">
                  {title}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close
              aria-label="Close"
              className="text-foreground hover:bg-surface-hover -me-2 grid size-8 shrink-0 cursor-pointer place-items-center"
            >
              <X aria-hidden="true" size={17} />
            </RadixDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** A right-aligned row of dialog actions. */
export function DialogActions({ children }: { children: ReactNode }) {
  return (
    <div className="border-border mt-5 flex flex-wrap items-center justify-end gap-2 border-t pt-4">
      {children}
    </div>
  );
}
