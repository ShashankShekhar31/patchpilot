import { z } from "zod";
import { SEVERITIES, normalizeSeverity } from "@/lib/severity";

export const CATEGORIES = [
  "bug",
  "security",
  "error-handling",
  "tests",
  "maintainability",
  "performance",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

const CATEGORY_ALIASES: Record<string, Category> = {
  bug: "bug",
  correctness: "bug",
  logic: "bug",
  security: "security",
  vulnerability: "security",
  "error-handling": "error-handling",
  errorhandling: "error-handling",
  errors: "error-handling",
  reliability: "error-handling",
  tests: "tests",
  testing: "tests",
  coverage: "tests",
  maintainability: "maintainability",
  style: "maintainability",
  design: "maintainability",
  readability: "maintainability",
  performance: "performance",
  perf: "performance",
  other: "other",
};

export function normalizeCategory(value: unknown): Category {
  if (typeof value !== "string") return "other";
  const key = value.trim().toLowerCase().replace(/[^a-z-]/g, "");
  return CATEGORY_ALIASES[key] ?? "other";
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toPositiveIntOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const int = Math.trunc(value);
    return int > 0 ? int : null;
  }
  if (typeof value === "string") {
    const match = value.match(/\d+/);
    if (match) {
      const int = Number(match[0]);
      return int > 0 ? int : null;
    }
  }
  return null;
}

function toConfidence(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }
  if (typeof value === "string") {
    const match = value.match(/\d+(?:\.\d+)?/);
    if (match) {
      const parsed = Number(match[0]);
      const scaled = value.includes("%") || parsed > 1 ? parsed / 100 : parsed;
      return Math.min(1, Math.max(0, scaled));
    }
  }
  return 0.5;
}

const trimmedText = (max: number) => z.preprocess(asText, z.string().max(max));

export const CategorySchema = z.preprocess(normalizeCategory, z.enum(CATEGORIES));
export const SeveritySchema = z.preprocess(normalizeSeverity, z.enum(SEVERITIES));

/** A finding as returned by the model, before PatchPilot verifies evidence. */
export const ModelFindingSchema = z.object({
  title: trimmedText(200).pipe(z.string().min(3)),
  severity: SeveritySchema,
  category: CategorySchema.default("other"),
  file: z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null),
    z.string().max(300).nullable(),
  ),
  lineStart: z.preprocess(toPositiveIntOrNull, z.number().int().positive().nullable()),
  lineEnd: z.preprocess(toPositiveIntOrNull, z.number().int().positive().nullable()),
  evidence: trimmedText(2000).pipe(z.string().min(1)),
  explanation: trimmedText(2500).pipe(z.string().min(10)),
  fix: trimmedText(2500).pipe(z.string().min(3)),
  confidence: z.preprocess(toConfidence, z.number().min(0).max(1)),
});

export type ModelFinding = z.infer<typeof ModelFindingSchema>;

export const ReviewOutputSchema = z.object({
  summary: trimmedText(3000).pipe(z.string().min(1)),
  findings: z.array(z.unknown()).max(40),
  limitations: z.array(trimmedText(400)).max(8).optional(),
});

export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

export const FindingSchema = ModelFindingSchema.extend({
  id: z.string().min(1),
  evidenceVerified: z.boolean(),
  locationNote: z.string().max(300).optional(),
  locationSource: z.enum(["code", "unresolved"]),
});

export type Finding = z.infer<typeof FindingSchema>;

export const ProviderPublicSchema = z.object({
  kind: z.enum(["alan", "openrouter", "openai-compatible", "demo"]),
  label: z.string(),
  model: z.string(),
  modelName: z.string(),
  license: z.string(),
  licenseVerified: z.boolean(),
  licenseUrl: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  mode: z.enum(["live", "sample"]),
  baseUrlHost: z.string(),
  maxInputChars: z.number(),
  maxOutputTokens: z.number(),
  timeoutMs: z.number(),
  deadlineMs: z.number(),
  maxPromptChars: z.number(),
  reason: z.string().nullable(),
  credentialSource: z.enum([
    "ALAN_API_KEY",
    "ALAN_CODE_API_KEY",
    "OPENROUTER_API_KEY",
    "LLM_API_KEY",
    "none",
  ]),
});

export type ProviderPublic = z.infer<typeof ProviderPublicSchema>;

export const ReviewResultSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  mode: z.enum(["live", "sample"]),
  provider: ProviderPublicSchema,
  input: z.object({
    kind: z.enum(["diff", "source"]),
    chars: z.number(),
    lines: z.number(),
    files: z.array(z.string()),
    addedLines: z.number(),
    removedLines: z.number(),
  }),
  summary: z.string(),
  findings: z.array(FindingSchema),
  counts: z.record(z.enum(SEVERITIES), z.number()),
  warnings: z.array(z.string()),
  limitations: z.array(z.string()),
  durationMs: z.number(),
  usage: z
    .object({
      promptTokens: z.number().optional(),
      completionTokens: z.number().optional(),
    })
    .optional(),
});

export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export const AskResultSchema = z.object({
  answer: z.string(),
  mode: z.enum(["live", "sample"]),
  provider: z.object({
    kind: z.string(),
    label: z.string(),
    model: z.string(),
    modelName: z.string(),
    license: z.string(),
  }),
  usage: z
    .object({
      promptTokens: z.number().optional(),
      completionTokens: z.number().optional(),
    })
    .optional(),
});

export type AskResult = z.infer<typeof AskResultSchema>;

export const TEST_TYPES = ["unit", "integration", "regression", "edge-case", "security"] as const;

function normalizeTestType(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const key = value.trim().toLowerCase().replace(/[^a-z-]/g, "");
  const aliases: Record<string, string> = {
    unit: "unit",
    unittest: "unit",
    integration: "integration",
    integrationtest: "integration",
    regression: "regression",
    regressiontest: "regression",
    edgecase: "edge-case",
    edge: "edge-case",
    security: "security",
    securitytest: "security",
  };
  return aliases[key] ?? key;
}

export const TestCaseSchema = z.object({
  title: trimmedText(200).pipe(z.string().min(3)),
  testType: z.preprocess(normalizeTestType, z.enum(TEST_TYPES)),
  setup: trimmedText(800).pipe(z.string().min(3)),
  expected: trimmedText(800).pipe(z.string().min(3)),
  finding: trimmedText(300).pipe(z.string().min(3)),
});

export type TestCase = z.infer<typeof TestCaseSchema>;

export const TestOutputSchema = z.object({
  summary: trimmedText(1200).pipe(z.string().min(1)),
  framework: trimmedText(60).pipe(z.string().min(1)),
  cases: z.array(z.unknown()).max(12),
});

export type TestOutput = z.infer<typeof TestOutputSchema>;

export const TestResultSchema = z.object({
  summary: z.string(),
  framework: z.string(),
  cases: z.array(TestCaseSchema),
  mode: z.enum(["live", "sample"]),
  provider: ProviderPublicSchema,
  warnings: z.array(z.string()),
  usage: z
    .object({
      promptTokens: z.number().optional(),
      completionTokens: z.number().optional(),
    })
    .optional(),
});

export type TestResult = z.infer<typeof TestResultSchema>;