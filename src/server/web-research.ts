import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch } from "undici";
import { GeocodeResultSchema, type GeocodeResult } from "../shared/schemas.js";

const MAX_RESPONSE_BYTES = 1_000_000;
const USER_AGENT = "SamuelStudioResearch/1.0 (local owner-operated research assistant)";
type PublicAddress = { address: string; family: number };

export function pinnedLookup(addresses: PublicAddress[]) {
  let cursor = 0;
  return (_hostname: string, options: unknown, callback: (...args: any[]) => void): void => {
    // Modern Node versions request every candidate address with `{ all: true }`.
    // Returning the older single-address callback shape makes Node reject an
    // undefined address before the HTTPS request ever leaves this computer.
    if (options && typeof options === "object" && "all" in options && (options as { all?: boolean }).all) {
      callback(null, addresses.map(({ address, family }) => ({ address, family })));
      return;
    }
    const selected = addresses[cursor++ % addresses.length];
    callback(null, selected.address, selected.family);
  };
}

export function privateAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

async function validatePublicUrl(value: string): Promise<{ url: URL; addresses: Array<{ address: string; family: number }> }> {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Only public HTTP and HTTPS pages are supported.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Local and private network pages are blocked.");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) throw new Error("Local and private network pages are blocked.");
  return { url, addresses };
}

export async function readLimitedBody(body: AsyncIterable<Uint8Array> | null): Promise<string> {
  if (!body) return "";
  const decoder = new TextDecoder(); let size = 0; let text = "";
  for await (const value of body) {
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) throw new Error("Research page is larger than the 1 MB safety limit.");
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function textFromHtml(html: string): string {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

async function publicFetch(input: string): Promise<{ url: string; contentType: string; text: string }> {
  let target = await validatePublicUrl(input);
  for (let redirect = 0; redirect < 5; redirect += 1) {
    const dispatcher = new Agent({ connect: { lookup: pinnedLookup(target.addresses) } });
    try {
      const response = await fetch(target.url, {
        dispatcher, redirect: "manual", signal: AbortSignal.timeout(15_000),
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain,application/xhtml+xml,application/json;q=0.9,*/*;q=0.1" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error(`Research request redirected without a target (${response.status}).`);
        await response.body?.cancel();
        target = await validatePublicUrl(new URL(location, target.url).toString());
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Research request failed with HTTP ${response.status}.`); }
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > MAX_RESPONSE_BYTES) { await response.body?.cancel(); throw new Error("Research page is larger than the 1 MB safety limit."); }
      const contentType = response.headers.get("content-type") ?? "";
      if (!/text\/(html|plain)|application\/(xhtml\+xml|json)/i.test(contentType)) { await response.body?.cancel(); throw new Error("Only public text, HTML, and approved research data can be read."); }
      const text = await readLimitedBody(response.body);
      return { url: target.url.toString(), contentType, text };
    } finally {
      await dispatcher.close();
    }
  }
  throw new Error("Research request exceeded the redirect limit.");
}

function resultUrl(href: string): string {
  const decoded = decodeHtml(href);
  try {
    const url = new URL(decoded, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : url.toString();
  } catch {
    return decoded;
  }
}

export async function searchPublicWeb(query: string): Promise<string> {
  const clean = query.trim().slice(0, 300);
  if (!clean) throw new Error("A research query is required.");
  const response = await publicFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(clean)}`);
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const pattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>)?/gi;
  for (const match of response.text.matchAll(pattern)) {
    const title = textFromHtml(match[2]);
    const url = resultUrl(match[1]);
    const snippet = textFromHtml(match[3] ?? "");
    if (title && /^https?:\/\//i.test(url) && !results.some((item) => item.url === url)) results.push({ title, url, snippet });
    if (results.length >= 8) break;
  }
  if (!results.length) return `No public web results were returned for: ${clean}`;
  return results.map((item, index) => `${index + 1}. ${item.title}\n${item.url}${item.snippet ? `\n${item.snippet}` : ""}`).join("\n\n");
}

export async function readPublicWebPage(input: string): Promise<string> {
  const response = await publicFetch(input);
  const body = /html|xhtml/i.test(response.contentType) ? textFromHtml(response.text) : response.text.replace(/\s+/g, " ").trim();
  return `Source: ${response.url}\nAccessed: ${new Date().toISOString()}\n\n${body.slice(0, 24_000)}`;
}

export async function geocodePublicPlace(query: string): Promise<GeocodeResult[]> {
  const clean = query.trim().slice(0, 300);
  if (!clean) throw new Error("A business name or address is required for map lookup.");
  const response = await publicFetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&q=${encodeURIComponent(clean)}`);
  const parsed = JSON.parse(response.text) as Array<{ display_name?: string; lat?: string; lon?: string; type?: string; category?: string }>;
  return parsed.map((item) => GeocodeResultSchema.parse({
    displayName: item.display_name,
    latitude: Number(item.lat),
    longitude: Number(item.lon),
    kind: item.type || item.category || "place",
  }));
}

export async function discoverLocalBusinesses(location: string, category = ""): Promise<string> {
  const cleanLocation = location.trim().slice(0, 200);
  if (!cleanLocation) throw new Error("A city and state or region are required for local business discovery.");
  const center = (await geocodePublicPlace(cleanLocation))[0];
  if (!center) throw new Error(`No public map location was found for: ${cleanLocation}`);
  const categoryHint = category.trim().slice(0, 100);
  const query = `[out:json][timeout:15];nwr(around:8000,${center.latitude},${center.longitude})["name"]["shop"];out center tags 80;`;
  const response = await publicFetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
  const parsed = JSON.parse(response.text) as { elements?: Array<{ id?: number; type?: string; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> }> };
  const seen = new Set<string>();
  const candidates = (parsed.elements ?? []).flatMap((item) => {
    const tags = item.tags ?? {}; const name = tags.name?.trim();
    const latitude = item.lat ?? item.center?.lat; const longitude = item.lon ?? item.center?.lon;
    const type = tags.shop || tags.craft || tags.office || "business";
    if (!name || tags.website || tags["contact:website"] || !Number.isFinite(latitude) || !Number.isFinite(longitude) || seen.has(name.toLowerCase())) return [];
    if (categoryHint && !`${name} ${type}`.toLowerCase().includes(categoryHint.toLowerCase())) return [];
    seen.add(name.toLowerCase());
    const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
    const address = [street, tags["addr:city"] || cleanLocation, tags["addr:postcode"]].filter(Boolean).join(", ");
    return [{ name, type, address, latitude, longitude, phone: tags.phone || tags["contact:phone"] || "", mapSource: `https://www.openstreetmap.org/${item.type || "node"}/${item.id ?? ""}` }];
  }).slice(0, 30);
  if (!candidates.length) return `No map-listed business candidates without a website field were found near ${cleanLocation}${categoryHint ? ` for category ${categoryHint}` : ""}.`;
  return `LOCAL DISCOVERY CANDIDATES near ${center.displayName}\n\nOpenStreetMap does not list a website for these records. That is a prospecting signal, not proof that no website exists. Verify each candidate with web_search before recommending outreach or mapping it.\n\n${JSON.stringify(candidates, null, 2)}`;
}
