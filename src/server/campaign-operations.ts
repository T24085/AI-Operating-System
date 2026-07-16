import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import PDFDocument from "pdfkit";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { nanoid } from "nanoid";
import { zipSync } from "fflate";
import {
  CampaignAssetPatchSchema,
  CampaignAssetSchema,
  CampaignCreateSchema,
  CampaignFileSchema,
  CampaignOperationsResponseSchema,
  CampaignPackageSchema,
  CampaignPatchSchema,
  CampaignPostInputSchema,
  CampaignPostPatchSchema,
  CampaignPostSchema,
  CampaignSchema,
  type Campaign,
  type CampaignAsset,
  type CampaignFile,
  type CampaignOperationsResponse,
  type CampaignPost,
  type CampaignPublishPackage,
} from "../shared/schemas.js";
import {
  atomicWriteBuffer,
  atomicWriteText,
  pathExists,
  resolveSafePath,
} from "./paths.js";
import type { RecordHealthRegistry } from "./reliability.js";

const now = () => new Date().toISOString();
const sha256 = (value: string | Buffer | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const marker = (kind: string, value: unknown) =>
  `<!-- ${kind} ${JSON.stringify(value).replace(/-->/g, "--\\>")} -->`;
const parseMarker = (text: string, kind: string): unknown => {
  const match = text.match(new RegExp(`<!-- ${kind} (\\{.*\\}) -->`));
  if (!match) throw new Error(`Missing ${kind} metadata.`);
  return JSON.parse(match[1]);
};
const slug = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 70) || "campaign";
const event = (
  type: Campaign["events"][number]["type"],
  actor: Campaign["events"][number]["actor"],
  summary: string,
  detail = "",
  operationId: string | null = null,
) => ({
  id: nanoid(12),
  type,
  actor,
  summary,
  detail,
  operationId,
  createdAt: now(),
});

