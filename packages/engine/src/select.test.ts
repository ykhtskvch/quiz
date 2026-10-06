import { describe, expect, it } from "vitest";
import { primaryTopic, type BankQuestion, type OnboardingInput } from "@quiz/shared";
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from "./config.ts";
import { aggregateProfile, playerProfile, type GroupProfile } from "./profile.ts";
import { seededRng } from "./rng.ts";
import { availableTopics, emptyCompositionState, nextQuestion, ratingFactor, registerLateJoin, type CompositionState } from "./select.ts";

const TOPIC_SPECS: { slug: string; dignity: number; local?: boolean }[] = [
  { slug: "space", dignity: 5 },
  { slug: "cold-war", dignity: 5 },
  { slug: "art", dignity: 5 },
  { slug: "geography", dignity: 4 },
  { slug: "cartoons", dignity: 3 },
  { slug: "food", dignity: 3 },
  { slug: "ru-pop-00s", dignity: 1, local: true },
  { slug: "football", dignity: 2 },
];

function makeBank(): BankQuestion[] {
  return TOPIC_SPECS.flatMap(({ slug, dignity, local }) =>
    Array.from({ length: 12 }, (_, i) => ({
      id: `${slug}-${i}`,
      factId: `${slug}-fact-${i}`,
      familyId: `${slug}-fam-${i % 4}`,
      language: "ru" as const,
      originLanguage: "ru" as const,
      cultureSpecificity: local ? ("LOCAL" as const) : ("GLOBAL" as const),
      isBridge: false,
      text: `${slug} ${i}?`,
      options: [
        { key: "A" as const, text: "a" },
        { key: "B" as const, text: "b" },
        { key: "C" as const, text: "c" },
        { key: "D" as const, text: "d" },
      ],
      correctKey: "B" as const,
      explanation: "…",
      topics: { [slug]: 1 },
      contexts: (local ? { POST_SOVIET: 1, RUSSIA_2000S: 1 } : { GLOBAL: 1 }) as Record<string, number>,
      generations: local ? { "00s": 1 } : {},
      difficulty: (i % 5) + 1,
      dignity,
      effects: {},
      ageSafety: "ALL" as const,
      status: "DRAFT" as const,
    })),
  );
}

const onb = (topics: Record<string, "EXPERT" | "INTERESTED">, extra: Partial<OnboardingInput> = {}): OnboardingInput => ({
  ageBand: "35_44",
  topics: Object.entries(topics).map(([slug, depth]) => ({ slug, preference: "LIKE", depth })),
  backgrounds: null,
  dignity: "BALANCE",
  ...extra,
});

function room(players: Record<string, OnboardingInput>): GroupProfile {
  return aggregateProfile(Object.entries(players).map(([id, o]) => playerProfile(id, o)));
}

function run(profile: GroupProfile, n: number, opts: { seed?: number; config?: Partial<EngineConfig>; bank?: BankQuestion[]; state?: CompositionState } = {}) {
  const bank = opts.bank ?? makeBank();
  const config = { ...DEFAULT_ENGINE_CONFIG, ...opts.config };
  const rng = seededRng(opts.seed ?? 1);
  const usedQ = new Set<string>();
  const usedF = new Set<string>();
  let state = opts.state ?? emptyCompositionState();
  const picks: { q: BankQuestion; hero: string | null; mode: string }[] = [];
  for (let i = 0; i < n; i++) {
    const r = nextQuestion({
      bank,
      profile,
      activePlayerIds: profile.players.map((p) => p.playerId),
      usedQuestionIds: usedQ,
      usedFactIds: usedF,
      state,
      config,
      rng,
    });
    if (!r) break;
    usedQ.add(r.question.id);
    usedF.add(r.question.factId);
    state = r.state;
    picks.push({ q: r.question, hero: r.debug.heroPlayerId, mode: r.debug.mode });
  }
  return { picks, state };
}

