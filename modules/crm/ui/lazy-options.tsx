"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FormLoading } from "./form-loading";
import type { OptionsResult } from "./option-actions";

/**
 * Loads a dialog's option lists the first time it opens and keeps them for later
 * opens. A failed load is retried the next time the dialog opens.
 */

export type LazyOptions<T> =
  | { status: "pending" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

const LOAD_FAILED = "The form could not be loaded. Close it and try again.";

export function useLazyOptions<T>(
  load: () => Promise<OptionsResult<T>>,
  enabled: boolean,
): LazyOptions<T> {
  const [state, setState] = useState<LazyOptions<T>>({ status: "pending" });
  const loaded = useRef(false);

  useEffect(() => {
    if (!enabled || loaded.current) return;
    let active = true;
    load()
      .then((result) => {
        if (!active) return;
        if (result.ok) {
          loaded.current = true;
          setState({ status: "ready", data: result.data });
        } else {
          setState({ status: "error", message: result.message });
        }
      })
      .catch(() => {
        if (active) setState({ status: "error", message: LOAD_FAILED });
      });
    return () => {
      active = false;
    };
  }, [enabled, load]);

  return state;
}

/** Renders the form once its options are ready; until then, a loading line or the error. */
export function OptionsGate<T>({
  state,
  children,
}: {
  state: LazyOptions<T>;
  children: (data: T) => ReactNode;
}) {
  if (state.status === "ready") return <>{children(state.data)}</>;
  if (state.status === "error") {
    return (
      <p
        role="alert"
        className="border-danger/25 bg-danger-subtle text-danger border px-3 py-2 text-xs"
      >
        {state.message}
      </p>
    );
  }
  return <FormLoading />;
}
