import { describe, expect, it } from "vitest";
import { engineConfig } from "./deployment.ts";

describe("deployment settings", () => {
  it("plays drafts only when ALLOW_DRAFTS is exactly \"true\"", () => {
    expect(engineConfig({ ALLOW_DRAFTS: "true" }).allowDrafts).toBe(true);
    for (const v of [undefined, "", "false", "TRUE", "1"]) expect(engineConfig({ ALLOW_DRAFTS: v }).allowDrafts).toBe(false);
  });
});
