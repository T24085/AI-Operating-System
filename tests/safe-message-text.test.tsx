// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { SafeMessageText } from "../src/client/SafeMessageText";

describe("safe chat links", () => {
  it("makes raw and Markdown HTTP links clickable in a new tab", () => {
    render(<p><SafeMessageText content={"Portfolio: https://www.samuel.studio/portfolio. Book at [Samuel Studio](https://www.samuel.studio/booking)."} /></p>);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "https://www.samuel.studio/portfolio");
    expect(links[1]).toHaveAttribute("href", "https://www.samuel.studio/booking");
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("renders formatting as text elements without interpreting arbitrary HTML", () => {
    const { container } = render(<p><SafeMessageText content={"**Photography** <script>alert('x')</script> javascript:alert(1)"} /></p>);
    expect(screen.getByText("Photography").tagName).toBe("STRONG");
    expect(container.querySelector("script")).toBeNull();
    expect(within(container).queryByRole("link")).toBeNull();
  });
});
