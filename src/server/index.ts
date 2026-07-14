import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { appendFile, cp, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { employees, employeeById } from "../shared/employees.js";
import {
  ActionDecisionSchema,
  CrmAppointmentInputSchema,
  CrmContactInputSchema,
  CrmLeadInputSchema,
  CrmTaskInputSchema,
  CreateConversationSchema,
  EmployeeIdSchema,
  MessageInputSchema,
  OnboardingInputSchema,
  PublicIntakeSchema,
  PublicResumeInputSchema,
  SettingsSchema,
  WorkItemStatusSchema,
} from "../shared/schemas.js";
import { offers } from "../shared/offers.js";
import { AgentRuntime } from "./agent.js";
import { ConfigStore, type AppConfig } from "./config.js";
import { RecordsIndex } from "./indexer.js";
import { readSafeText } from "./paths.js";
import { WorkspaceRecords } from "./records.js";
import { SafeToolRuntime } from "./tools.js";
import { CrmAuth, cookieValue } from "./crm-auth.js";
import { CrmStore } from "./crm.js";
import { PublicReceptionistRuntime } from "./public-receptionist.js";
import { issuePublicResumeToken, parsePublicConversation, verifyPublicResumeToken } from "./public-resume.js";
import { parseEmployeeConversation } from "./employee-conversations.js";
import { OperationsStore } from "./operations.js";

interface Services {
  config: AppConfig;
  records: WorkspaceRecords;
  index: RecordsIndex;
  tools: SafeToolRuntime;
  agents: AgentRuntime;
  crm: CrmStore;
  publicReceptionist: PublicReceptionistRuntime;
  operations: OperationsStore;
}

const app = Fastify({ logger: true, bodyLimit: 1_100_000 });
await app.register(cors, { origin: ["http://127.0.0.1:5173", "http://localhost:5173"] });
app.addHook("onRequest", async (_request, reply) => {
  reply.header("X-Content-Type-Options", "nosniff"); reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "strict-origin-when-cross-origin"); reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  reply.header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' http://127.0.0.1:4317; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
});

const configStore = new ConfigStore();
const crmAuth = new CrmAuth(configStore.root);
let services: Services | null = null;
async function auditRequest(method: string, url: string, status: number, ip: string): Promise<void> {
  const stamp = new Date(); const dir = join(configStore.root, "audit"); await mkdir(dir, { recursive: true });
  const file = join(dir, `${stamp.toISOString().slice(0, 7)}.md`);
  await appendFile(file, `\n## ${stamp.toISOString()}\n\n- Method: ${method}\n- Path: ${url.split("?")[0]}\n- Status: ${status}\n- Source: ${ip}\n`, "utf8");
}
app.addHook("onResponse", async (request, reply) => {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) await auditRequest(request.method, request.url, reply.statusCode, request.ip).catch(() => undefined);
});

async function createServices(config: AppConfig): Promise<Services> {
  const records = new WorkspaceRecords(config.workspacePath);
  await records.ensureOperatingFiles();
  await records.loadActions();
  const index = new RecordsIndex(records);
  await index.start();
  const tools = new SafeToolRuntime(records, index);
  const agents = new AgentRuntime(records, tools, config.settings);
  const crm = new CrmStore(records.root);
  await crm.initialize();
  const operations = new OperationsStore(records.root);
  await operations.initialize();
  const publicReceptionist = new PublicReceptionistRuntime(records, crm, operations, config.settings);
  return { config, records, index, tools, agents, crm, publicReceptionist, operations };
}

const existing = await configStore.read();
if (existing) services = await createServices(existing);

function requireServices(): Services {
  if (!services) {
    const error = new Error("Complete onboarding before using employees.") as Error & { statusCode?: number };
    error.statusCode = 409;
    throw error;
  }
  return services;
}

const sessionCookie = "aios_crm_session";
const sessionFrom = (request: { headers: { cookie?: string } }) => cookieValue(request.headers.cookie, sessionCookie);
const setSession = (reply: { header(name: string, value: string): unknown }, token: string) =>
  reply.header("Set-Cookie", `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${process.env.AIOS_HTTPS === "1" ? "; Secure" : ""}`);
