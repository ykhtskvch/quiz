// RoomDO — one Durable Object per room (09-system-design §6). A thin adapter around the pure
// `Room` state machine: authenticates, persists state, drives the alarm and delivers effects.
import { DurableObject } from "cloudflare:workers";
import {
  DEFAULT_CONFIG,
  NICKNAME_MAX,
  type AnalyticsEvent,
  type HostCommand,
  type Language,
  type RoomInfo,
  type OnboardingInput,
  type OptionKey,
  type QuestionRating,
  type ServerEvent,
  type SessionFeedbackInput,
  type Snapshot,
} from "@quiz/shared";
import { BANK } from "@quiz/shared/bank-data";
import { availableTopics, DEFAULT_ENGINE_CONFIG } from "@quiz/engine";
import { writeAnalytics } from "./analytics.ts";
import { newRoomState, Room, ROOM_STATE_VERSION, type Effect, type Result, type RoomState, type Viewer } from "./game.ts";

export type { Result };

export interface Env {
  ROOMS: DurableObjectNamespace<RoomDO>;
  /** Anonymous analytics; optional so a missing binding never breaks gameplay. */
  DB?: D1Database;
}

type Attachment = { role: "display" } | { role: "player"; playerId: string };

// WebSocket close codes for clients: auth failure and unknown/closed room.
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_NOT_FOUND = 4404;

const fail = (status: 400 | 401 | 404, error: string): Result<never> => ({ ok: false, status, error });

