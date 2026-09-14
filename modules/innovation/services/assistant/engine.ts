import type { Actor } from "@/platform/authz/authz";
import type { AnswerSource } from "../../contracts/types";

/**
 * The seam where Ask Think Tank's intelligence plugs in (CLAUDE.md §14).
 *
 * V1 ships a keyword engine: permission-filtered full-text search that returns
 * sources and no generated answer. Phase 3 adds an AI engine behind the same
 * interface — retrieval over embeddings, then a model answering from those sources
 * through `platform/ai` — and the UI already renders both. Whatever the engine, it
 * must retrieve ONLY what `rights` allows: filtering happens before retrieval,
 * never on the model's answer (§14.2).
 */

export type AnswerContext = {
  actor: Actor;
  rights: { knowledge: boolean; projects: boolean; ideas: boolean };
};

export type EngineResult = {
  answer: string | null;
  sources: AnswerSource[];
};

export interface AnswerEngine {
  readonly name: "keyword" | "ai";
  answer(question: string, context: AnswerContext): Promise<EngineResult>;
}
