"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { ManagedUser } from "./users-admin-context";

/**
 * Which user administration dialog is open, and for whom. One set of dialogs
 * serves the whole table instead of six per row.
 *
 * The open/close functions live in their own context with a stable value, so
 * opening a dialog re-renders the dialog host, not every row's menu.
 */

export type UserDialogKind =
  "edit" | "roles" | "unit" | "status" | "reset" | "password" | "delete";

export type UserDialogRequest = {
  kind: UserDialogKind;
  user: ManagedUser;
  placement: "list" | "detail";
};

/** `open` is kept separately so a closing dialog keeps its content while it animates out. */
export type ActiveUserDialog = UserDialogRequest & { open: boolean };

type DialogActions = {
  openUserDialog: (request: UserDialogRequest) => void;
  closeUserDialog: () => void;
};

const ActiveDialogContext = createContext<ActiveUserDialog | null>(null);
const DialogActionsContext = createContext<DialogActions | null>(null);

export function UserDialogStateProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveUserDialog | null>(null);

  const actions = useMemo<DialogActions>(
    () => ({
      openUserDialog: (request) => setActive({ ...request, open: true }),
      closeUserDialog: () =>
        setActive((current) => (current === null ? null : { ...current, open: false })),
    }),
    [],
  );

  return (
    <DialogActionsContext.Provider value={actions}>
      <ActiveDialogContext.Provider value={active}>
        {children}
      </ActiveDialogContext.Provider>
    </DialogActionsContext.Provider>
  );
}

export function useUserDialogActions(): DialogActions {
  const actions = useContext(DialogActionsContext);
  if (actions === null) {
    throw new Error("useUserDialogActions must be used inside UserDialogStateProvider.");
  }
  return actions;
}

export function useActiveUserDialog(): ActiveUserDialog | null {
  return useContext(ActiveDialogContext);
}
