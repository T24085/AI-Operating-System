// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Desktop } from "../src/client/App";
import { api, type BootstrapData } from "../src/client/api";
import { employees } from "../src/shared/employees";
import { SalesQualificationSchema, ServiceCaseSchema, SettingsSchema } from "../src/shared/schemas";

vi.mock("../src/client/api", async () => {
  const actual = await vi.importActual<typeof import("../src/client/api")>("../src/client/api");
  return { ...actual, streamEmployeeMessage: vi.fn() };
});

const stamp = "2026-07-15T12:00:00.000Z";
const serviceCase = ServiceCaseSchema.parse({ id: "case-client-1", contactId: "contact-1", leadId: "lead-1", conversationId: "public-1", appointmentId: null, workItemId: null, assignedEmployeeId: "customer-service", title: "Delivery access concern", category: "delivery", priority: "high", status: "awaiting_owner", summary: "The customer cannot locate the delivered files.", desiredOutcome: "Restore access using confirmed delivery records.", nextStep: "Owner reviews the proposed response.", internalNotes: "Check the delivery manifest before answering.", createdBy: "receptionist", createdAt: stamp, updatedAt: stamp, resolvedAt: null, events: [{ id: "event-1", type: "created", actor: "receptionist", summary: "Service case created", detail: "Customer reported a delivery issue.", publicSummary: "Your request was received.", operationId: null, createdAt: stamp }], file: "crm/service-cases/case-client-1.md" });
const qualification = SalesQualificationSchema.parse({ id: "qualification-client-1", contactId: "contact-1", leadId: "lead-1", conversationId: "public-1", appointmentId: null, projectId: null, workItemId: null, proposalId: null, deliverableId: null, assignedEmployeeId: "sales", title: "Avery website opportunity", serviceInterest: "Website and digital", projectGoal: "Launch a portfolio website for the fall campaign.", deliverables: ["Website"], targetTiming: "October", location: "Chicago", budgetState: "provided", budgetRange: "Provided privately", decisionMakerState: "confirmed", decisionMakers: "Avery", constraints: [], missingInformation: [], readiness: "proposal_ready", nextStep: "Sales prepares an evidence-backed proposal for owner review.", ownerAttention: false, ownerAttentionReasons: [], evidence: [{ id: "evidence-1", kind: "company", path: "company/SERVICES.md", label: "Published services", excerpt: "", addedAt: stamp }], events: [{ id: "sales-event-1", type: "created", actor: "receptionist", summary: "Sales qualification created", detail: "Website inquiry", publicSummary: "Your project inquiry was received.", operationId: null, createdAt: stamp }], createdBy: "receptionist", createdAt: stamp, updatedAt: stamp, closedAt: null, file: "crm/sales-qualifications/qualification-client-1.md" });
const initial: BootstrapData = { onboarded: true, company: null, settings: SettingsSchema.parse({}), employees, ollamaOnline: true, actions: [], workItems: [], activity: [] };

describe("Client Service employee workspaces", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.restoreAllMocks(); HTMLElement.prototype.scrollTo = vi.fn();
    vi.spyOn(api, "employeeConversations").mockResolvedValue([]);
    vi.spyOn(api, "frontDesk").mockResolvedValue({ items: [{ id: "conversation:public-1", kind: "conversation", title: "Existing delivery issue", customerName: "Avery Client", summary: "Consulted: Customer Service", status: "new", needsAttention: true, conversationId: "public-1", contactId: "contact-1", appointmentId: null, workItemId: null, caseId: serviceCase.id, updatedAt: stamp }], summary: { newInquiries: 1, appointmentRequests: 0, callbacks: 0, ownerConfirmations: 1 } });
    vi.spyOn(api, "serviceCases").mockResolvedValue([serviceCase]);
    vi.spyOn(api, "updateServiceCase").mockImplementation(async (_id, patch) => ServiceCaseSchema.parse({ ...serviceCase, ...patch }));
    vi.spyOn(api, "salesOperations").mockResolvedValue({ qualifications: [qualification], summary: { new: 0, collecting: 0, discoveryReady: 0, proposalReady: 1, ownerReview: 0, delivered: 0 } });
    vi.spyOn(api, "updateSalesQualification").mockImplementation(async (_id, patch) => SalesQualificationSchema.parse({ ...qualification, ...patch }));
  });

  it("shows Receptionist Front Desk and Customer Service Cases as distinct views over linked records", async () => {
    render(<Desktop initial={initial} onRefresh={vi.fn()} onOpenCrm={vi.fn()} onLogout={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Front Desk" }));
    expect(await screen.findByRole("region", { name: "Receptionist Front Desk" })).toBeInTheDocument();
    expect(screen.getAllByText("Avery Client")).toHaveLength(2); expect(screen.getByText("case-client-1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Customer Service, available" }));
    fireEvent.click(screen.getByRole("button", { name: "Cases" }));
    expect(await screen.findByRole("region", { name: "Customer Service cases" })).toBeInTheDocument();
    expect(screen.getByText("Check the delivery manifest before answering.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Case status"), { target: { value: "investigating" } });
    await waitFor(() => expect(api.updateServiceCase).toHaveBeenCalledWith(serviceCase.id, { status: "investigating" }));

    fireEvent.click(screen.getByRole("button", { name: "Draft approved reply" }));
    const composer = screen.getByPlaceholderText(/Message Customer Service/);
    expect((composer as HTMLTextAreaElement).value).toContain("propose_case_reply");
    expect((composer as HTMLTextAreaElement).value).toContain(serviceCase.id);
  }, 10_000);

  it("gives Sales an Opportunities view with private readiness and proposal drafting", async () => {
    render(<Desktop initial={initial} onRefresh={vi.fn()} onOpenCrm={vi.fn()} onLogout={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Sales, available" }));
    fireEvent.click(screen.getByRole("button", { name: "Opportunities" }));
    expect(await screen.findByRole("region", { name: "Sales opportunities" })).toBeInTheDocument();
    expect(screen.getAllByText("Avery website opportunity")).toHaveLength(2);
    expect(screen.getByText("Published services")).toBeInTheDocument();
    expect(screen.getByText("No required qualification gaps.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Qualification readiness"), { target: { value: "awaiting_owner" } });
    await waitFor(() => expect(api.updateSalesQualification).toHaveBeenCalledWith(qualification.id, { readiness: "awaiting_owner" }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare approved proposal" }));
    const composer = screen.getByPlaceholderText(/Message Sales/);
    expect((composer as HTMLTextAreaElement).value).toContain("deliver_sales_proposal");
    expect((composer as HTMLTextAreaElement).value).toContain(qualification.id);
  }, 10_000);
});
