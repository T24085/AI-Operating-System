import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ResearchMapStore, parseResearchPlace, serializeResearchPlace } from "../src/server/research-map.js";
import { agentTools } from "../src/server/tools.js";
import { ResearchPlaceInputSchema } from "../src/shared/schemas.js";

const cleanup: string[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("Research map records", () => {
  it("stores human-readable Markdown as the canonical organization record", async () => {
    const root = await mkdtemp(join(tmpdir(), "aios-research-map-")); cleanup.push(root);
    const store = new ResearchMapStore(root);
    const saved = await store.save({ name: "Ottawa Business Alliance", kind: "organization", status: "prospect", address: "Ottawa, Illinois", latitude: 41.3456, longitude: -88.8426, phone: "", website: "https://example.com/alliance", contactName: "", opportunity: "Potential website and campaign partner.", notes: "Public directory reviewed.", sourceUrls: ["https://example.com/alliance"] });
    expect(saved.file).toMatch(/^research\/organizations\/ottawa-business-alliance-/);
    const [listed] = await store.list();
    expect(listed).toMatchObject({ name: "Ottawa Business Alliance", status: "prospect", latitude: 41.3456 });
    expect(parseResearchPlace(serializeResearchPlace(saved))).toEqual(saved);
  });

  it("updates an existing place without creating a duplicate", async () => {
    const root = await mkdtemp(join(tmpdir(), "aios-research-map-")); cleanup.push(root);
    const store = new ResearchMapStore(root);
    const first = await store.save({ name: "Example Venue", kind: "venue", status: "researching", address: "Chicago, Illinois", latitude: 41.8756, longitude: -87.6244, phone: "", website: "", contactName: "", opportunity: "Photography venue.", notes: "", sourceUrls: [] });
    await store.save({ id: first.id, name: first.name, kind: first.kind, status: "contacted", address: first.address, latitude: first.latitude, longitude: first.longitude, phone: "", website: "", contactName: "", opportunity: first.opportunity, notes: "Owner initiated contact.", sourceUrls: [] });
    const places = await store.list();
    expect(places).toHaveLength(1);
    expect(places[0].status).toBe("contacted");
  });

  it("normalizes Research model no-website prose without accepting malformed URLs", () => {
    const base = { name: "Buckeye Antique Mall", kind: "business", status: "prospect", address: "310 North Buckeye Avenue, Abilene, KS 67410", latitude: 38.5035, longitude: -97.2459, sourceUrls: [] } as const;
    expect(ResearchPlaceInputSchema.parse({ ...base, website: "None found; verified via search." }).website).toBe("");
    expect(() => ResearchPlaceInputSchema.parse({ ...base, website: "probably example dot com" })).toThrow();
  });

  it("exposes research search, page reading, geocoding, and approval-gated mapping tools", () => {
    const names = agentTools.map((tool) => tool.function.name);
    expect(names).toEqual(expect.arrayContaining(["web_search", "read_web_page", "geocode_place", "discover_local_businesses", "map_research_place"]));
  });
});
