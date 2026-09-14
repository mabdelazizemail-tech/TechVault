"use client";

import { ArrowUp, Bot, FileText, FolderKanban, Lightbulb, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import type { AnswerSource, AssistantAnswer } from "../contracts/types";
import { askThinkTankAction } from "./actions";

/**
 * Ask Think Tank: a question box and a running conversation of answers with their
 * sources. V1 answers with the most relevant items; when an AI engine is connected
 * the same screen shows its written answer above those sources.
 */

type Exchange =
  | { id: number; question: string; status: "pending" }
  | { id: number; question: string; status: "done"; result: AssistantAnswer }
  | { id: number; question: string; status: "error"; message: string };

const EXAMPLES = [
  "How did we solve the OCR problem in our previous project?",
  "What is our procedure for month-end closing?",
  "Lessons learned from banking projects",
];

const SOURCE_ICONS = {
  knowledge: FileText,
  project: FolderKanban,
  idea: Lightbulb,
} as const;

export function AskThinkTank({ initial }: { initial: AssistantAnswer | null }) {
  const [exchanges, setExchanges] = useState<Exchange[]>(() =>
    initial === null
      ? []
      : [{ id: 0, question: initial.question, status: "done", result: initial }],
  );
  const [question, setQuestion] = useState("");
  const [isPending, startTransition] = useTransition();
  const nextId = useRef(1);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [exchanges]);

  const ask = (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 2 || isPending) return;
    const id = nextId.current;
    nextId.current += 1;
    setQuestion("");
    setExchanges((current) => [...current, { id, question: trimmed, status: "pending" }]);
    startTransition(async () => {
      const result = await askThinkTankAction(trimmed);
      setExchanges((current) =>
        current.map((exchange) =>
          exchange.id !== id
            ? exchange
            : result.ok
              ? { id, question: trimmed, status: "done", result: result.data }
              : { id, question: trimmed, status: "error", message: result.message },
        ),
      );
    });
  };

  const empty = exchanges.length === 0;

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-3xl flex-col",
        empty && "min-h-[60vh] justify-center",
      )}
    >
      {empty && (
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="bg-primary text-primary-foreground mb-4 grid size-12 place-items-center">
            <Bot aria-hidden="true" size={24} />
          </span>
          <h1 className="text-foreground text-[30px] leading-tight">
            Ask anything about our knowledge
          </h1>
          <p className="text-foreground-muted mt-2 max-w-xl text-[13.5px]">
            Search every document, lesson learned, project and idea in THE THINK TANK —
            and see exactly where each answer comes from.
          </p>
        </div>
      )}

      {!empty && (
        <ol aria-label="Questions and answers" className="mb-4 flex flex-col gap-5">
          {exchanges.map((exchange) => (
            <li key={exchange.id} className="flex flex-col gap-2.5">
              <p
                dir="auto"
                className="bg-foreground text-canvas max-w-[85%] self-end px-3.5 py-2 text-[14px]"
              >
                {exchange.question}
              </p>
              <AnswerCard exchange={exchange} />
            </li>
          ))}
        </ol>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          ask(question);
        }}
        className={cn(
          "bg-surface border-border-strong flex items-end gap-2 border-2 p-2",
          !empty && "sticky bottom-0",
        )}
      >
        <label htmlFor="ask-question" className="sr-only">
          Your question
        </label>
        <textarea
          id="ask-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              ask(question);
            }
          }}
          rows={empty ? 2 : 1}
          maxLength={500}
          placeholder="Ask anything about our knowledge…"
          dir="auto"
          autoFocus
          className="text-foreground placeholder:text-foreground-subtle min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] focus-visible:outline-none"
        />
        <button
          type="submit"
          disabled={question.trim().length < 2 || isPending}
          aria-label="Ask"
          className="bg-primary text-primary-foreground hover:bg-primary-hover grid size-10 shrink-0 cursor-pointer place-items-center disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowUp aria-hidden="true" size={18} />
        </button>
      </form>

      {empty && (
        <ul className="mt-4 flex flex-wrap justify-center gap-2">
          {EXAMPLES.map((example) => (
            <li key={example}>
              <button
                type="button"
                onClick={() => ask(example)}
                className="border-border text-foreground-muted hover:border-border-strong hover:text-foreground cursor-pointer border px-3 py-1.5 text-[12.5px]"
              >
                {example}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div ref={bottom} />
    </div>
  );
}

function AnswerCard({ exchange }: { exchange: Exchange }) {
  if (exchange.status === "pending") {
    return (
      <div
        role="status"
        className="bg-surface border-border animate-pulse border px-4 py-3"
      >
        <span className="text-foreground-muted text-[13px]">
          Searching THE THINK TANK…
        </span>
      </div>
    );
  }
  if (exchange.status === "error") {
    return (
      <p
        role="alert"
        className="border-danger/25 bg-danger-subtle text-danger border px-4 py-3 text-[13px]"
      >
        {exchange.message}
      </p>
    );
  }

  const { result } = exchange;
  return (
    <section aria-label="Answer" className="bg-surface border-border border px-4 py-3">
      {result.answer !== null ? (
        <p dir="auto" className="text-foreground text-[14px] whitespace-pre-line">
          {result.answer}
        </p>
      ) : result.sources.length > 0 ? (
        <p className="text-foreground-muted flex items-start gap-2 text-[13px]">
          <Sparkles aria-hidden="true" size={15} className="mt-0.5 shrink-0" />
          AI-written answers aren&apos;t switched on yet. These are the most relevant
          items in THE THINK TANK:
        </p>
      ) : (
        <p className="text-foreground-muted text-[13px]">
          Nothing in THE THINK TANK matches that yet. Try different words — or, if you
          know the answer, add it to Knowledge so the next person finds it.
        </p>
      )}

      {result.sources.length > 0 && (
        <div className="mt-3">
          <h2 className="text-foreground-subtle mb-1.5 text-[11px] font-extrabold tracking-[0.06em] uppercase">
            Sources
          </h2>
          <ul className="border-border divide-border divide-y border">
            {result.sources.map((source) => (
              <SourceRow key={`${source.kind}-${source.id}`} source={source} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function SourceRow({ source }: { source: AnswerSource }) {
  const Icon = SOURCE_ICONS[source.kind];
  return (
    <li className="flex gap-3 px-3 py-2.5">
      <Icon
        aria-hidden="true"
        size={16}
        className="text-foreground-muted mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <Link
          href={source.href}
          dir="auto"
          className="text-foreground hover:text-primary-ink text-[13.5px] font-extrabold hover:underline"
        >
          {source.title}
        </Link>
        {source.context !== null && (
          <span className="text-foreground-subtle ms-2 text-[11.5px]">
            {source.context}
          </span>
        )}
        {source.excerpt !== "" && (
          <p dir="auto" className="text-foreground-muted mt-0.5 text-[12.5px]">
            …{source.excerpt}…
          </p>
        )}
      </div>
      {source.fileId !== null && (
        <Link
          href={source.href}
          className="text-primary-ink shrink-0 self-center text-xs font-extrabold hover:underline"
        >
          Open document
        </Link>
      )}
    </li>
  );
}