const attentionRules: Array<[RegExp, string]> = [
  [
    /\b(testimonial|review says|customer says)\b/i,
    "Testimonial or endorsement requires verification",
  ],
  [
    /\b(guaranteed|best|number one|#1|proven results|\d+% (?:growth|increase|conversion))\b/i,
    "Performance or comparative claim requires evidence",
  ],
  [
    /\b(discount|sale|limited time|last chance|only \d+ left|available now)\b/i,
    "Price, urgency, or availability claim requires owner confirmation",
  ],
  [
    /\b(sponsored|partnered|giveaway|contest|sweepstakes)\b/i,
    "Sponsorship or promotion requires owner and policy review",
  ],
];
function attention(text: string): string[] {
  return attentionRules
    .filter(([rule]) => rule.test(text))
    .map(([, reason]) => reason);
}

function campaignMarkdown(value: Campaign): string {
  return `---\nschema_version: 1\nid: ${JSON.stringify(value.id)}\ntype: "campaign"\ncreated_at: ${JSON.stringify(value.createdAt)}\n---\n\n# ${value.title}\n\n- Status: ${value.status}\n- Business line: ${value.businessLine}\n- Version: ${value.version}\n- Next step: ${value.nextStep || "Not set"}\n\n## Objective\n\n${value.objective || "Not established."}\n\n## Audience\n\n${value.audience || "Not established."}\n\n## Offer and CTA\n\n${value.offer || "Not established."}\n\n${value.callToAction || "No CTA established."}\n\n## Message hierarchy\n\n${value.messageHierarchy.map((item) => `- ${item}`).join("\n") || "- Not established."}\n\n## Verified proof\n\n${value.proof.map((item) => `- ${item}`).join("\n") || "- None linked."}\n\n## Owner attention\n\n${value.ownerAttentionReasons.map((item) => `- ${item}`).join("\n") || "- None."}\n\n## Timeline\n\n${value.events.map((item) => `- ${item.createdAt} — ${item.summary}`).join("\n")}\n\n${marker("CAMPAIGN_META", value)}\n`;
}
function postMarkdown(value: CampaignPost): string {
  const current = value.revisions.find(
    (item) => item.revision === value.currentRevision,
  )!;
  return `---\nschema_version: 1\nid: ${JSON.stringify(value.id)}\ntype: "campaign-post"\ncreated_at: ${JSON.stringify(value.createdAt)}\n---\n\n# ${value.platform} post\n\n- Campaign: ${value.campaignId}\n- Status: ${value.status}\n- Planned: ${value.plannedAt ?? "Not scheduled"}\n- Revision: ${value.currentRevision}\n\n## Copy\n\n${current.copy || "No copy yet."}\n\n## CTA and accessibility\n\n${current.callToAction || "No CTA."}\n\nAlt text: ${current.altText || "Missing"}\n\n${marker("CAMPAIGN_POST_META", value)}\n`;
}
function assetMarkdown(value: CampaignAsset): string {
  return `---\nschema_version: 1\nid: ${JSON.stringify(value.id)}\ntype: "campaign-asset"\ncreated_at: ${JSON.stringify(value.createdAt)}\n---\n\n# ${value.name}\n\n- Campaign: ${value.campaignId}\n- Approval: ${value.approvalStatus}\n- Checksum: ${value.checksum}\n- Source: ${value.source}\n- Creator: ${value.creator || "Unknown"}\n- Credit: ${value.credit || "Missing"}\n- Usage rights: ${value.usageRights || "Missing"}\n\n${marker("CAMPAIGN_ASSET_META", value)}\n`;
}
function fileMarkdown(value: CampaignFile): string {
  return `---\nschema_version: 1\nid: ${JSON.stringify(value.id)}\ntype: "campaign-file"\ncreated_at: ${JSON.stringify(value.createdAt)}\n---\n\n# ${value.name}\n\n- Campaign: ${value.campaignId}\n- Kind: ${value.kind}\n- Source: ${value.source}\n- Version: ${value.version}\n- Status: ${value.status}\n- Checksum: ${value.checksum}\n- Provenance: ${value.provenance}\n\n${marker("CAMPAIGN_FILE_META", value)}\n`;
}
function packageMarkdown(value: CampaignPublishPackage): string {
  return `---\nschema_version: 1\nid: ${JSON.stringify(value.id)}\ntype: "campaign-package"\ncreated_at: ${JSON.stringify(value.createdAt)}\n---\n\n# Publish-ready package ${value.id}\n\n- Campaign: ${value.campaignId}\n- Version: ${value.version}\n- Checksum: ${value.checksum}\n\n${marker("CAMPAIGN_PACKAGE_META", value)}\n`;
}

async function pdfBuffer(
  title: string,
  subtitle: string,
  sections: Array<{ heading: string; body: string }>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 54, right: 54, bottom: 58, left: 54 },
      info: { Title: title, Author: "Samuel Studio", Subject: subtitle },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    const pageBottom = 770;
    let pageNumber = 1;
    const drawFooter = () => {
      const footer = `Internal campaign document  -  Page ${pageNumber}`;
      doc.fillColor("#71808b").font("Helvetica").fontSize(7.5);
      doc.text(footer, (doc.page.width - doc.widthOfString(footer)) / 2, 815, { lineBreak: false });
    };
    const drawFirstHeader = () => {
      doc.rect(0, 0, doc.page.width, 126).fill("#071521");
      doc.fillColor("#d7b06a").font("Helvetica-Bold").fontSize(9).text("SAMUEL STUDIO - CAMPAIGN OPERATIONS", 54, 35, { characterSpacing: 1.2, lineBreak: false });
      doc.fillColor("#f2e8d7").font("Times-Bold").fontSize(24).text(title, 54, 56, { width: 487, height: 64, lineGap: 1 });
      doc.y = 148;
    };
    const drawContinuationHeader = () => {
      doc.fillColor("#0b2538").font("Helvetica-Bold").fontSize(8).text(`${title} - ${subtitle.split("-")[0].trim()}`, 54, 34, { width: 487, lineBreak: false });
      doc.strokeColor("#d7b06a").lineWidth(0.7).moveTo(54, 50).lineTo(541, 50).stroke();
      doc.y = 68;
    };
    const addContentPage = () => { drawFooter(); doc.addPage(); pageNumber += 1; drawContinuationHeader(); };
    const wrappedLines = (body: string, width: number): string[] => {
      const output: string[] = [];
      for (const paragraph of body.replace(/\r/g, "").split("\n")) {
        if (!paragraph.trim()) { output.push(""); continue; }
        let line = "";
        for (const word of paragraph.trim().split(/\s+/)) {
          const candidate = line ? `${line} ${word}` : word;
          if (line && doc.widthOfString(candidate) > width) { output.push(line); line = word; }
          else line = candidate;
        }
        if (line) output.push(line);
      }
      return output;
    };
    drawFirstHeader();
    doc
      .fillColor("#607080")
      .font("Helvetica")
      .fontSize(9)
      .text(subtitle, 54, doc.y, { width: 487 });
    for (const section of sections) {
      if (doc.y > pageBottom - 55) addContentPage();
      doc
        .moveDown(1.2)
        .fillColor("#0b2538")
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(section.heading.toUpperCase(), { characterSpacing: 0.7 });
      doc
        .moveDown(0.35)
        .strokeColor("#d7b06a")
        .lineWidth(0.7)
        .moveTo(54, doc.y)
        .lineTo(541, doc.y)
        .stroke();
      doc.moveDown(0.55);
      doc.fillColor("#253746").font("Helvetica").fontSize(9.5);
      for (const line of wrappedLines(section.body || "Not established.", 487)) {
        if (doc.y > pageBottom) { addContentPage(); doc.fillColor("#253746").font("Helvetica").fontSize(9.5); }
        if (!line) doc.y += 7;
        else { doc.text(line, 54, doc.y, { width: 487, lineBreak: false }); doc.y += 3; }
      }
    }
    drawFooter();
    doc.end();
  });
}

