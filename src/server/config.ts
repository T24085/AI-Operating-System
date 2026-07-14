import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { SettingsSchema, type OnboardingInput, type Settings } from "../shared/schemas.js";

export interface AppConfig {
  company: OnboardingInput;
  settings: Settings;
  workspacePath: string;
}

export function appDataRoot(): string {
  if (process.env.AIOS_DATA_DIR) return process.env.AIOS_DATA_DIR;
  const local = process.env.LOCALAPPDATA ?? join(homedir(), ".local", "share");
  return join(local, "AI-Operating-System");
}

export function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "my-business";
}

export class ConfigStore {
  readonly root: string;
  readonly configFile: string;

  constructor(root = appDataRoot()) {
    this.root = root;
    this.configFile = join(root, "config.json");
  }

  async read(): Promise<AppConfig | null> {
    try {
      const raw = JSON.parse(await readFile(this.configFile, "utf8")) as AppConfig;
      return { ...raw, settings: SettingsSchema.parse(raw.settings) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async write(config: AppConfig): Promise<void> {
    await mkdir(dirname(this.configFile), { recursive: true });
    const temp = `${this.configFile}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await rename(temp, this.configFile);
  }

  workspaceFor(companyName: string): string {
    return join(this.root, "workspaces", slugify(companyName));
  }
}
