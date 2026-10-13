// Funnel (EPIC 41 P-07): a step name sent to our own server — no ids, no cookies, no third parties.
import type { FunnelStep } from "@quiz/shared";

/** Counts a browser-side step once per browser session (a reload is not a new visit). */
export function trackOnce(step: Extract<FunnelStep, "home_view" | "join_view">, scope = "") {
  const key = `knowish.funnel.${step}.${scope}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    // No storage: count anyway; at worst a reload counts twice.
  }
  fetch("/api/funnel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step }), keepalive: true }).catch(
    () => {},
  );
}

const PLAYED = "knowish.played";
const CREATED = "knowish.created";

/**
 * "A player became a host": this device joined someone else's game before. Rooms this device created
 * itself (a host joining their own phones-only room) don't count.
 */
export const playerHistory = {
  created(code: string) {
    try {
      sessionStorage.setItem(CREATED, code);
    } catch {
      // ignore
    }
  },
  joined(code: string) {
    try {
      if (sessionStorage.getItem(CREATED) !== code) localStorage.setItem(PLAYED, "1");
    } catch {
      // ignore
    }
  },
  hasPlayed(): boolean {
    try {
      return localStorage.getItem(PLAYED) === "1";
    } catch {
      return false;
    }
  },
};
