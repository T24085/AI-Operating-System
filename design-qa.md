# Design QA — Midnight Operations

## Source of truth

- Selected concept: `design-reference/midnight-operations.png`
- Desktop viewport: 1440 × 1024
- Compact viewport: 390 × 844
- Comparison state: Receptionist workspace open, customer inquiry visible, one file action pending owner approval, activity rail visible, all ten employee portraits available in the dock

## Full-view evidence

- Initial implementation: `design-reference/implementation-1440.png`
- Initial side-by-side: `design-reference/qa-comparison-1.png`
- Final implementation: `design-reference/implementation-1440-final-3.png`
- Final side-by-side: `design-reference/qa-comparison-final-3.png`
- Final compact implementation: `design-reference/implementation-compact-final.png`
- Short-height composer regression: `design-reference/composer-regression-1280x720.png`

The source and implementation were normalized to the same 1440 × 1024 canvas and placed in one comparison image. The final comparison matches the selected dark navy business desktop, top system bar, employee window proportions, profile/chat split, approval rail, amber approval controls, portrait dock placement, typography hierarchy, border treatment, and local/private status language.

## Finding and fix history

- P1 — The first implementation window and dock sat lower and used different vertical proportions than the normalized source. Fixed by matching the source window bottom, dock top, and dock height at the desktop viewport.
- P1 — Switching directly from Records to Memory could preserve the previously selected action file content. Fixed the view loader so Memory always opens that employee's curated `MEMORY.md`.
- P2 — Compact-width horizontal dock scrolling exposed native scrollbars. Fixed by retaining horizontal employee access while hiding platform scrollbars.
- P2 — SQLite watcher did not reliably follow manually edited Markdown when given a glob under chokidar v4. Fixed by watching the workspace root and filtering Markdown events.
- P2 — The first live Receptionist request could over-search its own transcript. Tightened the role prompt and record-search filter, then re-ran the live action flow successfully.
- P1 — Long streamed responses at short desktop heights could expand the chat grid beyond the employee window and place the composer underneath the employee dock. Constrained the chat grid, made the message list the sole vertical scroller, and added a short-height dock layout.

No unresolved P0, P1, or P2 visual findings remain.

## Interaction evidence

- Completed onboarding and reloaded without losing company or employee records.
- Switched between Receptionist and Developer workspaces.
- Opened Chat, Records, and Memory views and inspected real Markdown content.
- Searched records for “website consultation” and received the artifact, action, and conversation matches.
- Opened settings and confirmed installed Ollama models, the 16K context value, and per-role overrides.
- Streamed a real `gemma4:12b` response and created an approval proposal.
- Confirmed an approved action wrote its target only after approval and resumed the employee response.
- Confirmed a denied action left its target absent, wrote the denial to the action record, and resumed the employee response.
- Verified a pending action survives reload and remains owner-reviewable.
- Verified desktop and compact layouts have no document-level horizontal overflow.
- Checked browser warning and error logs after the final desktop render; none were present.

## Automated verification

- `npm test`: 31 tests passed across schemas, ten role definitions, role soul/plan prompt composition, record appends, restart recovery, public and private employee conversation resumption, FTS rebuilding, approval hashes, stale approvals, traversal, symlinks, oversized files, streamed chat, tool calls, malformed tool handling, action continuation, Ollama disconnection, chat-layout regression contracts, CRM authentication, Markdown reconstruction, conflict prevention, non-destructive pipeline updates, public intake capture, visible specialist joins, private-information boundaries, and Research-only network restrictions.
- `npm run build`: server TypeScript and production Vite build passed.

## Private CRM extension

- Route: `/admin/crm`
- Desktop implementation: `design-reference/crm-desktop.png`
- Compact calendar implementation: `design-reference/crm-mobile-full.png`
- Source-and-implementation comparison: `design-reference/crm-qa-comparison.png`
- Reference source and CRM implementation were reviewed together on one canvas. The CRM intentionally changes the desktop anatomy for owner operations while retaining the source navy palette, fine borders, restrained amber actions, compact status typography, information density, local/private language, and Windows-inspired navigation.
- Verified owner password setup/login/logout, pipeline stage changes without data loss, contact search, lead form, month navigation, selected-day appointments, calculated openings, desktop layout, compact full-screen layout, and visible keyboard-focus controls.
- Browser error and warning logs were empty after the final desktop and compact renders.
- No unresolved P0, P1, or P2 CRM findings remain.

## Public Receptionist extension

