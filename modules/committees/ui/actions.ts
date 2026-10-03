"use server";

import { revalidatePath } from "next/cache";
import { isAppError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/platform/authz/authz";
import { getActor } from "@/platform/auth/current-user";
import { logger, newCorrelationId } from "@/platform/observability/logger";
import * as committees from "../contracts/service";
import type { AgendaItemDto, ThreadEntry } from "../contracts/types";

/**
 * Committees' Server Actions (CLAUDE.md §9): authenticate, delegate, and turn the
 * outcome into something a form can show. Services authorise and validate.
 */

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

async function run<T>(
  operation: string,
  work: (actor: Actor) => Promise<T>,
  options: { revalidate?: boolean } = {},
): Promise<ActionResult<T>> {
  try {
    const actor = await getActor();
    const data = await work(actor);
    if (options.revalidate !== false) revalidatePath("/committees", "layout");
    return { ok: true, data };
  } catch (error) {
    if (isAppError(error)) {
      return {
        ok: false,
        message: error.message,
        ...(error instanceof ValidationError && Object.keys(error.fieldErrors).length > 0
          ? { fieldErrors: error.fieldErrors }
          : {}),
      };
    }
    const traceId = newCorrelationId();
    logger.error("Committees action failed", {
      module: "committees",
      operation,
      traceId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      message: `Something went wrong and nothing was saved. Reference: ${traceId}`,
    };
  }
}

const done = async <T>(promise: Promise<T>): Promise<null> => {
  await promise;
  return null;
};

/* People ------------------------------------------------------------------------ */

export async function searchPeopleAction(
  query: string,
): Promise<ActionResult<{ id: string; name: string; email: string }[]>> {
  return run(
    "committees.people.search",
    (actor) => committees.searchPeople(actor, query),
    {
      revalidate: false,
    },
  );
}

/* Committees ---------------------------------------------------------------------- */

export async function createCommitteeAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("committees.committee.create", (actor) =>
    committees.createCommittee(actor, input),
  );
}

export async function updateCommitteeAction(
  committeeId: string,
  input: unknown,
): Promise<ActionResult> {
  return run("committees.committee.update", (actor) =>
    done(committees.updateCommittee(actor, committeeId, input)),
  );
}

/* Meetings and agenda ------------------------------------------------------------- */

export async function createMeetingAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("committees.meeting.create", (actor) =>
    committees.createMeeting(actor, input),
  );
}

export async function updateMeetingAction(
  meetingId: string,
  input: unknown,
): Promise<ActionResult> {
  return run("committees.meeting.update", (actor) =>
    done(committees.updateMeeting(actor, meetingId, input)),
  );
}

export async function deleteMeetingAction(meetingId: string): Promise<ActionResult> {
  return run("committees.meeting.delete", (actor) =>
    done(committees.deleteMeeting(actor, meetingId)),
  );
}

export async function addAgendaItemAction(
  meetingId: string,
  input: unknown,
): Promise<ActionResult<AgendaItemDto>> {
  return run("committees.agenda.add", (actor) =>
    committees.addAgendaItem(actor, meetingId, input),
  );
}

export async function updateAgendaItemAction(
  itemId: string,
  input: unknown,
): Promise<ActionResult> {
  return run("committees.agenda.update", (actor) =>
    done(committees.updateAgendaItem(actor, itemId, input)),
  );
}

export async function removeAgendaItemAction(itemId: string): Promise<ActionResult> {
  return run("committees.agenda.remove", (actor) =>
    done(committees.removeAgendaItem(actor, itemId)),
  );
}

export async function moveAgendaItemAction(
  itemId: string,
  direction: "up" | "down",
): Promise<ActionResult> {
  return run("committees.agenda.move", (actor) =>
    done(committees.moveAgendaItem(actor, itemId, direction === "up" ? "up" : "down")),
  );
}

/* Tasks ------------------------------------------------------------------------------ */

export async function createTaskAction(
  meetingId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("committees.task.create", (actor) =>
    committees.createTask(actor, meetingId, input),
  );
}

export async function updateTaskAction(
  taskId: string,
  input: unknown,
): Promise<ActionResult> {
  return run("committees.task.update", (actor) =>
    done(committees.updateTask(actor, taskId, input)),
  );
}

export async function changeTaskStatusAction(
  taskId: string,
  input: unknown,
): Promise<ActionResult<ThreadEntry>> {
  return run("committees.task.status", (actor) =>
    committees.changeTaskStatus(actor, taskId, input),
  );
}

export async function replyToTaskAction(
  taskId: string,
  input: unknown,
): Promise<ActionResult<ThreadEntry>> {
  return run("committees.task.reply", (actor) =>
    committees.replyToTask(actor, taskId, input),
  );
}

export async function deleteTaskAction(
  taskId: string,
): Promise<ActionResult<{ meetingId: string }>> {
  return run("committees.task.delete", (actor) => committees.deleteTask(actor, taskId));
}
