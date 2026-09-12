"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/primitives";
import { signIn, type SignInResult } from "@/app/auth/actions";

/**
 * The sign-in form.
 *
 * Uses `useActionState` so the pending and error states come from the Server
 * Action itself rather than hand-managed state. Credentials are posted to the
 * server and never held in client state (CLAUDE.md §16.5).
 */
export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, isPending] = useActionState<SignInResult, FormData>(
    async (_previous, formData) => signIn(formData),
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {next !== undefined && <input type="hidden" name="next" value={next} />}

      <TextInput
        label="Email address"
        name="email"
        type="email"
        autoComplete="username"
        autoFocus
        required
      />

      <TextInput
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />

      {state?.error !== undefined && (
        // role="alert" so the failure is announced, not only shown (§17.5).
        <p
          role="alert"
          className="border-danger/25 bg-danger-subtle text-danger rounded-(--radius-control) border px-3 py-2 text-xs"
        >
          {state.error}
        </p>
      )}

      <Button type="submit" variant="primary" isPending={isPending} className="w-full">
        {isPending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