const fourExperts = () =>
  room({
    a: onb({ space: "EXPERT" }),
    b: onb({ "cold-war": "EXPERT" }),
    c: onb({ art: "EXPERT" }),
    d: onb({ cartoons: "EXPERT" }),
  });

describe("eligibility", () => {
  it("never repeats a question or a fact", () => {
    const { picks } = run(fourExperts(), 40);
    expect(new Set(picks.map((p) => p.q.id)).size).toBe(picks.length);
    expect(new Set(picks.map((p) => p.q.factId)).size).toBe(picks.length);
  });

  it("skips culture-specific questions when nobody in the room has that background", () => {
    const { picks } = run(fourExperts(), 40);
    expect(picks.some((p) => p.q.cultureSpecificity === "LOCAL")).toBe(false);
  });

  it("allows them when someone has the parent context (RUSSIA_2000S → POST_SOVIET)", () => {
    const profile = room({ a: onb({ "ru-pop-00s": "EXPERT" }, { backgrounds: ["POST_SOVIET"] }), b: onb({ space: "EXPERT" }) });
    const { picks } = run(profile, 20);
    expect(picks.some((p) => primaryTopic(p.q) === "ru-pop-00s")).toBe(true);
  });

  it("filters by language, drafts and explicit content", () => {
    const bank = makeBank().map((q, i) => ({ ...q, language: i % 2 ? ("en" as const) : ("ru" as const), ageSafety: i % 3 ? ("ALL" as const) : ("EXPLICIT_18" as const) }));
    const { picks } = run(fourExperts(), 30, { bank });
    expect(picks.every((p) => p.q.language === "ru" && p.q.ageSafety !== "EXPLICIT_18")).toBe(true);
    expect(run(fourExperts(), 5, { config: { allowDrafts: false } }).picks).toHaveLength(0);
  });

  it("returns null when the bank is exhausted", () => {
    const bank = makeBank().slice(0, 3);
    expect(run(fourExperts(), 10, { bank }).picks).toHaveLength(3);
  });
});

describe("availableTopics", () => {
  it("offers only topics with enough questions in the room language", () => {
    const bank = makeBank().map((q) => (q.topics.space ? { ...q, language: "en" as const } : q));
    expect(availableTopics(bank, { ...DEFAULT_ENGINE_CONFIG, language: "en" })).toEqual(["space"]);
    expect(availableTopics(bank, { ...DEFAULT_ENGINE_CONFIG, language: "ru" })).not.toContain("space");
    expect(availableTopics(bank, { ...DEFAULT_ENGINE_CONFIG, language: "en", allowDrafts: false })).toEqual([]);
  });
});

describe("sequence shape", () => {
  it("opens with questions no harder than medium for the room", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { picks } = run(fourExperts(), 3, { seed });
      for (const p of picks) expect(p.mode).toBe("opening");
      for (const p of picks) expect(p.q.difficulty).toBeLessThanOrEqual(3.5);
    }
  });

  it("keeps a family out of the next three questions and avoids triple topic streaks", () => {
    for (const seed of [1, 2, 3]) {
      const { picks } = run(fourExperts(), 30, { seed });
      for (let i = 1; i < picks.length; i++) {
        const recent = picks.slice(Math.max(0, i - 3), i).map((p) => p.q.familyId);
        expect(recent).not.toContain(picks[i].q.familyId);
      }
      for (let i = 2; i < picks.length; i++) {
        const t = picks.slice(i - 2, i + 1).map((p) => primaryTopic(p.q));
        expect(new Set(t).size).toBeGreaterThan(1);
      }
    }
  });

  it("is deterministic for a given seed", () => {
    const a = run(fourExperts(), 15, { seed: 42 }).picks.map((p) => p.q.id);
    const b = run(fourExperts(), 15, { seed: 42 }).picks.map((p) => p.q.id);
    expect(a).toEqual(b);
  });

  it("includes some wildcards outside everyone's interests", () => {
    const { picks } = run(fourExperts(), 25);
    const wild = picks.filter((p) => p.mode === "wildcard");
    expect(wild.length).toBeGreaterThan(0);
    for (const w of wild) expect(["space", "cold-war", "art", "cartoons"]).not.toContain(primaryTopic(w.q));
  });
});