- Source visual truth: `design-reference/midnight-operations.png`
- Desktop intake implementation: `design-reference/public-intake-1440.png`
- Desktop routed conversation: `design-reference/public-chat-1440.png`
- Compact intake implementation: `design-reference/public-intake-mobile.png`
- Full-view comparison evidence: `design-reference/public-qa-comparison.png`
- Viewport and state: 1440 × 1024 public intake before submission; 390 × 844 compact intake; routed Developer consultation after a valid customer intake.
- Focused-region comparison was not needed because the source and implementation forms, portrait, typography, navigation, and controls remain readable in the normalized 2880 × 1024 comparison. The routed chat was separately captured at full desktop resolution.
- Typography preserves the source serif display voice and compact sans-serif UI hierarchy; spacing carries over its broad desktop canvas and dense bordered panels; colors reuse midnight navy, cool blue-gray borders, restrained amber actions, and green presence states; the supplied Receptionist portrait remains sharp and correctly masked; copy is customer-facing and contains no implementation prompt language.
- Interaction evidence: required intake fields, consent gate, CRM contact/lead creation, streamed reply, visible Developer consultation status, hidden internal brief, follow-up composer, quick prompts, direct owner-access route, and private admin API denial were verified.
- P2 history: the first compact full-page capture clipped the hero and owner-access label at the browser capture edge. Reduced the compact display size, constrained the hero, hid the owner-access label while retaining its lock icon and accessible name, then re-captured with 390px document width and no horizontal overflow.
- Browser warning and error logs were empty after the routed desktop conversation. Unauthorized requests to bootstrap, actions, and file records each returned HTTP 401.
- No unresolved P0, P1, or P2 public-flow findings remain.

## Conversation tracking extension

- Source visual truth: `design-reference/midnight-operations.png`
- Desktop implementation: `design-reference/crm-conversations-1440.png`
- Compact implementation: `design-reference/crm-conversations-mobile.png`
- Source-and-implementation comparison: `design-reference/crm-conversations-comparison.png`
- Viewport and state: 1440 Ã— 1024 owner CRM conversation inbox with a linked customer/lead transcript; 390 Ã— 844 compact inbox with the same conversation selected.
- Public intake now writes a CRM linkage event before the first Ollama request. The owner inbox reconstructs customer and Receptionist messages, internal department consultations, message counts, waiting/replied state, last activity, and the canonical Markdown record path.
- Interaction evidence: submitted a public inquiry, observed the Developer consultation, streamed the complete Receptionist reply, authenticated as the owner, opened the CRM Conversations view, searched and selected the conversation, and verified the linked contact/lead context and private handoff event.
- P2 history: the first compact render clipped list and transcript text. Tightened compact grid widths, allowed message wrapping, collapsed the context region to one column, and re-captured at a 390px document width with no horizontal overflow.
- Browser warning and error logs were empty after desktop and compact verification.
- No unresolved P0, P1, or P2 conversation-tracking findings remain.

## Agent soul and finance extension

- Source visual truth: `design-reference/midnight-operations.png`
- Desktop implementation: `design-reference/sales-soul-plan-1440.png`
- Compact implementation: `design-reference/sales-soul-plan-mobile.png`
- Source-and-implementation comparison: `design-reference/sales-soul-plan-comparison.png`
- Viewport and state: 1440 Ã— 1024 Sales workspace with `SOUL.md` selected; 390 Ã— 844 compact Sales workspace with the Soul & Plan navigation and file switcher visible.
- The source and implementation were reviewed together at a normalized 1440 Ã— 1024. The extension preserves the selected midnight desktop, employee profile anatomy, fine borders, compact system typography, portrait dock, and existing tab treatment while adding only the requested operating-file view.
- Interaction evidence: selected Sales, opened Soul & Plan, switched between `SOUL.md` and `PLAN.md`, verified Samuel Studio-specific pricing/link instructions, and confirmed the compact view retains access to Chat, Soul & Plan, Records, Memory, and both operating files.
- Spreadsheet evidence: visually reviewed Summary, Transactions, Invoices, Budget, Categories, Sources, and Checks; verified zero formula-error matches and initial model status PASS.
- P2 history: the first compact production render inherited the earlier hidden workspace navigation and could not switch between Soul and Plan. Replaced it with a compact four-tab title bar and a two-file switcher, then rebuilt and recaptured at 390px.
- No unresolved P0, P1, or P2 soul, plan, or finance-workbook findings remain.

## Visible specialist join extension

