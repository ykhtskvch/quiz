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
  /** A game is this many questions long (playtest 1: players need to see their progress). */
  questionsPerGame: number;
  /**
   * Points for a correct answer by how much of the answer time was used: up to `fastUpTo` of it →
   * `fast`, up to `midUpTo` → `mid`, later → `late`. Wrong or no answer → 0. Small, visible numbers.
   */
  points: { fast: number; mid: number; late: number; fastUpTo: number; midUpTo: number };
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
  questionsPerGame: 20,
  points: { fast: 3, mid: 2, late: 1, fastUpTo: 0.5, midUpTo: 0.75 },
  singlePersonStatsMinPlayers: 4,
};

/** Points for one answer (see GameConfig.points). */
export function pointsFor(config: GameConfig, correct: boolean, responseMs: number, answerMs: number): number {
  if (!correct) return 0;
  const used = answerMs > 0 ? responseMs / answerMs : 1;
  const p = config.points;
  return used <= p.fastUpTo ? p.fast : used <= p.midUpTo ? p.mid : p.late;
}
