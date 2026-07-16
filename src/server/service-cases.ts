import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { nanoid } from "nanoid";
import {
  FrontDeskResponseSchema, ServiceCaseCreateSchema, ServiceCasePatchSchema, ServiceCaseSchema,
  type CrmAppointment, type CrmContact, type CrmConversation, type FrontDeskItem, type FrontDeskResponse,
  type PublicServiceCaseSummary, type SalesQualification, type ServiceCase, type ServiceCaseEvent, type WorkItem,
} from "../shared/schemas.js";
import { atomicWriteText } from "./paths.js";
import type { RecordHealthRegistry } from "./reliability.js";
import type { WorkspaceRecords } from "./records.js";

const now = () => new Date().toISOString();
const openStatuses = new Set<ServiceCase["status"]>(["new", "investigating", "awaiting_owner", "awaiting_customer"]);
const mandatoryEscalation = /\b(refund|compensation|legal|lawsuit|attorney|rights?|licen[cs]ing|copyright|safety|injur(?:y|ed)|privacy|data (?:leak|breach)|policy exception|harass(?:ment|ed))\b/i;

function categoryFor(text: string): ServiceCase["category"] {
  if (/\b(refund|invoice|billing|charge|payment)\b/i.test(text)) return "billing";
  if (/\b(copyright|rights?|licen[cs]ing|credit)\b/i.test(text)) return "rights";
  if (/\b(privacy|data (?:leak|breach))\b/i.test(text)) return "privacy";
  if (/\b(safety|injur(?:y|ed)|harass(?:ment|ed))\b/i.test(text)) return "safety";
  if (/\b(policy exception|exception to (?:the )?policy)\b/i.test(text)) return "policy_exception";
  if (/\b(delivery|deliverable|late|deadline|missing file)\b/i.test(text)) return "delivery";
  if (/\b(website|technical|bug|broken|login)\b/i.test(text)) return "technical";
  if (/\b(complaint|problem|issue|revision|support)\b/i.test(text)) return "complaint";
  return "question";
}

function statusLabel(status: ServiceCase["status"]): string {
  return { new: "Received", investigating: "Under review", awaiting_owner: "Owner review", awaiting_customer: "Waiting for your reply", resolved: "Resolved", closed: "Closed" }[status];
}

function event(input: Omit<ServiceCaseEvent, "id" | "createdAt">): ServiceCaseEvent {
  return { id: nanoid(10), createdAt: now(), ...input };
}

function markdown(value: ServiceCase): string {
  const timeline = value.events.map((item) => `### ${item.summary} — ${item.createdAt}\n\n${item.detail || "No additional detail."}\n\n<!-- CASE_EVENT ${JSON.stringify(item).replace(/-->/g, "--\\>")} -->`).join("\n\n");
  return `---\nschema_version: 1\nid: ${JSON.stringify(value.id)}\ntype: "service-case"\ncreated_at: ${JSON.stringify(value.createdAt)}\n---\n\n# ${value.title}\n\n- Status: ${value.status}\n- Priority: ${value.priority}\n- Category: ${value.category}\n- Contact: ${value.contactId}\n- Conversation: ${value.conversationId}\n- Next step: ${value.nextStep || "Not set"}\n\n## Summary\n\n${value.summary}\n\n## Desired outcome\n\n${value.desiredOutcome || "Not recorded."}\n\n## Internal notes\n\n${value.internalNotes || "No internal notes."}\n\n## Timeline\n\n${timeline || "No timeline events."}\n\n<!-- SERVICE_CASE_META ${JSON.stringify(value).replace(/-->/g, "--\\>")} -->\n`;
}

