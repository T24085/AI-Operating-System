import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  PiArrowRight,
  PiBell,
  PiCalendarBlank,
  PiCaretRight,
  PiChatCircleText,
  PiCheck,
  PiCircleNotch,
  PiClockCounterClockwise,
  PiDatabase,
  PiFileText,
  PiFolderOpen,
  PiGear,
  PiLockKey,
  PiMagnifyingGlass,
  PiMinus,
  PiPaperclip,
  PiPaperPlaneTilt,
  PiPulse,
  PiPlus,
  PiShieldCheck,
  PiSparkle,
  PiSquare,
  PiUsersThree,
  PiWarning,
  PiX,
} from "react-icons/pi";
import type { ActionProposal, BackupManifest, DiagnosticsResponse, EmployeeConversationSummary, EmployeeDefinition, EmployeeId, OnboardingInput, Settings, WorkItem } from "../shared/schemas";
import { api, streamEmployeeMessage, type BootstrapData } from "./api";
import { CrmApp, PrivateAccessGate } from "./Crm";
import { PublicConcierge } from "./PublicConcierge";
import { useDialogFocus } from "./useDialogFocus";

type WindowView = "chat" | "soul" | "records" | "memory";
type ChatMessage = { id: string; role: "owner" | "assistant"; content: string; pending?: boolean };

const onboardingDefaults: OnboardingInput = {
  companyName: "",
  ownerName: "",
  industry: "",
  description: "",
  services: "",
  hours: "Monday–Friday, 9:00 AM–5:00 PM",
  policies: "",
  tone: "Warm, clear, professional, and practical",
  goals: "",
  currency: "USD",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
};

function formatDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(date);
}

