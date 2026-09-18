"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { sectionLabelsForAccessKeys } from "@/components/shell/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import {
  Checkbox,
  Field,
  Input,
  Select,
  Textarea,
  describedBy,
  type Option,
} from "@/components/ui/form-controls";
import { useToast } from "@/components/ui/toast";
import { visibleEmail } from "@/platform/iam/usernames";
import {
  createUserAction,
  deleteUserAction,
  requestPasswordResetAction,
  setUserPasswordAction,
  setUserRolesAction,
  setUserStatusAction,
  updateUserAction,
} from "./actions";
import {
  useUsersAdmin,
  type ManagedUser,
  type UsersAdminValue,
} from "./users-admin-context";

/**
 * The user administration dialogs. Each form lives inside its dialog's content,
 * so it mounts fresh — with the user's current values — every time it opens.
 */

type FieldErrors = Record<string, string[]>;
type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void };
type UserDialogProps = DialogProps & { user: ManagedUser };

const firstError = (errors: FieldErrors, key: string): string | null =>
  errors[key]?.[0] ?? null;

const USERNAME_HINT =
  "3 to 32 letters, numbers, dots, hyphens or underscores. Not case-sensitive.";

function FormAlert({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p
      role="alert"
      className="border-danger/25 bg-danger-subtle text-danger border px-3 py-2 text-xs"
    >
      {message}
    </p>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="border-warning/30 bg-warning-subtle text-warning border px-3 py-2 text-xs">
      {children}
    </p>
  );
}

const NOT_CONFIGURED_NOTICE =
  "Creating, re-addressing and deleting sign-in accounts needs SUPABASE_SECRET_KEY on " +
  "the server, which is not set. Ask the platform operator to add it.";

function unitOptions(units: UsersAdminValue["options"]["units"]): Option[] {
  return units.map((unit) => ({
    value: unit.id,
    label: `${"   ".repeat(unit.depth)}${unit.name}`,
  }));
}

const LANGUAGE_OPTIONS: Option[] = [
  { value: "en", label: "English" },
  { value: "ar", label: "العربية (Arabic)" },
];

/**
 * What ticking a role actually reveals in the sidebar, so an administrator is not
 * guessing from the role name (ADR-030). A role that unlocks no section — the
 * baseline Employee — says so rather than showing nothing.
 */
function RoleSections({ accessKeys }: { accessKeys: string[] }) {
  const sections = sectionLabelsForAccessKeys(accessKeys);
  return (
    <span className="text-foreground-muted block text-xs">
      {sections.length === 0
        ? "Messages only — no section"
        : `Shows: ${sections.join(", ")}`}
    </span>
  );
}

