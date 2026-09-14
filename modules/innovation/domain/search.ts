/**
 * Search input handling — pure.
 */

const MAX_TERMS = 6;
const MAX_QUESTION_TERMS = 8;

/** Words too common to find anything with, in English and Arabic. */
const STOP_WORDS = new Set([
  "a",
  "about",
  "all",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "i",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "should",
  "that",
  "the",
  "their",
  "there",
  "this",
  "to",
  "us",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
  "في",
  "من",
  "على",
  "عن",
  "إلى",
  "الى",
  "ما",
  "ماذا",
  "كيف",
  "هل",
  "مع",
  "هذا",
  "هذه",
  "التي",
  "الذي",
  "لقد",
  "كان",
  "تم",
  "أن",
  "ان",
]);

function wordsOf(input: string): string[] {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 0);
}

/**
 * Turns what someone typed into a Postgres prefix tsquery: "ocr deploy" becomes
 * "ocr:* & deploy:*", so partial words match and every word must appear. Only
 * letters and digits survive, in any script, which also makes the result safe to
 * pass to `to_tsquery` (it cannot contain operators). Returns null when nothing
 * searchable remains.
 */
export function toPrefixQuery(input: string | undefined | null): string | null {
  if (input === undefined || input === null) return null;
  const terms = wordsOf(input).slice(0, MAX_TERMS);
  return terms.length === 0 ? null : terms.map((term) => `${term}:*`).join(" & ");
}

/**
 * For a question in plain language — "How did we solve the OCR problem?" — ANY of
 * its meaningful words may match ("solve:* | ocr:* | problem:*"), and ranking puts
 * the items matching most of them first. Common words are dropped. Null when
 * nothing meaningful remains.
 */
export function toAnyWordQuery(input: string | undefined | null): string | null {
  if (input === undefined || input === null) return null;
  const terms = [
    ...new Set(wordsOf(input).filter((term) => term.length > 1 && !STOP_WORDS.has(term))),
  ].slice(0, MAX_QUESTION_TERMS);
  return terms.length === 0 ? null : terms.map((term) => `${term}:*`).join(" | ");
}

/** A one-line excerpt for lists. */
export function excerptOf(text: string | null, maxLength = 180): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength - 1)}…` : flat;
}