function formatTime(date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function getStarterMessages(employee: EmployeeDefinition): ChatMessage[] {
  if (employee.id === "receptionist") {
    return [
      {
        id: "demo-owner",
        role: "owner",
        content: "Hi, I'd like to schedule a consultation about upgrading our website. Do you have any openings next week?",
      },
      {
        id: "demo-assistant",
        role: "assistant",
        content:
          "Hello! I’d be happy to help prepare that request. Here are a few times to check with the owner:\n\n• Tuesday, July 21 at 10:00 AM\n• Wednesday, July 22 at 2:00 PM\n• Friday, July 24 at 11:00 AM\n\nWhich one works best for you?",
      },
    ];
  }
  return [
    {
      id: `demo-${employee.id}`,
      role: "assistant",
      content: `I’m your ${employee.title}. ${employee.tagline} Choose a suggested job or tell me what you need, and I’ll use the company’s local records to help.`,
    },
  ];
}

export function App() {
  const [route, setRoute] = useState(window.location.pathname);
  const navigate = (path: string) => { window.history.pushState({}, "", path); setRoute(path); };
  useEffect(() => { const sync = () => setRoute(window.location.pathname); window.addEventListener("popstate", sync); return () => window.removeEventListener("popstate", sync); }, []);
  if (route === "/admin/crm") return <CrmApp onBack={() => navigate("/admin")} />;
  if (route.startsWith("/admin")) return <AdminApp onPublic={() => navigate("/")} onOpenCrm={() => navigate("/admin/crm")} />;
  return <PublicConcierge onOwner={() => navigate("/admin")} />;
}

function AdminApp({ onPublic, onOpenCrm }: { onPublic: () => void; onOpenCrm: () => void }) {
  const [data, setData] = useState<BootstrapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auth, setAuth] = useState<{ configured: boolean; authenticated: boolean } | null>(null);

  const reload = async () => {
    try {
      setError(null);
      setData(await api.bootstrap());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to start the local application.");
    }
  };

  const load = async () => {
    try {
      const status = await api.crmAuth(); setAuth(status);
      if (status.authenticated) await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to open the private operating system."); }
  };

  useEffect(() => {
    void load();
  }, []);

  if (!auth) return <LoadingScreen error={error} onRetry={load} />;
  if (!auth.authenticated) return <PrivateAccessGate configured={auth.configured} onBack={onPublic} onSuccess={() => void load()} />;
  if (!data) return <LoadingScreen error={error} onRetry={reload} />;
  if (!data.onboarded) return <Onboarding onComplete={reload} />;
  return <Desktop initial={data} onRefresh={reload} onOpenCrm={onOpenCrm} onLogout={async () => { await api.crmLogout(); onPublic(); }} />;
}

function LoadingScreen({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <main className="loading-screen">
      <div className="brand-orbit"><PiSparkle /></div>
      <h1>AI Operating System</h1>
      {error ? (
        <>
          <p>{error}</p>
          <button className="primary-button" onClick={onRetry}>Try again</button>
        </>
      ) : (
        <p><PiCircleNotch className="spin" /> Starting your local team…</p>
      )}
    </main>
  );
}

function Onboarding({ onComplete }: { onComplete: () => Promise<void> }) {
  const [form, setForm] = useState(onboardingDefaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (field: keyof OnboardingInput, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.onboard(form);
      await onComplete();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Onboarding failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="onboarding-shell">
      <section className="onboarding-intro">
        <div className="brand-line"><span className="brand-orbit small"><PiSparkle /></span> AI Operating System</div>
        <div>
          <p className="eyebrow">Private by design · Powered by Ollama</p>
          <h1>Meet the team that starts with your business.</h1>
          <p className="intro-copy">Tell the local system what every employee should know. It creates transparent Markdown records and keeps every consequential action under your control.</p>
        </div>
        <div className="privacy-list">
          <span><PiLockKey /> Runs on this computer</span>
          <span><PiShieldCheck /> Approval before every action</span>
          <span><PiFileText /> Human-readable records</span>
        </div>
      </section>
      <form className="onboarding-form" onSubmit={submit}>
        <header>
          <span>Company setup</span>
          <small>About 3 minutes</small>
        </header>
        <div className="form-scroll">
          <div className="form-grid two">
            <Field label="Company name" value={form.companyName} onChange={(value) => update("companyName", value)} required />
            <Field label="Owner name" value={form.ownerName} onChange={(value) => update("ownerName", value)} required />
          </div>
          <Field label="Industry" value={form.industry} onChange={(value) => update("industry", value)} placeholder="Professional services, retail, home services…" required />
          <Field label="What does the business do?" value={form.description} onChange={(value) => update("description", value)} multiline required />
          <Field label="Products and services" value={form.services} onChange={(value) => update("services", value)} multiline required />
          <div className="form-grid two">
            <Field label="Business hours" value={form.hours} onChange={(value) => update("hours", value)} required />
            <Field label="Timezone" value={form.timezone} onChange={(value) => update("timezone", value)} required />
          </div>
          <Field label="Customer policies" value={form.policies} onChange={(value) => update("policies", value)} multiline placeholder="Returns, deposits, scheduling, response expectations…" />
          <Field label="Brand tone" value={form.tone} onChange={(value) => update("tone", value)} required />
          <Field label="Business goals" value={form.goals} onChange={(value) => update("goals", value)} multiline required />
          <Field label="Currency" value={form.currency} onChange={(value) => update("currency", value)} required />
          {error && <div className="form-error"><PiWarning /> {error}</div>}
        </div>
        <footer>
          <span><PiDatabase /> Stored locally as Markdown</span>
          <button className="primary-button" disabled={busy}>{busy ? <PiCircleNotch className="spin" /> : <>Create my AI team <PiArrowRight /></>}</button>
        </footer>
      </form>
    </main>
  );
}

function Field({ label, value, onChange, multiline, required, placeholder }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; required?: boolean; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label}{required && <b> *</b>}</span>
      {multiline ? (
        <textarea value={value} onChange={(event) => onChange(event.target.value)} required={required} placeholder={placeholder} rows={3} />
      ) : (
        <input value={value} onChange={(event) => onChange(event.target.value)} required={required} placeholder={placeholder} />
      )}
    </label>
  );
}

