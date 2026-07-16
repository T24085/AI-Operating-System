import { readdir } from "node:fs/promises";
import { basename } from "node:path";
import { nanoid } from "nanoid";
import { ResearchPlaceInputSchema, ResearchPlaceSchema, type ResearchPlace, type ResearchPlaceInput } from "../shared/schemas.js";
import { atomicWriteText, readSafeText, resolveSafePath } from "./paths.js";

const DIRECTORY = "research/organizations";
const RECORD_PATTERN = /<!-- AIOS_RESEARCH_PLACE (\{.*\}) -->/;

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "organization";
}

export function researchPlacePath(name: string, id: string): string {
  return `${DIRECTORY}/${slug(name)}-${id}.md`;
}

export function serializeResearchPlace(place: ResearchPlace): string {
  const sourceList = place.sourceUrls.length ? place.sourceUrls.map((url) => `- ${url}`).join("\n") : "- No public sources recorded.";
  return `# ${place.name}\n\n<!-- AIOS_RESEARCH_PLACE ${JSON.stringify(place)} -->\n\n- Status: ${place.status}\n- Type: ${place.kind}\n- Address: ${place.address}\n- Coordinates: ${place.latitude}, ${place.longitude}\n- Phone: ${place.phone || "Not recorded"}\n- Website: ${place.website || "Not recorded"}\n- Contact: ${place.contactName || "Not recorded"}\n- Last researched: ${place.lastResearchedAt}\n\n## Opportunity\n\n${place.opportunity || "No opportunity assessment recorded."}\n\n## Research notes\n\n${place.notes || "No notes recorded."}\n\n## Sources\n\n${sourceList}\n`;
}

export function parseResearchPlace(content: string): ResearchPlace {
  const match = content.match(RECORD_PATTERN);
  if (!match) throw new Error("Research organization record is missing its canonical metadata.");
  return ResearchPlaceSchema.parse(JSON.parse(match[1]));
}

export class ResearchMapStore {
  constructor(private root: string) {}

  async list(): Promise<ResearchPlace[]> {
    const directory = await resolveSafePath(this.root, DIRECTORY);
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const places: ResearchPlace[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      try { places.push(parseResearchPlace(await readSafeText(this.root, `${DIRECTORY}/${entry.name}`))); } catch { /* diagnostics handle malformed Markdown */ }
    }
    return places.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async save(raw: ResearchPlaceInput): Promise<ResearchPlace> {
    const input = ResearchPlaceInputSchema.parse(raw);
    const existing = input.id ? (await this.list()).find((item) => item.id === input.id) : undefined;
    const id = existing?.id ?? input.id ?? nanoid(10);
    const now = new Date().toISOString();
    const file = existing?.file ?? researchPlacePath(input.name, id);
    const place = ResearchPlaceSchema.parse({ ...input, id, createdAt: existing?.createdAt ?? now, updatedAt: now, lastResearchedAt: now, file });
    await atomicWriteText(this.root, file, serializeResearchPlace(place));
    return place;
  }
}
