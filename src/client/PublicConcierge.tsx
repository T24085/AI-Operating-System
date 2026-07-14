import { useEffect, useRef, useState, type FormEvent } from "react";
import { PiArrowRight, PiArrowSquareOut, PiCalendarBlank, PiChatCircleText, PiCheck, PiCircleNotch, PiClipboardText, PiEnvelope, PiFileText, PiLockKey, PiPaperPlaneTilt, PiPhone, PiShieldCheck, PiSparkle, PiUser, PiUsersThree, PiWarning } from "react-icons/pi";
import type { Deliverable, EmployeeId, PublicConversationMessage, PublicIntake, WorkItem } from "../shared/schemas";
import { api, streamPublicMessage } from "./api";

type Message = PublicConversationMessage & {
  pending?: boolean;
};

type JoiningSpecialist = { employeeId: EmployeeId; name: string; avatar: string };
type RememberedConversation = { conversationId: string; resumeToken: string; title: string; updatedAt: string };
type RememberedVisitor = Pick<PublicIntake, "name" | "email" | "phone"> & { conversations: RememberedConversation[] };

const emptyIntake: PublicIntake = { name: "", email: "", phone: "", need: "", consent: true };
const rememberedVisitorKey = "samuel-studio:concierge-visitor:v1";

function loadRememberedVisitor(): RememberedVisitor | null {
  try {
    const value = JSON.parse(localStorage.getItem(rememberedVisitorKey) ?? "null") as Partial<RememberedVisitor> | null;
    if (!value?.name || !value.email) return null;
    const conversations = Array.isArray(value.conversations)
      ? value.conversations.filter((item): item is RememberedConversation => Boolean(
        item && typeof item === "object"
        && typeof (item as RememberedConversation).conversationId === "string"
        && typeof (item as RememberedConversation).resumeToken === "string"
        && typeof (item as RememberedConversation).title === "string"
        && typeof (item as RememberedConversation).updatedAt === "string",
      )).slice(0, 5)
      : [];
    return { name: value.name, email: value.email, phone: value.phone ?? "", conversations };
  } catch {
    return null;
  }
}

function storeRememberedVisitor(visitor: RememberedVisitor | null): void {
  try {
    if (visitor) localStorage.setItem(rememberedVisitorKey, JSON.stringify(visitor));
    else localStorage.removeItem(rememberedVisitorKey);
  } catch {
    // The concierge still works when browser storage is unavailable.
  }
}

function conversationDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Previous conversation";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

