import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Sign-in, laid out as in the TechVault design: a statement panel in the accent on
 * the left, the form on the right.
 *
 * The design's figures (module count, user count, certification) and its SSO,
 * "keep me signed in" and password-reset controls are omitted on purpose: none of
 * them is true or wired up yet, and invented numbers or inert controls on a sign-in
 * page would mislead (CLAUDE.md §17.6).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const { next, reason } = await searchParams;

  return (
    <main className="bg-canvas grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <section
        aria-hidden="true"
        className="bg-primary text-primary-foreground hidden min-w-0 flex-col justify-between p-12 lg:flex"
      >
        <div className="flex items-center gap-3">
          <span className="bg-brand text-brand-foreground grid size-[30px] place-items-center text-sm font-bold">
            TV
          </span>
          <span className="text-lg font-extrabold tracking-[-0.01em]">TechVault</span>
        </div>

        <div>
          <p className="mb-5 text-[11px] tracking-[0.14em] uppercase opacity-75">
            Enterprise operating platform
          </p>
          <p className="mb-5 max-w-[14ch] text-[clamp(38px,5.2vw,66px)] leading-[0.98] font-extrabold tracking-[-0.015em]">
            One ecosystem. Every business process.
          </p>
          <div className="bg-primary-foreground h-0.5 opacity-40" />
        </div>

        <p className="text-[11px] opacity-70">
          Internal platform · access is provisioned by an administrator
        </p>
      </section>

      <section className="flex min-w-0 flex-col justify-center overflow-auto px-6 py-12 sm:px-12">
        <div className="w-full max-w-[360px]">
          <p className="text-foreground-muted mb-2 text-[11px] tracking-[0.1em] uppercase">
            Sign in
          </p>
          <h1 className="text-foreground mb-1.5 text-[30px]">TechVault</h1>
          <p className="text-foreground-muted mb-5 text-[13px]">
            Sign in to continue to the platform.
          </p>

          <LoginForm next={next} notice={noticeFor(reason)} />

          <div className="bg-border-strong my-4 h-0.5" />

          <p className="text-foreground-muted flex items-start gap-2 text-xs">
            <ShieldCheck
              aria-hidden="true"
              size={15}
              strokeWidth={2}
              className="mt-px shrink-0"
            />
            <span>
              Accounts are created by an administrator. Every sign-in attempt is recorded,
              and access is re-checked on every request.
            </span>
          </p>
        </div>
      </section>
    </main>
  );
}

/** Explains why the visitor arrived here. Only fixed messages — never text from the URL. */
function noticeFor(reason: string | undefined): string | undefined {
  switch (reason) {
    case "disabled":
      return "Your account is not active. Contact your administrator if you think this is a mistake.";
    case "password-set":
      return "Your password is set. Sign in with it now.";
    case "password-changed":
      return "Your password is changed and you were signed out everywhere. Sign in with your new password.";
    default:
      return undefined;
  }
}
