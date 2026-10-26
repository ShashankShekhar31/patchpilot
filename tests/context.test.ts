import { describe, expect, it } from "vitest";
import { extractRelevantCode } from "@/lib/ai/context";
import type { Finding } from "@/lib/ai/schema";
import { SAMPLE_DIFF } from "@/lib/samples";

function finding(lineStart: number, lineEnd = lineStart, file: string | null = "src/checkout.ts"): Finding {
  return {
    id: "F-01",
    title: "SQL injection in the coupon lookup",
    severity: "critical",
    category: "security",
    file,
    lineStart,
    lineEnd,
    evidence: "const cart = await db.query(",
    explanation: "A sufficiently long explanation.",
    fix: "Parameterize the query.",
    confidence: 0.9,
    evidenceVerified: true,
    locationSource: "code",
  };
}

describe("extractRelevantCode", () => {
  it("returns a line-numbered window around a verified finding", () => {
    const context = extractRelevantCode(SAMPLE_DIFF, [finding(9, 11)]);
    expect(context.excerptCount).toBe(1);
    expect(context.truncated).toBe(false);
    expect(context.text).toContain("src/checkout.ts:");
    expect(context.text).toContain("applyCoupon");
    expect(context.text).toContain("SELECT * FROM carts");
    expect(context.text).toMatch(/^\s*\d+\|/m);
  });

  it("does not send the tail of the submission", () => {
    const code = `${SAMPLE_DIFF}\n+// TAIL_MARKER_UNIQUE`;
    const context = extractRelevantCode(code, [finding(9)]);
    expect(context.text).toContain("applyCoupon");
    expect(context.text).not.toContain("TAIL_MARKER_UNIQUE");
  });

  it("merges overlapping windows", () => {
    const context = extractRelevantCode(SAMPLE_DIFF, [finding(9), finding(12)]);
    expect(context.excerptCount).toBe(1);
  });

  it("falls back to the head of the submission without findings", () => {
    const context = extractRelevantCode(SAMPLE_DIFF, []);
    expect(context.excerptCount).toBe(1);
    expect(context.text).toContain("src/checkout.ts:1-37");
  });

  it("marks the excerpt truncated when the character budget is exceeded", () => {
    const code = Array.from(
      { length: 40 },
      (_, index) => `const value${index} = "${"x".repeat(200)}";`,
    ).join("\n");
    const context = extractRelevantCode(code, [finding(20, 20, null)], { maxChars: 1_000 });
    expect(context.truncated).toBe(true);
    expect(context.text).toContain("excerpt truncated");
  });
});