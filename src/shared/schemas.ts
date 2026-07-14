import { z } from "zod";

export const EmployeeIdSchema = z.enum([
  "receptionist",
  "sales",
  "accounting",
  "marketing",
  "developer",
  "designer",
  "bookkeeper",
  "research",
  "social-media",
  "customer-service",
]);

export type EmployeeId = z.infer<typeof EmployeeIdSchema>;

export const EmployeeDefinitionSchema = z.object({
  id: EmployeeIdSchema,
  title: z.string(),
  shortName: z.string(),
  charter: z.string(),
  responsibilities: z.array(z.string()),
  constraints: z.array(z.string()),
  suggestedTasks: z.array(z.object({ label: z.string(), prompt: z.string() })),
  avatar: z.string(),
  tagline: z.string(),
  defaultModel: z.string(),
});

export type EmployeeDefinition = z.infer<typeof EmployeeDefinitionSchema>;

export const OnboardingInputSchema = z.object({
  companyName: z.string().trim().min(2).max(100),
  ownerName: z.string().trim().min(1).max(100),
  industry: z.string().trim().min(2).max(100),
  description: z.string().trim().min(10).max(2000),
  services: z.string().trim().min(2).max(3000),
  hours: z.string().trim().min(2).max(1000),
  policies: z.string().trim().max(4000).default(""),
  tone: z.string().trim().min(2).max(500),
  goals: z.string().trim().min(2).max(2000),
  currency: z.string().trim().min(3).max(10).default("USD"),
  timezone: z.string().trim().min(2).max(100),
});

export type OnboardingInput = z.infer<typeof OnboardingInputSchema>;

