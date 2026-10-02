// Composition Engine simulator (09-system-design §7): plays many virtual rooms against the real
// bank and prints the Engine §16 metrics — the fastest way to find content gaps before a playtest.
//
//   node scripts/dev/simulate.ts [--runs 200] [--questions 25] [--drafts] [--seed 1]
import { parseArgs } from "node:util";
import { BANK } from "../../packages/shared/src/bank.generated.ts";
import {
  primaryTopic,
  type AgeBand,
  type BackgroundContext,
  type Depth,
  type DignityChoice,
  type OnboardingInput,
} from "../../packages/shared/src/index.ts";
import {
  affinity,
  aggregateProfile,
  DEFAULT_ENGINE_CONFIG,
  emptyCompositionState,
  nextQuestion,
  playerProfile,
  recordAccuracy,
  seededRng,
} from "../../packages/engine/src/index.ts";

const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "200" },
    questions: { type: "string", default: "25" },
    seed: { type: "string", default: "1" },
    drafts: { type: "boolean", default: true },
  },
});
const RUNS = Number(values.runs);
const QUESTIONS = Number(values.questions);
const config = { ...DEFAULT_ENGINE_CONFIG, allowDrafts: values.drafts };

type Archetype = {
  name: string;
  players: number;
  ages: AgeBand[];
  pool: string[];
  backgrounds: BackgroundContext[] | null;
  dignity: DignityChoice[];
};

const ARCHETYPES: Archetype[] = [
  {
    name: "Ностальгия 35–44, постсоветские",
    players: 6,
    ages: ["35_44", "25_34"],
    pool: ["ru-pop-00s", "ru-tv-90s-00s", "ussr-everyday", "space", "soviet-cinema", "old-internet", "eurovision"],
    backgrounds: ["POST_SOVIET"],
    dignity: ["POP", "BALANCE"],
  },
  {
    name: "5 взрослых + подросток",
    players: 6,
    ages: ["35_44", "35_44", "45_54", "35_44", "25_34", "13_17"],
    pool: ["space", "ru-pop-00s", "videogames", "internet-now", "cartoons", "geography", "football"],
    backgrounds: ["POST_SOVIET"],
    dignity: ["BALANCE"],
  },
  {
    name: "Классика",
    players: 4,
    ages: ["45_54", "55_PLUS", "35_44"],
    pool: ["space", "cold-war", "art", "russian-literature", "geography", "science"],
    backgrounds: ["POST_SOVIET"],
    dignity: ["CLASSIC"],
  },
  {
    name: "Культуру пропустили",
    players: 5,
    ages: ["25_34", "35_44"],
    pool: ["ru-pop-00s", "space", "world-cinema", "food", "eurovision", "fandoms"],
    backgrounds: null,
    dignity: ["BALANCE", "POP"],
  },
  {
    name: "Русскоязычные из UK, без постсоветского",
    players: 4,
    ages: ["25_34", "18_24"],
    pool: ["space", "world-pop", "world-series", "food", "geography"],
    backgrounds: ["UK"],
    dignity: ["BALANCE"],
  },
];

const pick = <T>(xs: T[], rng: () => number) => xs[Math.floor(rng() * xs.length)];

function makePlayer(a: Archetype, i: number, rng: () => number): OnboardingInput {
  const n = 2 + Math.floor(rng() * 3);
  const liked = [...a.pool].sort(() => rng() - 0.5).slice(0, n);
  return {
    ageBand: a.ages[i % a.ages.length],
    topics: liked.map((slug) => ({ slug, preference: "LIKE" as const, depth: pick<Depth>(["CASUAL", "INTERESTED", "EXPERT"], rng) })),
    backgrounds: a.backgrounds,
    dignity: pick(a.dignity, rng),
  };
}

/** A knowledgeable player gets ~90 %; a stranger to the topic ~guessing (25 %). */
function pCorrect(aff: number, difficulty: number) {
  const skill = 1.5 + 3.5 * aff;
  const sig = 1 / (1 + Math.exp(-(skill - difficulty) * 1.2));
  return 0.25 + 0.7 * sig;
}

type Metrics = {
  played: number;
  accuracy: number;
  coverage: number;
  heroCoverage: number;
  heroSuccess: number;
  topics: number;
  maxStreak: number;
  lowDignity: number;
  wildcards: number;
  exhausted: number;
};

