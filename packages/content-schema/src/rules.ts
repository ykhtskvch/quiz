// Cross-record rules that a zod schema alone cannot express.
// Errors block the build; warnings are shown but allowed.
import {
  PLAYABLE_STATUSES,
  REVIEWED_STATUSES,
  type Family,
  type Question,
  type Taxonomy,
} from "./schema.ts";

export type Issue = { level: "error" | "warning"; where: string; message: string };

export type LoadedFile = { path: string; families: Family[] };

const reviewed = (q: Question) => (REVIEWED_STATUSES as readonly string[]).includes(q.status);
const playable = (q: Question) => (PLAYABLE_STATUSES as readonly string[]).includes(q.status);

export function checkContent(files: LoadedFile[], taxonomy: Taxonomy): Issue[] {
  const issues: Issue[] = [];
  const err = (where: string, message: string) => issues.push({ level: "error", where, message });
  const warn = (where: string, message: string) => issues.push({ level: "warning", where, message });

  const topicSlugs = new Set(taxonomy.topics.map((t) => t.slug));
  const contextCodes = new Set(taxonomy.contexts.map((c) => c.code));
  const seen = { family: new Map<string, string>(), fact: new Map<string, string>(), question: new Map<string, string>() };

  const unique = (kind: keyof typeof seen, id: string, where: string) => {
    const prev = seen[kind].get(id);
    if (prev) err(where, `duplicate ${kind} id "${id}" (first seen in ${prev})`);
    else seen[kind].set(id, where);
  };

  for (const file of files) {
    for (const family of file.families) {
      unique("family", family.family, file.path);

      for (const fact of family.facts) {
        const factWhere = `${file.path} › ${fact.id}`;
        unique("fact", fact.id, factWhere);

        const hasVerifiedSource = fact.sources.some((s) => s.verified);
        if (fact.sources.length === 0) warn(factWhere, "fact has no sources");

        // BR-127: a culture-specific fact never exists in translation.
        const local = fact.questions.filter((q) => q.culture_specificity === "LOCAL");
        const origins = new Set(fact.questions.map((q) => q.origin_language));
        if (origins.size > 1) err(factWhere, "questions of one fact disagree on origin_language");

        for (const q of fact.questions) {
          const where = `${factWhere} › ${q.id}`;
          unique("question", q.id, where);

          const correct = q.options.filter((o) => o.correct);
          if (correct.length !== 1) err(where, `expected exactly 1 correct option, got ${correct.length}`);
          if (new Set(q.options.map((o) => o.key)).size !== 4) err(where, "option keys must be A, B, C, D");
          if (new Set(q.options.map((o) => o.text.trim().toLowerCase())).size !== 4) err(where, "duplicate option texts");
          for (const o of q.options) {
            if (!o.correct && !o.distractor) warn(where, `option ${o.key} has no distractor type`);
            if (o.correct && o.distractor) err(where, `correct option ${o.key} must not have a distractor type`);
          }

          if (q.language !== q.origin_language) {
            if (local.length > 0 || (q.culture_specificity !== "GLOBAL" && !q.is_bridge)) {
              err(where, "translation is allowed only for GLOBAL or bridge questions (BR-127)");
            }
          }

          for (const t of Object.keys(q.topics)) if (!topicSlugs.has(t)) err(where, `unknown topic "${t}"`);
          for (const c of Object.keys(q.contexts)) if (!contextCodes.has(c)) err(where, `unknown context "${c}"`);
          if (Object.keys(q.topics).length === 0) err(where, "question needs at least one topic");
          if (Object.keys(q.effects).length === 0) warn(where, "question has no knowledge effects");

          if (reviewed(q)) {
            if (!q.reviewed) err(where, `${q.status} requires a human "reviewed" stamp (BR-130)`);
            if (!hasVerifiedSource) err(where, `${q.status} requires at least one verified source`);
          }
          if (q.media) {
            if (playable(q) && q.media.rights.status !== "VERIFIED") err(where, "playable image question needs VERIFIED rights");
          }
          if (playable(q) && q.review_notes.length > 0) warn(where, "approved question still has review_notes");
        }
      }
    }
  }
  return issues;
}
