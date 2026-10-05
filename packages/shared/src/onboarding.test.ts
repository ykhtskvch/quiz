import { describe, expect, it } from "vitest";
import { MAX_LESS_TOPICS, MAX_LIKED_TOPICS, parseOnboarding } from "./onboarding.ts";
import { TOPICS } from "./taxonomy.generated.ts";

const base = { ageBand: "35_44", backgrounds: null, dignity: "BALANCE" };
const like = (slug: string) => ({ slug, preference: "LIKE", depth: "INTERESTED" });
const less = (slug: string) => ({ slug, preference: "LESS_OF" });
const slugs = TOPICS.map((t) => t.slug);

describe("onboarding limits (playtest 1)", () => {
  it("accepts up to 5 liked and 5 less-of topics", () => {
    const topics = [...slugs.slice(0, MAX_LIKED_TOPICS).map(like), ...slugs.slice(10, 10 + MAX_LESS_TOPICS).map(less)];
    expect(parseOnboarding({ ...base, topics }).ok).toBe(true);
  });

  it("rejects a sixth liked topic", () => {
    const r = parseOnboarding({ ...base, topics: slugs.slice(0, MAX_LIKED_TOPICS + 1).map(like) });
    expect(r).toMatchObject({ ok: false });
  });

  it("rejects a sixth less-of topic, so 'less of' can't be ticked for everything", () => {
    const r = parseOnboarding({ ...base, topics: [like(slugs[0]), ...slugs.slice(10, 11 + MAX_LESS_TOPICS).map(less)] });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("less of") });
  });
});
