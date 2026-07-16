import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OnboardingInputSchema } from "../src/shared/schemas.js";
import { CrmStore } from "../src/server/crm.js";
import { RecordsIndex } from "../src/server/indexer.js";
import { OperationsStore } from "../src/server/operations.js";
import { parsePublicConversation } from "../src/server/public-resume.js";
import { WorkspaceRecords } from "../src/server/records.js";
import { RecordHealthRegistry } from "../src/server/reliability.js";
import { SalesQualificationStore } from "../src/server/sales-qualifications.js";
import { SafeToolRuntime } from "../src/server/tools.js";

const cleanup: string[] = [];
const company = OnboardingInputSchema.parse({ companyName: "Sales Operations Studio", ownerName: "Owner", industry: "Creative services", description: "A local creative studio.", services: "Photography and websites", hours: "Weekdays", policies: "Custom terms require owner approval.", tone: "Warm and clear", goals: "Reliable sales follow-through", currency: "USD", timezone: "America/Chicago" });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aios-sales-operations-")); cleanup.push(root);
  const records = new WorkspaceRecords(root); await records.initialize(company);
  const crm = new CrmStore(root); await crm.initialize();
  const inquiry = await crm.createPublicInquiry({ name: "Avery Client", email: "avery@example.com", phone: "", need: "We need a website proposal this quarter.", consent: true });
  const conversation = await records.createConversation("receptionist", "Website inquiry", "test-model");
  await records.appendConversation(conversation.id, "CRM linkage", "Linked customer.", { type: "crm_linkage", contactId: inquiry.contact.id, leadId: inquiry.lead.id, customerName: inquiry.contact.name, customerEmail: inquiry.contact.email, initialNeed: "We need a website proposal this quarter." });
  const health = new RecordHealthRegistry(); const qualifications = new SalesQualificationStore(root, health); await qualifications.initialize();
  const operations = new OperationsStore(root, health); await operations.initialize();
  return { root, records, crm, inquiry, conversation, health, qualifications, operations };
}

afterEach(async () => { await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("canonical Sales Operations qualifications", () => {
  it("creates and deduplicates routed opportunities without numeric scoring", async () => {
    const { inquiry, conversation, qualifications } = await fixture();
    const input = { contactId: inquiry.contact.id, leadId: inquiry.lead.id, conversationId: conversation.id, customerName: inquiry.contact.name, content: "I am the owner and need a website by October with a USD 10,000 budget." };
    const first = await qualifications.createFromRouting(input); const duplicate = await qualifications.createFromRouting(input);
    expect(duplicate.id).toBe(first.id); expect(first.readiness).toBe("proposal_ready");
    expect(first.missingInformation).toEqual([]); expect(first).not.toHaveProperty("score");
    const [progress] = await qualifications.publicForConversation(conversation.id);
    expect(progress).toEqual({ id: first.id, readiness: "proposal_ready", statusLabel: "Preparing proposal", lastUpdated: first.updatedAt, nextStep: first.nextStep });
    expect(progress).not.toHaveProperty("budgetState"); expect(progress).not.toHaveProperty("evidence"); expect(progress).not.toHaveProperty("ownerAttentionReasons");
  });

  it("requires owner attention for negotiated, rushed, rights, and third-party terms", async () => {
    const { inquiry, conversation, qualifications } = await fixture();
    const value = await qualifications.create({ contactId: inquiry.contact.id, leadId: inquiry.lead.id, conversationId: conversation.id, title: "Rush campaign", serviceInterest: "Photography", projectGoal: "A rush campaign with a discount, exclusive usage rights, travel, and outside vendors.", deliverables: ["Photography"], targetTiming: "This week", budgetState: "provided", budgetRange: "Provided privately", decisionMakerState: "confirmed", decisionMakers: "Avery", constraints: [], nextStep: "Owner reviews non-standard terms.", createdBy: "owner" });
    expect(value.readiness).toBe("awaiting_owner"); expect(value.ownerAttention).toBe(true);
    expect(value.ownerAttentionReasons).toEqual(expect.arrayContaining(["Discount or negotiated pricing", "Rush timing or availability", "Licensing or rights terms", "Travel or third-party cost"]));
  });

  it("contains evidence to approved sources and reports malformed Markdown without rewriting it", async () => {
    const { root, inquiry, conversation, health, qualifications } = await fixture();
    const value = await qualifications.createFromRouting({ contactId: inquiry.contact.id, leadId: inquiry.lead.id, conversationId: conversation.id, customerName: inquiry.contact.name, content: "We need a website proposal." });
    const linked = await qualifications.update(value.id, { evidence: [{ kind: "company", path: "company/SERVICES.md", label: "Published services", excerpt: "" }] });
    expect(linked.evidence[0].path).toBe("company/SERVICES.md");
    await expect(qualifications.update(value.id, { evidence: [{ kind: "sales_library", path: "company/SERVICES.md", label: "Wrong boundary", excerpt: "" }] })).rejects.toThrow(/Sales evidence/);
    const file = join(root, "crm", "sales-qualifications", "broken.md"); const source = "# Owner recovery note\n\nKeep this source unchanged.\n"; await writeFile(file, source);
    await qualifications.list(); expect(health.list()).toEqual(expect.arrayContaining([expect.objectContaining({ path: "crm/sales-qualifications/broken.md", recordKind: "crm:sales-qualifications" })])); expect(await readFile(file, "utf8")).toBe(source);
  });

  it("delivers one owner-approved proposal across safe retries", async () => {
    const { records, crm, inquiry, conversation, qualifications, operations } = await fixture();
    let qualification = await qualifications.createFromRouting({ contactId: inquiry.contact.id, leadId: inquiry.lead.id, conversationId: conversation.id, customerName: inquiry.contact.name, content: "I am the owner and need a website by October with a USD 10,000 budget." });
    qualification = await qualifications.update(qualification.id, { evidence: [{ kind: "company", path: "company/SERVICES.md", label: "Published services", excerpt: "" }] });
    const employeeConversation = await records.createConversation("sales", "Proposal", "test-model"); const index = new RecordsIndex(records); await index.start();
    const tools = new SafeToolRuntime(records, index, undefined, qualifications, operations, crm);
    const action = await tools.propose("deliver_sales_proposal", { qualificationId: qualification.id, title: "Website proposal", summary: "A customer-safe website proposal based on the confirmed discovery record.", content: "# Website proposal\n\nScope and non-binding estimate supported by the published service source.", publicMessage: "Your owner-approved website proposal is ready to review in this conversation.", evidencePaths: ["company/SERVICES.md"], reason: "Deliver the complete proposal after owner review." }, "sales", employeeConversation.id);
    await tools.execute(action); await tools.execute(action); await index.close();
    const updated = await qualifications.get(qualification.id); expect(updated.readiness).toBe("proposal_delivered"); expect(updated.events.filter((event) => event.operationId === action.id)).toHaveLength(1);
    expect(await operations.listProjects()).toHaveLength(1); expect(await operations.listWorkItems()).toHaveLength(1); expect(await operations.listProposals()).toHaveLength(1); expect(await operations.listDeliverables()).toHaveLength(1);
    const publicRecord = await records.activateConversation(conversation.id, "receptionist"); const parsed = parsePublicConversation(publicRecord.content);
    expect(parsed.messages.filter((message) => message.content.includes("proposal is ready"))).toHaveLength(1);
    expect((await crm.bootstrap()).leads.find((lead) => lead.id === inquiry.lead.id)?.stage).toBe("proposal");
  });
});
