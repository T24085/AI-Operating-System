import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile, copyFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  ActionProposalSchema,
  BackupManifestSchema,
  CampaignAssetSchema,
  CampaignFileSchema,
  CampaignPackageSchema,
  CampaignPostSchema,
  CampaignSchema,
  CrmActivitySchema,
  CrmAppointmentSchema,
  CrmContactSchema,
  CrmLeadSchema,
  CrmTaskSchema,
  DeliverableAccessGrantSchema,
  DeliverableSchema,
  ProjectSchema,
  ProposalSchema,
  QuoteSchema,
  ServiceCaseEventSchema,
  ServiceCaseSchema,
  SalesQualificationEventSchema,
  SalesQualificationSchema,
  WorkItemSchema,
  type BackupManifest,
  type RecordHealthIssue,
} from "../shared/schemas.js";
import type { AppConfig } from "./config.js";

const SCHEMA_VERSION = 1;
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const normalized = (root: string, file: string) => relative(root, file).split("\\").join("/");

async function walk(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) output.push(file);
    }
  }
  await visit(root);
  return output;
}

function embeddedJson(text: string, marker: string): unknown {
  const match = text.match(new RegExp(`<!-- ${marker} (\\{.*\\}) -->`));
  if (!match) throw new Error(`Missing ${marker} metadata.`);
  return JSON.parse(match[1]);
}

function schemaVersion(text: string): number {
  const value = text.match(/^schema_version:\s*(\d+)$/m)?.[1];
  return value ? Number(value) : 0;
}

export class RecordHealthRegistry {
  private readonly issues = new Map<string, RecordHealthIssue>();

  report(path: string, recordKind: string, error: unknown, version = 0): void {
    const validationError = error instanceof Error ? error.message : String(error);
    this.issues.set(path, {
      path, recordKind, validationError: validationError.slice(0, 1000), severity: "error",
      detectedAt: new Date().toISOString(), schemaVersion: version,
    });
  }

  clear(path: string): void { this.issues.delete(path); }
  list(): RecordHealthIssue[] { return [...this.issues.values()].sort((a, b) => a.path.localeCompare(b.path)); }

