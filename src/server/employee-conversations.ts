import type { ConversationRecord, EmployeeConversationMessage, EmployeeConversationSummary } from "../shared/schemas.js";

export function parseEmployeeConversation(record: ConversationRecord, content: string): { summary: EmployeeConversationSummary; messages: EmployeeConversationMessage[] } {
  const headers = [...content.matchAll(/^## (.+?) — ([^\r\n]+)\r?\n\r?\n/gm)];
  const messages: EmployeeConversationMessage[] = [];
  let lastActivity = record.createdAt;
  headers.forEach((header, index) => {
    const body = content.slice(header.index! + header[0].length, headers[index + 1]?.index ?? content.length);
    const eventMatch = body.match(/<!-- EVENT (\{.*\}) -->/);
    if (!eventMatch) return;
    let event: Record<string, unknown>;
    try { event = JSON.parse(eventMatch[1]) as Record<string, unknown>; } catch { return; }
    lastActivity = header[2];
    const messageContent = body.slice(0, eventMatch.index).trim();
    if (!messageContent) return;
    if (event.type === "user_message") messages.push({ id: `history-${index}`, role: "owner", content: messageContent });
    if (event.type === "assistant_message") messages.push({ id: `history-${index}`, role: "assistant", content: messageContent });
  });
  const preview = [...messages].reverse().find((message) => message.role === "owner")?.content
    ?? messages.at(-1)?.content
    ?? record.title;
  return {
    summary: {
      id: record.id, employeeId: record.employeeId, title: record.title, model: record.model,
      createdAt: record.createdAt, lastActivity, messageCount: messages.length, preview: preview.slice(0, 160),
    },
    messages,
  };
}
