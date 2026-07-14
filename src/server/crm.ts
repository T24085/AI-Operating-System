import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { nanoid } from "nanoid";
import {
  CrmActivitySchema, CrmAppointmentInputSchema, CrmAppointmentSchema, CrmContactInputSchema, CrmContactSchema,
  CrmLeadInputSchema, CrmLeadSchema, CrmTaskInputSchema, CrmTaskSchema,
  type CrmActivity, type CrmAppointment, type CrmContact, type CrmConversation, type CrmLead, type CrmTask, type PublicIntake,
} from "../shared/schemas.js";
import { atomicWriteText } from "./paths.js";

type Kind = "contacts" | "leads" | "appointments" | "tasks" | "activities";
type RecordValue = CrmContact | CrmLead | CrmAppointment | CrmTask | CrmActivity;

const now = () => new Date().toISOString();
const esc = (value: unknown) => JSON.stringify(value).replace(/-->/g, "--\\>");

function markdown(kind: Kind, value: RecordValue): string {
  const title = "name" in value ? value.name : "title" in value ? value.title : value.summary;
  const lines = Object.entries(value)
    .filter(([key]) => !["id", "createdAt", "updatedAt", "notes", "summary", "detail"].includes(key))
    .map(([key, item]) => `- ${key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}: ${Array.isArray(item) ? item.join(", ") : item ?? "—"}`);
  const narrative = "notes" in value ? value.notes : "summary" in value ? value.summary : "";
  return `---\nid: ${JSON.stringify(value.id)}\ntype: ${JSON.stringify(kind.slice(0, -1))}\ncreated_at: ${JSON.stringify(value.createdAt)}\n---\n\n# ${title}\n\n${lines.join("\n")}\n\n## Notes\n\n${narrative || "No notes yet."}\n\n<!-- CRM_META ${esc(value)} -->\n`;
}