async function validatePdf(buffer: Buffer, required: string[]): Promise<void> {
  if (
    buffer.byteLength < 500 ||
    buffer.subarray(0, 5).toString("ascii") !== "%PDF-"
  )
    throw new Error("Generated campaign PDF is invalid.");
  const parsed = await extractPdf(buffer);
  if (parsed.pages < 1) throw new Error("Generated campaign PDF has no pages.");
  for (const text of required)
    if (!parsed.text.toLowerCase().includes(text.toLowerCase()))
      throw new Error(`Generated campaign PDF is missing ${text}.`);
}

async function extractPdf(
  buffer: Buffer,
): Promise<{ pages: number; text: string }> {
  const task = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    verbosity: 0,
  });
  try {
    const pdf = await task.promise;
    const chunks: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      chunks.push(
        content.items
          .flatMap((item) => ("str" in item ? [item.str] : []))
          .join(" "),
      );
    }
    return { pages: pdf.numPages, text: chunks.join("\n") };
  } finally {
    await task.destroy();
  }
}

export class CampaignOperationsStore {
  constructor(
    private readonly root: string,
    private readonly health?: RecordHealthRegistry,
  ) {}
  async initialize(): Promise<void> {
    for (const path of [
      "shared/campaigns",
      "shared/campaign-posts",
      "shared/campaign-assets/records",
      "shared/campaign-files/records",
      "shared/campaign-packages",
    ])
      await atomicWriteText(
        this.root,
        `${path}/.keep.md`,
        "# Reserved canonical campaign records\n",
      ).catch(() => undefined);
  }

  async listCampaigns(): Promise<Campaign[]> {
    return this.listRecords(
      "shared/campaigns",
      "CAMPAIGN_META",
      CampaignSchema,
      "campaign",
      (name) => name !== ".keep.md",
    );
  }
  async listPosts(campaignId?: string): Promise<CampaignPost[]> {
    const values = await this.listRecords(
      "shared/campaign-posts",
      "CAMPAIGN_POST_META",
      CampaignPostSchema,
      "campaign-post",
      (name) => name !== ".keep.md",
    );
    return campaignId
      ? values.filter((item) => item.campaignId === campaignId)
      : values;
  }
  async listAssets(campaignId?: string): Promise<CampaignAsset[]> {
    const values = await this.listRecords(
      "shared/campaign-assets/records",
      "CAMPAIGN_ASSET_META",
      CampaignAssetSchema,
      "campaign-asset",
      (name) => name !== ".keep.md",
    );
    return campaignId
      ? values.filter((item) => item.campaignId === campaignId)
      : values;
  }
  async listFiles(campaignId?: string): Promise<CampaignFile[]> {
    const values = await this.listRecords(
      "shared/campaign-files/records",
      "CAMPAIGN_FILE_META",
      CampaignFileSchema,
      "campaign-file",
      (name) => name !== ".keep.md",
    );
    return campaignId
      ? values.filter((item) => item.campaignId === campaignId)
      : values;
  }
  async listPackages(campaignId?: string): Promise<CampaignPublishPackage[]> {
    const values = await this.listRecords(
      "shared/campaign-packages",
      "CAMPAIGN_PACKAGE_META",
      CampaignPackageSchema,
      "campaign-package",
      (name) => name.endsWith(".md") && name !== ".keep.md",
    );
    return campaignId
      ? values.filter((item) => item.campaignId === campaignId)
      : values;
  }
  async operations(): Promise<CampaignOperationsResponse> {
    const [campaigns, posts, assets, files, packages] = await Promise.all([
      this.listCampaigns(),
      this.listPosts(),
      this.listAssets(),
      this.listFiles(),
      this.listPackages(),
    ]);
    return CampaignOperationsResponseSchema.parse({
      campaigns,
      posts,
      assets,
      files,
      packages,
      summary: {
        draft: campaigns.filter((x) => ["draft", "planning"].includes(x.status))
          .length,
        awaitingOwner: campaigns.filter((x) => x.status === "awaiting_owner")
          .length,
        active: campaigns.filter((x) => x.status === "active").length,
        publishReadyPosts: posts.filter((x) => x.status === "publish_ready")
          .length,
        missingRights: assets.filter((x) => x.approvalStatus !== "approved")
          .length,
      },
    });
  }

