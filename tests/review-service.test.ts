import { describe, expect, it, vi } from "vitest";
import { resolveProviderConfig } from "@/lib/ai/config";
import type { ChatProvider, CompletionRequest } from "@/lib/ai/provider";
import { AppError, ProviderError } from "@/lib/errors";
import { finalizeFindings, runAsk, runReview, runTests } from "@/lib/ai/review-service";
import { SAMPLE_DIFF } from "@/lib/samples";

const SQL_FINDING_EVIDENCE = [
  "  const cart = await db.query(",
  "    `SELECT * FROM carts WHERE id = '${cartId}'`",
  "  );",
].join("\n");

function fakeProvider(
  texts: string[],
  onRequest?: (request: CompletionRequest) => void,
): ChatProvider {
  let call = 0;
  return {
    config: resolveProviderConfig({ OPENROUTER_API_KEY: "test-key" }),
    complete: vi.fn(async (request: CompletionRequest) => {
      onRequest?.(request);
      const text = texts[Math.min(call, texts.length - 1)];
      call += 1;
      return { text, usage: { promptTokens: 10, completionTokens: 20 } };
    }),
  };
}

function validReviewJson(): string {
  return JSON.stringify({
    summary: "One real issue and one fabricated issue.",
    findings: [
      {
        title: "SQL injection in the coupon lookup",
        severity: "critical",
        category: "security",
        file: "src/checkout.ts",
        lineStart: 1,
        lineEnd: 2,
        evidence: SQL_FINDING_EVIDENCE,
        explanation: "cartId is interpolated into a SQL string, which changes the query.",
        fix: "Use a parameterized query and pass cartId as a value.",
        confidence: 0.9,
      },
      {
        title: "Fabricated finding",
        severity: "high",
        category: "bug",
        file: "src/checkout.ts",
        lineStart: 40,
        lineEnd: 41,
        evidence: "const thisLineDoesNotExist = true;",
        explanation: "This evidence is not in the submission and must be dropped.",
        fix: "Nothing.",
        confidence: 0.8,
      },
    ],
  });
}

describe("finalizeFindings", () => {
  it("drops unsupported findings, recomputes locations, and assigns ids", () => {
    const result = finalizeFindings(
      [
        {
          title: "Real",
          severity: "high",
          category: "security",
          file: "src/checkout.ts",
          lineStart: 99,
          lineEnd: 100,
          evidence: SQL_FINDING_EVIDENCE,
          explanation: "This is a sufficiently long explanation.",
          fix: "Fix it with a parameterized query.",
          confidence: 0.9,
        },
        {
          title: "Fake",
          severity: "critical",
          category: "bug",
          file: "src/checkout.ts",
          lineStart: 1,
          lineEnd: 1,
          evidence: "this is not present in the submission",
          explanation: "This is a sufficiently long explanation.",
          fix: "Fix it.",
          confidence: 0.9,
        },
      ],
      SAMPLE_DIFF,
      { filename: "src/checkout.ts" },
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].id).toBe("F-01");
    expect(result.findings[0].lineStart).toBe(9);
    expect(result.findings[0].lineEnd).toBe(11);
    expect(result.findings[0].evidenceVerified).toBe(true);
    expect(result.dropped).toBe(1);
    expect(result.warnings.join(" ")).toMatch(/discarded/i);
  });

  it("keeps critical findings when capping the result set", () => {
    const code = Array.from({ length: 12 }, (_, index) => `const v${index} = ${index};`).join("\n");
    const raw = Array.from({ length: 12 }, (_, index) => ({
      title: `Finding ${index}`,
      severity: index === 11 ? ("critical" as const) : ("info" as const),
      category: "bug" as const,
      file: null,
      lineStart: null,
      lineEnd: null,
      evidence: `const v${index} = ${index};`,
      explanation: "A sufficiently long explanation for this finding.",
      fix: "Apply the suggested fix.",
      confidence: 0.5,
    }));

    const result = finalizeFindings(raw, code, { maxFindings: 3 });
    expect(result.findings[0].severity).toBe("critical");
    expect(result.findings.some((finding) => finding.title === "Finding 11")).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/Only the 3/);
  });

