// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { PublicConcierge } from "../src/client/PublicConcierge";
import { useDialogFocus } from "../src/client/useDialogFocus";
import { PrivateAccessGate } from "../src/client/Crm";
import { api } from "../src/client/api";

describe("public concierge privacy defaults", () => {
  beforeEach(() => { localStorage.clear(); HTMLElement.prototype.scrollTo = vi.fn(); });

  it("requires explicit storage consent and device memory opt-in", () => {
    render(<PublicConcierge onOwner={() => undefined} />);
    const consent = screen.getByRole("checkbox", { name: /store this conversation/i });
    const remember = screen.getByRole("checkbox", { name: /remember my contact details/i });
    expect(consent).not.toBeChecked();
    expect(remember).not.toBeChecked();
    expect(screen.getByRole("button", { name: /meet your receptionist/i })).toBeDisabled();
  });

  it("shows only the public-safe case status after a remembered conversation resumes", async () => {
    localStorage.setItem("samuel-studio:concierge-visitor:v1", JSON.stringify({ name: "Avery Client", email: "avery@example.com", phone: "", conversations: [{ conversationId: "public-1", resumeToken: "r".repeat(40), title: "Delivery support", updatedAt: "2026-07-15T12:00:00.000Z" }] }));
    const resume = vi.spyOn(api, "publicResume").mockResolvedValue({ conversationId: "public-1", intake: { name: "Avery Client", email: "avery@example.com", phone: "", need: "Delivery support", consent: true }, messages: [], deliverables: [], serviceCases: [{ id: "case-safe-1", status: "awaiting_owner", statusLabel: "Owner review", lastUpdated: "2026-07-15T12:00:00.000Z", nextStep: "The owner is reviewing the Customer Service response." }], salesProgress: [{ id: "qualification-safe-1", readiness: "proposal_ready", statusLabel: "Preparing proposal", lastUpdated: "2026-07-15T12:00:00.000Z", nextStep: "Sales is preparing an owner-reviewed proposal." }], lastActivity: "2026-07-15T12:00:00.000Z" });
    render(<PublicConcierge onOwner={() => undefined} />); fireEvent.click(screen.getByRole("button", { name: /Delivery support/i }));
    expect(await screen.findByText("Service case case-safe-1")).toBeInTheDocument(); expect(screen.getByText(/Customer care · Owner review/i)).toBeInTheDocument(); expect(screen.getByText("The owner is reviewing the Customer Service response.")).toBeInTheDocument();
    expect(screen.getByText("Sales qualification qualification-safe-1")).toBeInTheDocument(); expect(screen.getByText(/Project inquiry · Preparing proposal/i)).toBeInTheDocument(); expect(screen.getByText("Sales is preparing an owner-reviewed proposal.")).toBeInTheDocument();
    expect(screen.queryByText(/^high$|^urgent$|Check the delivery manifest|budget|decision maker/i)).not.toBeInTheDocument();
    resume.mockRestore();
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

describe("private access transition", () => {
  it("waits for the authenticated workspace load after a successful login", async () => {
    const login = vi.spyOn(api, "crmLogin").mockResolvedValue({ ok: true, csrfToken: "csrf" });
    const onSuccess = vi.fn().mockResolvedValue(undefined);
    render(<PrivateAccessGate configured onBack={() => undefined} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText("Admin password"), { target: { value: "correct-horse-battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Open AI Operating System" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(login).toHaveBeenCalledWith("correct-horse-battery");
    login.mockRestore();
  });
});
