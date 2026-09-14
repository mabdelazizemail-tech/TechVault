"use client";

import { createContext, useContext, type ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { UserDialogStateProvider } from "./user-dialog-state";
import type { UserAdminOptions } from "@/platform/iam/services/user-admin-service";

/**
 * What the Users screens share: the filter and form options, and which actions to
 * offer. Provided once per page rather than serialised into every row.
 *
 * `rights` decides only what the menu shows. Every action is authorised again on
 * the server, against the specific user it targets.
 */

export type ManagedUser = {
  id: string;
  email: string;
  fullName: string | null;
  locale: string;
  isActive: boolean;
  orgUnitId: string | null;
  /** Unscoped role assignments, which the "Change role" dialog manages. */
  globalRoleIds: string[];
};

export type UsersAdminValue = {
  currentUserId: string;
  accountAdminConfigured: boolean;
  rights: { create: boolean; update: boolean; administer: boolean; delete: boolean };
  options: UserAdminOptions;
};

const UsersAdminContext = createContext<UsersAdminValue | null>(null);

export function UsersAdminProvider({
  value,
  children,
}: {
  value: UsersAdminValue;
  children: ReactNode;
}) {
  return (
    <UsersAdminContext.Provider value={value}>
      <ToastProvider>
        <UserDialogStateProvider>{children}</UserDialogStateProvider>
      </ToastProvider>
    </UsersAdminContext.Provider>
  );
}

export function useUsersAdmin(): UsersAdminValue {
  const value = useContext(UsersAdminContext);
  if (value === null)
    throw new Error("useUsersAdmin must be used inside UsersAdminProvider.");
  return value;
}
