import { afterEach, describe, expect, it } from "vitest";
import { checkRateLimit, resetRateLimits } from "@/lib/rate-limit";

afterEach(() => resetRateLimits());

describe("checkRateLimit", () => {
  it("allows requests up to the limit and then blocks", () => {
    const first = checkRateLimit("test", { limit: 2, windowMs: 60_000 });
    const second = checkRateLimit("test", { limit: 2, windowMs: 60_000 });
    const third = checkRateLimit("test", { limit: 2, windowMs: 60_000 });

    expect(first).toMatchObject({ ok: true, remaining: 1 });
    expect(second).toMatchObject({ ok: true, remaining: 0 });
    expect(third.ok).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps independent buckets per key", () => {
    checkRateLimit("a", { limit: 1, windowMs: 60_000 });
    expect(checkRateLimit("a", { limit: 1, windowMs: 60_000 }).ok).toBe(false);
    expect(checkRateLimit("b", { limit: 1, windowMs: 60_000 }).ok).toBe(true);
  });

  it("resets after the window", async () => {
    checkRateLimit("short", { limit: 1, windowMs: 10 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(checkRateLimit("short", { limit: 1, windowMs: 10 }).ok).toBe(true);
  });
});