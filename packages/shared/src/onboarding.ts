// Private onboarding answers (BR-018…025, BR-047, BR-128). Never broadcast; only the owner sees them.
import { TOPICS } from "./taxonomy.ts";

export const AGE_BANDS = ["13_17", "18_24", "25_34", "35_44", "45_54", "55_PLUS"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const DEPTHS = ["CASUAL", "INTERESTED", "EXPERT"] as const;
export type Depth = (typeof DEPTHS)[number];

/** D-13: three player-facing choices mapped to the internal 1–5 scale. */
export const DIGNITY_CHOICES = { CLASSIC: 4, BALANCE: 3, POP: 2 } as const;
export type DignityChoice = keyof typeof DIGNITY_CHOICES;

/** Cultural background cards (08-topics §4). */
export const BACKGROUND_CONTEXTS = ["POST_SOVIET", "UK", "US", "EUROPE", "ASIA"] as const;
export type BackgroundContext = (typeof BACKGROUND_CONTEXTS)[number];

export type TopicPreference = { slug: string; preference: "LIKE"; depth: Depth } | { slug: string; preference: "LESS_OF" };

export type OnboardingInput = {
  ageBand: AgeBand;
  topics: TopicPreference[];
  /** `null` = step skipped; the server infers contexts from liked topics. */
  backgrounds: BackgroundContext[] | null;
  dignity: DignityChoice;
};

export const MAX_LIKED_TOPICS = 12;

const topicSlugs = new Set(TOPICS.map((t) => t.slug));

/** Validates untrusted input; returns a normalized copy or an error message. */
export function parseOnboarding(raw: unknown): { ok: true; value: OnboardingInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "body required" };
  const r = raw as Record<string, unknown>;

  if (!AGE_BANDS.includes(r.ageBand as AgeBand)) return { ok: false, error: "invalid ageBand" };
  if (!(typeof r.dignity === "string" && r.dignity in DIGNITY_CHOICES)) return { ok: false, error: "invalid dignity" };

  if (!Array.isArray(r.topics)) return { ok: false, error: "topics must be an array" };
  const seen = new Set<string>();
  const topics: TopicPreference[] = [];
  for (const t of r.topics as Record<string, unknown>[]) {
    const slug = t?.slug;
    if (typeof slug !== "string" || !topicSlugs.has(slug)) return { ok: false, error: `unknown topic ${String(slug)}` };
    if (seen.has(slug)) return { ok: false, error: `duplicate topic ${slug}` };
    seen.add(slug);
    if (t.preference === "LIKE") {
      if (!DEPTHS.includes(t.depth as Depth)) return { ok: false, error: `invalid depth for ${slug}` };
      topics.push({ slug, preference: "LIKE", depth: t.depth as Depth });
    } else if (t.preference === "LESS_OF") {
      topics.push({ slug, preference: "LESS_OF" });
    } else {
      return { ok: false, error: `invalid preference for ${slug}` };
    }
  }
  const liked = topics.filter((t) => t.preference === "LIKE").length;
  if (liked === 0) return { ok: false, error: "pick at least one topic" };
  if (liked > MAX_LIKED_TOPICS) return { ok: false, error: `at most ${MAX_LIKED_TOPICS} topics` };

  let backgrounds: BackgroundContext[] | null = null;
  if (r.backgrounds !== null && r.backgrounds !== undefined) {
    if (!Array.isArray(r.backgrounds) || !r.backgrounds.every((b) => BACKGROUND_CONTEXTS.includes(b as BackgroundContext))) {
      return { ok: false, error: "invalid backgrounds" };
    }
    backgrounds = [...new Set(r.backgrounds as BackgroundContext[])];
    if (backgrounds.length === 0) backgrounds = null; // empty selection behaves like skipping
  }

  return { ok: true, value: { ageBand: r.ageBand as AgeBand, topics, backgrounds, dignity: r.dignity as DignityChoice } };
}
