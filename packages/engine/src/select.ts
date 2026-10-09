// Composition Engine (05-composition-engine): greedy next-question selection (D-05).
// filter → score → boosts/penalties → top-N window → weighted random → update state.
import { primaryTopic, type BankQuestion } from "@quiz/shared";
import { affinity, hasCulturalHost, type Affinity } from "./affinity.ts";
import type { DifficultyBand, DignityBand, EngineConfig } from "./config.ts";
import type { GroupProfile, PlayerProfile } from "./profile.ts";

export type HistoryEntry = {
  questionId: string;
  familyId: string;
  /** What the question is about (a band, a brand, a show); optional in rooms saved before 09.10. */
  subject?: string | null;
  topic: string;
  /** Strongest non-GLOBAL context, if any. */
  context: string | null;
  band: DifficultyBand;
  dignityBand: DignityBand;
  wildcard: boolean;
  heroPlayerId: string | null;
};

/** Per-game engine memory (T-07); persisted with the room. */
export type CompositionState = {
  history: HistoryEntry[];
  heroNeed: Record<string, number>;
  heroCount: Record<string, number>;
  lastHeroIndex: Record<string, number>;
  /** Index of the first question a late joiner could see (D-14). */
  joinedAtIndex: Record<string, number>;
  /** Share of correct answers per revealed question, most recent last. */
  accuracy: number[];
};

export const emptyCompositionState = (): CompositionState => ({
  history: [],
  heroNeed: {},
  heroCount: {},
  lastHeroIndex: {},
  joinedAtIndex: {},
  accuracy: [],
});

export type SelectionInput = {
  bank: BankQuestion[];
  profile: GroupProfile;
  /** Players who will see this question (onboarded and active). */
  activePlayerIds: string[];
  usedQuestionIds: ReadonlySet<string>;
  usedFactIds: ReadonlySet<string>;
  state: CompositionState;
  config: EngineConfig;
  rng: () => number;
};

export type ScoreComponents = {
  shared: number;
  minority: number;
  hero: number;
  cultural: number;
  generation: number;
  difficulty: number;
  dignity: number;
  quality: number;
};

/** Backend/debug only — names who a question was aimed at, so it must never reach players (Engine §18). */
export type SelectionDebug = {
  mode: "opening" | "normal" | "wildcard";
  score: number;
  components: ScoreComponents;
  penalty: number;
  roomDifficulty: number;
  band: DifficultyBand;
  heroPlayerId: string | null;
  eligible: number;
  window: number;
};

export type Selection = { question: BankQuestion; debug: SelectionDebug; state: CompositionState };

type Candidate = {
  q: BankQuestion;
  affinities: Affinity[];
  roomDifficulty: number;
  band: DifficultyBand;
  dignityBand: DignityBand;
  context: string | null;
  components: ScoreComponents;
  heroPlayerId: string | null;
  penalty: number;
  score: number;
};

const QUALITY: Record<BankQuestion["status"], number> = { GOLD: 1, APPROVED: 0.7, FACT_CHECKED: 0.6, DRAFT: 0.5 };

/** Multiplier from the editor's 1–5 rating (EngineConfig.editorRatingBoost); 1 when unrated. */
export function ratingFactor(q: BankQuestion, config: EngineConfig): number {
  return q.editorRating ? Math.max(0, 1 + config.editorRatingBoost * (q.editorRating - 3)) : 1;
}

export function difficultyBand(d: number): DifficultyBand {
  return d < 2.5 ? "easy" : d < 3.5 ? "medium" : d < 4.5 ? "hard" : "specialist";
}

export function dignityBand(d: number): DignityBand {
  return d >= 4 ? "high" : d >= 3 ? "mid" : d >= 2 ? "low" : "rubbish";
}

/** Engine §6 SharedScore: mean of the top 60 % — one dissenter doesn't sink a question. */
function topShareMean(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(xs.length * 0.6)));
  return s.reduce((a, b) => a + b, 0) / s.length;
}

function strongestContext(q: BankQuestion): string | null {
  const entries = Object.entries(q.contexts).filter(([c]) => c !== "GLOBAL").sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] ?? null;
}

/** How under-represented a band is so far, relative to its target share (soft goal, D-06). */
function deficitFit<B extends string>(band: B, targets: Record<B, number>, history: B[]): number {
  const share = history.length ? history.filter((b) => b === band).length / history.length : 0;
  return Math.max(0, Math.min(1, 0.5 + (targets[band] - share) * 2));
}

/** Engine §14: small steering toward harder/easier questions from recent accuracy. */
function adaptedDifficultyTargets(config: EngineConfig, accuracy: number[]): Record<DifficultyBand, number> {
  const recent = accuracy.slice(-5);
  const t = { ...config.difficultyTargets };
  if (recent.length < 3) return t;
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  // Steer back into the 05-engine target band (accuracy 50–70 %).
  const shift = mean > 0.7 ? 0.08 : mean < 0.5 ? -0.08 : 0;
  t.easy = Math.max(0, t.easy - shift);
  t.medium = Math.max(0, t.medium - shift / 2);
  t.hard += shift / 2;
  t.specialist += shift;
  return t;
}

