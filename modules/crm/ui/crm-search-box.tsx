"use client";

import { Search } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { controlClasses } from "@/components/ui/form-controls";
import { cn } from "@/lib/cn";

/**
 * Global CRM search: one box on every CRM screen, searching leads, companies,
 * contacts and opportunities together. On the results page it shows the query,
 * so a search can be refined in place.
 */
export function CrmSearchBox() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = pathname === "/crm/search" ? (searchParams.get("q") ?? "") : "";

  return (
    <form
      key={query}
      method="get"
      action="/crm/search"
      role="search"
      className="relative w-full sm:w-80"
    >
      <label htmlFor="crm-search" className="sr-only">
        Search the CRM
      </label>
      <Search
        aria-hidden="true"
        size={15}
        className="text-foreground-muted pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2"
      />
      <input
        id="crm-search"
        type="search"
        name="q"
        defaultValue={query}
        placeholder="Search leads, companies, contacts, deals…"
        className={cn(controlClasses, "border-border-strong min-h-9 ps-8")}
      />
    </form>
  );
}
