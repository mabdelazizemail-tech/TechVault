"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { THEME_COOKIE, type Theme } from "./theme";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Switches between the light and dark grounds.
 *
 * The choice is stored in a cookie so the server renders the right theme on the
 * next request, and `data-theme` is updated immediately so the switch needs no
 * reload.
 *
 * The current theme lives in the DOM (the `data-theme` attribute, falling back to
 * the operating-system preference), so it is read with `useSyncExternalStore`
 * rather than mirrored into state from an effect — the DOM is the single source of
 * truth, and a change from anywhere re-renders the icon.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, resolvedTheme, () => null);
  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
      }}
      className="text-foreground hover:bg-surface-hover flex size-9 shrink-0 cursor-pointer items-center justify-center"
    >
      {theme === "dark" ? (
        <Sun aria-hidden="true" size={17} strokeWidth={2} />
      ) : (
        <Moon aria-hidden="true" size={17} strokeWidth={2} />
      )}
    </button>
  );
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  const observer = new MutationObserver(onChange);

  media.addEventListener("change", onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  return () => {
    media.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

function resolvedTheme(): Theme {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}
