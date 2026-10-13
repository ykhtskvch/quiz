import { SEEN_FACTS_MAX } from "@quiz/shared";

/** Fact ids the screen says it has shown before (EPIC 41 P-03): slugs only, the newest kept if the list is long. */
export function seenFacts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw.filter((x): x is string => typeof x === "string" && x.length <= 80 && /^[a-z0-9][a-z0-9-]*$/.test(x));
  return [...new Set(ids)].slice(-SEEN_FACTS_MAX);
}