function simulate(a: Archetype, seed: number): Metrics {
  const rng = seededRng(seed);
  const profiles = Array.from({ length: a.players }, (_, i) => playerProfile(`p${i}`, makePlayer(a, i, rng)));
  const profile = aggregateProfile(profiles);
  const ids = profiles.map((p) => p.playerId);
  let state = emptyCompositionState();
  const usedQ = new Set<string>();
  const usedF = new Set<string>();
  const highAffinitySeen = new Set<string>();
  const heroTargets = new Set<string>();
  let heroHits = 0;
  let correctSum = 0;
  let lowDignity = 0;
  let wildcards = 0;
  const topics: string[] = [];

  for (let i = 0; i < QUESTIONS; i++) {
    const r = nextQuestion({ bank: BANK, profile, activePlayerIds: ids, usedQuestionIds: usedQ, usedFactIds: usedF, state, config, rng });
    if (!r) break;
    const q = r.question;
    usedQ.add(q.id);
    usedF.add(q.factId);
    topics.push(primaryTopic(q));
    if (q.dignity <= 2) lowDignity++;
    if (r.debug.mode === "wildcard") wildcards++;

    const affs = profiles.map((p) => affinity(p, q, config.affinityMix).total);
    affs.forEach((x, k) => x >= config.heroThreshold && highAffinitySeen.add(ids[k]));
    const correct = affs.map((x) => rng() < pCorrect(x, r.debug.roomDifficulty));
    const share = correct.filter(Boolean).length / correct.length;
    correctSum += share;
    if (r.debug.heroPlayerId) {
      heroTargets.add(r.debug.heroPlayerId);
      if (correct[ids.indexOf(r.debug.heroPlayerId)] && share < 0.5) heroHits++;
    }
    state = recordAccuracy(r.state, share);
  }

  let streak = 1;
  let maxStreak = topics.length ? 1 : 0;
  for (let i = 1; i < topics.length; i++) {
    streak = topics[i] === topics[i - 1] ? streak + 1 : 1;
    maxStreak = Math.max(maxStreak, streak);
  }
  const played = topics.length;
  return {
    played,
    accuracy: played ? correctSum / played : 0,
    coverage: highAffinitySeen.size / ids.length,
    heroCoverage: heroTargets.size / ids.length,
    heroSuccess: heroHits,
    topics: new Set(topics).size,
    maxStreak,
    lowDignity: played ? lowDignity / played : 0,
    wildcards,
    exhausted: played < QUESTIONS ? 1 : 0,
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const num = (x: number) => x.toFixed(1);

console.log(`Bank: ${BANK.length} questions (${BANK.filter((q) => q.status === "APPROVED" || q.status === "GOLD").length} playable), drafts ${config.allowDrafts ? "on" : "off"}; ${RUNS} runs × ${QUESTIONS} questions\n`);
const rows = ARCHETYPES.map((a) => {
  const ms = Array.from({ length: RUNS }, (_, i) => simulate(a, Number(values.seed) * 100_000 + i));
  const avg = (k: keyof Metrics) => ms.reduce((s, m) => s + m[k], 0) / ms.length;
  return {
    Комната: a.name,
    Вопросов: num(avg("played")),
    "Банк кончился": pct(avg("exhausted")),
    Точность: pct(avg("accuracy")),
    "Покрытие ≥1 «своего»": pct(avg("coverage")),
    "Hero-цели": pct(avg("heroCoverage")),
    "Hero-удачи": num(avg("heroSuccess")),
    Тем: num(avg("topics")),
    "Макс. серия темы": num(avg("maxStreak")),
    "Dignity ≤2": pct(avg("lowDignity")),
    Wildcard: num(avg("wildcards")),
  };
});
console.table(rows);

// Plain-language hints about what to fix first.
const hints: string[] = [];
for (const r of rows) {
  if (parseFloat(r["Банк кончился"]) > 0) hints.push(`«${r.Комната}»: банк заканчивается раньше ${QUESTIONS} вопросов — не хватает eligible-вопросов для этой комнаты.`);
  if (parseFloat(r["Макс. серия темы"]) >= 4) hints.push(`«${r.Комната}»: одна тема идёт подряд ${r["Макс. серия темы"]} раз — для этой комнаты подходит слишком мало тем.`);
  if (parseFloat(r["Покрытие ≥1 «своего»"]) < 80) hints.push(`«${r.Комната}»: только ${r["Покрытие ≥1 «своего»"]} игроков получили вопрос «про себя» — нет вопросов по их темам.`);
  if (parseFloat(r.Точность) > 70) hints.push(`«${r.Комната}»: точность ${r.Точность} выше цели 50–70 % — для этой аудитории нужны вопросы сложнее.`);
}
console.log("\nЦели (05-engine §2, §16): точность 50–70 %, покрытие и Hero-цели → 100 %, банк не заканчивается.");
console.log(hints.length ? "\n" + hints.map((h) => "• " + h).join("\n") : "\nВсе метрики в целевых диапазонах.");