const requireInternal = (request: { headers: { cookie?: string } }): Services => {
  if (!crmAuth.authenticated(sessionFrom(request))) throw Object.assign(new Error("Private owner access required."), { statusCode: 401 });
  return requireServices();
};
const requireCrm = (request: { headers: { cookie?: string } }): CrmStore => requireInternal(request).crm;
const rateWindows = new Map<string, { count: number; resetAt: number }>();
function enforceRateLimit(key: string, limit: number, windowMs: number): void {
  const current = rateWindows.get(key); const time = Date.now();
  if (!current || current.resetAt <= time) { rateWindows.set(key, { count: 1, resetAt: time + windowMs }); return; }
  current.count += 1; if (current.count > limit) throw Object.assign(new Error("Too many requests. Please wait and try again."), { statusCode: 429 });
}
function requireCsrf(request: { headers: { cookie?: string; [key: string]: unknown } }): void {
  const session = sessionFrom(request); const supplied = typeof request.headers["x-csrf-token"] === "string" ? request.headers["x-csrf-token"] : undefined;
  if (!crmAuth.validCsrf(session, supplied)) throw Object.assign(new Error("The private session verification token is missing or expired."), { statusCode: 403 });
}
app.addHook("preHandler", async (request) => {
  const url = request.url.split("?")[0];
  if (request.method === "POST" && (url === "/api/crm/auth/login" || url === "/api/crm/auth/setup")) enforceRateLimit(`auth:${request.ip}`, 6, 10 * 60 * 1000);
  if (url.startsWith("/api/public/")) enforceRateLimit(`public:${request.ip}`, 60, 60 * 1000);
  const mutating = ["POST", "PATCH", "PUT", "DELETE"].includes(request.method);
  const exempt = url.startsWith("/api/public/") || url === "/api/onboarding" || url === "/api/crm/auth/login" || url === "/api/crm/auth/setup";
  if (mutating && url.startsWith("/api/") && !exempt) requireCsrf(request);
});

app.get("/api/bootstrap", async (request) => {
  if (!crmAuth.authenticated(sessionFrom(request))) throw Object.assign(new Error("Private owner access required."), { statusCode: 401 });
  const current = services;
  const online = current ? await current.agents.online() : false;
  return {
    onboarded: Boolean(current),
    company: current?.config.company ?? null,
    settings: current?.config.settings ?? SettingsSchema.parse({}),
    employees,
    ollamaOnline: online,
    actions: current?.records.listActions() ?? [],
    workItems: current ? await current.operations.listWorkItems() : [],
    activity: current?.records.recentActivity() ?? [],
  };
});

app.post("/api/onboarding", async (request, reply) => {
  if (services) return reply.code(409).send({ error: "This local installation is already onboarded." });
  const company = OnboardingInputSchema.parse(request.body);
  const workspacePath = configStore.workspaceFor(company.companyName);
  const records = new WorkspaceRecords(workspacePath);
  await records.initialize(company);
  const config: AppConfig = {
    company,
    workspacePath,
    settings: SettingsSchema.parse({ businessSlug: workspacePath.split(/[\\/]/).at(-1) }),
  };
  await configStore.write(config);
  services = await createServices(config);
  return reply.code(201).send({ ok: true, workspacePath });
});

app.get("/api/employees", async (request) => { requireInternal(request); return employees; });

app.post("/api/conversations", async (request, reply) => {
  const current = requireInternal(request);
  const input = CreateConversationSchema.parse(request.body);
  const employee = employeeById.get(input.employeeId)!;
  const model = current.config.settings.roleModels[input.employeeId] ?? current.config.settings.defaultModel ?? employee.defaultModel;
  const record = await current.records.createConversation(input.employeeId, input.title ?? "New conversation", model);
  await current.agents.startConversation(record, employee);
  return reply.code(201).send(record);
});

app.get("/api/conversations", async (request) => {
  const current = requireInternal(request);
  const employeeId = EmployeeIdSchema.parse((request.query as { employeeId?: unknown }).employeeId);
  const records = await current.records.conversationRecords(employeeId);
  return records.map(({ record, content }) => parseEmployeeConversation(record, content).summary).filter((item) => item.messageCount > 0);
});

