"use client";

import { Search, X } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { controlClasses } from "@/components/ui/form-controls";
import { cn } from "@/lib/cn";
import type { CustomerRef } from "../contracts/types";
import { searchCustomersAction } from "./ar-actions";

/**
 * Chooses a CRM company as the customer. The search runs on the server through
 * CRM's contract, a few characters at a time; nothing about the customer is copied
 * into ERP but its id.
 */
export function CustomerPicker({
  id,
  value,
  onChange,
  error,
  disabled,
}: {
  id: string;
  value: CustomerRef | null;
  onChange: (customer: CustomerRef | null) => void;
  error?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerRef[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = (text: string) => {
    setQuery(text);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      startTransition(async () => {
        const result = await searchCustomersAction(text);
        if (result.ok) {
          setResults(result.data);
          setMessage(result.data.length === 0 ? "No CRM company matches." : null);
        } else {
          setResults([]);
          setMessage(result.message);
        }
      });
    }, 250);
  };

  if (value !== null) {
    return (
      <div
        className={cn(
          "border-border-strong bg-surface flex min-h-10 items-center justify-between gap-2 border-2 px-3",
          error !== undefined && "border-danger",
        )}
      >
        <span dir="auto" className="truncate text-sm font-semibold">
          {value.name}
        </span>
        {disabled !== true && (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setQuery("");
              setResults([]);
            }}
            aria-label="Choose another customer"
            className="text-foreground-muted hover:text-foreground cursor-pointer p-1"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <label className="relative block">
        <span className="sr-only">Search CRM companies</span>
        <Search
          aria-hidden="true"
          className="text-foreground-muted pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
        />
        <input
          id={id}
          type="search"
          value={query}
          dir="auto"
          autoComplete="off"
          disabled={disabled}
          placeholder="Search CRM companies…"
          aria-invalid={error !== undefined || undefined}
          onChange={(event) => search(event.target.value)}
          onFocus={() => {
            if (results.length === 0) search(query);
          }}
          className={cn(
            controlClasses,
            "min-h-10 ps-9",
            error !== undefined ? "border-danger" : "border-border-strong",
          )}
        />
      </label>
      {(results.length > 0 || message !== null || isPending) && (
        <div className="panel absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto">
          {isPending && results.length === 0 && (
            <p className="text-foreground-muted px-3 py-2 text-sm">Searching…</p>
          )}
          {message !== null && !isPending && (
            <p className="text-foreground-muted px-3 py-2 text-sm">{message}</p>
          )}
          <ul role="listbox" aria-label="CRM companies">
            {results.map((customer) => (
              <li key={customer.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    onChange(customer);
                    setResults([]);
                  }}
                  className="hover:bg-surface-hover w-full cursor-pointer px-3 py-2 text-start text-sm"
                  dir="auto"
                >
                  {customer.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
