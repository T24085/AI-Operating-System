import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { nanoid } from "nanoid";
import {
  DeliverableSchema, ProjectSchema, QuoteSchema, WorkItemSchema,
  type Deliverable, type EmployeeId, type Offer, type Project, type Quote, type QuoteLine, type WorkItem,
} from "../shared/schemas.js";
import { atomicWriteText } from "./paths.js";

type RecordType = WorkItem | Deliverable | Quote | Project;
const now = () => new Date().toISOString();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const meta = (value: RecordType & { accessTokenHash?: string }) => JSON.stringify(value).replace(/-->/g, "--\\>");

async function markdownFiles(dir: string): Promise<string[]> {
  try { return (await readdir(dir, { withFileTypes: true })).filter((item) => item.isFile() && item.name.endsWith(".md")).map((item) => join(dir, item.name)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

function document(title: string, body: string, value: RecordType & { accessTokenHash?: string }): string {
  return `---\nid: ${JSON.stringify(value.id)}\ntype: ${JSON.stringify(value.file.split("/")[1]?.replace(/s$/, "") ?? "record")}\ncreated_at: ${JSON.stringify(value.createdAt)}\n---\n\n# ${title}\n\n${body.trim()}\n\n<!-- OPS_META ${meta(value)} -->\n`;
}

export interface PublishedDeliverable { deliverable: Deliverable; accessToken: string }

export class OperationsStore {
  constructor(readonly root: string) {}

  async initialize(): Promise<void> {
    for (const dir of ["work-items", "deliverables", "quotes", "projects"]) await mkdir(join(this.root, "shared", dir), { recursive: true });
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
    await atomicWriteText(this.root, storedDeliverable.file, document(storedDeliverable.title, `- Status: delivered\n- Visibility: customer\n- Work item: ${workItem.id}\n- Content: ${contentFile}\n\n${storedDeliverable.preview}`, { ...storedDeliverable, accessTokenHash: hash(token) }));
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

  async publicDeliverable(id: string, token: string): Promise<{ deliverable: Deliverable; content: string }> {
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(id) || token.length < 32) throw Object.assign(new Error("Deliverable not found."), { statusCode: 404 });
    const file = join(this.root, "shared", "deliverables", `${id}.md`); let text: string;
    try { text = await readFile(file, "utf8"); } catch { throw Object.assign(new Error("Deliverable not found."), { statusCode: 404 }); }
    const parsed = this.parseWithSecret(text); const expected = Buffer.from(typeof parsed.accessTokenHash === "string" ? parsed.accessTokenHash : "", "hex"); const actual = Buffer.from(hash(token), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw Object.assign(new Error("Deliverable access is not valid."), { statusCode: 403 });
    const deliverable = DeliverableSchema.parse(parsed); if (deliverable.visibility !== "customer" || deliverable.status !== "delivered") throw Object.assign(new Error("Deliverable is not available."), { statusCode: 403 });
    return { deliverable, content: await readFile(join(this.root, deliverable.contentFile), "utf8") };
  }

  async reissueCustomerDeliverable(id: string): Promise<Deliverable> {
    const file = join(this.root, "shared", "deliverables", `${id}.md`); const text = await readFile(file, "utf8");
    const deliverable = DeliverableSchema.parse(this.parseWithSecret(text));
    if (deliverable.visibility !== "customer" || deliverable.status !== "delivered") throw Object.assign(new Error("Deliverable is not available."), { statusCode: 403 });
    const token = randomBytes(32).toString("base64url"); const updated = DeliverableSchema.parse({ ...deliverable, updatedAt: now() });
    await atomicWriteText(this.root, file, document(updated.title, `- Status: delivered\n- Visibility: customer\n- Work item: ${updated.workItemId}\n- Content: ${updated.contentFile}\n\n${updated.preview}`, { ...updated, accessTokenHash: hash(token) }));
    return { ...updated, accessUrl: `/api/public/deliverables/${updated.id}?token=${encodeURIComponent(token)}` };
  }

  async customerDeliverablesForConversation(conversationId: string): Promise<Deliverable[]> {
    const items = (await this.listDeliverables()).filter((item) => item.conversationId === conversationId && item.visibility === "customer" && item.status === "delivered");
    return Promise.all(items.map((item) => this.reissueCustomerDeliverable(item.id)));
  }

  async listWorkItems(): Promise<WorkItem[]> { return this.list("work-items", WorkItemSchema); }
  async listDeliverables(): Promise<Deliverable[]> { return this.list("deliverables", DeliverableSchema, (name) => !name.endsWith("-content.md")); }
  async listQuotes(): Promise<Quote[]> { return this.list("quotes", QuoteSchema); }
  async listProjects(): Promise<Project[]> { return this.list("projects", ProjectSchema); }

  private parseWithSecret(text: string): Record<string, unknown> { const match = text.match(/<!-- OPS_META (\{.*\}) -->/); if (!match) throw new Error("Operations record is malformed."); return JSON.parse(match[1]) as Record<string, unknown>; }
  private async get<T extends RecordType>(kind: string, id: string, schema: { parse(value: unknown): T }): Promise<T> {
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) throw Object.assign(new Error("Operations record not found."), { statusCode: 404 });
    const text = await readFile(join(this.root, "shared", kind, `${id}.md`), "utf8"); return schema.parse(this.parseWithSecret(text));
  }
  private async list<T extends RecordType>(kind: string, schema: { parse(value: unknown): T }, include: (name: string) => boolean = () => true): Promise<T[]> {
    const result: T[] = []; for (const file of await markdownFiles(join(this.root, "shared", kind))) { if (!include(file)) continue; try { result.push(schema.parse(this.parseWithSecret(await readFile(file, "utf8")))); } catch { /* malformed records remain readable but are excluded */ } }
    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
