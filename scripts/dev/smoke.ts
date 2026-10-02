// End-to-end smoke test of the M1 room flow against a running worker.
//   node scripts/dev/smoke.ts [http://localhost:8787]
// Checks: create → 2 players join → display sees them → start → answers → auto-reveal,
// and that the display never receives the correct answer before reveal.
import type { ServerEvent } from "../../packages/shared/src/index.ts";

const BASE = process.argv[2] ?? "http://localhost:8787";
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

const created = await api<{ roomCode: string; displayToken: string }>("/rooms");
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
const early = await api(`/rooms/${code}/answers`, { token: anna.playerToken, body: { optionKey: "B" } });
check(early.status === 409, "answers are rejected during the presentation phase");

const opened = await display.waitFor("ANSWER_PHASE_STARTED", 10_000);
check(opened.payload.options.length === 4 && opened.payload.timing.durationMs === 15_000, "answer phase opens with 4 options and a 15 s timer");
check(!display.raw.some((r) => r.includes("correctKey") && !r.includes("QUESTION_REVEALED")), "display has no correctKey before reveal");

const a1 = await api<{ optionKey: string }>(`/rooms/${code}/answers`, { token: anna.playerToken, body: { optionKey: "B" } });
const a1again = await api<{ optionKey: string }>(`/rooms/${code}/answers`, { token: anna.playerToken, body: { optionKey: "C" } });
check(a1.status === 200 && a1again.body.optionKey === "B", "second tap keeps the first answer");
await annaWs.waitFor("ANSWER_ACCEPTED");
await api(`/rooms/${code}/answers`, { token: max.playerToken, body: { optionKey: "A" } });

const revealed = await display.waitFor("QUESTION_REVEALED");
const { reveal } = revealed.payload;
check(reveal.correctKey === "B" && reveal.distribution.A === 1 && reveal.distribution.B === 1, "auto-reveal when all answered, distribution A1 B1");
const annaResult = await annaWs.waitFor("PERSONAL_RESULT");
const maxResult = await maxWs.waitFor("PERSONAL_RESULT");
const pts = annaResult.payload.result.points;
check(annaResult.payload.result.correct && pts > 1000 && pts <= 1150, `Аня: correct, ${pts} points (1000 + speed bonus)`);
check(!maxResult.payload.result.correct && maxResult.payload.result.points === 0, "Макс: wrong, 0 points");
check(!display.events.some((e) => e.type === "PERSONAL_RESULT" || e.type === "ANSWER_ACCEPTED"), "display gets no private events");

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
check(results.leaderboard[0].nickname === "Аня" && results.leaderboard[0].score === pts, "leaderboard: Аня first with her points");
check(results.stats.onlyOneKnew === null, "single-person stat hidden in a 2-player room");

const seqs = display.events.flatMap((e) => ("seq" in e ? [e.seq] : []));
check(seqs.every((x, i) => i === 0 || x === seqs[i - 1] + 1), `display seq is gapless (${seqs.length} events)`);

maxWs.close();
const status = await display.waitFor("PLAYER_STATUS", 3000, display.mark());
check(status.payload.status === "DISCONNECTED", "display sees a player go offline");

for (const c of [display, annaWs]) c.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
