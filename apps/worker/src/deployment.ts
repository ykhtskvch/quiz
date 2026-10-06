// Per-deployment settings read from wrangler vars (staging / production differ without code changes).
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from "@quiz/engine";

export type DeploymentVars = {
  /** "true" lets unreviewed DRAFT questions into games (a "beta"); anything else = approved only (BR-130). */
  ALLOW_DRAFTS?: string;
};

/** Engine settings for this deployment: drafts only where the environment explicitly opts in. */
export function engineConfig(vars: DeploymentVars): EngineConfig {
  return { ...DEFAULT_ENGINE_CONFIG, allowDrafts: vars.ALLOW_DRAFTS === "true" };
}
