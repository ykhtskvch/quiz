// Game timing and scoring knobs (NFR-015). One place to tune after playtests.
export type GameConfig = {
  minPlayers: number;
  presentation: { minMs: number; perCharMs: number; maxMs: number };
  answerMs: number;
  revealMs: number;
  /** Pause between a skipped question and the next one. */
  skipGapMs: number;
  /** How long a disconnected player still counts as active (BR-075). */
  disconnectGraceMs: number;
  softEndAfterMs: number;
  roomExpiryMs: number;
  baseScore: number;
  speedBonusMax: number;
  /** Below this many active players, single-person stats are hidden (BR-129). */
  singlePersonStatsMinPlayers: number;
};

export const DEFAULT_CONFIG: GameConfig = {
  minPlayers: 2,
  presentation: { minMs: 2500, perCharMs: 35, maxMs: 7000 },
  answerMs: 15_000,
  revealMs: 10_000,
  skipGapMs: 1500,
  disconnectGraceMs: 25_000,
  softEndAfterMs: 30 * 60_000,
  roomExpiryMs: 6 * 60 * 60_000,
  baseScore: 1000,
  speedBonusMax: 150,
  singlePersonStatsMinPlayers: 4,
};