async function files(dir: string): Promise<string[]> {
  try { return (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => join(dir, entry.name)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

async function markdownTree(dir: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries) { const full = join(current, entry.name); if (entry.isDirectory()) await walk(full); else if (entry.isFile() && entry.name.endsWith(".md")) result.push(full); }
  }
  await walk(dir); return result;
}

export class CrmStore {
  constructor(readonly root: string, private readonly options: { demo?: boolean } = {}) {}

  async initialize(): Promise<void> {
    for (const dir of ["contacts", "leads", "appointments", "tasks", "activities"]) await mkdir(join(this.root, "crm", dir), { recursive: true });
    const demo = this.options.demo ?? process.env.AIOS_DEMO_DATA === "1";
    if (demo) await this.seed(); else await this.removeLegacyDemoSeed();
  }

  async bootstrap() {
    await this.initialize();
    const [contacts, leads, appointments, tasks, activities, conversations] = await Promise.all([
      this.readMany("contacts", CrmContactSchema), this.readMany("leads", CrmLeadSchema),
      this.readMany("appointments", CrmAppointmentSchema), this.readMany("tasks", CrmTaskSchema),
      this.readMany("activities", CrmActivitySchema), this.publicConversations(),
    ]);
    return { contacts, leads, appointments, tasks, conversations, activities: activities.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
  }

  async publicConversations(): Promise<CrmConversation[]> {
    const result: CrmConversation[] = [];
    for (const file of await markdownTree(join(this.root, "employees", "receptionist", "conversations"))) {
      const text = await readFile(file, "utf8"); const front = text.match(/^---\n([\s\S]*?)\n---/); if (!front) continue;
      const id = front[1].match(/^id:\s*"([^"]+)"/m)?.[1]; const createdAt = front[1].match(/^created_at:\s*"([^"]+)"/m)?.[1]; if (!id || !createdAt) continue;
      const events = [...text.matchAll(/<!-- EVENT (\{.*\}) -->/g)].flatMap((match) => { try { return [JSON.parse(match[1]) as Record<string, unknown>]; } catch { return []; } });
      const link = events.find((event) => event.type === "crm_linkage"); if (!link) continue;
      const visible = events.filter((event) => event.type === "public_customer_message" || event.type === "public_assistant_message" || event.type === "public_specialist_message");
      const lastVisible = visible.at(-1); const headings = [...text.matchAll(/^## .* — (\d{4}-\d{2}-\d{2}T[^\n]+)$/gm)];
      const lastOperational = [...events].reverse().find((event) => ["public_work_item", "public_deliverable", "public_quote", "conversation_resolved"].includes(String(event.type)));
      const status = lastOperational?.type === "conversation_resolved" ? "resolved"
        : lastOperational?.type === "public_work_item" && lastOperational.status === "awaiting_owner" ? "awaiting_owner"
          : lastVisible?.type === "public_customer_message" || !lastVisible ? "new"
            : "awaiting_customer";
      result.push({ id, contactId: String(link.contactId), leadId: String(link.leadId), customerName: String(link.customerName), customerEmail: String(link.customerEmail), initialNeed: String(link.initialNeed), createdAt, lastActivity: headings.at(-1)?.[1] ?? createdAt, messageCount: visible.length, departments: [...new Set(events.filter((event) => event.type === "internal_handoff" && event.department).map((event) => String(event.department)))], status, file: relative(this.root, file).split("\\").join("/") });
    }
    return result.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  }

  async createContact(input: unknown): Promise<CrmContact> {
    const stamp = now(); const value = CrmContactSchema.parse({ ...CrmContactInputSchema.parse(input), id: nanoid(10), createdAt: stamp, updatedAt: stamp });
    await this.write("contacts", value); await this.activity("lead", `Added contact ${value.name}`, "New CRM contact created.", { contactId: value.id }); return value;
  }

  async createPublicInquiry(input: PublicIntake): Promise<{ contact: CrmContact; lead: CrmLead }> {
    const existing = (await this.readMany("contacts", CrmContactSchema)).find((item) => item.email.toLowerCase() === input.email.toLowerCase());
    const contact = existing ?? await this.createContact({ name: input.name, email: input.email, phone: input.phone, company: "", location: "", source: "AI Receptionist", tags: ["website-inquiry"], notes: `Initial inquiry: ${input.need}` });
    const lead = await this.createLead({ contactId: contact.id, title: `${input.name} — Website inquiry`, project: "Samuel.Studio", service: "To be qualified", stage: "new", value: 0, currency: "USD", owner: "Samuel", priority: "normal", summary: input.need, nextStep: "Receptionist qualification", followUpAt: null, tags: ["public-concierge"] });
    return { contact, lead };
  }

  async createLead(input: unknown): Promise<CrmLead> {
    const stamp = now(); const value = CrmLeadSchema.parse({ ...CrmLeadInputSchema.parse(input), id: nanoid(10), createdAt: stamp, updatedAt: stamp });
    await this.write("leads", value); await this.activity("lead", `Created ${value.title}`, `${value.service} · ${value.stage}`, { contactId: value.contactId, leadId: value.id }); return value;
  }

  async updateLead(id: string, patch: unknown): Promise<CrmLead> {
    const current = await this.get("leads", id, CrmLeadSchema);
    const value = CrmLeadSchema.parse({ ...current, ...(patch as object), id, createdAt: current.createdAt, updatedAt: now() }); await this.write("leads", value);
    await this.activity("lead", `Updated ${value.title}`, `Pipeline stage: ${value.stage}`, { contactId: value.contactId, leadId: value.id }); return value;
  }

  async createAppointment(input: unknown): Promise<CrmAppointment> {
    const stamp = now(); const value = CrmAppointmentSchema.parse({ ...CrmAppointmentInputSchema.parse(input), id: nanoid(10), createdAt: stamp, updatedAt: stamp });
    const all = await this.readMany("appointments", CrmAppointmentSchema);
    if (all.some((item) => item.status !== "cancelled" && new Date(value.startAt) < new Date(item.endAt) && new Date(value.endAt) > new Date(item.startAt)))
      throw Object.assign(new Error("That time overlaps another appointment."), { statusCode: 409 });
    await this.write("appointments", value); await this.activity("appointment", `Booked ${value.title}`, `${value.startAt} · ${value.location}`, { contactId: value.contactId, leadId: value.leadId, appointmentId: value.id }); return value;
  }

  async updateAppointment(id: string, patch: unknown): Promise<CrmAppointment> {
    const current = await this.get("appointments", id, CrmAppointmentSchema);
    const value = CrmAppointmentSchema.parse({ ...current, ...(patch as object), id, createdAt: current.createdAt, updatedAt: now() });
    if (value.status !== "cancelled") {
      const all = await this.readMany("appointments", CrmAppointmentSchema);
      if (all.some((item) => item.id !== id && item.status !== "cancelled" && new Date(value.startAt) < new Date(item.endAt) && new Date(value.endAt) > new Date(item.startAt))) throw Object.assign(new Error("That time overlaps another appointment."), { statusCode: 409 });
    }
    await this.write("appointments", value); await this.activity("appointment", `Updated ${value.title}`, `Appointment status: ${value.status}`, { contactId: value.contactId, leadId: value.leadId, appointmentId: value.id }); return value;
  }

  async createTask(input: unknown): Promise<CrmTask> {
    const stamp = now(); const value = CrmTaskSchema.parse({ ...CrmTaskInputSchema.parse(input), id: nanoid(10), createdAt: stamp, updatedAt: stamp });
    await this.write("tasks", value); await this.activity("task", `Created task: ${value.title}`, value.dueAt ? `Due ${value.dueAt}` : "No due date", { contactId: value.contactId, leadId: value.leadId }); return value;
  }

  async updateTask(id: string, patch: unknown): Promise<CrmTask> {
    const current = await this.get("tasks", id, CrmTaskSchema); const value = CrmTaskSchema.parse({ ...current, ...(patch as object), id, createdAt: current.createdAt, updatedAt: now() });
    await this.write("tasks", value); await this.activity("task", `${value.status === "done" ? "Completed" : "Updated"} task: ${value.title}`, "", { contactId: value.contactId, leadId: value.leadId }); return value;
  }

  async availability(date: string): Promise<string[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Object.assign(new Error("Use a date in YYYY-MM-DD format."), { statusCode: 400 });
    const appointments = await this.readMany("appointments", CrmAppointmentSchema); const slots: string[] = [];
    for (let hour = 10; hour < 18; hour++) {
      const start = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00`); const end = new Date(start.getTime() + 60 * 60 * 1000);
      if (!appointments.some((item) => item.status !== "cancelled" && start < new Date(item.endAt) && end > new Date(item.startAt))) slots.push(start.toISOString());
    }
    return slots;
  }

  private async activity(type: CrmActivity["type"], summary: string, detail: string, links: Partial<CrmActivity>): Promise<void> {
    const value = CrmActivitySchema.parse({ id: nanoid(10), contactId: null, leadId: null, appointmentId: null, type, summary, detail, actor: "Owner", createdAt: now(), ...links });
    await this.write("activities", value);
  }

  private async write(kind: Kind, value: RecordValue): Promise<void> { await atomicWriteText(this.root, `crm/${kind}/${value.id}.md`, markdown(kind, value)); }

  private async readMany<T extends RecordValue>(kind: Kind, schema: { parse(value: unknown): T }): Promise<T[]> {
    const result: T[] = [];
    for (const file of await files(join(this.root, "crm", kind))) {
      const match = (await readFile(file, "utf8")).match(/<!-- CRM_META (\{.*\}) -->/);
      if (match) try { result.push(schema.parse(JSON.parse(match[1]))); } catch { /* readable malformed records are excluded */ }
    }
    return result;
  }

  private async get<T extends RecordValue>(kind: Kind, id: string, schema: { parse(value: unknown): T }): Promise<T> {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw Object.assign(new Error("Invalid CRM record id."), { statusCode: 400 });
    try { const match = (await readFile(join(this.root, "crm", kind, `${id}.md`), "utf8")).match(/<!-- CRM_META (\{.*\}) -->/); if (match) return schema.parse(JSON.parse(match[1])); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    throw Object.assign(new Error("CRM record not found."), { statusCode: 404 });
  }

  private async seed(): Promise<void> {
    if ((await files(join(this.root, "crm", "contacts"))).length) return;
    const stamp = now();
    const contacts: CrmContact[] = [
      { id: "ana-torres", name: "Ana Torres", email: "ana@casaluz.co", phone: "+57 310 555 0184", company: "Casa Luz", location: "Medellín, Colombia", source: "Samuel.Colombia", tags: ["hospitality", "colombia"], notes: "Boutique hospitality launch.", createdAt: stamp, updatedAt: stamp },
      { id: "marcus-reed", name: "Marcus Reed", email: "marcus@northfield.co", phone: "+1 312 555 0149", company: "Northfield", location: "Chicago, IL", source: "Referral", tags: ["branding"], notes: "Founder-led personal brand refresh.", createdAt: stamp, updatedAt: stamp },
      { id: "isabella-ruiz", name: "Isabella Ruiz", email: "isabella@atelieruno.com", phone: "+57 315 555 0122", company: "Atelier Uno", location: "Bogotá, Colombia", source: "Instagram", tags: ["fashion", "editorial"], notes: "Interested in campaign photography and art direction.", createdAt: stamp, updatedAt: stamp },
      { id: "daniel-kim", name: "Daniel Kim", email: "daniel@formhouse.dev", phone: "+1 773 555 0161", company: "Form House", location: "Chicago, IL", source: "Samuel.Studio.dev", tags: ["web", "design"], notes: "Needs a portfolio and inquiry flow.", createdAt: stamp, updatedAt: stamp },
    ];
    const leads: CrmLead[] = [
      { id: "casa-luz-launch", contactId: "ana-torres", title: "Casa Luz launch campaign", project: "Samuel.Colombia", service: "Campaign photography", stage: "consultation", value: 6800, currency: "USD", owner: "Samuel", priority: "high", summary: "Three-day hospitality image library and launch story.", nextStep: "Confirm production dates", followUpAt: stamp, tags: ["production"], createdAt: stamp, updatedAt: stamp },
      { id: "northfield-brand", contactId: "marcus-reed", title: "Northfield founder portrait series", project: "Samuel.Studio", service: "Personal branding", stage: "proposal", value: 3200, currency: "USD", owner: "Samuel", priority: "normal", summary: "Editorial portraits and website selects.", nextStep: "Review proposal", followUpAt: stamp, tags: ["portrait"], createdAt: stamp, updatedAt: stamp },
      { id: "atelier-editorial", contactId: "isabella-ruiz", title: "Atelier Uno editorial", project: "Samuel.Colombia", service: "Fashion editorial", stage: "qualified", value: 4500, currency: "USD", owner: "Samuel", priority: "high", summary: "Seasonal editorial in Bogotá.", nextStep: "Schedule creative call", followUpAt: stamp, tags: ["fashion"], createdAt: stamp, updatedAt: stamp },
      { id: "form-house-site", contactId: "daniel-kim", title: "Form House portfolio", project: "Samuel.Studio.dev", service: "Website design", stage: "new", value: 5800, currency: "USD", owner: "Samuel", priority: "normal", summary: "Editorial portfolio with lead capture.", nextStep: "Qualify timeline and budget", followUpAt: stamp, tags: ["web"], createdAt: stamp, updatedAt: stamp },
    ];
    for (const item of contacts) await this.write("contacts", item); for (const item of leads) await this.write("leads", item);
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(11, 0, 0, 0);
    const appointment: CrmAppointment = { id: "casa-luz-consult", contactId: "ana-torres", leadId: "casa-luz-launch", title: "Casa Luz production call", startAt: tomorrow.toISOString(), endAt: new Date(tomorrow.getTime() + 3600000).toISOString(), status: "confirmed", type: "Creative consultation", location: "Video call", notes: "Review locations, shot count, and launch timing.", createdAt: stamp, updatedAt: stamp };
    await this.write("appointments", appointment);
    await this.write("tasks", { id: "send-northfield-proposal", contactId: "marcus-reed", leadId: "northfield-brand", title: "Send revised Northfield proposal", dueAt: stamp, status: "open", priority: "high", createdAt: stamp, updatedAt: stamp });
    await this.activity("system", "Samuel Studio CRM created", "Local Markdown records are ready.", {});
  }

  private async removeLegacyDemoSeed(): Promise<void> {
    const known: Array<[Kind, string, string]> = [
      ["contacts", "ana-torres", "ana@casaluz.co"], ["contacts", "marcus-reed", "marcus@northfield.co"],
      ["contacts", "isabella-ruiz", "isabella@atelieruno.com"], ["contacts", "daniel-kim", "daniel@formhouse.dev"],
      ["leads", "casa-luz-launch", "Casa Luz launch campaign"], ["leads", "northfield-brand", "Northfield founder portrait series"],
      ["leads", "atelier-editorial", "Atelier Uno editorial"], ["leads", "form-house-site", "Form House portfolio"],
      ["appointments", "casa-luz-consult", "Casa Luz production call"], ["tasks", "send-northfield-proposal", "Send revised Northfield proposal"],
    ];
    for (const [kind, id, marker] of known) {
      const file = join(this.root, "crm", kind, `${id}.md`);
      try { if ((await readFile(file, "utf8")).includes(marker)) await rm(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    for (const file of await files(join(this.root, "crm", "activities"))) {
      const content = await readFile(file, "utf8");
      if (content.includes("Samuel Studio CRM created") && content.includes("Local Markdown records are ready")) await rm(file);
    }
  }
}
