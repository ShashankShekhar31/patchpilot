import { describe, expect, it } from "vitest";
import { runReview } from "@/lib/ai/review-service";
import { SAMPLE_DIFF } from "@/lib/samples";
import { buildMarkdownReport } from "@/lib/report";

describe("buildMarkdownReport", () => {
  it("renders verified findings, counts, metadata, and the disclaimer", async () => {
    const review = await runReview(
      { code: SAMPLE_DIFF, filename: "src/checkout.ts" },
      { env: { PATCHPILOT_PROVIDER: "demo" }, now: () => new Date("2026-10-26T12:00:00Z") },
    );
    const report = buildMarkdownReport(review, new Date("2026-10-26T12:05:00Z"));

    expect(report).toContain("# PatchPilot review rv_");
    expect(report).toContain("Mode: sample data (no model call)");
    expect(report).toContain("| Critical | 2 |");
    expect(report).toContain("| High | 2 |");
    expect(report).toContain("| Medium | 2 |");
    expect(report).toContain("| Low | 1 |");
    expect(report).toContain("| Informational | 1 |");
    expect(report).toContain("SQL injection in the coupon lookup");
    expect(report).toContain("src/checkout.ts:9-11");
    expect(report).toContain("Evidence verified against submission: yes");
    expect(report).toContain("```");
    expect(report).toContain("AI suggestions, not verified vulnerabilities");
    expect(report).not.toContain("sk-or-v1-");
  });

  it("does not claim a verified license for sample mode", async () => {
    const review = await runReview(
      { code: SAMPLE_DIFF },
      { env: { PATCHPILOT_PROVIDER: "demo" } },
    );
    const report = buildMarkdownReport(review);
    expect(report).toContain("License: Not applicable");
    expect(report).not.toContain("Apache-2.0");
  });

  it("extends the fence when evidence contains a triple backtick", async () => {
    const review = await runReview(
      { code: SAMPLE_DIFF },
      { env: { PATCHPILOT_PROVIDER: "demo" } },
    );
    const modified = {
      ...review,
      findings: review.findings.map((finding, index) =>
        index === 0
          ? { ...finding, evidence: "```\nconst escaped = true;\n```" }
          : finding,
      ),
    };
    const report = buildMarkdownReport(modified);
    expect(report).toContain("````text");
    expect(report).toContain("const escaped = true;");
  });
});