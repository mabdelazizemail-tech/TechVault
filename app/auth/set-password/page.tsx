import type { Metadata } from "next";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Set your password" };

/**
 * Where emailed invitation and password-reset links land (ADR-019).
 *
 * Public: the visitor has no cookie session yet — the link carries a short-lived
 * one. This URL must be in Supabase's redirect allow list.
 */
export default function SetPasswordPage() {
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
        <h1 className="text-foreground mb-1.5 text-[30px]">Set your password</h1>
        <SetPasswordForm />
      </div>
    </main>
  );
}