function Desktop({ initial, onRefresh, onOpenCrm, onLogout }: { initial: BootstrapData; onRefresh: () => Promise<void>; onOpenCrm: () => void; onLogout: () => Promise<void> }) {
  const [activeId, setActiveId] = useState<EmployeeId>("receptionist");
  const [actions, setActions] = useState(initial.actions);
  const [workItems, setWorkItems] = useState(initial.workItems);
  const [activity, setActivity] = useState(initial.activity);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [settings, setSettings] = useState(initial.settings);
  const [resumedMessage, setResumedMessage] = useState<{ conversationId: string; employeeId: EmployeeId; content: string } | null>(null);
  const employee = initial.employees.find((item) => item.id === activeId) ?? initial.employees[0];

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const refreshActions = async () => {
    const [next, nextWorkItems] = await Promise.all([api.actions(), api.workItems()]);
    setActions(next); setWorkItems(nextWorkItems);
    setActivity([
      ...next.map((action) => ({ id: action.id, employeeId: action.employeeId, summary: action.summary, status: action.status, at: action.decidedAt ?? action.createdAt })),
      ...nextWorkItems.map((item) => ({ id: item.id, employeeId: item.employeeId, summary: item.title, status: item.status, at: item.updatedAt })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8));
  };

  return (
    <main className="desktop-shell">
      <TopBar
        date={clock}
        online={initial.ollamaOnline}
        pending={actions.filter((action) => action.status === "pending").length + workItems.filter((item) => item.status === "awaiting_owner" && item.kind === "appointment").length}
        onSearch={() => setSearchOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onOpenCrm={onOpenCrm}
        onLogout={() => void onLogout()}
      />
      <div className={`desktop-main ${minimized ? "is-minimized" : ""}`}>
        {!minimized ? (
          <EmployeeWindow
            key={employee.id}
            employee={employee}
            online={initial.ollamaOnline}
            actions={actions}
            onAction={refreshActions}
            onMinimize={() => setMinimized(true)}
            resumedMessage={resumedMessage}
            onResumeConsumed={() => setResumedMessage(null)}
          />
        ) : (
          <button className="restore-employee" onClick={() => setMinimized(false)}><img src={employee.avatar} alt="" /> Restore {employee.title}</button>
        )}
        <SystemRail
          actions={actions}
          workItems={workItems}
          activity={activity}
          employees={initial.employees}
          onDecision={async (result) => {
            if (result.assistantMessage) setResumedMessage({ conversationId: result.action.conversationId, employeeId: result.action.employeeId, content: result.assistantMessage });
            await refreshActions();
          }}
          onWorkItemDecision={refreshActions}
        />
      </div>
      <EmployeeDock
        employees={initial.employees}
        activeId={activeId}
        onSelect={(id) => { setActiveId(id); setMinimized(false); }}
      />
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          employees={initial.employees}
          onClose={() => setSettingsOpen(false)}
          onSaved={(next) => { setSettings(next); void onRefresh(); }}
        />
      )}
    </main>
  );
}

function TopBar({ date, online, pending, onSearch, onSettings, onOpenCrm, onLogout }: { date: Date; online: boolean; pending: number; onSearch: () => void; onSettings: () => void; onOpenCrm: () => void; onLogout: () => void }) {
  return (
    <header className="top-bar">
      <div className="product-mark"><span className="brand-orbit tiny"><PiSparkle /></span><strong>AI Operating System</strong><i>Midnight Operations</i></div>
      <div className="top-date"><span>{formatDate(date)}</span><b>•</b><span>{formatTime(date)}</span></div>
      <nav aria-label="System status">
        <span className={`online-state ${online ? "online" : "offline"}`}><i /> Ollama · {online ? "Local" : "Offline"}</span>
        <span className="private-state"><PiShieldCheck /> Local &amp; Private</span>
        <span><PiUsersThree /> 10 employees online</span>
        <button className="crm-launch-top" aria-label="Open private CRM" title="Private CRM" onClick={onOpenCrm}><PiCalendarBlank /></button>
        <button aria-label="Search records" onClick={onSearch}><PiMagnifyingGlass /></button>
        <button aria-label={`${pending} pending approvals`} onClick={onSearch} className="notification-button"><PiBell />{pending > 0 && <i>{pending}</i>}</button>
        <button aria-label="Open settings" onClick={onSettings}><PiGear /></button>
        <button aria-label="Lock private workspace" title="Lock workspace" onClick={onLogout}><PiLockKey /></button>
      </nav>
    </header>
  );
}

