import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { Badge, EmptyState, Panel, PanelHeader } from "@/components/ui/primitives";
import { getCommittee, listMeetings } from "@/modules/committees/contracts/service";
import type { MeetingListItem } from "@/modules/committees/contracts/types";
import { formatDateTime } from "@/modules/committees/domain/format";
import { EditCommitteeButton } from "@/modules/committees/ui/committee-form";
import { NewMeetingButton } from "@/modules/committees/ui/meeting-form";
import { orNotFound } from "@/modules/committees/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";

export const metadata: Metadata = { title: "Committee" };

/** One committee: its purpose, its members and its meetings. */
export default async function CommitteePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();
  const committee = await orNotFound(getCommittee(actor, id));
  const [upcoming, past] = await Promise.all([
    listMeetings(actor, { committee: committee.id, when: "upcoming" }),
    listMeetings(actor, { committee: committee.id, when: "past" }),
  ]);

  return (
    <div>
      <BreadcrumbTitle segment={committee.id} label={committee.name} />

      <div className="flex flex-wrap items-start gap-4 pb-4">
        <div className="min-w-0 flex-1">
          <h1 dir="auto" className="text-foreground text-[28px] leading-tight font-bold">
            {committee.name}
          </h1>
          <p className="text-foreground-muted mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px]">
            {!committee.isActive && <Badge>Archived</Badge>}
            {committee.isMember && <Badge tone="info">You are a member</Badge>}
            <span>
              {committee.members.length}{" "}
              {committee.members.length === 1 ? "member" : "members"}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {committee.rights.canSchedule && (
            <NewMeetingButton
              committees={[{ id: committee.id, name: committee.name }]}
              defaultCommitteeId={committee.id}
            />
          )}
          {committee.rights.canAdminister && (
            <EditCommitteeButton
              committee={{
                id: committee.id,
                name: committee.name,
                description: committee.description,
                isActive: committee.isActive,
                members: committee.members.map((member) => ({
                  id: member.id,
                  name: member.name,
                })),
              }}
            />
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {committee.description !== null && (
            <Panel className="px-5 py-4">
              <p className="label-caps mb-1">Purpose</p>
              <p
                dir="auto"
                className="text-foreground text-[14px] leading-relaxed whitespace-pre-line"
              >
                {committee.description}
              </p>
            </Panel>
          )}
          <MeetingPanel
            title="Upcoming meetings"
            meetings={upcoming.rows}
            more={upcoming.total > upcoming.rows.length}
            moreHref={`/committees/meetings?committee=${committee.id}`}
            empty="No meetings are scheduled."
          />
          <MeetingPanel
            title="Past meetings"
            meetings={past.rows}
            more={past.total > past.rows.length}
            moreHref={`/committees/meetings?when=past&committee=${committee.id}`}
            empty="No meetings have been held yet."
          />
        </div>

        <Panel className="h-fit overflow-hidden">
          <PanelHeader title={`Members (${committee.members.length})`} />
          {committee.members.length === 0 ? (
            <EmptyState
              title="No members"
              description="A committee administrator chooses who sits on this committee."
            />
          ) : (
            <ul className="divide-border divide-y">
              {committee.members.map((member) => (
                <li
                  key={member.id}
                  dir="auto"
                  className="text-foreground px-4 py-2 text-sm"
                >
                  {member.name}
                  {!member.isActive && (
                    <span className="text-foreground-muted ms-1.5 text-xs">
                      (inactive)
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function MeetingPanel({
  title,
  meetings,
  more,
  moreHref,
  empty,
}: {
  title: string;
  meetings: readonly MeetingListItem[];
  more: boolean;
  moreHref: string;
  empty: string;
}) {
  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title={title}
        actions={
          more ? (
            <Link
              href={moreHref}
              className="text-primary-ink text-xs font-bold underline"
            >
              See all
            </Link>
          ) : undefined
        }
      />
      {meetings.length === 0 ? (
        <p className="text-foreground-muted px-4 py-3 text-sm">{empty}</p>
      ) : (
        <ul className="divide-border divide-y">
          {meetings.slice(0, 8).map((meeting) => (
            <li key={meeting.id}>
              <Link
                href={`/committees/meetings/${meeting.id}`}
                className="hover:bg-surface-hover flex items-start gap-3 px-4 py-3"
              >
                <span className="min-w-0 flex-1">
                  <span
                    dir="auto"
                    className="text-foreground block text-sm font-semibold"
                  >
                    {meeting.title}
                  </span>
                  <span className="text-foreground-muted text-xs">
                    {formatDateTime(meeting.scheduledAt)}
                    {meeting.location !== null && (
                      <>
                        {" · "}
                        <span dir="auto">{meeting.location}</span>
                      </>
                    )}
                  </span>
                </span>
                <span className="text-foreground-muted shrink-0 text-xs tabular-nums">
                  {meeting.openTaskCount} open / {meeting.taskCount}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
