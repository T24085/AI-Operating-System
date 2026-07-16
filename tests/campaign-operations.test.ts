import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { CampaignOperationsStore } from "../src/server/campaign-operations.js";
import { RecordHealthRegistry } from "../src/server/reliability.js";

async function workspace() { return mkdtemp(join(tmpdir(), "aios-campaigns-")); }
async function pdfText(buffer: Buffer) { const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }); try { const pdf = await task.promise; const page = await pdf.getPage(1); const content = await page.getTextContent(); return { pages: pdf.numPages, text: content.items.flatMap((item) => "str" in item ? [item.str] : []).join(" ") }; } finally { await task.destroy(); } }
async function readyCampaign(store: CampaignOperationsStore) {
  const campaign = await store.createCampaign({ title: "Midnight Editorial Launch", businessLine: "Samuel Studio", objective: "Introduce the fall editorial portrait collection.", audience: "Creative founders in Chicago.", offer: "Editorial portrait session", channels: ["Instagram", "LinkedIn"], callToAction: "Book a consultation", createdBy: "owner" });
  await store.createPost(campaign.id, { platform: "Instagram", plannedAt: "2026-10-01T15:00:00.000Z", objective: "Launch awareness", copy: "A quieter kind of presence. The fall editorial portrait collection is ready.", callToAction: "Book a consultation", altText: "Editorial portrait in a dark studio setting", status: "awaiting_owner", createdBy: "social-media" });
  return campaign;
}

describe("Campaign Operations and Campaign Files", () => {
  it("creates canonical campaigns and posts without public routing or numeric scoring", async () => {
    const root = await workspace(); const store = new CampaignOperationsStore(root); await store.initialize(); const campaign = await readyCampaign(store);
    const operations = await store.operations(); expect(operations.campaigns).toHaveLength(1); expect(operations.posts).toHaveLength(1);
    expect(campaign).not.toHaveProperty("score"); expect(await readFile(join(root, campaign.file), "utf8")).toContain("schema_version: 1");
  });

  it("preserves strategy fields during a partial campaign update", async () => {
    const root = await workspace(); const store = new CampaignOperationsStore(root); await store.initialize(); const campaign = await readyCampaign(store);
    const updated = await store.updateCampaign(campaign.id, { nextStep: "Owner reviews the launch package." });
    expect(updated.objective).toBe(campaign.objective); expect(updated.audience).toBe(campaign.audience); expect(updated.callToAction).toBe(campaign.callToAction);
    expect(updated.nextStep).toBe("Owner reviews the launch package.");
  });

  it("generates immutable brief and calendar PDFs and reuses an approved package", async () => {
    const root = await workspace(); const store = new CampaignOperationsStore(root); await store.initialize(); const campaign = await readyCampaign(store);
    const first = await store.approvePackage(campaign.id, "approval-action-1"); const retry = await store.approvePackage(campaign.id, "approval-action-1");
    expect(retry.id).toBe(first.id); const files = await store.listFiles(campaign.id); expect(files.filter((item) => item.source === "generated")).toHaveLength(2);
    for (const record of files) { const buffer = await readFile(join(root, record.path)); expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-"); const parsed = await pdfText(buffer); expect(parsed.pages).toBeGreaterThan(0); expect(parsed.text).toContain("Midnight Editorial Launch"); }
    const packageBuffer = (await store.readPackage(first.id)).content; expect(packageBuffer.byteLength).toBeGreaterThan(1000);
    expect((await store.listPosts(campaign.id))[0].status).toBe("publish_ready"); expect((await store.getCampaign(campaign.id)).status).toBe("approved");
  }, 15_000);

  it("requires approved rights for referenced assets", async () => {
    const root = await workspace(); const store = new CampaignOperationsStore(root); await store.initialize();
    const campaign = await store.createCampaign({ title: "Rights Review", objective: "Launch approved photography.", audience: "Studio clients", callToAction: "View the work", createdBy: "owner" });
    const asset = await store.storeAsset(campaign.id, "portrait.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3]));
    await store.createPost(campaign.id, { platform: "Instagram", copy: "New work", callToAction: "View", altText: "Portrait", assetIds: [asset.id], status: "awaiting_owner", createdBy: "owner" });
    await expect(store.approvePackage(campaign.id, "blocked-action")).rejects.toThrow(/approved usage rights/i);
    await store.updateAsset(campaign.id, asset.id, { approvalStatus: "approved", usageRights: "Owned by Samuel Studio for campaign and social use." });
    await expect(store.approvePackage(campaign.id, "approved-action")).resolves.toMatchObject({ status: "publish_ready" });
  }, 15_000);

  it("deduplicates uploaded PDFs and reports malformed canonical records without rewriting them", async () => {
    const root = await workspace(); const health = new RecordHealthRegistry(); const store = new CampaignOperationsStore(root, health); await store.initialize(); const campaign = await readyCampaign(store); await store.approvePackage(campaign.id, "pdf-source");
    const generated = (await store.listFiles(campaign.id)).find((item) => item.kind === "campaign_brief")!; const pdf = await readFile(join(root, generated.path));
    const uploaded = await store.uploadCampaignPdf(campaign.id, "outside-brief.pdf", "external_brief", "Owner-provided brief", pdf); const duplicate = await store.uploadCampaignPdf(campaign.id, "duplicate.pdf", "external_brief", "Duplicate", pdf); expect(duplicate.id).toBe(uploaded.id);
    const preserved = await store.uploadCampaignPdf(campaign.id, "unreadable.pdf", "report", "Owner-provided unreadable PDF", Buffer.from("%PDF-broken-but-preserved"));
    const malformedPath = join(root, "shared", "campaigns", "malformed.md"); const malformed = "---\nid: broken\n---\n\nReadable original"; await writeFile(malformedPath, malformed);
    const issues = await health.scan(root); expect(issues.some((item) => item.path === "shared/campaigns/malformed.md")).toBe(true); expect(issues.some((item) => item.recordKind === "campaign-file-extraction" && item.path.endsWith("unreadable.pdf"))).toBe(true); expect(await readFile(join(root, preserved.path))).toEqual(Buffer.from("%PDF-broken-but-preserved")); expect(await readFile(malformedPath, "utf8")).toBe(malformed);
  }, 15_000);
});
