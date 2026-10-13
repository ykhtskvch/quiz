import { describe, expect, it } from "vitest";
import { SEEN_FACTS_MAX } from "@quiz/shared";
import { seenFacts } from "./seen.ts";

describe("seenFacts", () => {
  it("keeps fact slugs and drops anything else", () => {
    expect(seenFacts(["nirvana-aberdeen", "Bad Id", 42, "x".repeat(81), "pepsi-challenge", "nirvana-aberdeen"])).toEqual([
      "nirvana-aberdeen",
      "pepsi-challenge",
    ]);
    expect(seenFacts("nirvana-aberdeen")).toEqual([]);
    expect(seenFacts(undefined)).toEqual([]);
  });

  it("keeps the newest when the list is too long", () => {
    const ids = Array.from({ length: SEEN_FACTS_MAX + 5 }, (_, i) => `fact-${i}`);
    const kept = seenFacts(ids);
    expect(kept).toHaveLength(SEEN_FACTS_MAX);
    expect(kept[0]).toBe("fact-5");
  });
});
