import { AppError } from "@/lib/errors";
import { stripCodeFences } from "@/lib/text";
import {
  ModelFindingSchema,
  TestCaseSchema,
  type ModelFinding,
  type TestCase,
} from "./schema";
import { MAX_TEST_CASES } from "./limits";

export interface NormalizedReview {
  summary: string;
  findings: ModelFinding[];
  limitations: string[];
  rejected: number;
  warnings: string[];
}

export interface NormalizedTests {
  summary: string;
  framework: string;
  cases: TestCase[];
  rejected: number;
  warnings: string[];
}

function invalidOutput(message: string): AppError {
  return new AppError(502, "MODEL_OUTPUT_INVALID", message, { retryable: true });
}

/** Extract the first balanced JSON object/array, tolerating fences and prose. */
export function extractJson(text: string): unknown {
  const cleaned = stripCodeFences(text).trim();
  if (!cleaned) throw invalidOutput("The model returned an empty response.");

  const start = cleaned.search(/[[{]/);
  if (start === -1) throw invalidOutput("The model response did not contain JSON.");

  const opening = cleaned[start];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < cleaned.length; index += 1) {
    const char = cleaned[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === opening) depth += 1;
    if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        const candidate = cleaned.slice(start, index + 1);
        return parseCandidate(candidate);
      }
    }
  }

  return parseCandidate(cleaned.slice(start));
}

function parseCandidate(candidate: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch {
    // One conservative repair pass for the most common model mistakes.
    const repaired = candidate
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/^\uFEFF/, "");
    try {
      return JSON.parse(repaired);
    } catch {
      throw invalidOutput("The model returned malformed JSON. Retry the review.");
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstDefined(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function parseLocation(record: Record<string, unknown>): { file: unknown; lineStart: unknown; lineEnd: unknown } {
  let file = firstDefined(record, ["file", "path", "filename", "filePath"]);
  let lineStart = firstDefined(record, ["lineStart", "startLine", "line", "lineNumber"]);
  let lineEnd = firstDefined(record, ["lineEnd", "endLine"]);

  const location = firstDefined(record, ["location", "position"]);
  if (typeof location === "string") {
    const match = location.match(/^(.+?)(?::(\d+)(?:\s*[-–]\s*(\d+))?)?$/);
    if (match) {
      if (file === undefined || file === null) file = match[1];
      if (lineStart === undefined || lineStart === null) lineStart = match[2];
      if (lineEnd === undefined || lineEnd === null) lineEnd = match[3];
    }
  }

  if (typeof lineStart === "string" && /\d+\s*[-–]\s*\d+/.test(lineStart)) {
    const [start, end] = lineStart.split(/[-–]/);
    lineStart = start;
    if (lineEnd === undefined || lineEnd === null) lineEnd = end;
  }

  return { file, lineStart, lineEnd };
}

export function normalizeFindingCandidate(value: unknown): unknown {
  const record = asRecord(value);
  const location = parseLocation(record);

  return {
    title: firstDefined(record, ["title", "name", "issue", "summary"]),
    severity: firstDefined(record, ["severity", "level", "priority", "risk"]),
    category: firstDefined(record, ["category", "type", "kind"]),
    file: location.file,
    lineStart: location.lineStart,
    lineEnd: location.lineEnd,
    evidence: firstDefined(record, ["evidence", "snippet", "code", "excerpt", "quote"]),
    explanation: firstDefined(record, ["explanation", "description", "why", "impact", "reason"]),
    fix: firstDefined(record, ["fix", "recommendation", "suggestion", "remediation", "solution"]),
    confidence: firstDefined(record, ["confidence", "certainty", "score"]),
  };
}

export function normalizeReviewPayload(payload: unknown): NormalizedReview {
  const warnings: string[] = [];
  let root = payload;

  if (Array.isArray(root)) {
    root = { findings: root };
    warnings.push("The model returned a bare array; it was wrapped as a review.");
  }

  const record = asRecord(root);
  const rawFindings = firstDefined(record, ["findings", "issues", "results", "comments"]);

  let findingsArray: unknown[];
  if (Array.isArray(rawFindings)) {
    findingsArray = rawFindings;
  } else if (record.title || record.evidence) {
    findingsArray = [record];
    warnings.push("The model returned a single finding; it was wrapped as a review.");
  } else {
    throw invalidOutput("The model response did not contain a findings array.");
  }

  const summaryValue = firstDefined(record, ["summary", "overview", "conclusion"]);
  const summary =
    typeof summaryValue === "string" && summaryValue.trim()
      ? summaryValue.trim().slice(0, 3000)
      : "The model returned findings without a summary.";

  if (!summaryValue) warnings.push("The model omitted the review summary.");

  const findings: ModelFinding[] = [];
  let rejected = 0;

  for (const candidate of findingsArray.slice(0, 40)) {
    const normalized = normalizeFindingCandidate(candidate);
    const parsed = ModelFindingSchema.safeParse(normalized);
    if (parsed.success) findings.push(parsed.data);
    else rejected += 1;
  }

  if (rejected > 0) {
    warnings.push(
      `${rejected} model finding${rejected === 1 ? "" : "s"} did not match the review schema and ${
        rejected === 1 ? "was" : "were"
      } dropped.`,
    );
  }

  const rawLimitations = firstDefined(record, ["limitations", "caveats"]);
  const limitations = Array.isArray(rawLimitations)
    ? rawLimitations
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim().slice(0, 400))
        .slice(0, 8)
    : [];

  return { summary, findings, limitations, rejected, warnings };
}

export function normalizeTestsPayload(payload: unknown): NormalizedTests {
  const record = asRecord(payload);
  const warnings: string[] = [];

  const summaryValue = firstDefined(record, ["summary", "overview"]);
  const summary =
    typeof summaryValue === "string" && summaryValue.trim()
      ? summaryValue.trim().slice(0, 1200)
      : "Suggested tests based on the submitted code.";

  const frameworkValue = firstDefined(record, ["framework", "runner"]);
  const framework =
    typeof frameworkValue === "string" && frameworkValue.trim()
      ? frameworkValue.trim().slice(0, 60)
      : "Vitest";

  const rawCases = firstDefined(record, ["cases", "tests", "testCases"]);
  if (!Array.isArray(rawCases)) {
    throw invalidOutput("The model response did not contain test cases.");
  }

  const cases: NormalizedTests["cases"] = [];
  let rejected = 0;

  for (const candidate of rawCases.slice(0, MAX_TEST_CASES)) {
    const item = asRecord(candidate);
    const normalized = {
      title: firstDefined(item, ["title", "name"]),
      testType: firstDefined(item, ["testType", "test_type", "type", "kind"]),
      setup: firstDefined(item, ["setup", "input", "inputs", "arrange", "given"]),
      expected: firstDefined(item, [
        "expected",
        "expectedResult",
        "expected_result",
        "result",
        "assertion",
        "then",
      ]),
      finding: firstDefined(item, ["finding", "covers", "findingTitle", "finding_title"]),
    };
    const parsed = TestCaseSchema.safeParse(normalized);
    if (parsed.success) cases.push(parsed.data);
    else rejected += 1;
  }

  if (rejected > 0) {
    warnings.push(
      `${rejected} test case${rejected === 1 ? "" : "s"} did not match the schema and ${
        rejected === 1 ? "was" : "were"
      } dropped.`,
    );
  }

  if (rawCases.length > MAX_TEST_CASES) {
    warnings.push(`Only the first ${MAX_TEST_CASES} test cases are kept.`);
  }

  return { summary, framework, cases, rejected, warnings };
}