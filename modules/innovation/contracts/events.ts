/**
 * Events published by THE THINK TANK (CLAUDE.md §10, §6.6). Payloads carry ids.
 * Votes and comments publish nothing: they are counted, not reacted to.
 */
export const INNOVATION_EVENTS = {
  /** { ideaId, categoryId } */
  IDEA_SUBMITTED: "innovation.IdeaSubmitted",
  /** { ideaId, from, to } */
  IDEA_STAGE_CHANGED: "innovation.IdeaStageChanged",
  /** { ideaId, projectId } */
  IDEA_CONVERTED_TO_PROJECT: "innovation.IdeaConvertedToProject",
  /** { knowledgeItemId, categoryId, projectId } */
  KNOWLEDGE_ADDED: "innovation.KnowledgeAdded",
  /** { projectId, ideaId } */
  PROJECT_CREATED: "innovation.ProjectCreated",
} as const;