function RoleChecklist({
  selected,
  onChange,
  error,
  disabled,
}: {
  selected: string[];
  onChange: (roleIds: string[]) => void;
  error: string | null;
  disabled?: boolean;
}) {
  const { options } = useUsersAdmin();
  return (
    <fieldset className="flex min-w-0 flex-col gap-1" disabled={disabled}>
      <legend className="text-foreground-muted mb-1 text-xs">Roles</legend>
      <div
        className={
          "bg-surface-sunken flex max-h-60 flex-col gap-2 overflow-y-auto border px-3 py-2.5 " +
          (error !== null ? "border-danger" : "border-border-strong")
        }
      >
        {options.roles.length === 0 ? (
          <p className="text-foreground-subtle text-xs">No active roles exist.</p>
        ) : (
          options.roles.map((role) => (
            <Checkbox
              key={role.id}
              checked={selected.includes(role.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, role.id]
                    : selected.filter((id) => id !== role.id),
                )
              }
              label={
                <span className="min-w-0">
                  <span className="font-extrabold">{role.name}</span>{" "}
                  <span className="text-foreground-subtle text-xs">{role.key}</span>
                  <RoleSections accessKeys={role.accessKeys} />
                </span>
              }
            />
          ))
        )}
      </div>
      {error !== null && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/* Add user ----------------------------------------------------------------- */

export function CreateUserDialog({ open, onOpenChange }: DialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      variant="sheet"
      title="Add user"
      description="Creates the sign-in account and the TechVault user together."
    >
      <CreateUserForm onDone={() => onOpenChange(false)} />
    </Dialog>
  );
}

function CreateUserForm({ onDone }: { onDone: () => void }) {
  const { options, rights, accountAdminConfigured } = useUsersAdmin();
  const notify = useToast();
  const [isPending, startTransition] = useTransition();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [orgUnitId, setOrgUnitId] = useState("");
  const [status, setStatus] = useState("active");
  const [method, setMethod] = useState<"invite" | "password">("invite");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      // Without an email address the only way to set up the account is a password.
      const setupMethod = email.trim() === "" ? "password" : method;
      const result = await createUserAction({
        username,
        email,
        fullName,
        roleIds,
        orgUnitId: orgUnitId === "" ? null : orgUnitId,
        isActive: status === "active",
        setup:
          setupMethod === "invite"
            ? { method: setupMethod }
            : { method: setupMethod, password },
      });
      if (!result.ok) {
        setMessage(result.message);
        setErrors(result.fieldErrors ?? {});
        return;
      }
      setPassword("");
      notify(
        result.data.method === "invite"
          ? `Created ${result.data.username} and emailed an invitation to set a password.`
          : `Created ${result.data.username}. Share the temporary password through a secure channel.`,
      );
      onDone();
    });
  }

  const usernameError = firstError(errors, "username");
  const emailError = firstError(errors, "email");
  const nameError = firstError(errors, "fullName");
  const unitError = firstError(errors, "orgUnitId");
  const passwordError = firstError(errors, "setup.password");
  const hasEmail = email.trim() !== "";
  const effectiveMethod = hasEmail ? method : "password";

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {!accountAdminConfigured && <Notice>{NOT_CONFIGURED_NOTICE}</Notice>}
      <FormAlert message={message} />

      <Field
        label="Username"
        htmlFor="new-user-username"
        required
        error={usernameError}
        hint={USERNAME_HINT}
      >
        <Input
          id="new-user-username"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          dir="ltr"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          invalid={usernameError !== null}
          aria-describedby={describedBy(
            "new-user-username",
            usernameError,
            USERNAME_HINT,
          )}
          required
        />
      </Field>

      <Field
        label="Email address (optional)"
        htmlFor="new-user-email"
        error={emailError}
        hint="Leave blank if they have no email. They sign in with the username either way."
      >
        <Input
          id="new-user-email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          invalid={emailError !== null}
          aria-describedby={describedBy(
            "new-user-email",
            emailError,
            "Leave blank if they have no email. They sign in with the username either way.",
          )}
        />
      </Field>

      <Field label="Full name" htmlFor="new-user-name" required error={nameError}>
        <Input
          id="new-user-name"
          autoComplete="off"
          dir="auto"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          invalid={nameError !== null}
          aria-describedby={describedBy("new-user-name", nameError)}
          required
        />
      </Field>

      {rights.administer ? (
        <RoleChecklist
          selected={roleIds}
          onChange={setRoleIds}
          error={firstError(errors, "roleIds")}
        />
      ) : (
        <p className="text-foreground-subtle text-xs">
          Roles are granted by an administrator who may manage user roles.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Organisation unit" htmlFor="new-user-unit" error={unitError}>
          <Select
            id="new-user-unit"
            value={orgUnitId}
            onChange={(event) => setOrgUnitId(event.target.value)}
            placeholder="No unit"
            options={unitOptions(options.units)}
            invalid={unitError !== null}
          />
        </Field>
        <Field label="Status" htmlFor="new-user-status">
          <Select
            id="new-user-status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
          />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2.5">
        <legend className="text-foreground-muted mb-1 text-xs">
          How will they sign in?
        </legend>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="radio"
            name="setup-method"
            checked={effectiveMethod === "invite"}
            onChange={() => setMethod("invite")}
            disabled={!hasEmail}
            className="accent-primary mt-0.5 size-4 cursor-pointer disabled:cursor-not-allowed"
          />
          <span className={hasEmail ? undefined : "opacity-50"}>
            <span className="font-extrabold">Email an invitation</span>
            <span className="text-foreground-muted block text-xs">
              {hasEmail
                ? "They choose their own password from a link."
                : "Needs an email address."}
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="radio"
            name="setup-method"
            checked={effectiveMethod === "password"}
            onChange={() => setMethod("password")}
            className="accent-primary mt-0.5 size-4 cursor-pointer"
          />
          <span>
            <span className="font-extrabold">Set a temporary password</span>
            <span className="text-foreground-muted block text-xs">
              You give them the password, and they change it after signing in.
            </span>
          </span>
        </label>
      </fieldset>

      {effectiveMethod === "password" && (
        <Field
          label="Temporary password"
          htmlFor="new-user-password"
          required
          error={passwordError}
          hint="At least 12 characters. Sent to the sign-in service; TechVault never stores or shows it."
        >
          <Input
            id="new-user-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            invalid={passwordError !== null}
            aria-describedby={describedBy(
              "new-user-password",
              passwordError,
              "At least 12 characters. Sent to the sign-in service; TechVault never stores or shows it.",
            )}
            required
          />
        </Field>
      )}

      <DialogActions>
        <Button onClick={onDone} disabled={isPending}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          isPending={isPending}
          disabled={!accountAdminConfigured}
        >
          {isPending ? "Creating…" : "Create user"}
        </Button>
      </DialogActions>
    </form>
  );
}