  async getCampaign(id: string): Promise<Campaign> {
    const found = (await this.listCampaigns()).find((item) => item.id === id);
    if (!found)
      throw Object.assign(new Error("Campaign not found."), {
        statusCode: 404,
      });
    return found;
  }
  async createCampaign(
    input: unknown,
    operationId: string | null = null,
  ): Promise<Campaign> {
    const parsed = CampaignCreateSchema.parse(input);
    const existing = (await this.listCampaigns()).find(
      (item) =>
        (operationId &&
          item.events.some((entry) => entry.operationId === operationId)) ||
        (item.status !== "archived" &&
          ((parsed.projectId && item.projectId === parsed.projectId) ||
            (parsed.salesQualificationId &&
              item.salesQualificationId === parsed.salesQualificationId))),
    );
    if (existing) return existing;
    const stamp = now();
    const id = nanoid(12);
    const reasons = attention(
      [
        parsed.objective,
        parsed.offer,
        parsed.callToAction,
        ...parsed.proof,
      ].join("\n"),
    );
    const value = CampaignSchema.parse({
      ...parsed,
      id,
      status: "draft",
      ownerAttention: reasons.length > 0,
      ownerAttentionReasons: reasons,
      evidence: [],
      version: 1,
      events: [
        event(
          "created",
          parsed.createdBy === "sales"
            ? "sales"
            : parsed.createdBy === "owner"
              ? "owner"
              : "system",
          "Campaign created",
          parsed.objective,
          operationId,
        ),
      ],
      createdAt: stamp,
      updatedAt: stamp,
      file: `shared/campaigns/${id}.md`,
    });
    await this.writeCampaign(value);
    return value;
  }
  async updateCampaign(
    id: string,
    patch: unknown,
    actor: "owner" | "marketing" | "social-media" = "owner",
    operationId: string | null = null,
  ): Promise<Campaign> {
    const current = await this.getCampaign(id);
    const parsed = CampaignPatchSchema.parse(patch);
    const supplied = patch && typeof patch === "object" ? patch as Record<string, unknown> : {};
    const changes = Object.fromEntries(Object.entries(parsed).filter(([key]) => Object.prototype.hasOwnProperty.call(supplied, key)));
    const stamp = now();
    const evidence = changes.evidence
      ? parsed.evidence!.map((item) => ({
          ...item,
          id: nanoid(12),
          addedAt: stamp,
        }))
      : current.evidence;
    const merged = { ...current, ...changes, evidence };
    const reasons = attention(
      [
        merged.objective,
        merged.offer,
        merged.callToAction,
        ...merged.proof,
        ...merged.messageHierarchy,
      ].join("\n"),
    );
    const value = CampaignSchema.parse({
      ...merged,
      ownerAttention: reasons.length > 0,
      ownerAttentionReasons: reasons,
      version: current.version + 1,
      updatedAt: stamp,
      events: [
        ...current.events,
        event(
          parsed.status && parsed.status !== current.status
            ? "status_changed"
            : "updated",
          actor,
          "Campaign updated",
          parsed.status
            ? `Status: ${parsed.status}`
            : "Campaign fields revised.",
          operationId,
        ),
      ],
    });
    await this.writeCampaign(value);
    return value;
  }
  async createPost(campaignId: string, input: unknown, operationId: string | null = null): Promise<CampaignPost> {
    await this.getCampaign(campaignId);
    const parsed = CampaignPostInputSchema.parse(input);
    if (operationId) {
      const existing = (await this.listPosts(campaignId)).find((item) => item.operationId === operationId);
      if (existing) return existing;
    }
    const stamp = now();
    const id = nanoid(12);
    const reasons = [
      ...attention(`${parsed.copy}\n${parsed.claims.join("\n")}`),
      ...(!parsed.altText && parsed.assetIds.length
        ? ["Alt text is missing"]
        : []),
    ];
    const revision = {
      revision: 1,
      copy: parsed.copy,
      callToAction: parsed.callToAction,
      destinationUrl: parsed.destinationUrl ?? null,
      altText: parsed.altText,
      assetIds: parsed.assetIds,
      claims: parsed.claims,
      createdBy: parsed.createdBy,
      createdAt: stamp,
    };
    const value = CampaignPostSchema.parse({
      id,
      campaignId,
      platform: parsed.platform,
      plannedAt: parsed.plannedAt ?? null,
      objective: parsed.objective,
      status: parsed.status,
      currentRevision: 1,
      revisions: [revision],
      ownerAttention: reasons.length > 0,
      ownerAttentionReasons: reasons,
      operationId,
      publishedUrl: null,
      publishedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
      file: `shared/campaign-posts/${id}.md`,
    });
    await this.writePost(value);
    await this.touchCampaign(campaignId, "post_added", "Campaign post added");
    return value;
  }
  async updatePost(
    campaignId: string,
    id: string,
    patch: unknown,
    actor: "owner" | "marketing" | "social-media" = "owner",
  ): Promise<CampaignPost> {
    const current = (await this.listPosts(campaignId)).find(
      (item) => item.id === id,
    );
    if (!current)
      throw Object.assign(new Error("Campaign post not found."), {
        statusCode: 404,
      });
    const parsed = CampaignPostPatchSchema.parse(patch);
    if (parsed.status === "published_external" && actor !== "owner")
      throw Object.assign(
        new Error("Only the owner can confirm external publication."),
        { statusCode: 403 },
      );
    if (
      parsed.status === "published_external" &&
      (!parsed.publishedUrl || !parsed.publishedAt)
    )
      throw new Error(
        "External publication requires a public URL and timestamp.",
      );
    const oldRevision = current.revisions.find(
      (item) => item.revision === current.currentRevision,
    )!;
    const revisionChanged = [
      "copy",
      "callToAction",
      "destinationUrl",
      "altText",
      "assetIds",
      "claims",
    ].some((key) => key in parsed);
    const revision = revisionChanged
      ? {
          ...oldRevision,
          ...parsed,
          revision: current.currentRevision + 1,
          createdBy: actor,
          createdAt: now(),
        }
      : oldRevision;
    const reasons = [
      ...attention(`${revision.copy}\n${revision.claims.join("\n")}`),
      ...(!revision.altText && revision.assetIds.length
        ? ["Alt text is missing"]
        : []),
    ];
    const value = CampaignPostSchema.parse({
      ...current,
      platform: parsed.platform ?? current.platform,
      plannedAt:
        parsed.plannedAt === undefined ? current.plannedAt : parsed.plannedAt,
      objective: parsed.objective ?? current.objective,
      status:
        parsed.status ??
        (revisionChanged && current.status === "publish_ready"
          ? "draft"
          : current.status),
      currentRevision: revision.revision,
      revisions: revisionChanged
        ? [...current.revisions, revision]
        : current.revisions,
      ownerAttention: reasons.length > 0,
      ownerAttentionReasons: reasons,
      publishedUrl:
        parsed.publishedUrl === undefined
          ? current.publishedUrl
          : parsed.publishedUrl,
      publishedAt:
        parsed.publishedAt === undefined
          ? current.publishedAt
          : parsed.publishedAt,
      updatedAt: now(),
    });
    await this.writePost(value);
    return value;
  }

