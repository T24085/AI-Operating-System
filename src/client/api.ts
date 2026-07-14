import type {
  ActionDecision,
  ActionProposal,
  AgentEvent,
  ConversationRecord,
  EmployeeConversationMessage,
  EmployeeConversationSummary,
  EmployeeDefinition,
  EmployeeId,
  OnboardingInput,
  Settings,
  CrmActivity,
  CrmAppointment,
  CrmContact,
  CrmConversation,
  CrmLead,
  CrmTask,
  PublicAgentEvent,
  PublicConversationMessage,
  PublicIntake,
  Deliverable,
  Offer,
  Project,
  Quote,
  WorkItem,
  BackupManifest,
  DiagnosticsResponse,
} from "../shared/schemas";

export interface DeliverableGrantSummary { id: string; issuedAt: string; revokedAt: string | null }

export interface CrmData { contacts: CrmContact[]; leads: CrmLead[]; appointments: CrmAppointment[]; tasks: CrmTask[]; conversations: CrmConversation[]; activities: CrmActivity[]; workItems: WorkItem[]; deliverables: Deliverable[]; quotes: Quote[]; projects: Project[] }

export interface BootstrapData {
  onboarded: boolean;
  company: OnboardingInput | null;
  settings: Settings;
  employees: EmployeeDefinition[];
  ollamaOnline: boolean;
  actions: ActionProposal[];
  workItems: WorkItem[];
  activity: Array<{ id: string; employeeId: EmployeeId; summary: string; status: string; at: string }>;
}