function EmployeeWindow({ employee, online, actions, onAction, onMinimize, resumedMessage, onResumeConsumed }: { employee: EmployeeDefinition; online: boolean; actions: ActionProposal[]; onAction: () => Promise<void>; onMinimize: () => void; resumedMessage: { conversationId: string; employeeId: EmployeeId; content: string } | null; onResumeConsumed: () => void }) {
  const [view, setView] = useState<WindowView>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>(getStarterMessages(employee));
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<EmployeeConversationSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshConversations = async () => {
    const next = await api.employeeConversations(employee.id);
    setConversations(next);
  };

  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    api.employeeConversations(employee.id)
      .then((next) => { if (!cancelled) setConversations(next); })
      .catch(() => { if (!cancelled) setConversations([]); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [employee.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (resumedMessage && resumedMessage.employeeId === employee.id && resumedMessage.conversationId === conversationId) {
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: resumedMessage.content }]);
      onResumeConsumed();
    }
  }, [resumedMessage, conversationId, employee.id, onResumeConsumed]);

  const resumeConversation = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const restored = await api.resumeEmployeeConversation(id);
      setConversationId(restored.conversation.id);
      setMessages(restored.messages);
      setHistoryOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The conversation could not be restored.");
    } finally {
      setBusy(false);
    }
  };

  const newConversation = () => {
    if (busy) return;
    setConversationId(null);
    setMessages(getStarterMessages(employee));
    setInput("");
    setError(null);
    setHistoryOpen(false);
  };

  const send = async (override?: string) => {
    const content = (override ?? input).trim();
    if (!content || busy) return;
    setInput("");
    setError(null);
    setBusy(true);
    const ownerMessage: ChatMessage = { id: crypto.randomUUID(), role: "owner", content };
    const assistantId = crypto.randomUUID();
    setMessages((current) => [...current, ownerMessage, { id: assistantId, role: "assistant", content: "", pending: true }]);
    try {
      let id = conversationId;
      if (!id) {
        const conversation = await api.createConversation(employee.id, content.slice(0, 80));
        id = conversation.id;
        setConversationId(id);
      }
      await streamEmployeeMessage(id, content, (event) => {
        if (event.type === "assistant_delta") {
          setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: message.content + event.content } : message));
        }
        if (event.type === "action_proposed") void onAction();
        if (event.type === "error") setError(event.message);
      });
      setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, pending: false, content: message.content || "I prepared an action for your review." } : message));
      void refreshConversations();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "The employee could not respond.";
      setError(message);
      setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, pending: false, content: "I couldn’t complete that request. Check Ollama and try again." } : item));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="employee-window" aria-label={`${employee.title} workspace`}>
      <header className="window-titlebar">
        <div><img src={employee.avatar} alt="" /><strong>{employee.title}</strong></div>
        <nav aria-label="Employee workspace views">
          <ViewButton active={view === "chat"} onClick={() => setView("chat")} icon={<PiChatCircleText />}>Chat</ViewButton>
          <ViewButton active={view === "soul"} onClick={() => setView("soul")} icon={<PiSparkle />}>Soul & Plan</ViewButton>
          <ViewButton active={view === "records"} onClick={() => setView("records")} icon={<PiFileText />}>Records</ViewButton>
          <ViewButton active={view === "memory"} onClick={() => setView("memory")} icon={<PiDatabase />}>Memory</ViewButton>
        </nav>
        <div className="window-controls"><button aria-label="Minimize employee" onClick={onMinimize}><PiMinus /></button><button aria-label="Maximize employee"><PiSquare /></button><button aria-label="Close employee" onClick={onMinimize}><PiX /></button></div>
      </header>
      <div className="window-body">
        <EmployeeProfile employee={employee} online={online} />
        {view === "chat" ? (
          <div className="chat-panel">
            <div className="conversation-toolbar">
              <button className={historyOpen ? "active" : ""} aria-expanded={historyOpen} onClick={() => setHistoryOpen((open) => !open)}><PiClockCounterClockwise /><span>Recent conversations</span>{conversations.length > 0 && <b>{conversations.length}</b>}<PiCaretRight /></button>
              <button aria-label={`Start a new ${employee.title} conversation`} title="New conversation" onClick={newConversation} disabled={busy}><PiPlus /></button>
            </div>
            {historyOpen && <section className="conversation-history-panel">
              <header><span><strong>{employee.title} conversations</strong><small>Continue with the full saved context</small></span><button aria-label="Close conversation history" onClick={() => setHistoryOpen(false)}><PiX /></button></header>
              <div>{historyLoading ? <p><PiCircleNotch className="spin" /> Loading conversations…</p> : conversations.length ? conversations.map((conversation) => <button key={conversation.id} className={conversation.id === conversationId ? "active" : ""} onClick={() => void resumeConversation(conversation.id)} disabled={busy}><PiChatCircleText /><span><strong>{conversation.title}</strong><small>{conversation.preview}</small></span><time>{formatRelative(conversation.lastActivity)}</time><PiCaretRight /></button>) : <p>No saved conversations with {employee.title} yet.</p>}</div>
              <footer><button onClick={newConversation}><PiPlus /> Start a new conversation</button></footer>
            </section>}
            <div className="message-list" ref={scrollRef}>
              <div className="conversation-label"><PiUsersThree /> Customer inquiry <time>{formatTime()}</time></div>
              {messages.map((message) => (
                <article key={message.id} className={`message-row ${message.role}`}>
                  {message.role === "assistant" && <span className="message-avatar"><img src={employee.avatar} alt="" /></span>}
                  <div>
                    <b>{message.role === "assistant" ? employee.title : "Owner"}</b>
                    <p>{message.content}{message.pending && <PiCircleNotch className="spin inline-spinner" />}</p>
                  </div>
                </article>
              ))}
              {error && <div className="chat-error"><PiWarning /> {error}</div>}
            </div>
            <div className="suggested-area">
              <span>Suggested actions</span>
              <div>
                {employee.suggestedTasks.map((task, index) => (
                  <button key={task.label} onClick={() => void send(task.prompt)} disabled={busy || !online}>
                    {index === 0 ? <PiCalendarBlank /> : <PiUsersThree />}
                    <span><strong>{task.label}</strong><small>{index === 0 ? "Creates a reviewable local artifact" : "Gather the right details first"}</small></span>
                  </button>
                ))}
              </div>
            </div>
            <form className="message-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
              <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder={`Message ${employee.title}…`} rows={1} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} />
              <button type="button" aria-label="Attach local file"><PiPaperclip /></button>
              <button className="send-button" aria-label="Send message" disabled={!input.trim() || busy || !online}>{busy ? <PiCircleNotch className="spin" /> : <PiPaperPlaneTilt />}</button>
            </form>
          </div>
        ) : (
          <RecordsView employee={employee} mode={view === "memory" ? "memory" : view === "soul" ? "soul" : "records"} />
        )}
      </div>
    </section>
  );
}

function ViewButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return <button className={active ? "active" : ""} onClick={onClick}>{icon}{children}</button>;
}

function EmployeeProfile({ employee, online }: { employee: EmployeeDefinition; online: boolean }) {
  return (
    <aside className="employee-profile">
      <div className="profile-avatar"><img src={employee.avatar} alt={`${employee.title} AI employee`} /><i /></div>
      <h2>{employee.title}</h2>
      <span>AI Employee</span>
      <div className={`model-pill ${online ? "online" : "offline"}`}><i /> Ollama · {online ? "Local" : "Offline"}</div>
      <p>{employee.tagline}</p>
      <div className="profile-separator" />
      <ul>
        <li><PiLockKey /> Runs locally on your system</li>
        <li><PiShieldCheck /> Your data stays private</li>
        <li><PiDatabase /> Markdown source of truth</li>
      </ul>
    </aside>
  );
}

function RecordsView({ employee, mode }: { employee: EmployeeDefinition; mode: "records" | "memory" | "soul" }) {
  const [files, setFiles] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(mode === "memory" ? `employees/${employee.id}/MEMORY.md` : mode === "soul" ? `employees/${employee.id}/SOUL.md` : null);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    const load = async () => {
      setBusy(true);
      const next = await api.employeeFiles(employee.id);
      const visible = mode === "memory"
        ? next.filter((file) => file.endsWith("MEMORY.md"))
        : mode === "soul"
          ? next.filter((file) => file.endsWith("SOUL.md") || file.endsWith("PLAN.md"))
          : next.filter((file) => !file.endsWith("EMPLOYEE.md") && !file.endsWith("MEMORY.md") && !file.endsWith("SOUL.md") && !file.endsWith("PLAN.md"));
      setFiles(visible);
      const first = mode === "memory" ? `employees/${employee.id}/MEMORY.md` : mode === "soul" ? `employees/${employee.id}/SOUL.md` : visible[0] ?? null;
      setActive(first);
      try { setContent(first ? (await api.file(first)).content : "No records yet."); } catch { setContent("No records yet."); }
      setBusy(false);
    };
    void load();
  }, [employee.id, mode]);

  const open = async (path: string) => {
    setActive(path);
    setContent((await api.file(path)).content);
  };

  return (
    <div className={`records-panel ${mode}-records`}>
      <aside>
        <header><PiFolderOpen /> {mode === "memory" ? "Curated memory" : mode === "soul" ? "Soul & operating plan" : "Employee records"}</header>
        {files.length ? files.map((file) => <button key={file} className={file === active ? "active" : ""} onClick={() => void open(file)}><PiFileText /><span>{file.split("/").at(-1)}</span><PiCaretRight /></button>) : <p>No records yet. Start a conversation or approve an action.</p>}
      </aside>
      <article>{busy ? <PiCircleNotch className="spin" /> : <pre>{content}</pre>}</article>
    </div>
  );
}

