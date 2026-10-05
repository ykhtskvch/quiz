// End-to-end smoke test of the M1 room flow against a running worker.
//   node scripts/dev/smoke.ts [http://localhost:8787]
// Checks: create → 2 players join → display sees them → start → answers → auto-reveal,
// and that the display never receives the correct answer before reveal.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ServerEvent } from "../../packages/shared/src/index.ts";

/** Reads the local analytics D1 that `wrangler dev` writes to (skipped with --no-db). */
const checkDb = !process.argv.includes("--no-db");
// Async on purpose: a blocking exec stalls the event loop, so pooled keep-alive sockets the server
// closed meanwhile get reused and the next fetch fails with ECONNRESET.
async function d1Count(sql: string): Promise<number> {
  const { stdout } = await promisify(execFile)("npx", ["wrangler", "d1", "execute", "quiz-analytics", "--local", "--json", "--command", sql], {
    cwd: "apps/worker",
    encoding: "utf8",
  });
  return Number(Object.values((JSON.parse(stdout) as { results: Record<string, number>[] }[])[0].results[0])[0]);
}

const BASE = process.argv.slice(2).find((a) => a.startsWith("http")) ?? "http://localhost:8787";
const WS_BASE = BASE.replace(/^http/, "ws");

async function api<T>(path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}/api${path}`, {
    method: init.method ?? "POST",
    headers: { "Content-Type": "application/json", ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

class Client {
  events: ServerEvent[] = [];
  raw: string[] = [];
  closeCode: number | null = null;
  private ws: WebSocket;
  constructor(code: string, token: string) {
    this.ws = new WebSocket(`${WS_BASE}/api/rooms/${code}/ws?token=${encodeURIComponent(token)}`);
    this.ws.onmessage = (e) => {
      this.raw.push(String(e.data));
      this.events.push(JSON.parse(String(e.data)));
    };
    this.ws.onclose = (e) => (this.closeCode = e.code);
  }
  /** Waits for the first event of `type` at index ≥ `from` (use `mark()` to get the current index). */
  async waitFor<T extends ServerEvent["type"]>(type: T, timeoutMs = 3000, from = 0): Promise<Extract<ServerEvent, { type: T }>> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const e = this.events.slice(from).find((x) => x.type === type);
      if (e) return e as Extract<ServerEvent, { type: T }>;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`timeout waiting for ${type}; got ${this.events.map((e) => e.type).join(",")}`);
  }
  async waitClosed(timeoutMs = 3000) {
    const start = Date.now();
    while (this.closeCode === null && Date.now() - start < timeoutMs) await new Promise((r) => setTimeout(r, 20));
    return this.closeCode;
  }
  mark() {
    return this.events.length;
  }
  close() {
    this.ws.close();
  }
}

let failures = 0;
const check = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures++;
};

const playedBefore = checkDb ? await d1Count("SELECT COALESCE(SUM(times_played),0) FROM question_stats") : 0;
const LANG = process.argv.includes("--en") ? "en" : "ru";
const created = await api<{ roomCode: string; displayToken: string; language: string }>("/rooms", { body: { language: LANG } });
check(created.body.language === LANG, `room language is ${LANG}`);
check(created.status === 201 && /^[A-Z2-9]{6}$/.test(created.body.roomCode), `room created: ${created.body.roomCode}`);
const code = created.body.roomCode;

const display = new Client(code, created.body.displayToken);
await display.waitFor("SNAPSHOT");

const bad = new Client(code, "wrong-token");
check((await bad.waitClosed()) === 4401, "bad token is rejected with close code 4401");
const missing = new Client("ZZZZZZ", "x");
check((await missing.waitClosed()) === 4404, "unknown room is rejected with close code 4404");

type Joined = { playerId: string; playerToken: string; isHost: boolean };
const anna = (await api<Joined>(`/rooms/${code}/players`, { body: { nickname: "Аня" } })).body;

const max = (await api<Joined>(`/rooms/${code}/players`, { body: { nickname: "Макс" } })).body;
check(anna.isHost && !max.isHost, "first player is host");

const annaWs = new Client(code, anna.playerToken);
const maxWs = new Client(code, max.playerToken);
await annaWs.waitFor("SNAPSHOT");
await maxWs.waitFor("SNAPSHOT");

// ---- private onboarding ----
const badOnb = await api(`/rooms/${code}/onboarding`, { token: anna.playerToken, body: { ageBand: "35_44", topics: [], dignity: "POP" } });
check(badOnb.status === 400, "onboarding without topics is rejected (400)");
const notReady = await api(`/rooms/${code}/start`, { token: anna.playerToken });
check(notReady.status === 409, "start is rejected until 2 players finish onboarding");
const onb = (ageBand: string, slug: string) => ({
  ageBand,
  topics: [{ slug, preference: "LIKE", depth: "EXPERT" }, { slug: "football", preference: "LESS_OF" }],
  backgrounds: ["POST_SOVIET"],
  dignity: "POP",
});
const o1 = await api(`/rooms/${code}/onboarding`, { token: anna.playerToken, body: onb("13_17", "ru-pop-00s") });
const o2 = await api(`/rooms/${code}/onboarding`, { token: max.playerToken, body: onb("35_44", "space") });
check(o1.status === 200 && o2.status === 200, "both players submit onboarding");
await new Promise((r) => setTimeout(r, 200));
const leaked = display.raw.some((r) => /13_17|POST_SOVIET|ru-pop-00s|LESS_OF/.test(r));
check(!leaked, "display never receives anyone's onboarding answers");
const statusEvents = display.events.filter((e) => e.type === "PLAYER_STATUS");
check(statusEvents.length >= 2, "display only learns that players are ready");

const notHost = await api(`/rooms/${code}/start`, { token: max.playerToken });
check(notHost.status === 403, `non-host cannot start (status ${notHost.status})`);
const started = await api(`/rooms/${code}/start`, { token: anna.playerToken });
check(started.status === 200, "host starts the game");

// ---- question 1: presentation → answering → all answered → reveal ----
const presented = await display.waitFor("QUESTION_PRESENTED");
check(presented.payload.question.options === null, "options are hidden while the question is being read");
const cyrillic = /[А-Яа-яЁё]/.test(presented.payload.question.text);
check(LANG === "en" ? !cyrillic : cyrillic, `question is in ${LANG}: «${presented.payload.question.text.slice(0, 60)}…»`);
const early = await api(`/rooms/${code}/answers`, { token: anna.playerToken, body: { optionKey: "B" } });
check(early.status === 409, "answers are rejected during the presentation phase");

const opened = await display.waitFor("ANSWER_PHASE_STARTED", 10_000);
check(opened.payload.options.length === 4 && opened.payload.timing.durationMs === 15_000, "answer phase opens with 4 options and a 15 s timer");
check(!display.raw.some((r) => r.includes("correctKey") && !r.includes("QUESTION_REVEALED")), "display has no correctKey before reveal");

const a1 = await api<{ optionKey: string }>(`/rooms/${code}/answers`, { token: anna.playerToken, body: { optionKey: "B" } });
const a1again = await api<{ optionKey: string }>(`/rooms/${code}/answers`, { token: anna.playerToken, body: { optionKey: "C" } });
check(a1.status === 200 && a1again.body.optionKey === "B", "second tap keeps the first answer");
// Options are shuffled per showing, so correctness is checked against what the server reveals.
await annaWs.waitFor("ANSWER_ACCEPTED");
await api(`/rooms/${code}/answers`, { token: max.playerToken, body: { optionKey: "A" } });

const revealed = await display.waitFor("QUESTION_REVEALED");
const { reveal } = revealed.payload;
check(reveal.distribution.A === 1 && reveal.distribution.B === 1, `auto-reveal when all answered, distribution A1 B1 (correct: ${reveal.correctKey})`);
const annaResult = await annaWs.waitFor("PERSONAL_RESULT");
const maxResult = await maxWs.waitFor("PERSONAL_RESULT");
const annaRight = reveal.correctKey === "B";
const maxRight = reveal.correctKey === "A";
const pts = annaResult.payload.result.points;
// 3 / 2 / 1 for a right answer depending on speed, 0 for a wrong one.
const validPoints = (right: boolean, p: number) => (right ? [1, 2, 3].includes(p) : p === 0);
check(annaResult.payload.result.correct === annaRight && validPoints(annaRight, pts), `Аня: ${annaRight ? "correct" : "wrong"}, ${pts} points`);
check(maxResult.payload.result.correct === maxRight && validPoints(maxRight, maxResult.payload.result.points), `Макс: ${maxRight ? "correct" : "wrong"}, ${maxResult.payload.result.points} points`);
check(!display.events.some((e) => e.type === "PERSONAL_RESULT" || e.type === "ANSWER_ACCEPTED"), "display gets no private events");
check(![...display.raw, ...annaWs.raw].some((r) => /heroPlayerId|"selection"|composition/.test(r)), "no engine internals reach any client");

// ---- question 2: pause / resume / skip ----
const m2 = display.mark();
await display.waitFor("QUESTION_PRESENTED", 15_000, m2);
check(true, "next question presented automatically after the reveal");
const paused = await api(`/rooms/${code}/pause`, { token: anna.playerToken });
const pausedEvt = await display.waitFor("GAME_PAUSED", 3000, m2);
check(paused.status === 200 && pausedEvt.payload.timing?.paused === true, "host pauses; timing is frozen");
await new Promise((r) => setTimeout(r, 1000));
await api(`/rooms/${code}/resume`, { token: anna.playerToken });
await display.waitFor("GAME_RESUMED", 3000, m2);
const skipped = await api(`/rooms/${code}/skip`, { token: anna.playerToken });
await display.waitFor("QUESTION_SKIPPED", 3000, m2);
check(skipped.status === 200, "host skips the question");

// ---- question 3, then end ----
const m3 = display.mark();
await display.waitFor("QUESTION_PRESENTED", 5000, m3);
const ended = await api(`/rooms/${code}/end`, { token: anna.playerToken });
const finished = await display.waitFor("GAME_FINISHED", 3000, m3);
const { results } = finished.payload;
check(ended.status === 200 && results.questionsPlayed === 1, `end mid-question: ${results.questionsPlayed} question counted`);
const top = Math.max(pts, maxResult.payload.result.points);
check(results.leaderboard[0].score === top && results.leaderboard.length === 2, `leaderboard: winner has ${top} points`);
check(results.stats.onlyOneKnew === null, "single-person stat hidden in a 2-player room");

const seqs = display.events.flatMap((e) => ("seq" in e ? [e.seq] : []));
check(seqs.every((x, i) => i === 0 || x === seqs[i - 1] + 1), `display seq is gapless (${seqs.length} events)`);

// ---- offboarding and anonymous analytics ----
const feedbackBefore = checkDb ? await d1Count("SELECT COUNT(*) FROM session_feedback") : 0;
const noKpi = await api(`/rooms/${code}/feedback`, { token: anna.playerToken, body: { difficulty: "JUST_RIGHT" } });
check(noKpi.status === 400, "feedback without the play-again answer is rejected");
const fb = await api(`/rooms/${code}/feedback`, { token: anna.playerToken, body: { playAgain: "YES", difficulty: "JUST_RIGHT", culturalBalance: "MORE_POP" } });
const fb2 = await api(`/rooms/${code}/feedback`, { token: max.playerToken, body: { playAgain: "MAYBE" } });
check(fb.status === 200 && fb2.status === 200, "both players send offboarding");
const rated = await api(`/rooms/${code}/question-feedback`, { token: anna.playerToken, body: { number: 1, rating: "GREAT" } });
check(rated.status === 200, "a player rates a played question");
if (checkDb) {
  await new Promise((r) => setTimeout(r, 800)); // analytics are written off the gameplay path
  check((await d1Count("SELECT COUNT(*) FROM session_feedback")) === feedbackBefore + 2, "two anonymous feedback rows reached D1");
  check((await d1Count("SELECT COALESCE(SUM(times_played),0) FROM question_stats")) === playedBefore + 1, "question stats reached D1");
  check((await d1Count("SELECT COUNT(*) FROM session_feedback WHERE game_uid LIKE '%" + code + "%'")) === 0, "D1 rows are not linked to the room code");
}

maxWs.close();
const status = await display.waitFor("PLAYER_STATUS", 3000, display.mark());
check(status.payload.status === "DISCONNECTED", "display sees a player go offline");

for (const c of [display, annaWs]) c.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
