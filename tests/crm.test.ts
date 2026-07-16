import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrmAuth } from "../src/server/crm-auth.js";
import { CrmStore } from "../src/server/crm.js";
import { PublicReceptionistRuntime, routeQuestion } from "../src/server/public-receptionist.js";
import { OperationsStore } from "../src/server/operations.js";
import { issuePublicResumeToken, parsePublicConversation, verifyPublicResumeToken } from "../src/server/public-resume.js";
import { WorkspaceRecords } from "../src/server/records.js";
import { ServiceCaseStore } from "../src/server/service-cases.js";
import { SalesQualificationStore } from "../src/server/sales-qualifications.js";
import { OnboardingInputSchema, PublicIntakeSchema, SettingsSchema, type PublicAgentEvent } from "../src/shared/schemas.js";

const cleanup: string[] = [];
async function root() { const value = await mkdtemp(join(tmpdir(), "aios-crm-")); cleanup.push(value); return value; }
async function stream(...chunks: unknown[]) { return (async function* () { for (const chunk of chunks) yield chunk; })(); }
afterEach(async () => { await Promise.all(cleanup.splice(0).map((value) => rm(value, { recursive: true, force: true }))); });

describe("private Markdown CRM", () => {
  it("starts normal workspaces without fictional demo clients", async () => {
    const workspace = await root(); const data = await new CrmStore(workspace).bootstrap();
    expect(data.contacts).toEqual([]); expect(data.leads).toEqual([]);
  });
  it("seeds distinct Samuel Studio records and rebuilds from Markdown", async () => {
    const workspace = await root(); const crm = new CrmStore(workspace, { demo: true });
    const data = await crm.bootstrap();
    expect(data.contacts).toHaveLength(4); expect(data.leads.map((lead) => lead.project)).toContain("Samuel.Colombia");
    const markdown = await readFile(join(workspace, "crm", "leads", "casa-luz-launch.md"), "utf8");
    expect(markdown).toContain("Casa Luz launch campaign"); expect(markdown).toContain("CRM_META");
    expect((await new CrmStore(workspace, { demo: true }).bootstrap()).leads).toHaveLength(4);
  });

  it("records owner mutations and prevents appointment conflicts", async () => {
    const workspace = await root(); const crm = new CrmStore(workspace, { demo: true }); const data = await crm.bootstrap();
    const start = new Date(Date.now() + 5 * 86400000); start.setHours(10, 0, 0, 0); const end = new Date(start.getTime() + 3600000);
    await crm.createAppointment({ contactId: data.contacts[0].id, leadId: null, title: "Discovery", startAt: start.toISOString(), endAt: end.toISOString(), status: "confirmed", type: "Consultation", location: "Video call", notes: "" });
    await expect(crm.createAppointment({ contactId: data.contacts[1].id, leadId: null, title: "Conflict", startAt: start.toISOString(), endAt: end.toISOString(), status: "confirmed", type: "Consultation", location: "Video call", notes: "" })).rejects.toThrow("overlaps");
    expect((await crm.bootstrap()).activities.some((item) => item.summary.includes("Discovery"))).toBe(true);
  });

  it("keeps lead details intact when only the pipeline stage changes", async () => {
    const workspace = await root(); const crm = new CrmStore(workspace, { demo: true }); await crm.bootstrap();
    const before = (await crm.bootstrap()).leads.find((lead) => lead.id === "form-house-site")!;
    const after = await crm.updateLead(before.id, { stage: "qualified" });
    expect(after.value).toBe(before.value); expect(after.project).toBe(before.project); expect(after.summary).toBe(before.summary);
  });

  it("requires a strong local password and expires sessions on logout", async () => {
    const appData = await root(); const auth = new CrmAuth(appData);
    await expect(auth.setup("short")).rejects.toThrow("10 characters");
    const token = await auth.setup("correct-horse-battery"); expect(auth.authenticated(token)).toBe(true);
    await expect(auth.login("wrong-password")).rejects.toThrow("not correct");
    const loginToken = await auth.login("correct-horse-battery"); auth.logout(loginToken); expect(auth.authenticated(loginToken)).toBe(false);
  });
});

