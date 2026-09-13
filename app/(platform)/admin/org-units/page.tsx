import type { Metadata } from "next";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { getActor } from "@/platform/auth/current-user";
import { listOrgUnits } from "@/platform/iam/services/catalogue-service";

export const metadata: Metadata = { title: "Organisation units" };

/**
 * The organisation tree.
 *
 * This structure is the basis for scope-based authorization across the whole
 * platform (ORG_UNIT and OWN_ORG_UNIT scopes resolve against it), so it is worth
 * keeping clean. Rendered as an indented list rather than a collapsible tree: at
 * this depth, seeing the whole structure at once is more useful than clicking
 * through it.
 */
export default async function OrgUnitsPage() {
  const actor = await getActor();
  const units = await listOrgUnits(actor);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Organisation units"
        description="The organisational tree. Role assignments can be narrowed to a unit, which grants access to that unit and everything beneath it."
      />

      <Panel className="overflow-hidden">
        {units.length === 0 ? (
          <EmptyState
            title="No organisational units"
            description="Run the database seed to create the root unit, then add the structure beneath it."
          />
        ) : (
          <ul className="divide-border divide-y text-sm">
            {units.map((unit) => (
              <li
                key={unit.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
                // Indent by depth so the hierarchy is visible without a tree widget.
                style={{ paddingInlineStart: `${1 + unit.depth * 1.25}rem` }}
              >
                <span className="min-w-0">
                  <span className="text-foreground font-medium">{unit.name}</span>
                  <code className="text-foreground-subtle ms-2 font-mono text-xs">
                    {unit.key}
                  </code>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-foreground-muted text-xs">
                    {unit.userCount} {unit.userCount === 1 ? "user" : "users"}
                  </span>
                  {!unit.isActive && <Badge tone="danger">Inactive</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