  async scan(workspaceRoot: string): Promise<RecordHealthIssue[]> {
    const retained = [...this.issues.values()].filter((issue) => issue.recordKind === "campaign-file-extraction");
    this.issues.clear();
    retained.forEach((issue) => this.issues.set(issue.path, issue));
    const files = (await walk(workspaceRoot)).filter((file) => file.endsWith(".md"));
    for (const file of files) {
      const path = normalized(workspaceRoot, file);
      let kind = "markdown";
      try {
        const text = await readFile(file, "utf8");
        const version = schemaVersion(text);
        const crm = path.match(/^crm\/(contacts|leads|appointments|tasks|activities|service-cases|sales-qualifications)\//);
        const ops = path.match(/^shared\/(work-items|deliverables|quotes|projects|proposals)\//);
        const campaign = path.match(/^shared\/(campaigns|campaign-posts|campaign-assets\/records|campaign-files\/records|campaign-packages)\//);
        if (crm) {
          kind = `crm:${crm[1]}`;
          if (crm[1] === "service-cases") {
            ServiceCaseSchema.parse(embeddedJson(text, "SERVICE_CASE_META"));
            for (const match of text.matchAll(/<!-- CASE_EVENT (\{.*\}) -->/g)) ServiceCaseEventSchema.parse(JSON.parse(match[1]));
          } else if (crm[1] === "sales-qualifications") {
            SalesQualificationSchema.parse(embeddedJson(text, "SALES_QUALIFICATION_META"));
            for (const match of text.matchAll(/<!-- SALES_QUALIFICATION_EVENT (\{.*\}) -->/g)) SalesQualificationEventSchema.parse(JSON.parse(match[1]));
          } else {
            const schema = { contacts: CrmContactSchema, leads: CrmLeadSchema, appointments: CrmAppointmentSchema, tasks: CrmTaskSchema, activities: CrmActivitySchema }[crm[1]];
            schema!.parse(embeddedJson(text, "CRM_META"));
          }
        } else if (campaign && !path.endsWith("/.keep.md") && !path.endsWith(".manifest.json")) {
          kind = `campaign:${campaign[1]}`;
          const definitions = {
            campaigns: ["CAMPAIGN_META", CampaignSchema],
            "campaign-posts": ["CAMPAIGN_POST_META", CampaignPostSchema],
            "campaign-assets/records": ["CAMPAIGN_ASSET_META", CampaignAssetSchema],
            "campaign-files/records": ["CAMPAIGN_FILE_META", CampaignFileSchema],
            "campaign-packages": ["CAMPAIGN_PACKAGE_META", CampaignPackageSchema],
          } as const;
          const definition = definitions[campaign[1] as keyof typeof definitions];
          definition[1].parse(embeddedJson(text, definition[0]));
        } else if (ops && !path.endsWith("-content.md")) {
          kind = `operations:${ops[1]}`;
          const schema = { "work-items": WorkItemSchema, deliverables: DeliverableSchema, quotes: QuoteSchema, projects: ProjectSchema, proposals: ProposalSchema }[ops[1]];
          const metadata = embeddedJson(text, "OPS_META") as Record<string, unknown>;
          schema!.parse(metadata);
          if (ops[1] === "deliverables" && Array.isArray(metadata.accessGrants)) metadata.accessGrants.forEach((grant) => DeliverableAccessGrantSchema.parse(grant));
        } else if (/^employees\/[^/]+\/actions\//.test(path)) {
          kind = "action";
          ActionProposalSchema.parse(embeddedJson(text, "ACTION_META"));
        } else if (/^employees\/[^/]+\/conversations\//.test(path)) {
          kind = "conversation";
          const front = text.match(/^---\n([\s\S]*?)\n---/);
          if (!front || !/^id:\s*"[^"]+"/m.test(front[1]) || !/^employee:\s*"[^"]+"/m.test(front[1]) || !/^created_at:\s*"[^"]+"/m.test(front[1])) throw new Error("Conversation frontmatter is incomplete.");
          for (const match of text.matchAll(/<!-- EVENT (\{.*\}) -->/g)) JSON.parse(match[1]);
        } else continue;
        this.clear(path);
      } catch (error) {
        let version = 0;
        try { version = schemaVersion(await readFile(file, "utf8")); } catch { /* retain version zero */ }
        this.report(path, kind, error, version);
      }
    }
    return this.list();
  }
}

function manifestPayload(manifest: Omit<BackupManifest, "manifestHash">): string {
  return JSON.stringify(manifest);
}

export class BackupManager {
  constructor(private readonly dataRoot: string, private readonly config: AppConfig) {}

  private get backupsRoot(): string { return join(this.dataRoot, "backups"); }

  async create(reason: BackupManifest["reason"] = "manual"): Promise<BackupManifest> {
    const createdAt = new Date().toISOString();
    const backupId = `${this.config.settings.businessSlug ?? basename(this.config.workspacePath)}-${createdAt.replace(/[:.]/g, "-")}`;
    const root = join(this.backupsRoot, backupId);
    const workspaceTarget = join(root, "workspace");
    await mkdir(workspaceTarget, { recursive: true });
    const files: BackupManifest["files"] = [];
    for (const source of await walk(this.config.workspacePath)) {
      const path = normalized(this.config.workspacePath, source);
      if (path === "index" || path.startsWith("index/") || /(^|\/)node_modules\//.test(path) || /(^|\/)dist\//.test(path)) continue;
      const info = await stat(source);
      const content = await readFile(source);
      const target = join(workspaceTarget, ...path.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
      files.push({ path: `workspace/${path}`, size: info.size, sha256: sha256(content) });
    }
    const snapshot = Buffer.from(`${JSON.stringify({ schemaVersion: SCHEMA_VERSION, company: this.config.company, settings: this.config.settings }, null, 2)}\n`);
    await writeFile(join(root, "config.snapshot.json"), snapshot);
    files.push({ path: "config.snapshot.json", size: snapshot.byteLength, sha256: sha256(snapshot) });
    files.sort((a, b) => a.path.localeCompare(b.path));
    const unsigned: Omit<BackupManifest, "manifestHash"> = {
      schemaVersion: 1, backupId, createdAt, workspaceSlug: this.config.settings.businessSlug ?? basename(this.config.workspacePath), reason, files,
    };
    const manifest: BackupManifest = { ...unsigned, manifestHash: sha256(manifestPayload(unsigned)) };
    await writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return manifest;
  }

  async validate(backupId: string): Promise<BackupManifest> {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(backupId)) throw Object.assign(new Error("Invalid backup id."), { statusCode: 400 });
    const root = join(this.backupsRoot, backupId);
    const manifest = BackupManifestSchema.parse(JSON.parse(await readFile(join(root, "manifest.json"), "utf8")));
    const { manifestHash, ...unsigned } = manifest;
    if (sha256(manifestPayload(unsigned)) !== manifestHash || manifest.backupId !== backupId) throw Object.assign(new Error("Backup manifest validation failed."), { statusCode: 409 });
    for (const entry of manifest.files) {
      const target = resolve(root, ...entry.path.split("/"));
      const rel = relative(root, target);
      if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) throw Object.assign(new Error("Backup manifest contains an unsafe path."), { statusCode: 409 });
      const content = await readFile(target);
      if (content.byteLength !== entry.size || sha256(content) !== entry.sha256) throw Object.assign(new Error(`Backup file validation failed: ${entry.path}`), { statusCode: 409 });
    }
    return manifest;
  }

  async list(): Promise<BackupManifest[]> {
    let entries;
    try { entries = await readdir(this.backupsRoot, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const valid: BackupManifest[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try { valid.push(await this.validate(entry.name)); } catch { /* invalid backups are never offered for restore */ }
    }
    return valid.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async stageRestore(backupId: string, confirmation: string): Promise<{ manifest: BackupManifest; staging: string; rollback: string }> {
    if (confirmation !== `RESTORE ${backupId}`) throw Object.assign(new Error(`Type RESTORE ${backupId} to confirm.`), { statusCode: 400 });
    const manifest = await this.validate(backupId);
    await this.create("pre-restore");
    const parent = dirname(this.config.workspacePath);
    const staging = join(parent, `.${basename(this.config.workspacePath)}.restore-${process.pid}-${Date.now()}`);
    const rollback = join(parent, `.${basename(this.config.workspacePath)}.rollback-${process.pid}-${Date.now()}`);
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    const backupRoot = join(this.backupsRoot, backupId);
    for (const entry of manifest.files.filter((file) => file.path.startsWith("workspace/"))) {
      const path = entry.path.slice("workspace/".length);
      const target = join(staging, ...path.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(backupRoot, ...entry.path.split("/")), target);
    }
    return { manifest, staging, rollback };
  }

  async swapRestore(staging: string, rollback: string): Promise<void> {
    await rename(this.config.workspacePath, rollback);
    try { await rename(staging, this.config.workspacePath); }
    catch (error) { await rename(rollback, this.config.workspacePath); throw error; }
  }
}
