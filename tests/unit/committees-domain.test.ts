import { describe, expect, it } from "vitest";
import {
  replySchema,
  statusChangeSchema,
  taskListParamsSchema,
  taskSchema,
} from "@/modules/committees/contracts/schemas";
import { addDays, isIsoDate, todayInCairo } from "@/modules/committees/domain/dates";
import {
  displayStatus,
  dueWindowRange,
  meetingRights,
  normaliseAssignees,
  taskAssignedNotice,
  taskReplyNotice,
  taskRights,
  taskStatusNotice,
} from "@/modules/committees/domain/tasks";

/** Pure rules behind each meeting's Team To-Do List (ADR-036). */

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";

describe("task status", () => {
  it("shows a task that is not completed and past its due date as Overdue", () => {
    expect(displayStatus("PENDING", "2026-10-02", "2026-10-03")).toBe("OVERDUE");
    expect(displayStatus("IN_PROGRESS", "2026-10-02", "2026-10-03")).toBe("OVERDUE");
  });

  it("is not overdue on the due date itself, nor ever once completed", () => {
    expect(displayStatus("PENDING", "2026-10-03", "2026-10-03")).toBe("PENDING");
    expect(displayStatus("IN_PROGRESS", "2026-12-01", "2026-10-03")).toBe("IN_PROGRESS");
    expect(displayStatus("COMPLETED", "2020-01-01", "2026-10-03")).toBe("COMPLETED");
  });
});

describe("dates", () => {
  it("accepts real calendar dates only", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("3 Oct 2026")).toBe(false);
  });

  it("counts days across month and year ends", () => {
    expect(addDays("2026-12-30", 6)).toBe("2027-01-05");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("takes today from Cairo, not from the server's clock zone", () => {
    // 22:30 UTC on 2 October is already 3 October in Cairo (UTC+3 in summer).
    expect(todayInCairo(new Date("2026-10-02T22:30:00Z"))).toBe("2026-10-03");
    expect(todayInCairo(new Date("2026-10-02T12:00:00Z"))).toBe("2026-10-02");
  });

  it("turns due-date filters into ranges counted from today", () => {
    expect(dueWindowRange("overdue", "2026-10-03")).toEqual({
      lt: "2026-10-03",
      openOnly: true,
    });
    expect(dueWindowRange("today", "2026-10-03")).toEqual({
      gte: "2026-10-03",
      lte: "2026-10-03",
    });
    expect(dueWindowRange("week", "2026-10-03")).toEqual({
      gte: "2026-10-03",
      lte: "2026-10-09",
    });
    expect(dueWindowRange("later", "2026-10-03")).toEqual({ gt: "2026-11-01" });
  });
});

describe("responsible people", () => {
  it("lists each registered user and each typed name once", () => {
    expect(
      normaliseAssignees([
        { userId: ALICE },
        { name: "  Omar   Hassan " },
        { userId: ALICE },
        { name: "omar hassan" },
        { name: "Mona (external auditor)" },
      ]),
    ).toEqual({
      userIds: [ALICE],
      names: ["Omar Hassan", "Mona (external auditor)"],
    });
  });

  it("requires at least one and at most twenty, and tells users and names apart", () => {
    const base = { description: "Draft the budget", dueDate: "2026-10-10" };
    expect(taskSchema.safeParse({ ...base, assignees: [] }).success).toBe(false);
    expect(
      taskSchema.safeParse({
        ...base,
        assignees: Array.from({ length: 21 }, (_, i) => ({ name: `P${i}` })),
      }).success,
    ).toBe(false);
    const parsed = taskSchema.parse({
      ...base,
      assignees: [{ userId: ALICE }, { name: "Omar" }],
    });
    expect(parsed.assignees).toEqual([{ userId: ALICE }, { name: "Omar" }]);
    expect(
      taskSchema.safeParse({ ...base, assignees: [{ userId: "not-an-id" }] }).success,
    ).toBe(false);
  });

  it("refuses an impossible due date and an empty description", () => {
    const assignees = [{ name: "Omar" }];
    expect(
      taskSchema.safeParse({ description: "x", dueDate: "2026-02-30", assignees })
        .success,
    ).toBe(false);
    expect(
      taskSchema.safeParse({ description: "   ", dueDate: "2026-10-10", assignees })
        .success,
    ).toBe(false);
  });
});

