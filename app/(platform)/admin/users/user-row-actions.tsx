"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, MoreHorizontal, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  useActiveUserDialog,
  useUserDialogActions,
  type UserDialogKind,
} from "./user-dialog-state";
import {
  CreateUserDialog,
  DeleteUserDialog,
  EditUserDialog,
  ResetPasswordDialog,
  RolesDialog,
  StatusDialog,
  UnitDialog,
} from "./user-dialogs";
import { useUsersAdmin, type ManagedUser } from "./users-admin-context";

const ITEM =
  "text-foreground data-highlighted:bg-surface-hover flex cursor-pointer items-center px-2.5 py-1.5 text-sm outline-none";

/**
 * The Actions menu for one user. It offers only what the signed-in administrator
 * may do; the server authorises every action again against this specific user.
 * Choosing an item opens the shared dialog rendered by `UserDialogsHost`.
 */
export function UserRowActions({
  user,
  placement = "list",
}: {
  user: ManagedUser;
  placement?: "list" | "detail";
}) {
  const { rights } = useUsersAdmin();
  const { openUserDialog } = useUserDialogActions();
  const open = (kind: UserDialogKind) => openUserDialog({ kind, user, placement });

  return (
    // Non-modal so opening a dialog from an item does not fight the menu for focus.
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        aria-label={`Actions for ${user.email}`}
        className={cn(
          "cursor-pointer",
          placement === "list"
            ? "text-foreground-muted hover:bg-surface-hover hover:text-foreground inline-grid size-8 place-items-center"
            : "border-border-strong text-foreground hover:bg-surface-hover inline-flex min-h-9 items-center gap-1.5 border px-3.5 text-sm font-extrabold",
        )}
      >
        {placement === "list" ? (
          <MoreHorizontal aria-hidden="true" size={17} />
        ) : (
          <>
            Actions
            <ChevronDown aria-hidden="true" size={15} />
          </>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="border-border-strong bg-surface-raised z-50 min-w-52 border p-1 shadow-[0_12px_32px_color-mix(in_srgb,#2d2b2b_22%,transparent)]"
        >
          {placement === "list" && (
            <DropdownMenu.Item asChild className={ITEM}>
              <Link href={`/admin/users/${user.id}`}>View</Link>
            </DropdownMenu.Item>
          )}
          {rights.update && (
            <DropdownMenu.Item className={ITEM} onSelect={() => open("edit")}>
              Edit
            </DropdownMenu.Item>
          )}
          {rights.administer && (
            <DropdownMenu.Item className={ITEM} onSelect={() => open("roles")}>
              Change role
            </DropdownMenu.Item>
          )}
          {rights.update && (
            <DropdownMenu.Item className={ITEM} onSelect={() => open("unit")}>
              Change organisation unit
            </DropdownMenu.Item>
          )}
          {rights.update && (
            <DropdownMenu.Item className={ITEM} onSelect={() => open("status")}>
              {user.isActive ? "Deactivate" : "Activate"}
            </DropdownMenu.Item>
          )}
          {rights.administer && user.isActive && (
            <DropdownMenu.Item className={ITEM} onSelect={() => open("reset")}>
              Reset password
            </DropdownMenu.Item>
          )}
          {rights.delete && (
            <>
              <DropdownMenu.Separator className="bg-border my-1 h-px" />
              <DropdownMenu.Item
                className={cn(ITEM, "text-danger")}
                onSelect={() => open("delete")}
              >
                Delete user
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * The one set of user dialogs for the page. Rendered once, beside the table or
 * the details, and opened by whichever row's menu was used.
 */
export function UserDialogsHost() {
  const active = useActiveUserDialog();
  const { closeUserDialog } = useUserDialogActions();
  const router = useRouter();

  if (active === null) return null;

  const { user, kind, open, placement } = active;
  const onOpenChange = (next: boolean) => {
    if (!next) closeUserDialog();
  };

  return (
    <>
      <EditUserDialog
        user={user}
        open={open && kind === "edit"}
        onOpenChange={onOpenChange}
      />
      <RolesDialog
        user={user}
        open={open && kind === "roles"}
        onOpenChange={onOpenChange}
      />
      <UnitDialog
        user={user}
        open={open && kind === "unit"}
        onOpenChange={onOpenChange}
      />
      <StatusDialog
        user={user}
        open={open && kind === "status"}
        onOpenChange={onOpenChange}
      />
      <ResetPasswordDialog
        user={user}
        open={open && kind === "reset"}
        onOpenChange={onOpenChange}
      />
      <DeleteUserDialog
        user={user}
        open={open && kind === "delete"}
        onOpenChange={onOpenChange}
        onDeleted={() => {
          if (placement === "detail") router.push("/admin/users");
        }}
      />
    </>
  );
}

/** The page-level "Add user" button, shown only to administrators who may create users. */
export function AddUserButton() {
  const { rights } = useUsersAdmin();
  const [open, setOpen] = useState(false);
  if (!rights.create) return null;

  return (
    <>
      <Button
        variant="primary"
        icon={<Plus aria-hidden="true" size={15} />}
        onClick={() => setOpen(true)}
      >
        Add user
      </Button>
      <CreateUserDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
