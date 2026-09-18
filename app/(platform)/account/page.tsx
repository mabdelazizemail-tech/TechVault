import type { Metadata } from "next";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { ChangePasswordForm } from "@/app/auth/change-password/change-password-form";
import { requireUser } from "@/platform/auth/current-user";
import { visibleEmail } from "@/platform/iam/usernames";

export const metadata: Metadata = { title: "My account" };

/** The signed-in person's own account: who they are signed in as, and their password. */
export default async function AccountPage() {
  const user = await requireUser();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="My account"
        description={[user.username, visibleEmail(user.email)]
          .filter(Boolean)
          .join(" · ")}
      />
      <Panel className="max-w-xl">
        <PanelHeader
          title="Change password"
          description="Confirm your current password, then choose a new one."
        />
        <div className="p-4">
          <ChangePasswordForm
            signInName={user.username ?? user.email}
            temporary={false}
          />
        </div>
      </Panel>
    </div>
  );
}
