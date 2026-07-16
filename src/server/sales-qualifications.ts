import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { nanoid } from "nanoid";
import {
  PublicSalesProgressSummarySchema, SalesOperationsResponseSchema, SalesQualificationCreateSchema, SalesQualificationPatchSchema, SalesQualificationSchema,
  type PublicSalesProgressSummary, type SalesEvidenceLink, type SalesOperationsResponse, type SalesQualification, type SalesQualificationEvent,
} from "../shared/schemas.js";
import { atomicWriteText, readSafeText } from "./paths.js";
import type { RecordHealthRegistry } from "./reliability.js";

const now = () => new Date().toISOString();
const openReadiness = new Set<SalesQualification["readiness"]>(["new", "collecting", "discovery_ready", "proposal_ready", "awaiting_owner"]);
const attentionRules: Array<[RegExp, string]> = [
  [/\b(discount|reduced rate|price match|negotiat(?:e|ed|ion))\b/i, "Discount or negotiated pricing"],
  [/\b(rush|asap|urgent|immediately|this week|within \d+ days?)\b/i, "Rush timing or availability"],
  [/\b(exclusiv(?:e|ity)|non-compete)\b/i, "Exclusivity terms"],
  [/\b(licen[cs](?:e|ing)|usage rights?|copyright|ownership|work for hire)\b/i, "Licensing or rights terms"],
  [/\b(travel|flight|hotel|vendor|permit|talent|rental)\b/i, "Travel or third-party cost"],
  [/\b(guarantee|commit(?:ment)?|promise)\b/i, "Unverified commitment"],
];

function qualificationEvent(input: Omit<SalesQualificationEvent, "id" | "createdAt">): SalesQualificationEvent {
  return { id: nanoid(10), createdAt: now(), ...input };
}

function attentionReasons(text: string): string[] {
  return attentionRules.flatMap(([pattern, reason]) => pattern.test(text) ? [reason] : []);
}

function readinessFacts(value: Pick<SalesQualification, "serviceInterest" | "projectGoal" | "deliverables" | "targetTiming" | "budgetState" | "decisionMakerState">): { missing: string[]; readiness: SalesQualification["readiness"] } {
  const missing = [
    ...(!value.serviceInterest.trim() ? ["Service interest"] : []),
    ...(!value.projectGoal.trim() ? ["Project goal or intended outcome"] : []),
    ...(!value.deliverables.length ? ["Expected deliverables"] : []),
    ...(!value.targetTiming.trim() ? ["Target timing"] : []),
    ...(value.budgetState === "unknown" ? ["Budget range or explicit budget status"] : []),
    ...(value.decisionMakerState === "unknown" ? ["Decision-maker status"] : []),
  ];
  const empty = !value.serviceInterest && !value.projectGoal && !value.deliverables.length && !value.targetTiming;
  return { missing, readiness: empty ? "new" : missing.length ? "collecting" : "proposal_ready" };
}

function statusLabel(readiness: SalesQualification["readiness"]): string {
  return { new: "Inquiry received", collecting: "Gathering project details", discovery_ready: "Ready for discovery", proposal_ready: "Preparing proposal", awaiting_owner: "Owner review", proposal_delivered: "Proposal ready", closed: "Closed" }[readiness];
}

