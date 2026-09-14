"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/primitives";
import { createLinkSessionClient } from "@/platform/auth/supabase/client";

type Stage = "checking" | "ready" | "invalid" | "done";

const MIN_LENGTH = 12;

/**
 * Chooses a password from an invitation or reset link. The link's session lives
 * in memory only, the tokens are removed from the address bar once read, and the
 * session is ended as soon as the password is saved — the person then signs in
 * normally, which is where TechVault checks the account is active.
 */
export function SetPasswordForm() {
  const [client] = useState(createLinkSessionClient);
  const [stage, setStage] = useState<Stage>("checking");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const linkFailed = fragment.has("error") || fragment.has("error_description");

    void client.auth.getSession().then(({ data }) => {
      window.history.replaceState(null, "", window.location.pathname);
      if (data.session === null) {
        setError(
          linkFailed
            ? "This link has expired or has already been used. Ask your administrator to send a new one."
            : "Open this page from the link in your invitation or password reset email.",
        );
        setStage("invalid");
        return;
      }
      setStage("ready");
    });
  }, [client]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirmation) {
      setError("The two passwords do not match.");
      return;
    }

    setIsSaving(true);
    const { error: updateError } = await client.auth.updateUser({ password });
    if (updateError !== null) {
      setIsSaving(false);
      setError(
        updateError.code === "weak_password"
          ? "That password is too weak. Choose a longer one that is harder to guess."
          : updateError.code === "same_password"
            ? "Choose a password you have not used for this account before."
            : "Your password could not be saved. The link may have expired — ask for a new one.",
      );
      return;
    }

    await client.auth.signOut({ scope: "local" });
    setPassword("");
    setConfirmation("");
    setIsSaving(false);
    setStage("done");
  }

  if (stage === "checking") {
    return (
      <p role="status" className="text-foreground-muted text-[13px]">
        Checking your link…
      </p>
    );
  }

  if (stage === "invalid") {
    return (
      <div className="flex flex-col gap-3">
        <p
          role="alert"
          className="border-danger/25 bg-danger-subtle text-danger border px-3 py-2 text-xs"
        >
          {error}
        </p>
        <Link
          href="/login"
          className="text-primary-ink text-sm font-extrabold hover:underline"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  if (stage === "done") {
    return (
      <div className="flex flex-col gap-3">
        <p role="status" className="text-foreground text-[13px]">
          Your password is set.
        </p>
        <Link
          href="/login?reason=password-set"
          className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex min-h-9 items-center justify-center px-3.5 text-sm font-extrabold"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-foreground-muted mb-2 text-[13px]">
        Choose a password of at least {MIN_LENGTH} characters.
      </p>
      <TextInput
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
        autoFocus
      />
      <TextInput
        label="Confirm password"
        name="confirmation"
        type="password"
        autoComplete="new-password"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        required
      />
      {error !== null && (
        <p
          role="alert"
          className="border-danger/25 bg-danger-subtle text-danger border px-3 py-2 text-xs"
        >
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" isPending={isSaving} className="w-full">
        {isSaving ? "Saving…" : "Set password"}
      </Button>
    </form>
  );
}