- Desktop implementation: `design-reference/public-specialist-join-1440.png`
- Compact implementation: `design-reference/public-specialist-join-mobile.png`
- Previous-and-current comparison: `design-reference/public-specialist-join-comparison.png`
- Viewport and state: 1440 × 1024 and 390 × 844 public customer chat after Sales joins a pricing conversation.
- The routed specialist now appears in the customer-visible event stream before the Receptionist follow-up, with a distinct portrait, employee name, “Studio specialist” badge, blue specialist surface, and restrained amber accent. The Receptionist retains the “Conversation host” badge and adds only coordination or a follow-up question rather than repeating the specialist.
- The same turn writes a visible `public_specialist_message` and a separate private `internal_handoff` event to canonical Markdown. CRM reconstruction renders the specialist as a distinct transcript participant and counts the visible specialist turn.
- Interaction evidence: completed customer intake, routed a package-and-price question to Sales, observed the specialist answer followed by the Receptionist host response, and confirmed both desktop and compact layouts remain readable. The compact quick-prompt rail retains touch scrolling while hiding the native scrollbar.
- Automated evidence: deterministic mocked Ollama responses validate join, specialist reply, Receptionist follow-up, Markdown serialization, CRM department linkage, and a three-message visible count.
- No unresolved P0, P1, or P2 visible-specialist findings remain.

## Returning visitor extension

- Source visual truth: `design-reference/public-intake-1440.png`
- Desktop implementation: `design-reference/public-returning-visitor-1440.png`
- Compact implementation: `design-reference/public-returning-visitor-mobile.png`
- Full-view comparison: `design-reference/public-returning-visitor-comparison.png`
- Viewport and state: 1440 × 1024 and 390 × 844 public concierge entry after a visitor completes intake once and returns on the same browser.
- The returning state preserves the first-time intake typography, midnight palette, Receptionist portrait, card anatomy, input styling, amber action, trust language, and responsive structure. Focused-region evidence was not needed because the identity summary, question field, primary action, change control, and forget control are readable in the full-view comparison and the compact capture.
- Interaction evidence: completed first-time intake with “Remember my contact details on this device” enabled, reloaded the route, observed the saved visitor identity and empty new-question field, opened “Change” and verified the saved name and email were prefilled, then reloaded back to the returning state.
- Privacy behavior: only name, email, and optional phone are saved in browser storage; prior questions and conversation content are not stored there. Visitors can opt out during first intake or remove the saved identity with “Forget me on this device.”
- P2 history: the first returning-state capture made the shortened card visually wider than the source intake. Constrained it to the source card width and recaptured the normalized comparison.
- No unresolved P0, P1, or P2 returning-visitor findings remain.

## Resumable customer conversation extension

- Desktop implementation: `design-reference/public-resume-conversation-1440.png`
- Compact implementation: `design-reference/public-resume-conversation-mobile.png`
- Viewport and state: 1440 × 1024 and 390 × 844 returning-customer entry with a resumable Puppy Wash conversation.
- Interaction evidence: created a new remembered conversation, reloaded the public route, observed the previous-conversation entry, selected it, restored the customer-visible transcript, and sent a new message through the reconstructed server session without receiving an inactive-conversation error.
- Security behavior: each new conversation receives a random browser-held resume credential; canonical Markdown contains only its SHA-256 hash. Invalid credentials are rejected and a server restart can reactivate the Markdown record before reconstructing the model context.
- Context behavior: restored customer, Receptionist, and specialist messages are placed back into the session, and routed specialists now receive the recent conversation history so they do not repeat discovery questions already answered.
- P2 history: the first desktop history state pushed the new-conversation action below the viewport. The history card now aligns earlier in the desktop canvas while retaining the original centered hero and resets that offset on compact screens.
- No unresolved P0, P1, or P2 resumable-conversation findings remain.

## Private employee conversation history extension

- Desktop implementation: `design-reference/internal-agent-history-1440.png`
- Compact implementation: `design-reference/internal-agent-history-mobile.png`
- Viewport and state: 1440 × 1024 and 390 × 844 private Receptionist workspace with its recent-conversations panel open over a restored Puppy Wash transcript.
- Interaction evidence: created an owner/Receptionist conversation, switched to Sales, returned to Receptionist, opened the employee-specific history list, restored the transcript, restarted the server, signed back in, and restored the same transcript again.
- Runtime behavior: the server reconstructs owner and employee messages from append-only Markdown, reactivates the conversation record, rebuilds the employee’s Ollama message context, and continues writing to the original transcript. Public customer conversations are excluded from the private employee picker and remain in CRM Conversations.
- Responsive behavior: desktop history appears as a compact overlay without moving the composer; compact history collapses timestamps and retains the title, preview, close control, restore action, and new-conversation action.
- P1 history: the first resume request sent an empty JSON body with a JSON content type and Fastify rejected it. The client now sends an explicit empty object, and the restored transcript was verified after a full server restart.
- No unresolved P0, P1, or P2 private employee-history findings remain.

final result: passed
