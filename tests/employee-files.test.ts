import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { safeEmployeeFileName, storeEmployeeFile } from "../src/server/employee-files.js";
import { readSafeText } from "../src/server/paths.js";

const cleanup: string[] = [];
async function root() { const value = await mkdtemp(join(tmpdir(), "aios-employee-files-")); cleanup.push(value); return value; }
afterEach(async () => { await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("employee file uploads", () => {
  it("accepts approved document names and rejects executable extensions", () => {
    expect(safeEmployeeFileName("../../Sales Notes.PDF")).toBe("Sales Notes.pdf");
    expect(() => safeEmployeeFileName("payload.exe")).toThrow("Supported employee files");
  });

  it("stores uploads without overwriting and creates an indexed text companion", async () => {
    const workspace = await root();
    const first = await storeEmployeeFile(workspace, "sales", "Team Notes.txt", Buffer.from("Discovery questions and follow-up guidance."));
    const second = await storeEmployeeFile(workspace, "sales", "Team Notes.txt", Buffer.from("Second edition."));
    expect(first.path).toBe("shared/employee-files/sales/Team Notes.txt");
    expect(second.path).toBe("shared/employee-files/sales/Team Notes-2.txt");
    expect(await readSafeText(workspace, "shared/employee-files/sales/Team Notes.agent.md")).toContain("Discovery questions");
  });

  it("extracts the verified Sales Guide PDF for local agent retrieval", async () => {
    const workspace = await root();
    const pdf = await readFile(join(process.cwd(), "seed", "employee-files", "sales", "Samuel_Studio_Employee_Sales_Guide.pdf"));
    const result = await storeEmployeeFile(workspace, "sales", "Sales Guide.pdf", pdf);
    expect(result.agentReadable).toBe(true);
    expect(await readSafeText(workspace, "shared/employee-files/sales/Sales Guide.agent.md")).toContain("Do not sell pages");
  });
});
