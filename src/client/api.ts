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
  LedgerResponse,
  EmployeeFile,
  BackupManifest,
  DiagnosticsResponse,
  GeocodeResult,
  ResearchPlace,
  ResearchPlaceInput,
  FrontDeskResponse,
  PublicServiceCaseSummary,
  ServiceCase,
  SalesQualification,
  SalesOperationsResponse,
  PublicSalesProgressSummary,
  Campaign,
  CampaignAsset,
  CampaignFile,
  CampaignOperationsResponse,
  CampaignPost,
} from "../shared/schemas";

export interface DeliverableGrantSummary { id: string; issuedAt: string; revokedAt: string | null }

export interface CrmData { contacts: CrmContact[]; leads: CrmLead[]; appointments: CrmAppointment[]; tasks: CrmTask[]; conversations: CrmConversation[]; activities: CrmActivity[]; workItems: WorkItem[]; deliverables: Deliverable[]; quotes: Quote[]; projects: Project[]; serviceCases: ServiceCase[]; salesQualifications?: SalesQualification[]; campaigns?: Campaign[] }

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
  const body = await response.text();
  if (!body.trim()) throw new Error("The server connection ended before confirmation. Refreshing the workspace will show whether the action completed.");
  let data: { error?: string };
  try { data = JSON.parse(body) as { error?: string }; }
  catch { throw new Error("The server returned an incomplete response. Refresh the workspace and check the recorded action status before retrying."); }
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
  frontDesk: () => json<FrontDeskResponse>("/api/admin/front-desk"),
  serviceCases: () => json<ServiceCase[]>("/api/admin/service-cases"),
  serviceCase: (id: string) => json<ServiceCase>(`/api/admin/service-cases/${encodeURIComponent(id)}`),
  createServiceCase: (input: { contactId: string; leadId?: string | null; conversationId: string; appointmentId?: string | null; workItemId?: string | null; title: string; category?: ServiceCase["category"]; priority?: ServiceCase["priority"]; summary: string; desiredOutcome?: string; nextStep?: string; internalNotes?: string; createdBy?: "owner" | "receptionist" | "system" }) => json<ServiceCase>("/api/admin/service-cases", { method: "POST", body: JSON.stringify(input) }),
  updateServiceCase: (id: string, input: Partial<Pick<ServiceCase, "status" | "priority" | "category" | "summary" | "desiredOutcome" | "nextStep" | "internalNotes">>) => json<ServiceCase>(`/api/admin/service-cases/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
  salesOperations: () => json<SalesOperationsResponse>("/api/admin/sales-operations"),
  salesQualifications: () => json<SalesQualification[]>("/api/admin/sales-qualifications"),
  salesQualification: (id: string) => json<SalesQualification>(`/api/admin/sales-qualifications/${encodeURIComponent(id)}`),
  createSalesQualification: (input: { contactId: string; leadId: string; conversationId?: string | null; appointmentId?: string | null; title: string; serviceInterest?: string; projectGoal?: string; deliverables?: string[]; targetTiming?: string; location?: string; budgetState?: SalesQualification["budgetState"]; budgetRange?: string; decisionMakerState?: SalesQualification["decisionMakerState"]; decisionMakers?: string; constraints?: string[]; nextStep?: string; createdBy?: "owner" | "receptionist" | "system" }) => json<SalesQualification>("/api/admin/sales-qualifications", { method: "POST", body: JSON.stringify(input) }),
  updateSalesQualification: (id: string, input: Partial<Pick<SalesQualification, "serviceInterest" | "projectGoal" | "deliverables" | "targetTiming" | "location" | "budgetState" | "budgetRange" | "decisionMakerState" | "decisionMakers" | "constraints" | "readiness" | "nextStep">> & { evidence?: Array<{ kind: "company" | "offer" | "sales_library"; path: string; label: string; excerpt?: string }> }) => json<SalesQualification>(`/api/admin/sales-qualifications/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
  campaignOperations: () => json<CampaignOperationsResponse>("/api/admin/campaign-operations"),
  campaigns: () => json<Campaign[]>("/api/admin/campaigns"),
  createCampaign: (input: { title: string; businessLine?: string; objective?: string; audience?: string; offer?: string; channels?: string[]; callToAction?: string; projectId?: string | null; contactId?: string | null; leadId?: string | null; salesQualificationId?: string | null }) => json<Campaign>("/api/admin/campaigns", { method: "POST", body: JSON.stringify(input) }),
  updateCampaign: (id: string, input: Partial<Campaign>) => json<Campaign>(`/api/admin/campaigns/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
  createCampaignPost: (campaignId: string, input: { platform: string; plannedAt?: string | null; objective?: string; copy?: string; callToAction?: string; destinationUrl?: string | null; altText?: string; assetIds?: string[]; claims?: string[]; status?: CampaignPost["status"] }) => json<CampaignPost>(`/api/admin/campaigns/${encodeURIComponent(campaignId)}/posts`, { method: "POST", body: JSON.stringify(input) }),
  updateCampaignPost: (campaignId: string, postId: string, input: Partial<CampaignPost> & Record<string, unknown>) => json<CampaignPost>(`/api/admin/campaigns/${encodeURIComponent(campaignId)}/posts/${encodeURIComponent(postId)}`, { method: "PATCH", body: JSON.stringify(input) }),
  updateCampaignAsset: (campaignId: string, assetId: string, input: Partial<CampaignAsset>) => json<CampaignAsset>(`/api/admin/campaigns/${encodeURIComponent(campaignId)}/assets/${encodeURIComponent(assetId)}`, { method: "PATCH", body: JSON.stringify(input) }),
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
  ledger: () => json<LedgerResponse>("/api/finance/ledger"),
  researchPlaces: () => json<ResearchPlace[]>("/api/research/places"),
  saveResearchPlace: (input: ResearchPlaceInput) => json<ResearchPlace>("/api/research/places", { method: "POST", body: JSON.stringify(input) }),
  geocodeResearchPlace: (query: string) => json<GeocodeResult[]>(`/api/research/geocode?q=${encodeURIComponent(query)}`),
  employeeLibrary: (id: EmployeeId) => json<EmployeeFile[]>(`/api/employee-files/${encodeURIComponent(id)}`),
  createProject: (input: { contactId?: string; leadId?: string; name: string; business: string; brief: string; nextStep?: string }) => json<Project>("/api/projects", { method: "POST", body: JSON.stringify(input) }),
  publicIntake: (input: PublicIntake) => json<{ conversationId: string; contactId: string; leadId: string; resumeToken: string }>("/api/public/intake", { method: "POST", body: JSON.stringify(input) }),
  publicResume: (conversationId: string, token: string) => json<{ conversationId: string; intake: PublicIntake; messages: PublicConversationMessage[]; deliverables: Deliverable[]; serviceCases?: PublicServiceCaseSummary[]; salesProgress?: PublicSalesProgressSummary[]; lastActivity: string }>(`/api/public/conversations/${encodeURIComponent(conversationId)}/resume`, { method: "POST", body: JSON.stringify({ token }) }),
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

export async function uploadEmployeeFile(employeeId: EmployeeId, file: File): Promise<{ path: string; agentReadable: boolean }> {
  const response = await fetch(`/api/employee-files/${encodeURIComponent(employeeId)}/upload?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) },
    body: file,
  });
  const body = await response.text();
  let data: { path?: string; agentReadable?: boolean; error?: string } = {};
  try { data = body ? JSON.parse(body) as typeof data : {}; } catch { throw new Error("The server returned an incomplete upload response."); }
  if (!response.ok) throw new Error(data.error ?? `Upload failed with ${response.status}.`);
  return { path: data.path!, agentReadable: Boolean(data.agentReadable) };
}

async function uploadBinary<T>(url: string, file: File): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/octet-stream", ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) }, body: file });
  const body = await response.text(); let data: { error?: string } = {};
  try { data = body ? JSON.parse(body) as typeof data : {}; } catch { throw new Error("The server returned an incomplete upload response."); }
  if (!response.ok) throw new Error(data.error ?? `Upload failed with ${response.status}.`); return data as T;
}
export const uploadCampaignAsset = (campaignId: string, file: File) => uploadBinary<CampaignAsset>(`/api/admin/campaigns/${encodeURIComponent(campaignId)}/assets?name=${encodeURIComponent(file.name)}`, file);
export const uploadCampaignPdf = (campaignId: string, kind: CampaignFile["kind"], provenance: string, file: File) => uploadBinary<CampaignFile>(`/api/admin/campaign-files/upload?campaignId=${encodeURIComponent(campaignId)}&kind=${encodeURIComponent(kind)}&provenance=${encodeURIComponent(provenance)}&name=${encodeURIComponent(file.name)}`, file);

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