async function caseFiles(root: string): Promise<string[]> {
  const directory = join(root, "crm", "service-cases");
  try { return (await readdir(directory, { withFileTypes: true })).filter((item) => item.isFile() && item.name.endsWith(".md")).map((item) => join(directory, item.name)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

export class ServiceCaseStore {
  constructor(readonly root: string, private readonly health?: RecordHealthRegistry) {}

  async initialize(): Promise<void> { await mkdir(join(this.root, "crm", "service-cases"), { recursive: true }); }

  async list(): Promise<ServiceCase[]> {
    await this.initialize(); const output: ServiceCase[] = [];
    for (const file of await caseFiles(this.root)) {
      const path = relative(this.root, file).split("\\").join("/");
      try {
        const text = await readFile(file, "utf8"); const match = text.match(/<!-- SERVICE_CASE_META (\{.*\}) -->/);
        if (!match) throw new Error("Missing SERVICE_CASE_META metadata.");
        const value = ServiceCaseSchema.parse(JSON.parse(match[1])); output.push(value); this.health?.clear(path);
      } catch (error) { this.health?.report(path, "crm:service-cases", error); }
    }
    return output.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<ServiceCase> {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw Object.assign(new Error("Invalid service case id."), { statusCode: 400 });
    const value = (await this.list()).find((item) => item.id === id);
    if (!value) throw Object.assign(new Error("Service case not found."), { statusCode: 404 });
    return value;
  }

  async create(input: unknown): Promise<ServiceCase> {
    const parsed = ServiceCaseCreateSchema.parse(input);
    const existing = (await this.list()).find((item) => item.conversationId === parsed.conversationId && openStatuses.has(item.status));
    if (existing) return existing;
    const stamp = now(); const id = nanoid(12); const escalated = mandatoryEscalation.test(`${parsed.title}\n${parsed.summary}\n${parsed.desiredOutcome}`);
    const created = event({ type: "created", actor: parsed.createdBy === "owner" ? "owner" : parsed.createdBy === "receptionist" ? "receptionist" : "system", summary: "Service case created", detail: parsed.summary, publicSummary: "Your request was received by Customer Service.", operationId: null });
    const events = [created, ...(escalated ? [event({ type: "escalated", actor: "system", summary: "Mandatory owner review", detail: "The request may involve a refund, legal, rights, safety, privacy, harassment, or policy-exception concern. No remedy was promised.", publicSummary: null, operationId: null })] : [])];
    const value = ServiceCaseSchema.parse({ ...parsed, id, leadId: parsed.leadId ?? null, appointmentId: parsed.appointmentId ?? null, workItemId: parsed.workItemId ?? null, assignedEmployeeId: "customer-service", category: parsed.category === "other" ? categoryFor(`${parsed.title}\n${parsed.summary}`) : parsed.category, priority: escalated ? "high" : parsed.priority, status: escalated ? "awaiting_owner" : "new", createdAt: stamp, updatedAt: stamp, resolvedAt: null, events, file: `crm/service-cases/${id}.md` });
    await this.write(value); return value;
  }

  async createFromRouting(input: { contactId: string; leadId: string; conversationId: string; customerName: string; content: string }): Promise<ServiceCase> {
    return this.create({ contactId: input.contactId, leadId: input.leadId, conversationId: input.conversationId, title: `${input.customerName} service request`, summary: input.content, desiredOutcome: "Understand the concern and agree on an owner-approved next step.", nextStep: "Customer Service reviews the conversation and prepares a response for owner approval.", createdBy: "receptionist", category: categoryFor(input.content), priority: "normal" });
  }

  async update(id: string, patch: unknown, actor: "owner" | "customer-service" = "owner"): Promise<ServiceCase> {
    const current = await this.get(id); const parsed = ServiceCasePatchSchema.parse(patch); const stamp = now(); const events = [...current.events];
    if (parsed.status && parsed.status !== current.status) events.push(event({ type: parsed.status === "resolved" ? "resolved" : current.status === "resolved" ? "reopened" : "status_changed", actor, summary: `Status changed to ${parsed.status.replaceAll("_", " ")}`, detail: parsed.nextStep ?? current.nextStep, publicSummary: `Your case is now ${statusLabel(parsed.status).toLowerCase()}.`, operationId: null }));
    const value = ServiceCaseSchema.parse({ ...current, ...parsed, updatedAt: stamp, resolvedAt: parsed.status ? (parsed.status === "resolved" ? stamp : null) : current.resolvedAt, events });
    await this.write(value); return value;
  }

  async appendApprovedReply(input: { caseId: string; publicConversationId: string; content: string; operationId: string }, records: WorkspaceRecords): Promise<ServiceCase> {
    const current = await this.get(input.caseId);
    if (current.conversationId !== input.publicConversationId) throw new Error("The proposed reply does not match the case conversation.");
    const activated = await records.activateConversation(input.publicConversationId, "receptionist");
    const marker = `\"operationId\":${JSON.stringify(input.operationId)}`;
    if (!activated.content.includes(marker)) await records.appendConversation(input.publicConversationId, "Customer Service Specialist", input.content, { type: "public_specialist_message", employeeId: "customer-service", department: "Customer Service", caseId: current.id, operationId: input.operationId });
    const refreshed = await this.get(input.caseId);
    if (refreshed.events.some((item) => item.operationId === input.operationId)) return refreshed;
    const stamp = now(); const value = ServiceCaseSchema.parse({ ...refreshed, status: "awaiting_customer", nextStep: "Review the Customer Service reply and respond here if anything remains unresolved.", updatedAt: stamp, events: [...refreshed.events, event({ type: "reply_approved", actor: "customer-service", summary: "Approved reply added to customer conversation", detail: input.content, publicSummary: "Customer Service added a response to this conversation.", operationId: input.operationId })] });
    await this.write(value); return value;
  }

  async publicForConversation(conversationId: string): Promise<PublicServiceCaseSummary[]> {
    return (await this.list()).filter((item) => item.conversationId === conversationId && item.status !== "closed").map((item) => ({ id: item.id, status: item.status, statusLabel: statusLabel(item.status), lastUpdated: item.updatedAt, nextStep: item.nextStep || "Customer Service is reviewing the next step." }));
  }

  private async write(value: ServiceCase): Promise<void> { await atomicWriteText(this.root, value.file, markdown(value)); }
}

export function buildFrontDesk(input: { conversations: CrmConversation[]; contacts: CrmContact[]; appointments: CrmAppointment[]; workItems: WorkItem[]; cases: ServiceCase[]; qualifications?: SalesQualification[] }): FrontDeskResponse {
  const contactName = (id: string | null) => input.contacts.find((item) => item.id === id)?.name ?? "Customer";
  const items: FrontDeskItem[] = input.conversations.map((conversation) => {
    const linkedCase = input.cases.find((item) => item.conversationId === conversation.id && openStatuses.has(item.status));
    const qualification = input.qualifications?.find((item) => item.conversationId === conversation.id && item.readiness !== "closed");
    const kind: FrontDeskItem["kind"] = linkedCase?.status === "awaiting_owner" || qualification?.readiness === "awaiting_owner" ? "owner_confirmation" : qualification?.readiness === "discovery_ready" ? "discovery_request" : qualification && ["new", "collecting"].includes(qualification.readiness) ? "qualification_due" : /\b(call me|callback|phone call)\b/i.test(conversation.initialNeed) ? "callback" : conversation.status === "follow_up_due" ? "follow_up" : "conversation";
    const status = linkedCase?.status ?? qualification?.readiness ?? conversation.status;
    const updatedAt = [conversation.lastActivity, linkedCase?.updatedAt, qualification?.updatedAt].filter((item): item is string => Boolean(item)).sort().at(-1)!;
    return { id: `conversation:${conversation.id}`, kind, title: conversation.initialNeed, customerName: conversation.customerName, summary: linkedCase?.nextStep || qualification?.nextStep || (conversation.departments.length ? `Consulted: ${conversation.departments.join(", ")}` : "Receptionist conversation"), status, needsAttention: linkedCase?.status === "awaiting_owner" || Boolean(qualification && ["new", "collecting", "awaiting_owner"].includes(qualification.readiness)) || ["new", "awaiting_owner", "follow_up_due"].includes(conversation.status), conversationId: conversation.id, contactId: conversation.contactId, appointmentId: linkedCase?.appointmentId ?? qualification?.appointmentId ?? null, workItemId: linkedCase?.workItemId ?? qualification?.workItemId ?? null, caseId: linkedCase?.id ?? null, qualificationId: qualification?.id ?? null, updatedAt };
  });
  for (const work of input.workItems.filter((item) => item.kind === "appointment" && !["closed", "delivered", "failed"].includes(item.status))) items.push({ id: `appointment:${work.id}`, kind: work.status === "awaiting_owner" ? "owner_confirmation" : "appointment", title: work.title, customerName: contactName(work.contactId), summary: work.nextStep, status: work.status, needsAttention: work.status === "awaiting_owner", conversationId: work.conversationId, contactId: work.contactId, appointmentId: work.appointmentId, workItemId: work.id, caseId: null, qualificationId: null, updatedAt: work.updatedAt });
  for (const item of input.cases.filter((candidate) => openStatuses.has(candidate.status))) if (!items.some((existing) => existing.caseId === item.id)) items.push({ id: `case:${item.id}`, kind: item.status === "awaiting_owner" ? "owner_confirmation" : "follow_up", title: item.title, customerName: contactName(item.contactId), summary: item.nextStep, status: item.status, needsAttention: item.status === "awaiting_owner" || item.status === "new", conversationId: item.conversationId, contactId: item.contactId, appointmentId: item.appointmentId, workItemId: item.workItemId, caseId: item.id, qualificationId: null, updatedAt: item.updatedAt });
  for (const item of (input.qualifications ?? []).filter((candidate) => candidate.readiness !== "closed")) if (!items.some((existing) => existing.qualificationId === item.id)) items.push({ id: `qualification:${item.id}`, kind: item.readiness === "awaiting_owner" ? "owner_confirmation" : item.readiness === "discovery_ready" ? "discovery_request" : "qualification_due", title: item.title, customerName: contactName(item.contactId), summary: item.nextStep, status: item.readiness, needsAttention: ["new", "collecting", "awaiting_owner"].includes(item.readiness), conversationId: item.conversationId, contactId: item.contactId, appointmentId: item.appointmentId, workItemId: item.workItemId, caseId: null, qualificationId: item.id, updatedAt: item.updatedAt });
  items.sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention) || b.updatedAt.localeCompare(a.updatedAt));
  return FrontDeskResponseSchema.parse({ items, summary: { newInquiries: items.filter((item) => item.kind === "conversation" && item.status === "new").length, appointmentRequests: items.filter((item) => item.kind === "appointment").length, callbacks: items.filter((item) => item.kind === "callback").length, ownerConfirmations: items.filter((item) => item.kind === "owner_confirmation").length, qualificationDue: items.filter((item) => item.kind === "qualification_due").length } });
}