  async storeAsset(
    campaignId: string,
    originalName: string,
    body: Buffer,
  ): Promise<CampaignAsset> {
    await this.getCampaign(campaignId);
    if (!body.length) throw new Error("Choose a non-empty campaign asset.");
    const extension = extname(originalName).toLowerCase();
    const types: Record<string, string> = {
      ".pdf": "application/pdf",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
    };
    if (!types[extension])
      throw new Error("Campaign assets must be PDF, PNG, or JPEG files.");
    const safe = this.safeName(originalName, new Set(Object.keys(types)));
    const checksum = sha256(body);
    const duplicate = (await this.listAssets(campaignId)).find(
      (item) => item.checksum === checksum,
    );
    if (duplicate) return duplicate;
    const stamp = now();
    const id = nanoid(12);
    const path = `shared/campaign-assets/${campaignId}/${id}-${safe}`;
    await atomicWriteBuffer(this.root, path, body);
    const value = CampaignAssetSchema.parse({
      id,
      campaignId,
      name: safe,
      path,
      mediaType: types[extension],
      size: body.byteLength,
      checksum,
      source: "owner upload",
      creator: "",
      credit: "",
      usageRights: "",
      rightsExpireAt: null,
      approvalStatus: "supplied",
      createdAt: stamp,
      updatedAt: stamp,
      file: `shared/campaign-assets/records/${id}.md`,
    });
    await atomicWriteText(this.root, value.file, assetMarkdown(value));
    await this.touchCampaign(campaignId, "asset_added", "Campaign asset added");
    return value;
  }
  async updateAsset(
    campaignId: string,
    id: string,
    patch: unknown,
  ): Promise<CampaignAsset> {
    const current = (await this.listAssets(campaignId)).find(
      (item) => item.id === id,
    );
    if (!current)
      throw Object.assign(new Error("Campaign asset not found."), {
        statusCode: 404,
      });
    const value = CampaignAssetSchema.parse({
      ...current,
      ...CampaignAssetPatchSchema.parse(patch),
      updatedAt: now(),
    });
    await atomicWriteText(this.root, value.file, assetMarkdown(value));
    return value;
  }

