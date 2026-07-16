import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  PiArrowRight,
  PiBell,
  PiBriefcase,
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
  PiMapPin,
  PiNavigationArrow,
  PiPhone,
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
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import type {
  ActionProposal,
  BackupManifest,
  DiagnosticsResponse,
  EmployeeConversationSummary,
  EmployeeDefinition,
  EmployeeFile,
  EmployeeId,
  FrontDeskResponse,
  GeocodeResult,
  LedgerResponse,
  OnboardingInput,
  ResearchPlace,
  ResearchPlaceInput,
  SalesOperationsResponse,
  SalesQualification,
  ServiceCase,
  Settings,
  WorkItem,
  Campaign,
  CampaignFile,
  CampaignOperationsResponse,
} from "../shared/schemas";
import {
  api,
  streamEmployeeMessage,
  uploadEmployeeFile,
  uploadCampaignAsset,
  uploadCampaignPdf,
  type BootstrapData,
} from "./api";
import { CrmApp, PrivateAccessGate } from "./Crm";
import { PublicConcierge } from "./PublicConcierge";
import { useDialogFocus } from "./useDialogFocus";
import { SafeMessageText } from "./SafeMessageText";

type WindowView =
  | "chat"
  | "ledger"
  | "files"
  | "opportunities"
  | "map"
  | "front-desk"
  | "cases"
  | "campaigns"
  | "content-calendar"
  | "campaign-files"
  | "soul"
  | "records"
  | "memory";
type ChatMessage = {
  id: string;
  role: "owner" | "assistant";
  content: string;
  pending?: boolean;
};
type EmployeeRunStatus = "idle" | "working" | "error";

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
  timezone:
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
};

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

function formatDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatTime(date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const minutes = Math.max(
    0,
    Math.round((Date.now() - date.getTime()) / 60000),
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function getStarterMessages(employee: EmployeeDefinition): ChatMessage[] {
  if (employee.id === "receptionist") {
    return [
      {
        id: "demo-owner",
        role: "owner",
        content:
          "Hi, I'd like to schedule a consultation about upgrading our website. Do you have any openings next week?",
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
  const navigate = (path: string) => {
    window.history.pushState({}, "", path);
    setRoute(path);
  };
  useEffect(() => {
    const sync = () => setRoute(window.location.pathname);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  if (route.startsWith("/admin"))
    return (
      <>
        <div className="agent-route-layer" hidden={route === "/admin/crm"}>
          <AdminApp
            onPublic={() => navigate("/")}
            onOpenCrm={() => navigate("/admin/crm")}
          />
        </div>
        {route === "/admin/crm" && <CrmApp onBack={() => navigate("/admin")} />}
      </>
    );
  return <PublicConcierge onOwner={() => navigate("/admin")} />;
}

function AdminApp({
  onPublic,
  onOpenCrm,
}: {
  onPublic: () => void;
  onOpenCrm: () => void;
}) {
  const [data, setData] = useState<BootstrapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auth, setAuth] = useState<{
    configured: boolean;
    authenticated: boolean;
  } | null>(null);

  const reload = async () => {
    try {
      setError(null);
      setData(await api.bootstrap());
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to start the local application.",
      );
    }
  };

  const load = async () => {
    try {
      const status = await api.crmAuth();
      setAuth(status);
      if (status.authenticated) await reload();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to open the private operating system.",
      );
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (!auth) return <LoadingScreen error={error} onRetry={load} />;
  if (!auth.authenticated)
    return (
      <PrivateAccessGate
        configured={auth.configured}
        onBack={onPublic}
        onSuccess={load}
      />
    );
  if (!data) return <LoadingScreen error={error} onRetry={reload} />;
  if (!data.onboarded) return <Onboarding onComplete={reload} />;
  return (
    <Desktop
      initial={data}
      onRefresh={reload}
      onOpenCrm={onOpenCrm}
      onLogout={async () => {
        await api.crmLogout();
        onPublic();
      }}
    />
  );
}

function LoadingScreen({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <main className="loading-screen">
      <div className="brand-orbit">
        <PiSparkle />
      </div>
      <h1>AI Operating System</h1>
      {error ? (
        <>
          <p>{error}</p>
          <button className="primary-button" onClick={onRetry}>
            Try again
          </button>
        </>
      ) : (
        <p>
          <PiCircleNotch className="spin" /> Starting your local team…
        </p>
      )}
    </main>
  );
}

function Onboarding({ onComplete }: { onComplete: () => Promise<void> }) {
  const [form, setForm] = useState(onboardingDefaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (field: keyof OnboardingInput, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
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
        <div className="brand-line">
          <span className="brand-orbit small">
            <PiSparkle />
          </span>{" "}
          AI Operating System
        </div>
        <div>
          <p className="eyebrow">Private by design · Powered by Ollama</p>
          <h1>Meet the team that starts with your business.</h1>
          <p className="intro-copy">
            Tell the local system what every employee should know. It creates
            transparent Markdown records and keeps every consequential action
            under your control.
          </p>
        </div>
        <div className="privacy-list">
          <span>
            <PiLockKey /> Runs on this computer
          </span>
          <span>
            <PiShieldCheck /> Approval before every action
          </span>
          <span>
            <PiFileText /> Human-readable records
          </span>
        </div>
      </section>
      <form className="onboarding-form" onSubmit={submit}>
        <header>
          <span>Company setup</span>
          <small>About 3 minutes</small>
        </header>
        <div className="form-scroll">
          <div className="form-grid two">
            <Field
              label="Company name"
              value={form.companyName}
              onChange={(value) => update("companyName", value)}
              required
            />
            <Field
              label="Owner name"
              value={form.ownerName}
              onChange={(value) => update("ownerName", value)}
              required
            />
          </div>
          <Field
            label="Industry"
            value={form.industry}
            onChange={(value) => update("industry", value)}
            placeholder="Professional services, retail, home services…"
            required
          />
          <Field
            label="What does the business do?"
            value={form.description}
            onChange={(value) => update("description", value)}
            multiline
            required
          />
          <Field
            label="Products and services"
            value={form.services}
            onChange={(value) => update("services", value)}
            multiline
            required
          />
          <div className="form-grid two">
            <Field
              label="Business hours"
              value={form.hours}
              onChange={(value) => update("hours", value)}
              required
            />
            <Field
              label="Timezone"
              value={form.timezone}
              onChange={(value) => update("timezone", value)}
              required
            />
          </div>
          <Field
            label="Customer policies"
            value={form.policies}
            onChange={(value) => update("policies", value)}
            multiline
            placeholder="Returns, deposits, scheduling, response expectations…"
          />
          <Field
            label="Brand tone"
            value={form.tone}
            onChange={(value) => update("tone", value)}
            required
          />
          <Field
            label="Business goals"
            value={form.goals}
            onChange={(value) => update("goals", value)}
            multiline
            required
          />
          <Field
            label="Currency"
            value={form.currency}
            onChange={(value) => update("currency", value)}
            required
          />
          {error && (
            <div className="form-error">
              <PiWarning /> {error}
            </div>
          )}
        </div>
        <footer>
          <span>
            <PiDatabase /> Stored locally as Markdown
          </span>
          <button className="primary-button" disabled={busy}>
            {busy ? (
              <PiCircleNotch className="spin" />
            ) : (
              <>
                Create my AI team <PiArrowRight />
              </>
            )}
          </button>
        </footer>
      </form>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline,
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {required && <b> *</b>}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          placeholder={placeholder}
          rows={3}
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          placeholder={placeholder}
        />
      )}
    </label>
  );
}

export function Desktop({
  initial,
  onRefresh,
  onOpenCrm,
  onLogout,
}: {
  initial: BootstrapData;
  onRefresh: () => Promise<void>;
  onOpenCrm: () => void;
  onLogout: () => Promise<void>;
}) {
  const [activeId, setActiveId] = useState<EmployeeId>("receptionist");
  const [actions, setActions] = useState(initial.actions);
  const [workItems, setWorkItems] = useState(initial.workItems);
  const [activity, setActivity] = useState(initial.activity);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [settings, setSettings] = useState(initial.settings);
  const [resumedMessage, setResumedMessage] = useState<{
    conversationId: string;
    employeeId: EmployeeId;
    content: string;
  } | null>(null);
  const [employeeStatuses, setEmployeeStatuses] = useState<
    Partial<Record<EmployeeId, EmployeeRunStatus>>
  >({});
  const employee =
    initial.employees.find((item) => item.id === activeId) ??
    initial.employees[0];

  const updateEmployeeStatus = useCallback(
    (employeeId: EmployeeId, status: EmployeeRunStatus) => {
      setEmployeeStatuses((current) =>
        current[employeeId] === status
          ? current
          : { ...current, [employeeId]: status },
      );
    },
    [],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const refreshActions = async () => {
    const [next, nextWorkItems] = await Promise.all([
      api.actions(),
      api.workItems(),
    ]);
    setActions(next);
    setWorkItems(nextWorkItems);
    setActivity(
      [
        ...next.map((action) => ({
          id: action.id,
          employeeId: action.employeeId,
          summary: action.summary,
          status: action.status,
          at: action.decidedAt ?? action.createdAt,
        })),
        ...nextWorkItems.map((item) => ({
          id: item.id,
          employeeId: item.employeeId,
          summary: item.title,
          status: item.status,
          at: item.updatedAt,
        })),
      ]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 8),
    );
  };

  return (
    <main className="desktop-shell">
      <TopBar
        date={clock}
        online={initial.ollamaOnline}
        pending={
          actions.filter((action) => action.status === "pending").length +
          workItems.filter(
            (item) =>
              item.status === "awaiting_owner" && item.kind === "appointment",
          ).length
        }
        onSearch={() => setSearchOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onOpenCrm={onOpenCrm}
        onLogout={() => void onLogout()}
      />
      <div className={`desktop-main ${minimized ? "is-minimized" : ""}`}>
        {!minimized ? (
          <div className="employee-workspaces">
            {initial.employees.map((workspaceEmployee) => (
              <div
                key={workspaceEmployee.id}
                className={`employee-workspace-slot ${workspaceEmployee.id === activeId ? "active" : ""}`}
                aria-hidden={workspaceEmployee.id !== activeId}
              >
                <EmployeeWindow
                  employee={workspaceEmployee}
                  online={initial.ollamaOnline}
                  actions={actions}
                  onAction={refreshActions}
                  onMinimize={() => setMinimized(true)}
                  resumedMessage={resumedMessage}
                  onResumeConsumed={() => setResumedMessage(null)}
                  onStatusChange={updateEmployeeStatus}
                  onOpenCrm={onOpenCrm}
                />
              </div>
            ))}
          </div>
        ) : (
          <button
            className="restore-employee"
            onClick={() => setMinimized(false)}
          >
            <img src={employee.avatar} alt="" /> Restore {employee.title}
          </button>
        )}
        <SystemRail
          actions={actions}
          workItems={workItems}
          activity={activity}
          employees={initial.employees}
          onDecision={async (result) => {
            if (result.assistantMessage)
              setResumedMessage({
                conversationId: result.action.conversationId,
                employeeId: result.action.employeeId,
                content: result.assistantMessage,
              });
            await refreshActions();
          }}
          onWorkItemDecision={refreshActions}
        />
      </div>
      <EmployeeDock
        employees={initial.employees}
        activeId={activeId}
        statuses={employeeStatuses}
        onSelect={(id) => {
          setActiveId(id);
          setMinimized(false);
        }}
      />
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          employees={initial.employees}
          onClose={() => setSettingsOpen(false)}
          onSaved={(next) => {
            setSettings(next);
            void onRefresh();
          }}
        />
      )}
    </main>
  );
}

function TopBar({
  date,
  online,
  pending,
  onSearch,
  onSettings,
  onOpenCrm,
  onLogout,
}: {
  date: Date;
  online: boolean;
  pending: number;
  onSearch: () => void;
  onSettings: () => void;
  onOpenCrm: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="top-bar">
      <div className="product-mark">
        <span className="brand-orbit tiny">
          <PiSparkle />
        </span>
        <strong>AI Operating System</strong>
        <i>Midnight Operations</i>
      </div>
      <div className="top-date">
        <span>{formatDate(date)}</span>
        <b>•</b>
        <span>{formatTime(date)}</span>
      </div>
      <nav aria-label="System status">
        <span className={`online-state ${online ? "online" : "offline"}`}>
          <i /> Ollama · {online ? "Local" : "Offline"}
        </span>
        <span className="private-state">
          <PiShieldCheck /> Local &amp; Private
        </span>
        <span>
          <PiUsersThree /> 10 employees online
        </span>
        <button
          className="crm-launch-top"
          aria-label="Open private CRM"
          title="Private CRM"
          onClick={onOpenCrm}
        >
          <PiCalendarBlank />
        </button>
        <button aria-label="Search records" onClick={onSearch}>
          <PiMagnifyingGlass />
        </button>
        <button
          aria-label={`${pending} pending approvals`}
          onClick={onSearch}
          className="notification-button"
        >
          <PiBell />
          {pending > 0 && <i>{pending}</i>}
        </button>
        <button aria-label="Open settings" onClick={onSettings}>
          <PiGear />
        </button>
        <button
          aria-label="Lock private workspace"
          title="Lock workspace"
          onClick={onLogout}
        >
          <PiLockKey />
        </button>
      </nav>
    </header>
  );
}

function EmployeeWindow({
  employee,
  online,
  actions,
  onAction,
  onMinimize,
  resumedMessage,
  onResumeConsumed,
  onStatusChange,
  onOpenCrm,
}: {
  employee: EmployeeDefinition;
  online: boolean;
  actions: ActionProposal[];
  onAction: () => Promise<void>;
  onMinimize: () => void;
  resumedMessage: {
    conversationId: string;
    employeeId: EmployeeId;
    content: string;
  } | null;
  onResumeConsumed: () => void;
  onStatusChange: (employeeId: EmployeeId, status: EmployeeRunStatus) => void;
  onOpenCrm: () => void;
}) {
  const [view, setView] = useState<WindowView>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>(
    getStarterMessages(employee),
  );
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<
    EmployeeConversationSummary[]
  >([]);
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
    api
      .employeeConversations(employee.id)
      .then((next) => {
        if (!cancelled) setConversations(next);
      })
      .catch(() => {
        if (!cancelled) setConversations([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [employee.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    if (
      resumedMessage &&
      resumedMessage.employeeId === employee.id &&
      resumedMessage.conversationId === conversationId
    ) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: resumedMessage.content,
        },
      ]);
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
      setError(
        reason instanceof Error
          ? reason.message
          : "The conversation could not be restored.",
      );
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
    onStatusChange(employee.id, "working");
    let failed = false;
    let actionProposed = false;
    const ownerMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "owner",
      content,
    };
    const assistantId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      ownerMessage,
      { id: assistantId, role: "assistant", content: "", pending: true },
    ]);
    try {
      let id = conversationId;
      if (!id) {
        const conversation = await api.createConversation(
          employee.id,
          content.slice(0, 80),
        );
        id = conversation.id;
        setConversationId(id);
      }
      await streamEmployeeMessage(id, content, (event) => {
        if (event.type === "assistant_delta") {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? { ...message, content: message.content + event.content }
                : message,
            ),
          );
        }
        if (event.type === "action_proposed") {
          actionProposed = true;
          void onAction();
        }
        if (event.type === "error") setError(event.message);
      });
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                pending: false,
                content:
                  message.content ||
                  (actionProposed
                    ? "I prepared an action for your review."
                    : "I could not complete that request. No action was created."),
              }
            : message,
        ),
      );
      void refreshConversations();
    } catch (reason) {
      failed = true;
      const message =
        reason instanceof Error
          ? reason.message
          : "The employee could not respond.";
      setError(message);
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                pending: false,
                content:
                  "I couldn’t complete that request. Check Ollama and try again.",
              }
            : item,
        ),
      );
    } finally {
      setBusy(false);
      onStatusChange(employee.id, failed ? "error" : "idle");
    }
  };

  return (
    <section
      className="employee-window"
      aria-label={`${employee.title} workspace`}
    >
      <header className="window-titlebar">
        <div>
          <img src={employee.avatar} alt="" />
          <strong>{employee.title}</strong>
        </div>
        <nav aria-label="Employee workspace views">
          <ViewButton
            active={view === "chat"}
            onClick={() => setView("chat")}
            icon={<PiChatCircleText />}
          >
            Chat
          </ViewButton>
          {employee.id === "accounting" && (
            <ViewButton
              active={view === "ledger"}
              onClick={() => setView("ledger")}
              icon={<PiDatabase />}
            >
              Ledger
            </ViewButton>
          )}
          {employee.id === "sales" && (
            <ViewButton
              active={view === "files"}
              onClick={() => setView("files")}
              icon={<PiFolderOpen />}
            >
              Employee Files
            </ViewButton>
          )}
          {employee.id === "sales" && (
            <ViewButton
              active={view === "opportunities"}
              onClick={() => setView("opportunities")}
              icon={<PiBriefcase />}
            >
              Opportunities
            </ViewButton>
          )}
          {employee.id === "research" && (
            <ViewButton
              active={view === "map"}
              onClick={() => setView("map")}
              icon={<PiMapPin />}
            >
              Research Map
            </ViewButton>
          )}
          {employee.id === "receptionist" && (
            <ViewButton
              active={view === "front-desk"}
              onClick={() => setView("front-desk")}
              icon={<PiCalendarBlank />}
            >
              Front Desk
            </ViewButton>
          )}
          {employee.id === "customer-service" && (
            <ViewButton
              active={view === "cases"}
              onClick={() => setView("cases")}
              icon={<PiShieldCheck />}
            >
              Cases
            </ViewButton>
          )}
          {employee.id === "marketing" && (
            <ViewButton active={view === "campaigns"} onClick={() => setView("campaigns")} icon={<PiBriefcase />}>Campaigns</ViewButton>
          )}
          {employee.id === "social-media" && (
            <ViewButton active={view === "content-calendar"} onClick={() => setView("content-calendar")} icon={<PiCalendarBlank />}>Content Calendar</ViewButton>
          )}
          {(employee.id === "marketing" || employee.id === "social-media") && (
            <ViewButton active={view === "campaign-files"} onClick={() => setView("campaign-files")} icon={<PiFolderOpen />}>Campaign Files</ViewButton>
          )}
          <ViewButton
            active={view === "soul"}
            onClick={() => setView("soul")}
            icon={<PiSparkle />}
          >
            Soul & Plan
          </ViewButton>
          <ViewButton
            active={view === "records"}
            onClick={() => setView("records")}
            icon={<PiFileText />}
          >
            Records
          </ViewButton>
          <ViewButton
            active={view === "memory"}
            onClick={() => setView("memory")}
            icon={<PiDatabase />}
          >
            Memory
          </ViewButton>
        </nav>
        <div className="window-controls">
          <button aria-label="Minimize employee" onClick={onMinimize}>
            <PiMinus />
          </button>
          <button aria-label="Maximize employee">
            <PiSquare />
          </button>
          <button aria-label="Close employee" onClick={onMinimize}>
            <PiX />
          </button>
        </div>
      </header>
      <div className="window-body">
        <EmployeeProfile employee={employee} online={online} />
        {view === "chat" ? (
          <div className="chat-panel">
            <div className="conversation-toolbar">
              <button
                className={historyOpen ? "active" : ""}
                aria-expanded={historyOpen}
                onClick={() => setHistoryOpen((open) => !open)}
              >
                <PiClockCounterClockwise />
                <span>Recent conversations</span>
                {conversations.length > 0 && <b>{conversations.length}</b>}
                <PiCaretRight />
              </button>
              <button
                aria-label={`Start a new ${employee.title} conversation`}
                title="New conversation"
                onClick={newConversation}
                disabled={busy}
              >
                <PiPlus />
              </button>
            </div>
            {historyOpen && (
              <section className="conversation-history-panel">
                <header>
                  <span>
                    <strong>{employee.title} conversations</strong>
                    <small>Continue with the full saved context</small>
                  </span>
                  <button
                    aria-label="Close conversation history"
                    onClick={() => setHistoryOpen(false)}
                  >
                    <PiX />
                  </button>
                </header>
                <div>
                  {historyLoading ? (
                    <p>
                      <PiCircleNotch className="spin" /> Loading conversations…
                    </p>
                  ) : conversations.length ? (
                    conversations.map((conversation) => (
                      <button
                        key={conversation.id}
                        className={
                          conversation.id === conversationId ? "active" : ""
                        }
                        onClick={() => void resumeConversation(conversation.id)}
                        disabled={busy}
                      >
                        <PiChatCircleText />
                        <span>
                          <strong>{conversation.title}</strong>
                          <small>{conversation.preview}</small>
                        </span>
                        <time>{formatRelative(conversation.lastActivity)}</time>
                        <PiCaretRight />
                      </button>
                    ))
                  ) : (
                    <p>No saved conversations with {employee.title} yet.</p>
                  )}
                </div>
                <footer>
                  <button onClick={newConversation}>
                    <PiPlus /> Start a new conversation
                  </button>
                </footer>
              </section>
            )}
            <div className="message-list" ref={scrollRef}>
              <div className="conversation-label">
                <PiUsersThree /> Customer inquiry <time>{formatTime()}</time>
              </div>
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={`message-row ${message.role}`}
                >
                  {message.role === "assistant" && (
                    <span className="message-avatar">
                      <img src={employee.avatar} alt="" />
                    </span>
                  )}
                  <div>
                    <b>
                      {message.role === "assistant" ? employee.title : "Owner"}
                    </b>
                    <p>
                      <SafeMessageText content={message.content} />
                      {message.pending && (
                        <PiCircleNotch className="spin inline-spinner" />
                      )}
                    </p>
                  </div>
                </article>
              ))}
              {error && (
                <div className="chat-error">
                  <PiWarning /> {error}
                </div>
              )}
            </div>
            <div className="suggested-area">
              <span>Suggested actions</span>
              <div>
                {employee.suggestedTasks.map((task, index) => (
                  <button
                    key={task.label}
                    onClick={() => void send(task.prompt)}
                    disabled={busy || !online}
                  >
                    {index === 0 ? <PiCalendarBlank /> : <PiUsersThree />}
                    <span>
                      <strong>{task.label}</strong>
                      <small>
                        {index === 0
                          ? "Creates a reviewable local artifact"
                          : "Gather the right details first"}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <form
              className="message-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={`Message ${employee.title}…`}
                rows={1}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <button type="button" aria-label="Attach local file">
                <PiPaperclip />
              </button>
              <button
                className="send-button"
                aria-label="Send message"
                disabled={!input.trim() || busy || !online}
              >
                {busy ? (
                  <PiCircleNotch className="spin" />
                ) : (
                  <PiPaperPlaneTilt />
                )}
              </button>
            </form>
          </div>
        ) : view === "ledger" && employee.id === "accounting" ? (
          <LedgerView />
        ) : view === "files" && employee.id === "sales" ? (
          <EmployeeFilesView employee={employee} />
        ) : view === "opportunities" && employee.id === "sales" ? (
          <SalesOpportunitiesView
            onDraft={(qualification) => {
              setView("chat");
              setInput(
                `Review sales qualification ${qualification.id} linked to public conversation ${qualification.conversationId}. Verify the linked Sales evidence, fill only confirmed qualification facts with propose_sales_qualification_update, and when it is proposal-ready use deliver_sales_proposal with complete customer-safe Markdown, an accurate public message, exact evidence paths, and an approval reason. Never infer custom pricing, promise availability, negotiate terms, or commit another department.`,
              );
            }}
            onOpenCrm={onOpenCrm}
          />
        ) : view === "map" && employee.id === "research" ? (
          <ResearchMapView
            refreshToken={actions
              .filter((action) => action.tool === "map_research_place")
              .map((action) => `${action.id}:${action.status}:${action.decidedAt ?? ""}`)
              .join("|")}
          />
        ) : view === "front-desk" && employee.id === "receptionist" ? (
          <FrontDeskView onOpenCrm={onOpenCrm} />
        ) : view === "cases" && employee.id === "customer-service" ? (
          <ServiceCasesView
            onDraft={(serviceCase) => {
              setView("chat");
              setInput(
                `Review service case ${serviceCase.id} linked to public conversation ${serviceCase.conversationId}. Use the case record and confirmed company policies to draft a concise customer-safe response, then call propose_case_reply with caseId ${serviceCase.id}, publicConversationId ${serviceCase.conversationId}, the complete reply, and a clear approval reason. Do not promise refunds, compensation, or policy exceptions.`,
              );
            }}
            onOpenCrm={onOpenCrm}
          />
        ) : view === "campaigns" && employee.id === "marketing" ? (
          <CampaignOperationsView mode="campaigns" onDraft={(campaign) => { setView("chat"); setInput(`Review campaign ${campaign.id}. Complete only verified strategy and evidence. When the campaign, posts, claims, alt text, and asset rights are ready, use approve_campaign_package with campaignId ${campaign.id} and a clear approval reason. Approval creates private brief and calendar PDFs; it never publishes externally.`); }} />
        ) : view === "content-calendar" && employee.id === "social-media" ? (
          <CampaignOperationsView mode="calendar" onDraft={(campaign) => { setView("chat"); setInput(`Review campaign ${campaign.id} and its canonical posts. Prepare channel-native copy, CTA, links, and alt text without inventing claims, permissions, pricing, urgency, or availability. Use approve_campaign_package only when every post and referenced asset is ready for owner approval.`); }} />
        ) : view === "campaign-files" && (employee.id === "marketing" || employee.id === "social-media") ? (
          <CampaignOperationsView mode="files" onDraft={(campaign) => { setView("chat"); setInput(`Review the canonical Campaign Files for campaign ${campaign.id}. Use uploaded and generated PDFs as private evidence and never claim external publication.`); }} />
        ) : (
          <RecordsView
            employee={employee}
            mode={
              view === "memory"
                ? "memory"
                : view === "soul"
                  ? "soul"
                  : "records"
            }
          />
        )}
      </div>
    </section>
  );
}

function ViewButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button className={active ? "active" : ""} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}

function EmployeeProfile({
  employee,
  online,
}: {
  employee: EmployeeDefinition;
  online: boolean;
}) {
  return (
    <aside className="employee-profile">
      <div className="profile-avatar">
        <img src={employee.avatar} alt={`${employee.title} AI employee`} />
        <i />
      </div>
      <h2>{employee.title}</h2>
      <span>AI Employee</span>
      <div className={`model-pill ${online ? "online" : "offline"}`}>
        <i /> Ollama · {online ? "Local" : "Offline"}
      </div>
      <p>{employee.tagline}</p>
      <div className="profile-separator" />
      <ul>
        <li>
          <PiLockKey /> Runs locally on your system
        </li>
        <li>
          <PiShieldCheck /> Your data stays private
        </li>
        <li>
          <PiDatabase /> Markdown source of truth
        </li>
      </ul>
    </aside>
  );
}

function FrontDeskView({ onOpenCrm }: { onOpenCrm: () => void }) {
  const [desk, setDesk] = useState<FrontDeskResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const load = async () => {
    setBusy(true);
    try {
      const next = await api.frontDesk();
      setDesk(next);
      setSelectedId((current) =>
        current && next.items.some((item) => item.id === current)
          ? current
          : (next.items[0]?.id ?? null),
      );
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Front Desk could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const selected = desk?.items.find((item) => item.id === selectedId);
  return (
    <section
      className="department-panel front-desk-panel"
      aria-label="Receptionist Front Desk"
    >
      <header>
        <div>
          <span>Shared client service</span>
          <h3>Front Desk</h3>
          <p>
            Inquiries, scheduling, callbacks, and owner confirmations from
            canonical records.
          </p>
        </div>
        <button onClick={() => void load()} disabled={busy}>
          <PiPulse className={busy ? "spin" : ""} /> Refresh
        </button>
      </header>
      {error ? (
        <div className="department-error" role="alert">
          <PiWarning />
          {error}
        </div>
      ) : (
        <>
          <div className="department-metrics">
            <article>
              <small>New inquiries</small>
              <strong>{desk?.summary.newInquiries ?? 0}</strong>
            </article>
            <article>
              <small>Qualification due</small>
              <strong>{desk?.summary.qualificationDue ?? 0}</strong>
            </article>
            <article>
              <small>Appointments</small>
              <strong>{desk?.summary.appointmentRequests ?? 0}</strong>
            </article>
            <article>
              <small>Owner review</small>
              <strong>{desk?.summary.ownerConfirmations ?? 0}</strong>
            </article>
          </div>
          <div className="department-split">
            <aside className="department-list">
              <header>
                <span>Live queue</span>
                <b>{desk?.items.length ?? 0}</b>
              </header>
              {busy && !desk ? (
                <p>
                  <PiCircleNotch className="spin" /> Loading Front Desk…
                </p>
              ) : desk?.items.length ? (
                desk.items.map((item) => (
                  <button
                    key={item.id}
                    className={`${selectedId === item.id ? "active" : ""} ${item.needsAttention ? "attention" : ""}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <i />
                    <span>
                      <strong>{item.customerName}</strong>
                      <small>{item.title}</small>
                      <em>
                        {item.kind.replaceAll("_", " ")} ·{" "}
                        {item.status.replaceAll("_", " ")}
                      </em>
                    </span>
                    <time>{formatRelative(item.updatedAt)}</time>
                  </button>
                ))
              ) : (
                <p>Front Desk is clear.</p>
              )}
            </aside>
            <article className="department-detail">
              {selected ? (
                <>
                  <header>
                    <span>
                      <small>{selected.kind.replaceAll("_", " ")}</small>
                      <h4>{selected.customerName}</h4>
                      <p>{selected.title}</p>
                    </span>
                    <b className={selected.needsAttention ? "attention" : ""}>
                      {selected.status.replaceAll("_", " ")}
                    </b>
                  </header>
                  <section>
                    <small>Current context</small>
                    <p>
                      {selected.summary || "No additional context recorded."}
                    </p>
                  </section>
                  <dl>
                    <div>
                      <dt>Conversation</dt>
                      <dd>{selected.conversationId ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Case</dt>
                      <dd>{selected.caseId ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Appointment</dt>
                      <dd>{selected.appointmentId ?? "—"}</dd>
                    </div>
                  </dl>
                  <footer>
                    <button className="primary-button" onClick={onOpenCrm}>
                      Open client operations <PiArrowRight />
                    </button>
                  </footer>
                </>
              ) : (
                <div className="department-empty">
                  <PiCalendarBlank />
                  <h4>No item selected</h4>
                  <p>New customer and scheduling activity will appear here.</p>
                </div>
              )}
            </article>
          </div>
        </>
      )}
    </section>
  );
}

function SalesOpportunitiesView({
  onDraft,
  onOpenCrm,
}: {
  onDraft: (qualification: SalesQualification) => void;
  onOpenCrm: () => void;
}) {
  const [data, setData] = useState<SalesOperationsResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [readinessFilter, setReadinessFilter] = useState("open");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [evidence, setEvidence] = useState({
    kind: "company" as "company" | "offer" | "sales_library",
    path: "company/SERVICES.md",
    label: "Confirmed service source",
    excerpt: "",
  });
  const load = async () => {
    setBusy(true);
    try {
      const next = await api.salesOperations();
      setData(next);
      setSelectedId((current) =>
        current && next.qualifications.some((item) => item.id === current)
          ? current
          : (next.qualifications[0]?.id ?? null),
      );
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Sales opportunities could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const qualifications = data?.qualifications ?? [];
  const visible = qualifications.filter(
    (item) =>
      readinessFilter === "all" ||
      (readinessFilter === "open" && item.readiness !== "closed") ||
      item.readiness === readinessFilter,
  );
  const selected = qualifications.find((item) => item.id === selectedId);
  const change = async (
    patch: Parameters<typeof api.updateSalesQualification>[1],
  ) => {
    if (!selected) return;
    setBusy(true);
    try {
      const updated = await api.updateSalesQualification(selected.id, patch);
      setData((current) =>
        current
          ? {
              ...current,
              qualifications: current.qualifications.map((item) =>
                item.id === updated.id ? updated : item,
              ),
            }
          : current,
      );
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The qualification could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="department-panel opportunities-panel"
      aria-label="Sales opportunities"
    >
      <header>
        <div>
          <span>Shared sales operations</span>
          <h3>Opportunities</h3>
          <p>
            Qualification gaps, verified evidence, discovery readiness, and
            owner-approved proposals.
          </p>
        </div>
        <button onClick={() => void load()} disabled={busy}>
          <PiPulse className={busy ? "spin" : ""} /> Refresh
        </button>
      </header>
      {error && (
        <div className="department-error" role="alert">
          <PiWarning />
          {error}
        </div>
      )}
      <div className="department-metrics">
        <article>
          <small>New / collecting</small>
          <strong>
            {(data?.summary.new ?? 0) + (data?.summary.collecting ?? 0)}
          </strong>
        </article>
        <article>
          <small>Discovery ready</small>
          <strong>{data?.summary.discoveryReady ?? 0}</strong>
        </article>
        <article>
          <small>Proposal ready</small>
          <strong>{data?.summary.proposalReady ?? 0}</strong>
        </article>
        <article>
          <small>Owner review</small>
          <strong>{data?.summary.ownerReview ?? 0}</strong>
        </article>
      </div>
      <div className="department-toolbar">
        <label>
          Readiness
          <select
            value={readinessFilter}
            onChange={(event) => setReadinessFilter(event.target.value)}
          >
            <option value="open">Open opportunities</option>
            <option value="all">All opportunities</option>
            <option value="new">New</option>
            <option value="collecting">Collecting</option>
            <option value="discovery_ready">Discovery ready</option>
            <option value="proposal_ready">Proposal ready</option>
            <option value="awaiting_owner">Owner review</option>
            <option value="proposal_delivered">Proposal delivered</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <span>
          {visible.length} opportunit{visible.length === 1 ? "y" : "ies"}
        </span>
      </div>
      <div className="department-split">
        <aside className="department-list">
          <header>
            <span>Opportunity queue</span>
            <b>{visible.length}</b>
          </header>
          {busy && !data ? (
            <p>
              <PiCircleNotch className="spin" /> Loading opportunities…
            </p>
          ) : visible.length ? (
            visible.map((item) => (
              <button
                key={item.id}
                className={`${selectedId === item.id ? "active" : ""} ${item.ownerAttention ? "attention" : ""}`}
                onClick={() => setSelectedId(item.id)}
              >
                <i className={item.ownerAttention ? "priority-high" : ""} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.serviceInterest || item.projectGoal}</small>
                  <em>
                    {item.readiness.replaceAll("_", " ")} ·{" "}
                    {item.missingInformation.length} gap
                    {item.missingInformation.length === 1 ? "" : "s"}
                  </em>
                </span>
                <time>{formatRelative(item.updatedAt)}</time>
              </button>
            ))
          ) : (
            <p>No opportunities match this filter.</p>
          )}
        </aside>
        <article className="department-detail opportunity-detail">
          {selected ? (
            <>
              <header>
                <span>
                  <small>Qualification {selected.id}</small>
                  <h4>{selected.title}</h4>
                  <p>
                    {selected.projectGoal ||
                      "The project goal has not been established."}
                  </p>
                </span>
                <b className={selected.ownerAttention ? "attention" : ""}>
                  {selected.readiness.replaceAll("_", " ")}
                </b>
              </header>
              <div className="case-controls">
                <label>
                  Readiness
                  <select
                    aria-label="Qualification readiness"
                    value={selected.readiness}
                    onChange={(event) =>
                      void change({
                        readiness: event.target
                          .value as SalesQualification["readiness"],
                      })
                    }
                    disabled={busy}
                  >
                    <option value="new">New</option>
                    <option value="collecting">Collecting</option>
                    <option value="discovery_ready">Discovery ready</option>
                    <option value="proposal_ready">Proposal ready</option>
                    <option value="awaiting_owner">Owner review</option>
                    <option value="proposal_delivered">
                      Proposal delivered
                    </option>
                    <option value="closed">Closed</option>
                  </select>
                </label>
                <label>
                  Budget state
                  <select
                    aria-label="Budget state"
                    value={selected.budgetState}
                    onChange={(event) =>
                      void change({
                        budgetState: event.target
                          .value as SalesQualification["budgetState"],
                      })
                    }
                    disabled={busy}
                  >
                    <option value="unknown">Unknown</option>
                    <option value="provided">Provided</option>
                    <option value="declined">Declined</option>
                  </select>
                </label>
              </div>
              <section>
                <small>Qualification facts</small>
                <dl>
                  <div>
                    <dt>Service</dt>
                    <dd>{selected.serviceInterest || "Not established"}</dd>
                  </div>
                  <div>
                    <dt>Deliverables</dt>
                    <dd>
                      {selected.deliverables.join(", ") || "Not established"}
                    </dd>
                  </div>
                  <div>
                    <dt>Timing</dt>
                    <dd>{selected.targetTiming || "Not established"}</dd>
                  </div>
                  <div>
                    <dt>Location</dt>
                    <dd>{selected.location || "Not established"}</dd>
                  </div>
                  <div>
                    <dt>Decision maker</dt>
                    <dd>{selected.decisionMakerState.replaceAll("_", " ")}</dd>
                  </div>
                </dl>
              </section>
              <section className="case-private">
                <small>
                  <PiLockKey /> Private readiness gaps
                </small>
                <p>
                  {selected.missingInformation.join(" · ") ||
                    "No required qualification gaps."}
                </p>
                {selected.ownerAttentionReasons.length > 0 && (
                  <p className="attention-copy">
                    Owner attention:{" "}
                    {selected.ownerAttentionReasons.join(" · ")}
                  </p>
                )}
              </section>
              <section>
                <small>Verified Sales evidence</small>
                {selected.evidence.length ? (
                  <div className="sales-evidence-list">
                    {selected.evidence.map((item) => (
                      <span key={item.id}>
                        <strong>{item.label}</strong>
                        <code>{item.path}</code>
                        <small>
                          {item.excerpt || item.kind.replaceAll("_", " ")}
                        </small>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p>No evidence linked yet.</p>
                )}
                <form
                  className="sales-evidence-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void change({
                      evidence: [
                        ...selected.evidence.map(
                          ({ kind, path, label, excerpt }) => ({
                            kind,
                            path,
                            label,
                            excerpt,
                          }),
                        ),
                        evidence,
                      ],
                    });
                  }}
                >
                  <select
                    aria-label="Evidence kind"
                    value={evidence.kind}
                    onChange={(event) =>
                      setEvidence({
                        ...evidence,
                        kind: event.target.value as typeof evidence.kind,
                      })
                    }
                  >
                    <option value="company">Company record</option>
                    <option value="offer">Offer source</option>
                    <option value="sales_library">Sales library</option>
                  </select>
                  <input
                    aria-label="Evidence path"
                    value={evidence.path}
                    onChange={(event) =>
                      setEvidence({ ...evidence, path: event.target.value })
                    }
                    placeholder="company/SERVICES.md"
                  />
                  <input
                    aria-label="Evidence label"
                    value={evidence.label}
                    onChange={(event) =>
                      setEvidence({ ...evidence, label: event.target.value })
                    }
                    placeholder="Source label"
                  />
                  <input
                    aria-label="Evidence excerpt"
                    value={evidence.excerpt}
                    onChange={(event) =>
                      setEvidence({ ...evidence, excerpt: event.target.value })
                    }
                    placeholder="Exact excerpt (optional)"
                  />
                  <button
                    disabled={
                      busy || !evidence.path.trim() || !evidence.label.trim()
                    }
                  >
                    <PiPlus /> Link evidence
                  </button>
                </form>
              </section>
              <section className="case-timeline">
                <small>Opportunity timeline</small>
                {selected.events
                  .slice()
                  .reverse()
                  .map((item) => (
                    <div key={item.id}>
                      <i />
                      <span>
                        <strong>{item.summary}</strong>
                        <p>{item.detail}</p>
                        <time>
                          {formatRelative(item.createdAt)} · {item.actor}
                        </time>
                      </span>
                    </div>
                  ))}
              </section>
              <footer>
                <button
                  className="primary-button"
                  onClick={() => onDraft(selected)}
                >
                  Prepare approved proposal
                </button>
                <button onClick={onOpenCrm}>Open CRM</button>
              </footer>
            </>
          ) : (
            <div className="department-empty">
              <PiBriefcase />
              <h4>No opportunity selected</h4>
              <p>Sales-routed inquiries will appear here automatically.</p>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}

function ServiceCasesView({
  onDraft,
  onOpenCrm,
}: {
  onDraft: (serviceCase: ServiceCase) => void;
  onOpenCrm: () => void;
}) {
  const [cases, setCases] = useState<ServiceCase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("open");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const load = async () => {
    setBusy(true);
    try {
      const next = await api.serviceCases();
      setCases(next);
      setSelectedId((current) =>
        current && next.some((item) => item.id === current)
          ? current
          : (next[0]?.id ?? null),
      );
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Service cases could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const openStatuses: ServiceCase["status"][] = [
    "new",
    "investigating",
    "awaiting_owner",
    "awaiting_customer",
  ];
  const visible = cases.filter(
    (item) =>
      (statusFilter === "all" ||
        (statusFilter === "open" && openStatuses.includes(item.status)) ||
        item.status === statusFilter) &&
      (priorityFilter === "all" || item.priority === priorityFilter),
  );
  const selected = cases.find((item) => item.id === selectedId);
  const change = async (
    patch: Partial<
      Pick<
        ServiceCase,
        "status" | "priority" | "category" | "nextStep" | "internalNotes"
      >
    >,
  ) => {
    if (!selected) return;
    setBusy(true);
    try {
      const updated = await api.updateServiceCase(selected.id, patch);
      setCases((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The case could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="department-panel cases-panel"
      aria-label="Customer Service cases"
    >
      <header>
        <div>
          <span>Shared client service</span>
          <h3>Cases</h3>
          <p>
            Private triage, evidence, escalation, approved replies, and
            resolution history.
          </p>
        </div>
        <button onClick={() => void load()} disabled={busy}>
          <PiPulse className={busy ? "spin" : ""} /> Refresh
        </button>
      </header>
      {error && (
        <div className="department-error" role="alert">
          <PiWarning />
          {error}
        </div>
      )}
      <div className="department-metrics">
        <article>
          <small>Open cases</small>
          <strong>
            {cases.filter((item) => openStatuses.includes(item.status)).length}
          </strong>
        </article>
        <article>
          <small>Owner review</small>
          <strong>
            {cases.filter((item) => item.status === "awaiting_owner").length}
          </strong>
        </article>
        <article>
          <small>High / urgent</small>
          <strong>
            {
              cases.filter(
                (item) =>
                  ["high", "urgent"].includes(item.priority) &&
                  openStatuses.includes(item.status),
              ).length
            }
          </strong>
        </article>
        <article>
          <small>Resolved</small>
          <strong>
            {cases.filter((item) => item.status === "resolved").length}
          </strong>
        </article>
      </div>
      <div className="department-toolbar">
        <label>
          Status
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="open">Open cases</option>
            <option value="all">All cases</option>
            <option value="awaiting_owner">Owner review</option>
            <option value="awaiting_customer">Waiting on customer</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <label>
          Priority
          <select
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value)}
          >
            <option value="all">All priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </label>
        <span>
          {visible.length} case{visible.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="department-split">
        <aside className="department-list">
          <header>
            <span>Case queue</span>
            <b>{visible.length}</b>
          </header>
          {busy && !cases.length ? (
            <p>
              <PiCircleNotch className="spin" /> Loading cases…
            </p>
          ) : visible.length ? (
            visible.map((item) => (
              <button
                key={item.id}
                className={`${selectedId === item.id ? "active" : ""} ${item.status === "awaiting_owner" ? "attention" : ""}`}
                onClick={() => setSelectedId(item.id)}
              >
                <i className={`priority-${item.priority}`} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.summary}</small>
                  <em>
                    {item.category.replaceAll("_", " ")} ·{" "}
                    {item.status.replaceAll("_", " ")}
                  </em>
                </span>
                <time>{formatRelative(item.updatedAt)}</time>
              </button>
            ))
          ) : (
            <p>No cases match these filters.</p>
          )}
        </aside>
        <article className="department-detail case-detail">
          {selected ? (
            <>
              <header>
                <span>
                  <small>Case {selected.id}</small>
                  <h4>{selected.title}</h4>
                  <p>{selected.summary}</p>
                </span>
                <b
                  className={
                    selected.status === "awaiting_owner" ? "attention" : ""
                  }
                >
                  {selected.status.replaceAll("_", " ")}
                </b>
              </header>
              <div className="case-controls">
                <label>
                  Status
                  <select
                    aria-label="Case status"
                    value={selected.status}
                    onChange={(event) =>
                      void change({
                        status: event.target.value as ServiceCase["status"],
                      })
                    }
                    disabled={busy}
                  >
                    <option value="new">New</option>
                    <option value="investigating">Investigating</option>
                    <option value="awaiting_owner">Owner review</option>
                    <option value="awaiting_customer">
                      Waiting on customer
                    </option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                  </select>
                </label>
                <label>
                  Priority
                  <select
                    aria-label="Case priority"
                    value={selected.priority}
                    onChange={(event) =>
                      void change({
                        priority: event.target.value as ServiceCase["priority"],
                      })
                    }
                    disabled={busy}
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </label>
              </div>
              <section>
                <small>Desired outcome</small>
                <p>{selected.desiredOutcome || "Not recorded."}</p>
              </section>
              <section>
                <small>Next step</small>
                <p>{selected.nextStep || "Not recorded."}</p>
              </section>
              <section className="case-private">
                <small>
                  <PiLockKey /> Internal notes
                </small>
                <p>{selected.internalNotes || "No internal notes."}</p>
              </section>
              <section className="case-timeline">
                <small>Case timeline</small>
                {selected.events
                  .slice()
                  .reverse()
                  .map((item) => (
                    <div key={item.id}>
                      <i />
                      <span>
                        <strong>{item.summary}</strong>
                        <p>{item.detail}</p>
                        <time>
                          {formatRelative(item.createdAt)} · {item.actor}
                        </time>
                      </span>
                    </div>
                  ))}
              </section>
              <footer>
                <button
                  className="primary-button"
                  onClick={() => onDraft(selected)}
                >
                  Draft approved reply
                </button>
                <button onClick={onOpenCrm}>Open CRM</button>
              </footer>
            </>
          ) : (
            <div className="department-empty">
              <PiShieldCheck />
              <h4>No case selected</h4>
              <p>Routed customer-care issues will appear here automatically.</p>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}

function RecordsView({
  employee,
  mode,
}: {
  employee: EmployeeDefinition;
  mode: "records" | "memory" | "soul";
}) {
  const [files, setFiles] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(
    mode === "memory"
      ? `employees/${employee.id}/MEMORY.md`
      : mode === "soul"
        ? `employees/${employee.id}/SOUL.md`
        : null,
  );
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    const load = async () => {
      setBusy(true);
      const next = await api.employeeFiles(employee.id);
      const visible =
        mode === "memory"
          ? next.filter((file) => file.endsWith("MEMORY.md"))
          : mode === "soul"
            ? next.filter(
                (file) => file.endsWith("SOUL.md") || file.endsWith("PLAN.md"),
              )
            : next.filter(
                (file) =>
                  !file.endsWith("EMPLOYEE.md") &&
                  !file.endsWith("MEMORY.md") &&
                  !file.endsWith("SOUL.md") &&
                  !file.endsWith("PLAN.md"),
              );
      setFiles(visible);
      const first =
        mode === "memory"
          ? `employees/${employee.id}/MEMORY.md`
          : mode === "soul"
            ? `employees/${employee.id}/SOUL.md`
            : (visible[0] ?? null);
      setActive(first);
      try {
        setContent(first ? (await api.file(first)).content : "No records yet.");
      } catch {
        setContent("No records yet.");
      }
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
        <header>
          <PiFolderOpen />{" "}
          {mode === "memory"
            ? "Curated memory"
            : mode === "soul"
              ? "Soul & operating plan"
              : "Employee records"}
        </header>
        {files.length ? (
          files.map((file) => (
            <button
              key={file}
              className={file === active ? "active" : ""}
              onClick={() => void open(file)}
            >
              <PiFileText />
              <span>{file.split("/").at(-1)}</span>
              <PiCaretRight />
            </button>
          ))
        ) : (
          <p>No records yet. Start a conversation or approve an action.</p>
        )}
      </aside>
      <article>
        {busy ? <PiCircleNotch className="spin" /> : <pre>{content}</pre>}
      </article>
    </div>
  );
}

function CampaignOperationsView({ mode, onDraft }: { mode: "campaigns" | "calendar" | "files"; onDraft: (campaign: Campaign) => void }) {
  const [data, setData] = useState<CampaignOperationsResponse | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [assetFile, setAssetFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfKind, setPdfKind] = useState<CampaignFile["kind"]>("external_brief");
  const [draft, setDraft] = useState({ title: "", objective: "", audience: "", callToAction: "" });
  const [postDraft, setPostDraft] = useState({ platform: "Instagram", plannedAt: "", objective: "", copy: "", callToAction: "", altText: "" });
  const refresh = useCallback(async () => {
    try { const next = await api.campaignOperations(); setData(next); setSelectedId((current) => current || next.campaigns[0]?.id || ""); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Campaign Operations could not be loaded."); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const selected = data?.campaigns.find((item) => item.id === selectedId) ?? data?.campaigns[0];
  const posts = (data?.posts ?? []).filter((item) => item.campaignId === selected?.id && (filter === "all" || item.platform === filter));
  const assets = (data?.assets ?? []).filter((item) => item.campaignId === selected?.id);
  const files = (data?.files ?? []).filter((item) => item.campaignId === selected?.id);
  const platforms = [...new Set((data?.posts ?? []).filter((item) => item.campaignId === selected?.id).map((item) => item.platform))];
  const run = async (work: () => Promise<unknown>) => { setBusy(true); setError(""); try { await work(); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "The campaign operation failed."); } finally { setBusy(false); } };
  const createCampaign = () => void run(async () => { const created = await api.createCampaign(draft); setSelectedId(created.id); setDraft({ title: "", objective: "", audience: "", callToAction: "" }); });
  const createPost = () => selected && void run(async () => { await api.createCampaignPost(selected.id, { ...postDraft, plannedAt: postDraft.plannedAt || null }); setPostDraft({ platform: "Instagram", plannedAt: "", objective: "", copy: "", callToAction: "", altText: "" }); });
  return (
    <section className="department-panel campaign-panel" role="region" aria-label={mode === "campaigns" ? "Marketing campaigns" : mode === "calendar" ? "Social Media content calendar" : "Campaign files"}>
      <header><div><span>{mode === "files" ? "PRIVATE CAMPAIGN LIBRARY" : "SHARED CAMPAIGN OPERATIONS"}</span><h3>{mode === "campaigns" ? "Campaigns" : mode === "calendar" ? "Content Calendar" : "Campaign Files"}</h3><p>{mode === "files" ? "Generated briefs, calendars, and owner-uploaded campaign PDFs." : "Strategy, channel execution, asset rights, and approval readiness."}</p></div><button className="crm-secondary" onClick={() => void refresh()} disabled={busy}><PiClockCounterClockwise /> Refresh</button></header>
      {error && <p className="public-error" role="alert">{error}</p>}
      <div className="department-metrics"><article><small>Planning</small><strong>{data?.summary.draft ?? 0}</strong></article><article><small>Owner review</small><strong>{data?.summary.awaitingOwner ?? 0}</strong></article><article><small>Publish ready</small><strong>{data?.summary.publishReadyPosts ?? 0}</strong></article><article><small>Rights attention</small><strong>{data?.summary.missingRights ?? 0}</strong></article></div>
      {mode === "campaigns" && <div className="campaign-create"><input aria-label="New campaign title" placeholder="Campaign title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}/><input aria-label="Campaign objective" placeholder="Objective" value={draft.objective} onChange={(e) => setDraft({ ...draft, objective: e.target.value })}/><input aria-label="Campaign audience" placeholder="Audience" value={draft.audience} onChange={(e) => setDraft({ ...draft, audience: e.target.value })}/><input aria-label="Campaign call to action" placeholder="Call to action" value={draft.callToAction} onChange={(e) => setDraft({ ...draft, callToAction: e.target.value })}/><button className="crm-primary" disabled={busy || !draft.title.trim()} onClick={createCampaign}><PiPlus /> Create campaign</button></div>}
      <div className="department-toolbar"><label>Campaign<select aria-label="Campaign selection" value={selected?.id ?? ""} onChange={(e) => setSelectedId(e.target.value)}>{(data?.campaigns ?? []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>{mode === "calendar" && <label>Platform<select aria-label="Content platform filter" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All platforms</option>{platforms.map((item) => <option key={item}>{item}</option>)}</select></label>}<span>{selected ? `Version ${selected.version} · ${selected.status.replaceAll("_", " ")}` : "Create a campaign to begin"}</span></div>
      {selected && mode === "campaigns" && <div className="department-split"><aside className="department-list">{data?.campaigns.map((campaign) => <button className={campaign.id === selected.id ? "active" : ""} key={campaign.id} onClick={() => setSelectedId(campaign.id)}><strong>{campaign.title}</strong><small>{campaign.businessLine}</small><em>{campaign.status.replaceAll("_", " ")}</em></button>)}</aside><article className="department-detail campaign-detail"><span>CAMPAIGN {selected.id.toUpperCase()}</span><h3>{selected.title}</h3><p>{selected.objective || "Objective not established."}</p><div className="case-facts"><span><small>Audience</small><strong>{selected.audience || "Not established"}</strong></span><span><small>Offer</small><strong>{selected.offer || "Not established"}</strong></span><span><small>Channels</small><strong>{selected.channels.join(", ") || "Not established"}</strong></span><span><small>CTA</small><strong>{selected.callToAction || "Not established"}</strong></span></div>{selected.ownerAttention && <div className="owner-attention"><PiWarning /><div><strong>Owner attention</strong>{selected.ownerAttentionReasons.map((item) => <p key={item}>{item}</p>)}</div></div>}<section><h4>Campaign assets</h4><div className="campaign-upload"><input type="file" accept=".pdf,.png,.jpg,.jpeg" aria-label="Choose campaign asset" onChange={(e) => setAssetFile(e.target.files?.[0] ?? null)}/><button disabled={!assetFile || busy} onClick={() => assetFile && void run(async () => { await uploadCampaignAsset(selected.id, assetFile); setAssetFile(null); })}><PiPaperclip /> Upload asset</button></div>{assets.map((asset) => <article className="campaign-asset" key={asset.id}><div><strong>{asset.name}</strong><small>{asset.approvalStatus} · {asset.checksum.slice(0, 10)}</small></div><input aria-label={`Usage rights for ${asset.name}`} placeholder="Usage rights" defaultValue={asset.usageRights} onBlur={(e) => e.target.value !== asset.usageRights && void run(() => api.updateCampaignAsset(selected.id, asset.id, { usageRights: e.target.value }))}/><select aria-label={`Approval for ${asset.name}`} value={asset.approvalStatus} onChange={(e) => void run(() => api.updateCampaignAsset(selected.id, asset.id, { approvalStatus: e.target.value as typeof asset.approvalStatus }))}><option value="supplied">Supplied</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></article>)}</section><button className="crm-primary" onClick={() => onDraft(selected)}><PiShieldCheck /> Prepare approval package</button></article></div>}
      {selected && mode === "calendar" && <div className="campaign-calendar"><div className="campaign-post-create"><input aria-label="Post platform" value={postDraft.platform} onChange={(e) => setPostDraft({ ...postDraft, platform: e.target.value })}/><input aria-label="Post planned date" type="datetime-local" value={postDraft.plannedAt} onChange={(e) => setPostDraft({ ...postDraft, plannedAt: e.target.value })}/><input aria-label="Post objective" placeholder="Objective" value={postDraft.objective} onChange={(e) => setPostDraft({ ...postDraft, objective: e.target.value })}/><textarea aria-label="Post copy" placeholder="Post copy" value={postDraft.copy} onChange={(e) => setPostDraft({ ...postDraft, copy: e.target.value })}/><input aria-label="Post call to action" placeholder="CTA" value={postDraft.callToAction} onChange={(e) => setPostDraft({ ...postDraft, callToAction: e.target.value })}/><input aria-label="Post alt text" placeholder="Alt text" value={postDraft.altText} onChange={(e) => setPostDraft({ ...postDraft, altText: e.target.value })}/><button className="crm-primary" disabled={!postDraft.platform || busy} onClick={createPost}><PiPlus /> Add post</button></div><div className="campaign-post-grid">{posts.map((post) => { const revision = post.revisions.find((item) => item.revision === post.currentRevision)!; return <article key={post.id}><header><span>{post.platform}</span><em>{post.status.replaceAll("_", " ")}</em></header><time>{post.plannedAt ? new Date(post.plannedAt).toLocaleString() : "Unscheduled"}</time><strong>{post.objective || "Campaign post"}</strong><p>{revision.copy || "No copy drafted."}</p><small>ALT · {revision.altText || "Missing"}</small>{post.ownerAttention && <b><PiWarning /> Owner attention</b>}</article>; })}</div><button className="crm-primary" onClick={() => onDraft(selected)}><PiShieldCheck /> Prepare approval package</button></div>}
      {selected && mode === "files" && <div className="campaign-files"><div className="campaign-upload pdf-upload"><input type="file" accept="application/pdf,.pdf" aria-label="Choose campaign PDF" onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}/><select aria-label="Campaign PDF kind" value={pdfKind} onChange={(e) => setPdfKind(e.target.value as CampaignFile["kind"])}><option value="external_brief">External brief</option><option value="media_plan">Media plan</option><option value="report">Report</option><option value="other">Other</option></select><button disabled={!pdfFile || busy} onClick={() => pdfFile && void run(async () => { await uploadCampaignPdf(selected.id, pdfKind, "Owner-uploaded campaign document", pdfFile); setPdfFile(null); })}><PiPaperclip /> Upload PDF</button></div><div className="campaign-file-grid">{files.map((file) => <article key={file.id}><PiFileText /><div><strong>{file.name}</strong><small>{file.kind.replaceAll("_", " ")} · v{file.version} · {file.source}</small><span>{file.status} · {file.checksum.slice(0, 12)}</span></div><a href={`/api/admin/campaign-files/${encodeURIComponent(file.id)}/open`} target="_blank" rel="noreferrer">Open</a><a href={`/api/admin/campaign-files/${encodeURIComponent(file.id)}/open?download=1`}>Download</a></article>)}</div></div>}
    </section>
  );
}

function LedgerView() {
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setBusy(true);
    try {
      setLedger(await api.ledger());
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The ledger could not be loaded.",
      );
    } finally {
      if (!quiet) setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 10_000);
    return () => window.clearInterval(timer);
  }, [load]);
  const entries = useMemo(
    () =>
      ledger?.entries.filter((entry) => {
        const matchesQuery =
          !query.trim() ||
          Object.values(entry).some((value) =>
            String(value).toLowerCase().includes(query.trim().toLowerCase()),
          );
        const matchesType =
          type === "all" ||
          (type === "review"
            ? entry.needsReview
            : entry.type.toLowerCase().includes(type));
        return matchesQuery && matchesType;
      }) ?? [],
    [ledger, query, type],
  );
  const money = (value: number | null) =>
    value === null
      ? "—"
      : new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: ledger?.currency ?? "USD",
        }).format(value);
  return (
    <section className="ledger-panel" aria-label="Accounting ledger">
      <header>
        <div>
          <span>Controlled finance record</span>
          <h3>Transaction ledger</h3>
          <p>
            Read-only live view of{" "}
            <code>{ledger?.source ?? "company/finance/transactions.csv"}</code>
          </p>
        </div>
        <button onClick={() => void load()} disabled={busy}>
          <PiPulse className={busy ? "spin" : ""} /> Refresh
        </button>
      </header>
      {error ? (
        <div className="ledger-error">
          <PiWarning />
          {error}
        </div>
      ) : busy && !ledger ? (
        <div className="ledger-loading">
          <PiCircleNotch className="spin" /> Loading ledger…
        </div>
      ) : (
        <>
          <div className="ledger-metrics">
            <article>
              <small>Total income</small>
              <strong>{money(ledger?.summary.income ?? 0)}</strong>
            </article>
            <article>
              <small>Total expenses</small>
              <strong>{money(ledger?.summary.expenses ?? 0)}</strong>
            </article>
            <article>
              <small>Net cash movement</small>
              <strong>{money(ledger?.summary.net ?? 0)}</strong>
            </article>
            <article>
              <small>Needs review</small>
              <strong>{ledger?.summary.needsReview ?? 0}</strong>
            </article>
          </div>
          <div className="ledger-toolbar">
            <label>
              <PiMagnifyingGlass />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search transactions…"
              />
            </label>
            <select
              aria-label="Filter ledger entries"
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              <option value="all">All entries</option>
              <option value="income">Income</option>
              <option value="expense">Expenses</option>
              <option value="fee">Fees</option>
              <option value="review">Needs review</option>
            </select>
            <span>
              {entries.length} of {ledger?.summary.transactionCount ?? 0}{" "}
              entries · Updated{" "}
              {ledger
                ? new Date(ledger.modifiedAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                    second: "2-digit",
                  })
                : "—"}
            </span>
          </div>
          <div className="ledger-table-wrap">
            {entries.length ? (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Transaction</th>
                    <th>Type</th>
                    <th>Business / project</th>
                    <th>Party</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, index) => (
                    <tr
                      key={`${entry.transactionId}-${index}`}
                      className={entry.needsReview ? "needs-review" : ""}
                    >
                      <td>{entry.date || "—"}</td>
                      <td>
                        <strong>{entry.transactionId || "Missing ID"}</strong>
                        <small>
                          {entry.description ||
                            entry.sourceReference ||
                            "No description"}
                        </small>
                      </td>
                      <td>{entry.type || "—"}</td>
                      <td>
                        <strong>{entry.businessLine || "—"}</strong>
                        <small>{entry.project}</small>
                      </td>
                      <td>{entry.party || "—"}</td>
                      <td>{entry.category || "Uncategorized"}</td>
                      <td>
                        <span>
                          {entry.needsReview
                            ? "Needs review"
                            : entry.status || "Recorded"}
                        </span>
                      </td>
                      <td>
                        {money(entry.amount)}
                        {entry.grossAmount !== null && (
                          <small>
                            Gross {money(entry.grossAmount)} · Fee{" "}
                            {money(Math.abs(entry.fee ?? 0))}
                          </small>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="ledger-empty">
                <PiDatabase />
                <h4>No ledger entries to display</h4>
                <p>
                  {ledger?.summary.transactionCount
                    ? "No transactions match the current filters."
                    : "The controlled transactions CSV currently contains its header but no posted entries. Approved tasks do not change the ledger until a separate ledger update is proposed and approved."}
                </p>
              </div>
            )}
          </div>
          <footer>
            <PiShieldCheck /> Ledger changes remain approval-gated. This view
            refreshes automatically every 10 seconds.
          </footer>
        </>
      )}
    </section>
  );
}

function EmployeeFilesView({ employee }: { employee: EmployeeDefinition }) {
  const [files, setFiles] = useState<EmployeeFile[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setFiles(await api.employeeLibrary(employee.id));
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The employee library could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  }, [employee.id]);
  useEffect(() => {
    void load();
  }, [load]);
  const upload = async () => {
    if (!selectedFile) return;
    if (selectedFile.size > 10_000_000) {
      setError("Employee files must be 10 MB or smaller.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      await uploadEmployeeFile(employee.id, selectedFile);
      setSelectedFile(null);
      if (fileInput.current) fileInput.current.value = "";
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The file could not be uploaded.",
      );
    } finally {
      setUploading(false);
    }
  };
  const fileUrl = (file: EmployeeFile, download = false) =>
    `/api/employee-files/${encodeURIComponent(employee.id)}/open?path=${encodeURIComponent(file.path)}${download ? "&download=1" : ""}`;
  return (
    <section
      className="employee-files-panel"
      aria-label={`${employee.title} employee files`}
    >
      <header>
        <div>
          <span>Private team library</span>
          <h3>Employee files & documents</h3>
          <p>
            Shared reference material for authenticated human employees and the
            Sales AI employee.
          </p>
        </div>
        <button onClick={() => void load()} disabled={busy}>
          <PiPulse className={busy ? "spin" : ""} /> Refresh
        </button>
      </header>
      <div className="employee-files-access">
        <PiShieldCheck />
        <span>
          <strong>Team access</strong>
          <small>
            Visible only inside the private AI Operating System. Agent-readable
            companions are indexed locally.
          </small>
        </span>
      </div>
      <div className="employee-file-upload">
        <label>
          <PiPlus />
          <span>
            <strong>
              {selectedFile ? selectedFile.name : "Add an employee file"}
            </strong>
            <small>
              {selectedFile
                ? `${(selectedFile.size / 1024).toFixed(0)} KB selected`
                : "PDF, Word, text, Markdown, CSV, Excel, PNG, or JPEG · 10 MB maximum"}
            </small>
          </span>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.docx,.txt,.md,.csv,.xlsx,.png,.jpg,.jpeg"
            onChange={(event) =>
              setSelectedFile(event.target.files?.[0] ?? null)
            }
          />
        </label>
        <button
          disabled={!selectedFile || uploading}
          onClick={() => void upload()}
        >
          {uploading ? <PiCircleNotch className="spin" /> : <PiArrowRight />}{" "}
          Upload to Sales
        </button>
      </div>
      {error ? (
        <div className="ledger-error">
          <PiWarning />
          {error}
        </div>
      ) : busy ? (
        <div className="ledger-loading">
          <PiCircleNotch className="spin" /> Loading employee files…
        </div>
      ) : files.length ? (
        <div className="employee-file-grid">
          {files.map((file) => (
            <article key={file.path}>
              <div className={`employee-file-icon ${file.kind.toLowerCase()}`}>
                <PiFileText />
                <b>{file.kind}</b>
              </div>
              <div>
                <h4>{file.name}</h4>
                <p>
                  {file.kind} · {(file.size / 1024).toFixed(0)} KB · Updated{" "}
                  {new Date(file.modifiedAt).toLocaleDateString()}
                </p>
                {file.agentReadable && (
                  <span>
                    <PiDatabase /> Sales agent can search this document
                  </span>
                )}
              </div>
              <footer>
                <a href={fileUrl(file)} target="_blank" rel="noreferrer">
                  Open document <PiArrowRight />
                </a>
                <a href={fileUrl(file, true)}>Download</a>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <div className="ledger-empty">
          <PiFolderOpen />
          <h4>No employee files yet</h4>
          <p>Owner-provided Sales documents will appear here.</p>
        </div>
      )}
      <footer>
        <PiLockKey /> Human employees must sign in through Team access. Public
        concierge visitors cannot access this library.
      </footer>
    </section>
  );
}

const emptyResearchPlace: ResearchPlaceInput = {
  name: "",
  kind: "business",
  status: "prospect",
  address: "",
  latitude: 0,
  longitude: 0,
  phone: "",
  website: "",
  contactName: "",
  opportunity: "",
  notes: "",
  sourceUrls: [],
};

function ResearchMapBounds({ places }: { places: ResearchPlace[] }) {
  const map = useMap();
  useEffect(() => {
    if (!places.length) return;
    if (places.length === 1)
      map.setView([places[0].latitude, places[0].longitude], 13);
    else
      map.fitBounds(
        places.map(
          (place) => [place.latitude, place.longitude] as [number, number],
        ),
        { padding: [34, 34], maxZoom: 13 },
      );
  }, [map, places]);
  return null;
}

function ResearchMapView({ refreshToken }: { refreshToken: string }) {
  const [places, setPlaces] = useState<ResearchPlace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<ResearchPlaceInput>(emptyResearchPlace);
  const [geocode, setGeocode] = useState<GeocodeResult[]>([]);
  const [recipientPhone, setRecipientPhone] = useState("");
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const next = await api.researchPlaces();
      setPlaces(next);
      setSelectedId((current) => current ?? next[0]?.id ?? null);
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The research map could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, refreshToken]);
  const visible = useMemo(
    () =>
      places.filter(
        (place) =>
          (status === "all" || place.status === status) &&
          (!query.trim() ||
            `${place.name} ${place.address} ${place.opportunity}`
              .toLowerCase()
              .includes(query.toLowerCase())),
      ),
    [places, query, status],
  );
  const selected = places.find((place) => place.id === selectedId) ?? null;
  const locate = async () => {
    try {
      setGeocode(
        await api.geocodeResearchPlace(`${form.name} ${form.address}`.trim()),
      );
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "That location could not be found.",
      );
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      const place = await api.saveResearchPlace(form);
      await load();
      setSelectedId(place.id);
      setForm(emptyResearchPlace);
      setGeocode([]);
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The organization could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };
  const edit = (place: ResearchPlace) =>
    setForm({
      id: place.id,
      name: place.name,
      kind: place.kind,
      status: place.status,
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
      phone: place.phone,
      website: place.website,
      contactName: place.contactName,
      opportunity: place.opportunity,
      notes: place.notes,
      sourceUrls: place.sourceUrls,
    });
  const directionsUrl = selected
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selected.address || `${selected.latitude},${selected.longitude}`)}`
    : "";
  const smsBody = selected
    ? `Directions to ${selected.name}: ${directionsUrl}`
    : "";
  const smsUrl = `sms:${recipientPhone.replace(/[^+\d]/g, "")}?&body=${encodeURIComponent(smsBody)}`;
  return (
    <section className="research-map-panel" aria-label="Research prospect map">
      <header>
        <div>
          <span>Private geographic intelligence</span>
          <h3>Organizations & opportunities</h3>
          <p>
            Research-backed prospects, active relationships, partners, venues,
            and vendors.
          </p>
        </div>
        <button onClick={() => void load()} disabled={busy}>
          <PiPulse className={busy ? "spin" : ""} /> Refresh
        </button>
      </header>
      {error && (
        <div className="ledger-error">
          <PiWarning />
          {error}
        </div>
      )}
      <div className="research-map-toolbar">
        <label>
          <PiMagnifyingGlass />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search mapped organizations…"
          />
        </label>
        <select
          aria-label="Filter research map status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">All relationships</option>
          <option value="prospect">Prospects</option>
          <option value="researching">Researching</option>
          <option value="contacted">Contacted</option>
          <option value="active">Active clients</option>
          <option value="partner">Partners</option>
          <option value="not_fit">Not a fit</option>
        </select>
        <span>{visible.length} mapped</span>
      </div>
      <div className="research-map-layout">
        <div className="research-map-canvas">
          <MapContainer
            center={[39.5, -98.35]}
            zoom={4}
            scrollWheelZoom
            className="research-leaflet-map"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ResearchMapBounds places={visible} />
            {visible.map((place) => (
              <Marker
                key={place.id}
                position={[place.latitude, place.longitude]}
                eventHandlers={{ click: () => setSelectedId(place.id) }}
              >
                <Popup>
                  <strong>{place.name}</strong>
                  <br />
                  {place.status.replace("_", " ")}
                  <br />
                  {place.address}
                </Popup>
              </Marker>
            ))}
          </MapContainer>
          {!visible.length && (
            <div className="research-map-empty">
              <PiMapPin />
              <strong>No mapped organizations yet</strong>
              <span>
                Ask Research to find and map prospects, or add one below.
              </span>
            </div>
          )}
        </div>
        <aside className="research-place-list">
          <header>
            <strong>Research portfolio</strong>
            <small>Markdown-backed records</small>
          </header>
          <div>
            {visible.map((place) => (
              <button
                key={place.id}
                className={place.id === selectedId ? "active" : ""}
                onClick={() => setSelectedId(place.id)}
              >
                <i className={`research-status ${place.status}`} />
                <span>
                  <strong>{place.name}</strong>
                  <small>{place.address}</small>
                  <em>{place.opportunity || place.kind}</em>
                </span>
                <PiCaretRight />
              </button>
            ))}
          </div>
        </aside>
        <aside className="research-place-detail">
          {selected ? (
            <>
              <header>
                <span className={`research-status-label ${selected.status}`}>
                  {selected.status.replace("_", " ")}
                </span>
                <h4>{selected.name}</h4>
                <p>{selected.address}</p>
              </header>
              <div>
                <small>Opportunity</small>
                <p>{selected.opportunity || "No assessment recorded yet."}</p>
              </div>
              <div className="research-place-links">
                {selected.website && (
                  <a href={selected.website} target="_blank" rel="noreferrer">
                    Website <PiArrowRight />
                  </a>
                )}
                <a href={directionsUrl} target="_blank" rel="noreferrer">
                  <PiNavigationArrow /> Open directions
                </a>
              </div>
              <div className="research-directions">
                <small>Prepare directions for a phone</small>
                <label>
                  <PiPhone />
                  <input
                    value={recipientPhone}
                    onChange={(event) => setRecipientPhone(event.target.value)}
                    placeholder="Recipient phone number"
                  />
                </label>
                <a
                  className={!recipientPhone.trim() ? "disabled" : ""}
                  href={recipientPhone.trim() ? smsUrl : undefined}
                >
                  <PiPaperPlaneTilt /> Open SMS draft
                </a>
                <p>
                  This opens a prefilled message on your device. The system does
                  not send it silently.
                </p>
              </div>
              <footer>
                <button onClick={() => edit(selected)}>
                  Edit organization
                </button>
                <span>
                  {selected.sourceUrls.length} source
                  {selected.sourceUrls.length === 1 ? "" : "s"} · Updated{" "}
                  {new Date(selected.updatedAt).toLocaleDateString()}
                </span>
              </footer>
            </>
          ) : (
            <div className="research-detail-empty">
              <PiMapPin />
              <p>
                Select an organization to review its research and directions.
              </p>
            </div>
          )}
        </aside>
      </div>
      <form
        className="research-place-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <header>
          <div>
            <span>Owner entry</span>
            <h4>
              {form.id ? "Update mapped organization" : "Add an organization"}
            </h4>
          </div>
          {form.id && (
            <button
              type="button"
              onClick={() => {
                setForm(emptyResearchPlace);
                setGeocode([]);
              }}
            >
              Cancel edit
            </button>
          )}
        </header>
        <label>
          Name
          <input
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Business or organization"
          />
        </label>
        <label>
          Address
          <input
            required
            value={form.address}
            onChange={(event) =>
              setForm({ ...form, address: event.target.value })
            }
            placeholder="Street, city, region"
          />
        </label>
        <button
          className="research-locate"
          type="button"
          onClick={() => void locate()}
          disabled={!form.name.trim() && !form.address.trim()}
        >
          <PiMapPin /> Find on map
        </button>
        <label>
          Status
          <select
            value={form.status}
            onChange={(event) =>
              setForm({
                ...form,
                status: event.target.value as ResearchPlaceInput["status"],
              })
            }
          >
            <option value="prospect">Prospect</option>
            <option value="researching">Researching</option>
            <option value="contacted">Contacted</option>
            <option value="active">Active client</option>
            <option value="partner">Partner</option>
            <option value="not_fit">Not a fit</option>
          </select>
        </label>
        <label>
          Type
          <select
            value={form.kind}
            onChange={(event) =>
              setForm({
                ...form,
                kind: event.target.value as ResearchPlaceInput["kind"],
              })
            }
          >
            <option value="business">Business</option>
            <option value="organization">Organization</option>
            <option value="venue">Venue</option>
            <option value="vendor">Vendor</option>
            <option value="competitor">Competitor</option>
            <option value="partner">Partner</option>
          </select>
        </label>
        <label>
          Website
          <input
            value={form.website}
            onChange={(event) =>
              setForm({ ...form, website: event.target.value })
            }
            placeholder="https://…"
          />
        </label>
        <label className="research-opportunity">
          Opportunity
          <textarea
            value={form.opportunity}
            onChange={(event) =>
              setForm({ ...form, opportunity: event.target.value })
            }
            placeholder="Why this organization matters and what could be explored"
          />
        </label>
        <label className="research-sources">
          Source URLs
          <textarea
            value={form.sourceUrls.join("\n")}
            onChange={(event) =>
              setForm({
                ...form,
                sourceUrls: event.target.value.split(/\s+/).filter(Boolean),
              })
            }
            placeholder="One verified public URL per line"
          />
        </label>
        {geocode.length > 0 && (
          <div className="research-geocode-results">
            {geocode.map((result) => (
              <button
                key={`${result.latitude}-${result.longitude}`}
                type="button"
                onClick={() => {
                  setForm({
                    ...form,
                    address: result.displayName,
                    latitude: result.latitude,
                    longitude: result.longitude,
                  });
                  setGeocode([]);
                }}
              >
                <PiMapPin />
                <span>
                  <strong>{result.displayName}</strong>
                  <small>
                    {result.latitude.toFixed(5)}, {result.longitude.toFixed(5)}
                  </small>
                </span>
              </button>
            ))}
          </div>
        )}
        <button
          className="research-save"
          disabled={
            saving ||
            !form.name.trim() ||
            !form.address.trim() ||
            (!form.latitude && !form.longitude)
          }
        >
          {saving ? <PiCircleNotch className="spin" /> : <PiCheck />} Save to
          Research Map
        </button>
      </form>
      <footer>
        <PiShieldCheck /> AI-created map records require owner approval.
        Directions open as a draft; no message is sent automatically.
      </footer>
    </section>
  );
}

function SystemRail({
  actions,
  workItems,
  activity,
  employees,
  onDecision,
  onWorkItemDecision,
}: {
  actions: ActionProposal[];
  workItems: WorkItem[];
  activity: BootstrapData["activity"];
  employees: EmployeeDefinition[];
  onDecision: (result: {
    action: ActionProposal;
    assistantMessage: string | null;
  }) => Promise<void>;
  onWorkItemDecision: () => Promise<void>;
}) {
  const pending = actions.find((action) => action.status === "pending");
  const pendingAppointment = workItems.find(
    (item) => item.status === "awaiting_owner" && item.kind === "appointment",
  );
  const pendingCount =
    actions.filter((action) => action.status === "pending").length +
    workItems.filter(
      (item) => item.status === "awaiting_owner" && item.kind === "appointment",
    ).length;
  return (
    <aside className="system-rail">
      <section className="approval-section">
        <header>
          <span>
            <i /> Pending approval
          </span>
          <b>{pendingCount}</b>
        </header>
        <small>Requires your review</small>
        {pendingAppointment ? (
          <AppointmentApprovalCard
            workItem={pendingAppointment}
            onDone={onWorkItemDecision}
          />
        ) : pending ? (
          <ApprovalCard
            action={pending}
            onDone={onDecision}
            onRefresh={onWorkItemDecision}
          />
        ) : (
          <div className="empty-approval">
            <PiShieldCheck />
            <strong>You’re in control</strong>
            <span>No actions are waiting for approval.</span>
          </div>
        )}
      </section>
      <section className="activity-section">
        <header>
          <span>
            <PiPulse /> Recent activity
          </span>
          <button>View all</button>
        </header>
        <div className="activity-list">
          {activity.length ? (
            activity.slice(0, 5).map((item) => {
              const employee = employees.find(
                (candidate) => candidate.id === item.employeeId,
              )!;
              return (
                <div className="activity-row" key={`${item.id}-${item.at}`}>
                  <img src={employee.avatar} alt="" />
                  <i className={item.status} />
                  <span>
                    <strong>{employee.title}</strong>
                    <small>{item.summary}</small>
                  </span>
                  <time>{formatRelative(item.at)}</time>
                </div>
              );
            })
          ) : (
            <p className="activity-empty">Employee actions will appear here.</p>
          )}
        </div>
      </section>
    </aside>
  );
}

function AppointmentApprovalCard({
  workItem,
  onDone,
}: {
  workItem: WorkItem;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<"confirm" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decide = async (decision: "confirm" | "decline") => {
    setBusy(decision);
    setError(null);
    try {
      await api.decideAppointmentWorkItem(workItem.id, decision);
      await onDone();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Appointment decision failed.",
      );
    } finally {
      setBusy(null);
    }
  };
  const requested = workItem.summary.match(
    /Tentative hold requested for (.+?)\.?$/,
  )?.[1];
  const when =
    requested && !Number.isNaN(new Date(requested).getTime())
      ? new Intl.DateTimeFormat("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(requested))
      : workItem.summary;
  return (
    <article className="approval-card appointment-approval-card">
      <div className="approval-title">
        <PiCalendarBlank />
        <span>
          <strong>{workItem.title}</strong>
          <small>Tentative customer hold</small>
        </span>
      </div>
      <label>Requested time</label>
      <p>{when}</p>
      <label>Next step</label>
      <p>{workItem.nextStep}</p>
      {error && (
        <div className="approval-error" role="alert">
          {error}
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {busy
          ? `${busy === "confirm" ? "Confirming" : "Declining"} meeting.`
          : ""}
      </span>
      <div className="approval-actions">
        <button
          className="approve"
          disabled={Boolean(busy)}
          onClick={() => void decide("confirm")}
        >
          {busy === "confirm" ? (
            <PiCircleNotch className="spin" />
          ) : (
            <PiCheck />
          )}{" "}
          Confirm meeting
        </button>
        <button disabled={Boolean(busy)} onClick={() => void decide("decline")}>
          {busy === "decline" ? <PiCircleNotch className="spin" /> : <PiX />}{" "}
          Decline
        </button>
      </div>
    </article>
  );
}

function ApprovalCard({
  action,
  onDone,
  onRefresh,
}: {
  action: ActionProposal;
  onDone: (result: {
    action: ActionProposal;
    assistantMessage: string | null;
  }) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decide = async (decision: "approve" | "deny") => {
    setBusy(decision);
    setError(null);
    try {
      const result = await api.decide(action.id, {
        decision,
        contentHash: action.contentHash,
      });
      await onDone(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Decision failed.");
      await onRefresh().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  };
  return (
    <article className="approval-card">
      <div className="approval-title">
        <PiFileText />
        <span>
          <strong>{action.summary}</strong>
          <small>{action.tool.replaceAll("_", " ")}</small>
        </span>
      </div>
      <label>Target</label>
      <code>{action.targetPaths.join(", ")}</code>
      <label>Why</label>
      <p>{action.reason}</p>
      <details>
        <summary>Review preview</summary>
        <pre>{action.preview}</pre>
      </details>
      {error && (
        <div className="approval-error" role="alert">
          {error}
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {busy ? `${busy === "approve" ? "Approving" : "Denying"} action.` : ""}
      </span>
      <div className="approval-actions">
        <button
          className="approve"
          disabled={Boolean(busy)}
          onClick={() => void decide("approve")}
        >
          {busy === "approve" ? (
            <PiCircleNotch className="spin" />
          ) : (
            <PiCheck />
          )}{" "}
          Approve action
        </button>
        <button disabled={Boolean(busy)} onClick={() => void decide("deny")}>
          {busy === "deny" ? <PiCircleNotch className="spin" /> : <PiX />} Deny
        </button>
      </div>
    </article>
  );
}

function EmployeeDock({
  employees,
  activeId,
  statuses,
  onSelect,
}: {
  employees: EmployeeDefinition[];
  activeId: EmployeeId;
  statuses: Partial<Record<EmployeeId, EmployeeRunStatus>>;
  onSelect: (id: EmployeeId) => void;
}) {
  return (
    <nav className="employee-dock" aria-label="AI employees">
      {employees.map((employee) => {
        const status = statuses[employee.id] ?? "idle";
        return (
          <button
            key={employee.id}
            className={`${employee.id === activeId ? "active" : ""} ${status}`}
            aria-label={`${employee.title}, ${status === "working" ? "working" : status === "error" ? "needs attention" : "available"}`}
            onClick={() => onSelect(employee.id)}
          >
            <span>
              <img src={employee.avatar} alt="" />
              <i className={status} />
            </span>
            <strong>{employee.shortName}</strong>
            <small>
              {status === "working"
                ? "Working…"
                : status === "error"
                  ? "Check chat"
                  : "Available"}
            </small>
          </button>
        );
      })}
    </nav>
  );
}

function SearchModal({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    Array<{ path: string; title: string; snippet: string }>
  >([]);
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
      <form className="search-form" onSubmit={run}>
        <PiMagnifyingGlass />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search conversations, actions, memory…"
        />
        <button>{busy ? <PiCircleNotch className="spin" /> : "Search"}</button>
      </form>
      <div className="search-results">
        {results.map((result) => (
          <article key={result.path}>
            <PiFileText />
            <div>
              <strong>{result.title}</strong>
              <code>{result.path}</code>
              <p>{result.snippet.replace(/<\/?mark>/g, "")}</p>
            </div>
          </article>
        ))}
        {!busy && query && !results.length && (
          <p>No matching Markdown records.</p>
        )}
      </div>
    </Modal>
  );
}

function SettingsModal({
  settings,
  employees,
  onClose,
  onSaved,
}: {
  settings: Settings;
  employees: EmployeeDefinition[];
  onClose: () => void;
  onSaved: (settings: Settings) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [models, setModels] = useState<Array<{ name: string; size: number }>>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | null>(
    null,
  );
  const [backups, setBackups] = useState<BackupManifest[]>([]);
  const [restoreId, setRestoreId] = useState("");
  const [restoreConfirmation, setRestoreConfirmation] = useState("");
  const refreshReliability = async () => {
    const [nextDiagnostics, nextBackups] = await Promise.all([
      api.diagnostics(),
      api.backups(),
    ]);
    setDiagnostics(nextDiagnostics);
    setBackups(nextBackups);
    if (!restoreId && nextBackups[0]) setRestoreId(nextBackups[0].backupId);
  };
  useEffect(() => {
    api
      .models()
      .then(setModels)
      .catch(() => setModels([]));
    refreshReliability().catch((reason) => setError(reason.message));
  }, []);
  const save = async () => {
    setBusy(true);
    try {
      onSaved(await api.settings(draft));
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to save settings.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Local AI settings" onClose={onClose} wide>
      <div className="settings-body">
        <section>
          <h3>Runtime</h3>
          <label>
            Default Ollama model
            <select
              value={draft.defaultModel}
              onChange={(event) =>
                setDraft({ ...draft, defaultModel: event.target.value })
              }
            >
              {models.map((model) => (
                <option key={model.name}>{model.name}</option>
              ))}
            </select>
          </label>
          <label>
            Context length
            <input
              type="number"
              min={2048}
              max={262144}
              step={1024}
              value={draft.contextLength}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  contextLength: Number(event.target.value),
                })
              }
            />
          </label>
          <button
            className="secondary-button"
            onClick={() => void api.openFolder()}
          >
            <PiFolderOpen /> Open Markdown workspace
          </button>
          <button
            className="secondary-button"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const result = await api.createBackup();
                setBackupMessage(
                  `Validated backup created: ${result.backupId}`,
                );
                await refreshReliability();
              } catch (reason) {
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Unable to create backup.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <PiDatabase /> Create validated backup
          </button>
          {backupMessage && (
            <p className="settings-success" role="status">
              <PiCheck /> {backupMessage}
            </p>
          )}
        </section>
        <section>
          <h3>Employee model overrides</h3>
          <div className="role-models">
            {employees.map((employee) => (
              <label key={employee.id}>
                <span>
                  <img src={employee.avatar} alt="" />
                  {employee.title}
                </span>
                <select
                  value={draft.roleModels[employee.id] ?? ""}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      roleModels: {
                        ...draft.roleModels,
                        [employee.id]: event.target.value,
                      },
                    })
                  }
                >
                  <option value="">Use default</option>
                  {models.map((model) => (
                    <option key={model.name}>{model.name}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </section>
        <section
          className="diagnostics-panel"
          aria-labelledby="diagnostics-heading"
        >
          <div className="diagnostics-heading">
            <div>
              <h3 id="diagnostics-heading">Diagnostics & recovery</h3>
              <p>
                Canonical record health, local model status, search freshness,
                and validated backups.
              </p>
            </div>
            <button
              className="secondary-button"
              onClick={() => void refreshReliability()}
              disabled={busy}
            >
              Refresh
            </button>
          </div>
          {diagnostics && (
            <div className="diagnostics-grid" aria-live="polite">
              <span>
                <small>Ollama</small>
                <strong
                  className={diagnostics.ollamaOnline ? "healthy" : "unhealthy"}
                >
                  {diagnostics.ollamaOnline ? "Online" : "Offline"}
                </strong>
              </span>
              <span>
                <small>Malformed records</small>
                <strong
                  className={
                    diagnostics.malformedRecords.length
                      ? "unhealthy"
                      : "healthy"
                  }
                >
                  {diagnostics.malformedRecords.length}
                </strong>
              </span>
              <span>
                <small>Pending approvals</small>
                <strong>{diagnostics.pendingActions}</strong>
              </span>
              <span>
                <small>Pending work</small>
                <strong>{diagnostics.pendingWorkItems}</strong>
              </span>
            </div>
          )}
          {diagnostics?.malformedRecords.length ? (
            <div className="diagnostics-issues" role="alert">
              {diagnostics.malformedRecords.map((issue) => (
                <article key={issue.path}>
                  <strong>{issue.path}</strong>
                  <span>
                    {issue.recordKind} · schema v{issue.schemaVersion}
                  </span>
                  <p>{issue.validationError}</p>
                </article>
              ))}
            </div>
          ) : (
            diagnostics && (
              <p className="diagnostics-clean">
                <PiShieldCheck /> All canonical records parsed successfully.
              </p>
            )
          )}
          <div className="diagnostics-actions">
            <button
              className="secondary-button"
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const result = await api.reindex();
                  setBackupMessage(
                    `Search index rebuilt: ${new Date(result.indexFreshAt).toLocaleString()}`,
                  );
                  await refreshReliability();
                } catch (reason) {
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : "Unable to rebuild the index.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
            >
              <PiPulse /> Rebuild search index
            </button>
            {diagnostics?.latestValidatedBackup && (
              <span>
                Latest backup{" "}
                <strong>
                  {new Date(
                    diagnostics.latestValidatedBackup.createdAt,
                  ).toLocaleString()}
                </strong>
              </span>
            )}
          </div>
          {backups.length > 0 && (
            <div className="restore-controls">
              <label>
                Validated backup
                <select
                  value={restoreId}
                  onChange={(event) => {
                    setRestoreId(event.target.value);
                    setRestoreConfirmation("");
                  }}
                >
                  {backups.map((backup) => (
                    <option key={backup.backupId} value={backup.backupId}>
                      {new Date(backup.createdAt).toLocaleString()} ·{" "}
                      {backup.reason}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Confirmation
                <input
                  value={restoreConfirmation}
                  onChange={(event) =>
                    setRestoreConfirmation(event.target.value)
                  }
                  placeholder={`RESTORE ${restoreId}`}
                />
              </label>
              <button
                className="danger-button"
                disabled={
                  busy || restoreConfirmation !== `RESTORE ${restoreId}`
                }
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await api.restoreBackup(restoreId, restoreConfirmation);
                    setBackupMessage(
                      `Restored ${restoreId}; a pre-restore backup was created and the index rebuilt.`,
                    );
                    setRestoreConfirmation("");
                    await refreshReliability();
                  } catch (reason) {
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : "Unable to restore the backup.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Restore backup
              </button>
            </div>
          )}
        </section>
        {error && (
          <div className="form-error" role="alert">
            <PiWarning /> {error}
          </div>
        )}
      </div>
      <div className="modal-footer">
        <button className="secondary-button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary-button"
          onClick={() => void save()}
          disabled={busy}
        >
          {busy ? <PiCircleNotch className="spin" /> : "Save settings"}
        </button>
      </div>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialogRef = useDialogFocus<HTMLElement>(onClose);
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <strong>{title}</strong>
          <button aria-label="Close" onClick={onClose}>
            <PiX />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