function dignityTargetsFor(config: EngineConfig, median: number): Record<DignityBand, number> {
  const key = median >= 3.5 ? 4 : median >= 2.5 ? 3 : 2;
  return config.dignityTargets[key];
}

export function nextQuestion(input: SelectionInput): Selection | null {
  const { bank, profile, state, config, rng } = input;
  const index = state.history.length;
  const players: PlayerProfile[] = profile.players.filter((p) => input.activePlayerIds.includes(p.playerId));
  if (players.length === 0) return null;

  // ---------- 1. eligibility (hard) ----------
  const recentFamilies = new Set(state.history.slice(-config.familyGap).map((h) => h.familyId));
  const eligible = bank.filter(
    (q) =>
      q.language === config.language &&
      (config.allowDrafts || q.status === "APPROVED" || q.status === "GOLD") &&
      !input.usedQuestionIds.has(q.id) &&
      !input.usedFactIds.has(q.factId) &&
      (config.allowExplicit ? !(profile.minorPresent && q.ageSafety === "EXPLICIT_18") : q.ageSafety !== "EXPLICIT_18") &&
      hasCulturalHost(players, q),
  );
  if (eligible.length === 0) return null;

  // ---------- 2–3. score every candidate ----------
  const diffTargets = adaptedDifficultyTargets(config, state.accuracy);
  const dignTargets = dignityTargetsFor(config, profile.dignityTarget);
  const bandHistory = state.history.map((h) => h.band);
  const dignityHistory = state.history.map((h) => h.dignityBand);
  const last = state.history.at(-1);
  const prev = state.history.at(-2);

  const heroEligible = (playerId: string) => {
    if ((state.heroCount[playerId] ?? 0) >= config.maxHeroPerPlayer) return false;
    const lastHero = state.lastHeroIndex[playerId];
    if (lastHero !== undefined && index - lastHero < 2) return false; // never two in a row for one player
    const joined = state.joinedAtIndex[playerId];
    if (joined !== undefined) {
      if (index < joined + config.lateJoinHeroDelay) return false;
      if (lastHero !== undefined && index - lastHero < config.lateJoinHeroWindow) return false;
    }
    return true;
  };

  const score = (q: BankQuestion): Candidate => {
    const affinities = players.map((p) => affinity(p, q, config.affinityMix));
    const totals = affinities.map((a) => a.total);

    // D-07: a question gets easier for this room the more players have a match.
    const matched = affinities.filter((a) => a.topic >= 0.6 || a.culture >= 0.7).length / players.length;
    const roomDifficulty = Math.max(1, Math.min(5, q.difficulty - config.roomDifficultyCoef * matched));
    const band = difficultyBand(roomDifficulty);
    const dBand = dignityBand(q.dignity);

    let hero = 0;
    let heroPlayerId: string | null = null;
    players.forEach((p, i) => {
      if (totals[i] < config.heroThreshold || !heroEligible(p.playerId)) return;
      const v = (state.heroNeed[p.playerId] ?? 1) * totals[i];
      if (v > hero) {
        hero = v;
        heroPlayerId = p.playerId;
      }
    });

    const components: ScoreComponents = {
      shared: topShareMean(totals),
      minority: Math.max(...totals),
      hero,
      cultural: topShareMean(affinities.map((a) => a.culture)),
      generation: topShareMean(affinities.map((a) => a.generation)),
      difficulty: deficitFit(band, diffTargets, bandHistory),
      dignity: deficitFit(dBand, dignTargets, dignityHistory),
      quality: QUALITY[q.status],
    };
    const w = config.weights;
    const raw =
      w.shared * components.shared +
      w.minority * components.minority +
      w.hero * components.hero +
      w.cultural * components.cultural +
      w.generation * components.generation +
      w.difficulty * components.difficulty +
      w.dignity * components.dignity +
      w.quality * components.quality;

    // ---------- diversity penalties (Engine §12) ----------
    const topic = primaryTopic(q);
    const context = strongestContext(q);
    let penalty = 1;
    if (last?.topic === topic) penalty *= prev?.topic === topic ? 0.25 : 0.5;
    if (context && last?.context === context && prev?.context === context) penalty *= 0.6;
    const hardRun = state.history.slice(-2).filter((h) => h.band === "hard" || h.band === "specialist").length;
    if (hardRun === 2 && (band === "hard" || band === "specialist")) penalty *= 0.7;
    if (recentFamilies.has(q.familyId)) penalty *= 0.05;

    return { q, affinities, roomDifficulty, band, dignityBand: dBand, context, components, heroPlayerId, penalty, score: raw * penalty * ratingFactor(q, config) };
  };

  let candidates = eligible.map(score);

  // One question per subject per game (owner, 09.10: two blink-182 questions in one round). Families
  // are too broad for this (all of pop-punk is one), so facts name their subject. Only relaxed when
  // nothing else is left.
  const usedSubjects = new Set(state.history.map((h) => h.subject).filter(Boolean));
  const fresh = candidates.filter((c) => !c.q.subject || !usedSubjects.has(c.q.subject));
  if (fresh.length) candidates = fresh;

  // ---------- 4. mode: opening / wildcard / normal ----------
  let mode: SelectionDebug["mode"] = "normal";
  if (index < config.openingCount) {
    // Engine §22: open with something recognisable, not an extreme niche.
    const opening = candidates.filter(
      (c) => c.roomDifficulty <= config.openingMaxDifficulty && (c.q.cultureSpecificity !== "LOCAL" || c.components.cultural >= 0.7),
    );
    if (opening.length) {
      candidates = opening;
      mode = "opening";
    }
  } else {
    const wildcards = state.history.filter((h) => h.wildcard).length;
    if (wildcards / index < config.wildcardShare && rng() < 0.5) {
      // Engine §16: outside declared interests, accessible, no narrow background required.
      const pool = candidates.filter(
        (c) => Math.max(...c.affinities.map((a) => a.topic)) <= 0.35 && c.roomDifficulty <= 3.5 && c.q.cultureSpecificity !== "LOCAL",
      );
      if (pool.length) {
        candidates = pool.map((c) => ({
          ...c,
          heroPlayerId: null,
          score: (0.4 * c.components.quality + 0.3 * c.components.difficulty + 0.3 * c.components.cultural) * c.penalty * ratingFactor(c.q, config),
        }));
        mode = "wildcard";
      }
    }
  }

  // ---------- 5–6. top-N window, weighted random ----------
  const window = [...candidates].sort((a, b) => b.score - a.score).slice(0, config.windowSize);
  const weights = window.map((c) => Math.max(1e-6, c.score) ** 2);
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  let pick = window[window.length - 1];
  for (let i = 0; i < window.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      pick = window[i];
      break;
    }
  }

  // ---------- 7. update state ----------
  const next: CompositionState = {
    ...state,
    history: [
      ...state.history,
      {
        questionId: pick.q.id,
        familyId: pick.q.familyId,
        subject: pick.q.subject ?? null,
        topic: primaryTopic(pick.q),
        context: pick.context,
        band: pick.band,
        dignityBand: pick.dignityBand,
        wildcard: mode === "wildcard",
        heroPlayerId: pick.heroPlayerId,
      },
    ],
    heroNeed: { ...state.heroNeed },
    heroCount: { ...state.heroCount },
    lastHeroIndex: { ...state.lastHeroIndex },
  };
  if (pick.heroPlayerId) {
    const id = pick.heroPlayerId;
    next.heroNeed[id] = (state.heroNeed[id] ?? 1) * config.heroDecay;
    next.heroCount[id] = (state.heroCount[id] ?? 0) + 1;
    next.lastHeroIndex[id] = index;
  }

  return {
    question: pick.q,
    state: next,
    debug: {
      mode,
      score: round(pick.score),
      components: Object.fromEntries(Object.entries(pick.components).map(([k, v]) => [k, round(v)])) as ScoreComponents,
      penalty: round(pick.penalty),
      roomDifficulty: round(pick.roomDifficulty),
      band: pick.band,
      heroPlayerId: pick.heroPlayerId,
      eligible: eligible.length,
      window: window.length,
    },
  };
}

/**
 * Topics worth offering in onboarding for a room language: at least `min` usable questions
 * where the topic carries real weight. Picking a topic with no content would only disappoint.
 */
export function availableTopics(bank: BankQuestion[], config: EngineConfig, min = 3): string[] {
  const counts = new Map<string, number>();
  for (const q of bank) {
    if (q.language !== config.language) continue;
    if (!config.allowDrafts && q.status !== "APPROVED" && q.status !== "GOLD") continue;
    if (!config.allowExplicit && q.ageSafety === "EXPLICIT_18") continue;
    for (const [slug, w] of Object.entries(q.topics)) if (w >= 0.5) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  return [...counts].filter(([, n]) => n >= min).map(([slug]) => slug).sort();
}

/** Late joiners get a fresh hero_need but a delayed boost (D-14). */
export function registerLateJoin(state: CompositionState, playerId: string): CompositionState {
  return { ...state, joinedAtIndex: { ...state.joinedAtIndex, [playerId]: state.history.length } };
}

export function recordAccuracy(state: CompositionState, accuracy: number): CompositionState {
  return { ...state, accuracy: [...state.accuracy, accuracy] };
}

function round(x: number) {
  return Math.round(x * 1000) / 1000;
}
