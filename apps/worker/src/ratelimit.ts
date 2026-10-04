// Per-IP rate limiting (NFR-016), pure part. One RateLimiterDO (limiter-do.ts) per client IP keeps
// exact fixed-window counters, so limits hold globally and behave the same in `wrangler dev` and on
// Cloudflare. (The Workers Rate Limiting binding was tried first; on staging it never rejected anything.)

export type Bucket = "create" | "room" | "action";

/**
 * Requests per minute per IP. A whole party usually shares one Wi-Fi IP, so the room limit is
 * generous: 8 phones + display reconnecting after a blip stay well under it, while guessing
 * 32^6 room codes stays hopeless.
 */
export const LIMITS: Record<Bucket, number> = { create: 10, room: 120, action: 300 };
export const WINDOW_MS = 60_000;

export type Window = { start: number; count: number };

/** Counts one request; returns false when the bucket is over its limit in the current window. */
export function hit(windows: Map<Bucket, Window>, bucket: Bucket, now: number, limit = LIMITS[bucket]): boolean {
  const start = now - (now % WINDOW_MS);
  const w = windows.get(bucket);
  if (!w || w.start !== start) {
    windows.set(bucket, { start, count: 1 });
    return limit >= 1;
  }
  w.count++;
  return w.count <= limit;
}
