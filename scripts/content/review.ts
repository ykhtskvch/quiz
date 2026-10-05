// Local review tool for the question bank (EPIC 35, step 3 of the content pipeline).
//   npm run content:review   →  http://127.0.0.1:4400
// Reads content/families/*.yaml, shows question cards, writes edits back with the YAML document
// API (comments kept), and validates after every save. Binds to localhost only.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument, type Document } from "yaml";
import { checkContent, ContentFileSchema, type LoadedFile } from "../../packages/content-schema/src/index.ts";
import { FAMILIES_DIR, loadTaxonomy } from "./lib/load.ts";

const PORT = 4400;
const here = path.dirname(fileURLToPath(import.meta.url));
const taxonomy = loadTaxonomy();

type Located = { file: string; path: (string | number)[]; factPath: (string | number)[] };

function files(): string[] {
  return readdirSync(FAMILIES_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => path.join(FAMILIES_DIR, f));
}

/** Share of simulated games each question appears in (`npm run content:priority`); empty if never run. */
function priorities(): Map<string, number> {
  const file = path.join(FAMILIES_DIR, "..", "review-priority.json");
  if (!existsSync(file)) return new Map();
  const { items } = JSON.parse(readFileSync(file, "utf8")) as { items: { id: string; share: number }[] };
  return new Map(items.map((i) => [i.id, i.share]));
}

function readDoc(file: string): Document {
  return parseDocument(readFileSync(file, "utf8"));
}

/** All questions with where they live in their file. */
function index(): { items: unknown[]; where: Map<string, Located>; issues: Map<string, string[]> } {
  const items: unknown[] = [];
  const where = new Map<string, Located>();
  const loaded: LoadedFile[] = [];
  const share = priorities();
  for (const file of files()) {
    const raw = readDoc(file).toJS();
    const parsed = ContentFileSchema.safeParse(raw);
    if (parsed.success) loaded.push({ path: file, families: parsed.data.families });
    (raw?.families ?? []).forEach((family: any, fi: number) =>
      (family.facts ?? []).forEach((fact: any, fa: number) =>
        (fact.questions ?? []).forEach((q: any, qi: number) => {
          const factPath = ["families", fi, "facts", fa];
          where.set(q.id, { file, path: [...factPath, "questions", qi], factPath });
          items.push({
            file: path.basename(file),
            family: family.name,
            factId: fact.id,
            statement: fact.statement,
            sources: fact.sources ?? [],
            timeSensitive: Boolean(fact.time_sensitive),
            share: share.get(q.id) ?? 0,
            ...q,
          });
        }),
      ),
    );
  }
  const issues = new Map<string, string[]>();
  for (const i of checkContent(loaded, taxonomy)) {
    const id = i.where.split(" › ").at(-1)!;
    issues.set(id, [...(issues.get(id) ?? []), `${i.level === "error" ? "Ошибка" : "Замечание"}: ${i.message}`]);
  }
  return { items, where, issues };
}

type Edit = {
  action: "save" | "approve" | "retire";
  reviewer?: string;
  text?: string;
  explanation?: string;
  statement?: string;
  options?: { key: string; text: string }[];
  correctKey?: string;
  difficulty?: number;
  dignity?: number;
  /** 1–5, or 0 to clear. */
  rating?: number;
  sourceUrl?: string;
  clearNotes?: boolean;
  note?: string;
};

