// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/client/App";
import { api, streamEmployeeMessage, type BootstrapData } from "../src/client/api";
import { employees } from "../src/shared/employees";
import { SettingsSchema } from "../src/shared/schemas";

vi.mock("../src/client/api", async () => {
  const actual = await vi.importActual<typeof import("../src/client/api")>("../src/client/api");
  return { ...actual, streamEmployeeMessage: vi.fn() };
});

vi.mock("../src/client/Crm", () => ({
  CrmApp: ({ onBack }: { onBack: () => void }) => <main aria-label="Private CRM"><button onClick={onBack}>AI employees</button></main>,
  PrivateAccessGate: () => <div>Private access</div>,
}));

vi.mock("../src/client/PublicConcierge", () => ({ PublicConcierge: () => <main>Public concierge</main> }));

const initial: BootstrapData = {
  onboarded: true,
  company: null,
  settings: SettingsSchema.parse({}),
  employees,
  ollamaOnline: true,
  actions: [],
  workItems: [],
  activity: [],
};

describe("private route continuity", () => {
  let finishStream: () => void;

  beforeEach(() => {
    window.history.replaceState({}, "", "/admin");
    HTMLElement.prototype.scrollTo = vi.fn();
    vi.restoreAllMocks();
    vi.spyOn(api, "crmAuth").mockResolvedValue({ configured: true, authenticated: true });
    vi.spyOn(api, "bootstrap").mockResolvedValue(initial);
    vi.spyOn(api, "employeeConversations").mockResolvedValue([]);
    vi.spyOn(api, "createConversation").mockResolvedValue({ id: "research-running", employeeId: "research", title: "Research", model: "gemma4:12b", createdAt: new Date().toISOString(), file: "conversation.md" });
    vi.mocked(streamEmployeeMessage).mockImplementation(() => new Promise<void>((resolve) => { finishStream = resolve; }));
  });

  afterEach(() => {
    finishStream?.();
    window.history.replaceState({}, "", "/");
  });

  it("keeps running employee workspaces mounted while CRM is open", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "Research, available" });
    fireEvent.click(screen.getByRole("button", { name: "Research, available" }));
    const composer = screen.getByPlaceholderText(/Message Research/);
    fireEvent.change(composer, { target: { value: "Research the Abilene market." } });
    fireEvent.submit(composer.closest("form")!);
    await screen.findByRole("button", { name: "Research, working" });

    fireEvent.click(screen.getByRole("button", { name: "Open private CRM" }));
    expect(screen.getByRole("main", { name: "Private CRM" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Research, working", hidden: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "AI employees" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Research, working" })).toBeVisible());
    expect(screen.getByText("Research the Abilene market.")).toBeVisible();
  }, 10_000);
});
