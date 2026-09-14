"use client";

import { Smile } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

/**
 * A small emoji palette for the composer. A fixed set rather than a dependency:
 * a full emoji library would cost more than the whole Messenger (CLAUDE.md §3).
 * Operating-system emoji keyboards remain available for anything else.
 */

const EMOJI = [
  "😀",
  "😂",
  "😊",
  "🙂",
  "😉",
  "😍",
  "🤔",
  "😅",
  "😮",
  "😢",
  "😡",
  "👍",
  "👎",
  "👏",
  "🙏",
  "🤝",
  "💪",
  "👀",
  "🎉",
  "🔥",
  "💯",
  "✅",
  "❌",
  "⚠️",
  "💡",
  "📄",
  "📎",
  "📅",
  "⏰",
  "☕",
  "❤️",
  "🚀",
] as const;

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const paletteId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Insert emoji"
        aria-expanded={open}
        aria-controls={paletteId}
        className="text-primary-ink hover:bg-surface-hover grid size-9 cursor-pointer place-items-center"
      >
        <Smile aria-hidden="true" size={19} />
      </button>
      {open && (
        <div
          id={paletteId}
          role="group"
          aria-label="Emoji"
          className="bg-surface-raised border-border-strong absolute start-0 bottom-11 z-10 grid w-72 grid-cols-8 gap-0.5 border-2 p-1.5 shadow-[0_12px_32px_color-mix(in_srgb,#2d2b2b_22%,transparent)]"
        >
          {EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onPick(emoji);
                setOpen(false);
              }}
              aria-label={`Insert ${emoji}`}
              className="hover:bg-surface-hover grid size-8 cursor-pointer place-items-center text-lg"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