describe("rights on a task", () => {
  const base = {
    actorId: ALICE,
    isAdmin: false,
    organizerId: CAROL,
    createdBy: BOB,
    assigneeUserIds: [] as string[],
    holdsTaskUpdate: true,
    holdsTaskReply: true,
  };

  it("lets the creator and the organiser edit and change status", () => {
    for (const actorId of [BOB, CAROL]) {
      const rights = taskRights({ ...base, actorId });
      expect(rights.canEdit).toBe(true);
      expect(rights.canChangeStatus).toBe(true);
    }
  });

  it("lets a responsible person change status but not edit", () => {
    const rights = taskRights({ ...base, assigneeUserIds: [ALICE] });
    expect(rights).toMatchObject({ canEdit: false, canChangeStatus: true });
  });

  it("lets any other member reply only", () => {
    expect(taskRights(base)).toEqual({
      canEdit: false,
      canChangeStatus: false,
      canReply: true,
      canDelete: false,
    });
  });

  it("gives nothing without the permission, and deletion only to administrators", () => {
    expect(
      taskRights({
        ...base,
        actorId: BOB,
        holdsTaskUpdate: false,
        holdsTaskReply: false,
      }),
    ).toEqual({
      canEdit: false,
      canChangeStatus: false,
      canReply: false,
      canDelete: false,
    });
    expect(taskRights({ ...base, isAdmin: true }).canDelete).toBe(true);
    expect(taskRights({ ...base, actorId: BOB }).canDelete).toBe(false);
  });

  it("lets only the organiser or an administrator edit a meeting", () => {
    const meeting = {
      actorId: ALICE,
      isAdmin: false,
      organizerId: CAROL,
      holdsMeetingUpdate: true,
      holdsTaskCreate: true,
    };
    expect(meetingRights(meeting)).toEqual({
      canEdit: false,
      canAddTask: true,
      canDelete: false,
    });
    expect(meetingRights({ ...meeting, actorId: CAROL }).canEdit).toBe(true);
    expect(meetingRights({ ...meeting, isAdmin: true })).toMatchObject({
      canEdit: true,
      canDelete: true,
    });
  });
});

describe("notification text", () => {
  it("names the meeting, its date, the task, the due date and who created it", () => {
    const notice = taskAssignedNotice({
      actorName: "Sara Ahmed",
      meetingTitle: "Board meeting",
      meetingDate: "Sat, 3 Oct 2026, 14:00",
      description: "Prepare the Q4 budget draft",
      dueDate: "Sat, 10 Oct 2026",
    });
    expect(notice.title).toBe("Sara Ahmed assigned you a task");
    expect(notice.body).toContain("Board meeting (Sat, 3 Oct 2026, 14:00)");
    expect(notice.body).toContain("Prepare the Q4 budget draft");
    expect(notice.body).toContain("due Sat, 10 Oct 2026");
  });

  it("previews long replies rather than copying them whole", () => {
    const notice = taskReplyNotice({
      actorName: "Omar",
      meetingTitle: "Board meeting",
      description: "Prepare the Q4 budget draft",
      reply: `First line\n\n${"word ".repeat(200)}`,
    });
    expect(notice.title).toBe("Omar replied to a task");
    expect(notice.body).toContain("First line word");
    expect(notice.body.length).toBeLessThan(400);
    expect(notice.body.endsWith("…”")).toBe(true);
  });

  it("says what a status became, with the comment when there is one", () => {
    expect(
      taskStatusNotice({
        actorName: "Omar",
        meetingTitle: "Board",
        description: "Budget",
        statusLabel: "Completed",
        comment: null,
      }).title,
    ).toBe("Omar marked a task Completed");
    expect(
      taskStatusNotice({
        actorName: "Omar",
        meetingTitle: "Board",
        description: "Budget",
        statusLabel: "In progress",
        comment: "Halfway there",
      }).body,
    ).toContain("Halfway there");
  });
});

describe("list parameters", () => {
  it("tells the three kinds of responsible-person filter apart", () => {
    expect(taskListParamsSchema.parse({ responsible: "me" }).responsible).toEqual({
      kind: "me",
    });
    expect(
      taskListParamsSchema.parse({ responsible: `user:${ALICE}` }).responsible,
    ).toEqual({ kind: "user", id: ALICE });
    expect(taskListParamsSchema.parse({ responsible: "name:Omar" }).responsible).toEqual({
      kind: "name",
      name: "Omar",
    });
    expect(taskListParamsSchema.parse({ responsible: "user:nope" }).responsible).toBe(
      undefined,
    );
  });

  it("falls back to safe defaults for anything malformed", () => {
    expect(
      taskListParamsSchema.parse({ page: "-3", status: "DONE", due: "soon", sort: "x" }),
    ).toMatchObject({ page: 1, status: undefined, due: undefined, sort: undefined });
  });

  it("requires a status to change to and some text to reply with", () => {
    expect(statusChangeSchema.safeParse({ status: "OVERDUE" }).success).toBe(false);
    expect(statusChangeSchema.parse({ status: "COMPLETED", comment: "" })).toEqual({
      status: "COMPLETED",
      comment: null,
    });
    expect(replySchema.safeParse({ body: "  " }).success).toBe(false);
  });
});
