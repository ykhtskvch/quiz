// Composition Engine simulator (09-system-design §7): plays many virtual rooms against the real
// bank and prints the Engine §16 metrics — the fastest way to find content gaps before a playtest.
//
//   node scripts/dev/simulate.ts [--runs 200] [--questions 20] [--drafts] [--seed 1] [--priority] [--only saturday]
//
// --priority also writes content/review-priority.json: the share of simulated games each question
// appears in, so the review tool can put the questions a playtest will actually see first.
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { BANK } from "../../packages/shared/src/bank.generated.ts";
import {
  DEFAULT_CONFIG,
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
    questions: { type: "string", default: String(DEFAULT_CONFIG.questionsPerGame) },
    seed: { type: "string", default: "1" },
    drafts: { type: "boolean", default: true },
    priority: { type: "boolean", default: false },
    /** Only the archetypes with this tag, e.g. "saturday" for the 10.10 launch group (EPIC 38). */
    only: { type: "string" },
  },
});
const RUNS = Number(values.runs);
const QUESTIONS = Number(values.questions);
const config = { ...DEFAULT_ENGINE_CONFIG, allowDrafts: values.drafts };

type Archetype = {
  name: string;
  language?: "ru" | "en";
  players: number;
  ages: AgeBand[];
  pool: string[];
  backgrounds: BackgroundContext[] | null;
  dignity: DignityChoice[];
  /** Per-player backgrounds, cycled by seat; overrides `backgrounds` (mixed rooms). */
  backgroundsBySeat?: (BackgroundContext[] | null)[];
  tag?: string;
};

const ALL_ARCHETYPES: Archetype[] = [
  // EPIC 38: the Saturday 10.10 group — friends 30–45, Russian speakers and Brits, broad interests.
  // The room language isn't known yet, so both versions are prepared.
  {
    name: "Суббота: друзья 30–45, русская комната",
    tag: "saturday",
    players: 6,
    ages: ["35_44", "25_34", "35_44", "45_54"],
    pool: ["space", "world-pop", "world-cinema", "old-internet", "food", "geography", "ru-pop-00s", "soviet-cinema", "cartoons", "internet-now", "videogames", "science", "nature", "ussr-everyday"],
    backgrounds: null,
    backgroundsBySeat: [["POST_SOVIET"], ["POST_SOVIET", "UK"], ["POST_SOVIET"], ["POST_SOVIET", "UK"]],
    dignity: ["BALANCE", "POP"],
  },
  {
    name: "Суббота: друзья 30–45, английская смешанная комната",
    tag: "saturday",
    language: "en",
    players: 6,
    ages: ["35_44", "25_34", "35_44", "45_54"],
    pool: ["british-culture", "world-pop", "world-cinema", "old-internet", "food", "geography", "science", "nature", "internet-now", "videogames", "space", "american-pop-culture"],
    backgrounds: null,
    backgroundsBySeat: [["POST_SOVIET"], ["UK"], ["POST_SOVIET", "UK"], ["UK"]],
    dignity: ["BALANCE", "POP"],
  },
  {
    name: "EN: 2 постсоветских + 3 британца",
    language: "en",
    players: 5,
    ages: ["25_34", "35_44"],
    pool: ["space", "british-culture", "world-pop", "world-cinema", "geography", "food", "american-pop-culture"],
    backgrounds: null,
    backgroundsBySeat: [["POST_SOVIET"], ["POST_SOVIET"], ["UK"], ["UK"], ["UK"]],
    dignity: ["BALANCE", "POP"],
  },
  {
    name: "EN: интернациональная, культуру пропустили",
    language: "en",
    players: 6,
    ages: ["18_24", "25_34", "35_44"],
    pool: ["world-cinema", "world-pop", "fandoms", "videogames", "science", "american-pop-culture", "nature"],
    backgrounds: null,
    dignity: ["BALANCE"],
  },
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

/** Games each question appeared in, across all archetypes (for --priority). */
const appearances = new Map<string, number>();

// Untagged archetypes are the general set; tagged ones only run with --only.
const ARCHETYPES = values.only ? ALL_ARCHETYPES.filter((a) => a.tag === values.only) : ALL_ARCHETYPES.filter((a) => !a.tag);
if (ARCHETYPES.length === 0) throw new Error(`no archetypes tagged "${values.only}"`);

const pick = <T>(xs: T[], rng: () => number) => xs[Math.floor(rng() * xs.length)];

function makePlayer(a: Archetype, i: number, rng: () => number): OnboardingInput {
  const n = 2 + Math.floor(rng() * 3);
  const liked = [...a.pool].sort(() => rng() - 0.5).slice(0, n);
  return {
    ageBand: a.ages[i % a.ages.length],
    topics: liked.map((slug) => ({ slug, preference: "LIKE" as const, depth: pick<Depth>(["CASUAL", "INTERESTED", "EXPERT"], rng) })),
    backgrounds: a.backgroundsBySeat ? a.backgroundsBySeat[i % a.backgroundsBySeat.length] : a.backgrounds,
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
  difficulty: number;
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
  let difficultySum = 0;
  let lowDignity = 0;
  let wildcards = 0;
  const topics: string[] = [];

  for (let i = 0; i < QUESTIONS; i++) {
    const r = nextQuestion({ bank: BANK, profile, activePlayerIds: ids, usedQuestionIds: usedQ, usedFactIds: usedF, state, config: { ...config, language: a.language ?? "ru" }, rng });
    if (!r) break;
    const q = r.question;
    usedQ.add(q.id);
    appearances.set(q.id, (appearances.get(q.id) ?? 0) + 1);
    usedF.add(q.factId);
    topics.push(primaryTopic(q));
    difficultySum += q.difficulty;
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
    difficulty: played ? difficultySum / played : 0,
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
    Сложность: num(avg("difficulty")),
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

if (values.priority) {
  const games = RUNS * ARCHETYPES.length;
  const items = [...appearances]
    .map(([id, n]) => ({ id, share: Math.round((n / games) * 1000) / 1000 }))
    .sort((a, b) => b.share - a.share);
  const out = "content/review-priority.json";
  writeFileSync(out, JSON.stringify({ games, rooms: ARCHETYPES.map((a) => a.name), items }, null, 1) + "\n");
  // How many questions make up 80 % of everything a playtest will show.
  const total = items.reduce((s, i) => s + i.share, 0);
  let acc = 0;
  const core = items.findIndex((i) => (acc += i.share) >= total * 0.8) + 1;
  console.log(`\n${out}: ${items.length} of ${BANK.length} questions ever appear; ${core} of them make up 80 % of what players see.`);
}
