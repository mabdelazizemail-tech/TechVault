"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/primitives";
import { changeOwnPasswordAction } from "./actions";

const MIN_LENGTH = 12;

/**
 * Changes the signed-in person's own password (ADR-034). On success the server ends
 * every session of the account and redirects to sign-in, so only failures come back.
 */
export function ChangePasswordForm({
  signInName,
  temporary,
}: {
  /** What the person signs in with, for password managers. */
  signInName: string;
  /** Holding a temporary password set by an administrator. */
  temporary: boolean;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [isPending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setErrors({});
    startTransition(async () => {
      const result = await changeOwnPasswordAction({
        currentPassword,
        newPassword,
        confirmPassword,
      });
      setMessage(result.message);
      setErrors(result.fieldErrors ?? {});
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      {message !== null && (
        <p
          role="alert"
          className="border-danger/25 bg-danger-subtle text-danger border px-3 py-2 text-xs"
        >
          {message}
        </p>
      )}
      {/* Lets a password manager file the new password under the right account. */}
      <input
        type="text"
        name="username"
        autoComplete="username"
        value={signInName}
        readOnly
        hidden
      />
      <TextInput
        label={temporary ? "Temporary password" : "Current password"}
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        error={errors.currentPassword?.[0]}
        required
        autoFocus={temporary}
      />
      <TextInput
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        hint={`At least ${MIN_LENGTH} characters.`}
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        error={errors.newPassword?.[0]}
        required
      />
      <TextInput
        label="Confirm new password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        error={errors.confirmPassword?.[0]}
        required
      />
      <p className="text-foreground-muted text-xs">
        You will be signed out everywhere, then sign in again with your new password.
      </p>
      <div>
        <Button type="submit" variant="primary" isPending={isPending}>
          {isPending ? "Changing…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}
