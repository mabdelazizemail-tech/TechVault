import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form-controls";
import type { UserAdminOptions } from "@/platform/iam/services/user-admin-service";

export type UserFilterValues = {
  q: string;
  status: "all" | "active" | "inactive";
  roleId: string;
  orgUnitId: string;
  sort: string;
  dir: string;
};

/**
 * Search and filters as a plain GET form: the filters live in the URL, so a
 * filtered list is shareable and the back button works (CLAUDE.md §16.4), and it
 * works without JavaScript. Changing a filter returns to the first page.
 */
export function UserFilters({
  values,
  options,
}: {
  values: UserFilterValues;
  options: UserAdminOptions;
}) {
  const activeCount =
    [values.q, values.roleId, values.orgUnitId].filter((value) => value !== "").length +
    (values.status !== "all" ? 1 : 0);

  return (
    // Keyed by the applied values: uncontrolled fields only read `defaultValue` on
    // mount, so "Clear filters" must remount the form or the old values linger.
    <form
      key={JSON.stringify(values)}
      method="get"
      action="/admin/users"
      role="search"
      className="border-border-strong flex flex-wrap items-end gap-2 border-b-2 px-3 py-3"
    >
      <input type="hidden" name="sort" value={values.sort} />
      <input type="hidden" name="dir" value={values.dir} />

      <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs sm:max-w-72">
        <span className="text-foreground-muted">Search</span>
        <Input
          type="search"
          name="q"
          defaultValue={values.q}
          placeholder="Name or email"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-foreground-muted">Status</span>
        <Select
          name="status"
          defaultValue={values.status}
          className="w-auto"
          options={[
            { value: "all", label: "All statuses" },
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ]}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-foreground-muted">Role</span>
        <Select
          name="roleId"
          defaultValue={values.roleId}
          className="w-auto max-w-56"
          placeholder="All roles"
          options={options.roles.map((role) => ({ value: role.id, label: role.name }))}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-foreground-muted">Organisation unit</span>
        <Select
          name="orgUnitId"
          defaultValue={values.orgUnitId}
          className="w-auto max-w-56"
          placeholder="All units"
          options={options.units.map((unit) => ({
            value: unit.id,
            label: `${"   ".repeat(unit.depth)}${unit.name}`,
          }))}
        />
      </label>

      <Button type="submit">Apply</Button>
      {activeCount > 0 && (
        <Link
          href="/admin/users"
          className="text-primary-ink self-center text-sm font-extrabold hover:underline"
        >
          Clear {activeCount === 1 ? "filter" : "filters"}
        </Link>
      )}
    </form>
  );
}
