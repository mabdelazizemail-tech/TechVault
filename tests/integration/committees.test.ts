import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import {
  COMMITTEES_ADMIN_PERMISSIONS,
  COMMITTEES_MEMBER_PERMISSIONS,
} from "@/modules/committees/contracts/permissions";
import {
  addAgendaItem,
  changeTaskStatus,
  createCommittee,
  createMeeting,
  createTask,
  deleteMeeting,
  deleteTask,
  getCommittee,
  getMeeting,
  getTask,
  getTaskSummary,
  listCommittees,
  listMeetingAssignees,
  listMeetings,
  listTasks,
  moveAgendaItem,
  removeAgendaItem,
  replyToTask,
  updateCommittee,
  updateMeeting,
  updateTask,
} from "@/modules/committees/contracts/service";
import { addDays, todayInCairo } from "@/modules/committees/domain/dates";
import { formatDateTime } from "@/modules/committees/domain/format";
import {
  getNotificationSummary,
  listNotifications,
  markAllNotificationsRead,
  notify,
  setNotificationRead,
} from "@/platform/notifications/notifications";
import {
  createRole,
  createUser,
  grantRole,
  hasTestDatabase,
  resetDatabase,
  seedPermissions,
  teardownDatabase,
  testPrisma,
} from "./helpers/db";

/**
 * Committees and their Team To-Do Lists against a real database (ADR-036):
 * who may see and do what, what is stored, who is notified — and that nobody is
 * notified about their own action or twice about one event.
 */
