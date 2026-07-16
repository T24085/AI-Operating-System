import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { nanoid } from "nanoid";
import {
  DeliverableAccessGrantSchema, DeliverableSchema, ProjectSchema, ProposalSchema, QuoteSchema, WorkItemSchema,
  type Deliverable, type DeliverableAccessGrant, type EmployeeId, type Offer, type Project, type Proposal, type Quote, type QuoteLine, type WorkItem,
} from "../shared/schemas.js";
import { atomicWriteText } from "./paths.js";
import type { RecordHealthRegistry } from "./reliability.js";

type RecordType = WorkItem | Deliverable | Quote | Project | Proposal;
const now = () => new Date().toISOString();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const meta = (value: RecordType & { accessTokenHash?: string; accessGrants?: unknown[] }) => JSON.stringify({ ...value, schemaVersion: 1 }).replace(/-->/g, "--\\>");

async function markdownFiles(dir: string): Promise<string[]> {
  try { return (await readdir(dir, { withFileTypes: true })).filter((item) => item.isFile() && item.name.endsWith(".md")).map((item) => join(dir, item.name)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

function document(title: string, body: string, value: RecordType & { accessTokenHash?: string; accessGrants?: unknown[] }): string {
  return `---\nschema_version: 1\nid: ${JSON.stringify(value.id)}\ntype: ${JSON.stringify(value.file.split("/")[1]?.replace(/s$/, "") ?? "record")}\ncreated_at: ${JSON.stringify(value.createdAt)}\n---\n\n# ${title}\n\n${body.trim()}\n\n<!-- OPS_META ${meta(value)} -->\n`;
}

export interface PublishedDeliverable { deliverable: Deliverable; accessToken: string }

export class OperationsStore {
  constructor(readonly root: string, private readonly health?: RecordHealthRegistry) {}

  async initialize(): Promise<void> {
    for (const dir of ["work-items", "deliverables", "quotes", "projects", "proposals"]) await mkdir(join(this.root, "shared", dir), { recursive: true });
  }

  async createWorkItem(input: Omit<WorkItem, "id" | "createdAt" | "updatedAt" | "completedAt" | "file" | "appointmentId"> & { appointmentId?: string | null }): Promise<WorkItem> {
    await this.initialize(); const stamp = now(); const id = nanoid(12); const file = `shared/work-items/${id}.md`;
    const value = WorkItemSchema.parse({ ...input, id, createdAt: stamp, updatedAt: stamp, completedAt: null, file });
    await atomicWriteText(this.root, file, document(value.title, `- Status: ${value.status}\n- Employee: ${value.employeeId}\n- Kind: ${value.kind}\n- Next step: ${value.nextStep || "Not set"}\n\n## Summary\n\n${value.summary || "No summary yet."}`, value));
    return value;
  }

  async updateWorkItem(id: string, patch: Partial<Pick<WorkItem, "status" | "summary" | "nextStep" | "projectId" | "appointmentId">>): Promise<WorkItem> {
    const current = await this.get("work-items", id, WorkItemSchema); const stamp = now();
    const value = WorkItemSchema.parse({ ...current, ...patch, id, createdAt: current.createdAt, updatedAt: stamp, completedAt: ["ready", "delivered", "closed"].includes(String(patch.status)) ? stamp : current.completedAt });
    await atomicWriteText(this.root, current.file, document(value.title, `- Status: ${value.status}\n- Employee: ${value.employeeId}\n- Kind: ${value.kind}\n- Next step: ${value.nextStep || "Not set"}\n\n## Summary\n\n${value.summary || "No summary yet."}`, value));
    return value;
  }

  async createPublishedQuote(input: {
    conversationId: string; contactId: string; leadId: string; employeeId: EmployeeId; customerName: string;
    projectName: string; offers: Offer[]; customNeeds: string[]; stale: boolean;
  }): Promise<{ workItem: WorkItem; quote: Quote; published: PublishedDeliverable }> {
    const stamp = now();
    const project = await this.createProject({
      contactId: input.contactId, leadId: input.leadId, name: input.projectName, business: input.offers[0]?.business ?? "Samuel Studio",
      status: "proposed", brief: `Customer estimate created from conversation ${input.conversationId}. ${input.customNeeds.join("; ")}`,
      nextStep: "Confirm package fit, custom scope, timeline, and owner approval.",
      participants: [
        { employeeId: "sales", responsibility: "Package fit, estimate, and commercial next step", joinedAt: stamp },
        ...(input.offers.some((offer) => offer.category === "website") ? [{ employeeId: "developer" as const, responsibility: "Website scope and technical feasibility", joinedAt: stamp }] : []),
        ...(input.customNeeds.length ? [{ employeeId: "designer" as const, responsibility: "Custom visual scope and creative direction", joinedAt: stamp }] : []),
      ],
    });
    const workItem = await this.createWorkItem({
      conversationId: input.conversationId, contactId: input.contactId, leadId: input.leadId, projectId: project.id,
      employeeId: input.employeeId, kind: "quote", title: `${input.projectName} estimate`,
      summary: `Published package estimate for ${input.customerName}.`, status: "in_progress", nextStep: "Present the estimate and confirm custom scope.",
    });
    const quoteId = nanoid(12); const lines: QuoteLine[] = input.offers.map((offer) => ({
      offerId: offer.id, label: offer.name, description: offer.inclusions.join("; "), quantity: 1,
      unitPrice: offer.price, total: offer.price, purchaseUrl: offer.purchaseUrl,
    }));
    for (const need of input.customNeeds) lines.push({ offerId: null, label: need, description: "Custom scope confirmed after discovery.", quantity: 1, unitPrice: null, total: null, purchaseUrl: null });
    const known = lines.flatMap((line) => line.total == null ? [] : [line.total]);
    const quote = QuoteSchema.parse({
      id: quoteId, workItemId: workItem.id, conversationId: input.conversationId, contactId: input.contactId, leadId: input.leadId,
      projectId: project.id, status: "estimate", title: `${input.projectName} published package estimate`, currency: "USD", lines,
      subtotal: known.length ? known.reduce((sum, value) => sum + value, 0) : null,
      notes: ["This is a non-binding estimate based on currently published starting prices.", "Final scope, timing, and custom work are confirmed after discovery.", ...(input.stale ? ["One or more offer sources need owner review before commitment."] : [])],
      sourceReviewedAt: input.offers.map((offer) => offer.reviewedAt).sort().at(0) ?? stamp.slice(0, 10), createdAt: stamp, updatedAt: stamp, file: `shared/quotes/${quoteId}.md`,
    });
    const money = (value: number | null) => value == null ? "Custom scope" : new Intl.NumberFormat("en-US", { style: "currency", currency: quote.currency, maximumFractionDigits: 0 }).format(value);
    const rows = quote.lines.map((line) => `| ${line.label} | ${line.description} | ${money(line.total)} | ${line.purchaseUrl ? `[Purchase](${line.purchaseUrl})` : "Confirm after discovery"} |`).join("\n");
    const content = `# ${quote.title}\n\nPrepared for **${input.customerName}**\n\n| Item | Included | Estimate | Next step |\n|---|---|---:|---|\n${rows}\n\n## Published estimate\n\n**${money(quote.subtotal)}** plus custom-scoped items.\n\n${quote.notes.map((note) => `- ${note}`).join("\n")}\n\nSource: ${input.offers[0]?.sourceUrl ?? "Samuel Studio service records"}\nReviewed: ${quote.sourceReviewedAt}\n`;
    await atomicWriteText(this.root, quote.file, document(quote.title, content.replace(/^# .*\n\n/, ""), quote));

    const token = randomBytes(32).toString("base64url"); const deliverableId = nanoid(12); const contentFile = `shared/deliverables/${deliverableId}-content.md`;
    const storedDeliverable = DeliverableSchema.parse({
      id: deliverableId, workItemId: workItem.id, conversationId: input.conversationId, employeeId: input.employeeId,
      title: quote.title, kind: "quote", visibility: "customer", status: "delivered",
      preview: `${money(quote.subtotal)} plus custom-scoped items. Includes published package links and scope notes.`, contentType: "text/markdown",
      contentFile, createdAt: stamp, updatedAt: stamp, deliveredAt: stamp,
      file: `shared/deliverables/${deliverableId}.md`,
    });
    const deliverable: Deliverable = { ...storedDeliverable, accessUrl: `/api/public/deliverables/${deliverableId}?token=${encodeURIComponent(token)}` };
    await atomicWriteText(this.root, contentFile, content);
    const grant: DeliverableAccessGrant = { id: nanoid(12), tokenHash: hash(token), issuedAt: stamp, revokedAt: null };
    await atomicWriteText(this.root, storedDeliverable.file, document(storedDeliverable.title, `- Status: delivered\n- Visibility: customer\n- Work item: ${workItem.id}\n- Content: ${contentFile}\n\n${storedDeliverable.preview}`, { ...storedDeliverable, accessGrants: [grant] }));
    await this.updateWorkItem(workItem.id, { status: "delivered", nextStep: "Confirm the customer’s preferred package and custom scope." });
    return { workItem: { ...workItem, status: "delivered", updatedAt: stamp, completedAt: stamp }, quote, published: { deliverable, accessToken: token } };
  }

  async createProject(input: Pick<Project, "contactId" | "leadId" | "name" | "business" | "status" | "brief" | "nextStep" | "participants">): Promise<Project> {
    await this.initialize(); const stamp = now(); const id = nanoid(12); const file = `shared/projects/${id}.md`;
    const value = ProjectSchema.parse({ ...input, id, createdAt: stamp, updatedAt: stamp, file });
    const participants = value.participants.map((item) => `- ${item.employeeId}: ${item.responsibility}`).join("\n") || "- No employees assigned yet.";
    await atomicWriteText(this.root, file, document(value.name, `- Business: ${value.business}\n- Status: ${value.status}\n- Next step: ${value.nextStep || "Not set"}\n\n## Brief\n\n${value.brief || "No brief yet."}\n\n## Team\n\n${participants}`, value));
    return value;
  }

  async deliverSalesProposal(input: { operationId: string; qualificationId: string; conversationId: string; contactId: string; leadId: string; customerName: string; title: string; summary: string; content: string; publicMessage: string }): Promise<{ project: Project; workItem: WorkItem; proposal: Proposal; published: PublishedDeliverable }> {
    await this.initialize(); const key = hash(input.operationId).slice(0, 12); const stamp = now();
    const projectId = `proj_${key}`; const workItemId = `work_${key}`; const proposalId = `prop_${key}`; const deliverableId = `deli_${key}`;
    let project = (await this.listProjects()).find((item) => item.id === projectId);
    if (!project) {
      project = ProjectSchema.parse({ id: projectId, contactId: input.contactId, leadId: input.leadId, name: input.title, business: "Samuel Studio", status: "proposed", brief: input.summary, nextStep: "Customer reviews the owner-approved proposal.", participants: [{ employeeId: "sales", responsibility: "Qualification, proposal, and commercial next step", joinedAt: stamp }], createdAt: stamp, updatedAt: stamp, file: `shared/projects/${projectId}.md` });
      await atomicWriteText(this.root, project.file, document(project.name, `- Business: ${project.business}\n- Status: ${project.status}\n- Next step: ${project.nextStep}\n\n## Brief\n\n${project.brief}\n\n## Team\n\n- sales: Qualification, proposal, and commercial next step`, project));
    }
    let workItem = (await this.listWorkItems()).find((item) => item.id === workItemId);
    if (!workItem) {
      workItem = WorkItemSchema.parse({ id: workItemId, conversationId: input.conversationId, contactId: input.contactId, leadId: input.leadId, projectId, appointmentId: null, employeeId: "sales", kind: "proposal", title: input.title, summary: input.summary, status: "delivered", nextStep: "Customer reviews the proposal and responds in the conversation.", createdAt: stamp, updatedAt: stamp, completedAt: stamp, file: `shared/work-items/${workItemId}.md` });
      await atomicWriteText(this.root, workItem.file, document(workItem.title, `- Status: delivered\n- Employee: sales\n- Kind: proposal\n- Next step: ${workItem.nextStep}\n\n## Summary\n\n${workItem.summary}`, workItem));
    }
    const contentFile = `shared/deliverables/${deliverableId}-content.md`;
    let proposal = (await this.listProposals()).find((item) => item.id === proposalId);
    if (!proposal) {
      proposal = ProposalSchema.parse({ id: proposalId, workItemId, qualificationId: input.qualificationId, conversationId: input.conversationId, contactId: input.contactId, leadId: input.leadId, projectId, status: "delivered", title: input.title, summary: input.summary, contentFile, operationId: input.operationId, createdAt: stamp, updatedAt: stamp, deliveredAt: stamp, file: `shared/proposals/${proposalId}.md` });
      await atomicWriteText(this.root, contentFile, input.content);
      await atomicWriteText(this.root, proposal.file, document(proposal.title, `- Status: delivered\n- Qualification: ${input.qualificationId}\n- Work item: ${workItemId}\n- Content: ${contentFile}\n\n${proposal.summary}`, proposal));
    }
    const existingDeliverable = (await this.listDeliverables()).find((item) => item.id === deliverableId);
    if (existingDeliverable) {
      const deliverable = await this.reissueCustomerDeliverable(existingDeliverable.id);
      return { project, workItem, proposal, published: { deliverable, accessToken: "" } };
    }
    const token = randomBytes(32).toString("base64url");
    const storedDeliverable = DeliverableSchema.parse({ id: deliverableId, workItemId, conversationId: input.conversationId, employeeId: "sales", title: input.title, kind: "proposal", visibility: "customer", status: "delivered", preview: input.publicMessage, contentType: "text/markdown", contentFile, createdAt: stamp, updatedAt: stamp, deliveredAt: stamp, file: `shared/deliverables/${deliverableId}.md` });
    const grant = DeliverableAccessGrantSchema.parse({ id: nanoid(12), tokenHash: hash(token), issuedAt: stamp, revokedAt: null });
    await atomicWriteText(this.root, storedDeliverable.file, document(storedDeliverable.title, `- Status: delivered\n- Visibility: customer\n- Work item: ${workItemId}\n- Content: ${contentFile}\n\n${storedDeliverable.preview}`, { ...storedDeliverable, accessGrants: [grant] }));
    return { project, workItem, proposal, published: { deliverable: { ...storedDeliverable, accessUrl: `/api/public/deliverables/${deliverableId}?token=${encodeURIComponent(token)}` }, accessToken: token } };
  }

  async publicDeliverable(id: string, token: string): Promise<{ deliverable: Deliverable; content: string }> {
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(id) || token.length < 32) throw Object.assign(new Error("Deliverable not found."), { statusCode: 404 });
    const file = join(this.root, "shared", "deliverables", `${id}.md`); let text: string;
    try { text = await readFile(file, "utf8"); } catch { throw Object.assign(new Error("Deliverable not found."), { statusCode: 404 }); }
    const parsed = this.parseWithSecret(text); const actual = Buffer.from(hash(token), "hex");
    const valid = this.accessGrants(parsed).some((grant) => {
      if (grant.revokedAt) return false;
      const expected = Buffer.from(grant.tokenHash, "hex");
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    });
    if (!valid) throw Object.assign(new Error("Deliverable access is not valid."), { statusCode: 403 });
    const deliverable = DeliverableSchema.parse(parsed); if (deliverable.visibility !== "customer" || deliverable.status !== "delivered") throw Object.assign(new Error("Deliverable is not available."), { statusCode: 403 });
    return { deliverable, content: await readFile(join(this.root, deliverable.contentFile), "utf8") };
  }

  async reissueCustomerDeliverable(id: string): Promise<Deliverable> {
    const issued = await this.issueAccessGrant(id);
    return { ...issued.deliverable, accessUrl: `/api/public/deliverables/${issued.deliverable.id}?token=${encodeURIComponent(issued.token)}` };
  }

  async issueAccessGrant(id: string): Promise<{ deliverable: Deliverable; grant: DeliverableAccessGrant; token: string }> {
    const file = join(this.root, "shared", "deliverables", `${id}.md`); const text = await readFile(file, "utf8");
    const parsed = this.parseWithSecret(text); const deliverable = DeliverableSchema.parse(parsed);
    if (deliverable.visibility !== "customer" || deliverable.status !== "delivered") throw Object.assign(new Error("Deliverable is not available."), { statusCode: 403 });
    const token = randomBytes(32).toString("base64url"); const stamp = now();
    const grant = DeliverableAccessGrantSchema.parse({ id: nanoid(12), tokenHash: hash(token), issuedAt: stamp, revokedAt: null });
    const updated = DeliverableSchema.parse({ ...deliverable, updatedAt: stamp });
    await this.writeDeliverableWithGrants(file, updated, [...this.accessGrants(parsed), grant]);
    return { deliverable: updated, grant, token };
  }

  async revokeAccessGrant(id: string, grantId: string): Promise<DeliverableAccessGrant> {
    const file = join(this.root, "shared", "deliverables", `${id}.md`); const text = await readFile(file, "utf8");
    const parsed = this.parseWithSecret(text); const deliverable = DeliverableSchema.parse(parsed); const grants = this.accessGrants(parsed);
    const index = grants.findIndex((grant) => grant.id === grantId);
    if (index < 0) throw Object.assign(new Error("Access grant not found."), { statusCode: 404 });
    grants[index] = { ...grants[index], revokedAt: grants[index].revokedAt ?? now() };
    await this.writeDeliverableWithGrants(file, DeliverableSchema.parse({ ...deliverable, updatedAt: now() }), grants);
    return grants[index];
  }

  async accessGrantsFor(id: string): Promise<DeliverableAccessGrant[]> {
    const text = await readFile(join(this.root, "shared", "deliverables", `${id}.md`), "utf8");
    return this.accessGrants(this.parseWithSecret(text)).map((grant) => ({ ...grant, tokenHash: "0".repeat(64) }));
  }

  async customerDeliverablesForConversation(conversationId: string): Promise<Deliverable[]> {
    const items = (await this.listDeliverables()).filter((item) => item.conversationId === conversationId && item.visibility === "customer" && item.status === "delivered");
    return Promise.all(items.map((item) => this.reissueCustomerDeliverable(item.id)));
  }

  async listWorkItems(): Promise<WorkItem[]> { return this.list("work-items", WorkItemSchema); }
  async listDeliverables(): Promise<Deliverable[]> { return this.list("deliverables", DeliverableSchema, (name) => !name.endsWith("-content.md")); }
  async listQuotes(): Promise<Quote[]> { return this.list("quotes", QuoteSchema); }
  async listProjects(): Promise<Project[]> { return this.list("projects", ProjectSchema); }
  async listProposals(): Promise<Proposal[]> { return this.list("proposals", ProposalSchema); }

  private parseWithSecret(text: string): Record<string, unknown> { const match = text.match(/<!-- OPS_META (\{.*\}) -->/); if (!match) throw new Error("Operations record is malformed."); return JSON.parse(match[1]) as Record<string, unknown>; }
  private accessGrants(parsed: Record<string, unknown>): DeliverableAccessGrant[] {
    const grants = Array.isArray(parsed.accessGrants) ? parsed.accessGrants.flatMap((grant) => { try { return [DeliverableAccessGrantSchema.parse(grant)]; } catch { return []; } }) : [];
    if (grants.length || typeof parsed.accessTokenHash !== "string" || !/^[a-f0-9]{64}$/.test(parsed.accessTokenHash)) return grants;
    const deliverable = DeliverableSchema.parse(parsed);
    return [{ id: `legacy-${parsed.accessTokenHash.slice(0, 12)}`, tokenHash: parsed.accessTokenHash, issuedAt: deliverable.createdAt, revokedAt: null }];
  }
  private async writeDeliverableWithGrants(_file: string, deliverable: Deliverable, accessGrants: DeliverableAccessGrant[]): Promise<void> {
    await atomicWriteText(this.root, deliverable.file, document(deliverable.title, `- Status: ${deliverable.status}\n- Visibility: ${deliverable.visibility}\n- Work item: ${deliverable.workItemId}\n- Content: ${deliverable.contentFile}\n\n${deliverable.preview}`, { ...deliverable, accessGrants }));
  }
  private async get<T extends RecordType>(kind: string, id: string, schema: { parse(value: unknown): T }): Promise<T> {
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) throw Object.assign(new Error("Operations record not found."), { statusCode: 404 });
    const text = await readFile(join(this.root, "shared", kind, `${id}.md`), "utf8"); return schema.parse(this.parseWithSecret(text));
  }
  private async list<T extends RecordType>(kind: string, schema: { parse(value: unknown): T }, include: (name: string) => boolean = () => true): Promise<T[]> {
    const result: T[] = []; for (const file of await markdownFiles(join(this.root, "shared", kind))) { if (!include(file)) continue; try { result.push(schema.parse(this.parseWithSecret(await readFile(file, "utf8")))); this.health?.clear(relative(this.root, file).split("\\").join("/")); } catch (error) { this.health?.report(relative(this.root, file).split("\\").join("/"), `operations:${kind}`, error); } }
    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
