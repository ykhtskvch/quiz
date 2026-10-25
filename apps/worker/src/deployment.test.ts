import { describe, expect, it } from "vitest";
import { engineConfig, tipUrl } from "./deployment.ts";

describe("deployment settings", () => {
  it("plays drafts only when ALLOW_DRAFTS is exactly \"true\"", () => {
    expect(engineConfig({ ALLOW_DRAFTS: "true" }).allowDrafts).toBe(true);
    for (const v of [undefined, "", "false", "TRUE", "1"]) expect(engineConfig({ ALLOW_DRAFTS: v }).allowDrafts).toBe(false);
  });

  it("uses the tip link only when it is a plain https URL (P-18)", () => {
    expect(tipUrl({ TIP_URL: "https://buy.stripe.com/abc123" })).toBe("https://buy.stripe.com/abc123");
    expect(tipUrl({ TIP_URL: "  https://buy.stripe.com/abc123 " })).toBe("https://buy.stripe.com/abc123");
    for (const v of [undefined, "", "http://buy.stripe.com/x", "javascript:alert(1)", "https://a b", 'https://x"><script>']) expect(tipUrl({ TIP_URL: v })).toBeNull();
  });
});
