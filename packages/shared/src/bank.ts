// Playable question as the Composition Engine sees it — a flattened view of content/families
// (06-data-model §3). Generated into bank.generated.ts by scripts/dev/gen-shared.ts.
import type { OptionKey } from "./protocol.ts";

export type Era = "80s" | "90s" | "00s" | "10s" | "current";
export const ERAS: Era[] = ["80s", "90s", "00s", "10s", "current"];

export type QuestionStatus = "DRAFT" | "FACT_CHECKED" | "APPROVED" | "GOLD";

export type BankQuestion = {
  id: string;
  factId: string;
  familyId: string;
  language: "ru" | "en";
  originLanguage: "ru" | "en";
  cultureSpecificity: "GLOBAL" | "REGIONAL" | "LOCAL";
  isBridge: boolean;
  text: string;
  options: { key: OptionKey; text: string }[];
  correctKey: OptionKey;
  explanation: string;
  /** topic slug → weight 0–1; the heaviest is the primary topic. */
  topics: Record<string, number>;
  /** cultural context code → relevance 0–1. */
  contexts: Record<string, number>;
  generations: Partial<Record<Era, number>>;
  /** 1–5 for the question's own audience (Engine §8). */
  difficulty: number;
  /** 1–5, independent of difficulty (BR-043). */
  dignity: number;
  effects: Record<string, number>;
  ageSafety: "ALL" | "NON_EXPLICIT_ADULT" | "EXPLICIT_18";
  status: QuestionStatus;
  answerMs?: number;
};

export const primaryTopic = (q: BankQuestion): string =>
  Object.entries(q.topics).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

// The question data (with correct answers) is NOT re-exported here: the web client imports this
// package, and answers must never ship to browsers. Server code imports "@quiz/shared/bank-data".
