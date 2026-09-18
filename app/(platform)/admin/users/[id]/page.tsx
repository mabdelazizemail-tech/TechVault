import type { Metadata } from "next";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Badge, PageHeader, Panel } from "@/components/ui/primitives";
import { NotFoundError } from "@/lib/errors";
import { getActor } from "@/platform/auth/current-user";
import { isAccountAdminConfigured } from "@/platform/auth/identity-admin";
import { canAll } from "@/platform/authz/authz";
import { IAM_PERMISSIONS } from "@/platform/iam/permissions";
import {
  getUserDetail,
  listUserAdminOptions,
  type UserDetail,
} from "@/platform/iam/services/user-admin-service";
import { UserDialogsHost, UserRowActions } from "../user-row-actions";
import { UsersAdminProvider } from "../users-admin-context";
import { visibleEmail } from "@/platform/iam/usernames";

export const metadata: Metadata = { title: "User details" };

const LANGUAGES: Record<string, string> = { en: "English", ar: "Arabic" };

/**
 * One user: profile, roles, effective permissions and recent activity.
 * Credentials never reach this page — the service returns none (ADR-019).
 */
export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();

  const [user, options, rights] = await Promise.all([
    orNotFound(getUserDetail(actor, id)),
    listUserAdminOptions(actor),
    canAll(actor, [
      IAM_PERMISSIONS.USER_CREATE,
      IAM_PERMISSIONS.USER_UPDATE,
      IAM_PERMISSIONS.USER_ADMINISTER,
      IAM_PERMISSIONS.USER_DELETE,
    ]),
  ]);

  const permissionsByModule = groupByModule(user.permissions);

  return (
    <UsersAdminProvider
      value={{
        currentUserId: actor.id,
        accountAdminConfigured: isAccountAdminConfigured(),
        rights: {
          create: rights[IAM_PERMISSIONS.USER_CREATE] === true,
          update: rights[IAM_PERMISSIONS.USER_UPDATE] === true,
          administer: rights[IAM_PERMISSIONS.USER_ADMINISTER] === true,
          delete: rights[IAM_PERMISSIONS.USER_DELETE] === true,
        },
        options,
      }}
    >
      <div className="max-w-6xl">
        <BreadcrumbTitle
          segment={id}
          label={user.fullName ?? user.username ?? user.email}
        />
        <PageHeader
          title={user.fullName ?? user.username ?? user.email}
          description={user.username ?? visibleEmail(user.email) ?? undefined}
          actions={
            <>
              {user.isActive ? (
                <Badge tone="success">Active</Badge>
              ) : (
                <Badge tone="danger">Inactive</Badge>
              )}
              <UserRowActions
                placement="detail"
                user={{
                  id: user.id,
                  email: user.email,
                  username: user.username,
                  fullName: user.fullName,
                  locale: user.locale,
                  isActive: user.isActive,
                  orgUnitId: user.orgUnit?.id ?? null,
                  globalRoleIds: user.roles
                    .filter((role) => role.scopeType === "GLOBAL")
                    .map((role) => role.roleId),
                }}
              />
            </>
          }
        />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <Section title="Profile">
              <dl className="divide-border divide-y">
                <Row label="Name">{user.fullName ?? <Muted>Not set</Muted>}</Row>
                <Row label="Username">
                  {user.username ?? <Muted>Not set — signs in with email</Muted>}
                </Row>
                <Row label="Email">{visibleEmail(user.email) ?? <Muted>None</Muted>}</Row>
                <Row label="Status">{user.isActive ? "Active" : "Inactive"}</Row>
                <Row label="Organisation unit">
                  {user.orgUnit?.name ?? <Muted>Unassigned</Muted>}
                </Row>
                <Row label="Language">{LANGUAGES[user.locale] ?? user.locale}</Row>
                <Row label="Created">
                  {formatDate(user.createdAt)}
                  {user.createdBy !== null && <Muted> by {user.createdBy}</Muted>}
                </Row>
                <Row label="Last updated">
                  {formatDate(user.updatedAt)}
                  {user.updatedBy !== null && <Muted> by {user.updatedBy}</Muted>}
                </Row>
                <Row label="Last sign-in">
                  {user.lastLoginAt === null ? (
                    <Muted>Never</Muted>
                  ) : (
                    formatDate(user.lastLoginAt)
                  )}
                </Row>
              </dl>
            </Section>

            <Section title={`Roles (${user.roles.length})`}>
              {user.roles.length === 0 ? (
                <p className="text-foreground-muted px-4 py-3 text-sm">
                  No roles. This person can sign in but do nothing.
                </p>
              ) : (
                <ul className="divide-border divide-y">
                  {user.roles.map((role) => (
                    <li
                      key={role.assignmentId}
                      className="flex items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-foreground text-sm font-extrabold">
                          {role.name}
                        </p>
                        <p className="text-foreground-subtle text-xs">{role.key}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge>{role.scopeLabel}</Badge>
                        {role.endsAt !== null && (
                          <span className="text-foreground-subtle text-[11px]">
                            until {formatDate(role.endsAt)}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {user.recentSignIns !== null && (
              <Section title="Recent sign-ins">
                {user.recentSignIns.length === 0 ? (
                  <p className="text-foreground-muted px-4 py-3 text-sm">
                    No sign-ins recorded.
                  </p>
                ) : (
                  <ul className="divide-border divide-y">
                    {user.recentSignIns.map((signIn) => (
                      <li
                        key={signIn.occurredAt.toISOString()}
                        className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                      >
                        <span>{formatDate(signIn.occurredAt)}</span>
                        <span className="flex items-center gap-2">
                          {signIn.ipAddress !== null && (
                            <span className="text-foreground-subtle text-xs">
                              {signIn.ipAddress}
                            </span>
                          )}
                          <Badge tone={signIn.success ? "success" : "danger"}>
                            {signIn.success ? "Succeeded" : "Failed"}
                          </Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <Section title={`Effective permissions (${user.permissions.length})`}>
              {!user.isActive && (
                <p className="border-warning/30 bg-warning-subtle text-warning border-b px-4 py-2 text-xs">
                  This account is inactive, so none of these permissions currently
                  applies.
                </p>
              )}
              {user.permissions.length === 0 ? (
                <p className="text-foreground-muted px-4 py-3 text-sm">No permissions.</p>
              ) : (
                <div className="flex flex-col gap-3 px-4 py-3">
                  {permissionsByModule.map(([module, permissions]) => (
                    <div key={module}>
                      <p className="text-foreground-muted mb-1.5 text-[11px] tracking-[0.08em] uppercase">
                        {module}
                      </p>
                      <ul className="flex flex-wrap gap-1">
                        {permissions.map((permission) => (
                          <li key={permission.key}>
                            <span title={`From: ${permission.sources.join(", ")}`}>
                              <Badge>{permission.key}</Badge>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
              {user.deniedPermissions.length > 0 && (
                <div className="border-border border-t px-4 py-3">
                  <p className="text-foreground-muted mb-1.5 text-[11px] tracking-[0.08em] uppercase">
                    Explicitly denied
                  </p>
                  <ul className="flex flex-wrap gap-1">
                    {user.deniedPermissions.map((key) => (
                      <li key={key}>
                        <Badge tone="danger">{key}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>

            {user.recentActivity !== null && (
              <Section title="Recent activity">
                {user.recentActivity.length === 0 ? (
                  <p className="text-foreground-muted px-4 py-3 text-sm">
                    No administrative changes recorded for this user.
                  </p>
                ) : (
                  <ol className="divide-border divide-y">
                    {user.recentActivity.map((entry) => (
                      <li key={entry.id} className="px-4 py-2.5">
                        <p className="text-foreground text-sm">{entry.summary}</p>
                        <p className="text-foreground-subtle text-xs">
                          {formatDate(entry.occurredAt)} · {entry.actor} · {entry.action}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </Section>
            )}
          </div>
        </div>
      </div>
      <UserDialogsHost />
    </UsersAdminProvider>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel className="overflow-hidden">
      <h2 className="border-border-strong text-foreground border-b-2 px-4 py-2.5 text-sm font-extrabold">
        {title}
      </h2>
      {children}
    </Panel>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 px-4 py-2 text-sm">
      <dt className="text-foreground-muted">{label}</dt>
      <dd className="text-foreground min-w-0 break-words" dir="auto">
        {children}
      </dd>
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-foreground-subtle">{children}</span>;
}

function groupByModule(
  permissions: UserDetail["permissions"],
): [string, UserDetail["permissions"]][] {
  const groups = new Map<string, UserDetail["permissions"]>();
  for (const permission of permissions) {
    const moduleKey = permission.key.split(".")[0] ?? "other";
    groups.set(moduleKey, [...(groups.get(moduleKey) ?? []), permission]);
  }
  return [...groups.entries()];
}

async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}
