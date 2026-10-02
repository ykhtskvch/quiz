// Generates DRAFT questions for one topic and writes them to content/families/<topic>.draft-<stamp>.yaml.
//
//   npm run content:draft -- --topic ru-pop-00s --n 15 --mix 3,6,4,2
//
// --mix = how many easy (1–2), medium (3), hard (4), specialist (5) questions. Defaults to an even spread.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { stringify } from "yaml";
import { z } from "zod";
import { DISTRACTOR_TYPES, EFFECTS, ERAS, type Family } from "../../packages/content-schema/src/index.ts";
import { askStructured } from "./lib/claude.ts";
import { CONTENT_DIR, FAMILIES_DIR, loadFamilies, loadTaxonomy } from "./lib/load.ts";

const { values } = parseArgs({
  options: {
    topic: { type: "string" },
    n: { type: "string", default: "15" },
    mix: { type: "string" },
  },
});
const taxonomy = loadTaxonomy();
const topic = taxonomy.topics.find((t) => t.slug === values.topic);
if (!topic) {
  console.error(`Unknown --topic. Known: ${taxonomy.topics.map((t) => t.slug).join(", ")}`);
  process.exit(1);
}
const n = Number(values.n);
const mix = values.mix?.split(",").map(Number) ?? spread(n);
if (mix.length !== 4 || mix.reduce((a, b) => a + b, 0) !== n) {
  console.error("--mix must be 4 numbers that sum to --n");
  process.exit(1);
}

// LLM-facing shape: arrays instead of maps, keys assigned by this script.
const Weighted = <T extends z.ZodType>(key: T) => z.array(z.object({ key, weight: z.number() }));
const DraftSchema = z.object({
  questions: z.array(
    z.object({
      family_slug: z.string().describe("kebab-case latin slug of the cultural object, e.g. tatu, fabrika-zvezd"),
      family_name: z.string(),
      fact_slug: z.string().describe("kebab-case latin slug of the single checkable fact"),
      fact_statement: z.string(),
      source_name: z.string(),
      source_url: z.string().nullable(),
      text: z.string(),
      correct_answer: z.string(),
      distractors: z.array(z.object({ text: z.string(), type: z.enum(DISTRACTOR_TYPES) })).describe("exactly 3"),
      explanation: z.string(),
      difficulty: z.number().int(),
      dignity: z.number().int(),
      culture_specificity: z.enum(["GLOBAL", "REGIONAL", "LOCAL"]),
      is_bridge: z.boolean(),
      extra_topics: Weighted(z.string()).describe("other topic slugs from the taxonomy, may be empty"),
      contexts: Weighted(z.string()),
      generations: Weighted(z.enum(ERAS)),
      effects: Weighted(z.enum(EFFECTS)),
      time_sensitive: z.boolean(),
      doubts: z.array(z.string()).describe("anything a fact-checker should look at; empty if confident"),
    }),
  ),
});

const existing = loadFamilies().files.flatMap((f) => f.families);
const knownStatements = existing
  .flatMap((fam) => fam.facts)
  .filter((fact) => fact.questions.some((q) => topic.slug in q.topics))
  .map((fact) => `- ${fact.statement}`);

const system = [
  "Ты — редактор русскоязычного квиза для небольших компаний. Пиши вопросы строго по гайдлайну ниже.",
  readFileSync(path.join(CONTENT_DIR, "guideline.md"), "utf8"),
  "Доступная taxonomy (slug: название):",
  taxonomy.topics.map((t) => `${t.slug}: ${t.name}`).join("\n"),
  "Культурные контексты: " + taxonomy.contexts.map((c) => c.code).join(", "),
].join("\n\n");

