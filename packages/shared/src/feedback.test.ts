import { describe, expect, it } from "vitest";
import { FEEDBACK_COMMENT_MAX, parseSessionFeedback } from "./feedback.ts";

describe("parseSessionFeedback", () => {
  it("needs only 'play again'; the rest is optional (P-08)", () => {
    expect(parseSessionFeedback({ playAgain: "YES" })).toEqual({ ok: true, value: { playAgain: "YES" } });
    expect(parseSessionFeedback({ difficulty: "TOO_EASY" })).toMatchObject({ ok: false });
    expect(parseSessionFeedback({ playAgain: "YES", pace: "WRONG" })).toMatchObject({ ok: false });
  });

  it("keeps a trimmed, length-capped comment and drops an empty one", () => {
    const long = "a".repeat(FEEDBACK_COMMENT_MAX + 50);
    expect(parseSessionFeedback({ playAgain: "MAYBE", comment: "  more   football  " })).toEqual({
      ok: true,
      value: { playAgain: "MAYBE", comment: "more football" },
    });
    expect(parseSessionFeedback({ playAgain: "NO", comment: long })).toMatchObject({ value: { comment: "a".repeat(FEEDBACK_COMMENT_MAX) } });
    expect(parseSessionFeedback({ playAgain: "NO", comment: "   " })).toEqual({ ok: true, value: { playAgain: "NO" } });
    expect(parseSessionFeedback({ playAgain: "NO", comment: 42 })).toMatchObject({ ok: false });
  });
});
