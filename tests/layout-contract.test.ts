import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("chat layout regression contract", () => {
  it("keeps streamed messages scrollable without displacing the composer", async () => {
    const css = await readFile(new URL("../src/client/styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.window-body\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
    expect(css).toMatch(/\.chat-panel\s*\{[^}]*min-height:\s*0;[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/s);
    expect(css).toMatch(/\.message-list\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  });

  it("reserves dock space on short desktop viewports", async () => {
    const css = await readFile(new URL("../src/client/styles.css", import.meta.url), "utf8");
    const shortViewport = css.match(/@media \(max-height:\s*800px\) and \(min-width:\s*761px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(shortViewport).toContain(".desktop-main { padding-bottom: 146px; }");
    expect(shortViewport).toContain(".employee-window { min-height: 0; }");
    expect(shortViewport).toContain(".employee-dock { bottom: 12px; height: 110px;");
  });
});
