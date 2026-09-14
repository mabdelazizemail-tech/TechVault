"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { Brand } from "./brand";
import type { NavSection } from "./navigation";
import { Sidebar } from "./sidebar";

/**
 * The navigation on screens without room for the sidebar: a menu button that opens
 * the same list in a drawer from the inline start. Radix traps focus, closes on
 * Escape and returns focus to the button (§17.5).
 */
export function MobileNav({ sections }: { sections: readonly NavSection[] }) {
  const [open, setOpen] = useState(false);

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Trigger
        aria-label="Open navigation"
        className="text-foreground hover:bg-surface-hover shrink-0 cursor-pointer p-2 lg:hidden"
      >
        <Menu aria-hidden="true" className="size-5" />
      </RadixDialog.Trigger>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="animate-tv-fade fixed inset-0 z-40 bg-black/50 lg:hidden" />
        <RadixDialog.Content className="bg-surface rule-e animate-tv-fade fixed inset-y-0 start-0 z-50 flex w-72 max-w-[85vw] flex-col focus:outline-none lg:hidden">
          <RadixDialog.Title className="sr-only">Navigation</RadixDialog.Title>
          <RadixDialog.Description className="sr-only">
            Every screen you can open.
          </RadixDialog.Description>
          <div className="rule-b flex h-(--spacing-header) shrink-0 items-center justify-between px-4">
            <Brand />
            <RadixDialog.Close
              aria-label="Close navigation"
              className="text-foreground hover:bg-surface-hover cursor-pointer p-2"
            >
              <X aria-hidden="true" className="size-5" />
            </RadixDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Sidebar sections={sections} onNavigate={() => setOpen(false)} />
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