/* Edit user ---------------------------------------------------------------- */

export function EditUserDialog({ user, open, onOpenChange }: UserDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      variant="sheet"
      title="Edit user"
      description={user.email}
    >
      <EditUserForm user={user} onDone={() => onOpenChange(false)} />
    </Dialog>
  );
}

function EditUserForm({ user, onDone }: { user: ManagedUser; onDone: () => void }) {
  const { options, rights, accountAdminConfigured } = useUsersAdmin();
  const notify = useToast();
  const [isPending, startTransition] = useTransition();
  const [fullName, setFullName] = useState(user.fullName ?? "");
  const [username, setUsername] = useState(user.username ?? "");
  const shownEmail = visibleEmail(user.email) ?? "";
  const [email, setEmail] = useState(shownEmail);
  const [locale, setLocale] = useState(user.locale);
  const [orgUnitId, setOrgUnitId] = useState(user.orgUnitId ?? "");
  const [status, setStatus] = useState(user.isActive ? "active" : "inactive");
  const [confirming, setConfirming] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);

  const canEditEmail = rights.administer && accountAdminConfigured;
  const statusChanged = (status === "active") !== user.isActive;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (statusChanged && !confirming) {
      setConfirming(true);
      return;
    }
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      const changes: Record<string, unknown> = {};
      if (fullName.trim() !== (user.fullName ?? "")) changes.fullName = fullName;
      if (
        username.trim().toLowerCase() !== (user.username ?? "") &&
        username.trim() !== ""
      ) {
        changes.username = username;
      }
      // Removing an address is not offered: blank keeps the current one.
      if (email.trim() !== "" && email.trim().toLowerCase() !== shownEmail) {
        changes.email = email;
      }
      if (locale !== user.locale) changes.locale = locale;
      if (orgUnitId !== (user.orgUnitId ?? "")) {
        changes.orgUnitId = orgUnitId === "" ? null : orgUnitId;
      }

      if (Object.keys(changes).length > 0) {
        const result = await updateUserAction(user.id, changes);
        if (!result.ok) {
          setMessage(result.message);
          setErrors(result.fieldErrors ?? {});
          setConfirming(false);
          return;
        }
      }
      if (statusChanged) {
        const result = await setUserStatusAction(user.id, status === "active");
        if (!result.ok) {
          setMessage(result.message);
          setConfirming(false);
          return;
        }
      }
      notify(
        `Saved changes to ${username.trim() || user.username || shownEmail || "the user"}.`,
      );
      onDone();
    });
  }

  const usernameError = firstError(errors, "username");
  const emailError = firstError(errors, "email");
  const nameError = firstError(errors, "fullName");
  const unitError = firstError(errors, "orgUnitId");
  const usernameHint = canEditEmail
    ? `What they type to sign in. ${USERNAME_HINT}`
    : "Only an administrator who manages user roles can change how someone signs in.";
  const emailHint = canEditEmail
    ? "Changes the address they sign in with."
    : rights.administer
      ? "Changing the sign-in address needs SUPABASE_SECRET_KEY on the server."
      : "Only an administrator who manages user roles can change the sign-in address.";

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormAlert message={message} />

      <Field label="Full name" htmlFor="edit-user-name" required error={nameError}>
        <Input
          id="edit-user-name"
          dir="auto"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          invalid={nameError !== null}
          aria-describedby={describedBy("edit-user-name", nameError)}
          required
        />
      </Field>

      <Field
        label="Username"
        htmlFor="edit-user-username"
        error={usernameError}
        hint={usernameHint}
      >
        <Input
          id="edit-user-username"
          autoCapitalize="none"
          spellCheck={false}
          dir="ltr"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          disabled={!canEditEmail}
          invalid={usernameError !== null}
          aria-describedby={describedBy(
            "edit-user-username",
            usernameError,
            usernameHint,
          )}
        />
      </Field>

      <Field
        label="Email address (optional)"
        htmlFor="edit-user-email"
        error={emailError}
        hint={emailHint}
      >
        <Input
          id="edit-user-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={!canEditEmail}
          invalid={emailError !== null}
          aria-describedby={describedBy("edit-user-email", emailError, emailHint)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Organisation unit" htmlFor="edit-user-unit" error={unitError}>
          <Select
            id="edit-user-unit"
            value={orgUnitId}
            onChange={(event) => setOrgUnitId(event.target.value)}
            placeholder="No unit"
            options={unitOptions(options.units)}
            invalid={unitError !== null}
          />
        </Field>
        <Field label="Language" htmlFor="edit-user-locale">
          <Select
            id="edit-user-locale"
            value={locale}
            onChange={(event) => setLocale(event.target.value)}
            options={LANGUAGE_OPTIONS}
          />
        </Field>
      </div>

      <Field label="Status" htmlFor="edit-user-status">
        <Select
          id="edit-user-status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setConfirming(false);
          }}
          options={[
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ]}
        />
      </Field>

      {confirming && (
        <Notice>
          {status === "inactive"
            ? `Deactivate ${user.email}? They lose access to TechVault on their next request and cannot sign in until reactivated. Their records and history are kept.`
            : `Reactivate ${user.email}? They will be able to sign in again with the roles they hold.`}
        </Notice>
      )}

      <DialogActions>
        <Button onClick={onDone} disabled={isPending}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant={confirming && status === "inactive" ? "danger" : "primary"}
          isPending={isPending}
        >
          {isPending ? "Saving…" : confirming ? "Confirm and save" : "Save changes"}
        </Button>
      </DialogActions>
    </form>
  );
}