describe.skipIf(!hasTestDatabase)("Committees (integration)", () => {
  type U = { id: string };
  let admin: U;
  let olivia: U; // organiser, member
  let bob: U; // member
  let carol: U; // member
  let dave: U; // holds the Committees role, but is on no committee
  let erin: U; // no Committees permissions at all
  let committeeId: string;
  let meetingId: string;

  const as = (user: U) => ({ id: user.id });
  // Two days ahead, on the minute, so "upcoming" holds whenever the suite runs.
  const meetingAt = new Date(Math.floor((Date.now() + 2 * 86_400_000) / 60_000) * 60_000);
  const today = () => todayInCairo();
  const inDays = (days: number) => addDays(today(), days);
  const db = () => testPrisma();
  const notificationsOf = (user: U) =>
    db().notification.findMany({
      where: { recipientId: user.id },
      orderBy: { createdAt: "asc" },
    });

  afterAll(async () => {
    await teardownDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedPermissions();
    const member = await createRole("committees-user", COMMITTEES_MEMBER_PERMISSIONS);
    const adminRole = await createRole("committees-admin", COMMITTEES_ADMIN_PERMISSIONS);

    admin = await createUser({ email: "admin@example.com" });
    olivia = await createUser({ email: "olivia@example.com" });
    bob = await createUser({ email: "bob@example.com" });
    carol = await createUser({ email: "carol@example.com" });
    dave = await createUser({ email: "dave@example.com" });
    erin = await createUser({ email: "erin@example.com" });
    await grantRole(admin.id, adminRole.id);
    for (const user of [olivia, bob, carol, dave]) await grantRole(user.id, member.id);

    committeeId = (
      await createCommittee(as(admin), {
        name: "Board",
        description: "Runs the company",
        memberIds: [olivia.id, bob.id, carol.id],
      })
    ).id;
    meetingId = (
      await createMeeting(as(olivia), {
        committeeId,
        title: "October board meeting",
        scheduledAt: meetingAt.toISOString(),
        location: "Room 4",
      })
    ).id;
  });

  const task = (overrides: Record<string, unknown> = {}) => ({
    description: "Prepare the Q4 budget draft",
    dueDate: inDays(7),
    assignees: [{ userId: bob.id }, { name: "Omar Hassan" }],
    ...overrides,
  });

  /* ------------------------------------------------------------------------ */
  /* Committees                                                               */
  /* ------------------------------------------------------------------------ */

  describe("committees", () => {
    it("are created only by an organisation-wide committee administrator", async () => {
      await expect(
        createCommittee(as(olivia), { name: "Audit", memberIds: [] }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        createCommittee(as(erin), { name: "Audit", memberIds: [] }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("refuse a second committee with the same name, whatever its case", async () => {
      await expect(
        createCommittee(as(admin), { name: "  board ", memberIds: [] }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("refuse a member who cannot open Committees, naming them and the fix", async () => {
      const error = await createCommittee(as(admin), {
        name: "Audit",
        memberIds: [erin.id],
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toContain("erin");
      expect((error as ValidationError).message).toContain("Committees role");
    });

    it("are visible to their members and to administrators only", async () => {
      expect((await getCommittee(as(bob), committeeId)).isMember).toBe(true);
      expect((await getCommittee(as(admin), committeeId)).rights.canAdminister).toBe(
        true,
      );
      await expect(getCommittee(as(dave), committeeId)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect((await listCommittees(as(dave))).total).toBe(0);
      await expect(listCommittees(as(erin))).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("change members with an audit record, and archived ones take no new meetings", async () => {
      await updateCommittee(as(admin), committeeId, {
        name: "Board",
        description: "Runs the company",
        isActive: false,
        memberIds: [olivia.id, bob.id, dave.id],
      });
      const committee = await getCommittee(as(admin), committeeId);
      expect(committee.members.map((member) => member.id).sort()).toEqual(
        [olivia.id, bob.id, dave.id].sort(),
      );
      const audit = await db().auditLog.findFirst({
        where: { action: "committees.committee.updated", entityId: committeeId },
      });
      expect(audit?.changes).toMatchObject({
        membersAdded: [dave.id],
        membersRemoved: [carol.id],
      });
      await expect(
        createMeeting(as(olivia), {
          committeeId,
          title: "Another",
          scheduledAt: "2026-11-01T10:00:00.000Z",
        }),
      ).rejects.toBeInstanceOf(BusinessRuleError);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Meetings and agenda                                                      */
  /* ------------------------------------------------------------------------ */

  describe("meetings", () => {
    it("are scheduled by members, who become their organiser", async () => {
      const meeting = await getMeeting(as(bob), meetingId);
      expect(meeting.organizer.id).toBe(olivia.id);
      expect(meeting.members.map((member) => member.id).sort()).toEqual(
        [olivia.id, bob.id, carol.id].sort(),
      );
      await expect(
        createMeeting(as(dave), {
          committeeId,
          title: "Not mine",
          scheduledAt: "2026-11-01T10:00:00.000Z",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      const audit = await db().auditLog.count({
        where: { action: "committees.meeting.scheduled", entityId: meetingId },
      });
      const event = await db().eventOutbox.count({
        where: { name: "committees.MeetingScheduled" },
      });
      expect([audit, event]).toEqual([1, 1]);
    });

    it("are edited by their organiser or an administrator, not other members", async () => {
      const edit = {
        title: "October board meeting (moved)",
        scheduledAt: new Date(meetingAt.getTime() + 86_400_000).toISOString(),
        location: "Room 5",
      };
      await expect(updateMeeting(as(carol), meetingId, edit)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await updateMeeting(as(olivia), meetingId, edit);
      expect((await getMeeting(as(carol), meetingId)).location).toBe("Room 5");
      await updateMeeting(as(admin), meetingId, { ...edit, location: "Room 6" });
      expect((await getMeeting(as(carol), meetingId)).location).toBe("Room 6");
    });

    it("keep an ordered agenda only the organiser changes", async () => {
      const first = await addAgendaItem(as(olivia), meetingId, { title: "Minutes" });
      const second = await addAgendaItem(as(olivia), meetingId, { title: "Budget" });
      await expect(
        addAgendaItem(as(carol), meetingId, { title: "Mine" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await moveAgendaItem(as(olivia), second.id, "up");
      expect((await getMeeting(as(bob), meetingId)).agenda.map((i) => i.title)).toEqual([
        "Budget",
        "Minutes",
      ]);
      await removeAgendaItem(as(olivia), first.id);
      expect((await getMeeting(as(bob), meetingId)).agenda.map((i) => i.title)).toEqual([
        "Budget",
      ]);
    });

    it("are deleted only by an administrator, softly", async () => {
      await expect(deleteMeeting(as(olivia), meetingId)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await deleteMeeting(as(admin), meetingId);
      await expect(getMeeting(as(olivia), meetingId)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      const row = await db().committeeMeeting.findUnique({ where: { id: meetingId } });
      expect(row?.deletedAt).not.toBeNull();
    });

    it("are invisible to people outside the committee, and refused to people without the role", async () => {
      await expect(getMeeting(as(dave), meetingId)).rejects.toBeInstanceOf(NotFoundError);
      expect((await listMeetings(as(dave))).total).toBe(0);
      await expect(getMeeting(as(erin), meetingId)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      expect((await listMeetings(as(admin))).total).toBe(1);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Tasks: creation, assignment, notification                                */
  /* ------------------------------------------------------------------------ */

  describe("creating a task", () => {
    it("records the meeting, the creator and both kinds of responsible person", async () => {
      const { id } = await createTask(as(olivia), meetingId, task());
      const created = await getTask(as(bob), id);
      expect(created.meeting.id).toBe(meetingId);
      expect(created.meeting.scheduledAt.toISOString()).toBe(meetingAt.toISOString());
      expect(created.createdBy.id).toBe(olivia.id);
      expect(created.status).toBe("PENDING");
      expect(created.dueDate).toBe(inDays(7));
      expect(created.assignees).toEqual([
        expect.objectContaining({ kind: "user", userId: bob.id }),
        expect.objectContaining({ kind: "manual", name: "Omar Hassan" }),
      ]);
      const rows = await db().committeeTaskAssignee.findMany({ where: { taskId: id } });
      expect(rows.filter((row) => row.userId !== null)).toHaveLength(1);
      expect(rows.filter((row) => row.manualName !== null)).toHaveLength(1);
    });

    it("notifies the people responsible — never the creator acting, nor anyone else", async () => {
      const { id } = await createTask(
        as(olivia),
        meetingId,
        task({
          assignees: [{ userId: bob.id }, { userId: olivia.id }, { name: "Omar" }],
        }),
      );
      const [forBob] = await notificationsOf(bob);
      expect(await notificationsOf(bob)).toHaveLength(1);
      expect(await notificationsOf(olivia)).toHaveLength(0);
      expect(await notificationsOf(carol)).toHaveLength(0);

      expect(forBob?.type).toBe("committees.task.assigned");
      expect(forBob?.title).toBe("olivia assigned you a task");
      expect(forBob?.body).toContain("October board meeting");
      expect(forBob?.body).toContain(formatDateTime(meetingAt));
      expect(forBob?.body).toContain("Prepare the Q4 budget draft");
      expect(forBob?.body).toContain("due ");
      expect(forBob?.link).toBe(`/committees/meetings/${meetingId}/tasks/${id}`);
      expect(forBob?.actorId).toBe(olivia.id);
      expect(forBob?.readAt).toBeNull();
    });

    it("refuses a registered person who cannot open Committees, and writes nothing", async () => {
      const error = await createTask(
        as(olivia),
        meetingId,
        task({ assignees: [{ userId: erin.id }] }),
      ).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toContain("type their name instead");
      expect(await db().committeeTask.count()).toBe(0);
      expect(await db().notification.count()).toBe(0);
    });

    it("lets someone outside the committee be responsible, and see that meeting only", async () => {
      const other = await createMeeting(as(olivia), {
        committeeId,
        title: "November board meeting",
        scheduledAt: new Date(meetingAt.getTime() + 30 * 86_400_000).toISOString(),
      });
      const { id } = await createTask(
        as(olivia),
        meetingId,
        task({ assignees: [{ userId: dave.id }] }),
      );
      expect((await getTask(as(dave), id)).id).toBe(id);
      expect((await getMeeting(as(dave), meetingId)).id).toBe(meetingId);
      await expect(getMeeting(as(dave), other.id)).rejects.toBeInstanceOf(NotFoundError);
      expect((await listTasks(as(dave))).total).toBe(1);
    });

    it("needs the permission and a visible meeting", async () => {
      await expect(createTask(as(erin), meetingId, task())).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(createTask(as(dave), meetingId, task())).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Replies                                                                  */
  /* ------------------------------------------------------------------------ */

  describe("replies", () => {
    it("notify the creator and every registered responsible person, except the author", async () => {
      const { id } = await createTask(
        as(olivia),
        meetingId,
        task({ assignees: [{ userId: bob.id }, { userId: dave.id }, { name: "Omar" }] }),
      );
      await db().notification.deleteMany();

      const reply = await replyToTask(as(bob), id, {
        body: "I have the regional figures.\nSending the draft tomorrow.",
      });
      const forOlivia = await notificationsOf(olivia);
      expect(forOlivia).toHaveLength(1);
      expect(await notificationsOf(dave)).toHaveLength(1);
      expect(await notificationsOf(bob)).toHaveLength(0);
      expect(await notificationsOf(carol)).toHaveLength(0);

      expect(forOlivia[0]?.type).toBe("committees.task.replied");
      expect(forOlivia[0]?.title).toBe("bob replied to a task");
      expect(forOlivia[0]?.body).toContain("October board meeting");
      expect(forOlivia[0]?.body).toContain("Prepare the Q4 budget draft");
      expect(forOlivia[0]?.body).toContain("I have the regional figures. Sending");
      expect(forOlivia[0]?.link).toBe(
        `/committees/meetings/${meetingId}/tasks/${id}#reply-${reply.id}`,
      );
    });

    it("notify a creator who is also responsible once, and a bystander's reply reaches all", async () => {
      const { id } = await createTask(
        as(olivia),
        meetingId,
        task({ assignees: [{ userId: olivia.id }, { userId: bob.id }] }),
      );
      await db().notification.deleteMany();
      await replyToTask(as(carol), id, { body: "Can I help?" });
      expect(await notificationsOf(olivia)).toHaveLength(1);
      expect(await notificationsOf(bob)).toHaveLength(1);
      expect(await notificationsOf(carol)).toHaveLength(0);
    });

    it("are kept in order with their authors, counted, and never edited or removed", async () => {
      const { id } = await createTask(as(olivia), meetingId, task());
      await replyToTask(as(bob), id, { body: "First" });
      await replyToTask(as(carol), id, { body: "Second" });
      await replyToTask(as(olivia), id, { body: "Third" });

      const detail = await getTask(as(bob), id);
      expect(detail.replyCount).toBe(3);
      expect(detail.thread.map((entry) => [entry.author.id, entry.body])).toEqual([
        [bob.id, "First"],
        [carol.id, "Second"],
        [olivia.id, "Third"],
      ]);
      expect((await listTasks(as(bob), {}, { meetingId })).rows[0]?.replyCount).toBe(3);

      await expect(
        db().$executeRaw`UPDATE committees.task_replies SET body = 'rewritten'`,
      ).rejects.toThrow(/cannot be changed or removed/);
      await expect(db().$executeRaw`DELETE FROM committees.task_replies`).rejects.toThrow(
        /cannot be changed or removed/,
      );
    });

    it("need the permission and a task the replier can see", async () => {
      const { id } = await createTask(as(olivia), meetingId, task());
      await expect(replyToTask(as(erin), id, { body: "Hi" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(replyToTask(as(dave), id, { body: "Hi" })).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(replyToTask(as(bob), id, { body: "   " })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Status                                                                   */
  /* ------------------------------------------------------------------------ */

  describe("status", () => {
    it("is changed by a responsible person with a comment, recorded in the discussion", async () => {
      const { id } = await createTask(as(olivia), meetingId, task());
      await db().notification.deleteMany();

      const entry = await changeTaskStatus(as(bob), id, {
        status: "IN_PROGRESS",
        comment: "Started on the figures",
      });
      expect(entry).toMatchObject({
        statusFrom: "PENDING",
        statusTo: "IN_PROGRESS",
        body: "Started on the figures",
      });
      const detail = await getTask(as(olivia), id);
      expect(detail.status).toBe("IN_PROGRESS");
      expect(detail.replyCount).toBe(1);

      const [forOlivia] = await notificationsOf(olivia);
      expect(forOlivia?.type).toBe("committees.task.status_changed");
      expect(forOlivia?.title).toBe("bob marked a task In progress");
      expect(await notificationsOf(bob)).toHaveLength(0);
      expect(
        await db().eventOutbox.count({ where: { name: "committees.TaskStatusChanged" } }),
      ).toBe(1);
    });

    it("records completion time on Completed and clears it when reopened", async () => {
      const { id } = await createTask(as(olivia), meetingId, task());
      await changeTaskStatus(as(olivia), id, { status: "COMPLETED" });
      expect((await getTask(as(bob), id)).completedAt).not.toBeNull();
      expect((await getTask(as(bob), id)).replyCount).toBe(0); // a bare change is not a reply
      await changeTaskStatus(as(bob), id, { status: "PENDING", comment: "Reopened" });
      expect((await getTask(as(bob), id)).completedAt).toBeNull();
    });

    it("is refused to members who neither created, organise nor are responsible", async () => {
      const { id } = await createTask(as(olivia), meetingId, task());
      await expect(
        changeTaskStatus(as(carol), id, { status: "COMPLETED" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect((await getTask(as(carol), id)).rights.canChangeStatus).toBe(false);
      expect((await getTask(as(bob), id)).rights.canChangeStatus).toBe(true);
    });

    it("turns 'same status plus a comment' into a reply, and refuses a no-op", async () => {
      const { id } = await createTask(as(olivia), meetingId, task());
      await expect(
        changeTaskStatus(as(bob), id, { status: "PENDING" }),
      ).rejects.toBeInstanceOf(BusinessRuleError);
      const entry = await changeTaskStatus(as(bob), id, {
        status: "PENDING",
        comment: "Still waiting on finance",
      });
      expect(entry.statusTo).toBeNull();
      expect((await getTask(as(bob), id)).replyCount).toBe(1);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Editing and deleting                                                     */
  /* ------------------------------------------------------------------------ */

  describe("editing and deleting", () => {
    it("lets the creator change responsibility, notifying only the newly responsible", async () => {
      const { id } = await createTask(as(olivia), meetingId, task());
      await db().notification.deleteMany();
      await updateTask(as(olivia), id, {
        description: "Prepare the Q4 budget draft",
        dueDate: inDays(10),
        assignees: [{ userId: bob.id }, { userId: carol.id }, { name: "Mona" }],
      });
      const detail = await getTask(as(olivia), id);
      expect(detail.dueDate).toBe(inDays(10));
      expect(detail.assignees.map((a) => a.name)).toEqual(["bob", "carol", "Mona"]);
      expect(await notificationsOf(carol)).toHaveLength(1);
      expect(await notificationsOf(bob)).toHaveLength(0);
    });

    it("is refused to a responsible person who did not create it", async () => {
      const { id } = await createTask(as(olivia), meetingId, task());
      await expect(updateTask(as(bob), id, task())).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("deletes only for administrators, keeping the row and auditing it", async () => {
      const { id } = await createTask(as(olivia), meetingId, task());
      await expect(deleteTask(as(olivia), id)).rejects.toBeInstanceOf(ForbiddenError);
      await deleteTask(as(admin), id);
      await expect(getTask(as(olivia), id)).rejects.toBeInstanceOf(NotFoundError);
      expect(
        (await db().committeeTask.findUnique({ where: { id } }))?.deletedAt,
      ).not.toBe(null);
      const audit = await db().auditLog.findFirst({
        where: { action: "committees.task.deleted", entityId: id },
      });
      expect(audit?.severity).toBe("WARNING");
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Lists, filters and the summary                                           */
  /* ------------------------------------------------------------------------ */

  describe("lists and summary", () => {
    beforeEach(async () => {
      const make = async (description: string, dueDate: string, assignees: unknown[]) =>
        (await createTask(as(olivia), meetingId, { description, dueDate, assignees })).id;
      const late = await make("Late pending", inDays(-3), [{ userId: bob.id }]);
      const lateWorking = await make("Late in progress", inDays(-1), [{ name: "Omar" }]);
      await make("Due soon", inDays(2), [{ userId: carol.id }]);
      await make("Due later", inDays(60), [{ name: "Omar" }, { userId: bob.id }]);
      const finished = await make("Done long ago", inDays(-30), [{ userId: bob.id }]);
      await changeTaskStatus(as(olivia), lateWorking, { status: "IN_PROGRESS" });
      await changeTaskStatus(as(olivia), finished, { status: "COMPLETED" });
      expect(late).toBeTruthy();
    });

    it("count by what people see, adding up to the total", async () => {
      expect(await getTaskSummary(as(bob), { meetingId })).toEqual({
        total: 5,
        pending: 2,
        inProgress: 0,
        completed: 1,
        overdue: 2,
      });
      expect((await getTaskSummary(as(dave))).total).toBe(0);
    });

    it("filter by status, with Overdue derived from the due date", async () => {
      const descriptions = async (params: Record<string, unknown>) =>
        (await listTasks(as(bob), params, { meetingId })).rows.map((t) => t.description);
      expect(await descriptions({ status: "OVERDUE" })).toEqual([
        "Late pending",
        "Late in progress",
      ]);
      expect(await descriptions({ status: "PENDING" })).toEqual([
        "Due soon",
        "Due later",
      ]);
      expect(await descriptions({ status: "COMPLETED" })).toEqual(["Done long ago"]);
      const overdueRow = (await listTasks(as(bob), { status: "OVERDUE" })).rows[1];
      expect(overdueRow?.status).toBe("IN_PROGRESS");
      expect(overdueRow?.displayStatus).toBe("OVERDUE");
    });

    it("filter by responsible person — me, a user, or a typed name — and due date", async () => {
      const descriptions = async (params: Record<string, unknown>) =>
        (await listTasks(as(bob), params, { meetingId })).rows.map((t) => t.description);
      expect(await descriptions({ responsible: "me" })).toEqual([
        "Done long ago",
        "Late pending",
        "Due later",
      ]);
      expect(await descriptions({ responsible: `user:${carol.id}` })).toEqual([
        "Due soon",
      ]);
      expect(await descriptions({ responsible: "name:omar" })).toEqual([
        "Late in progress",
        "Due later",
      ]);
      expect(await descriptions({ due: "week" })).toEqual(["Due soon"]);
      expect(await descriptions({ due: "overdue" })).toEqual([
        "Late pending",
        "Late in progress",
      ]);
      expect(await descriptions({ due: "later" })).toEqual(["Due later"]);
    });

    it("search descriptions and people's names, and sort", async () => {
      const descriptions = async (params: Record<string, unknown>) =>
        (await listTasks(as(bob), params, { meetingId })).rows.map((t) => t.description);
      expect(await descriptions({ q: "SOON" })).toEqual(["Due soon"]);
      expect(await descriptions({ q: "omar" })).toEqual([
        "Late in progress",
        "Due later",
      ]);
      expect(await descriptions({ q: "carol" })).toEqual(["Due soon"]);
      expect((await descriptions({ sort: "due", dir: "desc" }))[0]).toBe("Due later");
    });

    it("offer the meeting's responsible people for the filter, users and names apart", async () => {
      const people = await listMeetingAssignees(as(bob), meetingId);
      expect(people.users.map((user) => user.id).sort()).toEqual(
        [bob.id, carol.id].sort(),
      );
      expect(people.names).toEqual(["Omar"]);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* The notification service                                                 */
  /* ------------------------------------------------------------------------ */

  describe("notifications", () => {
    it("are read, marked and counted by their recipient only", async () => {
      await createTask(as(olivia), meetingId, task());
      const { id } = await createTask(
        as(olivia),
        meetingId,
        task({ description: "Two" }),
      );
      await replyToTask(as(carol), id, { body: "Noted" });

      const summary = await getNotificationSummary(as(bob));
      expect(summary.unreadCount).toBe(3);
      expect(summary.latest[0]?.type).toBe("committees.task.replied");

      const first = summary.latest[0];
      if (first === undefined) throw new Error("expected a notification");
      await expect(setNotificationRead(as(carol), first.id, true)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await setNotificationRead(as(bob), first.id, true);
      expect((await getNotificationSummary(as(bob))).unreadCount).toBe(2);
      await setNotificationRead(as(bob), first.id, false);
      expect((await listNotifications(as(bob), { unreadOnly: true })).total).toBe(3);
      expect(await markAllNotificationsRead(as(bob))).toBe(3);
      expect((await getNotificationSummary(as(bob))).unreadCount).toBe(0);
      expect((await listNotifications(as(bob))).total).toBe(3);
    });

    it("skip inactive accounts and never duplicate one event for one person", async () => {
      const zed = await createUser({ email: "zed@example.com", isActive: false });
      const source = crypto.randomUUID();
      const input = {
        type: "committees.task.replied",
        module: "committees",
        entityType: "CommitteeTask",
        entityId: source,
        sourceId: source,
        actorId: olivia.id,
        recipientIds: [bob.id, bob.id, zed.id, olivia.id],
        title: "Test",
        body: "Body",
        link: "/committees",
      };
      const written = await prisma.$transaction(async (tx) => [
        await notify(tx, input),
        await notify(tx, input),
      ]);
      expect(written).toEqual([1, 0]);
      expect(await notificationsOf(zed)).toHaveLength(0);
    });

    it("refuse a link that is not an application path, in the service and the database", async () => {
      await expect(
        prisma.$transaction((tx) =>
          notify(tx, {
            type: "committees.task.replied",
            module: "committees",
            entityType: "CommitteeTask",
            entityId: crypto.randomUUID(),
            sourceId: crypto.randomUUID(),
            actorId: null,
            recipientIds: [bob.id],
            title: "Phish",
            body: "",
            link: "//evil.example",
          }),
        ),
      ).rejects.toThrow(/application path/);
      await expect(
        db().$executeRaw`
          INSERT INTO platform.notifications
            (recipient_id, type, module, entity_type, entity_id, source_id, title, body, link)
          VALUES (${bob.id}::uuid, 'committees.task.replied', 'committees', 'CommitteeTask',
                  gen_random_uuid(), gen_random_uuid(), 'x', '', '//evil.example')`,
      ).rejects.toThrow(/notifications_link_is_path/);
    });

    it("are refused to people whose account is inactive", async () => {
      await db().user.update({ where: { id: bob.id }, data: { isActive: false } });
      await expect(getNotificationSummary(as(bob))).rejects.toThrow();
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Database invariants, for every writer                                    */
  /* ------------------------------------------------------------------------ */

  describe("database invariants", () => {
    it("hold a responsible person to exactly one of a user or a typed name, once per task", async () => {
      const { id } = await createTask(as(olivia), meetingId, task());
      await expect(
        db()
          .$executeRaw`INSERT INTO committees.task_assignees (task_id) VALUES (${id}::uuid)`,
      ).rejects.toThrow(/task_assignees_user_or_name/);
      await expect(
        db().$executeRaw`
          INSERT INTO committees.task_assignees (task_id, user_id, manual_name)
          VALUES (${id}::uuid, ${carol.id}::uuid, 'Carol')`,
      ).rejects.toThrow(/task_assignees_user_or_name/);
      await expect(
        db().$executeRaw`
          INSERT INTO committees.task_assignees (task_id, user_id)
          VALUES (${id}::uuid, ${bob.id}::uuid)`,
      ).rejects.toThrow(/task_assignees_task_user_key/);
      await expect(
        db().$executeRaw`
          INSERT INTO committees.task_assignees (task_id, manual_name)
          VALUES (${id}::uuid, ' omar hassan')`,
      ).rejects.toThrow(/task_assignees_task_manual_name_key/);
    });

    it("tie Completed to a completion time", async () => {
      const { id } = await createTask(as(olivia), meetingId, task());
      await expect(
        db()
          .$executeRaw`UPDATE committees.tasks SET status = 'COMPLETED' WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/tasks_completed_matches_status/);
    });

    it("refuse an empty discussion entry and a status 'change' to the same status", async () => {
      const { id } = await createTask(as(olivia), meetingId, task());
      await expect(
        db().$executeRaw`
          INSERT INTO committees.task_replies (task_id, author_id)
          VALUES (${id}::uuid, ${bob.id}::uuid)`,
      ).rejects.toThrow(/task_replies_not_empty/);
      await expect(
        db().$executeRaw`
          INSERT INTO committees.task_replies (task_id, author_id, status_from, status_to)
          VALUES (${id}::uuid, ${bob.id}::uuid, 'PENDING', 'PENDING')`,
      ).rejects.toThrow(/task_replies_status_changes/);
    });

    it("have row-level security on, and the Realtime trigger in place", async () => {
      const tables = await db().$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
        SELECT c.relname, c.relrowsecurity
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE (n.nspname = 'committees' AND c.relkind = 'r')
            OR (n.nspname = 'platform' AND c.relname = 'notifications')`;
      expect(tables).toHaveLength(8);
      expect(tables.every((table) => table.relrowsecurity)).toBe(true);
      const triggers = await db().$queryRaw<{ tgname: string }[]>`
        SELECT tgname FROM pg_trigger
         WHERE tgname IN ('notifications_announce', 'task_replies_append_only', 'task_replies_count')`;
      expect(triggers.map((trigger) => trigger.tgname).sort()).toEqual([
        "notifications_announce",
        "task_replies_append_only",
        "task_replies_count",
      ]);
    });
  });
});
