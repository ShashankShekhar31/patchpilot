import { describe, expect, it } from "vitest";
import {
  MAX_MODEL_FINDINGS,
  buildAskPrompt,
  buildReviewPrompt,
  buildTestsPrompt,
  capSubmission,
} from "@/lib/ai/prompts";
import { SAMPLE_DIFF } from "@/lib/samples";

describe("capSubmission", () => {
  it("keeps short submissions intact", () => {
    const result = capSubmission("const a = 1;", 1000);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe("const a = 1;");
  });

  it("caps long submissions and explains the omission", () => {
    const result = capSubmission("line\n".repeat(1000), 1000);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThan(1200);
    expect(result.text).toContain("PatchPilot truncated");
    expect(result.text.startsWith("line")).toBe(true);
  });
});

describe("prompt builders", () => {
  it("caps review submissions and reports truncation", () => {
    const prompt = buildReviewPrompt({
      code: SAMPLE_DIFF + "x".repeat(10_000),
      maxPromptChars: 4_000,
    });
    expect(prompt.truncated).toBe(true);
    expect(prompt.user).toContain("PatchPilot truncated");
    expect(prompt.user).toContain("SELECT * FROM carts");
  });

  it("asks for a small number of concise findings", () => {
    const prompt = buildReviewPrompt({ code: SAMPLE_DIFF, maxPromptChars: 24_000 });
    expect(MAX_MODEL_FINDINGS).toBe(6);
    expect(prompt.system).toContain("At most 6 findings");
    expect(prompt.system).toContain("1-3 consecutive lines");
    expect(prompt.system).toContain("Never return partial JSON");
  });

it("does not cap the bundled sample at the default prompt budget", () => {
    const prompt = buildReviewPrompt({ code: SAMPLE_DIFF, maxPromptChars: 24_000 });
    expect(prompt.truncated).toBe(false);
    expect(prompt.system).toContain("PatchPilot");
    expect(prompt.user).toContain("<submission>");
  });

  it("sends only bounded relevant context to test generation", () => {
    const finding = {
      id: "F-01",
      title: "SQL injection",
      severity: "critical" as const,
      category: "security" as const,
      file: "src/checkout.ts",
      lineStart: 9,
      lineEnd: 11,
      evidence: "const cart = await db.query(",
      explanation: "A sufficiently long explanation.",
      fix: "Parameterize the query.",
      confidence: 0.9,
      evidenceVerified: true,
      locationSource: "code" as const,
    };
    const code = `${SAMPLE_DIFF}\n+// TAIL_MARKER_UNIQUE`;
    const prompt = buildTestsPrompt({
      code,
      findings: [finding],
      maxPromptChars: 24_000,
    });

    expect(prompt.system).toContain("At most 3 suggestions");
    expect(prompt.user).toContain("Minimal line-numbered code context");
    expect(prompt.user).toContain("SELECT * FROM carts");
    expect(prompt.user).not.toContain("TAIL_MARKER_UNIQUE");
    expect(prompt.user).not.toContain("<submission>");
  });

it("caps ask and tests prompts as well", () => {
    const code = "a".repeat(8_000);
    const ask = buildAskPrompt({
      code,
      question: "Why?",
      findings: [],
      history: [],
      maxPromptChars: 2_000,
    });
    const tests = buildTestsPrompt({
      code,
      findings: [],
      maxPromptChars: 2_000,
    });

    expect(ask.truncated).toBe(true);
    expect(tests.truncated).toBe(true);
    expect(ask.user).toContain("PatchPilot truncated");
    expect(tests.user).toContain("excerpt truncated");
  });
});