// Engine §5 — how well one question fits one player. Pure functions over the private profile.
import { CONTEXTS, type BankQuestion } from "@quiz/shared";
import type { EngineConfig } from "./config.ts";
import { TOPIC_AFFINITY, type PlayerProfile } from "./profile.ts";

const parentOf = new Map(CONTEXTS.map((c) => [c.code, c.parent]));

/** Interpolates secondary topics toward neutral: a weight-0.4 topic counts 40 % of the way from "no preference". */
export function topicMatch(p: PlayerProfile, q: BankQuestion): number {
  let best = 0;
  for (const [slug, w] of Object.entries(q.topics)) {
    const a = p.topics[slug] ?? TOPIC_AFFINITY.NONE;
    best = Math.max(best, TOPIC_AFFINITY.NONE + (a - TOPIC_AFFINITY.NONE) * w);
  }
  return best;
}

/** Strength of the player's tie to a context, following parents (RUSSIA_1990S → POST_SOVIET). */
function contextStrength(p: PlayerProfile, code: string): number {
  let s = p.contexts[code] ?? 0;
  const parent = parentOf.get(code);
  if (parent) s = Math.max(s, p.contexts[parent] ?? 0);
  return s;
}

/** Engine §5: strong 1.0, partial/global 0.6, no match 0.2. */
export function cultureMatch(p: PlayerProfile, q: BankQuestion): number {
  const global = q.cultureSpecificity === "GLOBAL" || (q.contexts.GLOBAL ?? 0) >= 0.5;
  let best = global ? 0.6 : 0.2;
  for (const [code, rel] of Object.entries(q.contexts)) {
    if (code === "GLOBAL") continue;
    best = Math.max(best, rel * contextStrength(p, code));
  }
  return best;
}

/** Questions without generation tags are neutral; otherwise far generations get 0.2. */
export function generationMatch(p: PlayerProfile, q: BankQuestion): number {
  const eras = Object.entries(q.generations);
  if (eras.length === 0) return 0.6;
  let best = 0.2;
  for (const [era, rel] of eras) best = Math.max(best, (rel ?? 0) * (p.eras[era as keyof typeof p.eras] ?? 0));
  return best;
}

export type Affinity = { total: number; topic: number; culture: number; generation: number };

export function affinity(p: PlayerProfile, q: BankQuestion, mix: EngineConfig["affinityMix"]): Affinity {
  const topic = topicMatch(p, q);
  const culture = cultureMatch(p, q);
  const generation = generationMatch(p, q);
  return { total: mix.topic * topic + mix.culture * culture + mix.generation * generation, topic, culture, generation };
}

/** Does the room have anyone this culture-specific question is "for"? (Engine §4, T-10) */
export function hasCulturalHost(players: PlayerProfile[], q: BankQuestion): boolean {
  if (q.cultureSpecificity !== "LOCAL" || q.isBridge) return true;
  return Object.keys(q.contexts).some((code) => code !== "GLOBAL" && players.some((p) => contextStrength(p, code) > 0));
}
