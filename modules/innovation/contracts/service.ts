/**
 * THE THINK TANK's public service surface (CLAUDE.md §4). Every function checks
 * its own permission; callers pass an `Actor` and trust nothing else.
 */

export {
  createCategory,
  listCategories,
  updateCategory,
} from "../services/category-service";

export {
  getFileLink,
  isFileStorageAvailable,
  prepareUpload,
} from "../services/file-service";

export {
  addComment,
  convertIdeaToProject,
  createIdea,
  deleteComment,
  deleteIdea,
  getIdea,
  listIdeas,
  toggleVote,
  updateIdea,
} from "../services/idea-service";

export {
  createKnowledgeItem,
  deleteKnowledgeItem,
  getKnowledgeItem,
  listKnowledge,
  updateKnowledgeItem,
} from "../services/knowledge-service";

export {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "../services/project-service";

export { getOverview } from "../services/overview-service";

export { askThinkTank } from "../services/assistant-service";
