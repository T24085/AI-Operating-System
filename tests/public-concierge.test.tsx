// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { PublicConcierge } from "../src/client/PublicConcierge";
import { useDialogFocus } from "../src/client/useDialogFocus";

describe("public concierge privacy defaults", () => {
  beforeEach(() => localStorage.clear());

  it("requires explicit storage consent and device memory opt-in", () => {
    render(<PublicConcierge onOwner={() => undefined} />);
    const consent = screen.getByRole("checkbox", { name: /store this conversation/i });
    const remember = screen.getByRole("checkbox", { name: /remember my contact details/i });
    expect(consent).not.toBeChecked();
    expect(remember).not.toBeChecked();
    expect(screen.getByRole("button", { name: /meet your receptionist/i })).toBeDisabled();
  });
});

describe("keyboard-accessible dialogs", () => {
  it("traps focus, closes with Escape, and restores the opener", () => {
    function Dialog({ onClose }: { onClose: () => void }) { const ref = useDialogFocus<HTMLElement>(onClose); return <section ref={ref} role="dialog" tabIndex={-1}><button>First</button><button>Last</button></section>; }
    function Harness() { const [open, setOpen] = useState(false); return <><button onClick={() => setOpen(true)}>Opener</button>{open && <Dialog onClose={() => setOpen(false)} />}</>; }
    render(<Harness />); const opener = screen.getByRole("button", { name: "Opener" }); opener.focus(); fireEvent.click(opener);
    const first = screen.getByRole("button", { name: "First" }); const last = screen.getByRole("button", { name: "Last" }); expect(first).toHaveFocus();
    last.focus(); fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" }); expect(first).toHaveFocus();
    first.focus(); fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab", shiftKey: true }); expect(last).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(opener).toHaveFocus();
  });
});
