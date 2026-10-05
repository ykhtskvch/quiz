// Adds translated questions to existing facts (EPIC 36). Only GLOBAL questions and REGIONAL bridges
// may be translated (BR-127); LOCAL facts are refused.
//
//   node scripts/content/translate.ts <translations.json> [--lang en]
//
// translations.json: { "<source question id>": { "text": "...", "options": ["A", "B", "C", "D"], "explanation": "..." } }
// Options are given in the source file's A–D order; the correct answer stays on the same key.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseDocument, type Document } from "yaml";
import { FAMILIES_DIR } from "./lib/load.ts";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { lang: { type: "string", default: "en" } } });
const lang = values.lang as "en" | "ru";
const file = positionals[0];
if (!file) {
  console.error("Usage: node scripts/content/translate.ts <translations.json> [--lang en]");
  process.exit(1);
}
type Translation = { text: string; options: string[]; explanation: string };
const translations = JSON.parse(readFileSync(file, "utf8")) as Record<string, Translation>;

const docs = new Map<string, Document>();
const where = new Map<string, { file: string; fi: number; fa: number; qi: number }>();
for (const name of readdirSync(FAMILIES_DIR).filter((f) => f.endsWith(".yaml"))) {
  const p = path.join(FAMILIES_DIR, name);
  const doc = parseDocument(readFileSync(p, "utf8"));
  docs.set(p, doc);
  (doc.toJS().families ?? []).forEach((fam: any, fi: number) =>
    fam.facts.forEach((fact: any, fa: number) => fact.questions.forEach((q: any, qi: number) => where.set(q.id, { file: p, fi, fa, qi }))),
  );
}

const touched = new Set<string>();
let added = 0;
const problems: string[] = [];
for (const [sourceId, tr] of Object.entries(translations)) {
  const loc = where.get(sourceId);
  if (!loc) {
    problems.push(`${sourceId}: not found`);
    continue;
  }
  const doc = docs.get(loc.file)!;
  const fact = (doc.toJS().families[loc.fi].facts[loc.fa]) as any;
  const src = fact.questions[loc.qi];
  const newId = sourceId.replace(/-(ru|en)-(\d+)$/, `-${lang}-$2`);
  if (fact.questions.some((q: any) => q.culture_specificity === "LOCAL")) {
    problems.push(`${sourceId}: LOCAL fact — never translated (BR-127)`);
    continue;
  }
  if (src.culture_specificity !== "GLOBAL" && !src.is_bridge) {
    problems.push(`${sourceId}: ${src.culture_specificity} and not a bridge — translation not allowed`);
    continue;
  }
  if (fact.questions.some((q: any) => q.id === newId || q.language === lang)) continue; // already translated
  if (tr.options.length !== src.options.length) {
    problems.push(`${sourceId}: expected ${src.options.length} options`);
    continue;
  }

  const q = {
    ...src,
    id: newId,
    language: lang,
    text: tr.text,
    options: src.options.map((o: any, i: number) => ({ ...o, text: tr.options[i] })),
    explanation: tr.explanation,
    status: "DRAFT",
    generation_method: "AI",
    review_notes: [...(src.review_notes ?? []), `AI doubt: перевод — проверить естественность ${lang === "en" ? "английского" : "русского"} и что варианты остались однозначными.`],
  };
  delete q.reviewed;
  const node = doc.createNode(q);
  // Keep options as compact flow maps like the rest of the bank.
  for (const item of (node as any).get("options").items) item.flow = true;
  for (const key of ["topics", "contexts", "generations", "effects"]) {
    const m = (node as any).get(key);
    if (m) m.flow = true;
  }
  doc.addIn(["families", loc.fi, "facts", loc.fa, "questions"], node);
  touched.add(loc.file);
  added++;
}

for (const p of touched) writeFileSync(p, docs.get(p)!.toString({ lineWidth: 0 }));
for (const pr of problems) console.log(`skip  ${pr}`);
console.log(`Added ${added} ${lang} questions in ${touched.size} files`);
