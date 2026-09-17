"use server";

import { revalidatePath } from "next/cache";
import { isAppError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/platform/authz/authz";
import { getActor } from "@/platform/auth/current-user";
import { listDirectory } from "@/platform/iam/services/directory-service";
import { logger, newCorrelationId } from "@/platform/observability/logger";
import * as thinkTank from "../contracts/service";
import type { AssistantAnswer, CommentDto, PersonRef } from "../contracts/types";

/**
 * THE THINK TANK's Server Actions (CLAUDE.md §9): authenticate, delegate, and turn
 * the outcome into something a form can show. Services authorise and validate.
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
    if (options.revalidate !== false) revalidatePath("/innovation", "layout");
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
    logger.error("Think Tank action failed", {
      module: "innovation",
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

/* Files -------------------------------------------------------------------- */

export async function prepareUploadAction(input: {
  fileName: string;
  sizeBytes: number;
}): Promise<ActionResult<{ fileId: string; uploadUrl: string; contentType: string }>> {
  return run(
    "innovation.file.prepare",
    (actor) => thinkTank.prepareUpload(actor, input),
    {
      revalidate: false,
    },
  );
}

/* People ------------------------------------------------------------------- */

/** Active colleagues, for owner and team pickers; loaded when a form opens. */
export async function loadPeopleAction(): Promise<ActionResult<PersonRef[]>> {
  return run(
    "innovation.people.list",
    async (actor) =>
      (await listDirectory(actor)).map((person) => ({
        id: person.id,
        name: person.name,
      })),
    { revalidate: false },
  );
}

/* Ideas -------------------------------------------------------------------- */

export async function createIdeaAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("innovation.idea.create", (actor) => thinkTank.createIdea(actor, input));
}

export async function updateIdeaAction(
  ideaId: string,
  input: unknown,
): Promise<ActionResult> {
  return run("innovation.idea.update", async (actor) => {
    await thinkTank.updateIdea(actor, ideaId, input);
    return null;
  });
}

export async function updateOwnIdeaAction(
  ideaId: string,
  input: unknown,
): Promise<ActionResult> {
  return run("innovation.idea.update_own", async (actor) => {
    await thinkTank.updateOwnIdea(actor, ideaId, input);
    return null;
  });
}

export async function deleteIdeaAction(ideaId: string): Promise<ActionResult> {
  return run("innovation.idea.delete", async (actor) => {
    await thinkTank.deleteIdea(actor, ideaId);
    return null;
  });
}

export async function toggleVoteAction(
  ideaId: string,
): Promise<ActionResult<{ voted: boolean; voteCount: number }>> {
  return run("innovation.idea.vote", (actor) => thinkTank.toggleVote(actor, ideaId));
}

export async function addCommentAction(
  ideaId: string,
  input: unknown,
): Promise<ActionResult<CommentDto>> {
  return run("innovation.comment.add", (actor) =>
    thinkTank.addComment(actor, ideaId, input),
  );
}

export async function deleteCommentAction(commentId: string): Promise<ActionResult> {
  return run("innovation.comment.delete", async (actor) => {
    await thinkTank.deleteComment(actor, commentId);
    return null;
  });
}

export async function convertIdeaAction(
  ideaId: string,
): Promise<ActionResult<{ projectId: string }>> {
  return run("innovation.idea.convert", (actor) =>
    thinkTank.convertIdeaToProject(actor, ideaId),
  );
}

/* Knowledge ---------------------------------------------------------------- */

export async function createKnowledgeAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("innovation.knowledge.create", (actor) =>
    thinkTank.createKnowledgeItem(actor, input),
  );
}

export async function updateKnowledgeAction(
  itemId: string,
  input: unknown,
): Promise<ActionResult> {
  return run("innovation.knowledge.update", async (actor) => {
    await thinkTank.updateKnowledgeItem(actor, itemId, input);
    return null;
  });
}

export async function deleteKnowledgeAction(itemId: string): Promise<ActionResult> {
  return run("innovation.knowledge.delete", async (actor) => {
    await thinkTank.deleteKnowledgeItem(actor, itemId);
    return null;
  });
}

/* Projects ----------------------------------------------------------------- */

export async function createProjectAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("innovation.project.create", (actor) =>
    thinkTank.createProject(actor, input),
  );
}

export async function updateProjectAction(
  projectId: string,
  input: unknown,
): Promise<ActionResult> {
  return run("innovation.project.update", async (actor) => {
    await thinkTank.updateProject(actor, projectId, input);
    return null;
  });
}

export async function deleteProjectAction(projectId: string): Promise<ActionResult> {
  return run("innovation.project.delete", async (actor) => {
    await thinkTank.deleteProject(actor, projectId);
    return null;
  });
}

/* Categories --------------------------------------------------------------- */

export async function createCategoryAction(input: unknown): Promise<ActionResult> {
  return run("innovation.category.create", async (actor) => {
    await thinkTank.createCategory(actor, input);
    return null;
  });
}

export async function updateCategoryAction(
  categoryId: string,
  input: unknown,
): Promise<ActionResult> {
  return run("innovation.category.update", async (actor) => {
    await thinkTank.updateCategory(actor, categoryId, input);
    return null;
  });
}

/* Ask Think Tank ----------------------------------------------------------- */

export async function askThinkTankAction(
  question: string,
): Promise<ActionResult<AssistantAnswer>> {
  return run(
    "innovation.assistant.ask",
    (actor) => thinkTank.askThinkTank(actor, { question }),
    {
      revalidate: false,
    },
  );
}
