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
  async waitFor(type: ServerEvent["type"], timeoutMs = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const e = this.events.find((x) => x.type === type);
      if (e) return e;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`timeout waiting for ${type}; got ${this.events.map((e) => e.type).join(",")}`);
  }
  async waitClosed(timeoutMs = 3000) {
    const start = Date.now();
    while (this.closeCode === null && Date.now() - start < timeoutMs) await new Promise((r) => setTimeout(r, 20));
    return this.closeCode;
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
const alone = await api(`/rooms/${code}/start`, { token: anna.playerToken });
check(alone.status === 409, `start is rejected with fewer than 2 players (status ${alone.status})`);

const max = (await api<Joined>(`/rooms/${code}/players`, { body: { nickname: "Макс" } })).body;
check(anna.isHost && !max.isHost, "first player is host");

const annaWs = new Client(code, anna.playerToken);
const maxWs = new Client(code, max.playerToken);
await annaWs.waitFor("SNAPSHOT");
await maxWs.waitFor("SNAPSHOT");

const notHost = await api(`/rooms/${code}/start`, { token: max.playerToken });
check(notHost.status === 403, `non-host cannot start (status ${notHost.status})`);
const started = await api(`/rooms/${code}/start`, { token: anna.playerToken });
check(started.status === 200, "host starts the game");
await display.waitFor("QUESTION_PRESENTED");
check(!display.raw.some((r) => r.includes("correctKey") && !r.includes("QUESTION_REVEALED")), "display has no correctKey before reveal");

const a1 = await api<{ optionKey: string }>(`/rooms/${code}/answers`, { token: anna.playerToken, body: { optionKey: "B" } });
const a1again = await api<{ optionKey: string }>(`/rooms/${code}/answers`, { token: anna.playerToken, body: { optionKey: "C" } });
check(a1.status === 200 && a1again.body.optionKey === "B", "second tap keeps the first answer");
await annaWs.waitFor("ANSWER_ACCEPTED");

await api(`/rooms/${code}/answers`, { token: max.playerToken, body: { optionKey: "A" } });
const revealed = await display.waitFor("QUESTION_REVEALED");
if (revealed.type === "QUESTION_REVEALED") {
  check(revealed.payload.correctKey === "B" && revealed.payload.distribution.A === 1 && revealed.payload.distribution.B === 1, "auto-reveal when all answered, distribution A1 B1");
}
const annaResult = await annaWs.waitFor("PERSONAL_RESULT");
const maxResult = await maxWs.waitFor("PERSONAL_RESULT");
check(annaResult.type === "PERSONAL_RESULT" && annaResult.payload.correct, "Аня gets correct=true privately");
check(maxResult.type === "PERSONAL_RESULT" && !maxResult.payload.correct, "Макс gets correct=false privately");
check(!display.events.some((e) => e.type === "PERSONAL_RESULT" || e.type === "ANSWER_ACCEPTED"), "display gets no private events");

const seqs = display.events.flatMap((e) => ("seq" in e ? [e.seq] : []));
check(seqs.every((s, i) => i === 0 || s === seqs[i - 1] + 1), `display seq is gapless: ${seqs.join(",")}`);

maxWs.close();
const presence = await display.waitFor("PLAYER_PRESENCE").catch(() => null);
check(presence !== null, "display sees presence changes");

for (const c of [display, annaWs]) c.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
