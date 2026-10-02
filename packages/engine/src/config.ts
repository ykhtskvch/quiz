// Composition Engine knobs (05-composition-engine; NFR-015). Starting hypotheses — tune with the simulator and playtests.

export type DifficultyBand = "easy" | "medium" | "hard" | "specialist";
export type DignityBand = "high" | "mid" | "low" | "rubbish"; // 4–5 | 3 | 2 | 1

export type EngineConfig = {
  language: "ru" | "en";
  /** Until C2 the bank is all DRAFT; production must run with false. */
  allowDrafts: boolean;
  /** Explicit 18+ content is not used in the MVP at all (guideline §4). */
  allowExplicit: boolean;
  windowSize: number;
  /** Engine §6 candidate score. */
  weights: {
    shared: number;
    minority: number;
    hero: number;
    cultural: number;
    generation: number;
    difficulty: number;
    dignity: number;
    quality: number;
  };
  /** How player affinity combines topic, culture and generation match (Engine §5). */
  affinityMix: { topic: number; culture: number; generation: number };
  /** A question is a Hero candidate for a player at or above this affinity. */
  heroThreshold: number;
  /** hero_need multiplier after a player gets a Hero candidate. */
  heroDecay: number;
  maxHeroPerPlayer: number;
  /** D-14: late joiners wait this many questions before a Hero boost… */
  lateJoinHeroDelay: number;
  /** …and get at most one Hero candidate per this many questions. */
  lateJoinHeroWindow: number;
  openingCount: number;
  openingMaxDifficulty: number;
  wildcardShare: number;
  /** D-07: room difficulty = global − coef × share of players with a match. */
  roomDifficultyCoef: number;
  /** Same family may not reappear within this many questions (BR-094). */
  familyGap: number;
  difficultyTargets: Record<DifficultyBand, number>;
  /** Engine §9 — dignity distribution by room median (4 classic / 3 balance / 2 pop). */
  dignityTargets: Record<2 | 3 | 4, Record<DignityBand, number>>;
};

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  language: "ru",
  allowDrafts: true,
  allowExplicit: false,
  windowSize: 15,
  weights: { shared: 0.3, minority: 0.15, hero: 0.1, cultural: 0.1, generation: 0.1, difficulty: 0.1, dignity: 0.05, quality: 0.1 },
  affinityMix: { topic: 0.6, culture: 0.25, generation: 0.15 },
  heroThreshold: 0.75,
  heroDecay: 0.4,
  maxHeroPerPlayer: 3,
  lateJoinHeroDelay: 2,
  lateJoinHeroWindow: 5,
  openingCount: 3,
  openingMaxDifficulty: 3,
  wildcardShare: 0.15,
  roomDifficultyCoef: 0.5,
  familyGap: 3,
  difficultyTargets: { easy: 0.2, medium: 0.4, hard: 0.28, specialist: 0.12 },
  dignityTargets: {
    4: { high: 0.35, mid: 0.35, low: 0.2, rubbish: 0.1 },
    3: { high: 0.2, mid: 0.35, low: 0.3, rubbish: 0.15 },
    2: { high: 0.1, mid: 0.2, low: 0.35, rubbish: 0.35 },
  },
};