const prompt = [
  `Тема: ${topic.slug} — «${topic.name}». Язык вопросов: русский.`,
  `Нужно ${n} вопросов: ${mix[0]} лёгких (difficulty 1–2), ${mix[1]} средних (3), ${mix[2]} сложных (4), ${mix[3]} для знатоков (5).`,
  "Каждый вопрос проверяет отдельный факт. Разнообразь объекты темы и Knowledge Effects.",
  "Пиши только то, в чём уверен. Если в факте есть сомнение — опиши его в doubts.",
  "Указывай источник, который реально подтверждает факт; если не знаешь точный URL, оставь source_url = null.",
  knownStatements.length ? `Эти факты уже есть в банке, не повторяй их:\n${knownStatements.join("\n")}` : "",
].join("\n\n");

console.error(`Drafting ${n} questions for ${topic.slug}…`);
const draft = await askStructured({ system, prompt, schema: DraftSchema });

// ---------- convert to content-file format ----------

const usedIds = new Set(existing.flatMap((fam) => [fam.family, ...fam.facts.flatMap((f) => [f.id, ...f.questions.map((q) => q.id)])]));
const uniqueId = (base: string) => {
  let id = slugify(base);
  for (let i = 2; usedIds.has(id); i++) id = `${slugify(base)}-${i}`;
  usedIds.add(id);
  return id;
};
const toMap = <K extends string>(items: { key: K; weight: number }[]) =>
  Object.fromEntries(items.map((i) => [i.key, clamp(i.weight, 0, 1)])) as Record<K, number>;

const families = new Map<string, Family>();
for (const d of draft.questions) {
  if (d.distractors.length !== 3) {
    console.error(`skip "${d.text}": expected 3 distractors, got ${d.distractors.length}`);
    continue;
  }
  const familySlug = slugify(d.family_slug);
  if (!families.has(familySlug)) {
    // A family id already used in another file gets a suffix; merge such families by hand during review.
    families.set(familySlug, { family: uniqueId(familySlug), name: d.family_name, facts: [] });
  }
  const factId = uniqueId(d.fact_slug);
  const options = shuffle([
    { text: d.correct_answer, correct: true as const },
    ...d.distractors.map((x) => ({ text: x.text, distractor: x.type })),
  ]).map((o, i) => ({ key: "ABCD"[i] as "A" | "B" | "C" | "D", ...o }));

  families.get(familySlug)!.facts.push({
    id: factId,
    statement: d.fact_statement,
    time_sensitive: d.time_sensitive,
    sources: [{ name: d.source_name, ...(d.source_url ? { url: d.source_url } : {}), type: "REFERENCE", verified: false }],
    questions: [
      {
        id: `${factId}-ru-1`,
        language: "ru",
        origin_language: "ru",
        culture_specificity: d.culture_specificity,
        is_bridge: d.is_bridge,
        text: d.text,
        options,
        explanation: d.explanation,
        topics: { [topic.slug]: 1, ...toMap(d.extra_topics.filter((t) => t.key !== topic.slug)) },
        contexts: toMap(d.contexts),
        generations: toMap(d.generations),
        difficulty: clamp(d.difficulty, 1, 5),
        dignity: clamp(d.dignity, 1, 5),
        effects: toMap(d.effects),
        age_safety: "ALL",
        status: "DRAFT",
        generation_method: "AI",
        review_notes: d.doubts.map((x) => `AI doubt: ${x}`),
      },
    ],
  });
}

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
const out = path.join(FAMILIES_DIR, `${topic.slug}.draft-${stamp}.yaml`);
writeFileSync(out, `# AI draft for ${topic.slug}. Review every question before changing status (BR-130).\n` + stringify({ families: [...families.values()] }, { lineWidth: 0 }));
console.log(`Wrote ${draft.questions.length} questions to ${out}. Next: npm run content:validate`);

// ---------- helpers ----------

function spread(total: number): number[] {
  const base = [0.2, 0.4, 0.27, 0.13].map((p) => Math.floor(p * total));
  base[1] += total - base.reduce((a, b) => a + b, 0);
  return base;
}
function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}
function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
}
function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
