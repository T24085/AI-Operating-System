import Database from "better-sqlite3";
import chokidar, { type FSWatcher } from "chokidar";
import { mkdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { WorkspaceRecords } from "./records.js";

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
}

export class RecordsIndex {
  private db: Database.Database | null = null;
  private watcher: FSWatcher | null = null;
  private lastIndexedAt: string | null = null;

  constructor(private records: WorkspaceRecords) {}

  async start(): Promise<void> {
    await mkdir(join(this.records.root, "index"), { recursive: true });
    this.db = new Database(join(this.records.root, "index", "records.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
        path UNINDEXED,
        title,
        content,
        tokenize = 'unicode61'
      );
    `);
    await this.rebuild();
    const indexRoot = join(this.records.root, "index");
    this.watcher = chokidar.watch(this.records.root, {
      ignored: (path) => path === indexRoot || path.startsWith(`${indexRoot}\\`) || path.startsWith(`${indexRoot}/`),
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
    });
    this.watcher.on("add", (file) => { if (file.endsWith(".md")) void this.indexFile(file); });
    this.watcher.on("change", (file) => { if (file.endsWith(".md")) void this.indexFile(file); });
    this.watcher.on("unlink", (file) => { if (file.endsWith(".md")) this.removeFile(file); });
  }

  async close(): Promise<void> {
    await this.watcher?.close();
    this.db?.close();
  }

  async rebuild(): Promise<void> {
    if (!this.db) return;
    this.db.exec("DELETE FROM records_fts");
    for (const file of await this.records.allMarkdownFiles()) await this.indexFile(file);
    this.lastIndexedAt = new Date().toISOString();
  }

  async indexFile(file: string): Promise<void> {
    if (!this.db || !file.endsWith(".md")) return;
    const content = await readFile(file, "utf8");
    const path = relative(this.records.root, file).split("\\").join("/");
    const title = content.match(/^#\s+(.+)$/m)?.[1] ?? path;
    const transaction = this.db.transaction(() => {
      this.db!.prepare("DELETE FROM records_fts WHERE path = ?").run(path);
      this.db!.prepare("INSERT INTO records_fts(path, title, content) VALUES (?, ?, ?)").run(path, title, content);
    });
    transaction();
    this.lastIndexedAt = new Date().toISOString();
  }

  removeFile(file: string): void {
    if (!this.db) return;
    const path = relative(this.records.root, file).split("\\").join("/");
    this.db.prepare("DELETE FROM records_fts WHERE path = ?").run(path);
  }

  search(query: string, limit = 12): SearchResult[] {
    if (!this.db || !query.trim()) return [];
    const safe = query
      .trim()
      .split(/\s+/)
      .map((token) => `"${token.replaceAll('"', '""')}"`)
      .join(" AND ");
    return this.db
      .prepare(
        `SELECT path, title, snippet(records_fts, 2, '<mark>', '</mark>', ' … ', 20) AS snippet
         FROM records_fts WHERE records_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(safe, limit) as SearchResult[];
  }

  freshness(): string | null { return this.lastIndexedAt; }
}