app.post("/api/conversations/:id/resume", async (request, reply) => {
  const current = requireInternal(request);
  const { id } = request.params as { id: string };
  let activated;
  try { activated = await current.records.activateConversation(id); }
  catch { return reply.code(404).send({ error: "Conversation not found." }); }
  const employee = employeeById.get(activated.record.employeeId)!;
  const restored = parseEmployeeConversation(activated.record, activated.content);
  if (!restored.messages.length) return reply.code(404).send({ error: "Employee conversation not found." });
  await current.agents.resumeConversation(activated.record, employee, restored.messages);
  return { conversation: restored.summary, messages: restored.messages };
});

app.post("/api/conversations/:id/messages", async (request, reply) => {
  const current = requireInternal(request);
  const { id } = request.params as { id: string };
  const input = MessageInputSchema.parse(request.body);
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const emit = (event: unknown) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  emit({ type: "connected", conversationId: id });
  try {
    await current.agents.send(id, input.content, emit as never);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The employee request failed.";
    emit({ type: "error", message, code: message.includes("fetch") ? "OLLAMA_OFFLINE" : "AGENT_ERROR" });
  } finally {
    reply.raw.end();
  }
});

app.get("/api/actions", async (request) => requireInternal(request).records.listActions());

app.post("/api/actions/:id/decision", async (request, reply) => {
  const current = requireInternal(request);
  const { id } = request.params as { id: string };
  const decision = ActionDecisionSchema.parse(request.body);
  const action = current.records.actions.get(id);
  if (!action) return reply.code(404).send({ error: "Action not found." });
  if (action.status !== "pending") return reply.code(409).send({ error: `Action is already ${action.status}.` });
  if (decision.contentHash !== action.contentHash) return reply.code(409).send({ error: "Approval hash does not match the current proposal." });

  if (decision.decision === "deny") {
    await current.records.appendActionEvent(id, "denied", decision.note || "Owner denied this action.");
    const assistantMessage = await current.agents.resume(action, `The owner denied this action.${decision.note ? ` Note: ${decision.note}` : ""}`);
    return { action, assistantMessage };
  }

  await current.records.appendActionEvent(id, "approved", decision.note || "Owner approved this action.");
  try {
    const result = await current.tools.execute(action);
    await current.records.appendActionEvent(id, "completed", result);
    const assistantMessage = await current.agents.resume(action, result);
    return { action, assistantMessage };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action execution failed.";
    const status = message.includes("changed after") ? "stale" : "failed";
    await current.records.appendActionEvent(id, status, message);
    return reply.code(409).send({ error: message, action });
  }
});

app.get("/api/search", async (request) => {
  const current = requireInternal(request);
  const { q = "" } = request.query as { q?: string };
  return current.index.search(q);
});

app.get("/api/models", async (request, reply) => {
  try {
    return await requireInternal(request).agents.models();
  } catch {
    return reply.code(503).send({ error: "Ollama is offline or unavailable." });
  }
});

app.get("/api/settings", async (request) => requireInternal(request).config.settings);

app.patch("/api/settings", async (request) => {
  const current = requireInternal(request);
  const next = SettingsSchema.parse({ ...current.config.settings, ...(request.body as object) });
  current.config.settings = next;
  await configStore.write(current.config);
  current.agents.updateSettings(next);
  current.publicReceptionist.updateSettings(next);
  return next;
});

app.get("/api/employees/:id/files", async (request) => {
  const current = requireInternal(request);
  const id = EmployeeIdSchema.parse((request.params as { id: string }).id);
  const files = (await current.records.allMarkdownFiles())
    .map((file) => file.slice(current.records.root.length + 1).split("\\").join("/"))
    .filter((file) => file.startsWith(`employees/${id}/`));
  return files;
});

app.get("/api/file", async (request) => {
  const current = requireInternal(request);
  const { path } = request.query as { path: string };
  return { path, content: await readSafeText(current.records.root, path) };
});