/* Change role -------------------------------------------------------------- */

export function RolesDialog({ user, open, onOpenChange }: UserDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Change role"
      description={user.email}
    >
      <RolesForm user={user} onDone={() => onOpenChange(false)} />
    </Dialog>
  );
}

function RolesForm({ user, onDone }: { user: ManagedUser; onDone: () => void }) {
  const { currentUserId } = useUsersAdmin();
  const notify = useToast();
  const [isPending, startTransition] = useTransition();
  const [roleIds, setRoleIds] = useState(user.globalRoleIds);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      const result = await setUserRolesAction(user.id, { roleIds });
      if (!result.ok) {
        setMessage(result.message);
        setErrors(result.fieldErrors ?? {});
        return;
      }
      const { added, removed } = result.data;
      notify(
        added.length === 0 && removed.length === 0
          ? `No change to ${user.email}'s roles.`
          : `Updated ${user.email}'s roles` +
              (added.length > 0 ? ` — added ${added.join(", ")}` : "") +
              (removed.length > 0 ? ` — removed ${removed.join(", ")}` : "") +
              ".",
      );
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <FormAlert message={message} />
      {user.id === currentUserId && (
        <Notice>
          You are changing your own roles. TechVault will not let the last platform
          administrator lose that role.
        </Notice>
      )}
      <RoleChecklist
        selected={roleIds}
        onChange={setRoleIds}
        error={firstError(errors, "roleIds")}
        disabled={isPending}
      />
      <p className="text-foreground-subtle text-xs">
        Takes effect on their next request. Roles limited to an organisation unit are not
        changed here.
      </p>
      <DialogActions>
        <Button onClick={onDone} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" isPending={isPending}>
          {isPending ? "Saving…" : "Save roles"}
        </Button>
      </DialogActions>
    </form>
  );
}

/* Change organisation unit ------------------------------------------------- */

export function UnitDialog({ user, open, onOpenChange }: UserDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Change organisation unit"
      description={user.email}
    >
      <UnitForm user={user} onDone={() => onOpenChange(false)} />
    </Dialog>
  );
}

