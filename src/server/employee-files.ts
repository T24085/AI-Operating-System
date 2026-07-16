import { basename, extname } from "node:path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { unzipSync } from "fflate";
import type { EmployeeId } from "../shared/schemas.js";
import { atomicWriteBuffer, atomicWriteText, pathExists } from "./paths.js";

const allowed = new Set([".pdf", ".docx", ".txt", ".md", ".csv", ".xlsx", ".png", ".jpg", ".jpeg"]);

function decodeXml(value: string): string {
  return value.replace(/<w:tab\b[^>]*\/>/gi, "\t").replace(/<w:br\b[^>]*\/>/gi, "\n").replace(/<\/w:p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, "\n\n").trim();
}

export function safeEmployeeFileName(input: string): string {
  const source = basename(input).normalize("NFKC");
  const extension = extname(source).toLowerCase();
  if (!allowed.has(extension)) throw new Error("Supported employee files are PDF, Word, text, Markdown, CSV, Excel, PNG, and JPEG.");
  const stem = basename(source, extname(source)).replace(/[^a-zA-Z0-9 _.-]+/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (!stem) throw new Error("The employee file needs a valid name.");
  return `${stem}${extension}`;
}

async function searchableText(buffer: Buffer, extension: string): Promise<string | null> {
  if ([".txt", ".md", ".csv"].includes(extension)) return buffer.toString("utf8").slice(0, 900_000);
  if (extension === ".pdf") return (await pdfParse(buffer)).text.slice(0, 900_000).trim();
  if (extension === ".docx") {
    const entries = unzipSync(new Uint8Array(buffer));
    const document = entries["word/document.xml"];
    if (!document) throw new Error("The Word document does not contain readable document text.");
    return decodeXml(new TextDecoder().decode(document)).slice(0, 900_000);
  }
  return null;
}

export async function storeEmployeeFile(root: string, employeeId: EmployeeId, originalName: string, body: Buffer): Promise<{ path: string; agentReadable: boolean }> {
  if (!body.length) throw new Error("Choose a non-empty file to upload.");
  const safeName = safeEmployeeFileName(originalName);
  const extension = extname(safeName);
  const stem = basename(safeName, extension);
  const base = `shared/employee-files/${employeeId}`;
  let finalName = safeName; let counter = 2;
  while (await pathExists(root, `${base}/${finalName}`)) finalName = `${stem}-${counter++}${extension}`;
  const path = `${base}/${finalName}`;
  const text = await searchableText(body, extension);
  await atomicWriteBuffer(root, path, body);
  if (text) {
    const companion = `${base}/${basename(finalName, extension)}.agent.md`;
    const markdown = `# ${basename(finalName, extension)}\n\n- Source file: \`${finalName}\`\n- Uploaded: ${new Date().toISOString()}\n- Audience: Authenticated ${employeeId} team members and the ${employeeId} AI employee\n- Status: Team-provided internal reference\n\n> This searchable companion was extracted locally. Use the original file for authoritative formatting.\n\n## Extracted content\n\n${text}\n`;
    await atomicWriteText(root, companion, markdown);
  }
  return { path, agentReadable: Boolean(text) };
}
