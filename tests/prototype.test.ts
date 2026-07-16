import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { employees } from "../src/shared/employees.js";
import { recommendPublishedOffers } from "../src/shared/offers.js";
import {
  ActionDecisionSchema,
  ActionProposalSchema,
  EmployeeDefinitionSchema,
  OnboardingInputSchema,
  SettingsSchema,
} from "../src/shared/schemas.js";
import { slugify } from "../src/server/config.js";
import { RecordsIndex } from "../src/server/indexer.js";
import { atomicWriteText, readSafeText, resolveSafePath } from "../src/server/paths.js";
import { WorkspaceRecords } from "../src/server/records.js";
import { SafeToolRuntime } from "../src/server/tools.js";

const cleanup: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "aios-test-"));
  cleanup.push(root);
  return root;
}

const company = OnboardingInputSchema.parse({
  companyName: "Northstar Home Services",
  ownerName: "Edward",
  industry: "Home services",
  description: "A local residential home services company.",
  services: "Repairs and consultations",
  hours: "Monday through Friday, 8 AM to 5 PM",
  policies: "Confirm all appointments with the owner.",
  tone: "Warm and practical",
  goals: "Improve response time",
  currency: "USD",
  timezone: "America/Chicago",
});

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("shared contracts and employee definitions", () => {
  it("maps complex ticketing commerce to Growth while respecting a later simple landing-page scope", () => {
    expect(recommendPublishedOffers("professional soccer website with Ticketmaster ticket sales, dynamic games, and merchandise")[0].id).toBe("dev-growth");
    expect(recommendPublishedOffers("simple landing page, nothing special")[0].id).toBe("dev-starter");
  });
  it("validates ten distinct role definitions", () => {
    expect(employees).toHaveLength(10);
    expect(new Set(employees.map((employee) => employee.id)).size).toBe(10);
    for (const employee of employees) {
      expect(EmployeeDefinitionSchema.parse(employee)).toEqual(employee);
      expect(employee.charter.length).toBeGreaterThan(80);
      expect(employee.responsibilities.length).toBeGreaterThanOrEqual(4);
      expect(employee.suggestedTasks.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("applies model defaults and accepts role overrides", () => {
    const settings = SettingsSchema.parse({ roleModels: { developer: "ornith:35b" } });
    expect(settings.defaultModel).toBe("gemma4:12b");
    expect(settings.contextLength).toBe(16384);
    expect(settings.roleModels.developer).toBe("ornith:35b");
  });

  it("rejects malformed decisions and action records", () => {
    expect(() => ActionDecisionSchema.parse({ decision: "approve", contentHash: "abc", note: "x".repeat(1001) })).toThrow();
    expect(() => ActionProposalSchema.parse({ status: "executed" })).toThrow();
  });

  it("creates stable business slugs", () => {
    expect(slugify("Édward's AC & Heating, LLC")).toBe("edward-s-ac-heating-llc");
  });
});

describe("workspace path containment", () => {
  it("accepts a normal relative path", async () => {
    const root = await tempRoot();
    const target = await resolveSafePath(root, "employees/receptionist/MEMORY.md");
    expect(relative(root, target)).toBe(join("employees", "receptionist", "MEMORY.md"));
  });

  it("rejects traversal and absolute paths", async () => {
    const root = await tempRoot();
    await expect(resolveSafePath(root, "../outside.md")).rejects.toThrow("escapes");
    await expect(resolveSafePath(root, "C:\\Windows\\win.ini")).rejects.toThrow("relative");
  });

  it("rejects symbolic-link escape attempts when supported", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    try {
      await symlink(outside, join(root, "escape"), "junction");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    await expect(resolveSafePath(root, "escape/secret.md")).rejects.toThrow("Symbolic links");
  });

  it("enforces the one-megabyte text limit", async () => {
    const root = await tempRoot();
    await expect(atomicWriteText(root, "large.md", "a".repeat(1_048_577))).rejects.toThrow("1 MB");
  });
});

describe("append-only records and rebuildable search", () => {
  it("creates company and role Markdown files", async () => {
    const root = await tempRoot();
    const records = new WorkspaceRecords(root);
    await records.initialize(company);
    expect(await readSafeText(root, "company/PROFILE.md")).toContain("Northstar Home Services");
    expect(await readSafeText(root, "employees/research/EMPLOYEE.md")).toContain("rigorous business researcher");
    expect(await readSafeText(root, "employees/sales/SOUL.md")).toContain("exact verified intake, booking, contact, or PayPal URL");
    expect(await readSafeText(root, "employees/accounting/PLAN.md")).toContain("finance README");
    expect(await readSafeText(root, "company/SERVICES.md")).toContain("https://www.paypal.com/ncp/payment/TS4B6ND3JD9RQ");
    expect(await readSafeText(root, "shared/employee-files/sales/Samuel_Studio_Employee_Sales_Guide.md")).toContain("Employee Sales Guide");
    expect((await readFile(join(root, "shared/employee-files/sales/Samuel_Studio_Employee_Sales_Guide.pdf"))).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("restricts public-web research to the Research employee and blocks local targets", async () => {
    const root = await tempRoot();
    const records = new WorkspaceRecords(root);
    await records.initialize(company);
    const index = new RecordsIndex(records);
    await index.start();
    const tools = new SafeToolRuntime(records, index);
    await expect(tools.executeReadOnly("web_search", { query: "Samuel Studio" }, "sales")).rejects.toThrow("restricted to the Research employee");
    await expect(tools.executeReadOnly("read_web_page", { url: "http://127.0.0.1:5173" }, "research")).rejects.toThrow("private network");
    await index.close();
  });

  it("validates finance CSV and XLSX sources only for Accounting and Bookkeeper", async () => {
    const root = await tempRoot(); const records = new WorkspaceRecords(root); await records.initialize(company);
    await atomicWriteText(root, "company/finance/transactions.csv", "Transaction ID,Date,Category,Amount\nTX-1,2026-07-01,Software,49\nTX-1,bad-date,Uncategorized,nope\n");
    const index = new RecordsIndex(records); await index.start(); const tools = new SafeToolRuntime(records, index);
    const csv = await tools.executeReadOnly("validate_finance_csv", { path: "company/finance/transactions.csv" }, "bookkeeper");
    expect(csv.output).toContain("duplicate ID TX-1"); expect(csv.output).toContain("invalid amount"); expect(csv.output).toContain("category needs owner review");
    const workbook = await tools.executeReadOnly("inspect_finance_workbook", { path: "company/finance/Samuel-Studio-Finance.xlsx" }, "accounting");
    expect(workbook.output).toContain("Workbook sheets"); await expect(tools.executeReadOnly("inspect_finance_workbook", { path: "company/finance/Samuel-Studio-Finance.xlsx" }, "sales")).rejects.toThrow("restricted"); await index.close();
  });

  it("appends simultaneous visible conversation events", async () => {
    const root = await tempRoot();
    const records = new WorkspaceRecords(root);
    await records.initialize(company);
    const conversation = await records.createConversation("sales", "Lead review", "gemma4:12b");
    await Promise.all([
      records.appendConversation(conversation.id, "Owner", "First visible event"),
      records.appendConversation(conversation.id, "Sales", "Second visible event"),
    ]);
    const text = await readSafeText(root, conversation.file);
    expect(text).toContain("First visible event");
    expect(text).toContain("Second visible event");
    expect(text).toContain("—");
  });

  it("serializes and reloads action history", async () => {
    const root = await tempRoot();
    const records = new WorkspaceRecords(root);
    await records.initialize(company);
    const conversation = await records.createConversation("marketing", "Campaign", "gemma4:12b");
    const action = ActionProposalSchema.parse({
      id: "action-1",
      employeeId: "marketing",
      conversationId: conversation.id,
      tool: "create_file",
      summary: "Create campaign.md",
      reason: "Save an owner-reviewable draft.",
      risk: "low",
      targetPaths: ["employees/marketing/artifacts/campaign.md"],
      arguments: { path: "employees/marketing/artifacts/campaign.md", content: "# Campaign" },
      preview: "# Campaign",
      contentHash: "hash",
      status: "pending",
      createdAt: new Date().toISOString(),
      file: "",
    });
    await records.createAction(action);
    await records.appendActionEvent(action.id, "denied", "Owner denied this action.");
    const reloaded = new WorkspaceRecords(root);
    await reloaded.loadActions();
    expect(reloaded.actions.get(action.id)?.status).toBe("denied");
    expect(await readSafeText(root, action.file)).toContain("Owner denied this action.");
  });

  it("rebuilds FTS5 entirely from Markdown", async () => {
    const root = await tempRoot();
    const records = new WorkspaceRecords(root);
    await records.initialize(company);
    await atomicWriteText(root, "employees/research/artifacts/market-brief.md", "# Market Brief\n\nResidential retention is the primary finding.");
    const index = new RecordsIndex(records);
    await index.start();
    expect(index.search("residential retention")[0]?.path).toBe("employees/research/artifacts/market-brief.md");
    await index.close();
    await rm(join(root, "index", "records.sqlite"), { force: true });
    const rebuilt = new RecordsIndex(records);
    await rebuilt.start();
    expect(rebuilt.search("primary finding")).toHaveLength(1);
    await rebuilt.close();
  });
});

describe("approval-gated tools", () => {
  it("does not mutate before approval, then creates the approved file", async () => {
    const root = await tempRoot();
    const records = new WorkspaceRecords(root);
    await records.initialize(company);
    const index = new RecordsIndex(records);
    await index.start();
    const runtime = new SafeToolRuntime(records, index);
    const conversation = await records.createConversation("receptionist", "Appointment", "gemma4:12b");
    const target = "employees/receptionist/artifacts/request.md";
    const action = await runtime.propose("create_file", { path: target, content: "# Request", reason: "Capture the request." }, "receptionist", conversation.id);
    await expect(readSafeText(root, target)).rejects.toThrow();
    expect(action.contentHash).toHaveLength(64);
    expect(await runtime.execute(action)).toContain("Completed");
    expect(await readSafeText(root, target)).toBe("# Request");
    await index.close();
  });

  it("rejects a stale approval when its target changed", async () => {
    const root = await tempRoot();
    const records = new WorkspaceRecords(root);
    await records.initialize(company);
    const index = new RecordsIndex(records);
    await index.start();
    const runtime = new SafeToolRuntime(records, index);
    const conversation = await records.createConversation("developer", "Patch", "gemma4:12b");
    const target = "employees/developer/artifacts/spec.md";
    await atomicWriteText(root, target, "version one");
    const action = await runtime.propose("update_file", { path: target, content: "version two", reason: "Update specification." }, "developer", conversation.id);
    await writeFile(join(root, target), "changed outside approval", "utf8");
    await expect(runtime.execute(action)).rejects.toThrow("target changed");
    expect(await readFile(join(root, target), "utf8")).toBe("changed outside approval");
    await index.close();
  });

  it("turns an approved employee handoff into both an audit record and an assigned task", async () => {
    const root = await tempRoot(); const records = new WorkspaceRecords(root); await records.initialize(company); const index = new RecordsIndex(records); await index.start(); const runtime = new SafeToolRuntime(records, index);
    const conversation = await records.createConversation("marketing", "Campaign handoff", "gemma4:12b");
    const action = await runtime.propose("handoff_task", { toEmployeeId: "social-media", task: "Draft launch posts", context: "Use the approved campaign direction.", reason: "Assign platform execution." }, "marketing", conversation.id);
    expect(action.targetPaths).toHaveLength(2); await runtime.execute(action);
    expect(await readSafeText(root, action.targetPaths[0])).toContain("Handoff: Draft launch posts"); expect(await readSafeText(root, action.targetPaths[1])).toContain("Status: open"); await index.close();
  });

  it("calculates without exposing arbitrary JavaScript", async () => {
    const root = await tempRoot();
    const records = new WorkspaceRecords(root);
    await records.initialize(company);
    const index = new RecordsIndex(records);
    await index.start();
    const runtime = new SafeToolRuntime(records, index);
    expect((await runtime.executeReadOnly("calculate", { expression: "(12 + 3) * 4" })).output).toBe("60");
    await expect(runtime.executeReadOnly("calculate", { expression: "process.exit()" })).rejects.toThrow("unsupported");
    await index.close();
  });
});
