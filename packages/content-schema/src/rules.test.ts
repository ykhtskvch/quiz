import { describe, expect, it } from "vitest";
import { checkContent, type LoadedFile } from "./rules.ts";
import { QuestionSchema, type Question, type Taxonomy } from "./schema.ts";

const taxonomy: Taxonomy = {
  contexts: [{ code: "GLOBAL", name: "Global" }, { code: "POST_SOVIET", name: "Post-Soviet" }],
  topics: [{ slug: "space", name: "Space", group: "Science", level: "A", target_questions: 15 }],
};

const question = (overrides: Partial<Question> = {}): Question =>
  QuestionSchema.parse({
    id: "q-ru-1",
    language: "ru",
    origin_language: "ru",
    culture_specificity: "GLOBAL",
    text: "Вопрос?",
    options: [
      { key: "A", text: "Да", correct: true },
      { key: "B", text: "Нет", distractor: "PLAUSIBLE" },
      { key: "C", text: "Может быть", distractor: "PLAUSIBLE" },
      { key: "D", text: "Не знаю", distractor: "PLAUSIBLE" },
    ],
    explanation: "Потому что.",
    topics: { space: 1 },
    contexts: { GLOBAL: 1 },
    difficulty: 2,
    dignity: 4,
    effects: { SHARED_KNOWLEDGE: 1 },
    status: "DRAFT",
    generation_method: "AI",
    ...overrides,
  });

const file = (questions: Question[], verifiedSource = false): LoadedFile[] => [
  {
    path: "test.yaml",
    families: [
      {
        family: "fam",
        name: "Family",
        facts: [
          {
            id: "fact",
            statement: "Statement",
            time_sensitive: false,
            sources: [{ name: "Source", type: "REFERENCE", verified: verifiedSource }],
            questions,
          },
        ],
      },
    ],
  },
];

const errors = (files: LoadedFile[]) => checkContent(files, taxonomy).filter((i) => i.level === "error").map((i) => i.message);

describe("checkContent", () => {
  it("accepts a valid draft", () => {
    expect(errors(file([question()]))).toEqual([]);
  });

  it("requires exactly one correct option", () => {
    const q = question();
    q.options[1] = { key: "B", text: "Нет", correct: true };
    expect(errors(file([q]))).toContainEqual(expect.stringContaining("exactly 1 correct"));
  });

  it("forbids translating a LOCAL question (BR-127)", () => {
    const original = question({ culture_specificity: "LOCAL" });
    const translated = question({ id: "q-en-1", language: "en", culture_specificity: "LOCAL" });
    expect(errors(file([original, translated]))).toContainEqual(expect.stringContaining("BR-127"));
  });

  it("allows translating a GLOBAL question", () => {
    const translated = question({ id: "q-en-1", language: "en" });
    expect(errors(file([question(), translated]))).toEqual([]);
  });

  it("requires a human stamp and a verified source before APPROVED (BR-130)", () => {
    const msgs = errors(file([question({ status: "APPROVED" })]));
    expect(msgs).toContainEqual(expect.stringContaining("reviewed"));
    expect(msgs).toContainEqual(expect.stringContaining("verified source"));

    const ok = question({ status: "APPROVED", reviewed: { by: "editor", at: "2026-10-01" } });
    expect(errors(file([ok], true))).toEqual([]);
  });

  it("rejects unknown topics and contexts", () => {
    const msgs = errors(file([question({ topics: { nope: 1 }, contexts: { MARS: 1 } })]));
    expect(msgs).toContainEqual(expect.stringContaining('unknown topic "nope"'));
    expect(msgs).toContainEqual(expect.stringContaining('unknown context "MARS"'));
  });

  it("rejects duplicate question ids across facts", () => {
    const files = file([question()]);
    files[0].families[0].facts.push({ ...files[0].families[0].facts[0], id: "fact-2" });
    expect(errors(files)).toContainEqual(expect.stringContaining('duplicate question id "q-ru-1"'));
  });
});
