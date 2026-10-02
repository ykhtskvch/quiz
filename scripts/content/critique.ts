// Second-pass AI review of DRAFT questions in one content file. Appends findings to review_notes.
//
//   npm run content:critique -- content/families/ru-pop-00s.draft-202610011200.yaml
//
// The file is rewritten in place (YAML comments are not preserved).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { ContentFileSchema } from "../../packages/content-schema/src/index.ts";
import { askStructured } from "./lib/claude.ts";
import { CONTENT_DIR } from "./lib/load.ts";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run content:critique -- <content file>");
  process.exit(1);
}
const content = ContentFileSchema.parse(parse(readFileSync(file, "utf8")));
const MARK = "AI critique:";

const pending = content.families.flatMap((fam) =>
  fam.facts.flatMap((fact) =>
    fact.questions
      .filter((q) => q.status === "DRAFT" && !q.review_notes.some((n) => n.startsWith(MARK)))
      .map((q) => ({ fact, q })),
  ),
);
if (pending.length === 0) {
  console.log("Nothing to critique: no un-reviewed DRAFT questions.");
  process.exit(0);
}

const CritiqueSchema = z.object({
  reviews: z.array(
    z.object({
      question_id: z.string(),
      verdict: z.enum(["OK", "FIX", "DROP"]),
      issues: z.array(z.string()).describe("concrete problems; empty when verdict is OK"),
    }),
  ),
});

const system = [
  "Ты — строгий фактчекер и редактор квиза. Проверь каждый вопрос по гайдлайну.",
  "Ищи: фактические ошибки; неоднозначность (может ли другой вариант считаться верным); слабые или нелепые distractors;",
  "ответ угадывается по форме; ироничный тон; неверные difficulty / dignity / culture_specificity; нарушение правил для 13–17.",
  "DROP — если вопрос нельзя спасти правкой. Пиши по-русски, кратко.",
  readFileSync(path.join(CONTENT_DIR, "guideline.md"), "utf8"),
].join("\n\n");

const prompt = pending
  .map(({ fact, q }) =>
    [
      `### ${q.id}`,
      `Факт: ${fact.statement}`,
      `Вопрос: ${q.text}`,
      ...q.options.map((o) => `${o.key}) ${o.text}${o.correct ? "  ← верный" : ""}`),
      `Пояснение: ${q.explanation}`,
      `difficulty ${q.difficulty}, dignity ${q.dignity}, ${q.culture_specificity}`,
    ].join("\n"),
  )
  .join("\n\n");

console.error(`Critiquing ${pending.length} questions…`);
const result = await askStructured({ system, prompt, schema: CritiqueSchema });

const byId = new Map(result.reviews.map((r) => [r.question_id, r]));
let flagged = 0;
for (const { q } of pending) {
  const r = byId.get(q.id);
  if (!r) continue;
  q.review_notes.push(`${MARK} ${r.verdict}${r.issues.length ? " — " + r.issues.join("; ") : ""}`);
  if (r.verdict !== "OK") flagged++;
}
writeFileSync(file, stringify(content, { lineWidth: 0 }));
console.log(`${pending.length} reviewed, ${flagged} flagged FIX/DROP. See review_notes in ${file}`);
