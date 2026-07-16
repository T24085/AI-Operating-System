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

export const LedgerEntrySchema = z.object({
  transactionId: z.string(),
  date: z.string(),
  type: z.string(),
  businessLine: z.string(),
  project: z.string(),
  party: z.string(),
  description: z.string(),
  category: z.string(),
  amount: z.number().nullable(),
  grossAmount: z.number().nullable(),
  fee: z.number().nullable(),
  tax: z.number().nullable(),
  paymentMethod: z.string(),
  status: z.string(),
  sourceReference: z.string(),
  notes: z.string(),
  needsReview: z.boolean(),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const LedgerResponseSchema = z.object({
  source: z.string(),
  modifiedAt: z.string(),
  currency: z.string(),
  entries: z.array(LedgerEntrySchema),
  summary: z.object({ income: z.number(), expenses: z.number(), net: z.number(), transactionCount: z.number(), needsReview: z.number() }),
});
export type LedgerResponse = z.infer<typeof LedgerResponseSchema>;

export const EmployeeFileSchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.string(),
  size: z.number().int().nonnegative(),
  modifiedAt: z.string(),
  agentReadable: z.boolean(),
});
export type EmployeeFile = z.infer<typeof EmployeeFileSchema>;

export const ResearchPlaceStatusSchema = z.enum(["prospect", "researching", "contacted", "active", "partner", "not_fit"]);
export type ResearchPlaceStatus = z.infer<typeof ResearchPlaceStatusSchema>;

export const ResearchPlaceKindSchema = z.enum(["business", "organization", "venue", "vendor", "competitor", "partner"]);
export type ResearchPlaceKind = z.infer<typeof ResearchPlaceKindSchema>;

function normalizeOptionalWebsite(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const website = value.trim();
  if (/^(?:n\/?a|none|none found|not found|not recorded|no (?:official )?website)(?:[.;:].*)?$/i.test(website)) return "";
  return website;
}

export const ResearchPlaceInputSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(2).max(180),
  kind: ResearchPlaceKindSchema.default("business"),
  status: ResearchPlaceStatusSchema.default("prospect"),
  address: z.string().trim().min(3).max(500),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  phone: z.string().trim().max(40).default(""),
  website: z.preprocess(normalizeOptionalWebsite, z.union([z.string().url(), z.literal("")])).default(""),
  contactName: z.string().trim().max(120).default(""),
  opportunity: z.string().trim().max(2000).default(""),
  notes: z.string().trim().max(5000).default(""),
  sourceUrls: z.array(z.string().url()).max(20).default([]),
});
export type ResearchPlaceInput = z.infer<typeof ResearchPlaceInputSchema>;

export const ResearchPlaceSchema = ResearchPlaceInputSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastResearchedAt: z.string(),
  file: z.string(),
});
export type ResearchPlace = z.infer<typeof ResearchPlaceSchema>;

export const GeocodeResultSchema = z.object({
  displayName: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  kind: z.string().default("place"),
});
export type GeocodeResult = z.infer<typeof GeocodeResultSchema>;

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

export const RecordHealthIssueSchema = z.object({
  path: z.string(),
  recordKind: z.string(),
  validationError: z.string(),
  severity: z.enum(["warning", "error"]),
  detectedAt: z.string(),
  schemaVersion: z.number().int().min(0),
});
export type RecordHealthIssue = z.infer<typeof RecordHealthIssueSchema>;

