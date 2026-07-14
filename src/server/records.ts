import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, appendFile, copyFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { nanoid } from "nanoid";
import { employees, employeeById } from "../shared/employees.js";
import { agentOperatingFiles, samuelStudioKnowledgeFiles } from "../shared/agent-souls.js";
import type { ActionProposal, ConversationRecord, EmployeeId, OnboardingInput } from "../shared/schemas.js";
import { atomicWriteText, pathExists, readSafeText } from "./paths.js";
import type { RecordHealthRegistry } from "./reliability.js";

function iso(): string {
  return new Date().toISOString();
}

function dateParts(date = new Date()): [string, string] {
  return [String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, "0")];
}

function yamlValue(value: string): string {
  return JSON.stringify(value);
}

async function walkMarkdown(root: string): Promise<string[]> {
  const output: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) output.push(full);
    }
  }
  await walk(root);
  return output;
}

export class WorkspaceRecords {
  readonly conversations = new Map<string, ConversationRecord>();
  readonly actions = new Map<string, ActionProposal>();

  constructor(readonly root: string, private readonly health?: RecordHealthRegistry) {}

  async initialize(company: OnboardingInput): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const profile = `# ${company.companyName}\n\n## Business\n\n- Owner: ${company.ownerName}\n- Industry: ${company.industry}\n- Currency: ${company.currency}\n- Timezone: ${company.timezone}\n- Hours: ${company.hours}\n\n## Description\n\n${company.description}\n\n## Services\n\n${company.services}\n\n## Brand tone\n\n${company.tone}\n`;
    await atomicWriteText(this.root, "company/PROFILE.md", profile);
    await atomicWriteText(this.root, "company/POLICIES.md", `# Company Policies\n\n${company.policies || "No additional policies have been confirmed yet."}\n`);
    await atomicWriteText(this.root, "company/GOALS.md", `# Business Goals\n\n${company.goals}\n`);

