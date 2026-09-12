import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="bg-canvas flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-foreground text-xl font-semibold tracking-tight">
            TechVault
          </h1>
          <p className="text-foreground-muted mt-1 text-sm">
            Sign in to continue to the platform.
          </p>
        </div>

        <div className="border-border bg-surface rounded-(--radius-panel) border p-5">
          <LoginForm next={next} />
        </div>

        <p className="text-foreground-subtle mt-4 text-center text-xs">
          Accounts are created by an administrator. Contact your system administrator if
          you cannot sign in.
        </p>
      </div>
    </main>
  );
}