export const BackupManifestFileSchema = z.object({
  path: z.string(),
  size: z.number().int().min(0),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const BackupManifestSchema = z.object({
  schemaVersion: z.literal(1),
  backupId: z.string(),
  createdAt: z.string(),
  workspaceSlug: z.string(),
  reason: z.enum(["manual", "pre-restore"]),
  files: z.array(BackupManifestFileSchema),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type BackupManifest = z.infer<typeof BackupManifestSchema>;

export const DiagnosticsResponseSchema = z.object({
  ollamaOnline: z.boolean(),
  indexFreshAt: z.string().nullable(),
  malformedRecords: z.array(RecordHealthIssueSchema),
  latestValidatedBackup: BackupManifestSchema.nullable(),
  pendingActions: z.number().int().min(0),
  pendingWorkItems: z.number().int().min(0),
});
export type DiagnosticsResponse = z.infer<typeof DiagnosticsResponseSchema>;

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

export const DeliverableAccessGrantSchema = z.object({
  id: z.string(),
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  issuedAt: z.string(),
  revokedAt: z.string().nullable().default(null),
});
export type DeliverableAccessGrant = z.infer<typeof DeliverableAccessGrantSchema>;

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

export const ProposalSchema = z.object({
  id: z.string(), workItemId: z.string(), qualificationId: z.string(), conversationId: z.string(), contactId: z.string(), leadId: z.string(),
  projectId: z.string(), status: z.enum(["awaiting_owner", "approved", "delivered"]), title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(2000).default(""), contentFile: z.string(), operationId: z.string(),
  createdAt: z.string(), updatedAt: z.string(), deliveredAt: z.string().nullable().default(null), file: z.string(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

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

export const ServiceCaseStatusSchema = z.enum(["new", "investigating", "awaiting_owner", "awaiting_customer", "resolved", "closed"]);
export const ServiceCasePrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export const ServiceCaseCategorySchema = z.enum(["question", "complaint", "delivery", "billing", "technical", "rights", "privacy", "safety", "policy_exception", "other"]);
export const ServiceCaseEventSchema = z.object({
  id: z.string(), type: z.enum(["created", "status_changed", "note", "customer_message", "reply_approved", "escalated", "resolved", "reopened"]),
  actor: z.enum(["owner", "receptionist", "customer-service", "customer", "system"]), summary: z.string().trim().min(1).max(500),
  detail: z.string().trim().max(10000).default(""), publicSummary: z.string().trim().max(1000).nullable().default(null),
  operationId: z.string().nullable().default(null), createdAt: z.string(),
});
export type ServiceCaseEvent = z.infer<typeof ServiceCaseEventSchema>;

export const ServiceCaseSchema = z.object({
  id: z.string(), contactId: z.string(), leadId: z.string().nullable().default(null), conversationId: z.string(),
  appointmentId: z.string().nullable().default(null), workItemId: z.string().nullable().default(null), assignedEmployeeId: z.literal("customer-service"),
  title: z.string().trim().min(1).max(200), category: ServiceCaseCategorySchema, priority: ServiceCasePrioritySchema,
  status: ServiceCaseStatusSchema, summary: z.string().trim().min(1).max(5000), desiredOutcome: z.string().trim().max(3000).default(""),
  nextStep: z.string().trim().max(1000).default(""), internalNotes: z.string().trim().max(10000).default(""),
  createdBy: z.enum(["owner", "receptionist", "system"]), createdAt: z.string(), updatedAt: z.string(), resolvedAt: z.string().nullable().default(null),
  events: z.array(ServiceCaseEventSchema).default([]), file: z.string(),
});
export type ServiceCase = z.infer<typeof ServiceCaseSchema>;

export const ServiceCaseCreateSchema = z.object({
  contactId: z.string(), leadId: z.string().nullable().optional(), conversationId: z.string(), appointmentId: z.string().nullable().optional(),
  workItemId: z.string().nullable().optional(), title: z.string().trim().min(1).max(200), category: ServiceCaseCategorySchema.default("other"),
  priority: ServiceCasePrioritySchema.default("normal"), summary: z.string().trim().min(1).max(5000), desiredOutcome: z.string().trim().max(3000).default(""),
  nextStep: z.string().trim().max(1000).default("Customer Service reviews the conversation and prepares the next response."),
  internalNotes: z.string().trim().max(10000).default(""), createdBy: z.enum(["owner", "receptionist", "system"]).default("owner"),
});
export const ServiceCasePatchSchema = z.object({
  status: ServiceCaseStatusSchema.optional(), priority: ServiceCasePrioritySchema.optional(), category: ServiceCaseCategorySchema.optional(),
  summary: z.string().trim().min(1).max(5000).optional(), desiredOutcome: z.string().trim().max(3000).optional(),
  nextStep: z.string().trim().max(1000).optional(), internalNotes: z.string().trim().max(10000).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "Provide at least one case change." });

export const PublicServiceCaseSummarySchema = z.object({
  id: z.string(), status: ServiceCaseStatusSchema, statusLabel: z.string(), lastUpdated: z.string(), nextStep: z.string(),
});
export type PublicServiceCaseSummary = z.infer<typeof PublicServiceCaseSummarySchema>;

export const SalesQualificationReadinessSchema = z.enum(["new", "collecting", "discovery_ready", "proposal_ready", "awaiting_owner", "proposal_delivered", "closed"]);
export const SalesEvidenceLinkSchema = z.object({
  id: z.string(), kind: z.enum(["company", "offer", "sales_library"]), path: z.string(), label: z.string().trim().min(1).max(200),
  excerpt: z.string().trim().max(2000).default(""), addedAt: z.string(),
});
export type SalesEvidenceLink = z.infer<typeof SalesEvidenceLinkSchema>;
export const SalesQualificationEventSchema = z.object({
  id: z.string(), type: z.enum(["created", "updated", "readiness_changed", "evidence_added", "owner_attention", "proposal_delivered", "closed"]),
  actor: z.enum(["owner", "receptionist", "sales", "system"]), summary: z.string().trim().min(1).max(500), detail: z.string().trim().max(10000).default(""),
  publicSummary: z.string().trim().max(1000).nullable().default(null), operationId: z.string().nullable().default(null), createdAt: z.string(),
});
export type SalesQualificationEvent = z.infer<typeof SalesQualificationEventSchema>;
export const SalesQualificationSchema = z.object({
  id: z.string(), contactId: z.string(), leadId: z.string(), conversationId: z.string().nullable().default(null), appointmentId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null), workItemId: z.string().nullable().default(null), proposalId: z.string().nullable().default(null), deliverableId: z.string().nullable().default(null),
  assignedEmployeeId: z.literal("sales"), title: z.string().trim().min(1).max(200), serviceInterest: z.string().trim().max(500).default(""),
  projectGoal: z.string().trim().max(3000).default(""), deliverables: z.array(z.string().trim().min(1).max(300)).default([]), targetTiming: z.string().trim().max(500).default(""),
  location: z.string().trim().max(500).default(""), budgetState: z.enum(["unknown", "provided", "declined"]).default("unknown"), budgetRange: z.string().trim().max(500).default(""),
  decisionMakerState: z.enum(["unknown", "confirmed", "not_confirmed"]).default("unknown"), decisionMakers: z.string().trim().max(1000).default(""),
  constraints: z.array(z.string().trim().min(1).max(500)).default([]), missingInformation: z.array(z.string().trim().min(1).max(300)).default([]),
  readiness: SalesQualificationReadinessSchema, nextStep: z.string().trim().max(1000).default(""), ownerAttention: z.boolean().default(false), ownerAttentionReasons: z.array(z.string().trim().min(1).max(500)).default([]),
  evidence: z.array(SalesEvidenceLinkSchema).default([]), events: z.array(SalesQualificationEventSchema).default([]),
  createdBy: z.enum(["owner", "receptionist", "system"]), createdAt: z.string(), updatedAt: z.string(), closedAt: z.string().nullable().default(null), file: z.string(),
});
export type SalesQualification = z.infer<typeof SalesQualificationSchema>;
export const SalesQualificationCreateSchema = z.object({
  contactId: z.string(), leadId: z.string(), conversationId: z.string().nullable().optional(), appointmentId: z.string().nullable().optional(),
  title: z.string().trim().min(1).max(200), serviceInterest: z.string().trim().max(500).default(""), projectGoal: z.string().trim().max(3000).default(""),
  deliverables: z.array(z.string().trim().min(1).max(300)).default([]), targetTiming: z.string().trim().max(500).default(""), location: z.string().trim().max(500).default(""),
  budgetState: z.enum(["unknown", "provided", "declined"]).default("unknown"), budgetRange: z.string().trim().max(500).default(""),
  decisionMakerState: z.enum(["unknown", "confirmed", "not_confirmed"]).default("unknown"), decisionMakers: z.string().trim().max(1000).default(""),
  constraints: z.array(z.string().trim().min(1).max(500)).default([]), nextStep: z.string().trim().max(1000).default("Receptionist collects the remaining qualification details."),
  createdBy: z.enum(["owner", "receptionist", "system"]).default("owner"),
});
export const SalesQualificationPatchSchema = z.object({
  serviceInterest: z.string().trim().max(500).optional(), projectGoal: z.string().trim().max(3000).optional(), deliverables: z.array(z.string().trim().min(1).max(300)).optional(),
  targetTiming: z.string().trim().max(500).optional(), location: z.string().trim().max(500).optional(), budgetState: z.enum(["unknown", "provided", "declined"]).optional(),
  budgetRange: z.string().trim().max(500).optional(), decisionMakerState: z.enum(["unknown", "confirmed", "not_confirmed"]).optional(), decisionMakers: z.string().trim().max(1000).optional(),
  constraints: z.array(z.string().trim().min(1).max(500)).optional(), readiness: SalesQualificationReadinessSchema.optional(), nextStep: z.string().trim().max(1000).optional(),
  evidence: z.array(z.object({ kind: z.enum(["company", "offer", "sales_library"]), path: z.string(), label: z.string().trim().min(1).max(200), excerpt: z.string().trim().max(2000).default("") })).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "Provide at least one qualification change." });
export const PublicSalesProgressSummarySchema = z.object({
  id: z.string(), readiness: SalesQualificationReadinessSchema, statusLabel: z.string(), lastUpdated: z.string(), nextStep: z.string(),
});
export type PublicSalesProgressSummary = z.infer<typeof PublicSalesProgressSummarySchema>;
export const SalesOperationsResponseSchema = z.object({
  qualifications: z.array(SalesQualificationSchema), summary: z.object({ new: z.number(), collecting: z.number(), discoveryReady: z.number(), proposalReady: z.number(), ownerReview: z.number(), delivered: z.number() }),
});
export type SalesOperationsResponse = z.infer<typeof SalesOperationsResponseSchema>;

export const CampaignStatusSchema = z.enum(["draft", "planning", "awaiting_owner", "approved", "active", "completed", "archived"]);
export const CampaignPostStatusSchema = z.enum(["idea", "draft", "awaiting_owner", "publish_ready", "published_external", "cancelled"]);
export const CampaignEventSchema = z.object({
  id: z.string(), type: z.enum(["created", "updated", "status_changed", "post_added", "asset_added", "package_approved", "published_external"]),
  actor: z.enum(["owner", "marketing", "social-media", "sales", "system"]), summary: z.string().trim().min(1).max(500),
  detail: z.string().trim().max(10000).default(""), operationId: z.string().nullable().default(null), createdAt: z.string(),
});
export type CampaignEvent = z.infer<typeof CampaignEventSchema>;
export const CampaignEvidenceLinkSchema = z.object({
  id: z.string(), kind: z.enum(["company", "offer", "project", "sales_qualification"]), path: z.string(),
  label: z.string().trim().min(1).max(200), excerpt: z.string().trim().max(2000).default(""), addedAt: z.string(),
});
export type CampaignEvidenceLink = z.infer<typeof CampaignEvidenceLinkSchema>;
export const CampaignSchema = z.object({
  id: z.string(), contactId: z.string().nullable().default(null), leadId: z.string().nullable().default(null), conversationId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null), workItemId: z.string().nullable().default(null), salesQualificationId: z.string().nullable().default(null),
  title: z.string().trim().min(1).max(200), businessLine: z.string().trim().max(200).default("Samuel Studio"), status: CampaignStatusSchema,
  objective: z.string().trim().max(3000).default(""), audience: z.string().trim().max(3000).default(""), offer: z.string().trim().max(2000).default(""),
  messageHierarchy: z.array(z.string().trim().min(1).max(500)).default([]), proof: z.array(z.string().trim().min(1).max(1000)).default([]),
  channels: z.array(z.string().trim().min(1).max(100)).default([]), callToAction: z.string().trim().max(1000).default(""),
  startsAt: z.string().nullable().default(null), endsAt: z.string().nullable().default(null), nextStep: z.string().trim().max(1000).default(""),
  ownerAttention: z.boolean().default(false), ownerAttentionReasons: z.array(z.string().trim().min(1).max(500)).default([]),
  evidence: z.array(CampaignEvidenceLinkSchema).default([]), participants: z.array(z.enum(["marketing", "social-media"])).default(["marketing", "social-media"]),
  version: z.number().int().min(1).default(1), events: z.array(CampaignEventSchema).default([]), createdBy: z.enum(["owner", "sales", "system"]),
  createdAt: z.string(), updatedAt: z.string(), file: z.string(),
});
export type Campaign = z.infer<typeof CampaignSchema>;
export const CampaignCreateSchema = z.object({
  contactId: z.string().nullable().optional(), leadId: z.string().nullable().optional(), conversationId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(), workItemId: z.string().nullable().optional(), salesQualificationId: z.string().nullable().optional(),
  title: z.string().trim().min(1).max(200), businessLine: z.string().trim().max(200).default("Samuel Studio"), objective: z.string().trim().max(3000).default(""),
  audience: z.string().trim().max(3000).default(""), offer: z.string().trim().max(2000).default(""), messageHierarchy: z.array(z.string().trim().min(1).max(500)).default([]),
  proof: z.array(z.string().trim().min(1).max(1000)).default([]), channels: z.array(z.string().trim().min(1).max(100)).default([]),
  callToAction: z.string().trim().max(1000).default(""), startsAt: z.string().nullable().optional(), endsAt: z.string().nullable().optional(),
  nextStep: z.string().trim().max(1000).default("Marketing completes the campaign strategy."), createdBy: z.enum(["owner", "sales", "system"]).default("owner"),
});
export const CampaignPatchSchema = CampaignCreateSchema.omit({ title: true, createdBy: true }).partial().extend({
  title: z.string().trim().min(1).max(200).optional(), status: CampaignStatusSchema.optional(),
  evidence: z.array(z.object({ kind: z.enum(["company", "offer", "project", "sales_qualification"]), path: z.string(), label: z.string().trim().min(1).max(200), excerpt: z.string().trim().max(2000).default("") })).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "Provide at least one campaign change." });

export const CampaignPostRevisionSchema = z.object({
  revision: z.number().int().min(1), copy: z.string().trim().max(10000), callToAction: z.string().trim().max(1000), destinationUrl: z.string().url().nullable().default(null),
  altText: z.string().trim().max(2000), assetIds: z.array(z.string()).default([]), claims: z.array(z.string().trim().min(1).max(1000)).default([]),
  createdBy: z.enum(["owner", "marketing", "social-media"]), createdAt: z.string(),
});
export type CampaignPostRevision = z.infer<typeof CampaignPostRevisionSchema>;
export const CampaignPostSchema = z.object({
  id: z.string(), campaignId: z.string(), platform: z.string().trim().min(1).max(100), plannedAt: z.string().nullable().default(null),
  objective: z.string().trim().max(2000).default(""), status: CampaignPostStatusSchema, currentRevision: z.number().int().min(1),
  revisions: z.array(CampaignPostRevisionSchema).min(1), ownerAttention: z.boolean().default(false), ownerAttentionReasons: z.array(z.string()).default([]),
  operationId: z.string().nullable().default(null), publishedUrl: z.string().url().nullable().default(null), publishedAt: z.string().nullable().default(null), createdAt: z.string(), updatedAt: z.string(), file: z.string(),
});
export type CampaignPost = z.infer<typeof CampaignPostSchema>;
export const CampaignPostInputSchema = z.object({
  platform: z.string().trim().min(1).max(100), plannedAt: z.string().nullable().optional(), objective: z.string().trim().max(2000).default(""),
  copy: z.string().trim().max(10000).default(""), callToAction: z.string().trim().max(1000).default(""), destinationUrl: z.string().url().nullable().optional(),
  altText: z.string().trim().max(2000).default(""), assetIds: z.array(z.string()).default([]), claims: z.array(z.string().trim().min(1).max(1000)).default([]),
  status: CampaignPostStatusSchema.default("draft"), createdBy: z.enum(["owner", "marketing", "social-media"]).default("owner"),
});
export const CampaignPostPatchSchema = CampaignPostInputSchema.partial().extend({ publishedUrl: z.string().url().nullable().optional(), publishedAt: z.string().nullable().optional() })
  .refine((value) => Object.keys(value).length > 0, { message: "Provide at least one post change." });

export const CampaignAssetSchema = z.object({
  id: z.string(), campaignId: z.string(), name: z.string(), path: z.string(), mediaType: z.string(), size: z.number().int().nonnegative(), checksum: z.string().regex(/^[a-f0-9]{64}$/),
  source: z.string().trim().max(500).default("owner upload"), creator: z.string().trim().max(300).default(""), credit: z.string().trim().max(500).default(""),
  usageRights: z.string().trim().max(2000).default(""), rightsExpireAt: z.string().nullable().default(null), approvalStatus: z.enum(["missing", "supplied", "approved", "rejected"]),
  createdAt: z.string(), updatedAt: z.string(), file: z.string(),
});
export type CampaignAsset = z.infer<typeof CampaignAssetSchema>;
export const CampaignAssetPatchSchema = z.object({ source: z.string().trim().max(500).optional(), creator: z.string().trim().max(300).optional(), credit: z.string().trim().max(500).optional(), usageRights: z.string().trim().max(2000).optional(), rightsExpireAt: z.string().nullable().optional(), approvalStatus: z.enum(["missing", "supplied", "approved", "rejected"]).optional() }).refine((value) => Object.keys(value).length > 0, { message: "Provide at least one asset change." });

export const CampaignFileSchema = z.object({
  id: z.string(), campaignId: z.string(), source: z.enum(["generated", "uploaded"]), kind: z.enum(["campaign_brief", "content_calendar", "external_brief", "media_plan", "report", "other"]),
  version: z.number().int().min(1), name: z.string(), path: z.string(), companionPath: z.string().nullable().default(null), checksum: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.literal("application/pdf"), size: z.number().int().positive(), provenance: z.string().trim().max(1000), status: z.enum(["current", "superseded", "archived"]),
  createdAt: z.string(), updatedAt: z.string(), file: z.string(),
});
export type CampaignFile = z.infer<typeof CampaignFileSchema>;
export const CampaignPackageSchema = z.object({
  id: z.string(), campaignId: z.string(), version: z.number().int().min(1), operationId: z.string(), status: z.literal("publish_ready"),
  postIds: z.array(z.string()), assetIds: z.array(z.string()), fileIds: z.array(z.string()), manifestPath: z.string(), archivePath: z.string(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string(), file: z.string(),
});
export type CampaignPublishPackage = z.infer<typeof CampaignPackageSchema>;
export const CampaignOperationsResponseSchema = z.object({ campaigns: z.array(CampaignSchema), posts: z.array(CampaignPostSchema), assets: z.array(CampaignAssetSchema), files: z.array(CampaignFileSchema), packages: z.array(CampaignPackageSchema), summary: z.object({ draft: z.number(), awaitingOwner: z.number(), active: z.number(), publishReadyPosts: z.number(), missingRights: z.number() }) });
export type CampaignOperationsResponse = z.infer<typeof CampaignOperationsResponseSchema>;

export const FrontDeskItemSchema = z.object({
  id: z.string(), kind: z.enum(["conversation", "appointment", "callback", "follow_up", "owner_confirmation", "qualification_due", "discovery_request"]),
  title: z.string(), customerName: z.string(), summary: z.string(), status: z.string(), needsAttention: z.boolean(),
  conversationId: z.string().nullable(), contactId: z.string().nullable(), appointmentId: z.string().nullable(), workItemId: z.string().nullable(),
  caseId: z.string().nullable(), qualificationId: z.string().nullable().optional(), updatedAt: z.string(),
});
export type FrontDeskItem = z.infer<typeof FrontDeskItemSchema>;
export const FrontDeskResponseSchema = z.object({
  items: z.array(FrontDeskItemSchema), summary: z.object({ newInquiries: z.number(), appointmentRequests: z.number(), callbacks: z.number(), ownerConfirmations: z.number(), qualificationDue: z.number().optional() }),
});
export type FrontDeskResponse = z.infer<typeof FrontDeskResponseSchema>;

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
  | { type: "service_case_created"; serviceCase: PublicServiceCaseSummary }
  | { type: "sales_progress_created"; salesProgress: PublicSalesProgressSummary }
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
