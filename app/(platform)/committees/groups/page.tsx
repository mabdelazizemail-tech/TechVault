import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { Badge, PageHeader, Panel } from "@/components/ui/primitives";
import {
  canAdministerCommittees,
  listCommittees,
} from "@/modules/committees/contracts/service";
import type { CommitteeListItem } from "@/modules/committees/contracts/types";
import { formatDateTime } from "@/modules/committees/domain/format";
import { NewCommitteeButton } from "@/modules/committees/ui/committee-form";
import { flatParams } from "@/modules/committees/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";

export const metadata: Metadata = { title: "Committee list" };

const BASE = "/committees/groups";

const columns: Column<CommitteeListItem>[] = [
  {
    key: "name",
    header: "Committee",
    cell: (committee) => <span dir="auto">{committee.name}</span>,
  },
  {
    key: "purpose",
    header: "Purpose",
    hideOnMobile: true,
    cell: (committee) =>
      committee.description === null ? (
        <span className="text-foreground-muted">—</span>
      ) : (
        <span dir="auto" className="line-clamp-2 max-w-md">
          {committee.description}
        </span>
      ),
  },
  {
    key: "members",
    header: "Members",
    align: "end",
    cell: (committee) => (
      <span className="inline-flex items-center gap-2">
        {committee.isMember && <Badge tone="info">You</Badge>}
        {committee.memberCount}
      </span>
    ),
  },
  {
    key: "next",
    header: "Next meeting",
    cell: (committee) =>
      committee.nextMeetingAt === null ? (
        <span className="text-foreground-muted">None scheduled</span>
      ) : (
        <span className="whitespace-nowrap">
          {formatDateTime(committee.nextMeetingAt)}
        </span>
      ),
  },
];

/** The committees you sit on — every committee, for committee administrators. */
export default async function CommitteeListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const show = params.show === "archived" ? "archived" : "active";
  const [page, isAdmin] = await Promise.all([
    listCommittees(actor, { ...params, show }),
    canAdministerCommittees(actor),
  ]);

  return (
    <div>
      <PageHeader
        title="Committee list"
        description={
          isAdmin
            ? "Every committee. As a committee administrator you choose who sits on each."
            : "The committees you are a member of."
        }
        actions={isAdmin ? <NewCommitteeButton /> : undefined}
      />

      <nav aria-label="Show" className="mb-3 flex gap-2">
        <ButtonLink
          href={BASE}
          size="sm"
          variant={show === "active" ? "primary" : "secondary"}
          aria-current={show === "active" ? "page" : undefined}
        >
          Active
        </ButtonLink>
        <ButtonLink
          href={`${BASE}?show=archived`}
          size="sm"
          variant={show === "archived" ? "primary" : "secondary"}
          aria-current={show === "archived" ? "page" : undefined}
        >
          Archived
        </ButtonLink>
      </nav>

      <FilterBar
        basePath={BASE}
        query={params.q}
        searchLabel="Search committees"
        preserve={{ show: show === "archived" ? "archived" : undefined }}
      />

      <Panel>
        <DataTable
          columns={columns}
          rows={page.rows}
          rowKey={(committee) => committee.id}
          rowHref={(committee) => `${BASE}/${committee.id}`}
          basePath={BASE}
          searchParams={{
            show: show === "archived" ? "archived" : undefined,
            q: params.q,
          }}
          page={{ page: page.page, pageSize: page.pageSize, total: page.total }}
          emptyTitle={show === "active" ? "No committees yet" : "No archived committees"}
          emptyDescription={
            isAdmin
              ? "Create a committee and choose its members; they can then schedule meetings and keep a Team To-Do List for each."
              : "You are not on any committee yet. A committee administrator adds members."
          }
          emptyAction={isAdmin && show === "active" ? <NewCommitteeButton /> : undefined}
        />
      </Panel>
    </div>
  );
}
