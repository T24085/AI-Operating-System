// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Desktop } from "../src/client/App";
import { api, streamEmployeeMessage, type BootstrapData } from "../src/client/api";
import { employees } from "../src/shared/employees";
import { SettingsSchema } from "../src/shared/schemas";

vi.mock("../src/client/api", async () => {
  const actual = await vi.importActual<typeof import("../src/client/api")>("../src/client/api");
  return { ...actual, streamEmployeeMessage: vi.fn() };
});

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

describe("independent employee workspaces", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.restoreAllMocks();
    HTMLElement.prototype.scrollTo = vi.fn();
    vi.spyOn(api, "employeeConversations").mockResolvedValue([]);
    vi.spyOn(api, "createConversation").mockImplementation(async (employeeId, title) => ({ id: `${employeeId}-conversation`, employeeId, title, model: "gemma4:12b", createdAt: new Date().toISOString(), file: "conversation.md" }));
  });

  it("keeps one employee running while the owner starts another", async () => {
    const releases: Array<() => void> = [];
    vi.mocked(streamEmployeeMessage).mockImplementation(() => new Promise<void>((resolve) => releases.push(resolve)));
    render(<Desktop initial={initial} onRefresh={vi.fn()} onOpenCrm={vi.fn()} onLogout={vi.fn()} />);

    const receptionistComposer = screen.getByPlaceholderText(/Message Receptionist/);
    fireEvent.change(receptionistComposer, { target: { value: "Prepare the appointment summary." } });
    fireEvent.submit(receptionistComposer.closest("form")!);
    await waitFor(() => expect(screen.getByRole("button", { name: "Receptionist, working" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Research, available" }));
    const researchComposer = screen.getByPlaceholderText(/Message Research/);
    expect(researchComposer).toBeEnabled();
    fireEvent.change(researchComposer, { target: { value: "Research the local market." } });
    fireEvent.submit(researchComposer.closest("form")!);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Receptionist, working" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Research, working" })).toBeInTheDocument();
      expect(streamEmployeeMessage).toHaveBeenCalledTimes(2);
    });
    releases.forEach((release) => release());
  }, 20_000);
});

describe("interrupted API confirmations", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("explains an empty response instead of exposing a JSON parser error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 200 })));
    await expect(api.actions()).rejects.toThrow("connection ended before confirmation");
  });
});