export class RoomDO extends DurableObject<Env> {
  private state: RoomState | null = null;
  private readonly config = DEFAULT_CONFIG;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const stored = (await ctx.storage.get<RoomState>("state")) ?? null;
      if (stored && stored.version !== ROOM_STATE_VERSION) {
        // Written by an older deploy: we can't safely resume it, so the room is gone.
        await ctx.storage.deleteAll();
        this.state = null;
      } else {
        this.state = stored;
      }
    });
  }

  // ---------- commands (RPC from the Worker) ----------

  async init(code: string, language: Language): Promise<Result<{ displayToken: string }>> {
    if (this.state) return { ok: false, status: 409, error: "room exists" };
    const displayToken = randomToken();
    this.state = newRoomState(code, await sha256(displayToken), Date.now(), this.config, language);
    await this.commit(new Room(this.state, this.config));
    return { ok: true, value: { displayToken } };
  }

  /** Public pre-join info (language + topics that have content in it). */
  async info(): Promise<Result<RoomInfo>> {
    if (!this.live()) return fail(404, "room not found");
    const language = this.state!.language;
    return { ok: true, value: { language, topics: availableTopics(BANK, { ...DEFAULT_ENGINE_CONFIG, language }) } };
  }

  async join(rawNickname: string): Promise<Result<{ playerId: string; playerToken: string; isHost: boolean }>> {
    if (!this.live()) return fail(404, "room not found");
    const nickname = rawNickname.trim().replace(/\s+/g, " ").slice(0, NICKNAME_MAX);
    if (!nickname) return fail(400, "nickname required");
    const playerToken = randomToken();
    const room = this.room();
    const player = room.join(nickname, crypto.randomUUID(), await sha256(playerToken), Date.now());
    await this.commit(room);
    return { ok: true, value: { playerId: player.id, playerToken, isHost: player.isHost } };
  }

  async host(token: string, command: HostCommand): Promise<Result<true>> {
    const viewer = await this.authenticate(token);
    if (!viewer) return this.live() ? fail(401, "invalid token") : fail(404, "room not found");
    if (viewer.role !== "player") return { ok: false, status: 403, error: "host only" };
    const room = this.room();
    const now = Date.now();
    const id = viewer.player.id;
    const r = {
      start: () => room.start(id, now),
      pause: () => room.pause(id, now),
      resume: () => room.resume(id, now),
      skip: () => room.skip(id, now),
      end: () => room.end(id, now),
      "play-again": () => room.playAgain(id, now),
    }[command]();
    await this.commit(room);
    return r;
  }

  async onboarding(token: string, input: OnboardingInput): Promise<Result<true>> {
    const viewer = await this.authenticate(token);
    if (!viewer || viewer.role !== "player") return this.live() ? fail(401, "invalid token") : fail(404, "room not found");
    const room = this.room();
    const r = room.submitOnboarding(viewer.player.id, input, Date.now());
    await this.commit(room);
    return r;
  }

  async feedback(token: string, input: SessionFeedbackInput): Promise<Result<true>> {
    const viewer = await this.authenticate(token);
    if (!viewer || viewer.role !== "player") return this.live() ? fail(401, "invalid token") : fail(404, "room not found");
    const room = this.room();
    const r = room.submitFeedback(viewer.player.id, input, Date.now());
    await this.commit(room);
    return r;
  }

  async rate(token: string, number: number, rating: QuestionRating): Promise<Result<true>> {
    const viewer = await this.authenticate(token);
    if (!viewer || viewer.role !== "player") return this.live() ? fail(401, "invalid token") : fail(404, "room not found");
    const room = this.room();
    const r = room.rateQuestion(viewer.player.id, number, rating, Date.now());
    await this.commit(room);
    return r;
  }

  async answer(token: string, optionKey: OptionKey): Promise<Result<{ optionKey: OptionKey }>> {
    const viewer = await this.authenticate(token);
    if (!viewer || viewer.role !== "player") return this.live() ? fail(401, "invalid token") : fail(404, "room not found");
    const room = this.room();
    const r = room.answer(viewer.player.id, optionKey, Date.now());
    await this.commit(room);
    return r;
  }

  async snapshotFor(token: string): Promise<Result<Snapshot>> {
    if (!this.live()) return fail(404, "room not found");
    const viewer = await this.authenticate(token);
    if (!viewer) return fail(401, "invalid token");
    return { ok: true, value: this.room().snapshot(viewer, Date.now()) };
  }

  // ---------- timers ----------

  async alarm() {
    if (!this.state) return;
    const room = this.room();
    room.tick(Date.now());
    await this.commit(room);
  }

  // ---------- WebSocket (hibernation API) ----------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();

    const token = new URL(request.url).searchParams.get("token") ?? "";
    const viewer = await this.authenticate(token);
    if (!viewer) {
      // Accept-then-close lets the browser see a meaningful close code instead of a bare 1006.
      server.accept();
      server.close(this.live() ? CLOSE_UNAUTHORIZED : CLOSE_NOT_FOUND, this.live() ? "unauthorized" : "room not found");
      return new Response(null, { status: 101, webSocket: client });
    }

    const attachment: Attachment = viewer.role === "display" ? { role: "display" } : { role: "player", playerId: viewer.player.id };
    this.ctx.acceptWebSocket(server, viewer.role === "display" ? ["display"] : ["player", viewer.player.id]);
    server.serializeAttachment(attachment);

    const room = this.room();
    const now = Date.now();
    if (viewer.role === "player") room.connect(viewer.player.id, now);
    // The snapshot already reflects this connection; earlier effects carry lower seq numbers than it.
    server.send(JSON.stringify({ type: "SNAPSHOT", payload: room.snapshot(viewer, now) } satisfies ServerEvent));
    await this.commit(room, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;
    let msg: { type?: string } | null = null;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (msg?.type !== "SYNC" || !this.state) return;
    const viewer = this.viewerOf(ws);
    if (viewer) ws.send(JSON.stringify({ type: "SNAPSHOT", payload: this.room().snapshot(viewer, Date.now()) } satisfies ServerEvent));
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
    const a = ws.deserializeAttachment() as Attachment | null;
    if (a?.role !== "player" || !this.live()) return;
    const stillOpen = this.ctx.getWebSockets(a.playerId).some((s) => s !== ws && s.readyState === WebSocket.OPEN);
    if (stillOpen) return; // another tab of the same player
    const room = this.room();
    room.disconnect(a.playerId, Date.now());
    await this.commit(room);
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws, 1011, "error");
  }

  // ---------- internals ----------

  private room(): Room {
    return new Room(this.state!, this.config);
  }

  private live(): boolean {
    return Boolean(this.state && !this.state.closed);
  }

  /** Persist, deliver effects, reschedule the alarm. `skip` is a socket that already got a fresh snapshot. */
  private async commit(room: Room, skip?: WebSocket) {
    const analytics = room.effects.flatMap((e) => (e.to === "analytics" ? [e.event] : []));
    if (analytics.length) this.ctx.waitUntil(writeAnalytics(this.env.DB, analytics as AnalyticsEvent[]));
    if (room.s.closed) return this.closeRoom();
    await this.ctx.storage.put("state", room.s);
    for (const e of room.effects) this.deliver(e, skip);
    const next = room.nextAlarm();
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  private deliver(e: Effect, skip?: WebSocket) {
    if (e.to === "close" || e.to === "analytics") return;
    const sockets = e.to === "all" ? this.ctx.getWebSockets() : this.ctx.getWebSockets(e.playerId);
    const data = JSON.stringify(e.event);
    for (const ws of sockets) {
      if (ws === skip) continue;
      try {
        ws.send(data);
      } catch {
        // socket closing; presence is handled in webSocketClose
      }
    }
  }

  /** Room expiry: drop every trace of the players (Data Model §7). */
  private async closeRoom() {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(CLOSE_NOT_FOUND, "room closed");
      } catch {
        // ignore
      }
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    // Keep a tombstone in memory so a late request in this instance sees a closed room.
    this.state = { ...this.state!, closed: true, players: [], game: null };
  }

  private async authenticate(token: string): Promise<Viewer | null> {
    const s = this.state;
    if (!s || s.closed || !token) return null;
    const h = await sha256(token);
    if (h === s.displayTokenHash) return { role: "display" };
    const player = s.players.find((p) => p.tokenHash === h);
    return player ? { role: "player", player } : null;
  }

  private viewerOf(ws: WebSocket): Viewer | null {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a) return null;
    if (a.role === "display") return { role: "display" };
    const player = this.state?.players.find((p) => p.id === a.playerId);
    return player ? { role: "player", player } : null;
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
