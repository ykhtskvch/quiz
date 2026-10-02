import type { OptionKey } from "./protocol.ts";

/** Minimal playable question until the Composition Engine (M4) reads bank.json. */
export type DemoQuestion = {
  id: string;
  familyId: string;
  text: string;
  options: { key: OptionKey; text: string }[];
  correctKey: OptionKey;
  explanation: string;
  answerMs?: number;
};

export { DEMO_BANK } from "./demo-bank.generated.ts";
