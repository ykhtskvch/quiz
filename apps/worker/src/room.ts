// RoomDO — one Durable Object per room; the single source of truth (09-system-design §6).
// M1: one hardcoded question, host-driven Start / Reveal, no timers yet.
import { DurableObject } from "cloudflare:workers";
import {
  DEMO_QUESTION,
  NICKNAME_MAX,
  type OptionKey,
  type PublicPlayer,
  type PublicQuestion,
  type Reveal,
  type RoomStatus,
  type ServerEvent,
  type Snapshot,
} from "@quiz/shared";

export interface Env {
  ROOMS: DurableObjectNamespace<RoomDO>;
}

type Player = { id: string; nickname: string; tokenHash: string; isHost: boolean; joinedAt: number };

type QuestionState = {
  number: number;
  id: string;
  text: string;
  options: { key: OptionKey; text: string }[];
  correctKey: OptionKey;
  explanation: string;
  phase: "ANSWERING" | "REVEALED";
  answers: Record<string, OptionKey>; // playerId → key
};

type State = {
  code: string;
  createdAt: number;
  status: RoomStatus;
  displayTokenHash: string;
  players: Player[];
  question: QuestionState | null;
  seq: number;
};

type Viewer = { role: "display" } | { role: "player"; player: Player };
type Attachment = { role: "display" } | { role: "player"; playerId: string };

