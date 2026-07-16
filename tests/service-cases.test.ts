import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OnboardingInputSchema } from "../src/shared/schemas.js";
import { RecordsIndex } from "../src/server/indexer.js";
import { parsePublicConversation } from "../src/server/public-resume.js";
import { RecordHealthRegistry } from "../src/server/reliability.js";
import { buildFrontDesk, ServiceCaseStore } from "../src/server/service-cases.js";
import { SafeToolRuntime } from "../src/server/tools.js";
import { WorkspaceRecords } from "../src/server/records.js";

const cleanup: string[] = [];
const company = OnboardingInputSchema.parse({ companyName: "Client Service Studio", ownerName: "Owner", industry: "Creative services", description: "A local creative studio.", services: "Photography and websites", hours: "Weekdays", policies: "Refunds and exceptions require owner approval.", tone: "Warm and clear", goals: "Reliable client care", currency: "USD", timezone: "America/Chicago" });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aios-service-cases-")); cleanup.push(root);
  const records = new WorkspaceRecords(root); await records.initialize(company);
  const conversation = await records.createConversation("receptionist", "Customer support", "test-model");
  await records.appendConversation(conversation.id, "CRM linkage", "Linked customer.", { type: "crm_linkage", contactId: "contact-1", leadId: "lead-1", customerName: "Avery Client", customerEmail: "avery@example.com", initialNeed: "I need help with an existing delivery." });
  const health = new RecordHealthRegistry(); const serviceCases = new ServiceCaseStore(root, health); await serviceCases.initialize();
  return { root, records, conversation, health, serviceCases };
}

afterEach(async () => { await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("canonical client service cases", () => {
  it("creates one routed case, escalates sensitive requests, and exposes only a safe public summary", async () => {
    const { conversation, serviceCases } = await fixture();
    const input = { contactId: "contact-1", leadId: "lead-1", conversationId: conversation.id, customerName: "Avery Client", content: "I want a refund and an exception to the policy." };
    const first = await serviceCases.createFromRouting(input); const duplicate = await serviceCases.createFromRouting(input);
    expect(duplicate.id).toBe(first.id); expect(first.status).toBe("awaiting_owner"); expect(first.priority).toBe("high"); expect(first.category).toBe("billing");
    expect(first.events.some((event) => event.type === "escalated")).toBe(true);
    const [publicCase] = await serviceCases.publicForConversation(conversation.id);
    expect(publicCase).toEqual({ id: first.id, status: "awaiting_owner", statusLabel: "Owner review", lastUpdated: first.updatedAt, nextStep: first.nextStep });
    expect(publicCase).not.toHaveProperty("priority"); expect(publicCase).not.toHaveProperty("internalNotes"); expect(publicCase).not.toHaveProperty("category");
  });

  it("executes an approved case reply exactly once across safe retries", async () => {
    const { records, conversation, serviceCases } = await fixture();
    const serviceCase = await serviceCases.create({ contactId: "contact-1", leadId: "lead-1", conversationId: conversation.id, title: "Delivery concern", summary: "The customer cannot locate the delivered files.", desiredOutcome: "Confirm access without making an unsupported promise.", createdBy: "owner" });
    const employeeConversation = await records.createConversation("customer-service", "Case reply", "test-model");
    const index = new RecordsIndex(records); await index.start(); const tools = new SafeToolRuntime(records, index, serviceCases);
    const action = await tools.propose("propose_case_reply", { caseId: serviceCase.id, publicConversationId: conversation.id, content: "I’m sorry for the trouble. I’m reviewing the confirmed delivery record with the studio owner, and your case remains open while we verify access.", reason: "Give the customer an accurate, owner-approved status update." }, "customer-service", employeeConversation.id);
    await tools.execute(action); await tools.execute(action);
    const updated = await serviceCases.get(serviceCase.id); const approvedEvents = updated.events.filter((event) => event.operationId === action.id);
    expect(updated.status).toBe("awaiting_customer"); expect(approvedEvents).toHaveLength(1);
    const activated = await records.activateConversation(conversation.id, "receptionist");
    expect(activated.content.match(new RegExp(action.id, "g"))).toHaveLength(1);
    expect(parsePublicConversation(activated.content).messages.at(-1)).toEqual(expect.objectContaining({ role: "specialist", employeeId: "customer-service", content: expect.stringContaining("case remains open") }));
    await index.close();
  });

  it("keeps malformed source readable and reports it through record health", async () => {
    const { root, health, serviceCases } = await fixture(); const file = join(root, "crm", "service-cases", "broken.md"); const source = "# Owner recovery note\n\nDo not rewrite this malformed record.\n";
    await writeFile(file, source); expect(await serviceCases.list()).toEqual([]);
    expect(health.list()).toEqual(expect.arrayContaining([expect.objectContaining({ path: "crm/service-cases/broken.md", recordKind: "crm:service-cases" })]));
    expect(await health.scan(root)).toEqual(expect.arrayContaining([expect.objectContaining({ path: "crm/service-cases/broken.md", recordKind: "crm:service-cases" })]));
    expect(await readFile(file, "utf8")).toBe(source);
  });

  it("builds one Front Desk read model from conversations, appointments, work, and cases", async () => {
    const { conversation, serviceCases } = await fixture(); const serviceCase = await serviceCases.create({ contactId: "contact-1", leadId: "lead-1", conversationId: conversation.id, title: "Callback request", summary: "Please call me about support.", createdBy: "owner" });
    const desk = buildFrontDesk({ contacts: [{ id: "contact-1", name: "Avery Client", email: "avery@example.com", phone: "", company: "", location: "", source: "Public", tags: [], notes: "", createdAt: serviceCase.createdAt, updatedAt: serviceCase.updatedAt }], conversations: [{ id: conversation.id, contactId: "contact-1", leadId: "lead-1", customerName: "Avery Client", customerEmail: "avery@example.com", initialNeed: "Please call me about my delivery", createdAt: serviceCase.createdAt, lastActivity: serviceCase.updatedAt, messageCount: 1, departments: ["Customer Service"], status: "new", file: conversation.file }], appointments: [], workItems: [], cases: [serviceCase] });
    expect(desk.items[0]).toEqual(expect.objectContaining({ kind: "callback", caseId: serviceCase.id, needsAttention: true })); expect(desk.summary.callbacks).toBe(1);
  });
});
