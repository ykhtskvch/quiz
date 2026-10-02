// Offboarding (EPIC 28) and question ratings (EPIC 29). Stored anonymously — never with a player id.

export const PLAY_AGAIN = ["YES", "MAYBE", "NO"] as const;
export type Intent = (typeof PLAY_AGAIN)[number];

export const DIFFICULTY_RATINGS = ["TOO_EASY", "JUST_RIGHT", "TOO_HARD"] as const;
export const PACE_RATINGS = ["TOO_SLOW", "JUST_RIGHT", "TOO_FAST"] as const;
/** BR-105: no "cringe" wording — framed as classic vs pop. */
export const BALANCE_RATINGS = ["MORE_CLASSIC", "JUST_RIGHT", "MORE_POP"] as const;
export const QUESTION_RATINGS = ["GREAT", "FINE", "BAD"] as const;

export type QuestionRating = (typeof QUESTION_RATINGS)[number];

export type SessionFeedbackInput = {
  /** The core KPI (BR-106, BR-115). */
  playAgain: Intent;
  differentGroup?: Intent;
  difficulty?: (typeof DIFFICULTY_RATINGS)[number];
  pace?: (typeof PACE_RATINGS)[number];
  culturalBalance?: (typeof BALANCE_RATINGS)[number];
};

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const oneOf = <T extends readonly string[]>(xs: T, v: unknown): v is T[number] => typeof v === "string" && xs.includes(v);

export function parseSessionFeedback(raw: unknown): Parsed<SessionFeedbackInput> {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!oneOf(PLAY_AGAIN, r.playAgain)) return { ok: false, error: "playAgain is required" };
  const value: SessionFeedbackInput = { playAgain: r.playAgain };
  const optional = [
    ["differentGroup", PLAY_AGAIN],
    ["difficulty", DIFFICULTY_RATINGS],
    ["pace", PACE_RATINGS],
    ["culturalBalance", BALANCE_RATINGS],
  ] as const;
  for (const [key, allowed] of optional) {
    if (r[key] === undefined || r[key] === null) continue;
    if (!oneOf(allowed, r[key])) return { ok: false, error: `invalid ${key}` };
    (value as Record<string, unknown>)[key] = r[key];
  }
  return { ok: true, value };
}

export function parseQuestionRating(raw: unknown): Parsed<{ number: number; rating: QuestionRating }> {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.number !== "number" || !Number.isInteger(r.number) || r.number < 1) return { ok: false, error: "invalid number" };
  if (!oneOf(QUESTION_RATINGS, r.rating)) return { ok: false, error: "invalid rating" };
  return { ok: true, value: { number: r.number, rating: r.rating } };
}
