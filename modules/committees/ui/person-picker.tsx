"use client";

import { PenLine, Plus, UserRound, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { controlClasses } from "@/components/ui/form-controls";
import { cn } from "@/lib/cn";
import { searchPeopleAction } from "./actions";

/**
 * Choosing people: search registered colleagues as you type (the directory is
 * searched on the server, never loaded whole into the browser), and — where
 * allowed — add a name typed in for someone who has no account. Registered users
 * and typed names stay visibly different, in the chips and in what is sent.
 */

export type PickedPerson =
  { kind: "user"; userId: string; name: string } | { kind: "manual"; name: string };

type Result = { id: string; name: string; email: string };

export function PersonPicker({
  id,
  label,
  value,
  onChange,
  allowManual,
  max,
  error,
  hint,
}: {
  id: string;
  label: string;
  value: readonly PickedPerson[];
  onChange: (next: PickedPerson[]) => void;
  allowManual: boolean;
  max: number;
  error?: string;
  hint?: string;
}) {
  const [query, setQuery] = useState("");
  // Results remember the query they answer, so a stale answer is never shown.
  const [found, setFound] = useState<{
    query: string;
    results: Result[];
    error: string | null;
  } | null>(null);
  const request = useRef(0);
  const listId = useId();

  const trimmed = query.replace(/\s+/g, " ").trim();
  const full = value.length >= max;

  useEffect(() => {
    if (trimmed.length < 2) return;
    const ticket = ++request.current;
    const timer = setTimeout(() => {
      void searchPeopleAction(trimmed).then((result) => {
        if (ticket !== request.current) return;
        setFound({
          query: trimmed,
          results: result.ok ? result.data : [],
          error: result.ok ? null : result.message,
        });
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [trimmed]);
  const results = found !== null && found.query === trimmed ? found.results : null;
  const searchError = found !== null && found.query === trimmed ? found.error : null;

  const chosenIds = new Set(
    value.flatMap((person) => (person.kind === "user" ? [person.userId] : [])),
  );
  const hasName = (name: string) =>
    value.some(
      (person) =>
        person.kind === "manual" && person.name.toLowerCase() === name.toLowerCase(),
    );
  const shown = (results ?? []).filter((result) => !chosenIds.has(result.id));

  const add = (person: PickedPerson) => {
    if (full) return;
    onChange([...value, person]);
    setQuery("");
  };
  const addManual = () => {
    if (allowManual && trimmed !== "" && !hasName(trimmed)) {
      add({ kind: "manual", name: trimmed.slice(0, 120) });
    }
  };

  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="text-foreground-muted mb-1 text-xs">
        {label}
        {value.length > 0 && ` · ${value.length} chosen`}
      </legend>

      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`${label}: chosen`}>
          {value.map((person, index) => (
            <li
              key={person.kind === "user" ? person.userId : `manual:${person.name}`}
              className={cn(
                "text-foreground inline-flex max-w-full items-center gap-1 border py-0.5 ps-1.5 text-xs",
                person.kind === "user"
                  ? "border-border font-semibold"
                  : "border-border-strong border-dashed italic",
              )}
            >
              {person.kind === "user" ? (
                <UserRound aria-hidden="true" className="size-3.5 shrink-0" />
              ) : (
                <PenLine aria-hidden="true" className="size-3.5 shrink-0" />
              )}
              <span dir="auto" className="truncate">
                {person.name}
              </span>
              {person.kind === "manual" && (
                <span className="text-foreground-muted not-italic">(not registered)</span>
              )}
              <button
                type="button"
                onClick={() => onChange(value.filter((_, at) => at !== index))}
                aria-label={`Remove ${person.name}`}
                className="hover:bg-surface-hover grid size-6 cursor-pointer place-items-center pointer-coarse:size-9"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={trimmed.length >= 2}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={error !== undefined || undefined}
        aria-describedby={hint !== undefined ? `${id}-hint` : undefined}
        value={query}
        disabled={full}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          // Enter adds a person rather than submitting the whole form.
          event.preventDefault();
          const first = shown[0];
          if (first !== undefined)
            add({ kind: "user", userId: first.id, name: first.name });
          else addManual();
        }}
        placeholder={
          full
            ? `At most ${max}`
            : allowManual
              ? "Search colleagues, or type any name"
              : "Search colleagues by name"
        }
        autoComplete="off"
        className={cn(
          controlClasses,
          "min-h-9 pointer-coarse:min-h-11",
          error !== undefined ? "border-danger" : "border-border-strong",
        )}
      />

      {trimmed.length >= 2 && (
        <div
          id={listId}
          className="border-border max-h-52 overflow-y-auto border"
          aria-live="polite"
        >
          {results === null ? (
            <p className="text-foreground-muted px-2.5 py-2 text-xs">Searching…</p>
          ) : shown.length === 0 ? (
            <p className="text-foreground-muted px-2.5 py-2 text-xs">
              {searchError ?? "No colleague matches."}
            </p>
          ) : (
            <ul>
              {shown.map((result) => (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() =>
                      add({ kind: "user", userId: result.id, name: result.name })
                    }
                    className="hover:bg-surface-hover flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-start text-sm pointer-coarse:min-h-11"
                  >
                    <UserRound aria-hidden="true" className="size-4 shrink-0" />
                    <span dir="auto" className="min-w-0 flex-1 truncate font-semibold">
                      {result.name}
                    </span>
                    <span className="text-foreground-muted truncate text-xs">
                      {result.email}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {allowManual && trimmed !== "" && !hasName(trimmed) && (
            <button
              type="button"
              onClick={addManual}
              className="border-border text-primary-ink hover:bg-surface-hover flex w-full cursor-pointer items-center gap-2 border-t px-2.5 py-1.5 text-start text-sm font-bold pointer-coarse:min-h-11"
            >
              <Plus aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 truncate">
                Add “<span dir="auto">{trimmed}</span>” as a name (not a TechVault user)
              </span>
            </button>
          )}
        </div>
      )}

      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-foreground-subtle text-xs">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </fieldset>
  );
}