it("deduplicates findings with the same title and location", () => {
    const finding = {
      title: "Duplicate",
      severity: "medium" as const,
      category: "bug" as const,
      file: null,
      lineStart: null,
      lineEnd: null,
      evidence: "const payload = JSON.parse(raw);",
      explanation: "A sufficiently long explanation.",
      fix: "Handle it.",
      confidence: 0.6,
    };
    const result = finalizeFindings([finding, { ...finding }], SAMPLE_DIFF);
    expect(result.findings).toHaveLength(1);
    expect(result.warnings.join(" ")).toMatch(/duplicate/i);
  });
});

describe("runReview", () => {
  it("returns deterministic, evidence-verified findings in sample mode", async () => {
    const review = await runReview(
      { code: SAMPLE_DIFF, filename: "src/checkout.ts" },
      { env: { PATCHPILOT_PROVIDER: "demo" }, now: () => new Date("2026-10-26T10:00:00Z") },
    );

    expect(review.mode).toBe("sample");
    expect(review.provider.kind).toBe("demo");
    expect(review.findings).toHaveLength(8);
    expect(review.counts).toEqual({ critical: 2, high: 2, medium: 2, low: 1, info: 1 });
    expect(review.findings[0]).toMatchObject({
      severity: "critical",
      file: "src/checkout.ts",
      lineStart: 9,
      evidenceVerified: true,
    });
    expect(review.findings.every((finding) => finding.evidenceVerified)).toBe(true);
    expect(review.warnings.join(" ")).toMatch(/deterministic/i);
    expect(review.createdAt).toBe("2026-10-26T10:00:00.000Z");
    expect(review.input.kind).toBe("diff");
    expect(review.input.files).toEqual(["src/checkout.ts"]);
  });

  it("verifies live model output and drops fabricated evidence", async () => {
    const provider = fakeProvider([validReviewJson()]);
    const review = await runReview(
      { code: SAMPLE_DIFF, filename: "src/checkout.ts" },
      { env: { OPENROUTER_API_KEY: "test-key" }, provider },
    );

    expect(review.mode).toBe("live");
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0].lineStart).toBe(9);
    expect(review.warnings.join(" ")).toMatch(/discarded/i);
    expect(review.usage).toEqual({ promptTokens: 10, completionTokens: 20 });
  });

  it("repairs malformed JSON with one bounded retry", async () => {
    const provider = fakeProvider(["this is not json", validReviewJson()]);
    const review = await runReview(
      { code: SAMPLE_DIFF },
      { env: { OPENROUTER_API_KEY: "test-key" }, provider },
    );

    expect(provider.complete).toHaveBeenCalledTimes(2);
    expect(review.findings).toHaveLength(1);
  });

  it("fails with MODEL_OUTPUT_INVALID when the repair also fails", async () => {
    const provider = fakeProvider(["still not json"]);
    await expect(
      runReview(
        { code: SAMPLE_DIFF },
        { env: { OPENROUTER_API_KEY: "test-key" }, provider },
      ),
    ).rejects.toMatchObject({ code: "MODEL_OUTPUT_INVALID", status: 502 });
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it("passes a bounded deadline to the provider", async () => {
    let captured: CompletionRequest | undefined;
    const provider = fakeProvider([validReviewJson()], (request) => {
      captured = request;
    });
    const before = Date.now();

    await runReview(
      { code: SAMPLE_DIFF },
      {
        env: { OPENROUTER_API_KEY: "test-key", PATCHPILOT_DEADLINE_MS: "20000" },
        provider,
      },
    );

    expect(captured?.deadlineAt).toBeDefined();
    expect(captured?.deadlineAt).toBeGreaterThan(before);
    expect((captured?.deadlineAt ?? 0) - Date.now()).toBeLessThanOrEqual(20_000);
    expect(captured?.maxTokens).toBe(2_400);
  });

it("never requests more output tokens than the configured cap", async () => {
    let captured: CompletionRequest | undefined;
    const provider = fakeProvider([validReviewJson()], (request) => {
      captured = request;
    });

    await runReview(
      { code: SAMPLE_DIFF },
      {
        env: { OPENROUTER_API_KEY: "test-key", PATCHPILOT_MAX_OUTPUT_TOKENS: "1200" },
        provider,
      },
    );

    expect(captured?.maxTokens).toBe(1_200);
  });

it("does not repair a truncated model response", async () => {
    const complete = vi
      .fn()
      .mockRejectedValue(
        new AppError(502, "MODEL_OUTPUT_TRUNCATED", "The model hit the output limit.", {
          retryable: false,
        }),
      );
    const provider: ChatProvider = {
      config: resolveProviderConfig({ OPENROUTER_API_KEY: "test-key" }),
      complete,
    };

    await expect(
      runReview(
        { code: SAMPLE_DIFF },
        { env: { OPENROUTER_API_KEY: "test-key" }, provider },
      ),
    ).rejects.toMatchObject({ code: "MODEL_OUTPUT_TRUNCATED" });
    expect(complete).toHaveBeenCalledTimes(1);
  });

it("warns when the prompt had to be truncated", async () => {
    const provider = fakeProvider([validReviewJson()]);
    const code = `${SAMPLE_DIFF}\n// padding ${"x".repeat(5_000)}`;

    const review = await runReview(
      { code },
      {
        env: {
          OPENROUTER_API_KEY: "test-key",
          PATCHPILOT_MAX_PROMPT_CHARS: "4000",
        },
        provider,
      },
    );

    expect(review.warnings.join(" ")).toMatch(/truncated/i);
    expect(review.findings.length).toBeGreaterThan(0);
  });

it("rejects input above the configured limit before calling the model", async () => {
    const provider = fakeProvider([validReviewJson()]);
    await expect(
      runReview(
        { code: "a".repeat(1500) },
        {
          env: { OPENROUTER_API_KEY: "test-key", PATCHPILOT_MAX_INPUT_CHARS: "1000" },
          provider,
        },
      ),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE", status: 413 });
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it("labels a live provider as configured without exposing the key", async () => {
    const provider = fakeProvider([validReviewJson()]);
    const review = await runReview(
      { code: SAMPLE_DIFF },
      { env: { OPENROUTER_API_KEY: "super-secret-key" }, provider },
    );

    const serialized = JSON.stringify(review);
    expect(review.provider.mode).toBe("live");
    expect(review.provider.license).toBe("Apache-2.0");
    expect(review.provider.licenseVerified).toBe(true);
    expect(serialized).not.toContain("super-secret-key");
  });
});

describe("runAsk", () => {
  it("returns a clearly labelled deterministic answer in sample mode", async () => {
    const result = await runAsk(
      {
        code: SAMPLE_DIFF,
        question: "What should I fix first?",
        findings: [
          {
            title: "SQL injection",
            severity: "critical",
            category: "security",
            file: "src/checkout.ts",
            lineStart: 9,
            explanation: "Interpolated SQL.",
            fix: "Parameterize the query.",
          },
        ],
        history: [],
      },
      { env: { PATCHPILOT_PROVIDER: "demo" } },
    );

    expect(result.mode).toBe("sample");
    expect(result.answer).toMatch(/Sample mode/);
    expect(result.answer).toMatch(/Parameterize the query/);
  });

  it("maps live answers and usage", async () => {
    const provider = fakeProvider(["Use a parameterized query."]);
    const result = await runAsk(
      { code: SAMPLE_DIFF, question: "How do I fix this?", findings: [], history: [] },
      { env: { OPENROUTER_API_KEY: "test-key" }, provider },
    );

    expect(result.mode).toBe("live");
    expect(result.answer).toBe("Use a parameterized query.");
    expect(result.provider.model).toBe("qwen/qwen3-coder");
  });
});

describe("runTests", () => {
  it("returns bundled sample tests with an explicit not-executed warning", async () => {
    const result = await runTests(
      { code: SAMPLE_DIFF, framework: "Vitest", language: "typescript", findings: [] },
      { env: { PATCHPILOT_PROVIDER: "demo" } },
    );

    expect(result.mode).toBe("sample");
    expect(result.framework).toBe("Vitest");
    expect(result.cases).toHaveLength(3);
    expect(result.cases[0].title).toContain("20%");
    expect(result.cases[0].setup).toContain("Mock");
    expect(result.cases[0].finding).toContain("Discount");
    expect(result.warnings.join(" ")).toMatch(/not executed/i);
  });

  it("validates live test output", async () => {
    const provider = fakeProvider([
      JSON.stringify({
        summary: "Tests",
        framework: "Vitest",
        cases: [
          {
            title: "works",
            testType: "unit",
            setup: "a valid input",
            expected: "a success result",
            finding: "Finding",
          },
        ],
      }),
    ]);
    const result = await runTests(
      { code: SAMPLE_DIFF, findings: [] },
      { env: { OPENROUTER_API_KEY: "test-key" }, provider },
    );

    expect(result.mode).toBe("live");
    expect(result.cases).toHaveLength(1);
  });

  it("sends focused context, a bounded output budget, and at most three cases", async () => {
    let captured: CompletionRequest | undefined;
    const provider = fakeProvider(
      [
        JSON.stringify({
          summary: "Tests",
          framework: "Vitest",
          cases: [
            {
              title: "case a",
              testType: "unit",
              setup: "input a",
              expected: "result a",
              finding: "Finding",
            },
            {
              title: "case b",
              testType: "unit",
              setup: "input b",
              expected: "result b",
              finding: "Finding",
            },
            {
              title: "case c",
              testType: "unit",
              setup: "input c",
              expected: "result c",
              finding: "Finding",
            },
            {
              title: "case d",
              testType: "unit",
              setup: "input d",
              expected: "result d",
              finding: "Finding",
            },
          ],
        }),
      ],
      (request) => {
        captured = request;
      },
    );

    const code = `${SAMPLE_DIFF}\n+// TAIL_MARKER_UNIQUE`;
    const result = await runTests(
      {
        code,
        language: "typescript",
        findings: [
          {
            title: "SQL injection",
            severity: "critical",
            category: "security",
            file: "src/checkout.ts",
            lineStart: 9,
            explanation: "Interpolated SQL.",
            fix: "Parameterize it.",
          },
        ],
      },
      { env: { OPENROUTER_API_KEY: "test-key" }, provider },
    );

    expect(captured?.maxTokens).toBe(900);
    expect(captured?.user).toContain("Minimal line-numbered code context");
    expect(captured?.user).toContain("applyCoupon");
    expect(captured?.user).not.toContain("TAIL_MARKER_UNIQUE");
    expect(result.cases).toHaveLength(3);
    expect(result.warnings.join(" ")).toMatch(/first 3 test cases/i);
  });

  it("propagates a provider timeout without a second test request", async () => {
    const complete = vi
      .fn()
      .mockRejectedValue(
        new ProviderError("PROVIDER_TIMEOUT", 504, "The model provider timed out.", true),
      );
    const provider: ChatProvider = {
      config: resolveProviderConfig({ OPENROUTER_API_KEY: "test-key" }),
      complete,
    };

    await expect(
      runTests(
        { code: SAMPLE_DIFF, findings: [] },
        { env: { OPENROUTER_API_KEY: "test-key" }, provider },
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT", status: 504, retryable: true });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("does not repair malformed test JSON", async () => {
    const provider = fakeProvider(["this is not json"]);
    await expect(
      runTests(
        { code: SAMPLE_DIFF, findings: [] },
        { env: { OPENROUTER_API_KEY: "test-key" }, provider },
      ),
    ).rejects.toMatchObject({ code: "MODEL_OUTPUT_INVALID" });
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it("propagates truncation without displaying partial tests", async () => {
    const complete = vi
      .fn()
      .mockRejectedValue(
        new AppError(502, "MODEL_OUTPUT_TRUNCATED", "The response was cut off.", {
          retryable: true,
        }),
      );
    const provider: ChatProvider = {
      config: resolveProviderConfig({ OPENROUTER_API_KEY: "test-key" }),
      complete,
    };

    await expect(
      runTests(
        { code: SAMPLE_DIFF, findings: [] },
        { env: { OPENROUTER_API_KEY: "test-key" }, provider },
      ),
    ).rejects.toMatchObject({ code: "MODEL_OUTPUT_TRUNCATED" });
    expect(complete).toHaveBeenCalledTimes(1);
  });
});