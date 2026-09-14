"use client";

import { Search, X } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { ConversationSummaryDto, DirectoryMatchDto } from "../../contracts/types";
import {
  openDirectConversationAction,
  searchPeopleAction,
  type MessagingResult,
} from "../actions";
import { Avatar } from "../avatar";
import { formatInboxTime } from "../format";
import { useMessagingControls, usePresence } from "../messaging-provider";
import { useMessengerActions } from "./messenger-state";

/**
 * The Messenger panel: recent conversations and people search.
 *
 * Search runs on the server, debounced: the browser holds at most twenty matches,
 * never the directory. Choosing a person opens the existing direct conversation or
 * creates it, then opens its chat window.
 */

const SEARCH_DEBOUNCE_MS = 250;

export function ChatPanel({
  summaries,
  error,
  onChanged,
}: {
  /** Null while the list is loading. */
  summaries: readonly ConversationSummaryDto[] | null;
  error: string | null;
  onChanged: () => Promise<void>;
}) {
  const actions = useMessengerActions();
  const { me } = useMessagingControls();
  const { onlineIds } = usePresence();

  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<{
    term: string;
    result: MessagingResult<DirectoryMatchDto[]>;
  } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const term = query.trim();

  useEffect(() => {
    if (term === "") return;
    const timer = setTimeout(() => {
      void searchPeopleAction(term).then((result) => setSearch({ term, result }));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const openPerson = async (person: DirectoryMatchDto) => {
    setOpening(person.id);
    setOpenError(null);
    const result = await openDirectConversationAction(person.id);
    setOpening(null);
    if (!result.ok) {
      setOpenError(result.message);
      return;
    }
    setQuery("");
    actions.openConversation(result.data.conversationId);
    void onChanged();
  };

  const needle = term.toLowerCase();
  const shown = (summaries ?? []).filter(
    (conversation) =>
      needle === "" ||
      conversation.counterpart.name.toLowerCase().includes(needle) ||
      conversation.counterpart.email.toLowerCase().includes(needle),
  );
  const people = search !== null && search.term === term ? search.result : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border flex shrink-0 items-center justify-between border-b px-3 py-2.5">
        <h2 className="text-foreground text-lg font-extrabold tracking-[-0.01em]">
          Messages
        </h2>
        <button
          type="button"
          onClick={actions.closePanel}
          aria-label="Close messages"
          className="text-foreground-muted hover:bg-surface-hover hover:text-foreground grid size-8 cursor-pointer place-items-center rounded-full"
        >
          <X aria-hidden="true" size={18} />
        </button>
      </div>

      <div className="shrink-0 px-3 py-2.5">
        <label htmlFor="messenger-search" className="sr-only">
          Search Messenger
        </label>
        <div className="relative">
          <Search
            aria-hidden="true"
            size={15}
            className="text-foreground-subtle pointer-events-none absolute start-3 top-1/2 -translate-y-1/2"
          />
          <input
            id="messenger-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Messenger"
            autoComplete="off"
            maxLength={100}
            autoFocus
            className="bg-surface-sunken text-foreground placeholder:text-foreground-subtle focus-visible:border-primary border-border min-h-9 w-full rounded-full border ps-9 pe-3 text-sm focus-visible:outline-offset-0"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {term !== "" && (
          <section aria-labelledby="messenger-people-heading">
            <h3 id="messenger-people-heading" className={SECTION_HEADING}>
              People
            </h3>
            <div aria-live="polite">
              {people === null ? (
                <p className="text-foreground-muted px-3 py-2 text-[13px]">Searching…</p>
              ) : !people.ok ? (
                <p role="alert" className="text-danger px-3 py-2 text-[13px]">
                  {people.message}
                </p>
              ) : people.data.length === 0 ? (
                <p className="text-foreground-muted px-3 py-2 text-[13px]">
                  No colleague matches “{term}”.
                </p>
              ) : (
                <ul>
                  {people.data.map((person) => (
                    <li key={person.id}>
                      <button
                        type="button"
                        onClick={() => void openPerson(person)}
                        disabled={opening !== null}
                        aria-busy={opening === person.id || undefined}
                        className="hover:bg-surface-hover flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-start disabled:cursor-wait"
                      >
                        <Avatar
                          name={person.name}
                          online={onlineIds.has(person.id)}
                          className="rounded-full"
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            dir="auto"
                            className="text-foreground block truncate text-[13.5px] font-semibold"
                          >
                            {person.name}
                          </span>
                          <span className="text-foreground-muted block truncate text-xs">
                            {opening === person.id ? "Opening…" : person.email}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {openError !== null && (
                <p role="alert" className="text-danger px-3 py-2 text-[13px]">
                  {openError}
                </p>
              )}
            </div>
          </section>
        )}

        <section aria-labelledby={term !== "" ? "messenger-chats-heading" : undefined}>
          {term !== "" && (
            <h3 id="messenger-chats-heading" className={SECTION_HEADING}>
              Chats
            </h3>
          )}
          {summaries === null ? (
            error !== null ? (
              <p role="alert" className="text-danger px-3 py-4 text-[13px]">
                {error}
              </p>
            ) : (
              <ul aria-busy="true" className="animate-pulse">
                {[0, 1, 2].map((index) => (
                  <li key={index} className="flex items-center gap-2.5 px-3 py-2.5">
                    <span className="bg-surface-sunken size-10 rounded-full" />
                    <span className="flex flex-1 flex-col gap-1.5">
                      <span className="bg-surface-sunken h-3 w-32" />
                      <span className="bg-surface-sunken h-2.5 w-44" />
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : shown.length === 0 ? (
            <div className="px-3 py-6">
              <p className="text-foreground text-[14px] font-extrabold">
                {term === "" ? "No conversations yet" : "No matching chats"}
              </p>
              <p className="text-foreground-muted mt-1 text-[13px]">
                Search for a colleague by name or email to start one.
              </p>
            </div>
          ) : (
            <ul>
              {shown.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  viewerId={me.id}
                  isOnline={onlineIds.has(conversation.counterpart.id)}
                  onOpen={actions.openConversation}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

const SECTION_HEADING =
  "text-foreground-subtle px-3 pt-2 pb-1 text-[11px] font-extrabold tracking-[0.06em] uppercase";

const ConversationRow = memo(function ConversationRow({
  conversation,
  viewerId,
  isOnline,
  onOpen,
}: {
  conversation: ConversationSummaryDto;
  viewerId: string;
  isOnline: boolean;
  onOpen: (conversationId: string) => void;
}) {
  const { counterpart, lastMessage, unreadCount } = conversation;
  const preview =
    lastMessage === null
      ? "No messages yet"
      : lastMessage.senderId === viewerId
        ? `You: ${lastMessage.preview}`
        : lastMessage.preview;

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(conversation.id)}
        className="hover:bg-surface-hover flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-start"
      >
        <Avatar
          name={counterpart.name}
          online={counterpart.isActive ? isOnline : undefined}
          className="size-10 rounded-full"
        />
        <span className="min-w-0 flex-1">
          <span
            dir="auto"
            className={cn(
              "text-foreground block truncate text-[13.5px]",
              unreadCount > 0 ? "font-extrabold" : "font-semibold",
            )}
          >
            {counterpart.name}
          </span>
          <span className="flex items-center gap-1.5 text-xs">
            <span
              dir="auto"
              className={cn(
                "min-w-0 truncate",
                unreadCount > 0
                  ? "text-foreground font-semibold"
                  : "text-foreground-muted",
              )}
            >
              {counterpart.isActive ? preview : `Deactivated · ${preview}`}
            </span>
            {lastMessage !== null && (
              <span className="text-foreground-subtle shrink-0" suppressHydrationWarning>
                · {formatInboxTime(lastMessage.createdAt)}
              </span>
            )}
          </span>
        </span>
        {unreadCount > 0 && (
          <span
            aria-label={`${unreadCount} unread`}
            className="bg-primary text-primary-foreground grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[11px] font-extrabold"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
    </li>
  );
});
