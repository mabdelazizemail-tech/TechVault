import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import { requireUserForPasswordChange } from "@/platform/auth/current-user";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

/**
 * Where an account holding a temporary password is held until it chooses its own
 * (ADR-034). Every other page and action refuses it meanwhile. Outside the platform
 * shell on purpose: nothing but this form is available yet.
 */
export default async function ChangePasswordPage() {
  const user = await requireUserForPasswordChange();
  // Nothing to do here without a temporary password: My account has the form.
  if (!user.mustChangePassword) redirect("/account");

  return (
    <main className="bg-canvas grid min-h-dvh place-items-center px-6 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex items-center gap-3">
          <span className="bg-brand text-brand-foreground grid size-[30px] place-items-center text-sm font-bold">
            TV
          </span>
          <span className="text-foreground text-lg font-extrabold tracking-[-0.01em]">
            TechVault
          </span>
        </div>
        <p className="text-foreground-muted mb-2 text-[11px] tracking-[0.1em] uppercase">
          Your account
        </p>
        <h1 className="text-foreground mb-1.5 text-[30px]">Choose a new password</h1>
        <p className="text-foreground-muted mb-5 text-[13px]">
          An administrator gave{" "}
          <span className="text-foreground">{user.username ?? user.email}</span> a
          temporary password. Replace it with one only you know before continuing.
        </p>
        <ChangePasswordForm signInName={user.username ?? user.email} temporary />
        <form action={signOut} className="mt-6">
          <button
            type="submit"
            className="text-foreground-muted hover:text-foreground cursor-pointer text-sm font-bold underline-offset-2 hover:underline"
          >
            Not now — sign out
          </button>
        </form>
      </div>
    </main>
  );
}