describe("public Receptionist boundary", () => {
  it("routes a mixed customer request to the relevant public team with a structured decision", () => {
    const decision = routeQuestion("I need a quote for a website, booking system, and custom logo.");
    expect(decision.departments).toEqual(["sales", "developer", "designer"]); expect(decision.confidence).toBeGreaterThan(0.8); expect(decision.privacyBoundary).toBe("public");
  });
  it("creates a CRM contact and lead from the required customer intake", async () => {
    const workspace = await root(); const crm = new CrmStore(workspace);
    const intake = PublicIntakeSchema.parse({ name: "Maya Chen", email: "maya@example.com", phone: "", need: "I need a campaign website.", consent: true });
    const result = await crm.createPublicInquiry(intake); const data = await crm.bootstrap();
    expect(result.contact.source).toBe("AI Receptionist"); expect(result.lead.summary).toContain("campaign website");
    expect(data.contacts.some((item) => item.email === "maya@example.com")).toBe(true);
  });

  it("keeps internal financial questions behind the Receptionist boundary without calling a model", async () => {
    const workspace = await root(); const records = new WorkspaceRecords(workspace);
    await records.initialize(OnboardingInputSchema.parse({ companyName: "Samuel Studio", ownerName: "Samuel", industry: "Creative studio", description: "A photography, design, and digital creative studio.", services: "Photography and digital experiences", hours: "Monday to Friday", policies: "Private financial records stay internal.", tone: "Warm and clear", goals: "Serve clients well", currency: "USD", timezone: "America/Chicago" }));
    const crm = new CrmStore(workspace); const runtime = new PublicReceptionistRuntime(records, crm, new OperationsStore(workspace), new ServiceCaseStore(workspace), SettingsSchema.parse({}));
    const intake = PublicIntakeSchema.parse({ name: "Maya Chen", email: "maya@example.com", phone: "", need: "I have a question.", consent: true });
    const conversation = await records.createConversation("receptionist", "Public inquiry", "missing-model");
    await records.appendConversation(conversation.id, "CRM linkage", "Linked to CRM.", { type: "crm_linkage", contactId: "contact-1", leadId: "lead-1", customerName: intake.name, customerEmail: intake.email, initialNeed: intake.need });
    await runtime.start(conversation, intake, { contactId: "contact-1", leadId: "lead-1" });
    const events: PublicAgentEvent[] = []; await runtime.send(conversation.id, "What is your internal profit margin and bank balance?", (event) => events.push(event));
    expect(events.some((event) => event.type === "done")).toBe(true); expect(events.some((event) => event.type === "consulting")).toBe(false);
    expect(events.filter((event) => event.type === "assistant_delta").map((event) => event.content).join("")).toContain("can’t access");
    const tracked = await crm.publicConversations(); expect(tracked).toHaveLength(1); expect(tracked[0].messageCount).toBe(2); expect(tracked[0].status).toBe("awaiting_customer");
  });

  it("brings the routed specialist into the visible customer chat with a distinct recorded message", async () => {
    const workspace = await root(); const records = new WorkspaceRecords(workspace);
    await records.initialize(OnboardingInputSchema.parse({ companyName: "Samuel Studio", ownerName: "Samuel", industry: "Creative studio", description: "A photography, design, and digital creative studio.", services: "Photography and digital experiences", hours: "Monday to Friday", policies: "Owner approval required.", tone: "Warm and clear", goals: "Serve clients well", currency: "USD", timezone: "America/Chicago" }));
    const crm = new CrmStore(workspace); const qualifications = new SalesQualificationStore(workspace); const runtime = new PublicReceptionistRuntime(records, crm, new OperationsStore(workspace), new ServiceCaseStore(workspace), qualifications, SettingsSchema.parse({}));
    const intake = PublicIntakeSchema.parse({ name: "Maya Chen", email: "maya@example.com", phone: "", need: "I need the right package for my business.", consent: true });
    const conversation = await records.createConversation("receptionist", "Public inquiry", "gemma4:12b");
    await records.appendConversation(conversation.id, "CRM linkage", "Linked to CRM.", { type: "crm_linkage", contactId: "contact-1", leadId: "lead-1", customerName: intake.name, customerEmail: intake.email, initialNeed: intake.need });
    await runtime.start(conversation, intake, { contactId: "contact-1", leadId: "lead-1" });
    const chat = vi.fn()
      .mockResolvedValueOnce({ message: { content: "I’m the Sales specialist. The Professional Website is the best starting point for this scope." } })
      .mockResolvedValueOnce(await stream({ message: { content: "I’ll stay with you and help confirm the next step." } }));
    (runtime as unknown as { client: { chat: typeof chat } }).client = { chat };
    const events: PublicAgentEvent[] = [];
    await runtime.send(conversation.id, "What package and price fit a five-page business site?", (event) => events.push(event));
    expect(events).toContainEqual(expect.objectContaining({ type: "specialist_joined", employeeId: "sales", name: "Sales" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "specialist_message", employeeId: "sales", content: expect.stringContaining("Professional Website") }));
    expect(events.filter((event) => event.type === "assistant_delta").map((event) => event.content).join("")).toContain("stay with you");
    const markdown = await readFile(join(workspace, conversation.file), "utf8");
    expect(markdown).toContain("## Sales Specialist"); expect(markdown).toContain("public_specialist_message");
    const tracked = await crm.publicConversations(); expect(tracked[0].messageCount).toBe(3); expect(tracked[0].departments).toContain("Sales");
    const created = await qualifications.list(); expect(created).toHaveLength(1); expect(created[0]).toEqual(expect.objectContaining({ conversationId: conversation.id, leadId: "lead-1" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "sales_progress_created", salesProgress: expect.objectContaining({ id: created[0].id }) }));
  });

  it("automatically opens one owner-attention case when support routing detects a refund concern", async () => {
    const workspace = await root(); const records = new WorkspaceRecords(workspace);
    await records.initialize(OnboardingInputSchema.parse({ companyName: "Samuel Studio", ownerName: "Samuel", industry: "Creative studio", description: "A photography, design, and digital creative studio.", services: "Photography and digital experiences", hours: "Monday to Friday", policies: "Refunds require owner approval.", tone: "Warm and clear", goals: "Serve clients well", currency: "USD", timezone: "America/Chicago" }));
    const crm = new CrmStore(workspace); const serviceCases = new ServiceCaseStore(workspace); const runtime = new PublicReceptionistRuntime(records, crm, new OperationsStore(workspace), serviceCases, SettingsSchema.parse({}));
    const intake = PublicIntakeSchema.parse({ name: "Maya Chen", email: "maya@example.com", phone: "", need: "I need help with an existing project.", consent: true });
    const conversation = await records.createConversation("receptionist", "Public support", "gemma4:12b");
    await records.appendConversation(conversation.id, "CRM linkage", "Linked to CRM.", { type: "crm_linkage", contactId: "contact-1", leadId: "lead-1", customerName: intake.name, customerEmail: intake.email, initialNeed: intake.need });
    await runtime.start(conversation, intake, { contactId: "contact-1", leadId: "lead-1" });
    const chat = vi.fn().mockResolvedValueOnce({ message: { content: "I’m the Customer Service specialist. I’ve documented the concern without promising a refund." } }).mockResolvedValueOnce(await stream({ message: { content: "Your request is recorded for owner review." } }));
    (runtime as unknown as { client: { chat: typeof chat } }).client = { chat };
    const events: PublicAgentEvent[] = []; await runtime.send(conversation.id, "I have a complaint and want a refund.", (event) => events.push(event));
    const cases = await serviceCases.list(); expect(cases).toHaveLength(1); expect(cases[0]).toEqual(expect.objectContaining({ status: "awaiting_owner", priority: "high", conversationId: conversation.id }));
    expect(events).toContainEqual(expect.objectContaining({ type: "service_case_created", serviceCase: expect.objectContaining({ id: cases[0].id, statusLabel: "Owner review" }) }));
    await runtime.send(conversation.id, "What is the status of the refund request?", () => undefined); expect(await serviceCases.list()).toHaveLength(1);
  });

  it("resumes a browser-authorized conversation after restart with its visible history", async () => {
    const workspace = await root(); const records = new WorkspaceRecords(workspace);
    await records.initialize(OnboardingInputSchema.parse({ companyName: "Samuel Studio", ownerName: "Samuel", industry: "Creative studio", description: "A photography, design, and digital creative studio.", services: "Photography and digital experiences", hours: "Monday to Friday", policies: "Owner approval required.", tone: "Warm and clear", goals: "Serve clients well", currency: "USD", timezone: "America/Chicago" }));
    const intake = PublicIntakeSchema.parse({ name: "Ed Example", email: "ed@example.com", phone: "", need: "I need a website quote.", consent: true });
    const conversation = await records.createConversation("receptionist", "Public inquiry", "gemma4:12b");
    const resume = issuePublicResumeToken();
    await records.appendConversation(conversation.id, "CRM linkage", "Linked to CRM.", { type: "crm_linkage", contactId: "contact-1", leadId: "lead-1", customerName: intake.name, customerEmail: intake.email, initialNeed: intake.need });
    await records.appendConversation(conversation.id, "Resume access", "Resume credential issued.", { type: "public_resume", tokenHash: resume.tokenHash });
    await records.appendConversation(conversation.id, "Customer", "The business is Puppy Wash and it needs online booking.", { type: "public_customer_message", customer: intake.name });
    await records.appendConversation(conversation.id, "Receptionist", "I have enough information to prepare the estimate.", { type: "public_assistant_message", route: "sales" });
    const markdown = await readFile(join(workspace, conversation.file), "utf8");
    expect(verifyPublicResumeToken(markdown, resume.token)).toBe(true);
    expect(verifyPublicResumeToken(markdown, `${resume.token}wrong`)).toBe(false);
    const restored = parsePublicConversation(markdown); expect(restored.messages).toHaveLength(2);

    const crm = new CrmStore(workspace); const linked = await crm.createPublicInquiry(intake);
    const restartedRecords = new WorkspaceRecords(workspace); const activated = await restartedRecords.activateConversation(conversation.id);
    const runtime = new PublicReceptionistRuntime(restartedRecords, crm, new OperationsStore(workspace), new ServiceCaseStore(workspace), SettingsSchema.parse({}));
    await runtime.resume(activated.record, restored.intake, restored.messages, { contactId: linked.contact.id, leadId: linked.lead.id });
    const chat = vi.fn()
      .mockResolvedValueOnce({ message: { content: "I remember Puppy Wash. The booking requirement is already part of the estimate." } })
      .mockResolvedValueOnce({ message: { content: "The Developer confirms the website and booking scope are preserved." } })
      .mockResolvedValueOnce(await stream({ message: { content: "Your published estimate is attached now, including the booking system." } }));
    (runtime as unknown as { client: { chat: typeof chat } }).client = { chat };
    await runtime.send(conversation.id, "Do you have my quote please?", () => undefined);
    expect(chat.mock.calls[0][0].messages[0].content).toContain("Puppy Wash");
    expect(chat.mock.calls[0][0].messages[0].content).toContain("online booking");
  });

  it("turns the Puppy Wash request into a delivered published-price proposal and CRM follow-up", async () => {
    const workspace = await root(); const records = new WorkspaceRecords(workspace);
    await records.initialize(OnboardingInputSchema.parse({ companyName: "Samuel Studio", ownerName: "Samuel", industry: "Creative studio", description: "A photography, design, and digital creative studio.", services: "Photography and digital experiences", hours: "Monday to Friday", policies: "Owner approval required.", tone: "Warm and clear", goals: "Serve clients well", currency: "USD", timezone: "America/Chicago" }));
    const crm = new CrmStore(workspace); const operations = new OperationsStore(workspace);
    const intake = PublicIntakeSchema.parse({ name: "Ed Christoffersen", email: "ed@example.com", phone: "", need: "Puppy Wash needs a professional website with all services, a booking system, a custom logo in blue and red, and domain guidance.", consent: true });
    const linked = await crm.createPublicInquiry(intake); const conversation = await records.createConversation("receptionist", "Puppy Wash", "gemma4:12b");
    await records.appendConversation(conversation.id, "CRM linkage", "Linked to CRM.", { type: "crm_linkage", contactId: linked.contact.id, leadId: linked.lead.id, customerName: intake.name, customerEmail: intake.email, initialNeed: intake.need });
    const runtime = new PublicReceptionistRuntime(records, crm, operations, new ServiceCaseStore(workspace), SettingsSchema.parse({})); await runtime.start(conversation, intake, { contactId: linked.contact.id, leadId: linked.lead.id });
    const chat = vi.fn()
      .mockResolvedValueOnce({ message: { content: "Sales recommends the Professional Website and Booking System published packages." } })
      .mockResolvedValueOnce({ message: { content: "Developer confirms the site and scheduling scope are technically compatible." } })
      .mockResolvedValueOnce({ message: { content: "Designer notes the blue-and-red logo is custom-scoped after discovery." } })
      .mockResolvedValueOnce(await stream({ message: { content: "Your Puppy Wash estimate is attached now. The logo remains custom-scoped after discovery." } }));
    (runtime as unknown as { client: { chat: typeof chat } }).client = { chat };
    const events: PublicAgentEvent[] = []; await runtime.send(conversation.id, "Do you have my quote please?", (event) => events.push(event));
    const ready = events.find((event) => event.type === "quote_ready"); expect(ready?.type).toBe("quote_ready");
    if (ready?.type !== "quote_ready") throw new Error("Quote event missing");
    expect(ready.quote.subtotal).toBe(1198); expect(ready.quote.lines.map((line) => line.label)).toContain("Custom logo and identity"); expect(ready.deliverable.accessUrl).toContain("/api/public/deliverables/");
    const url = new URL(ready.deliverable.accessUrl!, "http://localhost"); const opened = await operations.publicDeliverable(ready.deliverable.id, url.searchParams.get("token")!);
    expect(opened.content).toContain("Puppy Wash"); expect(opened.content).toContain("$1,198"); expect(opened.content).toContain("Purchase");
    expect((await operations.listWorkItems())[0].status).toBe("delivered"); expect(await operations.listQuotes()).toHaveLength(1);
    const crmData = await crm.bootstrap(); expect(crmData.leads.find((lead) => lead.id === linked.lead.id)?.value).toBe(1198); expect(crmData.tasks.some((task) => task.title.includes("Puppy Wash"))).toBe(true);
    const visible = events.filter((event) => event.type === "assistant_delta").map((event) => event.content).join(""); expect(visible).not.toMatch(/ready shortly|be right back/i);
  });

  it("creates a tentative hold from an explicit date and reports owner-confirmation status without looping", async () => {
    const workspace = await root(); const records = new WorkspaceRecords(workspace);
    await records.initialize(OnboardingInputSchema.parse({ companyName: "Samuel Studio", ownerName: "Samuel", industry: "Creative studio", description: "A photography, design, and digital creative studio.", services: "Photography and digital experiences", hours: "Monday through Saturday, 10 AM to 6 PM", policies: "Only the owner confirms appointments.", tone: "Warm and clear", goals: "Serve clients well", currency: "USD", timezone: "America/Chicago" }));
    const crm = new CrmStore(workspace); const operations = new OperationsStore(workspace);
    const intake = PublicIntakeSchema.parse({ name: "Ed Example", email: "ed@example.com", phone: "", need: "I want to schedule a consultation.", consent: true });
    const linked = await crm.createPublicInquiry(intake); const conversation = await records.createConversation("receptionist", "Appointment", "gemma4:latest");
    await records.appendConversation(conversation.id, "CRM linkage", "Linked to CRM.", { type: "crm_linkage", contactId: linked.contact.id, leadId: linked.lead.id, customerName: intake.name, customerEmail: intake.email, initialNeed: intake.need });
    const runtime = new PublicReceptionistRuntime(records, crm, operations, new ServiceCaseStore(workspace), SettingsSchema.parse({})); await runtime.start(conversation, intake, { contactId: linked.contact.id, leadId: linked.lead.id });
    const target = new Date(); target.setDate(target.getDate() + 1); while ([0, 6].includes(target.getDay())) target.setDate(target.getDate() + 1); target.setHours(10, 0, 0, 0);
    const month = new Intl.DateTimeFormat("en-US", { month: "long" }).format(target); const request = `${month} ${target.getDate()}th 10am`;
    const events: PublicAgentEvent[] = []; await runtime.send(conversation.id, request, (event) => events.push(event));
    const message = events.filter((event) => event.type === "assistant_delta").map((event) => event.content).join("");
    expect(message).toContain("tentative hold"); expect(message).toContain("owner still needs to confirm"); expect(message).not.toContain("completed deliverable");
    const data = await crm.bootstrap(); expect(data.appointments).toHaveLength(1); expect(data.appointments[0].status).toBe("tentative"); expect(new Date(data.appointments[0].startAt).getHours()).toBe(10);
    expect((await operations.listWorkItems()).find((item) => item.kind === "appointment")?.status).toBe("awaiting_owner");
    const statusEvents: PublicAgentEvent[] = []; await runtime.send(conversation.id, "Confirm", (event) => statusEvents.push(event));
    const status = statusEvents.filter((event) => event.type === "assistant_delta").map((event) => event.content).join("");
    expect(status).toContain("awaiting the studio owner’s confirmation"); expect((await crm.bootstrap()).appointments[0].status).toBe("tentative");
  });
});