    for (const employee of employees) {
      const base = `employees/${employee.id}`;
      await atomicWriteText(
        this.root,
        `${base}/EMPLOYEE.md`,
        `# ${employee.title}\n\n${employee.charter}\n\n## Responsibilities\n\n${employee.responsibilities.map((item) => `- ${item}`).join("\n")}\n\n## Guardrails\n\n${employee.constraints.map((item) => `- ${item}`).join("\n")}\n`,
      );
      await atomicWriteText(this.root, `${base}/MEMORY.md`, `# ${employee.title} Memory\n\nNo confirmed role-specific memories yet.\n`);
      await mkdir(join(this.root, base, "conversations"), { recursive: true });
      await mkdir(join(this.root, base, "actions"), { recursive: true });
      await mkdir(join(this.root, base, "artifacts"), { recursive: true });
    }
    await mkdir(join(this.root, "shared", "handoffs"), { recursive: true });
    await mkdir(join(this.root, "shared", "tasks"), { recursive: true });
    await mkdir(join(this.root, "index"), { recursive: true });
    await this.ensureOperatingFiles();
  }

  async ensureOperatingFiles(): Promise<void> {
    for (const employee of employees) {
      const base = `employees/${employee.id}`;
      const operating = agentOperatingFiles[employee.id];
      const files: Record<string, string> = {
        [`${base}/EMPLOYEE.md`]: `# ${employee.title}\n\n${employee.charter}\n\n## Responsibilities\n\n${employee.responsibilities.map((item) => `- ${item}`).join("\n")}\n\n## Guardrails\n\n${employee.constraints.map((item) => `- ${item}`).join("\n")}\n`,
        [`${base}/SOUL.md`]: operating.soul,
        [`${base}/PLAN.md`]: operating.plan,
        [`${base}/MEMORY.md`]: `# ${employee.title} Memory\n\nNo confirmed role-specific memories yet.\n`,
      };
      for (const [path, content] of Object.entries(files)) {
        if (!(await pathExists(this.root, path))) await atomicWriteText(this.root, path, content);
      }
      await mkdir(join(this.root, base, "conversations"), { recursive: true });
      await mkdir(join(this.root, base, "actions"), { recursive: true });
      await mkdir(join(this.root, base, "artifacts"), { recursive: true });
    }

    for (const [path, content] of Object.entries(samuelStudioKnowledgeFiles)) {
      if (!(await pathExists(this.root, path))) await atomicWriteText(this.root, path, content);
    }
    await mkdir(join(this.root, "company", "finance"), { recursive: true });
    const financeWorkbook = "company/finance/Samuel-Studio-Finance.xlsx";
    if (!(await pathExists(this.root, financeWorkbook))) {
      const template = join(process.cwd(), "templates", "Samuel-Studio-Finance.xlsx");
      try {
        await copyFile(template, join(this.root, financeWorkbook));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await mkdir(join(this.root, "shared", "handoffs"), { recursive: true });
    await mkdir(join(this.root, "shared", "tasks"), { recursive: true });
    await mkdir(join(this.root, "index"), { recursive: true });
  }

  async companyContext(): Promise<string> {
    const files = ["company/PROFILE.md", "company/POLICIES.md", "company/GOALS.md", "company/SERVICES.md", "company/PROJECTS.md", "company/SOURCES.md"];
    const chunks = await Promise.all(files.map((file) => readSafeText(this.root, file)));
    return chunks.join("\n\n---\n\n");
  }

  async publicCompanyContext(): Promise<string> {
    const files = ["company/PROFILE.md", "company/SERVICES.md", "company/PROJECTS.md"];
    const chunks = await Promise.all(files.map((file) => readSafeText(this.root, file)));
    return chunks.join("\n\n---\n\n");
  }

  async memory(employeeId: EmployeeId): Promise<string> {
    return readSafeText(this.root, `employees/${employeeId}/MEMORY.md`);
  }

  async operatingContext(employeeId: EmployeeId): Promise<string> {
    const files = [`employees/${employeeId}/SOUL.md`, `employees/${employeeId}/PLAN.md`];
    const chunks = await Promise.all(files.map((file) => readSafeText(this.root, file)));
    return chunks.join("\n\n---\n\n");
  }

  async createConversation(employeeId: EmployeeId, title: string, model: string): Promise<ConversationRecord> {
    const id = nanoid(12);
    const [year, month] = dateParts();
    const relativeFile = `employees/${employeeId}/conversations/${year}/${month}/${id}.md`;
    const createdAt = iso();
    const record: ConversationRecord = { id, employeeId, title, model, createdAt, file: relativeFile };
    const employee = employeeById.get(employeeId)!;
    const markdown = `---\nschema_version: 1\nid: ${yamlValue(id)}\nemployee: ${yamlValue(employeeId)}\ntitle: ${yamlValue(title)}\nmodel: ${yamlValue(model)}\ncreated_at: ${yamlValue(createdAt)}\n---\n\n# ${employee.title}: ${title}\n\n`;
    await atomicWriteText(this.root, relativeFile, markdown);
    this.conversations.set(id, record);
    return record;
  }

  async activateConversation(conversationId: string, employeeId?: EmployeeId): Promise<{ record: ConversationRecord; content: string }> {
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(conversationId)) throw new Error("Conversation not found.");
    const existing = this.conversations.get(conversationId);
    if (existing) {
      if (employeeId && existing.employeeId !== employeeId) throw new Error("Conversation not found.");
      return { record: existing, content: await readFile(join(this.root, existing.file), "utf8") };
    }
    const searchRoot = employeeId ? join(this.root, "employees", employeeId, "conversations") : join(this.root, "employees");
    const files = await walkMarkdown(searchRoot);
    const file = files.find((candidate) => basename(candidate) === `${conversationId}.md` && candidate.includes(`${join("", "conversations")}`));
    if (!file) throw new Error("Conversation not found.");
    const content = await readFile(file, "utf8");
    const front = content.match(/^---\n([\s\S]*?)\n---/);
    const id = front?.[1].match(/^id:\s*"([^"]+)"/m)?.[1];
    const parsedEmployeeId = front?.[1].match(/^employee:\s*"([^"]+)"/m)?.[1] as EmployeeId | undefined;
    const title = front?.[1].match(/^title:\s*"([^"]+)"/m)?.[1];
    const model = front?.[1].match(/^model:\s*"([^"]+)"/m)?.[1];
    const createdAt = front?.[1].match(/^created_at:\s*"([^"]+)"/m)?.[1];
    if (id !== conversationId || !parsedEmployeeId || !employeeById.has(parsedEmployeeId) || (employeeId && parsedEmployeeId !== employeeId) || !title || !model || !createdAt) throw new Error("Conversation record is malformed.");
    const record: ConversationRecord = { id, employeeId: parsedEmployeeId, title, model, createdAt, file: relative(this.root, file).split("\\").join("/") };
    this.conversations.set(id, record);
    return { record, content };
  }

  async conversationRecords(employeeId: EmployeeId): Promise<Array<{ record: ConversationRecord; content: string }>> {
    const output: Array<{ record: ConversationRecord; content: string }> = [];
    for (const file of await walkMarkdown(join(this.root, "employees", employeeId, "conversations"))) {
      const id = basename(file, ".md");
      try { output.push(await this.activateConversation(id, employeeId)); this.health?.clear(relative(this.root, file).split("\\").join("/")); }
      catch (error) { this.health?.report(relative(this.root, file).split("\\").join("/"), "conversation", error); }
    }
    return output.sort((a, b) => b.record.createdAt.localeCompare(a.record.createdAt));
  }

  async appendConversation(conversationId: string, heading: string, content: string, metadata?: Record<string, unknown>): Promise<void> {
    const record = this.conversations.get(conversationId);
    if (!record) throw new Error("Conversation is not active in this server session.");
    const full = join(this.root, record.file);
    const meta = metadata ? `\n\n<!-- EVENT ${JSON.stringify({ ...metadata, schemaVersion: 1 }).replace(/-->/g, "--\\>")} -->` : "";
    await appendFile(full, `## ${heading} — ${iso()}\n\n${content}${meta}\n\n`, "utf8");
  }

  async createAction(action: ActionProposal): Promise<ActionProposal> {
    const [year, month] = dateParts(new Date(action.createdAt));
    const relativeFile = `employees/${action.employeeId}/actions/${year}/${month}/${action.id}.md`;
    action.file = relativeFile;
    const markdown = `---\nschema_version: 1\nid: ${yamlValue(action.id)}\nemployee: ${yamlValue(action.employeeId)}\nconversation: ${yamlValue(action.conversationId)}\ntool: ${yamlValue(action.tool)}\ncreated_at: ${yamlValue(action.createdAt)}\n---\n\n# Proposed action: ${action.summary}\n\n- Status: pending\n- Risk: ${action.risk}\n- Target: ${action.targetPaths.join(", ") || "workspace record"}\n- Approval hash: \`${action.contentHash}\`\n\n## Why\n\n${action.reason}\n\n## Preview\n\n\`\`\`text\n${action.preview}\n\`\`\`\n\n<!-- ACTION_META ${JSON.stringify({ ...action, schemaVersion: 1 }).replace(/-->/g, "--\\>")} -->\n`;
    await atomicWriteText(this.root, relativeFile, markdown);
    this.actions.set(action.id, action);
    return action;
  }

  async appendActionEvent(actionId: string, status: ActionProposal["status"], detail: string): Promise<ActionProposal> {
    const action = this.actions.get(actionId);
    if (!action) throw new Error("Action not found.");
    action.status = status;
    action.decidedAt = iso();
    action.result = detail;
    const full = join(this.root, action.file);
    const event = { schemaVersion: 1, status, detail, at: action.decidedAt };
    await appendFile(full, `\n## ${status[0].toUpperCase()}${status.slice(1)} — ${action.decidedAt}\n\n${detail}\n\n<!-- ACTION_EVENT ${JSON.stringify(event).replace(/-->/g, "--\\>")} -->\n`, "utf8");
    return action;
  }

  async loadActions(): Promise<void> {
    this.actions.clear();
    for (const file of await walkMarkdown(join(this.root, "employees"))) {
      if (!file.includes(`${join("", "actions")}`)) continue;
      const text = await readFile(file, "utf8");
      const metaMatch = text.match(/<!-- ACTION_META (\{.*\}) -->/);
      if (!metaMatch) continue;
      try {
        const action = JSON.parse(metaMatch[1]) as ActionProposal;
        action.file = relative(this.root, file).split("\\").join("/");
        const events = [...text.matchAll(/<!-- ACTION_EVENT (\{.*\}) -->/g)];
        if (events.length) {
          const last = JSON.parse(events.at(-1)![1]) as { status: ActionProposal["status"]; detail: string; at: string };
          action.status = last.status;
          action.result = last.detail;
          action.decidedAt = last.at;
        }
        this.actions.set(action.id, action);
      } catch (error) { this.health?.report(relative(this.root, file).split("\\").join("/"), "action", error); }
    }
  }

  listActions(): ActionProposal[] {
    return [...this.actions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  recentActivity(limit = 8): Array<{ id: string; employeeId: EmployeeId; summary: string; status: string; at: string }> {
    return this.listActions()
      .slice(0, limit)
      .map((action) => ({ id: action.id, employeeId: action.employeeId, summary: action.summary, status: action.status, at: action.decidedAt ?? action.createdAt }));
  }

  approvalHash(tool: string, args: Record<string, unknown>, targetSnapshot: string): string {
    return createHash("sha256").update(JSON.stringify({ tool, args, targetSnapshot })).digest("hex");
  }

  async allMarkdownFiles(): Promise<string[]> {
    return walkMarkdown(this.root);
  }
}