export type Result<T> = { ok: true; value: T } | { ok: false; status: 400 | 401 | 403 | 404 | 409; error: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (status: 400 | 401 | 403 | 404 | 409, error: string): Result<never> => ({ ok: false, status, error });

// WebSocket close codes for clients: auth failure and unknown room.
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_NOT_FOUND = 4404;
const MIN_PLAYERS_TO_START = 2; // D-12

export class RoomDO extends DurableObject<Env> {
  private state: State | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<State>("state")) ?? null;
    });
  }

  // ---------- commands (RPC from the Worker) ----------

  async init(code: string): Promise<Result<{ displayToken: string }>> {
    if (this.state) return fail(409, "room exists");
    const displayToken = randomToken();
    this.state = {
      code,
      createdAt: Date.now(),
      status: "WAITING",
      displayTokenHash: await sha256(displayToken),
      players: [],
      question: null,
      seq: 0,
    };
    await this.save();
    return ok({ displayToken });
  }

  async join(rawNickname: string): Promise<Result<{ playerId: string; playerToken: string; isHost: boolean }>> {
    const s = this.state;
    if (!s) return fail(404, "room not found");
    const base = rawNickname.trim().replace(/\s+/g, " ").slice(0, NICKNAME_MAX);
    if (!base) return fail(400, "nickname required");

    let nickname = base;
    for (let i = 2; s.players.some((p) => p.nickname.toLowerCase() === nickname.toLowerCase()); i++) {
      nickname = `${base} ${i}`;
    }
    const playerToken = randomToken();
    // M1: the first player to join becomes host; the creating device is the shared display.
    const player: Player = {
      id: crypto.randomUUID(),
      nickname,
      tokenHash: await sha256(playerToken),
      isHost: s.players.length === 0,
      joinedAt: Date.now(),
    };
    s.players.push(player);
    await this.save();
    this.broadcast({ type: "PLAYER_JOINED", seq: this.nextSeq(), payload: { player: this.publicPlayer(player) } });
    return ok({ playerId: player.id, playerToken, isHost: player.isHost });
  }

  async start(token: string): Promise<Result<{ started: true }>> {
    const host = await this.requireHost(token);
    if (!host.ok) return host;
    const s = this.state!;
    if (s.question?.phase === "ANSWERING") return fail(409, "question in progress");
    if (s.players.length < MIN_PLAYERS_TO_START) return fail(409, `need at least ${MIN_PLAYERS_TO_START} players`);

    s.status = "ACTIVE";
    s.question = {
      ...DEMO_QUESTION,
      number: (s.question?.number ?? 0) + 1,
      phase: "ANSWERING",
      answers: {},
    };
    await this.save();
    this.broadcast({ type: "QUESTION_PRESENTED", seq: this.nextSeq(), payload: { question: this.publicQuestion()! } });
    return ok({ started: true });
  }

  async answer(token: string, optionKey: OptionKey): Promise<Result<{ optionKey: OptionKey }>> {
    const viewer = await this.authenticate(token);
    if (!viewer || viewer.role !== "player") return fail(401, "invalid token");
    const q = this.state!.question;
    if (!q || q.phase !== "ANSWERING") return fail(409, "question closed");
    if (!q.options.some((o) => o.key === optionKey)) return fail(400, "unknown option");

    // Idempotent: a repeated tap returns the first accepted answer (07-api §7.3).
    const existing = q.answers[viewer.player.id];
    if (existing) return ok({ optionKey: existing });

    q.answers[viewer.player.id] = optionKey;
    await this.save();
    this.sendToPlayer(viewer.player.id, { type: "ANSWER_ACCEPTED", payload: { optionKey } });
    const counts = this.answerCounts();
    this.broadcast({ type: "ANSWER_COUNT_UPDATED", seq: this.nextSeq(), payload: counts });
    if (counts.activePlayers > 0 && this.connectedPlayerIds().every((id) => q.answers[id])) await this.doReveal();
    return ok({ optionKey });
  }

  async reveal(token: string): Promise<Result<{ revealed: true }>> {
    const host = await this.requireHost(token);
    if (!host.ok) return host;
    if (this.state!.question?.phase !== "ANSWERING") return fail(409, "nothing to reveal");
    await this.doReveal();
    return ok({ revealed: true });
  }

  async snapshotFor(token: string): Promise<Result<Snapshot>> {
    if (!this.state) return fail(404, "room not found");
    const viewer = await this.authenticate(token);
    if (!viewer) return fail(401, "invalid token");
    return ok(this.snapshot(viewer));
  }

  // ---------- WebSocket (hibernation API) ----------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();

    const token = new URL(request.url).searchParams.get("token") ?? "";
    const viewer = this.state ? await this.authenticate(token) : null;
    if (!viewer) {
      // Accept-then-close lets the browser see a meaningful close code instead of a bare 1006.
      server.accept();
      server.close(this.state ? CLOSE_UNAUTHORIZED : CLOSE_NOT_FOUND, this.state ? "unauthorized" : "room not found");
      return new Response(null, { status: 101, webSocket: client });
    }

    const attachment: Attachment = viewer.role === "display" ? { role: "display" } : { role: "player", playerId: viewer.player.id };
    const tags = viewer.role === "display" ? ["display"] : ["player", viewer.player.id];
    this.ctx.acceptWebSocket(server, tags);
    server.serializeAttachment(attachment);

    const wasConnected = viewer.role === "player" && this.socketsOf(viewer.player.id, server).length > 0;
    server.send(JSON.stringify({ type: "SNAPSHOT", payload: this.snapshot(viewer) } satisfies ServerEvent));
    if (viewer.role === "player" && !wasConnected) {
      this.broadcast({ type: "PLAYER_PRESENCE", seq: this.nextSeq(), payload: { playerId: viewer.player.id, connected: true } });
      this.broadcastCounts();
      await this.save();
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;
    let msg: unknown;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if ((msg as { type?: string })?.type !== "SYNC") return;
    const viewer = this.viewerOf(ws);
    if (viewer) ws.send(JSON.stringify({ type: "SNAPSHOT", payload: this.snapshot(viewer) } satisfies ServerEvent));
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
    const a = ws.deserializeAttachment() as Attachment | null;
    if (a?.role !== "player" || !this.state) return;
    if (this.socketsOf(a.playerId, ws).length > 0) return; // another tab of the same player is still open
    this.broadcast({ type: "PLAYER_PRESENCE", seq: this.nextSeq(), payload: { playerId: a.playerId, connected: false } });
    this.broadcastCounts();
    await this.save();
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws, 1011, "error");
  }

  // ---------- internals ----------

  private async doReveal() {
    const q = this.state!.question!;
    q.phase = "REVEALED";
    await this.save();
    this.broadcast({ type: "QUESTION_REVEALED", seq: this.nextSeq(), payload: this.revealData()! });
    for (const [playerId, key] of Object.entries(q.answers)) {
      this.sendToPlayer(playerId, { type: "PERSONAL_RESULT", payload: { correct: key === q.correctKey } });
    }
  }

  private async authenticate(token: string): Promise<Viewer | null> {
    const s = this.state;
    if (!s || !token) return null;
    const h = await sha256(token);
    if (h === s.displayTokenHash) return { role: "display" };
    const player = s.players.find((p) => p.tokenHash === h);
    return player ? { role: "player", player } : null;
  }

  private async requireHost(token: string): Promise<Result<Player>> {
    if (!this.state) return fail(404, "room not found");
    const viewer = await this.authenticate(token);
    if (!viewer || viewer.role !== "player") return fail(401, "invalid token");
    if (!viewer.player.isHost) return fail(403, "host only");
    return ok(viewer.player);
  }

  private viewerOf(ws: WebSocket): Viewer | null {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a) return null;
    if (a.role === "display") return { role: "display" };
    const player = this.state?.players.find((p) => p.id === a.playerId);
    return player ? { role: "player", player } : null;
  }

  private socketsOf(playerId: string, except: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets(playerId).filter((s) => s !== except && s.readyState === WebSocket.OPEN);
  }

  private connectedPlayerIds(): string[] {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets("player")) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a?.role === "player" && ws.readyState === WebSocket.OPEN) ids.add(a.playerId);
    }
    return [...ids];
  }

  private answerCounts() {
    const q = this.state!.question;
    return { answered: q ? Object.keys(q.answers).length : 0, activePlayers: this.connectedPlayerIds().length };
  }

  private broadcastCounts() {
    if (this.state?.question?.phase === "ANSWERING") {
      this.broadcast({ type: "ANSWER_COUNT_UPDATED", seq: this.nextSeq(), payload: this.answerCounts() });
    }
  }

  private publicPlayer(p: Player): PublicPlayer {
    return { id: p.id, nickname: p.nickname, isHost: p.isHost, connected: this.connectedPlayerIds().includes(p.id) };
  }

  /** The privacy boundary: never includes correctKey or individual answers. */
  private publicQuestion(): PublicQuestion | null {
    const q = this.state?.question;
    if (!q) return null;
    return { id: q.id, number: q.number, text: q.text, options: q.options, phase: q.phase, ...this.answerCounts() };
  }

  private revealData(): Reveal | null {
    const q = this.state?.question;
    if (!q || q.phase !== "REVEALED") return null;
    const distribution: Record<OptionKey, number> = { A: 0, B: 0, C: 0, D: 0 };
    for (const key of Object.values(q.answers)) distribution[key]++;
    return { correctKey: q.correctKey, explanation: q.explanation, distribution };
  }

  private snapshot(viewer: Viewer): Snapshot {
    const s = this.state!;
    const q = s.question;
    const mine =
      viewer.role === "player" && q
        ? {
            answer: q.answers[viewer.player.id] ?? null,
            correct: q.phase === "REVEALED" && q.answers[viewer.player.id] ? q.answers[viewer.player.id] === q.correctKey : null,
          }
        : null;
    return {
      you:
        viewer.role === "display"
          ? { role: "display" }
          : { role: "player", playerId: viewer.player.id, nickname: viewer.player.nickname, isHost: viewer.player.isHost },
      room: { code: s.code, status: s.status, players: s.players.map((p) => this.publicPlayer(p)) },
      question: this.publicQuestion(),
      reveal: this.revealData(),
      mine,
      seq: s.seq,
    };
  }

  private nextSeq(): number {
    return ++this.state!.seq;
  }

  private broadcast(event: ServerEvent) {
    const data = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {
        // socket closing; presence is handled in webSocketClose
      }
    }
  }

  private sendToPlayer(playerId: string, event: ServerEvent) {
    const data = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets(playerId)) {
      try {
        ws.send(data);
      } catch {
        // ignore
      }
    }
  }

  private async save() {
    await this.ctx.storage.put("state", this.state);
  }
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
