// RateLimiterDO — one Durable Object per client IP holding the counters from ratelimit.ts.
import { DurableObject } from "cloudflare:workers";
import { hit, type Bucket, type Window } from "./ratelimit.ts";

/**
 * Counters live in memory: if the object is evicted they reset, which only ever makes the limit
 * more permissive — acceptable for abuse protection, and it avoids a storage write per request.
 */
export class RateLimiterDO extends DurableObject {
  private windows = new Map<Bucket, Window>();

  async hit(bucket: Bucket): Promise<boolean> {
    return hit(this.windows, bucket, Date.now());
  }
}