app.post("/api/open-folder", async (request) => {
  const current = requireInternal(request);
  if (process.platform === "win32") {
    const child = spawn("explorer.exe", [current.config.workspacePath], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return { ok: true };
  }
  return { ok: false, message: "Open the workspace path shown in Settings." };
});
app.post("/api/admin/backup", async (request) => {
  const current = requireInternal(request); const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = join(configStore.root, "backups", `${current.config.settings.businessSlug ?? "business"}-${stamp}`);
  await mkdir(join(configStore.root, "backups"), { recursive: true }); await cp(current.config.workspacePath, destination, { recursive: true, errorOnExist: true });
  return { ok: true, path: destination };
});

app.get("/api/crm/auth", async (request) => ({ configured: await crmAuth.configured(), authenticated: crmAuth.authenticated(sessionFrom(request)), csrfToken: crmAuth.csrfFor(sessionFrom(request)) }));
app.post("/api/crm/auth/setup", async (request, reply) => {
  const password = String((request.body as { password?: unknown })?.password ?? "");
  const token = await crmAuth.setup(password); setSession(reply, token); return { ok: true, csrfToken: crmAuth.csrfFor(token) };
});
app.post("/api/crm/auth/login", async (request, reply) => {
  const password = String((request.body as { password?: unknown })?.password ?? "");
  const token = await crmAuth.login(password); setSession(reply, token); return { ok: true, csrfToken: crmAuth.csrfFor(token) };
});
app.post("/api/crm/auth/logout", async (request, reply) => {
  crmAuth.logout(sessionFrom(request)); reply.header("Set-Cookie", `${sessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`); return { ok: true };
});
app.get("/api/crm/bootstrap", async (request) => {
  const current = requireInternal(request);
  const [crm, workItems, deliverables, quotes, projects] = await Promise.all([current.crm.bootstrap(), current.operations.listWorkItems(), current.operations.listDeliverables(), current.operations.listQuotes(), current.operations.listProjects()]);
  return { ...crm, workItems, deliverables, quotes, projects };
});
app.get("/api/work-items", async (request) => requireInternal(request).operations.listWorkItems());
app.patch("/api/work-items/:id", async (request) => {
  const current = requireInternal(request); const { id } = request.params as { id: string }; const body = request.body as Record<string, unknown>;
  return current.operations.updateWorkItem(id, {
    ...(body.status ? { status: WorkItemStatusSchema.parse(body.status) } : {}),
    ...(typeof body.summary === "string" ? { summary: body.summary } : {}),
    ...(typeof body.nextStep === "string" ? { nextStep: body.nextStep } : {}),
  });
});
app.post("/api/work-items/:id/decision", async (request, reply) => {
  const current = requireInternal(request); const { id } = request.params as { id: string };
  const decision = String((request.body as { decision?: unknown })?.decision ?? "");
  if (!['confirm', 'decline'].includes(decision)) return reply.code(400).send({ error: "Decision must be confirm or decline." });
  const workItem = (await current.operations.listWorkItems()).find((item) => item.id === id);
  if (!workItem || workItem.kind !== "appointment") return reply.code(404).send({ error: "Appointment request not found." });
  if (workItem.status !== "awaiting_owner") return reply.code(409).send({ error: `Appointment request is already ${workItem.status}.` });
  const crm = await current.crm.bootstrap();
  const appointment = crm.appointments.find((item) => item.id === workItem.appointmentId)
    ?? crm.appointments.filter((item) => item.status === "tentative" && item.contactId === workItem.contactId && (!workItem.conversationId || item.notes.includes(workItem.conversationId))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    ?? crm.appointments.filter((item) => item.status === "tentative" && item.contactId === workItem.contactId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!appointment) return reply.code(409).send({ error: "The tentative calendar hold linked to this request could not be found." });
  const confirmed = decision === "confirm";
  const updatedAppointment = await current.crm.updateAppointment(appointment.id, { status: confirmed ? "confirmed" : "cancelled" });
  const updatedWorkItem = await current.operations.updateWorkItem(id, {
    appointmentId: appointment.id, status: confirmed ? "delivered" : "closed",
    nextStep: confirmed ? "Appointment confirmed by owner; notify the customer through an approved communication adapter." : "Appointment declined by owner; offer the customer alternate times.",
  });
  return { workItem: updatedWorkItem, appointment: updatedAppointment };
});
app.get("/api/deliverables", async (request) => requireInternal(request).operations.listDeliverables());
app.get("/api/quotes", async (request) => requireInternal(request).operations.listQuotes());
app.get("/api/offers", async (request) => { requireInternal(request); return offers; });
app.get("/api/projects", async (request) => requireInternal(request).operations.listProjects());
app.post("/api/projects", async (request, reply) => {
  const current = requireInternal(request); const body = request.body as Record<string, unknown>;
  return reply.code(201).send(await current.operations.createProject({
    contactId: typeof body.contactId === "string" ? body.contactId : null, leadId: typeof body.leadId === "string" ? body.leadId : null,
    name: String(body.name ?? "New project").slice(0, 200), business: String(body.business ?? "Samuel Studio").slice(0, 100),
    status: "discovery", brief: String(body.brief ?? "").slice(0, 10000), nextStep: String(body.nextStep ?? "Define project scope").slice(0, 1000), participants: [],
  }));
});
app.get("/api/crm/conversations/:id", async (request, reply) => {
  const current = requireInternal(request); const { id } = request.params as { id: string };
  const conversation = (await current.crm.publicConversations()).find((item) => item.id === id);
  if (!conversation) return reply.code(404).send({ error: "Conversation not found." });
  return { conversation, content: await readSafeText(current.records.root, conversation.file) };
});
app.post("/api/crm/contacts", async (request, reply) => reply.code(201).send(await requireCrm(request).createContact(CrmContactInputSchema.parse(request.body))));
app.post("/api/crm/leads", async (request, reply) => reply.code(201).send(await requireCrm(request).createLead(CrmLeadInputSchema.parse(request.body))));
app.patch("/api/crm/leads/:id", async (request) => requireCrm(request).updateLead((request.params as { id: string }).id, request.body));
app.post("/api/crm/appointments", async (request, reply) => reply.code(201).send(await requireCrm(request).createAppointment(CrmAppointmentInputSchema.parse(request.body))));
app.patch("/api/crm/appointments/:id", async (request) => requireCrm(request).updateAppointment((request.params as { id: string }).id, request.body));
app.post("/api/crm/tasks", async (request, reply) => reply.code(201).send(await requireCrm(request).createTask(CrmTaskInputSchema.parse(request.body))));
app.patch("/api/crm/tasks/:id", async (request) => requireCrm(request).updateTask((request.params as { id: string }).id, request.body));
app.get("/api/crm/availability", async (request) => requireCrm(request).availability(String((request.query as { date?: string }).date ?? "")));

app.post("/api/public/intake", async (request, reply) => {
  const current = requireServices();
  const intake = PublicIntakeSchema.parse(request.body);
  const { contact, lead } = await current.crm.createPublicInquiry(intake);
  const model = current.config.settings.roleModels.receptionist ?? current.config.settings.defaultModel;
  const record = await current.records.createConversation("receptionist", `Public inquiry — ${intake.name}`, model);
  const resume = issuePublicResumeToken();
  await current.records.appendConversation(record.id, "CRM linkage", `Linked to ${intake.name}'s CRM contact and inquiry.`, { type: "crm_linkage", contactId: contact.id, leadId: lead.id, customerName: intake.name, customerEmail: intake.email, customerPhone: intake.phone, initialNeed: intake.need });
  await current.records.appendConversation(record.id, "Resume access", "A browser-held resume credential was issued. Only its one-way hash is recorded here.", { type: "public_resume", tokenHash: resume.tokenHash });
  await current.publicReceptionist.start(record, intake, { contactId: contact.id, leadId: lead.id });
  return reply.code(201).send({ conversationId: record.id, contactId: contact.id, leadId: lead.id, resumeToken: resume.token });
});

app.post("/api/public/conversations/:id/resume", async (request, reply) => {
  const current = requireServices();
  const { id } = request.params as { id: string };
  const { token } = PublicResumeInputSchema.parse(request.body);
  let activated;
  try { activated = await current.records.activateConversation(id, "receptionist"); }
  catch { return reply.code(404).send({ error: "Conversation not found." }); }
  if (!verifyPublicResumeToken(activated.content, token)) return reply.code(403).send({ error: "This conversation cannot be resumed from this device." });
  const restored = parsePublicConversation(activated.content);
  await current.publicReceptionist.resume(activated.record, restored.intake, restored.messages, { contactId: restored.contactId, leadId: restored.leadId });
  const deliverables = await current.operations.customerDeliverablesForConversation(id);
  return { conversationId: id, intake: restored.intake, messages: restored.messages, deliverables, lastActivity: restored.lastActivity };
});

app.get("/api/public/deliverables/:id", async (request, reply) => {
  const current = requireServices(); const { id } = request.params as { id: string }; const token = String((request.query as { token?: string }).token ?? "");
  const { deliverable, content } = await current.operations.publicDeliverable(id, token);
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
  const inline = (value: string) => escape(value)
    .replace(/\[([^\]]+)\]\((https:\/\/[^)]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  const lines = content.split(/\r?\n/); const rendered: string[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (/^\|.*\|$/.test(line)) {
      const table: string[] = []; while (i < lines.length && /^\|.*\|$/.test(lines[i])) table.push(lines[i++]);
      const rows = table.filter((row) => !/^\|[\s:|-]+\|$/.test(row)).map((row) => row.slice(1, -1).split("|").map((cell) => inline(cell.trim())));
      if (rows.length) rendered.push(`<table><thead><tr>${rows[0].map((cell) => `<th>${cell}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (line.startsWith("# ")) rendered.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (line.startsWith("## ")) rendered.push(`<h2>${inline(line.slice(3))}</h2>`);
    else if (line.startsWith("- ")) { const items: string[] = []; while (i < lines.length && lines[i].startsWith("- ")) items.push(`<li>${inline(lines[i++].slice(2))}</li>`); rendered.push(`<ul>${items.join("")}</ul>`); continue; }
    else if (line.trim()) rendered.push(`<p>${inline(line)}</p>`);
    i += 1;
  }
  const body = rendered.join("\n");
  reply.type("text/html; charset=utf-8").send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(deliverable.title)}</title><style>body{max-width:900px;margin:40px auto;padding:0 24px;background:#071019;color:#dce5eb;font:16px/1.65 system-ui}h1,h2{font-family:Georgia,serif;color:#f1e7d6}h1{font-size:38px}h2{margin-top:32px}a{color:#e0b66d}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{padding:12px;text-align:left;vertical-align:top;border-bottom:1px solid #263746}th{color:#f1e7d6}p{white-space:pre-wrap}.meta{color:#8293a1;font-size:13px}@media print{body{background:white;color:#111}.meta{color:#555}a{color:#111}th{color:#111}}</style></head><body><div class="meta">Samuel Studio · Customer deliverable · ${escape(deliverable.status)}</div>${body}</body></html>`);
});

app.post("/api/public/conversations/:id/messages", async (request, reply) => {
  const current = requireServices();
  const { id } = request.params as { id: string };
  if (!current.publicReceptionist.has(id)) return reply.code(404).send({ error: "This visitor conversation is no longer active. Please start a new inquiry." });
  const input = MessageInputSchema.parse(request.body);
  reply.hijack();
  reply.raw.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const emit = (event: unknown) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  emit({ type: "connected", conversationId: id });
  try {
    await current.publicReceptionist.send(id, input.content, emit as never);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The Receptionist could not respond.";
    emit({ type: "error", message, code: message.includes("fetch") ? "OLLAMA_OFFLINE" : "PUBLIC_AGENT_ERROR" });
  } finally { reply.raw.end(); }
});

app.setErrorHandler((error, _request, reply) => {
  const appError = error as Error & { statusCode?: number };
  const status = appError.statusCode ?? (appError.name === "ZodError" ? 400 : 500);
  reply.code(status).send({ error: appError.message });
});

const dist = join(process.cwd(), "dist");
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((_request, reply) => reply.sendFile("index.html"));
}

const port = Number(process.env.PORT ?? 4317);
await app.listen({ host: process.env.AIOS_BIND_HOST ?? "127.0.0.1", port });

async function shutdown(): Promise<void> {
  await services?.index.close();
  await app.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
