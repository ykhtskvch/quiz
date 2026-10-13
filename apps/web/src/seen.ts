// What this screen has already shown (EPIC 41 P-03): fact ids saved after each reveal and sent when the
// next room is created, so a company coming back gets fresh questions. Device-local, no accounts;
// storage can be unavailable (private mode), and then the game simply doesn't know.
import { SEEN_FACTS_MAX } from "@quiz/shared";

const KEY = "knowish.seen.v1";
/** Old evenings stop counting after half a year: by then a repeat is a nice surprise. */
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

type Entry = { id: string; at: number };

function read(): Entry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    const now = Date.now();
    return raw.filter((e): e is Entry => typeof e?.id === "string" && typeof e?.at === "number" && now - e.at < MAX_AGE_MS);
  } catch {
    return [];
  }
}

export const seen = {
  /** Oldest first, so the server can give up the oldest first. */
  list(): string[] {
    return read().map((e) => e.id);
  },
  add(id: string) {
    try {
      const entries = read().filter((e) => e.id !== id);
      entries.push({ id, at: Date.now() });
      localStorage.setItem(KEY, JSON.stringify(entries.slice(-SEEN_FACTS_MAX)));
    } catch {
      // No storage: nothing to remember with.
    }
  },
};