export const SettingsSchema = z.object({
  defaultModel: z.string().default("gemma4:12b"),
  contextLength: z.number().int().min(2048).max(262144).default(16384),
  roleModels: z.partialRecord(EmployeeIdSchema, z.string()).default({}),
  businessSlug: z.string().optional(),
  retentionDays: z.number().int().min(0).max(3650).default(0),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const ConversationRecordSchema = z.object({
  id: z.string(),
  employeeId: EmployeeIdSchema,
  title: z.string(),
  model: z.string(),
  createdAt: z.string(),
  file: z.string(),
});

export type ConversationRecord = z.infer<typeof ConversationRecordSchema>;

export const EmployeeConversationSummarySchema = z.object({
  id: z.string(), employeeId: EmployeeIdSchema, title: z.string(), model: z.string(),
  createdAt: z.string(), lastActivity: z.string(), messageCount: z.number().int().min(0), preview: z.string(),
});
export type EmployeeConversationSummary = z.infer<typeof EmployeeConversationSummarySchema>;

export const EmployeeConversationMessageSchema = z.object({
  id: z.string(), role: z.enum(["owner", "assistant"]), content: z.string(),
});
export type EmployeeConversationMessage = z.infer<typeof EmployeeConversationMessageSchema>;

export const WorkItemStatusSchema = z.enum(["collecting", "in_progress", "awaiting_owner", "ready", "delivered", "closed", "failed"]);
export type WorkItemStatus = z.infer<typeof WorkItemStatusSchema>;

export const WorkItemSchema = z.object({
  id: z.string(), conversationId: z.string().nullable().default(null), contactId: z.string().nullable().default(null),
  leadId: z.string().nullable().default(null), projectId: z.string().nullable().default(null), appointmentId: z.string().nullable().default(null), employeeId: EmployeeIdSchema,
  kind: z.enum(["quote", "proposal", "report", "research", "brief", "appointment", "task", "other"]),
  title: z.string().trim().min(1).max(200), summary: z.string().trim().max(5000).default(""),
  status: WorkItemStatusSchema, nextStep: z.string().trim().max(1000).default(""),
  createdAt: z.string(), updatedAt: z.string(), completedAt: z.string().nullable().default(null), file: z.string(),
});
export type WorkItem = z.infer<typeof WorkItemSchema>;

export const DeliverableSchema = z.object({
  id: z.string(), workItemId: z.string(), conversationId: z.string().nullable().default(null), employeeId: EmployeeIdSchema,
  title: z.string().trim().min(1).max(200), kind: z.enum(["proposal", "quote", "report", "brief", "research", "file"]),
  visibility: z.enum(["internal", "customer"]), status: z.enum(["draft", "awaiting_owner", "approved", "delivered"]),
  preview: z.string().trim().max(2000).default(""), contentType: z.string().default("text/markdown"),
  contentFile: z.string(), createdAt: z.string(), updatedAt: z.string(), deliveredAt: z.string().nullable().default(null),
  accessUrl: z.string().optional(), file: z.string(),
});
export type Deliverable = z.infer<typeof DeliverableSchema>;

export const OfferSchema = z.object({
  id: z.string(), business: z.enum(["Samuel.Studio.dev", "Samuel.Studio", "Samuel.Studio Colombia"]),
  name: z.string(), category: z.string(), priceType: z.enum(["fixed", "starting_at", "range", "custom"]),
  price: z.number().nullable(), currency: z.string().default("USD"), inclusions: z.array(z.string()), exclusions: z.array(z.string()).default([]),
  purchaseUrl: z.string().url().nullable(), sourceUrl: z.string().url(), reviewedAt: z.string(), active: z.boolean().default(true),
});
export type Offer = z.infer<typeof OfferSchema>;

export const QuoteLineSchema = z.object({
  offerId: z.string().nullable(), label: z.string(), description: z.string(), quantity: z.number().positive().default(1),
  unitPrice: z.number().nullable(), total: z.number().nullable(), purchaseUrl: z.string().url().nullable(),
});
export type QuoteLine = z.infer<typeof QuoteLineSchema>;

export const QuoteSchema = z.object({
  id: z.string(), workItemId: z.string(), conversationId: z.string(), contactId: z.string(), leadId: z.string(),
  projectId: z.string().nullable().default(null), status: z.enum(["estimate", "awaiting_owner", "approved", "delivered", "expired"]),
  title: z.string(), currency: z.string(), lines: z.array(QuoteLineSchema).min(1), subtotal: z.number().nullable(),
  notes: z.array(z.string()).default([]), sourceReviewedAt: z.string(), createdAt: z.string(), updatedAt: z.string(), file: z.string(),
});
export type Quote = z.infer<typeof QuoteSchema>;

export const ProjectParticipantSchema = z.object({ employeeId: EmployeeIdSchema, responsibility: z.string(), joinedAt: z.string() });
export type ProjectParticipant = z.infer<typeof ProjectParticipantSchema>;
export const ProjectSchema = z.object({
  id: z.string(), contactId: z.string().nullable().default(null), leadId: z.string().nullable().default(null),
  name: z.string(), business: z.string(), status: z.enum(["discovery", "proposed", "active", "on_hold", "completed", "archived"]),
  brief: z.string().default(""), nextStep: z.string().default(""), participants: z.array(ProjectParticipantSchema).default([]),
  createdAt: z.string(), updatedAt: z.string(), file: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const RouteDecisionSchema = z.object({
  departments: z.array(EmployeeIdSchema), confidence: z.number().min(0).max(1), reason: z.string(),
  missingInformation: z.array(z.string()).default([]), privacyBoundary: z.enum(["public", "private", "mixed"]),
});
export type RouteDecision = z.infer<typeof RouteDecisionSchema>;

export const ActionStatusSchema = z.enum(["pending", "approved", "denied", "completed", "failed", "stale"]);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

export const ActionProposalSchema = z.object({
  id: z.string(),
  employeeId: EmployeeIdSchema,
  conversationId: z.string(),
  tool: z.string(),
  summary: z.string(),
  reason: z.string(),
  risk: z.enum(["low", "medium", "high"]),
  targetPaths: z.array(z.string()),
  arguments: z.record(z.string(), z.unknown()),
  preview: z.string(),
  contentHash: z.string(),
  status: ActionStatusSchema,
  createdAt: z.string(),
  decidedAt: z.string().optional(),
  result: z.string().optional(),
  file: z.string(),
});

export type ActionProposal = z.infer<typeof ActionProposalSchema>;

export const ActionDecisionSchema = z.object({
  decision: z.enum(["approve", "deny"]),
  contentHash: z.string(),
  note: z.string().trim().max(1000).optional(),
});

export type ActionDecision = z.infer<typeof ActionDecisionSchema>;

export const HandoffSchema = z.object({
  fromEmployeeId: EmployeeIdSchema,
  toEmployeeId: EmployeeIdSchema,
  task: z.string(),
  context: z.string(),
});

export type Handoff = z.infer<typeof HandoffSchema>;

export const ToolResultSchema = z.object({
  ok: z.boolean(),
  tool: z.string(),
  output: z.string(),
});

export type ToolResult = z.infer<typeof ToolResultSchema>;

export type AgentEvent =
  | { type: "connected"; conversationId: string }
  | { type: "assistant_delta"; content: string }
  | { type: "tool_start"; name: string }
  | { type: "tool_result"; name: string; output: string }
  | { type: "action_proposed"; action: ActionProposal }
  | { type: "done"; conversationId: string; content: string }
  | { type: "error"; message: string; code?: string };

export const MessageInputSchema = z.object({
  content: z.string().trim().min(1).max(20000),
});

export const CreateConversationSchema = z.object({
  employeeId: EmployeeIdSchema,
  title: z.string().trim().min(1).max(140).optional(),
});

export const CrmStageSchema = z.enum(["new", "qualified", "consultation", "proposal", "booked", "won", "lost"]);
export type CrmStage = z.infer<typeof CrmStageSchema>;
export const CrmPrioritySchema = z.enum(["low", "normal", "high"]);
export const CrmContactSchema = z.object({
  id: z.string(), name: z.string().trim().min(1).max(120), email: z.string().trim().email().or(z.literal("")),
  phone: z.string().trim().max(40).default(""), company: z.string().trim().max(120).default(""),
  location: z.string().trim().max(160).default(""), source: z.string().trim().max(80).default("Direct"),
  tags: z.array(z.string().trim().min(1).max(40)).default([]), notes: z.string().trim().max(5000).default(""),
  createdAt: z.string(), updatedAt: z.string(),
});
export type CrmContact = z.infer<typeof CrmContactSchema>;

export const CrmLeadSchema = z.object({
  id: z.string(), contactId: z.string(), title: z.string().trim().min(1).max(160),
  project: z.string().trim().max(80).default("Samuel Studio"), service: z.string().trim().max(120).default(""),
  stage: CrmStageSchema, value: z.number().min(0).max(100000000).default(0), currency: z.string().trim().min(3).max(8).default("USD"),
  owner: z.string().trim().max(100).default("Samuel"), priority: CrmPrioritySchema.default("normal"),
  summary: z.string().trim().max(5000).default(""), nextStep: z.string().trim().max(1000).default(""),
  followUpAt: z.string().nullable().default(null), tags: z.array(z.string().trim().min(1).max(40)).default([]),
  createdAt: z.string(), updatedAt: z.string(),
});
export type CrmLead = z.infer<typeof CrmLeadSchema>;

const CrmAppointmentBaseSchema = z.object({
  id: z.string(), contactId: z.string(), leadId: z.string().nullable().default(null), title: z.string().trim().min(1).max(160),
  startAt: z.string(), endAt: z.string(), status: z.enum(["tentative", "confirmed", "completed", "cancelled"]),
  type: z.string().trim().max(80).default("Consultation"), location: z.string().trim().max(200).default("Video call"),
  notes: z.string().trim().max(3000).default(""), createdAt: z.string(), updatedAt: z.string(),
});
export const CrmAppointmentSchema = CrmAppointmentBaseSchema.refine((value) => new Date(value.endAt) > new Date(value.startAt), { message: "Appointment must end after it starts." });
export type CrmAppointment = z.infer<typeof CrmAppointmentSchema>;

export const CrmTaskSchema = z.object({
  id: z.string(), contactId: z.string().nullable().default(null), leadId: z.string().nullable().default(null),
  title: z.string().trim().min(1).max(200), dueAt: z.string().nullable().default(null), status: z.enum(["open", "done"]),
  priority: CrmPrioritySchema.default("normal"), createdAt: z.string(), updatedAt: z.string(),
});
export type CrmTask = z.infer<typeof CrmTaskSchema>;

export const CrmActivitySchema = z.object({
  id: z.string(), contactId: z.string().nullable().default(null), leadId: z.string().nullable().default(null),
  appointmentId: z.string().nullable().default(null), type: z.enum(["note", "lead", "appointment", "task", "system"]),
  summary: z.string().trim().min(1).max(500), detail: z.string().trim().max(3000).default(""),
  actor: z.string().trim().max(100).default("Owner"), createdAt: z.string(),
});
export type CrmActivity = z.infer<typeof CrmActivitySchema>;

export const CrmContactInputSchema = CrmContactSchema.omit({ id: true, createdAt: true, updatedAt: true });
export const CrmLeadInputSchema = CrmLeadSchema.omit({ id: true, createdAt: true, updatedAt: true });
export const CrmAppointmentInputSchema = CrmAppointmentBaseSchema.omit({ id: true, createdAt: true, updatedAt: true }).refine((value) => new Date(value.endAt) > new Date(value.startAt), { message: "Appointment must end after it starts." });
export const CrmTaskInputSchema = CrmTaskSchema.omit({ id: true, createdAt: true, updatedAt: true });

export const PublicIntakeSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).default(""),
  need: z.string().trim().min(5).max(1200),
  consent: z.literal(true),
});
export type PublicIntake = z.infer<typeof PublicIntakeSchema>;

export type PublicAgentEvent =
  | { type: "connected"; conversationId: string }
  | { type: "consulting"; department: string }
  | { type: "specialist_joined"; employeeId: EmployeeId; name: string; avatar: string }
  | { type: "specialist_message"; employeeId: EmployeeId; name: string; avatar: string; content: string }
  | { type: "specialist_unavailable"; employeeId: EmployeeId; name: string }
  | { type: "work_item_created"; workItem: WorkItem }
  | { type: "deliverable_ready"; deliverable: Deliverable }
  | { type: "quote_ready"; quote: Quote; deliverable: Deliverable }
  | { type: "appointment_requested"; workItem: WorkItem }
  | { type: "assistant_delta"; content: string }
  | { type: "done"; conversationId: string; content: string; department?: string }
  | { type: "error"; message: string; code?: string };

export const PublicResumeInputSchema = z.object({
  token: z.string().min(32).max(200),
});

export const PublicConversationMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["customer", "receptionist", "specialist"]),
  content: z.string(),
  employeeId: EmployeeIdSchema.optional(),
  name: z.string().optional(),
  avatar: z.string().optional(),
});
export type PublicConversationMessage = z.infer<typeof PublicConversationMessageSchema>;

export const CrmConversationSchema = z.object({
  id: z.string(), contactId: z.string(), leadId: z.string(), customerName: z.string(), customerEmail: z.string(),
  initialNeed: z.string(), createdAt: z.string(), lastActivity: z.string(), messageCount: z.number().int().min(0),
  departments: z.array(z.string()), status: z.enum(["new", "awaiting_customer", "awaiting_owner", "follow_up_due", "resolved"]), file: z.string(),
});
export type CrmConversation = z.infer<typeof CrmConversationSchema>;
