// Worker entry: HTTP routing and room lookup. All room state lives in RoomDO.
import { Hono, type Context } from "hono";
import {
  isRoomCode,
  parseOnboarding,
  parseQuestionRating,
  parseSessionFeedback,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type HostCommand,
  type Language,
  LANGUAGES,
  type OptionKey,
} from "@quiz/shared";
import { RateLimiterDO } from "./limiter-do.ts";
import type { Bucket } from "./ratelimit.ts";
import { engineConfig } from "./deployment.ts";
import { RoomDO, type Env, type Result } from "./room.ts";

export { RateLimiterDO, RoomDO };

type C = Context<{ Bindings: Env }>;

const app = new Hono<{ Bindings: Env }>().basePath("/api");

const roomStub = (c: C, code: string) => c.env.ROOMS.get(c.env.ROOMS.idFromName(code));
const bearer = (c: C) => c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
const reply = <T>(c: C, r: Result<T>) => (r.ok ? c.json(r.value as object) : c.json({ error: r.error }, r.status));

// Rate limiting (NFR-016), keyed by client IP. Creating rooms is cheapest to abuse, so it gets the
// tightest limit; anything that addresses a room by code alone (lookup, join, socket, state) is what a
// code-guesser hits; token-authorised actions only need a flood guard.
const UNAUTHENTICATED_ROOM_PATHS = new Set([undefined, "players", "ws", "state"]);

function bucketFor(c: C): Bucket | undefined {
  const parts = c.req.path.split("/").filter(Boolean); // ["api", "rooms", code?, sub?]
  if (parts[1] !== "rooms") return undefined;
  if (parts.length === 2) return c.req.method === "POST" ? "create" : undefined;
  return UNAUTHENTICATED_ROOM_PATHS.has(parts[3]) ? "room" : "action";
}

app.use("*", async (c, next) => {
  const bucket = bucketFor(c);
  if (bucket && c.env.LIMITER) {
    const ip = c.req.header("CF-Connecting-IP") ?? "local";
    // Fail open: a hiccup in the counter must never stop a game.
    const allowed = await c.env.LIMITER.get(c.env.LIMITER.idFromName(ip)).hit(bucket).catch(() => true);
    if (!allowed) {
      c.header("Retry-After", "60");
      return c.json({ error: "too many requests" }, 429);
    }
  }
  await next();
});

/** Deployment facts the web app needs before any room exists (e.g. the "beta" badge). */
app.get("/meta", (c) => c.json({ beta: engineConfig(c.env).allowDrafts }));

app.post("/rooms", async (c) => {
  const body = await c.req.json<{ language?: unknown }>().catch(() => ({ language: undefined }));
  const language: Language = LANGUAGES.includes(body.language as Language) ? (body.language as Language) : "ru";
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const r = await roomStub(c, code).init(code, language);
    if (r.ok) return c.json({ roomCode: code, displayToken: r.value.displayToken, language }, 201);
  }
  return c.json({ error: "could not allocate a room code" }, 503);
});

app.use("/rooms/:code/*", async (c, next) => {
  if (!isRoomCode(c.req.param("code") ?? "")) return c.json({ error: "room not found" }, 404);
  await next();
});

app.get("/rooms/:code", async (c) => {
  if (!isRoomCode(c.req.param("code"))) return c.json({ error: "room not found" }, 404);
  return reply(c, await roomStub(c, c.req.param("code")).info());
});

app.post("/rooms/:code/players", async (c) => {
  const body = await c.req.json<{ nickname?: unknown }>().catch(() => ({ nickname: undefined }));
  if (typeof body.nickname !== "string") return c.json({ error: "nickname required" }, 400);
  return reply(c, await roomStub(c, c.req.param("code")).join(body.nickname));
});

app.get("/rooms/:code/ws", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") return c.json({ error: "expected websocket" }, 426);
  return await roomStub(c, c.req.param("code")).fetch(c.req.raw);
});

app.get("/rooms/:code/state", async (c) => reply(c, await roomStub(c, c.req.param("code")).snapshotFor(bearer(c))));

const HOST_COMMANDS: HostCommand[] = ["start", "pause", "resume", "skip", "end", "play-again"];

app.post("/rooms/:code/:command{start|pause|resume|skip|end|play-again}", async (c) => {
  const command = c.req.param("command") as HostCommand;
  if (!HOST_COMMANDS.includes(command)) return c.json({ error: "not found" }, 404);
  return reply(c, await roomStub(c, c.req.param("code")).host(bearer(c), command));
});

app.post("/rooms/:code/onboarding", async (c) => {
  const parsed = parseOnboarding(await c.req.json().catch(() => null));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  return reply(c, await roomStub(c, c.req.param("code")).onboarding(bearer(c), parsed.value));
});

app.post("/rooms/:code/feedback", async (c) => {
  const parsed = parseSessionFeedback(await c.req.json().catch(() => null));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  return reply(c, await roomStub(c, c.req.param("code")).feedback(bearer(c), parsed.value));
});

app.post("/rooms/:code/question-feedback", async (c) => {
  const parsed = parseQuestionRating(await c.req.json().catch(() => null));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  return reply(c, await roomStub(c, c.req.param("code")).rate(bearer(c), parsed.value.number, parsed.value.rating));
});

app.post("/rooms/:code/answers", async (c) => {
  const body = await c.req.json<{ optionKey?: unknown }>().catch(() => ({ optionKey: undefined }));
  if (!["A", "B", "C", "D"].includes(body.optionKey as string)) return c.json({ error: "optionKey must be A–D" }, 400);
  return reply(c, await roomStub(c, c.req.param("code")).answer(bearer(c), body.optionKey as OptionKey));
});

app.notFound((c) => c.json({ error: "not found" }, 404));

export default app;

function generateRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  // Alphabet has 32 symbols, so `% 32` is unbiased for a byte.
  return [...bytes].map((b) => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length]).join("");
}