function markdown(value: SalesQualification): string {
  const evidence = value.evidence.map((item) => `- ${item.label}: \`${item.path}\`${item.excerpt ? ` — ${item.excerpt}` : ""}`).join("\n") || "- No evidence linked yet.";
  const timeline = value.events.map((item) => `### ${item.summary} — ${item.createdAt}\n\n${item.detail || "No additional detail."}\n\n<!-- SALES_QUALIFICATION_EVENT ${JSON.stringify(item).replace(/-->/g, "--\\>")} -->`).join("\n\n") || "No timeline events.";
  return `---\nschema_version: 1\nid: ${JSON.stringify(value.id)}\ntype: "sales-qualification"\ncreated_at: ${JSON.stringify(value.createdAt)}\n---\n\n# ${value.title}\n\n- Readiness: ${value.readiness}\n- Contact: ${value.contactId}\n- Lead: ${value.leadId}\n- Conversation: ${value.conversationId ?? "—"}\n- Service: ${value.serviceInterest || "Not established"}\n- Target timing: ${value.targetTiming || "Not established"}\n- Budget state: ${value.budgetState}\n- Decision-maker state: ${value.decisionMakerState}\n- Owner attention: ${value.ownerAttention ? "Yes" : "No"}\n- Next step: ${value.nextStep || "Not set"}\n\n## Project goal\n\n${value.projectGoal || "Not established."}\n\n## Expected deliverables\n\n${value.deliverables.map((item) => `- ${item}`).join("\n") || "- Not established."}\n\n## Missing information\n\n${value.missingInformation.map((item) => `- ${item}`).join("\n") || "- None."}\n\n## Constraints and owner attention\n\n${[...value.constraints, ...value.ownerAttentionReasons].map((item) => `- ${item}`).join("\n") || "- None."}\n\n## Private evidence\n\n${evidence}\n\n## Timeline\n\n${timeline}\n\n<!-- SALES_QUALIFICATION_META ${JSON.stringify(value).replace(/-->/g, "--\\>")} -->\n`;
}

