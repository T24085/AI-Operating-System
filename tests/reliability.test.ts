import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { offers } from "../src/shared/offers.js";
import { OnboardingInputSchema, SettingsSchema } from "../src/shared/schemas.js";
import type { AppConfig } from "../src/server/config.js";
import { RecordsIndex } from "../src/server/indexer.js";
import { OperationsStore } from "../src/server/operations.js";
import { WorkspaceRecords } from "../src/server/records.js";
import { BackupManager, RecordHealthRegistry } from "../src/server/reliability.js";
import { privateAddress, readLimitedBody } from "../src/server/web-research.js";
import { BoundedRateLimiter } from "../src/server/rate-limit.js";

const cleanup: string[] = [];
const company = OnboardingInputSchema.parse({ companyName: "Reliability Studio", ownerName: "Owner", industry: "Creative services", description: "A local-first creative services studio.", services: "Photography and websites", hours: "Weekdays", policies: "Owner approval required.", tone: "Clear and warm", goals: "Reliable client service", currency: "USD", timezone: "America/Chicago" });

async function fixture() {
  const dataRoot = await mkdtemp(join(tmpdir(), "aios-reliability-")); cleanup.push(dataRoot);
  const workspacePath = join(dataRoot, "workspaces", "reliability-studio"); const records = new WorkspaceRecords(workspacePath); await records.initialize(company);
  const config: AppConfig = { company, workspacePath, settings: SettingsSchema.parse({ businessSlug: "reliability-studio" }) };
  return { dataRoot, workspacePath, records, config };
}

afterEach(async () => { await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("record health and recoverable backups", () => {
  it("keeps malformed Markdown unchanged and reports it through diagnostics", async () => {
    const { workspacePath } = await fixture(); const health = new RecordHealthRegistry();
    const file = join(workspacePath, "crm", "contacts", "broken.md"); const original = "# Still readable\n\nOwner recovery notes remain intact.\n"; await mkdir(join(workspacePath, "crm", "contacts"), { recursive: true }); await writeFile(file, original);
    const issues = await health.scan(workspacePath);
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: "crm/contacts/broken.md", recordKind: "crm:contacts", schemaVersion: 0 })]));
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("validates a restore, makes a pre-restore backup, swaps atomically, and rebuilds the index", async () => {
    const { dataRoot, workspacePath, config } = await fixture(); const manager = new BackupManager(dataRoot, config);
    const profile = join(workspacePath, "company", "PROFILE.md"); const original = await readFile(profile, "utf8"); const backup = await manager.create();
    await writeFile(profile, "# Corrupted working copy\n");
    const staged = await manager.stageRestore(backup.backupId, `RESTORE ${backup.backupId}`); await manager.swapRestore(staged.staging, staged.rollback);
    expect(await readFile(profile, "utf8")).toBe(original);
    expect((await manager.list()).some((item) => item.reason === "pre-restore")).toBe(true);
    const records = new WorkspaceRecords(workspacePath); const index = new RecordsIndex(records); await index.start();
    expect(index.search("Reliability Studio")[0]?.path).toBe("company/PROFILE.md"); await index.close();
  });

  it("rejects a corrupt manifest and restores the old directory when a swap fails", async () => {
    const { dataRoot, workspacePath, config } = await fixture(); const manager = new BackupManager(dataRoot, config); const backup = await manager.create();
    const manifestFile = join(dataRoot, "backups", backup.backupId, "manifest.json"); const parsed = JSON.parse(await readFile(manifestFile, "utf8")); parsed.files[0].sha256 = "0".repeat(64); await writeFile(manifestFile, JSON.stringify(parsed));
    await expect(manager.validate(backup.backupId)).rejects.toThrow("validation failed");
    const second = await manager.create(); const staged = await manager.stageRestore(second.backupId, `RESTORE ${second.backupId}`); await rm(staged.staging, { recursive: true, force: true });
    await expect(manager.swapRestore(staged.staging, staged.rollback)).rejects.toThrow();
    expect(await readFile(join(workspacePath, "company", "PROFILE.md"), "utf8")).toContain("Reliability Studio");
  });
});

describe("deliverable grants and research boundaries", () => {
  it("keeps an old deliverable link valid after resume-style reissue and revokes it explicitly", async () => {
    const { workspacePath } = await fixture(); const operations = new OperationsStore(workspacePath); await operations.initialize();
    const created = await operations.createPublishedQuote({ conversationId: "conversation1", contactId: "contact1", leadId: "lead1", employeeId: "sales", customerName: "Client", projectName: "Client project", offers: [offers[0]], customNeeds: [], stale: false });
    const oldToken = new URL(created.published.deliverable.accessUrl!, "http://localhost").searchParams.get("token")!;
    const reissued = await operations.reissueCustomerDeliverable(created.published.deliverable.id); const newToken = new URL(reissued.accessUrl!, "http://localhost").searchParams.get("token")!;
    await expect(operations.publicDeliverable(reissued.id, oldToken)).resolves.toBeTruthy(); await expect(operations.publicDeliverable(reissued.id, newToken)).resolves.toBeTruthy();
    const [oldGrant] = await operations.accessGrantsFor(reissued.id); await operations.revokeAccessGrant(reissued.id, oldGrant.id);
    await expect(operations.publicDeliverable(reissued.id, oldToken)).rejects.toThrow("not valid"); await expect(operations.publicDeliverable(reissued.id, newToken)).resolves.toBeTruthy();
  });

  it("blocks private ranges and chunked bodies beyond the hard 1 MB limit", async () => {
    expect(privateAddress("127.0.0.1")).toBe(true); expect(privateAddress("10.0.0.2")).toBe(true); expect(privateAddress("169.254.1.1")).toBe(true); expect(privateAddress("8.8.8.8")).toBe(false);
    async function* oversized() { yield new Uint8Array(700_000); yield new Uint8Array(400_001); }
    await expect(readLimitedBody(oversized())).rejects.toThrow("1 MB");
  });
});

describe("bounded rate limiting", () => {
  it("keeps trusted-proxy client buckets distinct and expires old windows", () => {
    const limiter = new BoundedRateLimiter(3, 2);
    limiter.enforce("public:203.0.113.10", 1, 100, 1_000);
    limiter.enforce("public:203.0.113.11", 1, 100, 1_000);
    expect(() => limiter.enforce("public:203.0.113.10", 1, 100, 1_050)).toThrow(/Too many requests/);
    expect(() => limiter.enforce("public:203.0.113.11", 1, 100, 1_050)).toThrow(/Too many requests/);
    limiter.enforce("public:203.0.113.12", 1, 100, 1_200);
    limiter.enforce("public:203.0.113.13", 1, 100, 1_200);
    expect(limiter.size).toBeLessThanOrEqual(3);
  });
});
