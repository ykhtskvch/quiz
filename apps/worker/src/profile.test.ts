import { describe, expect, it } from "vitest";
import type { OnboardingInput } from "@quiz/shared";
import { aggregateProfile, playerProfile } from "./profile.ts";

const base: OnboardingInput = { ageBand: "35_44", topics: [], backgrounds: null, dignity: "BALANCE" };
const likes = (...slugs: string[]) => slugs.map((slug) => ({ slug, preference: "LIKE" as const, depth: "INTERESTED" as const }));

describe("playerProfile", () => {
  it("maps preferences to affinities", () => {
    const p = playerProfile("a", {
      ...base,
      topics: [
        { slug: "space", preference: "LIKE", depth: "EXPERT" },
        { slug: "football", preference: "LESS_OF" },
      ],
    });
    expect(p.topics.space).toBe(1);
    expect(p.topics.football).toBe(0.1);
    expect(p.topics.cartoons).toBe(0.3);
  });

  it("infers cultural context from liked topics when the step is skipped (D-01)", () => {
    const p = playerProfile("a", { ...base, topics: likes("ru-pop-00s", "space") });
    expect(p.contexts).toEqual({ POST_SOVIET: 0.7 });
    expect(p.contextsInferred).toBe(true);
  });

  it("uses declared backgrounds at full strength and ignores inference", () => {
    const p = playerProfile("a", { ...base, topics: likes("ru-pop-00s"), backgrounds: ["UK"] });
    expect(p.contexts).toEqual({ UK: 1 });
    expect(p.contextsInferred).toBe(false);
  });

  it("maps the dignity choice to the internal scale (D-13)", () => {
    expect(playerProfile("a", { ...base, topics: likes("space"), dignity: "POP" }).dignity).toBe(2);
    expect(playerProfile("a", { ...base, topics: likes("space"), dignity: "CLASSIC" }).dignity).toBe(4);
  });
});

describe("aggregateProfile", () => {
  it("one 'less of' does not sink a topic the others love (top 60 %)", () => {
    const fans = [1, 2, 3, 4].map((i) => playerProfile(`p${i}`, { ...base, topics: [{ slug: "cold-war", preference: "LIKE", depth: "EXPERT" }] }));
    const hater = playerProfile("h", { ...base, topics: [...likes("space"), { slug: "cold-war", preference: "LESS_OF" }] });
    const room = aggregateProfile([...fans, hater]);
    expect(room.topicWeights["cold-war"]).toBe(1);
  });

  it("takes the median dignity and flags minors", () => {
    const room = aggregateProfile([
      playerProfile("a", { ...base, topics: likes("space"), dignity: "POP" }),
      playerProfile("b", { ...base, topics: likes("space"), dignity: "POP" }),
      playerProfile("c", { ...base, topics: likes("space"), dignity: "CLASSIC", ageBand: "13_17" }),
    ]);
    expect(room.dignityTarget).toBe(2);
    expect(room.minorPresent).toBe(true);
  });

  it("keeps a single teenager visible in the generation mix", () => {
    const adults = [1, 2, 3, 4, 5].map((i) => playerProfile(`a${i}`, { ...base, topics: likes("space") }));
    const teen = playerProfile("t", { ...base, ageBand: "13_17", topics: likes("videogames") });
    const room = aggregateProfile([...adults, teen]);
    expect(room.generationMix["90s"]).toBeCloseTo(5 / 6, 2);
    expect(room.generationMix.current).toBeGreaterThan(0);
  });

  it("averages context strength across the room", () => {
    const room = aggregateProfile([
      playerProfile("a", { ...base, topics: likes("space"), backgrounds: ["POST_SOVIET"] }),
      playerProfile("b", { ...base, topics: likes("space"), backgrounds: ["UK"] }),
    ]);
    expect(room.contextWeights).toEqual({ POST_SOVIET: 0.5, UK: 0.5 });
  });
});