function UnitForm({ user, onDone }: { user: ManagedUser; onDone: () => void }) {
  const { options } = useUsersAdmin();
  const notify = useToast();
  const [isPending, startTransition] = useTransition();
  const [orgUnitId, setOrgUnitId] = useState(user.orgUnitId ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      const result = await updateUserAction(user.id, {
        orgUnitId: orgUnitId === "" ? null : orgUnitId,
      });
      if (!result.ok) {
        setMessage(result.message);
        setErrors(result.fieldErrors ?? {});
        return;
      }
      const unit = options.units.find((candidate) => candidate.id === orgUnitId);
      notify(`Moved ${user.email} to ${unit?.name ?? "no unit"}.`);
      onDone();
    });
  }

  const unitError = firstError(errors, "orgUnitId");

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <FormAlert message={message} />
      <Field
        label="Organisation unit"
        htmlFor="change-unit"
        error={unitError}
        hint="Unit-scoped access follows the new unit on their next request."
      >
        <Select
          id="change-unit"
          value={orgUnitId}
          onChange={(event) => setOrgUnitId(event.target.value)}
          placeholder="No unit"
          options={unitOptions(options.units)}
          invalid={unitError !== null}
          aria-describedby={describedBy(
            "change-unit",
            unitError,
            "Unit-scoped access follows the new unit on their next request.",
          )}
        />
      </Field>
      <DialogActions>
        <Button onClick={onDone} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" isPending={isPending}>
          {isPending ? "Saving…" : "Save unit"}
        </Button>
      </DialogActions>
    </form>
  );
}

/* Activate / deactivate ---------------------------------------------------- */

export function StatusDialog({ user, open, onOpenChange }: UserDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={user.isActive ? "Deactivate this user?" : "Reactivate this user?"}
      description={user.email}
    >
      <StatusForm user={user} onDone={() => onOpenChange(false)} />
    </Dialog>
  );
}

function StatusForm({ user, onDone }: { user: ManagedUser; onDone: () => void }) {
  const notify = useToast();
  const [isPending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const deactivating = user.isActive;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await setUserStatusAction(user.id, !deactivating, reason);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      notify(deactivating ? `Deactivated ${user.email}.` : `Reactivated ${user.email}.`);
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <FormAlert message={message} />
      <p className="text-foreground text-sm">
        {deactivating
          ? "They lose access to TechVault on their next request and cannot sign in until the account is reactivated. Their records, roles and history are kept."
          : "They will be able to sign in and use TechVault again with the roles they hold."}
      </p>
      <Field label="Reason (recorded in the audit trail)" htmlFor="status-reason">
        <Textarea
          id="status-reason"
          value={reason}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <DialogActions>
        <Button onClick={onDone} disabled={isPending}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant={deactivating ? "danger" : "primary"}
          isPending={isPending}
        >
          {isPending ? "Saving…" : deactivating ? "Deactivate user" : "Reactivate user"}
        </Button>
      </DialogActions>
    </form>
  );
}

/* Reset password ----------------------------------------------------------- */

export function ResetPasswordDialog({ user, open, onOpenChange }: UserDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Reset password?"
      description={user.email}
    >
      <ResetPasswordForm user={user} onDone={() => onOpenChange(false)} />
    </Dialog>
  );
}

function ResetPasswordForm({ user, onDone }: { user: ManagedUser; onDone: () => void }) {
  const notify = useToast();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await requestPasswordResetAction(user.id);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      notify(`Password reset email sent to ${result.data.email}.`);
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <FormAlert message={message} />
      <p className="text-foreground text-sm">
        We will email {user.email} a link to choose a new password. You never see or set
        the password, and their current one keeps working until they change it.
      </p>
      <DialogActions>
        <Button onClick={onDone} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" isPending={isPending}>
          {isPending ? "Sending…" : "Send reset email"}
        </Button>
      </DialogActions>
    </form>
  );
}

/* Temporary password -------------------------------------------------------- */

export function SetPasswordDialog({ user, open, onOpenChange }: UserDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Set a temporary password?"
      description={user.username ?? user.email}
    >
      <SetPasswordForm user={user} onDone={() => onOpenChange(false)} />
    </Dialog>
  );
}

