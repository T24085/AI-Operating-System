import { describe, expect, it } from "vitest";
import { Ollama } from "ollama";

const enabled = process.env.AIOS_LIVE_TEST === "1";

describe.skipIf(!enabled)("live Ollama smoke test", () => {
  it("receives a concise response from gemma4:12b", async () => {
    const client = new Ollama({ host: process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434" });
    const response = await client.chat({
      model: "gemma4:12b",
      messages: [{ role: "user", content: "Reply with exactly: AIOS_READY" }],
      stream: false,
      think: false,
      options: { temperature: 0, num_ctx: 2048 },
    } as never) as unknown as { message: { content: string } };
    expect(response.message.content).toContain("AIOS_READY");
  }, 120_000);
});