function applyEdit(id: string, e: Edit): { ok: boolean; error?: string } {
  const loc = index().where.get(id);
  if (!loc) return { ok: false, error: "question not found" };
  const doc = readDoc(loc.file);
  const q = (k: string | number, ...rest: (string | number)[]) => [...loc.path, k, ...rest];

  if (e.text !== undefined) doc.setIn(q("text"), e.text.trim());
  if (e.explanation !== undefined) doc.setIn(q("explanation"), e.explanation.trim());
  if (e.statement !== undefined) doc.setIn([...loc.factPath, "statement"], e.statement.trim());
  if (e.difficulty) doc.setIn(q("difficulty"), e.difficulty);
  if (e.dignity) doc.setIn(q("dignity"), e.dignity);
  if (e.rating) doc.setIn(q("editor_rating"), e.rating);
  else if (e.rating === 0) doc.deleteIn(q("editor_rating"));
  if (e.options) {
    e.options.forEach((o, i) => doc.setIn(q("options", i, "text"), o.text.trim()));
  }
  if (e.correctKey) {
    const opts = doc.getIn(q("options")) as { items: unknown[] } | undefined;
    const n = opts?.items.length ?? 0;
    for (let i = 0; i < n; i++) {
      const key = doc.getIn(q("options", i, "key"));
      if (key === e.correctKey) {
        doc.deleteIn(q("options", i, "distractor"));
        doc.setIn(q("options", i, "correct"), true);
      } else if (doc.getIn(q("options", i, "correct"))) {
        doc.deleteIn(q("options", i, "correct"));
        doc.setIn(q("options", i, "distractor"), "PLAUSIBLE");
      }
    }
  }
  if (e.sourceUrl !== undefined && e.sourceUrl.trim()) {
    if (!doc.getIn([...loc.factPath, "sources", 0])) {
      doc.setIn([...loc.factPath, "sources"], doc.createNode([{ name: "Источник", type: "REFERENCE", verified: false }]));
    }
    doc.setIn([...loc.factPath, "sources", 0, "url"], e.sourceUrl.trim());
  }
  if (e.note?.trim()) {
    const notes = (doc.getIn(q("review_notes")) as { toJSON(): string[] } | undefined)?.toJSON() ?? [];
    doc.setIn(q("review_notes"), doc.createNode([...notes, `Редактор: ${e.note.trim()}`]));
  }
  if (e.clearNotes) doc.deleteIn(q("review_notes"));

  const stamp = () => doc.setIn(q("reviewed"), doc.createNode({ by: e.reviewer || "editor", at: new Date().toISOString().slice(0, 10) }));
  if (e.action === "approve") {
    if (!e.reviewer?.trim()) return { ok: false, error: "укажи, кто проверяет" };
    // Approving means the reviewer opened the source and confirmed the fact (BR-130).
    if (!doc.getIn([...loc.factPath, "sources", 0])) return { ok: false, error: "нужен источник" };
    doc.setIn([...loc.factPath, "sources", 0, "verified"], true);
    doc.deleteIn(q("review_notes"));
    doc.setIn(q("status"), "APPROVED");
    stamp();
  } else if (e.action === "retire") {
    doc.setIn(q("status"), "RETIRED");
    stamp();
  }
  writeFileSync(loc.file, doc.toString({ lineWidth: 0 }));
  return { ok: true };
}

// ---------- http ----------

async function body(req: IncomingMessage): Promise<unknown> {
  let s = "";
  for await (const chunk of req) s += chunk;
  return s ? JSON.parse(s) : {};
}

function send(res: ServerResponse, status: number, data: unknown, type = "application/json") {
  res.writeHead(status, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" });
  res.end(typeof data === "string" ? data : JSON.stringify(data));
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, readFileSync(path.join(here, "review.html"), "utf8"), "text/html");
    if (req.method === "GET" && url.pathname === "/api/questions") {
      const { items, issues } = index();
      return send(res, 200, { items, issues: Object.fromEntries(issues) });
    }
    const m = url.pathname.match(/^\/api\/questions\/([a-z0-9-]+)$/);
    if (req.method === "POST" && m) {
      const r = applyEdit(m[1], (await body(req)) as Edit);
      return send(res, r.ok ? 200 : 400, r);
    }
    send(res, 404, { error: "not found" });
  } catch (err) {
    send(res, 500, { error: String(err) });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Review: http://127.0.0.1:${PORT}`));