describe("hero moments", () => {
  it("gives every player at least one hero candidate within 25 questions", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { picks } = run(fourExperts(), 25, { seed });
      const heroes = new Set(picks.map((p) => p.hero).filter(Boolean));
      expect([...heroes].sort()).toEqual(["a", "b", "c", "d"]);
    }
  });

  it("never aims two hero questions in a row at the same player, at most 3 each", () => {
    const { picks } = run(fourExperts(), 30);
    for (let i = 1; i < picks.length; i++) {
      if (picks[i].hero) expect(picks[i].hero).not.toBe(picks[i - 1].hero);
    }
    for (const id of ["a", "b", "c", "d"]) expect(picks.filter((p) => p.hero === id).length).toBeLessThanOrEqual(3);
  });

  it("delays a late joiner's hero boost by two questions (D-14)", () => {
    const profile = fourExperts();
    const start = run(profile, 5).state;
    const late = aggregateProfile([...profile.players, playerProfile("e", onb({ geography: "EXPERT" }))]);
    const { picks } = run(late, 2, { state: registerLateJoin(start, "e") });
    expect(picks.map((p) => p.hero)).not.toContain("e");
  });
});

describe("room preferences", () => {
  it("a pop-culture room gets more low-dignity questions than a classic one", () => {
    const shareLow = (dignity: OnboardingInput["dignity"]) => {
      let low = 0;
      let total = 0;
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const profile = room({
          a: onb({ football: "INTERESTED", art: "INTERESTED" }, { dignity, backgrounds: ["POST_SOVIET"] }),
          b: onb({ food: "INTERESTED", "cold-war": "INTERESTED" }, { dignity, backgrounds: ["POST_SOVIET"] }),
        });
        const { picks } = run(profile, 20, { seed });
        low += picks.filter((p) => p.q.dignity <= 2).length;
        total += picks.length;
      }
      return low / total;
    };
    expect(shareLow("POP")).toBeGreaterThan(shareLow("CLASSIC"));
  });

  it("favours shared interests over topics nobody picked", () => {
    const profile = room({ a: onb({ space: "INTERESTED" }), b: onb({ space: "INTERESTED" }), c: onb({ space: "INTERESTED" }) });
    const { picks } = run(profile, 20);
    const spaceShare = picks.filter((p) => primaryTopic(p.q) === "space").length / picks.length;
    expect(spaceShare).toBeGreaterThan(1 / 7); // more than a uniform share of the 7 eligible topics
  });
});

describe("editor rating (EPIC 38, L-09)", () => {
  const q = (editorRating?: number) => ({ ...makeBank()[0], editorRating });

  it("turns 1–5 stars into a gentle multiplier, neutral when unrated", () => {
    const f = (r?: number) => Math.round(ratingFactor(q(r), DEFAULT_ENGINE_CONFIG) * 100) / 100;
    expect([f(1), f(2), f(3), f(4), f(5), f(undefined)]).toEqual([0.7, 0.85, 1, 1.15, 1.3, 1]);
  });

  it("makes favourites come up more often than disliked ones, all else equal", () => {
    // Same bank, half the questions rated 5★ and half 1★ (alternating, so topics and difficulty are balanced).
    const bank = makeBank().map((x, i) => ({ ...x, editorRating: i % 2 ? 5 : 1 }));
    let fav = 0;
    let disliked = 0;
    for (let seed = 1; seed <= 60; seed++) {
      for (const p of run(fourExperts(), 10, { seed, bank }).picks) p.q.editorRating === 5 ? fav++ : disliked++;
    }
    expect(fav).toBeGreaterThan(disliked * 1.2);
    expect(disliked).toBeGreaterThan(0); // disliked ones still appear — nothing disappears
  });
});
