import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_RESPONSE_BYTES = 1_000_000;
const USER_AGENT = "SamuelStudioResearch/1.0 (local owner-operated research assistant)";

function privateAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

async function validatePublicUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Only public HTTP and HTTPS pages are supported.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Local and private network pages are blocked.");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) throw new Error("Local and private network pages are blocked.");
  return url;
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
  let url = await validatePublicUrl(input);
  for (let redirect = 0; redirect < 5; redirect += 1) {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.1" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Research request redirected without a target (${response.status}).`);
      url = await validatePublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Research request failed with HTTP ${response.status}.`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_RESPONSE_BYTES) throw new Error("Research page is larger than the 1 MB safety limit.");
    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/(html|plain)|application\/xhtml\+xml/i.test(contentType)) throw new Error("Only public text and HTML pages can be read.");
    const text = (await response.text()).slice(0, MAX_RESPONSE_BYTES);
    return { url: url.toString(), contentType, text };
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