function SystemRail({ actions, workItems, activity, employees, onDecision, onWorkItemDecision }: { actions: ActionProposal[]; workItems: WorkItem[]; activity: BootstrapData["activity"]; employees: EmployeeDefinition[]; onDecision: (result: { action: ActionProposal; assistantMessage: string | null }) => Promise<void>; onWorkItemDecision: () => Promise<void> }) {
  const pending = actions.find((action) => action.status === "pending");
  const pendingAppointment = workItems.find((item) => item.status === "awaiting_owner" && item.kind === "appointment");
  const pendingCount = actions.filter((action) => action.status === "pending").length + workItems.filter((item) => item.status === "awaiting_owner" && item.kind === "appointment").length;
  return (
    <aside className="system-rail">
      <section className="approval-section">
        <header><span><i /> Pending approval</span><b>{pendingCount}</b></header>
        <small>Requires your review</small>
        {pendingAppointment ? <AppointmentApprovalCard workItem={pendingAppointment} onDone={onWorkItemDecision} /> : pending ? <ApprovalCard action={pending} onDone={onDecision} /> : <div className="empty-approval"><PiShieldCheck /><strong>You’re in control</strong><span>No actions are waiting for approval.</span></div>}
      </section>
      <section className="activity-section">
        <header><span><PiPulse /> Recent activity</span><button>View all</button></header>
        <div className="activity-list">
          {activity.length ? activity.slice(0, 5).map((item) => {
            const employee = employees.find((candidate) => candidate.id === item.employeeId)!;
            return <div className="activity-row" key={`${item.id}-${item.at}`}><img src={employee.avatar} alt="" /><i className={item.status} /><span><strong>{employee.title}</strong><small>{item.summary}</small></span><time>{formatRelative(item.at)}</time></div>;
          }) : <p className="activity-empty">Employee actions will appear here.</p>}
        </div>
      </section>
    </aside>
  );
}

