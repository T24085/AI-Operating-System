import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { employeeById } from "../shared/employees.js";
import type { EmployeeId, PublicConversationMessage, PublicIntake } from "../shared/schemas.js";

type PublicEvent = Record<string, unknown> & { type?: string };

export function issuePublicResumeToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashPublicResumeToken(token) };
}

export function hashPublicResumeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function eventsFrom(content: string): PublicEvent[] {
  return [...content.matchAll(/<!-- EVENT (\{.*\}) -->/g)].flatMap((match) => {
    try { return [JSON.parse(match[1]) as PublicEvent]; } catch { return []; }
  });
}

export function verifyPublicResumeToken(content: string, token: string): boolean {
  const stored = eventsFrom(content).find((event) => event.type === "public_resume")?.tokenHash;
  if (typeof stored !== "string" || !/^[a-f0-9]{64}$/.test(stored)) return false;
  const supplied = hashPublicResumeToken(token);
  return timingSafeEqual(Buffer.from(stored, "hex"), Buffer.from(supplied, "hex"));
}

export function parsePublicConversation(content: string): { intake: PublicIntake; messages: PublicConversationMessage[]; lastActivity: string; contactId: string; leadId: string } {
  const events = eventsFrom(content);
  const link = events.find((event) => event.type === "crm_linkage");
  if (!link) throw new Error("Conversation is missing its customer linkage.");
  const headers = [...content.matchAll(/^## (.+?) — ([^\r\n]+)\r?\n\r?\n/gm)];
  const messages: PublicConversationMessage[] = [];
  let lastActivity = "";
  headers.forEach((header, index) => {
    const body = content.slice(header.index! + header[0].length, headers[index + 1]?.index ?? content.length);
    const eventMatch = body.match(/<!-- EVENT (\{.*\}) -->/);
    if (!eventMatch) return;
    let event: PublicEvent;
    try { event = JSON.parse(eventMatch[1]) as PublicEvent; } catch { return; }
    const messageContent = body.slice(0, eventMatch.index).trim();
    lastActivity = header[2];
    if (!messageContent) return;
    if (event.type === "public_customer_message") {
      messages.push({ id: `resume-${index}`, role: "customer", content: messageContent, name: String(link.customerName ?? "Customer") });
    } else if (event.type === "public_assistant_message") {
      messages.push({ id: `resume-${index}`, role: "receptionist", content: messageContent, name: "Studio Receptionist", avatar: "/avatars/receptionist.png" });
    } else if (event.type === "public_specialist_message") {
      const employeeId = String(event.employeeId ?? "") as EmployeeId;
      const employee = employeeById.get(employeeId);
      if (employee) messages.push({ id: `resume-${index}`, role: "specialist", content: messageContent, employeeId, name: employee.title, avatar: employee.avatar });
    }
  });
  return {
    intake: {
      name: String(link.customerName ?? ""),
      email: String(link.customerEmail ?? ""),
      phone: String(link.customerPhone ?? ""),
      need: String(link.initialNeed ?? "Continuing a previous conversation"),
      consent: true,
    },
    messages,
    lastActivity,
    contactId: String(link.contactId ?? ""),
    leadId: String(link.leadId ?? ""),
  };
}
