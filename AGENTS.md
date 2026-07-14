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
- A customer-facing promise is valid only when a canonical `WorkItem` exists. Quotes, proposals, reports, appointment requests, and briefs must expose their status instead of using untracked future-tense assurances.
- Published package prices come from versioned structured offers. Customer quotes are non-binding estimates; custom and negotiated terms require owner approval. Customer-safe deliverables use revocable bearer tokens whose one-way hashes are stored in Markdown.
- Qualified public conversations create or update CRM follow-through, and tentative appointment holds remain owner-confirmed. Fictional CRM records are available only when explicit demo mode is enabled.
- Quote work creates a shared project with participating specialists, a work item, a quote, and a customer deliverable. Approved handoffs also create a real task in the receiving employee's queue.
- Owner access is intended for Tailscale Serve. A future `nova.casa` public proxy may expose only the concierge and `/api/public/**`; it must deny `/admin/**` and all private API routes at the proxy boundary.
