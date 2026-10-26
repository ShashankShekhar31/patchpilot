import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";
import { analyzeInput } from "@/lib/diff";
import { locateEvidence } from "@/lib/evidence";
import { countBySeverity, sortBySeverity, type Severity } from "@/lib/severity";
import { truncate } from "@/lib/text";
import { resolveProviderConfig, toPublicProvider, type ProviderConfig } from "./config";
import { demoAsk, demoReview, demoTests } from "./demo";
import { TEST_CONTEXT_CHARS } from "./limits";
import {
  extractJson,
  normalizeReviewPayload,
  normalizeTestsPayload,
  type NormalizedReview,
  type NormalizedTests,
} from "./parse";
import {
  buildAskPrompt,
  buildRepairPrompt,
  buildReviewPrompt,
  buildTestsPrompt,
} from "./prompts";
import { createProvider, type ChatProvider, type CompletionResult } from "./provider";
import type {
  AskResult,
  Finding,
  ReviewResult,
  TestResult,
} from "./schema";
import type { AskRequest, ContextFinding, ReviewRequest, TestsRequest } from "./requests";

export interface ServiceDeps {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  provider?: ChatProvider;
}

function nowIso(deps: ServiceDeps): string {
  return (deps.now?.() ?? new Date()).toISOString();
}

function assertInputSize(code: string, config: ProviderConfig): void {
  if (code.length > config.maxInputChars) {
    throw new AppError(
      413,
      "PAYLOAD_TOO_LARGE",
      `Submission is ${code.length.toLocaleString()} characters. The limit is ${config.maxInputChars.toLocaleString()}.`,
    );
  }
}

function usageOf(...results: (CompletionResult | undefined)[]): ReviewResult["usage"] {
  const present = results.filter((result): result is CompletionResult => Boolean(result?.usage));
  if (present.length === 0) return undefined;
  return {
    promptTokens: present.reduce((sum, result) => sum + (result.usage?.promptTokens ?? 0), 0),
    completionTokens: present.reduce((sum, result) => sum + (result.usage?.completionTokens ?? 0), 0),
  };
}

export interface FinalizedReview {
  findings: Finding[];
  warnings: string[];
  dropped: number;
}

/**
 * Verify every excerpt against the submission, recompute locations from the
 * parsed diff/source, drop unsupported findings, deduplicate, and order them.
 */
