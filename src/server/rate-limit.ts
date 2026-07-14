export class BoundedRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly maximumBuckets = 10_000, private readonly trimTo = 9_000) {}

  enforce(key: string, limit: number, windowMs: number, now = Date.now()): void {
    if (this.windows.size >= this.maximumBuckets) this.prune(now);
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    current.count += 1;
    if (current.count > limit) throw Object.assign(new Error("Too many requests. Please wait and try again."), { statusCode: 429 });
  }

  prune(now = Date.now()): void {
    for (const [key, value] of this.windows) {
      if (value.resetAt <= now) this.windows.delete(key);
    }
    while (this.windows.size > this.trimTo) {
      const oldest = this.windows.keys().next().value as string | undefined;
      if (!oldest) break;
      this.windows.delete(oldest);
    }
  }

  get size(): number { return this.windows.size; }
}
