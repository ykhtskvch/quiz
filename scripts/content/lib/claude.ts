// Shared Claude API call for content scripts: structured output, streaming, refusal handling.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

export const MODEL = "claude-opus-5-5";

const client = new Anthropic();

export async function askStructured<S extends z.ZodType>(opts: {
  system: string;
  prompt: string;
  schema: S;
}): Promise<z.infer<S>> {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    // Server-side fallback re-runs a declined request on a recommended model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: betaZodOutputFormat(opts.schema) },
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error(`Request declined (${message.stop_details?.category ?? "no category"}): ${message.stop_details?.explanation ?? ""}`);
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("Output hit max_tokens; ask for fewer questions per call.");
  }
  if (message.parsed_output == null) {
    throw new Error("Model output did not match the schema.");
  }
  const u = message.usage;
  console.error(`[claude] ${message.model}: ${u.input_tokens} in / ${u.output_tokens} out tokens`);
  return message.parsed_output;
}
