import { describe, expect, it } from "vitest";
import {
  extractJson,
  normalizeReviewPayload,
  normalizeTestsPayload,
} from "@/lib/ai/parse";
import { AppError } from "@/lib/errors";

describe("extractJson", () => {
  it("extracts JSON from prose and Markdown fences", () => {
    const payload = extractJson('Here is the review:\n```json\n{"summary":"ok","findings":[]}\n```');
    expect(payload).toEqual({ summary: "ok", findings: [] });
  });

  it("repairs trailing commas", () => {
    const payload = extractJson('{"summary":"ok","findings":[],}');
    expect(payload).toEqual({ summary: "ok", findings: [] });
  });

  it("ignores braces inside strings when balancing", () => {
    const payload = extractJson('{"summary":"has } brace","findings":[]}');
    expect(payload).toEqual({ summary: "has } brace", findings: [] });
  });

  it("throws a typed model-output error for malformed JSON", () => {
    try {
      extractJson("the model forgot to return JSON");
      throw new Error("expected extractJson to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("MODEL_OUTPUT_INVALID");
      expect((error as AppError).status).toBe(502);
    }
  });
});

describe("normalizeReviewPayload", () => {
  it("normalizes aliases, severities, confidence strings, and locations", () => {
    const normalized = normalizeReviewPayload({
      overview: "One issue.",
      issues: [
        {
          name: "Unchecked parse",
          level: "moderate",
          type: "error handling",
          path: "src/orders.ts",
          line: "12-14",
          snippet: "JSON.parse(raw)",
          description: "This can throw on malformed input and is not caught.",
          recommendation: "Wrap it in try/catch and validate the shape.",
          certainty: "85%",
        },
      ],
    });

    expect(normalized.summary).toBe("One issue.");
    expect(normalized.findings).toHaveLength(1);
    expect(normalized.findings[0]).toMatchObject({
      title: "Unchecked parse",
      severity: "medium",
      category: "error-handling",
      file: "src/orders.ts",
      lineStart: 12,
      lineEnd: 14,
      confidence: 0.85,
    });
  });

  it("wraps a bare array and a single finding object", () => {
    const fromArray = normalizeReviewPayload([
      {
        title: "Real issue",
        severity: "low",
        evidence: "const a = 1;",
        explanation: "This is a real explanation.",
        fix: "Change it.",
        confidence: 0.4,
      },
    ]);
    expect(fromArray.findings).toHaveLength(1);
    expect(fromArray.warnings.join(" ")).toMatch(/bare array/i);

    const fromSingle = normalizeReviewPayload({
      title: "Real issue",
      severity: "low",
      evidence: "const a = 1;",
      explanation: "This is a real explanation.",
      fix: "Change it.",
      confidence: 0.4,
    });
    expect(fromSingle.findings).toHaveLength(1);
  });

  it("drops schema-invalid findings and reports the count", () => {
    const normalized = normalizeReviewPayload({
      summary: "Mixed.",
      findings: [
        {
          title: "Valid",
          severity: "high",
          evidence: "const ok = true;",
          explanation: "A valid explanation for the finding.",
          fix: "Do the fix.",
          confidence: 0.7,
        },
        { title: "Missing everything", severity: "critical" },
      ],
    });

    expect(normalized.findings).toHaveLength(1);
    expect(normalized.rejected).toBe(1);
    expect(normalized.warnings.join(" ")).toMatch(/did not match the review schema/i);
  });

  it("throws when there is no findings array at all", () => {
    expect(() => normalizeReviewPayload({ summary: "No findings key" })).toThrow(AppError);
  });

  it("maps unknown severities to medium rather than trusting them", () => {
    const normalized = normalizeReviewPayload({
      summary: "s",
      findings: [
        {
          title: "Odd severity",
          severity: "apocalyptic",
          evidence: "const a = 1;",
          explanation: "The model used a severity outside the enum.",
          fix: "Use a known severity.",
          confidence: 0.5,
        },
      ],
    });
    expect(normalized.findings[0].severity).toBe("medium");
  });
});

describe("normalizeTestsPayload", () => {
  it("normalizes test aliases and validates each case", () => {
    const normalized = normalizeTestsPayload({
      summary: "Tests",
      runner: "Vitest",
      testCases: [
        {
          name: "works",
          type: "unit",
          input: "a valid input",
          expectedResult: "a success result",
          covers: "Discount bug",
        },
        { name: "broken" },
      ],
    });

    expect(normalized.framework).toBe("Vitest");
    expect(normalized.cases).toHaveLength(1);
    expect(normalized.cases[0]).toMatchObject({
      title: "works",
      testType: "unit",
      setup: "a valid input",
      expected: "a success result",
      finding: "Discount bug",
    });
    expect(normalized.rejected).toBe(1);
  });

  it("rejects a case with no expected result", () => {
    const normalized = normalizeTestsPayload({
      summary: "Tests",
      cases: [
        {
          title: "missing expected",
          testType: "unit",
          setup: "input",
          finding: "Discount bug",
        },
      ],
    });
    expect(normalized.cases).toHaveLength(0);
    expect(normalized.rejected).toBe(1);
  });

  it("keeps at most three test cases", () => {
    const cases = Array.from({ length: 5 }, (_, index) => ({
      title: `case ${index}`,
      testType: "unit",
      setup: "input",
      expected: "result",
      finding: "Finding",
    }));
    const normalized = normalizeTestsPayload({ summary: "many", cases });

    expect(normalized.cases).toHaveLength(3);
    expect(normalized.warnings.join(" ")).toMatch(/first 3 test cases/i);
  });

it("throws when test cases are missing", () => {
    expect(() => normalizeTestsPayload({ summary: "none" })).toThrow(AppError);
  });
});