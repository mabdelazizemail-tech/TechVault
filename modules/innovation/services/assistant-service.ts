import { type Actor, canAll, requirePermission } from "@/platform/authz/authz";
import { INNOVATION_PERMISSIONS } from "../contracts/permissions";
import { askSchema } from "../contracts/schemas";
import type { AssistantAnswer } from "../contracts/types";
import type { AnswerEngine } from "./assistant/engine";
import { keywordEngine } from "./assistant/keyword-engine";
import { parseInput } from "./support";

/**
 * Ask Think Tank. Checks the permission, works out what the asker may read, and
 * hands the question to the active engine — which retrieves only within those
 * rights.
 */

/** Phase 3 selects the AI engine here, from configuration. */
function activeEngine(): AnswerEngine {
  return keywordEngine;
}

export async function askThinkTank(
  actor: Actor,
  rawInput: unknown,
): Promise<AssistantAnswer> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.ASSISTANT_ACCESS);
  const { question } = parseInput(askSchema, rawInput, "Ask a question first.");

  const rights = await canAll(actor, [
    INNOVATION_PERMISSIONS.KNOWLEDGE_READ,
    INNOVATION_PERMISSIONS.PROJECT_READ,
    INNOVATION_PERMISSIONS.IDEA_READ,
  ]);

  const engine = activeEngine();
  const result = await engine.answer(question, {
    actor,
    rights: {
      knowledge: rights[INNOVATION_PERMISSIONS.KNOWLEDGE_READ] === true,
      projects: rights[INNOVATION_PERMISSIONS.PROJECT_READ] === true,
      ideas: rights[INNOVATION_PERMISSIONS.IDEA_READ] === true,
    },
  });

  return { question, ...result, engine: engine.name };
}
