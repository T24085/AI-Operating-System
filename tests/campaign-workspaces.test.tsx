// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Desktop } from "../src/client/App";
import { api, type BootstrapData } from "../src/client/api";
import { CampaignFileSchema, CampaignPostSchema, CampaignSchema, SettingsSchema } from "../src/shared/schemas";
import { employees } from "../src/shared/employees";

vi.mock("../src/client/api", async () => { const actual = await vi.importActual<typeof import("../src/client/api")>("../src/client/api"); return { ...actual, streamEmployeeMessage: vi.fn() }; });
const stamp = "2026-07-15T12:00:00.000Z";
const campaign = CampaignSchema.parse({ id: "campaign-ui-1", contactId: null, leadId: null, conversationId: null, projectId: null, workItemId: null, salesQualificationId: null, title: "Fall Editorial Launch", businessLine: "Samuel Studio", status: "planning", objective: "Launch the fall portrait collection.", audience: "Creative founders", offer: "Editorial portrait session", messageHierarchy: ["Presence before decoration"], proof: [], channels: ["Instagram"], callToAction: "Book a consultation", startsAt: null, endsAt: null, nextStep: "Complete the calendar.", ownerAttention: false, ownerAttentionReasons: [], evidence: [], participants: ["marketing", "social-media"], version: 1, events: [], createdBy: "owner", createdAt: stamp, updatedAt: stamp, file: "shared/campaigns/campaign-ui-1.md" });
const post = CampaignPostSchema.parse({ id: "post-ui-1", campaignId: campaign.id, platform: "Instagram", plannedAt: stamp, objective: "Awareness", status: "draft", currentRevision: 1, revisions: [{ revision: 1, copy: "A quieter kind of presence.", callToAction: "Book", destinationUrl: null, altText: "Editorial portrait", assetIds: [], claims: [], createdBy: "social-media", createdAt: stamp }], ownerAttention: false, ownerAttentionReasons: [], publishedUrl: null, publishedAt: null, createdAt: stamp, updatedAt: stamp, file: "shared/campaign-posts/post-ui-1.md" });
const file = CampaignFileSchema.parse({ id: "brief-ui-1", campaignId: campaign.id, source: "generated", kind: "campaign_brief", version: 1, name: "campaign-fall-v1-brief.pdf", path: "shared/campaign-files/campaign-ui-1/brief.pdf", companionPath: null, checksum: "a".repeat(64), mimeType: "application/pdf", size: 1234, provenance: "Owner-approved package", status: "current", createdAt: stamp, updatedAt: stamp, file: "shared/campaign-files/records/brief-ui-1.md" });
const initial: BootstrapData = { onboarded: true, company: null, settings: SettingsSchema.parse({}), employees, ollamaOnline: true, actions: [], workItems: [], activity: [] };

describe("Campaign employee workspaces", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.restoreAllMocks(); HTMLElement.prototype.scrollTo = vi.fn(); vi.spyOn(api, "employeeConversations").mockResolvedValue([]); vi.spyOn(api, "campaignOperations").mockResolvedValue({ campaigns: [campaign], posts: [post], assets: [], files: [file], packages: [], summary: { draft: 1, awaitingOwner: 0, active: 0, publishReadyPosts: 0, missingRights: 0 } }); });
  it("shows Marketing campaigns, Social content calendar, and their shared Campaign Files", async () => {
    render(<Desktop initial={initial} onRefresh={vi.fn()} onOpenCrm={vi.fn()} onLogout={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Marketing, available" })); fireEvent.click(screen.getByRole("button", { name: "Campaigns" }));
    expect(await screen.findByRole("region", { name: "Marketing campaigns" })).toBeVisible(); expect(screen.getAllByText("Fall Editorial Launch").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Campaign Files" })); expect(await screen.findByRole("region", { name: "Campaign files" })).toBeVisible(); expect(screen.getByText("campaign-fall-v1-brief.pdf")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Social Media, available" })); fireEvent.click(screen.getByRole("button", { name: "Content Calendar" }));
    expect(await screen.findByRole("region", { name: "Social Media content calendar" })).toBeVisible(); expect(screen.getByText("A quieter kind of presence.")).toBeVisible();
  }, 10_000);
});
