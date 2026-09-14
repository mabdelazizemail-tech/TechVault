"use client";

import { useEffect, useState } from "react";
import type { PersonRef } from "../contracts/types";
import { loadPeopleAction } from "./actions";

/**
 * The colleague list for owner and team pickers, fetched the first time a form
 * opens — never with the page.
 */
export function usePeople(open: boolean): {
  people: PersonRef[] | null;
  error: string | null;
} {
  const [state, setState] = useState<{
    people: PersonRef[] | null;
    error: string | null;
  }>({
    people: null,
    error: null,
  });
  const loaded = state.people !== null;

  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    void loadPeopleAction().then((result) => {
      if (cancelled) return;
      setState(
        result.ok
          ? { people: result.data, error: null }
          : { people: null, error: result.message },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, loaded]);

  return state;
}