  async uploadCampaignPdf(
    campaignId: string,
    originalName: string,
    kind: CampaignFile["kind"],
    provenance: string,
    body: Buffer,
  ): Promise<CampaignFile> {
    const campaign = await this.getCampaign(campaignId);
    if (!body.length || body.byteLength > 10_000_000)
      throw new Error("Campaign PDF must be between 1 byte and 10 MB.");
    const safe = this.safeName(originalName, new Set([".pdf"]));
    if (body.subarray(0, 5).toString("ascii") !== "%PDF-")
      throw new Error("The uploaded file is not a valid PDF.");
    const checksum = sha256(body);
    const duplicate = (await this.listFiles(campaignId)).find(
      (item) => item.checksum === checksum,
    );
    if (duplicate) return duplicate;
    let text = "";
    try {
      text = (await extractPdf(body)).text.slice(0, 900_000).trim();
    } catch (error) {
      this.health?.report(
        `shared/campaign-files/${campaignId}/${safe}`,
        "campaign-file-extraction",
        error,
      );
    }
    const stamp = now();
    const id = nanoid(12);
    const path = `shared/campaign-files/${campaignId}/${id}-${safe}`;
    await atomicWriteBuffer(this.root, path, body);
    const companionPath = text
      ? `shared/campaign-files/${campaignId}/${id}.agent.md`
      : null;
    if (companionPath)
      await atomicWriteText(
        this.root,
        companionPath,
        `# ${safe}\n\n- Campaign: ${campaign.title}\n- Source: Owner-uploaded campaign PDF\n- Uploaded: ${stamp}\n\n## Extracted content\n\n${text}\n`,
      );
    const value = CampaignFileSchema.parse({
      id,
      campaignId,
      source: "uploaded",
      kind,
      version: campaign.version,
      name: safe,
      path,
      companionPath,
      checksum,
      mimeType: "application/pdf",
      size: body.byteLength,
      provenance: provenance || "Owner-uploaded campaign reference",
      status: "current",
      createdAt: stamp,
      updatedAt: stamp,
      file: `shared/campaign-files/records/${id}.md`,
    });
    await atomicWriteText(this.root, value.file, fileMarkdown(value));
    return value;
  }

