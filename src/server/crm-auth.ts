import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

interface AuthFile { salt: string; hash: string }
interface Session { expires: number; csrf: string }

export class CrmAuth {
  private readonly file: string;
  private readonly sessions = new Map<string, Session>();

  constructor(root: string) { this.file = join(root, "crm-auth.json"); }

  async configured(): Promise<boolean> {
    try { await readFile(this.file); return true; } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async setup(password: string): Promise<string> {
    if (await this.configured()) throw Object.assign(new Error("CRM password is already configured."), { statusCode: 409 });
    this.validate(password);
    const salt = randomBytes(24).toString("hex");
    await this.write({ salt, hash: scryptSync(password, salt, 64).toString("hex") });
    return this.createSession();
  }

  async login(password: string): Promise<string> {
    let record: AuthFile;
    try { record = JSON.parse(await readFile(this.file, "utf8")) as AuthFile; }
    catch { throw Object.assign(new Error("Create the CRM admin password first."), { statusCode: 409 }); }
    const expected = Buffer.from(record.hash, "hex");
    const actual = scryptSync(password, record.salt, expected.length);
    if (!timingSafeEqual(expected, actual)) throw Object.assign(new Error("That password is not correct."), { statusCode: 401 });
    return this.createSession();
  }

  authenticated(token?: string): boolean {
    if (!token) return false;
    const session = this.sessions.get(token);
    if (!session || session.expires < Date.now()) { this.sessions.delete(token); return false; }
    return true;
  }

  csrfFor(token?: string): string | undefined { return token && this.authenticated(token) ? this.sessions.get(token)?.csrf : undefined; }

  validCsrf(token: string | undefined, supplied: string | undefined): boolean {
    const expected = this.csrfFor(token); if (!expected || !supplied) return false;
    const left = Buffer.from(expected); const right = Buffer.from(supplied);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  logout(token?: string): void { if (token) this.sessions.delete(token); }

  private validate(password: string): void {
    if (password.length < 10 || password.length > 200) throw Object.assign(new Error("Use at least 10 characters for the admin password."), { statusCode: 400 });
  }

  private createSession(): string {
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, { expires: Date.now() + 12 * 60 * 60 * 1000, csrf: randomBytes(24).toString("base64url") });
    return token;
  }

  private async write(value: AuthFile): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temp, this.file);
  }
}

export function cookieValue(header: string | undefined, name: string): string | undefined {
  return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}
