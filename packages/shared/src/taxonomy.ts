export type TaxonomyTopic = {
  slug: string;
  name: string;
  emoji: string;
  group: string;
  /** Used to infer a player's cultural background when they skip that step (D-01). */
  impliedContext: string | null;
};

export type TaxonomyContext = { code: string; name: string; parent: string | null };

export { TOPICS, CONTEXTS } from "./taxonomy.generated.ts";