  async approvePackage(
    campaignId: string,
    operationId: string,
  ): Promise<CampaignPublishPackage> {
    const prior = (await this.listPackages(campaignId)).find(
      (item) => item.operationId === operationId,
    );
    if (prior) return prior;
    const campaign = await this.getCampaign(campaignId);
    if (!campaign.objective || !campaign.audience || !campaign.callToAction)
      throw new Error(
        "Campaign approval requires an objective, audience, and call to action.",
      );
    if (campaign.ownerAttention)
      throw new Error(
        "Resolve campaign owner-attention items before approval.",
      );
    const posts = (await this.listPosts(campaignId)).filter(
      (item) => !["cancelled", "published_external"].includes(item.status),
    );
    if (!posts.length)
      throw new Error("Add at least one campaign post before approval.");
    if (posts.some((item) => item.ownerAttention))
      throw new Error("Resolve post owner-attention items before approval.");
    const assets = await this.listAssets(campaignId);
    const referenced = new Set(
      posts.flatMap(
        (item) =>
          item.revisions.find(
            (revision) => revision.revision === item.currentRevision,
          )!.assetIds,
      ),
    );
    const selectedAssets = assets.filter((item) => referenced.has(item.id));
    if (
      selectedAssets.some(
        (item) =>
          item.approvalStatus !== "approved" ||
          !item.usageRights ||
          (item.rightsExpireAt && item.rightsExpireAt < now()),
      )
    )
      throw new Error(
        "Every referenced asset requires current approved usage rights.",
      );
    const stamp = now();
    const version = campaign.version;
    const base = `campaign-${slug(campaign.title)}-v${version}`;
    const postLines = posts
      .map((item) => {
        const revision = item.revisions.find(
          (candidate) => candidate.revision === item.currentRevision,
        )!;
        return `${item.plannedAt ?? "Unscheduled"} | ${item.platform}\nObjective: ${item.objective || "Not set"}\nCopy: ${revision.copy || "No copy"}\nCTA: ${revision.callToAction || "None"}\nLink: ${revision.destinationUrl ?? "None"}\nAssets: ${revision.assetIds.join(", ") || "None"}\nAlt text: ${revision.altText || "None"}\nStatus: publish ready`;
      })
      .join("\n\n");
    const brief = await pdfBuffer(
      campaign.title,
      `Campaign brief - Version ${version} - Approved ${stamp}`,
      [
        { heading: "Objective", body: campaign.objective },
        { heading: "Audience", body: campaign.audience },
        { heading: "Offer", body: campaign.offer },
        {
          heading: "Message hierarchy",
          body: campaign.messageHierarchy.join("\n"),
        },
        { heading: "Verified proof", body: campaign.proof.join("\n") },
        {
          heading: "Channels and CTA",
          body: `${campaign.channels.join(", ")}\n${campaign.callToAction}`,
        },
        {
          heading: "Schedule",
          body: `${campaign.startsAt ?? "Open"} to ${campaign.endsAt ?? "Open"}`,
        },
        {
          heading: "Asset inventory",
          body:
            selectedAssets
              .map(
                (item) =>
                  `${item.name} · ${item.creator || "Unknown creator"} · ${item.usageRights}`,
              )
              .join("\n") || "No assets referenced.",
        },
        {
          heading: "Rights warnings",
          body: "All referenced assets validated for this approved package.",
        },
      ],
    );
    const calendar = await pdfBuffer(
      campaign.title,
      `Content calendar - Version ${version} - Approved ${stamp}`,
      [
        {
          heading: "Campaign",
          body: `${campaign.objective}\nChannels: ${campaign.channels.join(", ")}`,
        },
        { heading: "Approved posts", body: postLines },
      ],
    );
    await validatePdf(brief, [campaign.title, "Objective", "Audience"]);
    await validatePdf(calendar, [campaign.title, "Approved posts"]);
    const existingFiles = await this.listFiles(campaignId);
    const generated: CampaignFile[] = [];
    for (const [kind, name, buffer] of [
      ["campaign_brief", `${base}-brief.pdf`, brief],
      ["content_calendar", `${base}-calendar.pdf`, calendar],
    ] as const) {
      const id = `${kind === "campaign_brief" ? "brief" : "calendar"}_${sha256(`${operationId}:${kind}`).slice(0, 12)}`;
      const path = `shared/campaign-files/${campaignId}/${name}`;
      if (!(await pathExists(this.root, path)))
        await atomicWriteBuffer(this.root, path, buffer);
      const value = CampaignFileSchema.parse({
        id,
        campaignId,
        source: "generated",
        kind,
        version,
        name,
        path,
        companionPath: null,
        checksum: sha256(buffer),
        mimeType: "application/pdf",
        size: buffer.byteLength,
        provenance: `Owner-approved package ${operationId}`,
        status: "current",
        createdAt: stamp,
        updatedAt: stamp,
        file: `shared/campaign-files/records/${id}.md`,
      });
      await atomicWriteText(this.root, value.file, fileMarkdown(value));
      generated.push(value);
    }
    for (const old of existingFiles.filter(
      (item) =>
        item.source === "generated" &&
        item.status === "current" &&
        item.version < version,
    )) {
      const superseded = CampaignFileSchema.parse({
        ...old,
        status: "superseded",
        updatedAt: stamp,
      });
      await atomicWriteText(
        this.root,
        superseded.file,
        fileMarkdown(superseded),
      );
    }
    const packageId = `campkg_${sha256(operationId).slice(0, 12)}`;
    const manifestPath = `shared/campaign-packages/${packageId}.manifest.json`;
    const archivePath = `shared/campaign-packages/${packageId}.zip`;
    const manifest = {
      schemaVersion: 1,
      packageId,
      campaignId,
      version,
      operationId,
      createdAt: stamp,
      campaignChecksum: sha256(campaignMarkdown(campaign)),
      posts: posts.map((item) => ({
        id: item.id,
        revision: item.currentRevision,
        checksum: sha256(postMarkdown(item)),
      })),
      assets: selectedAssets.map((item) => ({
        id: item.id,
        path: item.path,
        checksum: item.checksum,
      })),
      files: generated.map((item) => ({
        id: item.id,
        path: item.path,
        checksum: item.checksum,
      })),
    };
    const manifestBuffer = Buffer.from(
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    const zipEntries: Record<string, Uint8Array> = {
      "manifest.json": manifestBuffer,
      "campaign.md": Buffer.from(campaignMarkdown(campaign)),
      "posts.json": Buffer.from(JSON.stringify(posts, null, 2)),
      "campaign-brief.pdf": brief,
      "content-calendar.pdf": calendar,
      "asset-inventory.json": Buffer.from(
        JSON.stringify(selectedAssets, null, 2),
      ),
    };
    for (const asset of selectedAssets)
      zipEntries[`assets/${basename(asset.path)}`] = await readFile(
        await resolveSafePath(this.root, asset.path),
      );
    const archive = Buffer.from(zipSync(zipEntries, { level: 6 }));
    await atomicWriteBuffer(this.root, manifestPath, manifestBuffer);
    await atomicWriteBuffer(this.root, archivePath, archive);
    const pkg = CampaignPackageSchema.parse({
      id: packageId,
      campaignId,
      version,
      operationId,
      status: "publish_ready",
      postIds: posts.map((item) => item.id),
      assetIds: selectedAssets.map((item) => item.id),
      fileIds: generated.map((item) => item.id),
      manifestPath,
      archivePath,
      checksum: sha256(archive),
      createdAt: stamp,
      file: `shared/campaign-packages/${packageId}.md`,
    });
    await atomicWriteText(this.root, pkg.file, packageMarkdown(pkg));
    for (const post of posts)
      await this.writePost(
        CampaignPostSchema.parse({
          ...post,
          status: "publish_ready",
          updatedAt: stamp,
        }),
      );
    const approved = CampaignSchema.parse({
      ...campaign,
      status: "approved",
      nextStep:
        "Use the approved package for manual publishing and record external publication afterward.",
      updatedAt: stamp,
      events: [
        ...campaign.events,
        event(
          "package_approved",
          "owner",
          "Campaign package approved",
          `Version ${version}`,
          operationId,
        ),
      ],
    });
    await this.writeCampaign(approved);
    return pkg;
  }

  async readFileRecord(
    id: string,
  ): Promise<{ record: CampaignFile; content: Buffer }> {
    const record = (await this.listFiles()).find((item) => item.id === id);
    if (!record)
      throw Object.assign(new Error("Campaign file not found."), {
        statusCode: 404,
      });
    return {
      record,
      content: await readFile(await resolveSafePath(this.root, record.path)),
    };
  }
  async readPackage(
    id: string,
  ): Promise<{ record: CampaignPublishPackage; content: Buffer }> {
    const record = (await this.listPackages()).find((item) => item.id === id);
    if (!record)
      throw Object.assign(new Error("Campaign package not found."), {
        statusCode: 404,
      });
    const content = await readFile(
      await resolveSafePath(this.root, record.archivePath),
    );
    if (sha256(content) !== record.checksum)
      throw new Error("Campaign package checksum validation failed.");
    return { record, content };
  }
  private async touchCampaign(
    id: string,
    type: "post_added" | "asset_added",
    summary: string,
  ): Promise<void> {
    const current = await this.getCampaign(id);
    await this.writeCampaign(
      CampaignSchema.parse({
        ...current,
        updatedAt: now(),
        events: [...current.events, event(type, "system", summary)],
      }),
    );
  }
  private async writeCampaign(value: Campaign): Promise<void> {
    await atomicWriteText(this.root, value.file, campaignMarkdown(value));
  }
  private async writePost(value: CampaignPost): Promise<void> {
    await atomicWriteText(this.root, value.file, postMarkdown(value));
  }
  private safeName(input: string, allowed: Set<string>): string {
    const source = basename(input).normalize("NFKC");
    const extension = extname(source).toLowerCase();
    if (!allowed.has(extension))
      throw new Error(
        `Unsupported campaign file type: ${extension || "none"}.`,
      );
    const stem = basename(source, extname(source))
      .replace(/[^a-zA-Z0-9 _.-]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100);
    if (!stem) throw new Error("Campaign file needs a valid name.");
    return `${stem}${extension}`;
  }
  private async listRecords<
    T extends { updatedAt?: string; createdAt: string },
  >(
    directory: string,
    kind: string,
    schema: { parse(value: unknown): T },
    healthKind: string,
    include: (name: string) => boolean,
  ): Promise<T[]> {
    let entries;
    try {
      entries = await readdir(join(this.root, ...directory.split("/")), {
        withFileTypes: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const values: T[] = [];
    for (const entry of entries) {
      if (
        !entry.isFile() ||
        !entry.name.endsWith(".md") ||
        !include(entry.name)
      )
        continue;
      const absolute = join(this.root, ...directory.split("/"), entry.name);
      const path = relative(this.root, absolute).split("\\").join("/");
      try {
        values.push(
          schema.parse(parseMarker(await readFile(absolute, "utf8"), kind)),
        );
        this.health?.clear(path);
      } catch (error) {
        this.health?.report(path, healthKind, error);
      }
    }
    return values.sort((a, b) =>
      (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt),
    );
  }
}
