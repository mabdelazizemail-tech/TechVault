import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader, Panel } from "@/components/ui/primitives";
import {
  listCommitteeOptions,
  listMeetings,
  listSchedulableCommittees,
} from "@/modules/committees/contracts/service";
import type { MeetingListItem } from "@/modules/committees/contracts/types";
import { formatDateTime } from "@/modules/committees/domain/format";
import { NewMeetingButton } from "@/modules/committees/ui/meeting-form";
import { flatParams } from "@/modules/committees/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";

export const metadata: Metadata = { title: "Meetings" };

const BASE = "/committees/meetings";

const columns: Column<MeetingListItem>[] = [
  {
    key: "title",
    header: "Meeting",
    cell: (meeting) => <span dir="auto">{meeting.title}</span>,
  },
  {
    key: "committee",
    header: "Committee",
    cell: (meeting) => <span dir="auto">{meeting.committee.name}</span>,
  },
  {
    key: "when",
    header: "Date and time",
    cell: (meeting) => (
      <span className="whitespace-nowrap">{formatDateTime(meeting.scheduledAt)}</span>
    ),
  },
  {
    key: "location",
    header: "Location",
    hideOnMobile: true,
    cell: (meeting) =>
      meeting.location === null ? (
        <span className="text-foreground-muted">—</span>
      ) : (
        <span dir="auto">{meeting.location}</span>
      ),
  },
  {
    key: "organizer",
    header: "Organiser",
    hideOnMobile: true,
    cell: (meeting) => <span dir="auto">{meeting.organizer.name}</span>,
  },
  {
    key: "tasks",
    header: "Open tasks",
    align: "end",
    cell: (meeting) => (
      <span>
        {meeting.openTaskCount}
        <span className="text-foreground-muted"> / {meeting.taskCount}</span>
      </span>
    ),
  },
];

/** The meetings of the committees you belong to, upcoming or past. */
export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const when = params.when === "past" ? "past" : "upcoming";
  const [page, committees, schedulable] = await Promise.all([
    listMeetings(actor, { ...params, when }),
    listCommitteeOptions(actor),
    listSchedulableCommittees(actor),
  ]);

  return (
    <div>
      <PageHeader
        title="Meetings"
        description="Committee meetings you can see: those of your committees, those you organise, and those where you have a task."
        actions={<NewMeetingButton committees={schedulable} />}
      />

      <nav aria-label="When" className="mb-3 flex gap-2">
        <ButtonLink
          href={BASE}
          size="sm"
          variant={when === "upcoming" ? "primary" : "secondary"}
          aria-current={when === "upcoming" ? "page" : undefined}
        >
          Upcoming
        </ButtonLink>
        <ButtonLink
          href={`${BASE}?when=past`}
          size="sm"
          variant={when === "past" ? "primary" : "secondary"}
          aria-current={when === "past" ? "page" : undefined}
        >
          Past
        </ButtonLink>
      </nav>

      <FilterBar
        basePath={BASE}
        query={params.q}
        searchLabel="Search meetings by title"
        preserve={{ when: when === "past" ? "past" : undefined }}
        selects={[
          {
            name: "committee",
            label: "Committee",
            value: params.committee,
            allLabel: "All committees",
            options: committees.map((committee) => ({
              value: committee.id,
              label: committee.name,
            })),
          },
        ]}
      />

      <Panel>
        <DataTable
          columns={columns}
          rows={page.rows}
          rowKey={(meeting) => meeting.id}
          rowHref={(meeting) => `${BASE}/${meeting.id}`}
          basePath={BASE}
          searchParams={{
            when: when === "past" ? "past" : undefined,
            q: params.q,
            committee: params.committee,
          }}
          page={{ page: page.page, pageSize: page.pageSize, total: page.total }}
          emptyTitle={when === "upcoming" ? "No upcoming meetings" : "No past meetings"}
          emptyDescription={
            schedulable.length > 0
              ? "Schedule a meeting for one of your committees, then build its agenda and Team To-Do List."
              : "Meetings appear here once you are a member of a committee that schedules one."
          }
        />
      </Panel>
    </div>
  );
}