function AppointmentApprovalCard({ workItem, onDone }: { workItem: WorkItem; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState<"confirm" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decide = async (decision: "confirm" | "decline") => {
    setBusy(decision); setError(null);
    try { await api.decideAppointmentWorkItem(workItem.id, decision); await onDone(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Appointment decision failed."); }
    finally { setBusy(null); }
  };
  const requested = workItem.summary.match(/Tentative hold requested for (.+?)\.?$/)?.[1];
  const when = requested && !Number.isNaN(new Date(requested).getTime())
    ? new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(requested))
    : workItem.summary;
  return (
    <article className="approval-card appointment-approval-card">
      <div className="approval-title"><PiCalendarBlank /><span><strong>{workItem.title}</strong><small>Tentative customer hold</small></span></div>
      <label>Requested time</label><p>{when}</p>
      <label>Next step</label><p>{workItem.nextStep}</p>
      {error && <div className="approval-error" role="alert">{error}</div>}
      <span className="sr-only" aria-live="polite">{busy ? `${busy === "confirm" ? "Confirming" : "Declining"} meeting.` : ""}</span>
      <div className="approval-actions"><button className="approve" disabled={Boolean(busy)} onClick={() => void decide("confirm")}>{busy === "confirm" ? <PiCircleNotch className="spin" /> : <PiCheck />} Confirm meeting</button><button disabled={Boolean(busy)} onClick={() => void decide("decline")}>{busy === "decline" ? <PiCircleNotch className="spin" /> : <PiX />} Decline</button></div>
    </article>
  );
}

function ApprovalCard({ action, onDone }: { action: ActionProposal; onDone: (result: { action: ActionProposal; assistantMessage: string | null }) => Promise<void> }) {
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decide = async (decision: "approve" | "deny") => {
    setBusy(decision);
    setError(null);
    try {
      const result = await api.decide(action.id, { decision, contentHash: action.contentHash });
      await onDone(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Decision failed.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <article className="approval-card">
      <div className="approval-title"><PiFileText /><span><strong>{action.summary}</strong><small>{action.tool.replaceAll("_", " ")}</small></span></div>
      <label>Target</label>
      <code>{action.targetPaths.join(", ")}</code>
      <label>Why</label>
      <p>{action.reason}</p>
      <details><summary>Review preview</summary><pre>{action.preview}</pre></details>
      {error && <div className="approval-error" role="alert">{error}</div>}
      <span className="sr-only" aria-live="polite">{busy ? `${busy === "approve" ? "Approving" : "Denying"} action.` : ""}</span>
      <div className="approval-actions"><button className="approve" disabled={Boolean(busy)} onClick={() => void decide("approve")}>{busy === "approve" ? <PiCircleNotch className="spin" /> : <PiCheck />} Approve action</button><button disabled={Boolean(busy)} onClick={() => void decide("deny")}>{busy === "deny" ? <PiCircleNotch className="spin" /> : <PiX />} Deny</button></div>
    </article>
  );
}

function EmployeeDock({ employees, activeId, onSelect }: { employees: EmployeeDefinition[]; activeId: EmployeeId; onSelect: (id: EmployeeId) => void }) {
  return (
    <nav className="employee-dock" aria-label="AI employees">
      {employees.map((employee) => (
        <button key={employee.id} className={employee.id === activeId ? "active" : ""} onClick={() => onSelect(employee.id)}>
          <span><img src={employee.avatar} alt="" /><i /></span>
          <strong>{employee.shortName}</strong>
        </button>
      ))}
    </nav>
  );
}

function SearchModal({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ path: string; title: string; snippet: string }>>([]);
  const [busy, setBusy] = useState(false);
  const run = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setResults(await api.search(query));
    setBusy(false);
  };
  return (
    <Modal title="Search business records" onClose={onClose}>
      <form className="search-form" onSubmit={run}><PiMagnifyingGlass /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations, actions, memory…" /><button>{busy ? <PiCircleNotch className="spin" /> : "Search"}</button></form>
      <div className="search-results">{results.map((result) => <article key={result.path}><PiFileText /><div><strong>{result.title}</strong><code>{result.path}</code><p>{result.snippet.replace(/<\/?mark>/g, "")}</p></div></article>)}{!busy && query && !results.length && <p>No matching Markdown records.</p>}</div>
    </Modal>
  );
}

function SettingsModal({ settings, employees, onClose, onSaved }: { settings: Settings; employees: EmployeeDefinition[]; onClose: () => void; onSaved: (settings: Settings) => void }) {
  const [draft, setDraft] = useState(settings);
  const [models, setModels] = useState<Array<{ name: string; size: number }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | null>(null);
  const [backups, setBackups] = useState<BackupManifest[]>([]);
  const [restoreId, setRestoreId] = useState("");
  const [restoreConfirmation, setRestoreConfirmation] = useState("");
  const refreshReliability = async () => { const [nextDiagnostics, nextBackups] = await Promise.all([api.diagnostics(), api.backups()]); setDiagnostics(nextDiagnostics); setBackups(nextBackups); if (!restoreId && nextBackups[0]) setRestoreId(nextBackups[0].backupId); };
  useEffect(() => { api.models().then(setModels).catch(() => setModels([])); refreshReliability().catch((reason) => setError(reason.message)); }, []);
  const save = async () => {
    setBusy(true);
    try { onSaved(await api.settings(draft)); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save settings."); } finally { setBusy(false); }
  };
  return (
    <Modal title="Local AI settings" onClose={onClose} wide>
      <div className="settings-body">
        <section>
          <h3>Runtime</h3>
          <label>Default Ollama model<select value={draft.defaultModel} onChange={(event) => setDraft({ ...draft, defaultModel: event.target.value })}>{models.map((model) => <option key={model.name}>{model.name}</option>)}</select></label>
          <label>Context length<input type="number" min={2048} max={262144} step={1024} value={draft.contextLength} onChange={(event) => setDraft({ ...draft, contextLength: Number(event.target.value) })} /></label>
          <button className="secondary-button" onClick={() => void api.openFolder()}><PiFolderOpen /> Open Markdown workspace</button>
          <button className="secondary-button" onClick={async () => { setBusy(true); setError(null); try { const result = await api.createBackup(); setBackupMessage(`Validated backup created: ${result.backupId}`); await refreshReliability(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create backup."); } finally { setBusy(false); } }}><PiDatabase /> Create validated backup</button>
          {backupMessage && <p className="settings-success" role="status"><PiCheck /> {backupMessage}</p>}
        </section>
        <section>
          <h3>Employee model overrides</h3>
          <div className="role-models">{employees.map((employee) => <label key={employee.id}><span><img src={employee.avatar} alt="" />{employee.title}</span><select value={draft.roleModels[employee.id] ?? ""} onChange={(event) => setDraft({ ...draft, roleModels: { ...draft.roleModels, [employee.id]: event.target.value } })}><option value="">Use default</option>{models.map((model) => <option key={model.name}>{model.name}</option>)}</select></label>)}</div>
        </section>
        <section className="diagnostics-panel" aria-labelledby="diagnostics-heading">
          <div className="diagnostics-heading"><div><h3 id="diagnostics-heading">Diagnostics & recovery</h3><p>Canonical record health, local model status, search freshness, and validated backups.</p></div><button className="secondary-button" onClick={() => void refreshReliability()} disabled={busy}>Refresh</button></div>
          {diagnostics && <div className="diagnostics-grid" aria-live="polite"><span><small>Ollama</small><strong className={diagnostics.ollamaOnline ? "healthy" : "unhealthy"}>{diagnostics.ollamaOnline ? "Online" : "Offline"}</strong></span><span><small>Malformed records</small><strong className={diagnostics.malformedRecords.length ? "unhealthy" : "healthy"}>{diagnostics.malformedRecords.length}</strong></span><span><small>Pending approvals</small><strong>{diagnostics.pendingActions}</strong></span><span><small>Pending work</small><strong>{diagnostics.pendingWorkItems}</strong></span></div>}
          {diagnostics?.malformedRecords.length ? <div className="diagnostics-issues" role="alert">{diagnostics.malformedRecords.map((issue) => <article key={issue.path}><strong>{issue.path}</strong><span>{issue.recordKind} · schema v{issue.schemaVersion}</span><p>{issue.validationError}</p></article>)}</div> : diagnostics && <p className="diagnostics-clean"><PiShieldCheck /> All canonical records parsed successfully.</p>}
          <div className="diagnostics-actions"><button className="secondary-button" onClick={async () => { setBusy(true); setError(null); try { const result = await api.reindex(); setBackupMessage(`Search index rebuilt: ${new Date(result.indexFreshAt).toLocaleString()}`); await refreshReliability(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to rebuild the index."); } finally { setBusy(false); } }} disabled={busy}><PiPulse /> Rebuild search index</button>{diagnostics?.latestValidatedBackup && <span>Latest backup <strong>{new Date(diagnostics.latestValidatedBackup.createdAt).toLocaleString()}</strong></span>}</div>
          {backups.length > 0 && <div className="restore-controls"><label>Validated backup<select value={restoreId} onChange={(event) => { setRestoreId(event.target.value); setRestoreConfirmation(""); }}>{backups.map((backup) => <option key={backup.backupId} value={backup.backupId}>{new Date(backup.createdAt).toLocaleString()} · {backup.reason}</option>)}</select></label><label>Confirmation<input value={restoreConfirmation} onChange={(event) => setRestoreConfirmation(event.target.value)} placeholder={`RESTORE ${restoreId}`} /></label><button className="danger-button" disabled={busy || restoreConfirmation !== `RESTORE ${restoreId}`} onClick={async () => { setBusy(true); setError(null); try { await api.restoreBackup(restoreId, restoreConfirmation); setBackupMessage(`Restored ${restoreId}; a pre-restore backup was created and the index rebuilt.`); setRestoreConfirmation(""); await refreshReliability(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to restore the backup."); } finally { setBusy(false); } }}>Restore backup</button></div>}
        </section>
        {error && <div className="form-error" role="alert"><PiWarning /> {error}</div>}
      </div>
      <div className="modal-footer"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" onClick={() => void save()} disabled={busy}>{busy ? <PiCircleNotch className="spin" /> : "Save settings"}</button></div>
    </Modal>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const dialogRef = useDialogFocus<HTMLElement>(onClose);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} tabIndex={-1} className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}><header><strong>{title}</strong><button aria-label="Close" onClick={onClose}><PiX /></button></header>{children}</section></div>;
}
