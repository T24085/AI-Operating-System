# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Durable product decisions

- The selected visual target is `design-reference/midnight-operations.png` (the second generated concept).
- Preserve the dark midnight-navy desktop, large employee workspace, right-side approvals/activity rail, and bottom portrait dock.
- The application is local-first, binds to `127.0.0.1`, uses Ollama, and requires explicit approval before any file mutation or employee handoff.
- Markdown files are canonical records; SQLite is a rebuildable search index only.
- The private owner CRM lives at `/admin/crm`, extends the selected Midnight Operations visual system, and keeps contacts, leads, appointments, tasks, and activity as local Markdown records under `crm/`.
- Website chatbots and any prior Samuel Studio CRM implementations remain out of scope until the owner explicitly asks to connect them.
- `/` is the public Samuel Studio concierge. First-time customers provide name, email, their need, and storage consent before chatting; phone remains optional. With explicit “remember this device” enabled, contact details are stored only in that browser so returning customers enter only their new question, with controls to change or forget the saved identity.
- Remembered visitors can resume up to five recent browser-authorized conversations. The browser stores a per-conversation resume credential, the Markdown record stores only its one-way hash, and the server reconstructs visible history plus Receptionist context after reload or restart.
- Every private employee workspace has a recent-conversations picker and new-conversation control. Owner/employee transcripts are reconstructed from canonical Markdown and rehydrated into that employee’s Ollama context after switching employees, reloading, or restarting the server.
- The Receptionist is the customer-facing host. When she routes a question, Sales, Marketing, Developer, Designer, Research, Social Media, or Customer Service visibly joins the live chat with its own portrait, name, role badge, and customer-safe reply; hidden briefs and all internal records remain private.
- `/admin` contains the full AI employee desktop and `/admin/crm` contains client operations; both require the shared private owner session.
- Public customer conversations are tracked from intake onward and remain canonical append-only Markdown records under `employees/receptionist/conversations/`.
- The owner-only CRM Conversations view links each public transcript to its contact and lead, exposes visible customer, Receptionist, and joined-specialist turns plus separate internal department handoffs, and never exposes private records to the public route.
- Every employee has a canonical `SOUL.md` and `PLAN.md`; both are injected into the Ollama system prompt and are viewable through the owner workspace's Soul & Plan tab.
- Samuel Studio service truth lives in `company/SERVICES.md`, confirmed proof links in `company/PROJECTS.md`, and source freshness in `company/SOURCES.md`. Sales must distinguish Samuel Studio, Samuel Studio Colombia, and Samuel.Studio.dev.
- Accounting and Bookkeeper use `company/finance/Samuel-Studio-Finance.xlsx` plus controlled agent-readable CSV ledgers. Financial changes remain approval-gated and no employee can move money or post to a live system.
- Only the Research employee may use the read-only public-web search/page tools. Local/private network targets, credentials, forms, sending, downloads, and mutations remain blocked.
- Research has a private Markdown-backed map of sourced businesses and organizations under `research/organizations/`, with explicit prospect, research, contact, active-client, partner, and not-a-fit states. AI-created pins require approval. Directions may open as a prefilled SMS draft, but the application must never silently send a text message.
- Local website prospecting begins with exact city/state map discovery. A missing website field is never treated as proof that a company has no website; Research must verify selected candidates with public search, report uncertainty, and synthesize before its bounded tool budget ends.
- An owner question to Research triggers immediate evidence gathering, not a research-plan-only response or future-work promise. Research asks one concise clarification only when a missing detail materially changes the result, otherwise uses multiple local/public queries, returns source-linked findings with access dates and uncertainty in chat, and automatically proposes a durable Markdown report under `employees/research/artifacts/` for owner approval.
- A customer-facing promise is valid only when a canonical `WorkItem` exists. Quotes, proposals, reports, appointment requests, and briefs must expose their status instead of using untracked future-tense assurances.
- Published package prices come from versioned structured offers. Customer quotes are non-binding estimates; custom and negotiated terms require owner approval. Customer-safe deliverables use revocable bearer tokens whose one-way hashes are stored in Markdown.
- Qualified public conversations create or update CRM follow-through, and tentative appointment holds remain owner-confirmed. Fictional CRM records are available only when explicit demo mode is enabled.
- Quote work creates a shared project with participating specialists, a work item, a quote, and a customer deliverable. Approved handoffs also create a real task in the receiving employee's queue.
- Owner access is intended for Tailscale Serve. A future `nova.casa` public proxy may expose only the concierge and `/api/public/**`; it must deny `/admin/**` and all private API routes at the proxy boundary.
- Moving between `/admin` and `/admin/crm` must preserve the mounted employee desktop so open conversations, pending response bubbles, and per-agent working indicators remain visible and continue updating when the owner returns.
- Research Map website fields contain either a verified absolute URL or an empty value. Model phrases such as “none found” belong in research notes and must normalize safely instead of causing an approved map action to fail.
- Private employee workspaces stay mounted independently: the owner can start one employee, switch to another, and send more work while earlier responses continue. The portrait dock shows per-employee working, available, and attention states.
- Approval execution is authoritative and separate from the employee's conversational follow-up: an interrupted follow-up must not mark completed work as failed, and the approval rail refreshes after ambiguous connection failures before allowing a retry.
- Accounting has an owner-only Ledger tab with a read-only, auto-refreshing view of `company/finance/transactions.csv`, summary totals, review flags, search, and filters. Ledger mutations remain separate approval-gated actions.
- Sales has a private Employee Files tab backed by `shared/employee-files/sales/`. Authenticated human team members can open or download the formatted documents; the Sales agent searches locally indexed Markdown companions. Public routes cannot access the library.
- Authenticated team members may upload employee-library files from the Sales tab. Uploads are limited to approved document/image extensions and 10 MB, use contained atomic writes, preserve originals, avoid overwrites, and locally extract searchable companions from PDF, Word, text, Markdown, and CSV files.
- Receptionist and Sales share canonical Sales Qualification records under `crm/sales-qualifications/`. Receptionist surfaces qualification gaps at the Front Desk; Sales owns the private Opportunities view; CRM remains the owner pipeline.
- Sales proposals require owner approval and execute idempotently into shared project, work-item, proposal, deliverable, and public-conversation records. Customer progress exposes only a safe stage, last update, and next step; pricing, evidence, constraints, and owner-attention reasons remain private.
- Sales qualification evidence is limited to validated company/offer Markdown and Sales Employee Files agent companions. Sales may not infer custom pricing, availability, negotiated terms, or another department's commitment.
- Marketing and Social Media share canonical Campaign Operations records with Marketing Campaigns, Social Content Calendar, and private Campaign Files views. Public routing alone never creates a campaign.
- Owner-approved campaign packages freeze revisions and generate separate private campaign-brief and content-calendar PDFs. Campaign employees never publish externally; only the owner may record a verified external URL and publication time.
- Campaign Files preserves generated and owner-uploaded PDFs with checksums, provenance, searchable companions, immutable versions, and authenticated-only access. Referenced assets require explicit rights approval before package generation.
- Department backends use shared canonical business systems with role-specific employee views rather than isolated duplicate records.
- Receptionist and Customer Service share canonical service cases under `crm/service-cases/`: Receptionist owns the Front Desk queue, Customer Service owns private case triage and response proposals, and CRM remains the owner-wide client-operations view.
- Returning customers may see only a public-safe service-case ID, status, update time, and next step. Customer Service replies require owner approval, append idempotently to the public transcript and case timeline, and never expose internal notes, priority, evidence, or escalation reasons.
