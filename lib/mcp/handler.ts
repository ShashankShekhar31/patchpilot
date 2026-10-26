import { McpAskRequestSchema, McpReviewRequestSchema, McpTestsRequestSchema } from "@/lib/ai/requests";
import { runAsk, runReview, runTests, type ServiceDeps } from "@/lib/ai/review-service";
import type { ReviewResult, TestResult } from "@/lib/ai/schema";
import { AppError } from "@/lib/errors";

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export const MCP_TOOLS = [
  {
    name: "review_diff",
    title: "Review a diff or source file",
    description:
      "Run PatchPilot's evidence-checked review. Returns severity, category, verified file/line, exact code evidence, explanation, suggested fix, and confidence. Findings whose evidence is not present in the submission are dropped.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["code"],
      properties: {
        code: {
          type: "string",
          minLength: 10,
          maxLength: 120000,
          description: "Unified diff or source file to review. Treated as untrusted data.",
        },
        filename: { type: "string", maxLength: 200 },
        language: { type: "string", maxLength: 40 },
        focus: { type: "string", enum: ["all", "security", "bugs", "tests", "maintainability"] },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "generate_tests",
    title: "Suggest tests for a change",
    description:
      "Suggest focused test cases for a diff or source file, using the configured model or deterministic sample mode. Suggested tests are not executed.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["code"],
      properties: {
        code: { type: "string", minLength: 10, maxLength: 120000 },
        framework: { type: "string", maxLength: 40 },
        language: { type: "string", maxLength: 40 },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "ask_review_question",
    title: "Ask about submitted code",
    description:
      "Ask a focused follow-up question about a diff or source file. Answers only from the submitted code and are not executed.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["code", "question"],
      properties: {
        code: { type: "string", minLength: 10, maxLength: 120000 },
        question: { type: "string", minLength: 3, maxLength: 1000 },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
] as const;

type RpcId = string | number | null;

interface RpcResponse {
  jsonrpc: "2.0";
  id: RpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rpcError(id: RpcId, code: number, message: string, data?: unknown): RpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

function rpcResult(id: RpcId, result: unknown): RpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function fence(code: string, language = "text"): string {
  let marker = "```";
  while (code.includes(marker)) marker += "`";
  return `${marker}${language}\n${code}\n${marker}`;
}

export function formatReviewMarkdown(result: ReviewResult): string {
  const lines: string[] = [];
  lines.push(`# PatchPilot review ${result.id}`);
  lines.push("");
  lines.push(
    `Mode: **${result.mode === "live" ? "live model" : "sample data"}** · Provider: ${result.provider.label} · Model: ${result.provider.modelName} (${result.provider.license})`,
  );
  lines.push("");
  lines.push(result.summary);
  lines.push("");
  lines.push(
    `Findings: ${result.findings.length} (critical ${result.counts.critical}, high ${result.counts.high}, medium ${result.counts.medium}, low ${result.counts.low}, info ${result.counts.info})`,
  );

  for (const finding of result.findings) {
    lines.push("");
    lines.push(`## ${finding.id} · ${finding.severity.toUpperCase()} · ${finding.title}`);
    lines.push(
      `- Category: ${finding.category}\n- Location: ${
        finding.file ? `${finding.file}${finding.lineStart ? `:${finding.lineStart}${finding.lineEnd && finding.lineEnd !== finding.lineStart ? `-${finding.lineEnd}` : ""}` : ""}` : "unresolved"
      }\n- Confidence: ${finding.confidence}\n- Evidence verified: ${finding.evidenceVerified ? "yes" : "no"}`,
    );
    lines.push("");
    lines.push("Evidence:");
    lines.push(fence(finding.evidence, "text"));
    lines.push("");
    lines.push(`Why: ${finding.explanation}`);
    lines.push("");
    lines.push(`Fix: ${finding.fix}`);
  }

  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("## Warnings");
    for (const warning of result.warnings) lines.push(`- ${warning}`);
  }

  lines.push("");
  lines.push("## Limitations");
  for (const limitation of result.limitations) lines.push(`- ${limitation}`);

  return lines.join("\n");
}

function formatTestsMarkdown(result: TestResult): string {
  const lines: string[] = [];
  lines.push("# PatchPilot test suggestions");
  lines.push("");
  lines.push(
    `Mode: **${result.mode === "live" ? "live model" : "sample data"}** · Provider: ${result.provider.label} · Model: ${result.provider.modelName}`,
  );
  lines.push("");
  lines.push(result.summary);
  lines.push("");
  lines.push(`Framework: ${result.framework}`);
  for (const testCase of result.cases) {
    lines.push("");
    lines.push(`## ${testCase.title}`);
    lines.push(
      `- Type: ${testCase.testType}\n- Setup: ${testCase.setup}\n- Expected: ${testCase.expected}\n- Finding: ${testCase.finding}`,
    );
  }
  lines.push("");
  lines.push("These tests are suggestions and were not executed.");
  return lines.join("\n");
}

function toolError(message: string) {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function validationMessage(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return `Invalid arguments: ${error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "arguments"} ${issue.message}`)
    .join("; ")}`;
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  deps: ServiceDeps,
): Promise<unknown> {
  if (name === "review_diff") {
    const parsed = McpReviewRequestSchema.safeParse(args);
    if (!parsed.success) return toolError(validationMessage(parsed.error));
    const result = await runReview(parsed.data, deps);
    return {
      content: [{ type: "text", text: formatReviewMarkdown(result) }],
      structuredContent: result,
    };
  }

  if (name === "generate_tests") {
    const parsed = McpTestsRequestSchema.safeParse(args);
    if (!parsed.success) return toolError(validationMessage(parsed.error));
    const result = await runTests({ ...parsed.data, findings: [] }, deps);
    return {
      content: [{ type: "text", text: formatTestsMarkdown(result) }],
      structuredContent: result,
    };
  }

  if (name === "ask_review_question") {
    const parsed = McpAskRequestSchema.safeParse(args);
    if (!parsed.success) return toolError(validationMessage(parsed.error));
    const result = await runAsk({ ...parsed.data, findings: [], history: [] }, deps);
    return {
      content: [{ type: "text", text: result.answer }],
      structuredContent: result,
    };
  }

  return null;
}

/**
 * Stateless MCP Streamable HTTP handler. Supports initialize, tools/list,
 * tools/call, and ping. Batch requests are rejected explicitly.
 */
export async function handleMcp(
  payload: unknown,
  deps: ServiceDeps = {},
): Promise<RpcResponse | null> {
  if (Array.isArray(payload)) {
    return rpcError(null, -32600, "Batch requests are not supported.");
  }

  if (!isRecord(payload)) {
    return rpcError(null, -32600, "Invalid JSON-RPC request.");
  }

  const hasId = Object.prototype.hasOwnProperty.call(payload, "id");
  const id: RpcId =
    typeof payload.id === "string" || typeof payload.id === "number" ? payload.id : null;

  if (payload.jsonrpc !== "2.0" || typeof payload.method !== "string") {
    // Only a well-formed notification (valid envelope, no id) may go unanswered.
    return rpcError(id, -32600, "Invalid JSON-RPC request.");
  }

  const method = payload.method;
  const params = isRecord(payload.params) ? payload.params : {};

  if (method === "notifications/initialized" || method.startsWith("notifications/")) {
    return null;
  }

  if (!hasId) {
    return null;
  }

  if (method === "initialize") {
    const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
    const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
      ? requested
      : MCP_PROTOCOL_VERSIONS[0];

    return rpcResult(id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "patchpilot", title: "PatchPilot", version: "0.1.0" },
      instructions:
        "Use review_diff to get evidence-checked findings, generate_tests for suggested tests, and ask_review_question for focused follow-ups. Never execute submitted code. Findings are suggestions, not verified vulnerabilities.",
    });
  }

  if (method === "ping") return rpcResult(id, {});

  if (method === "tools/list") {
    return rpcResult(id, { tools: MCP_TOOLS });
  }

  if (method === "tools/call") {
    const name = params.name;
    if (typeof name !== "string") {
      return rpcError(id, -32602, "tools/call requires a tool name.");
    }
    if (!MCP_TOOLS.some((tool) => tool.name === name)) {
      return rpcError(id, -32602, `Unknown tool: ${name}`);
    }
    const args = isRecord(params.arguments) ? params.arguments : {};

    try {
      const result = await callTool(name, args, deps);
      if (result === null) return rpcError(id, -32602, `Unknown tool: ${name}`);
      return rpcResult(id, result);
    } catch (error) {
      if (error instanceof AppError) {
        return rpcResult(id, toolError(error.message));
      }
      return rpcResult(id, toolError("The tool failed unexpectedly. Retry or check the server configuration."));
    }
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}