async function qualificationFiles(root: string): Promise<string[]> {
  const directory = join(root, "crm", "sales-qualifications");
  try { return (await readdir(directory, { withFileTypes: true })).filter((item) => item.isFile() && item.name.endsWith(".md")).map((item) => join(directory, item.name)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

function inferredService(content: string): string {
  if (/\b(website|web app|landing page|e-?commerce|hosting)\b/i.test(content)) return "Website and digital";
  if (/\b(brand|branding|logo|identity)\b/i.test(content)) return "Brand strategy and identity";
  if (/\b(photo|photography|portrait|editorial|campaign shoot)\b/i.test(content)) return "Photography and creative production";
  if (/\b(marketing|campaign|social media|content)\b/i.test(content)) return "Marketing and campaign support";
  return /\b(price|pricing|quote|proposal|package|hire|budget|book a project)\b/i.test(content) ? "Samuel Studio services" : "";
}

function inferredDeliverables(content: string): string[] {
  const rules: Array<[RegExp, string]> = [[/\bwebsite|web app|landing page\b/i, "Website"], [/\bbrand|branding|logo|identity\b/i, "Brand system"], [/\bphoto|photography|portrait|editorial\b/i, "Photography"], [/\bcampaign\b/i, "Campaign"], [/\bproposal\b/i, "Proposal"]];
  return rules.flatMap(([pattern, label]) => pattern.test(content) ? [label] : []);
}

export class SalesQualificationStore {
  constructor(readonly root: string, private readonly health?: RecordHealthRegistry) {}

  async initialize(): Promise<void> { await mkdir(join(this.root, "crm", "sales-qualifications"), { recursive: true }); }

  async list(): Promise<SalesQualification[]> {
    await this.initialize(); const output: SalesQualification[] = [];
    for (const file of await qualificationFiles(this.root)) {
      const path = relative(this.root, file).split("\\").join("/");
      try {
        const text = await readFile(file, "utf8"); const match = text.match(/<!-- SALES_QUALIFICATION_META (\{.*\}) -->/);
        if (!match) throw new Error("Missing SALES_QUALIFICATION_META metadata.");
        const value = SalesQualificationSchema.parse(JSON.parse(match[1])); output.push(value); this.health?.clear(path);
      } catch (error) { this.health?.report(path, "crm:sales-qualifications", error); }
    }
    return output.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<SalesQualification> {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw Object.assign(new Error("Invalid sales qualification id."), { statusCode: 400 });
    const value = (await this.list()).find((item) => item.id === id);
    if (!value) throw Object.assign(new Error("Sales qualification not found."), { statusCode: 404 });
    return value;
  }

  async create(input: unknown): Promise<SalesQualification> {
    const parsed = SalesQualificationCreateSchema.parse(input);
    const existing = (await this.list()).find((item) => openReadiness.has(item.readiness) && (item.leadId === parsed.leadId || Boolean(parsed.conversationId && item.conversationId === parsed.conversationId)));
    if (existing) return existing;
    const stamp = now(); const id = nanoid(12); const reasons = attentionReasons(`${parsed.title}\n${parsed.projectGoal}\n${parsed.constraints.join("\n")}`);
    const facts = readinessFacts({ serviceInterest: parsed.serviceInterest, projectGoal: parsed.projectGoal, deliverables: parsed.deliverables, targetTiming: parsed.targetTiming, budgetState: parsed.budgetState, decisionMakerState: parsed.decisionMakerState });
    const readiness = reasons.length && facts.readiness === "proposal_ready" ? "awaiting_owner" : facts.readiness;
    const events = [qualificationEvent({ type: "created", actor: parsed.createdBy === "owner" ? "owner" : parsed.createdBy === "receptionist" ? "receptionist" : "system", summary: "Sales qualification created", detail: parsed.projectGoal || parsed.title, publicSummary: "Your project inquiry was received.", operationId: null }), ...(reasons.length ? [qualificationEvent({ type: "owner_attention" as const, actor: "system" as const, summary: "Owner review required", detail: reasons.join("; "), publicSummary: null, operationId: null })] : [])];
    const value = SalesQualificationSchema.parse({ ...parsed, id, conversationId: parsed.conversationId ?? null, appointmentId: parsed.appointmentId ?? null, projectId: null, workItemId: null, proposalId: null, deliverableId: null, assignedEmployeeId: "sales", missingInformation: facts.missing, readiness, ownerAttention: reasons.length > 0, ownerAttentionReasons: reasons, evidence: [], events, createdAt: stamp, updatedAt: stamp, closedAt: null, file: `crm/sales-qualifications/${id}.md` });
    await this.write(value); return value;
  }

  async createFromRouting(input: { contactId: string; leadId: string; conversationId: string; customerName: string; content: string }): Promise<SalesQualification> {
    const budgetMatch = input.content.match(/(?:\$|USD\s*)[\d,.]+(?:\s*(?:-|to)\s*(?:\$|USD\s*)?[\d,.]+)?|\bbudget\s+(?:is|of|around)\s+[^.,\n]+/i);
    const decisionConfirmed = /\b(i am|i'm|we are)\s+(?:the\s+)?(?:owner|founder|decision maker)\b/i.test(input.content);
    return this.create({ contactId: input.contactId, leadId: input.leadId, conversationId: input.conversationId, title: `${input.customerName} opportunity`, serviceInterest: inferredService(input.content), projectGoal: input.content, deliverables: inferredDeliverables(input.content), targetTiming: /\b(by|before|launch|deadline|this (?:week|month|quarter)|next (?:week|month|quarter))\b/i.test(input.content) ? input.content.slice(0, 500) : "", location: "", budgetState: budgetMatch ? "provided" : "unknown", budgetRange: budgetMatch?.[0] ?? "", decisionMakerState: decisionConfirmed ? "confirmed" : "unknown", decisionMakers: decisionConfirmed ? input.customerName : "", constraints: [], nextStep: "Receptionist collects the remaining project details for Sales.", createdBy: "receptionist" });
  }

  async update(id: string, patch: unknown, actor: "owner" | "sales" = "owner", operationId: string | null = null): Promise<SalesQualification> {
    const current = await this.get(id); if (operationId && current.events.some((item) => item.operationId === operationId)) return current;
    const parsed = SalesQualificationPatchSchema.parse(patch); const stamp = now();
    const evidence = parsed.evidence ? await this.validateEvidence(parsed.evidence) : current.evidence;
    const merged = { ...current, ...parsed, evidence };
    const facts = readinessFacts(merged); const reasons = attentionReasons([merged.projectGoal, merged.targetTiming, merged.budgetRange, ...merged.constraints].join("\n"));
    const derived = reasons.length && facts.readiness === "proposal_ready" ? "awaiting_owner" : facts.readiness;
    const readiness = parsed.readiness ?? (current.readiness === "proposal_delivered" || current.readiness === "closed" ? current.readiness : derived);
    const events = [...current.events];
    if (readiness !== current.readiness) events.push(qualificationEvent({ type: readiness === "closed" ? "closed" : "readiness_changed", actor, summary: `Readiness changed to ${readiness.replaceAll("_", " ")}`, detail: parsed.nextStep ?? current.nextStep, publicSummary: `Your project inquiry is now ${statusLabel(readiness).toLowerCase()}.`, operationId }));
    if (evidence.length > current.evidence.length) events.push(qualificationEvent({ type: "evidence_added", actor, summary: "Sales evidence updated", detail: `${evidence.length} verified source${evidence.length === 1 ? "" : "s"} linked.`, publicSummary: null, operationId }));
    if (operationId && !events.some((item) => item.operationId === operationId)) events.push(qualificationEvent({ type: "updated", actor, summary: "Approved qualification update applied", detail: parsed.nextStep ?? current.nextStep, publicSummary: null, operationId }));
    const value = SalesQualificationSchema.parse({ ...merged, readiness, missingInformation: facts.missing, ownerAttention: reasons.length > 0, ownerAttentionReasons: reasons, events, updatedAt: stamp, closedAt: readiness === "closed" ? stamp : current.closedAt });
    await this.write(value); return value;
  }

  async markProposalDelivered(id: string, input: { operationId: string; projectId: string; workItemId: string; proposalId: string; deliverableId: string }): Promise<SalesQualification> {
    const current = await this.get(id); if (current.events.some((item) => item.operationId === input.operationId)) return current;
    const stamp = now(); const value = SalesQualificationSchema.parse({ ...current, ...input, readiness: "proposal_delivered", nextStep: "Review the proposal and share any questions in this conversation.", updatedAt: stamp, events: [...current.events, qualificationEvent({ type: "proposal_delivered", actor: "sales", summary: "Owner-approved proposal delivered", detail: `Proposal ${input.proposalId} and deliverable ${input.deliverableId} were added to the customer conversation.`, publicSummary: "Your proposal is ready to review.", operationId: input.operationId })] });
    await this.write(value); return value;
  }

  async publicForConversation(conversationId: string): Promise<PublicSalesProgressSummary[]> {
    const values = (await this.list()).filter((item) => item.conversationId === conversationId && item.readiness !== "closed").map((item) => PublicSalesProgressSummarySchema.parse({ id: item.id, readiness: item.readiness, statusLabel: statusLabel(item.readiness), lastUpdated: item.updatedAt, nextStep: item.nextStep || "The studio is reviewing the project details." }));
    return values;
  }

  async operations(): Promise<SalesOperationsResponse> {
    const qualifications = await this.list();
    return SalesOperationsResponseSchema.parse({ qualifications, summary: { new: qualifications.filter((item) => item.readiness === "new").length, collecting: qualifications.filter((item) => item.readiness === "collecting").length, discoveryReady: qualifications.filter((item) => item.readiness === "discovery_ready").length, proposalReady: qualifications.filter((item) => item.readiness === "proposal_ready").length, ownerReview: qualifications.filter((item) => item.readiness === "awaiting_owner").length, delivered: qualifications.filter((item) => item.readiness === "proposal_delivered").length } });
  }

  private async validateEvidence(input: Array<{ kind: SalesEvidenceLink["kind"]; path: string; label: string; excerpt: string }>): Promise<SalesEvidenceLink[]> {
    const stamp = now(); const result: SalesEvidenceLink[] = [];
    for (const item of input) {
      const path = item.path.replace(/\\/g, "/");
      const company = path.startsWith("company/") && path.endsWith(".md") && !path.startsWith("company/finance/");
      const library = path.startsWith("shared/employee-files/sales/") && path.endsWith(".agent.md");
      if ((item.kind === "sales_library" && !library) || (item.kind !== "sales_library" && !company)) throw new Error("Sales evidence must come from company Markdown or a Sales library companion.");
      const content = await readSafeText(this.root, path);
      if (item.excerpt && !content.includes(item.excerpt)) throw new Error(`Evidence excerpt was not found in ${path}.`);
      result.push({ ...item, path, id: nanoid(10), addedAt: stamp });
    }
    return result;
  }

  private async write(value: SalesQualification): Promise<void> { await atomicWriteText(this.root, value.file, markdown(value)); }
}

export { openReadiness as openSalesReadiness };
