import { describe, expect, it } from "vitest";
import { hit, WINDOW_MS, type Bucket, type Window } from "./ratelimit.ts";

type Windows = Map<Bucket, Window>;

describe("rate limit window", () => {
  it("allows up to the limit, then rejects", () => {
    const w: Windows = new Map();
    const results = Array.from({ length: 12 }, () => hit(w, "create", 1_000));
    expect(results.filter(Boolean)).toHaveLength(10);
    expect(results.slice(10)).toEqual([false, false]);
  });

  it("starts over in the next window", () => {
    const w: Windows = new Map();
    for (let i = 0; i < 11; i++) hit(w, "create", 1_000);
    expect(hit(w, "create", 1_000)).toBe(false);
    expect(hit(w, "create", WINDOW_MS + 1)).toBe(true);
  });

  it("keeps buckets separate", () => {
    const w: Windows = new Map();
    for (let i = 0; i < 20; i++) hit(w, "create", 1_000);
    expect(hit(w, "room", 1_000)).toBe(true);
  });
});
