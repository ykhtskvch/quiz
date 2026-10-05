export type TaxonomyTopic = {
  slug: string;
  name: string;
  nameEn: string;
  emoji: string;
  group: string;
  groupEn: string;
  /** Used to infer a player's cultural background when they skip that step (D-01). */
  impliedContext: string | null;
  /** Level-A topic: shown in onboarding before "show all topics". */
  featured: boolean;
};

export type TaxonomyContext = { code: string; name: string; parent: string | null };

export { TOPICS, CONTEXTS } from "./taxonomy.generated.ts";