let csrfToken = "";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined && init.body !== null;
  const response = await fetch(url, {
    ...init,
    headers: { ...(hasBody ? { "Content-Type": "application/json" } : {}), ...(csrfToken && init?.method && init.method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}), ...(init?.headers ?? {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Request failed with ${response.status}.`);
  return data as T;
}

export const api = {
  bootstrap: () => json<BootstrapData>("/api/bootstrap"),
  onboard: (input: OnboardingInput) => json<{ ok: true; workspacePath: string }>("/api/onboarding", { method: "POST", body: JSON.stringify(input) }),
  createConversation: (employeeId: EmployeeId, title: string) =>
    json<ConversationRecord>("/api/conversations", { method: "POST", body: JSON.stringify({ employeeId, title }) }),
  employeeConversations: (employeeId: EmployeeId) => json<EmployeeConversationSummary[]>(`/api/conversations?employeeId=${encodeURIComponent(employeeId)}`),
  resumeEmployeeConversation: (conversationId: string) => json<{ conversation: EmployeeConversationSummary; messages: EmployeeConversationMessage[] }>(`/api/conversations/${encodeURIComponent(conversationId)}/resume`, { method: "POST", body: "{}" }),
  actions: () => json<ActionProposal[]>("/api/actions"),
  decide: (id: string, input: ActionDecision) =>
    json<{ action: ActionProposal; assistantMessage: string | null }>(`/api/actions/${id}/decision`, { method: "POST", body: JSON.stringify(input) }),
  search: (query: string) => json<Array<{ path: string; title: string; snippet: string }>>(`/api/search?q=${encodeURIComponent(query)}`),
  models: () => json<Array<{ name: string; size: number; modifiedAt: string }>>("/api/models"),
  settings: (input: Partial<Settings>) => json<Settings>("/api/settings", { method: "PATCH", body: JSON.stringify(input) }),
  employeeFiles: (id: EmployeeId) => json<string[]>(`/api/employees/${id}/files`),
  file: (path: string) => json<{ path: string; content: string }>(`/api/file?path=${encodeURIComponent(path)}`),
  openFolder: () => json<{ ok: boolean }>("/api/open-folder", { method: "POST" }),
  backup: () => json<{ ok: true; path: string }>("/api/admin/backup", { method: "POST" }),
  diagnostics: () => json<DiagnosticsResponse>("/api/admin/diagnostics"),
  reindex: () => json<{ ok: true; indexFreshAt: string }>("/api/admin/reindex", { method: "POST" }),
  backups: () => json<BackupManifest[]>("/api/admin/backups"),
  createBackup: () => json<BackupManifest>("/api/admin/backups", { method: "POST" }),
  restoreBackup: (id: string, confirmation: string) => json<{ ok: true; backup: BackupManifest; indexFreshAt: string }>(`/api/admin/backups/${encodeURIComponent(id)}/restore`, { method: "POST", body: JSON.stringify({ confirmation }) }),
  crmAuth: async () => { const result = await json<{ configured: boolean; authenticated: boolean; csrfToken?: string }>("/api/crm/auth"); csrfToken = result.csrfToken ?? ""; return result; },
  crmSetup: async (password: string) => { const result = await json<{ ok: true; csrfToken: string }>("/api/crm/auth/setup", { method: "POST", body: JSON.stringify({ password }) }); csrfToken = result.csrfToken; return result; },
  crmLogin: async (password: string) => { const result = await json<{ ok: true; csrfToken: string }>("/api/crm/auth/login", { method: "POST", body: JSON.stringify({ password }) }); csrfToken = result.csrfToken; return result; },
  crmLogout: async () => { const result = await json<{ ok: true }>("/api/crm/auth/logout", { method: "POST" }); csrfToken = ""; return result; },
  crmBootstrap: () => json<CrmData>("/api/crm/bootstrap"),
  crmConversation: (id: string) => json<{ conversation: CrmConversation; content: string }>(`/api/crm/conversations/${encodeURIComponent(id)}`),
  crmCreateContact: (input: Omit<CrmContact, "id" | "createdAt" | "updatedAt">) => json<CrmContact>("/api/crm/contacts", { method: "POST", body: JSON.stringify(input) }),
  crmCreateLead: (input: Omit<CrmLead, "id" | "createdAt" | "updatedAt">) => json<CrmLead>("/api/crm/leads", { method: "POST", body: JSON.stringify(input) }),
  crmUpdateLead: (id: string, input: Partial<CrmLead>) => json<CrmLead>(`/api/crm/leads/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  crmCreateAppointment: (input: Omit<CrmAppointment, "id" | "createdAt" | "updatedAt">) => json<CrmAppointment>("/api/crm/appointments", { method: "POST", body: JSON.stringify(input) }),
  crmUpdateAppointment: (id: string, input: Partial<CrmAppointment>) => json<CrmAppointment>(`/api/crm/appointments/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  crmCreateTask: (input: Omit<CrmTask, "id" | "createdAt" | "updatedAt">) => json<CrmTask>("/api/crm/tasks", { method: "POST", body: JSON.stringify(input) }),
  crmUpdateTask: (id: string, input: Partial<CrmTask>) => json<CrmTask>(`/api/crm/tasks/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  crmAvailability: (date: string) => json<string[]>(`/api/crm/availability?date=${encodeURIComponent(date)}`),
  workItems: () => json<WorkItem[]>("/api/work-items"),
  updateWorkItem: (id: string, input: Partial<WorkItem>) => json<WorkItem>(`/api/work-items/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  decideAppointmentWorkItem: (id: string, decision: "confirm" | "decline") => json<{ workItem: WorkItem; appointment: CrmAppointment }>(`/api/work-items/${id}/decision`, { method: "POST", body: JSON.stringify({ decision }) }),
  deliverables: () => json<Deliverable[]>("/api/deliverables"),
  deliverableGrants: (id: string) => json<DeliverableGrantSummary[]>(`/api/admin/deliverables/${encodeURIComponent(id)}/access-grants`),
  issueDeliverableGrant: (id: string) => json<{ grant: DeliverableGrantSummary; accessUrl: string }>(`/api/admin/deliverables/${encodeURIComponent(id)}/access-grants`, { method: "POST" }),
  revokeDeliverableGrant: (id: string, grantId: string) => json<DeliverableGrantSummary>(`/api/admin/deliverables/${encodeURIComponent(id)}/access-grants/${encodeURIComponent(grantId)}`, { method: "DELETE" }),
  quotes: () => json<Quote[]>("/api/quotes"),
  offers: () => json<Offer[]>("/api/offers"),
  projects: () => json<Project[]>("/api/projects"),
  createProject: (input: { contactId?: string; leadId?: string; name: string; business: string; brief: string; nextStep?: string }) => json<Project>("/api/projects", { method: "POST", body: JSON.stringify(input) }),
  publicIntake: (input: PublicIntake) => json<{ conversationId: string; contactId: string; leadId: string; resumeToken: string }>("/api/public/intake", { method: "POST", body: JSON.stringify(input) }),
  publicResume: (conversationId: string, token: string) => json<{ conversationId: string; intake: PublicIntake; messages: PublicConversationMessage[]; deliverables: Deliverable[]; lastActivity: string }>(`/api/public/conversations/${encodeURIComponent(conversationId)}/resume`, { method: "POST", body: JSON.stringify({ token }) }),
};

export async function streamEmployeeMessage(conversationId: string, content: string, onEvent: (event: AgentEvent) => void): Promise<void> {
  const response = await fetch(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) },
    body: JSON.stringify({ content }),
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({ error: "Unable to contact the employee." }));
    throw new Error(data.error ?? "Unable to contact the employee.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((item) => item.startsWith("data: "));
      if (!line) continue;
      onEvent(JSON.parse(line.slice(6)) as AgentEvent);
    }
  }
}

export async function streamPublicMessage(conversationId: string, content: string, onEvent: (event: PublicAgentEvent) => void): Promise<void> {
  const response = await fetch(`/api/public/conversations/${conversationId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({ error: "Unable to contact the Receptionist." }));
    throw new Error(data.error ?? "Unable to contact the Receptionist.");
  }
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true }); const frames = buffer.split("\n\n"); buffer = frames.pop() ?? "";
    for (const frame of frames) { const line = frame.split("\n").find((item) => item.startsWith("data: ")); if (line) onEvent(JSON.parse(line.slice(6)) as PublicAgentEvent); }
  }
}
