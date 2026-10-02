// Group Profile Engine (EPIC 5): turns private onboarding answers into the room profile the
// Composition Engine reads. Pure; the result never leaves the backend (BR-013, Engine §18).
import { DIGNITY_CHOICES, ERAS, TOPICS, type AgeBand, type Depth, type Era, type OnboardingInput } from "@quiz/shared";

/** Engine §5 — topic match values. Starting points for playtests, not final. */
export const TOPIC_AFFINITY = { EXPERT: 1.0, INTERESTED: 0.8, CASUAL: 0.6, NONE: 0.3, LESS_OF: 0.1 } as const;
const DECLARED_STRENGTH = 1.0;
const INFERRED_STRENGTH = 0.7;
const SHARED_TOP_SHARE = 0.6;

/** Eras a player grew up in (≈ ages 10–20), as of 2026. Primary 1.0, adjacent 0.5. */
const ERAS_BY_AGE: Record<AgeBand, Partial<Record<Era, number>>> = {
  "13_17": { current: 1.0, "10s": 0.5 },
  "18_24": { "10s": 1.0, current: 0.5 },
  "25_34": { "00s": 1.0, "10s": 0.5 },
  "35_44": { "90s": 1.0, "00s": 0.5 },
  "45_54": { "80s": 1.0, "90s": 0.5 },
  "55_PLUS": { "80s": 1.0 },
};

export type PlayerProfile = {
  playerId: string;
  ageBand: AgeBand;
  eras: Partial<Record<Era, number>>;
  /** Affinity 0–1 for every taxonomy topic. */
  topics: Record<string, number>;
  /** Cultural context → strength; declared 1.0, inferred 0.7. GLOBAL is implicit. */
  contexts: Record<string, number>;
  contextsInferred: boolean;
  dignity: number;
};

export type GroupProfile = {
  players: PlayerProfile[];
  /** Mean of the top 60 % of player affinities per topic (Engine §6 SharedScore). */
  topicWeights: Record<string, number>;
  /** Mean strength per context across players. */
  contextWeights: Record<string, number>;
  generationMix: Partial<Record<Era, number>>;
  /** Median of player choices, 1–5 (BR-047). */
  dignityTarget: number;
  minorPresent: boolean;
};

export function playerProfile(playerId: string, o: OnboardingInput): PlayerProfile {
  const prefs = new Map(o.topics.map((t) => [t.slug, t]));
  const topics: Record<string, number> = {};
  for (const t of TOPICS) {
    const p = prefs.get(t.slug);
    topics[t.slug] = !p ? TOPIC_AFFINITY.NONE : p.preference === "LESS_OF" ? TOPIC_AFFINITY.LESS_OF : TOPIC_AFFINITY[p.depth as Depth];
  }

  const contexts: Record<string, number> = {};
  if (o.backgrounds) {
    for (const c of o.backgrounds) contexts[c] = DECLARED_STRENGTH;
  } else {
    // D-01: infer from liked topics, with lower confidence.
    for (const t of o.topics) {
      if (t.preference !== "LIKE") continue;
      const implied = TOPICS.find((x) => x.slug === t.slug)?.impliedContext;
      if (implied) contexts[implied] = INFERRED_STRENGTH;
    }
  }

  return {
    playerId,
    ageBand: o.ageBand,
    eras: ERAS_BY_AGE[o.ageBand],
    topics,
    contexts,
    contextsInferred: !o.backgrounds,
    dignity: DIGNITY_CHOICES[o.dignity],
  };
}

export function aggregateProfile(players: PlayerProfile[]): GroupProfile {
  const n = players.length;
  const topicWeights: Record<string, number> = {};
  for (const t of TOPICS) {
    const affinities = players.map((p) => p.topics[t.slug]).sort((a, b) => b - a);
    const top = affinities.slice(0, Math.max(1, Math.ceil(n * SHARED_TOP_SHARE)));
    topicWeights[t.slug] = n ? round(mean(top)) : 0;
  }

  const contextWeights: Record<string, number> = {};
  for (const code of new Set(players.flatMap((p) => Object.keys(p.contexts)))) {
    contextWeights[code] = round(mean(players.map((p) => p.contexts[code] ?? 0)));
  }

  const generationMix: Partial<Record<Era, number>> = {};
  for (const era of ERAS) {
    const w = mean(players.map((p) => p.eras[era] ?? 0));
    if (w > 0) generationMix[era] = round(w);
  }

  return {
    players,
    topicWeights,
    contextWeights,
    generationMix,
    dignityTarget: median(players.map((p) => p.dignity)),
    minorPresent: players.some((p) => p.ageBand === "13_17"),
  };
}

function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function median(xs: number[]) {
  if (!xs.length) return 3;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round(x: number) {
  return Math.round(x * 1000) / 1000;
}
