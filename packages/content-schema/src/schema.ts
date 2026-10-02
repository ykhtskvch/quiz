// Content file schema — mirrors docs/spec-v0.2/06-data-model.md §3 and §9.
import { z } from "zod";

export const LANGUAGES = ["ru", "en"] as const;
export const STATUSES = ["DRAFT", "FACT_CHECKED", "APPROVED", "GOLD", "RETIRED"] as const;
export const PLAYABLE_STATUSES = ["APPROVED", "GOLD"] as const;
export const REVIEWED_STATUSES = ["FACT_CHECKED", "APPROVED", "GOLD"] as const;
export const ERAS = ["80s", "90s", "00s", "10s", "current"] as const;
export const EFFECTS = [
  "I_KNOW_THIS",
  "WHY_DO_I_REMEMBER_THIS",
  "I_FIGURED_IT_OUT",
  "SHARED_KNOWLEDGE",
  "HERO_CANDIDATE",
  "BRIDGE",
] as const;
export const DISTRACTOR_TYPES = [
  "PLAUSIBLE",
  "COMMON_MISCONCEPTION",
  "NEAR_MISS",
  "SAME_CATEGORY",
  "CONTEXTUAL_CONFUSION",
] as const;

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case slug");
const weight = z.number().min(0).max(1);
const scale = z.number().int().min(1).max(5);

// ---------- taxonomy.yaml ----------

export const CulturalContextSchema = z.object({
  code: z.string().regex(/^[A-Z0-9_]+$/),
  name: z.string(),
  parent: z.string().optional(),
});

export const TopicSchema = z.object({
  slug,
  name: z.string(),
  group: z.string(),
  level: z.enum(["A", "B"]),
  implied_context: z.string().optional(),
  target_questions: z.number().int().positive(),
});

export const TaxonomySchema = z.object({
  contexts: z.array(CulturalContextSchema),
  topics: z.array(TopicSchema),
});

// ---------- families/*.yaml ----------

export const SourceSchema = z.object({
  name: z.string(),
  url: z.string().url().optional(),
  type: z.enum(["OFFICIAL", "ACADEMIC", "REFERENCE", "NEWS", "ARCHIVE", "OTHER"]),
  // true only after a human opened the source and confirmed the fact (BR-130)
  verified: z.boolean().default(false),
});

export const OptionSchema = z.object({
  key: z.enum(["A", "B", "C", "D"]),
  text: z.string().min(1),
  correct: z.literal(true).optional(),
  distractor: z.enum(DISTRACTOR_TYPES).optional(),
});

export const MediaSchema = z.object({
  type: z.literal("IMAGE"),
  file: z.string(),
  rights: z.object({
    creator: z.string(),
    licence: z.string(),
    source_url: z.string().url().optional(),
    attribution_text: z.string().optional(),
    commercial_use_allowed: z.boolean(),
    status: z.enum(["VERIFIED", "REVIEW_REQUIRED", "REJECTED"]),
  }),
});

export const QuestionSchema = z.object({
  id: slug,
  language: z.enum(LANGUAGES),
  origin_language: z.enum(LANGUAGES),
  culture_specificity: z.enum(["GLOBAL", "REGIONAL", "LOCAL"]),
  is_bridge: z.boolean().default(false),
  text: z.string().min(1),
  options: z.array(OptionSchema).length(4),
  explanation: z.string().min(1),
  topics: z.record(slug, weight),
  contexts: z.record(z.string(), weight),
  generations: z.partialRecord(z.enum(ERAS), weight).default({}),
  difficulty: scale,
  dignity: scale,
  effects: z.partialRecord(z.enum(EFFECTS), weight),
  age_safety: z.enum(["ALL", "NON_EXPLICIT_ADULT", "EXPLICIT_18"]).default("ALL"),
  answer_time_override: z.number().int().positive().optional(),
  media: MediaSchema.optional(),
  status: z.enum(STATUSES),
  generation_method: z.enum(["HUMAN", "AI", "HYBRID"]),
  reviewed: z.object({ by: z.string(), at: z.string() }).optional(),
  review_notes: z.array(z.string()).default([]),
});

export const FactSchema = z.object({
  id: slug,
  statement: z.string().min(1),
  time_sensitive: z.boolean().default(false),
  sources: z.array(SourceSchema).default([]),
  questions: z.array(QuestionSchema).min(1),
});

export const FamilySchema = z.object({
  family: slug,
  name: z.string(),
  facts: z.array(FactSchema).min(1),
});

// A content file holds a batch of families (usually one topic).
export const ContentFileSchema = z.object({
  families: z.array(FamilySchema).min(1),
});

export type Taxonomy = z.infer<typeof TaxonomySchema>;
export type Topic = z.infer<typeof TopicSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type Fact = z.infer<typeof FactSchema>;
export type Family = z.infer<typeof FamilySchema>;
export type ContentFile = z.infer<typeof ContentFileSchema>;