function SetPasswordForm({ user, onDone }: { user: ManagedUser; onDone: () => void }) {
  const notify = useToast();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setErrors({});
    startTransition(async () => {
      const result = await setUserPasswordAction(user.id, { password, confirmPassword });
      if (!result.ok) {
        setMessage(result.message);
        setErrors(result.fieldErrors ?? {});
        return;
      }
      setPassword("");
      setConfirmPassword("");
      notify(
        `Temporary password set for ${user.username ?? result.data.email}. Share it through a secure channel.`,
      );
      onDone();
    });
  }

  const passwordError = firstError(errors, "password");
  const confirmError = firstError(errors, "confirmPassword");

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <FormAlert message={message} />
      <p className="text-foreground text-sm">
        Their current password stops working. Until they sign in with this one and choose
        their own, they cannot use TechVault — so you never know the password they end up
        with. Every change is audited; the password itself never is.
      </p>
      <Field
        label="Temporary password"
        htmlFor="temporary-password"
        hint="At least 12 characters."
        error={passwordError}
        required
      >
        <Input
          id="temporary-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          invalid={passwordError !== null}
          aria-describedby={describedBy(
            "temporary-password",
            passwordError,
            "At least 12 characters.",
          )}
          required
        />
      </Field>
      <Field
        label="Confirm temporary password"
        htmlFor="temporary-password-confirm"
        error={confirmError}
        required
      >
        <Input
          id="temporary-password-confirm"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          invalid={confirmError !== null}
          aria-describedby={describedBy("temporary-password-confirm", confirmError)}
          required
        />
      </Field>
      <DialogActions>
        <Button onClick={onDone} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" isPending={isPending}>
          {isPending ? "Setting…" : "Set temporary password"}
        </Button>
      </DialogActions>
    </form>
  );
}

/* Delete user -------------------------------------------------------------- */

export function DeleteUserDialog({
  user,
  open,
  onOpenChange,
  onDeleted,
}: UserDialogProps & { onDeleted?: () => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete this user permanently?"
      description="This action may remove the user's application access and related account data."
    >
      <DeleteUserForm
        user={user}
        onDone={() => onOpenChange(false)}
        onDeleted={onDeleted}
      />
    </Dialog>
  );
}

function DeleteUserForm({
  user,
  onDone,
  onDeleted,
}: {
  user: ManagedUser;
  onDone: () => void;
  onDeleted?: () => void;
}) {
  const { accountAdminConfigured } = useUsersAdmin();
  const notify = useToast();
  const [isPending, startTransition] = useTransition();
  const [confirmEmail, setConfirmEmail] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  // Type what they sign in with: the username, or the email of an older account.
  const confirmPhrase = (user.username ?? user.email).toLowerCase();
  const matches = confirmEmail.trim().toLowerCase() === confirmPhrase;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!matches) return;
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      const result = await deleteUserAction(user.id, { confirmEmail });
      if (!result.ok) {
        setMessage(result.message);
        setErrors(result.fieldErrors ?? {});
        return;
      }
      notify(
        result.data.signInRemoved
          ? `Deleted ${result.data.email}.`
          : `Deleted ${result.data.email} in TechVault. Their sign-in account could not be removed automatically; they still cannot use TechVault.`,
        result.data.signInRemoved ? "success" : "error",
      );
      onDone();
      onDeleted?.();
    });
  }

  const confirmError = firstError(errors, "confirmEmail");

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <FormAlert message={message} />
      <ul className="text-foreground flex list-disc flex-col gap-1 ps-5 text-sm">
        <li>{user.username ?? user.email} can no longer sign in or use TechVault.</li>
        <li>Their role assignments and group memberships are removed.</li>
        <li>
          {accountAdminConfigured
            ? "Their sign-in account is deleted."
            : "Their sign-in account stays in Supabase (no secret key is configured), but TechVault refuses it."}
        </li>
        <li>
          Their audit history, sign-in history and the records they own are kept, and the
          username and email address cannot be reused.
        </li>
      </ul>
      <Field
        label={`Type ${confirmPhrase} to confirm`}
        htmlFor="delete-confirm"
        required
        error={confirmError}
      >
        <Input
          id="delete-confirm"
          autoComplete="off"
          value={confirmEmail}
          onChange={(event) => setConfirmEmail(event.target.value)}
          invalid={confirmError !== null}
          aria-describedby={describedBy("delete-confirm", confirmError)}
        />
      </Field>
      <DialogActions>
        <Button onClick={onDone} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="danger" isPending={isPending} disabled={!matches}>
          {isPending ? "Deleting…" : "Delete user"}
        </Button>
      </DialogActions>
    </form>
  );
}