export function PublicConcierge({ onOwner }: { onOwner: () => void }) {
  const initialVisitor = useRef(loadRememberedVisitor()).current;
  const [rememberedVisitor, setRememberedVisitor] = useState<RememberedVisitor | null>(initialVisitor);
  const [editingVisitor, setEditingVisitor] = useState(!initialVisitor);
  const [rememberOnDevice, setRememberOnDevice] = useState(true);
  const [intake, setIntake] = useState<PublicIntake>(() => initialVisitor
    ? { name: initialVisitor.name, email: initialVisitor.email, phone: initialVisitor.phone, need: "", consent: true }
    : emptyIntake);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consulting, setConsulting] = useState<JoiningSpecialist | null>(null);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, consulting]);

  const touchRememberedConversation = (id: string) => {
    setRememberedVisitor((current) => {
      if (!current) return current;
      const conversations = current.conversations.map((conversation) => conversation.conversationId === id
        ? { ...conversation, updatedAt: new Date().toISOString() }
        : conversation);
      const updated = { ...current, conversations };
      storeRememberedVisitor(updated);
      return updated;
    });
  };

  const send = async (content: string, id = conversationId) => {
    const clean = content.trim();
    if (!clean || !id || busy) return;
    setBusy(true);
    setError(null);
    setInput("");
    setConsulting(null);

    const replyId = crypto.randomUUID();
    let receptionistStarted = false;
    let specialistMessageId: string | null = null;
    let streamFailed = false;
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "customer", content: clean }]);

    try {
      await streamPublicMessage(id, clean, (event) => {
        if (event.type === "specialist_joined") {
          specialistMessageId = crypto.randomUUID();
          setConsulting({ employeeId: event.employeeId, name: event.name, avatar: event.avatar });
          setMessages((current) => [...current, {
            id: specialistMessageId!, role: "specialist", employeeId: event.employeeId,
            name: event.name, avatar: event.avatar, content: "", pending: true,
          }]);
        }
        if (event.type === "specialist_message") {
          setConsulting(null);
          setMessages((current) => current.map((message) => message.id === specialistMessageId
            ? { ...message, content: event.content, pending: false }
            : message));
        }
        if (event.type === "specialist_unavailable") {
          setConsulting(null);
          setMessages((current) => current.filter((message) => message.id !== specialistMessageId));
        }
        if (event.type === "work_item_created" || event.type === "appointment_requested") {
          const workItem = event.workItem;
          setWorkItems((current) => [workItem, ...current.filter((item) => item.id !== workItem.id)]);
        }
        if (event.type === "deliverable_ready" || event.type === "quote_ready") {
          const deliverable = event.deliverable;
          setDeliverables((current) => [deliverable, ...current.filter((item) => item.id !== deliverable.id)]);
        }
        if (event.type === "assistant_delta") {
          if (!receptionistStarted) {
            receptionistStarted = true;
            setMessages((current) => [...current, { id: replyId, role: "receptionist", content: event.content, pending: true }]);
          } else {
            setMessages((current) => current.map((message) => message.id === replyId
              ? { ...message, content: message.content + event.content }
              : message));
          }
        }
        if (event.type === "done") {
          setConsulting(null);
          if (!receptionistStarted && event.content) {
            receptionistStarted = true;
            setMessages((current) => [...current, { id: replyId, role: "receptionist", content: event.content, pending: false }]);
          } else {
            setMessages((current) => current.map((message) => message.id === replyId ? { ...message, pending: false } : message));
          }
        }
        if (event.type === "error") streamFailed = true;
      });
      touchRememberedConversation(id);
    } catch {
      streamFailed = true;
    } finally {
      setBusy(false);
      setConsulting(null);
      if (!receptionistStarted) {
        setMessages((current) => [
          ...current.filter((message) => message.id !== specialistMessageId || !message.pending),
          { id: replyId, role: "receptionist", content: streamFailed
            ? "I saved your message, but the local studio AI is taking longer than expected. Please try again—you will not need to re-enter your information or repeat the project details."
            : "I saved your message and conversation details. Please continue when you are ready.", pending: false },
        ]);
      } else {
        setMessages((current) => current.map((message) => message.id === replyId ? { ...message, pending: false } : message));
      }
    }
  };

  const resumeConversation = async (conversation: RememberedConversation) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const restored = await api.publicResume(conversation.conversationId, conversation.resumeToken);
      setIntake(restored.intake);
      setMessages(restored.messages);
      setDeliverables(restored.deliverables);
      setWorkItems([]);
      setConversationId(restored.conversationId);
      touchRememberedConversation(restored.conversationId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to continue this conversation.");
    } finally {
      setBusy(false);
    }
  };

  const begin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.publicIntake(intake);
      if (rememberOnDevice) {
        const previous = rememberedVisitor?.email.toLowerCase() === intake.email.trim().toLowerCase()
          ? rememberedVisitor.conversations
          : [];
        const conversation: RememberedConversation = {
          conversationId: result.conversationId,
          resumeToken: result.resumeToken,
          title: intake.need.trim().slice(0, 90),
          updatedAt: new Date().toISOString(),
        };
        const visitor: RememberedVisitor = {
          name: intake.name.trim(), email: intake.email.trim(), phone: intake.phone.trim(),
          conversations: [conversation, ...previous.filter((item) => item.conversationId !== conversation.conversationId)].slice(0, 5),
        };
        storeRememberedVisitor(visitor);
        setRememberedVisitor(visitor);
      } else {
        storeRememberedVisitor(null);
        setRememberedVisitor(null);
      }
      setConversationId(result.conversationId);
      setDeliverables([]);
      setWorkItems([]);
      setBusy(false);
      await send(intake.need, result.conversationId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to start your inquiry.");
      setBusy(false);
    }
  };

  const changeVisitor = () => {
    setEditingVisitor(true);
    setRememberOnDevice(true);
  };

  const forgetVisitor = () => {
    storeRememberedVisitor(null);
    setRememberedVisitor(null);
    setEditingVisitor(true);
    setRememberOnDevice(true);
    setIntake({ ...emptyIntake, need: intake.need });
  };

  if (!conversationId) return <main className="public-entry">
    <header className="public-nav">
      <div><span className="brand-orbit tiny"><PiSparkle /></span><strong>Samuel Studio</strong><i>Client concierge</i></div>
      <button onClick={onOwner}><PiLockKey /> Team access</button>
    </header>
    <section className="public-entry-grid">
      <div className="public-welcome">
        <small>Samuel Studio concierge</small>
        <h1>One conversation.<br /><em>Your whole creative team.</em></h1>
        <p>Tell us what you’re creating. Your Receptionist will bring in the right studio specialist—without making you chase departments.</p>
        <div className="public-trust">
          <span><PiShieldCheck /><b>Your information stays private</b><small>Used only to respond to your inquiry</small></span>
          <span><PiUsersThree /><b>Studio-wide expertise</b><small>Design, photography, digital, and research</small></span>
        </div>
      </div>
      <section className={`public-intake-card ${rememberedVisitor && !editingVisitor ? `returning${rememberedVisitor.conversations.length ? " with-history" : ""}` : ""}`}>
        <header><img src="/avatars/receptionist.png" alt="Samuel Studio Receptionist" /><span><i /><strong>Studio Receptionist</strong><small>Ready to welcome you</small></span></header>
        {rememberedVisitor && !editingVisitor ? <>
          <div className="public-intake-title"><small>Welcome back</small><h2>Good to see you, {rememberedVisitor.name.split(" ")[0]}.</h2><p>Your contact details are already saved on this device. Just tell us what you need today.</p></div>
          <form className="public-returning-form" onSubmit={begin}>
            <div className="public-saved-visitor"><span><PiUser /></span><div><strong>{rememberedVisitor.name}</strong><small>{rememberedVisitor.email}{rememberedVisitor.phone ? ` · ${rememberedVisitor.phone}` : ""}</small></div><button type="button" onClick={changeVisitor}>Change</button></div>
            {rememberedVisitor.conversations.length > 0 && <section className="public-resume-list">
              <header><PiChatCircleText /><span><strong>Continue a previous conversation</strong><small>Your Receptionist will remember the project details.</small></span></header>
              <div>{rememberedVisitor.conversations.slice(0, 3).map((conversation) => <button type="button" key={conversation.conversationId} disabled={busy} onClick={() => void resumeConversation(conversation)}><span><strong>{conversation.title}</strong><small>{conversationDate(conversation.updatedAt)}</small></span><PiArrowRight /></button>)}</div>
            </section>}
            <label><span><PiSparkle /> What can we help with today?</span><textarea autoFocus required value={intake.need} onChange={(event) => setIntake({ ...intake, need: event.target.value })} placeholder="Tell us about the project, question, or idea…" /></label>
            {error && <div className="public-error"><PiWarning />{error}</div>}
            <button className="public-start" disabled={busy}>{busy ? <PiCircleNotch className="spin" /> : <>Start a new conversation <PiArrowRight /></>}</button>
            <button className="public-forget" type="button" onClick={forgetVisitor}>Forget me on this device</button>
          </form>
        </> : <>
          <div className="public-intake-title"><small>{rememberedVisitor ? "Update your details" : "Before we begin"}</small><h2>How may we help?</h2><p>{rememberedVisitor ? "These details will replace the contact information saved on this device." : "A few details help us give you a useful answer and remember the conversation."}</p></div>
          <form onSubmit={begin}>
            <label><span><PiUser /> Your name</span><input required autoComplete="name" value={intake.name} onChange={(event) => setIntake({ ...intake, name: event.target.value })} placeholder="Full name" /></label>
            <label><span><PiEnvelope /> Email</span><input required type="email" autoComplete="email" value={intake.email} onChange={(event) => setIntake({ ...intake, email: event.target.value })} placeholder="you@company.com" /></label>
            <label><span><PiPhone /> Phone <i>optional</i></span><input autoComplete="tel" value={intake.phone} onChange={(event) => setIntake({ ...intake, phone: event.target.value })} placeholder="Phone or WhatsApp" /></label>
            <label><span><PiSparkle /> What can we help with?</span><textarea required value={intake.need} onChange={(event) => setIntake({ ...intake, need: event.target.value })} placeholder="Tell us about the project, question, or idea…" /></label>
            <label className="public-consent"><input type="checkbox" checked={intake.consent} onChange={(event) => setIntake({ ...intake, consent: event.target.checked as true })} /><span><i><PiCheck /></i>I agree that Samuel Studio may store this conversation and contact me about this inquiry.</span></label>
            <label className="public-remember"><input type="checkbox" checked={rememberOnDevice} onChange={(event) => setRememberOnDevice(event.target.checked)} /><span>Remember my contact details on this device</span></label>
            {error && <div className="public-error"><PiWarning />{error}</div>}
            <button className="public-start" disabled={busy || !intake.consent}>{busy ? <PiCircleNotch className="spin" /> : <>{rememberedVisitor ? "Save and continue" : "Meet your Receptionist"} <PiArrowRight /></>}</button>
          </form>
        </>}
        <footer><PiLockKey /> Private, local-first conversation record</footer>
      </section>
    </section>
  </main>;

  return <main className="public-chat-shell">
    <header className="public-nav">
      <div><span className="brand-orbit tiny"><PiSparkle /></span><strong>Samuel Studio</strong><i>Client concierge</i></div>
      <span className="public-visitor">Welcome, {intake.name.split(" ")[0]} <button onClick={onOwner}><PiLockKey /> Team access</button></span>
    </header>
    <div className="public-chat-layout">
      <aside className="public-reception-profile">
        <div className="public-portrait"><img src="/avatars/receptionist.png" alt="Samuel Studio Receptionist" /><i /></div>
        <small>Your point of contact</small><h1>Studio Receptionist</h1>
        <p>I’ll answer what I can and invite the right studio specialist into this conversation when you need deeper expertise.</p>
        <div className="public-specialists"><span>Available studio teams</span>{["Sales & projects", "Design & photography", "Web & digital", "Research & strategy", "Customer care"].map((team) => <div key={team}><PiCheck />{team}</div>)}</div>
        <footer><PiShieldCheck /> Private internal notes stay with the studio.</footer>
      </aside>
      <section className="public-conversation">
        <header><div><span><i /> Live concierge</span><h2>How can we help?</h2></div><button onClick={() => void send("I’d like to see your available consultation times.")} disabled={busy}><PiCalendarBlank /> Check availability</button></header>
        <div className="public-message-list" ref={scrollRef}>
          <div className="public-day-label"><span>Today</span></div>
          {messages.map((message) => <article key={message.id} className={`public-message ${message.role}`}>
            {message.role !== "customer" && <img src={message.role === "specialist" ? message.avatar : "/avatars/receptionist.png"} alt="" />}
            <div>
              <header>
                <strong>{message.role === "customer" ? intake.name : message.role === "specialist" ? message.name : "Studio Receptionist"}</strong>
                {message.role === "specialist" && <span>Studio specialist</span>}
                {message.role === "receptionist" && <span>Conversation host</span>}
              </header>
              <p>{message.content}{message.pending && !message.content && <><PiCircleNotch className="spin" /> Joining the conversation…</>}</p>
            </div>
          </article>)}
          {(deliverables.length > 0 || workItems.length > 0) && <section className="public-results" aria-label="Conversation work and deliverables">
            {deliverables.map((deliverable) => <article className="public-deliverable-card" key={deliverable.id}>
              <span><PiFileText /></span><div><small>{deliverable.kind} · {deliverable.status}</small><strong>{deliverable.title}</strong><p>{deliverable.preview}</p></div>
              {deliverable.accessUrl && <a href={deliverable.accessUrl} target="_blank" rel="noreferrer">Open proposal <PiArrowSquareOut /></a>}
            </article>)}
            {workItems.filter((item) => !deliverables.some((deliverable) => deliverable.workItemId === item.id)).map((item) => <article className="public-work-card" key={item.id}>
              <span><PiClipboardText /></span><div><small>{item.kind} · {item.status.replaceAll("_", " ")}</small><strong>{item.title}</strong><p>{item.nextStep}</p></div>
            </article>)}
          </section>}
          {consulting && <div className="public-team-join"><img src={consulting.avatar} alt="" /><span><strong>{consulting.name} joined the conversation</strong><small>Your specialist is reviewing the project details now.</small></span><PiCircleNotch className="spin" /></div>}
          {error && <div className="public-error"><PiWarning />{error}</div>}
        </div>
        <div className="public-prompts">{["Tell me about photography", "I need a website", "What does a project cost?"].map((prompt) => <button key={prompt} disabled={busy} onClick={() => void send(prompt)}>{prompt}</button>)}</div>
        <form className="public-composer" onSubmit={(event) => { event.preventDefault(); void send(input); }}>
          <textarea rows={1} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask the studio anything…" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(input); } }} />
          <button aria-label="Send message" disabled={busy || !input.trim()}>{busy ? <PiCircleNotch className="spin" /> : <PiPaperPlaneTilt />}</button>
          <small>Samuel Studio may use AI to assist. Important details are reviewed by the team.</small>
        </form>
      </section>
    </div>
  </main>;
}
