"use client";

import { Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { RecordKind, SearchHit } from "../contracts/types";
import { ActivityForm, type ActivityLinks } from "./add-activity";
import { loadRecordMatchesAction, type OptionsResult } from "./option-actions";

/**
 * "New note" on the Notes page. Every note is about a lead, company, contact or
 * deal, so the dialog first asks which one — searching only records the person may
 * see — then shows the note form.
 */

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

const KIND_LABELS: Record<RecordKind, string> = {
  lead: "Lead",
  account: "Company",
  contact: "Contact",
  opportunity: "Opportunity",
};

function linksFor(record: SearchHit): ActivityLinks {
  switch (record.kind) {
    case "lead":
      return { leadId: record.id };
    case "account":
      return { accountId: record.id };
    case "contact":
      return { contactId: record.id };
    case "opportunity":
      return { opportunityId: record.id };
  }
}

export function NewNoteButton({ currentUserId }: { currentUserId: string }) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);

  return (
    <>
      <Button
        variant="primary"
        icon={<Plus aria-hidden="true" size={15} />}
        onClick={() => {
          setFormKey((key) => key + 1);
          setOpen(true);
        }}
      >
        New note
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="New note"
        description="Choose what the note is about, then write it."
        variant="sheet"
      >
        <NoteComposer
          key={formKey}
          currentUserId={currentUserId}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}

function NoteComposer({
  currentUserId,
  onDone,
}: {
  currentUserId: string;
  onDone: () => void;
}) {
  const [record, setRecord] = useState<SearchHit | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<{
    term: string;
    result: OptionsResult<SearchHit[]>;
  } | null>(null);
  const term = query.trim();

  useEffect(() => {
    if (term.length < MIN_QUERY_LENGTH) return;
    const timer = setTimeout(() => {
      void loadRecordMatchesAction(term).then((result) => setSearch({ term, result }));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  if (record !== null) {
    return (
      <div className="flex flex-col gap-3">
        <div className="border-border-strong flex items-center justify-between gap-3 border px-3 py-2">
          <p className="min-w-0 text-[13px]">
            <span className="text-foreground-muted">{KIND_LABELS[record.kind]} · </span>
            <span dir="auto" className="text-foreground font-extrabold">
              {record.label}
            </span>
          </p>
          <Button size="sm" variant="ghost" onClick={() => setRecord(null)}>
            Change
          </Button>
        </div>
        <ActivityForm
          mode={{ kind: "create", links: linksFor(record), types: ["NOTE"] }}
          owners={[]}
          currentUserId={currentUserId}
          defaultType="NOTE"
          onDone={onDone}
        />
      </div>
    );
  }

  const matches = search !== null && search.term === term ? search.result : null;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="note-record-search" className="text-foreground-muted text-xs">
        What is this note about?
      </label>
      <div className="relative">
        <Search
          aria-hidden="true"
          size={15}
          className="text-foreground-subtle pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2"
        />
        <input
          id="note-record-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search leads, companies, contacts and deals"
          autoComplete="off"
          maxLength={100}
          autoFocus
          className="bg-surface-sunken border-border-strong text-foreground placeholder:text-foreground-subtle hover:border-foreground/45 focus-visible:border-primary min-h-9 w-full border ps-8 pe-2.5 text-sm focus-visible:outline-offset-0"
        />
      </div>

      <div aria-live="polite">
        {term.length < MIN_QUERY_LENGTH ? (
          <p className="text-foreground-muted py-2 text-[13px]">
            Type at least two letters of a name.
          </p>
        ) : matches === null ? (
          <p className="text-foreground-muted py-2 text-[13px]">Searching…</p>
        ) : !matches.ok ? (
          <p role="alert" className="text-danger py-2 text-[13px]">
            {matches.message}
          </p>
        ) : matches.data.length === 0 ? (
          <p className="text-foreground-muted py-2 text-[13px]">
            Nothing you can see matches “{term}”.
          </p>
        ) : (
          <ul className="border-border divide-border divide-y border">
            {matches.data.map((hit) => (
              <li key={`${hit.kind}-${hit.id}`}>
                <button
                  type="button"
                  onClick={() => setRecord(hit)}
                  className="hover:bg-surface-hover flex w-full cursor-pointer items-baseline gap-2 px-3 py-2 text-start"
                >
                  <span className="text-foreground-subtle w-20 shrink-0 text-[11px] font-extrabold tracking-[0.04em] uppercase">
                    {KIND_LABELS[hit.kind]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      dir="auto"
                      className="text-foreground block truncate text-[13.5px] font-semibold"
                    >
                      {hit.label}
                    </span>
                    {hit.detail !== null && (
                      <span
                        dir="auto"
                        className="text-foreground-muted block truncate text-xs"
                      >
                        {hit.detail}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
