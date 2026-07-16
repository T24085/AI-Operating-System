import { constants } from "node:fs";
import { access, lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const MAX_TEXT_BYTES = 1_048_576;
const MAX_BINARY_BYTES = 10_000_000;

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export async function resolveSafePath(workspaceRoot: string, requestedPath: string): Promise<string> {
  if (!requestedPath || requestedPath.includes("\0") || isAbsolute(requestedPath) || /^[a-zA-Z]:/.test(requestedPath)) {
    throw new Error("Path must be a non-empty path relative to the business workspace.");
  }

  await mkdir(workspaceRoot, { recursive: true });
  const canonicalRoot = await realpath(workspaceRoot);
  const target = resolve(canonicalRoot, requestedPath.replace(/[\\/]+/g, sep));
  if (!isInside(canonicalRoot, target)) throw new Error("Path escapes the business workspace.");

  const rel = relative(canonicalRoot, target);
  let cursor = canonicalRoot;
  for (const segment of rel.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink()) throw new Error("Symbolic links are not permitted inside the business workspace.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  return target;
}

export async function readSafeText(workspaceRoot: string, requestedPath: string): Promise<string> {
  const target = await resolveSafePath(workspaceRoot, requestedPath);
  const stat = await lstat(target);
  if (!stat.isFile()) throw new Error("Requested path is not a file.");
  if (stat.size > MAX_TEXT_BYTES) throw new Error("File exceeds the 1 MB text-file limit.");
  return readFile(target, "utf8");
}

export async function atomicWriteText(workspaceRoot: string, requestedPath: string, content: string): Promise<string> {
  if (Buffer.byteLength(content, "utf8") > MAX_TEXT_BYTES) throw new Error("Content exceeds the 1 MB text-file limit.");
  const target = await resolveSafePath(workspaceRoot, requestedPath);
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, content, { encoding: "utf8", flag: "wx" });
  await rename(temp, target);
  return target;
}

export async function atomicWriteBuffer(workspaceRoot: string, requestedPath: string, content: Uint8Array): Promise<string> {
  if (content.byteLength > MAX_BINARY_BYTES) throw new Error("File exceeds the 10 MB employee-file limit.");
  const target = await resolveSafePath(workspaceRoot, requestedPath);
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, content, { flag: "wx" });
  await rename(temp, target);
  return target;
}

export async function pathExists(workspaceRoot: string, requestedPath: string): Promise<boolean> {
  try {
    const target = await resolveSafePath(workspaceRoot, requestedPath);
    await access(target, constants.F_OK);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    if ((error as Error).message.includes("Path")) throw error;
    return false;
  }
}