export function finalizeFindings(
  raw: NormalizedReview["findings"],
  code: string,
  options: { filename?: string | null; maxFindings?: number } = {},
): FinalizedReview {
  const warnings: string[] = [];
  const verified: Finding[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  let duplicates = 0;

  for (const finding of raw) {
    const location = locateEvidence(code, finding.evidence, {
      filename: finding.file ?? options.filename,
    });

    if (!location.verified || location.lineStart === null) {
      dropped += 1;
      continue;
    }

    const duplicateKey = `${location.file}:${location.lineStart}:${finding.title.toLowerCase()}`;
    if (seen.has(duplicateKey)) {
      duplicates += 1;
      continue;
    }
    seen.add(duplicateKey);

    verified.push({
      ...finding,
      id: "pending",
      evidence: truncate(finding.evidence, 2000),
      file: location.file,
      lineStart: location.lineStart,
      lineEnd: location.lineEnd ?? location.lineStart,
      evidenceVerified: true,
      locationSource: "code",
      ...(location.note ? { locationNote: location.note } : {}),
    });
  }

  if (dropped > 0) {
    warnings.push(
      `${dropped} finding${dropped === 1 ? "" : "s"} ${dropped === 1 ? "was" : "were"} discarded because the quoted evidence was not found in the submission.`,
    );
  }
  if (duplicates > 0) {
    warnings.push(
      `${duplicates} duplicate finding${duplicates === 1 ? "" : "s"} ${duplicates === 1 ? "was" : "were"} removed.`,
    );
  }

  const maxFindings = options.maxFindings ?? 12;
  const ordered = sortBySeverity(verified).slice(0, maxFindings);
  if (verified.length > maxFindings) {
    warnings.push(`Only the ${maxFindings} highest-severity verified findings are shown.`);
  }

  return {
    findings: ordered.map((finding, index) => ({
      ...finding,
      id: `F-${String(index + 1).padStart(2, "0")}`,
    })),
    warnings,
    dropped,
  };
}

// The Alan harness permits 32k output for this model. 2.4k is a deliberate
// small budget: enough for 6 concise findings, far below the provider limit.
const REVIEW_MAX_TOKENS = 2_400;
const REPAIR_MAX_TOKENS = 1_200;
const ASK_MAX_TOKENS = 600;
// Three compact tests fit comfortably here. The Alan harness allows 32k
// output for this model, so 1.8k is a bounded request rather than a limit.
const TESTS_MAX_TOKENS = 900;
/** Below this, a repair call cannot finish inside the deadline. */
const MIN_REPAIR_BUDGET_MS = 6_000;

interface CompletionBundle {
  normalized: NormalizedReview;
  usage?: ReviewResult["usage"];
  warnings: string[];
}

async function completeReview(
  provider: ChatProvider,
  request: ReviewRequest,
  config: ProviderConfig,
  deadlineAt: number,
): Promise<CompletionBundle> {
  const prompt = buildReviewPrompt({
    code: request.code,
    filename: request.filename,
    language: request.language,
    focus: request.focus,
    maxPromptChars: config.maxPromptChars,
  });

  const warnings: string[] = [];
  if (prompt.truncated) {
    warnings.push(
      `The submission was truncated to ${config.maxPromptChars.toLocaleString()} characters for the model prompt. Findings about the omitted tail cannot be produced.`,
    );
  }

  const first = await provider.complete({
    system: prompt.system,
    user: prompt.user,
    json: true,
    maxTokens: Math.min(config.maxOutputTokens, REVIEW_MAX_TOKENS),
    deadlineAt,
  });

  try {
    return {
      normalized: normalizeReviewPayload(extractJson(first.text)),
      usage: usageOf(first),
      warnings,
    };
  } catch (error) {
    // Only a malformed-but-complete response is worth repairing. Truncated or
    // timed-out output is surfaced instead of burning another call.
    const repairable = error instanceof AppError && error.code === "MODEL_OUTPUT_INVALID";
    if (!repairable || deadlineAt - Date.now() < MIN_REPAIR_BUDGET_MS) throw error;

    const repair = await provider.complete({
      ...buildRepairPrompt(first.text),
      json: true,
      maxTokens: Math.min(config.maxOutputTokens, REPAIR_MAX_TOKENS),
      deadlineAt,
    });
    return {
      normalized: normalizeReviewPayload(extractJson(repair.text)),
      usage: usageOf(first, repair),
      warnings,
    };
  }
}

export async function runReview(
  request: ReviewRequest,
  deps: ServiceDeps = {},
): Promise<ReviewResult> {
  const started = Date.now();
  const config = resolveProviderConfig(deps.env);
  assertInputSize(request.code, config);

  const deadlineAt = started + config.deadlineMs;
  const analysis = analyzeInput(request.code);
  const warnings: string[] = [];
  let normalized: NormalizedReview;
  let usage: ReviewResult["usage"];

  if (config.kind === "demo") {
    normalized = demoReview({
      code: request.code,
      filename: request.filename,
      language: request.language,
      focus: request.focus,
    });
  } else {
    const provider = deps.provider ?? createProvider(config);
    const result = await completeReview(provider, request, config, deadlineAt);
    normalized = result.normalized;
    usage = result.usage;
    warnings.push(...result.warnings);
  }

  const finalized = finalizeFindings(normalized.findings, request.code, {
    filename: request.filename,
  });

  warnings.push(...normalized.warnings, ...finalized.warnings);

  if (finalized.findings.length === 0) {
    warnings.push(
      config.kind === "demo"
        ? "Sample mode found no verifiable issues. This does not mean the code is safe."
        : "No finding survived evidence verification. Try a narrower submission or a different model.",
    );
  }

  const limitations = [...normalized.limitations];
  if (analysis.kind === "diff" && analysis.files.length > 0) {
    limitations.push(
      `Review scope is the pasted diff for ${analysis.files.slice(0, 4).join(", ")}${analysis.files.length > 4 ? " and others" : ""}. Code outside the diff was not visible.`,
    );
  } else {
    limitations.push("Review scope is the pasted source only. Imports, callers, and runtime configuration were not visible.");
  }
  limitations.push(
    "Model findings are suggestions, not verified vulnerabilities. PatchPilot checks that quoted evidence exists, not that a finding is exploitable.",
  );

  return {
    id: `rv_${randomUUID().slice(0, 8)}`,
    createdAt: nowIso(deps),
    mode: config.kind === "demo" ? "sample" : "live",
    provider: toPublicProvider(config),
    input: {
      kind: analysis.kind,
      chars: request.code.length,
      lines: analysis.kind === "diff" ? analysis.addedLines : analysis.addedLines,
      files: analysis.files,
      addedLines: analysis.addedLines,
      removedLines: analysis.removedLines,
    },
    summary: normalized.summary,
    findings: finalized.findings,
    counts: countBySeverity(finalized.findings),
    warnings,
    limitations,
    durationMs: Date.now() - started,
    usage,
  };
}

function toContextFinding(finding: ContextFinding): Finding {
  return {
    id: "context",
    title: finding.title,
    severity: finding.severity,
    category: finding.category ?? "other",
    file: finding.file ?? null,
    lineStart: finding.lineStart ?? null,
    lineEnd: finding.lineStart ?? null,
    evidence: finding.evidence ?? "",
    explanation: finding.explanation ?? "",
    fix: finding.fix ?? "",
    confidence: 0.5,
    evidenceVerified: true,
    locationSource: "code",
  };
}

export async function runAsk(request: AskRequest, deps: ServiceDeps = {}): Promise<AskResult> {
  const started = Date.now();
  const config = resolveProviderConfig(deps.env);
  assertInputSize(request.code, config);

  const findings = request.findings.map(toContextFinding);

  if (config.kind === "demo") {
    return {
      answer: demoAsk({
        question: request.question,
        findings: findings.map((finding) => ({
          severity: finding.severity,
          title: finding.title,
          fix: finding.fix || "Use the suggested fix from the finding card.",
          file: finding.file,
          lineStart: finding.lineStart,
          category: finding.category,
        })),
      }),
      mode: "sample",
      provider: {
        kind: config.kind,
        label: config.label,
        model: config.model,
        modelName: "Deterministic sample rules",
        license: "Not applicable",
      },
    };
  }

  const provider = deps.provider ?? createProvider(config);
  const prompt = buildAskPrompt({
    code: request.code,
    question: request.question,
    findings,
    history: request.history,
    maxPromptChars: config.maxPromptChars,
  });

  const result = await provider.complete({
    system: prompt.system,
    user: prompt.user,
    json: false,
    temperature: 0.2,
    maxTokens: Math.min(config.maxOutputTokens, ASK_MAX_TOKENS),
    deadlineAt: started + config.deadlineMs,
  });

  const answer = result.text.trim().slice(0, 8_000);
  if (!answer) {
    throw new AppError(502, "PROVIDER_UNAVAILABLE", "The model returned an empty answer.", {
      retryable: true,
    });
  }

  return {
    answer,
    mode: "live",
    provider: {
      kind: config.kind,
      label: config.label,
      model: config.model,
      modelName: config.card?.name ?? config.model,
      license: config.card?.license ?? "Not verified",
    },
    usage: usageOf(result),
  };
}

async function completeTests(
  provider: ChatProvider,
  request: TestsRequest,
  config: ProviderConfig,
  deadlineAt: number,
): Promise<{ normalized: NormalizedTests; usage?: ReviewResult["usage"]; warnings: string[] }> {
  const prompt = buildTestsPrompt({
    code: request.code,
    framework: request.framework,
    language: request.language,
    findings: request.findings.map(toContextFinding),
    maxPromptChars: config.maxPromptChars,
    maxContextChars: TEST_CONTEXT_CHARS,
  });
  const warnings: string[] = [];
  if (prompt.truncated) {
    warnings.push(
      `The submission was truncated to ${config.maxPromptChars.toLocaleString()} characters for the model prompt.`,
    );
  }

  const result = await provider.complete({
    system: prompt.system,
    user: prompt.user,
    json: true,
    maxTokens: Math.min(config.maxOutputTokens, TESTS_MAX_TOKENS),
    deadlineAt,
  });

  return {
    normalized: normalizeTestsPayload(extractJson(result.text)),
    usage: usageOf(result),
    warnings,
  };
}

export async function runTests(
  request: TestsRequest,
  deps: ServiceDeps = {},
): Promise<TestResult> {
  const config = resolveProviderConfig(deps.env);
  assertInputSize(request.code, config);

  let normalized: NormalizedTests;
  let usage: ReviewResult["usage"];
  const warnings: string[] = [];

  if (config.kind === "demo") {
    normalized = demoTests({ code: request.code, framework: request.framework });
  } else {
    const provider = deps.provider ?? createProvider(config);
    const result = await completeTests(
      provider,
      request,
      config,
      Date.now() + config.deadlineMs,
    );
    normalized = result.normalized;
    usage = result.usage;
    warnings.push(...result.warnings);
  }

  warnings.push(...normalized.warnings);
  if (normalized.cases.length === 0) {
    warnings.push("The model did not return any usable test cases.");
  }

  return {
    summary: normalized.summary,
    framework: normalized.framework,
    cases: normalized.cases,
    mode: config.kind === "demo" ? "sample" : "live",
    provider: toPublicProvider(config),
    warnings,
    usage,
  };
}

export function severityCountsForDisplay(counts: Record<Severity, number>): { severity: Severity; count: number }[] {
  return sortBySeverity(
    (Object.keys(counts) as Severity[]).map((severity) => ({ severity, count: counts[severity] })),
  );
}