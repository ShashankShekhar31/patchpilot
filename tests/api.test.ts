import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as reviewPost } from "@/app/api/review/route";
import { POST as askPost } from "@/app/api/ask/route";
import { POST as testsPost } from "@/app/api/tests/route";
import { GET as statusGet } from "@/app/api/status/route";
import { POST as mcpPost, GET as mcpGet } from "@/app/api/mcp/route";
import { resetRateLimits } from "@/lib/rate-limit";
import { SAMPLE_DIFF } from "@/lib/samples";

let ipCounter = 0;

function request(
  path: string,
  body: unknown,
  options: { contentType?: string; ip?: string; authorization?: string } = {},
): Request {
  ipCounter += 1;
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": options.contentType ?? "application/json",
      "x-forwarded-for": options.ip ?? `10.0.0.${ipCounter}`,
      ...(options.authorization ? { authorization: options.authorization } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  resetRateLimits();
  vi.stubEnv("PATCHPILOT_PROVIDER", "demo");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/review", () => {
  it("returns a sample review for valid input", async () => {
    const response = await reviewPost(request("/api/review", { code: SAMPLE_DIFF }));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.mode).toBe("sample");
    expect(body.findings).toHaveLength(8);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects a non-JSON content type", async () => {
    const response = await reviewPost(
      request("/api/review", { code: SAMPLE_DIFF }, { contentType: "text/plain" }),
    );
    expect(response.status).toBe(415);
    expect((await response.json()).error.code).toBe("BAD_REQUEST");
  });

  it("rejects malformed JSON", async () => {
    const response = await reviewPost(request("/api/review", "{not-json"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("BAD_REQUEST");
  });

  it("reports schema validation details without echoing the body", async () => {
    const response = await reviewPost(request("/api/review", { code: "hi" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.details).toContain("code");
  });

  it("enforces the configured input limit", async () => {
    vi.stubEnv("PATCHPILOT_MAX_INPUT_CHARS", "1000");
    const response = await reviewPost(request("/api/review", { code: "a".repeat(1001) }));
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rate limits repeated reviews from one address", async () => {
    const ip = "203.0.113.9";
    for (let index = 0; index < 12; index += 1) {
      const response = await reviewPost(request("/api/review", { code: SAMPLE_DIFF }, { ip }));
      expect(response.status).toBe(200);
    }
    const limited = await reviewPost(request("/api/review", { code: SAMPLE_DIFF }, { ip }));
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe("RATE_LIMITED");
  });
});

describe("POST /api/ask and /api/tests", () => {
  it("answers a follow-up in sample mode", async () => {
    const response = await askPost(
      request("/api/ask", {
        code: SAMPLE_DIFF,
        question: "What should I fix first?",
        findings: [],
        history: [],
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).answer).toMatch(/Sample mode/);
  });

  it("rejects an empty question", async () => {
    const response = await askPost(
      request("/api/ask", { code: SAMPLE_DIFF, question: " " }),
    );
    expect(response.status).toBe(400);
  });

  it("returns test suggestions", async () => {
    const response = await testsPost(request("/api/tests", { code: SAMPLE_DIFF }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.mode).toBe("sample");
    expect(body.cases.length).toBeGreaterThan(0);
  });
});

describe("GET /api/status", () => {
  it("reports sample mode without credentials", async () => {
    const response = await statusGet();
    const body = await response.json();
    expect(body.provider.mode).toBe("sample");
    expect(body.provider.kind).toBe("demo");
    expect(body.alan.builtWith).toBe("Alan Code");
    expect(body.alan.runtimeInferenceApi).toBe(false);
  });

  it("reports the Alan harness configuration without leaking credentials", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("PATCHPILOT_PROVIDER", "alan");
    vi.stubEnv("ALAN_API_KEY", "alan-secret-value");
    vi.stubEnv("ALAN_CONVERSATION_ID", "private-conversation-id");

    const response = await statusGet();
    const text = await response.text();
    const body = JSON.parse(text);

    expect(body.provider.kind).toBe("alan");
    expect(body.provider.mode).toBe("live");
    expect(body.provider.license).toBe("MIT");
    expect(body.alan.harnessEndpoint).toBe("https://api.tryalan.ai/public/harness/v1");
    expect(text).not.toContain("alan-secret-value");
    expect(text).not.toContain("private-conversation-id");
  });

  it("reports a live provider without leaking the key", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-placeholder");
    const response = await statusGet();
    const text = await response.text();
    const body = JSON.parse(text);

    expect(body.provider.mode).toBe("live");
    expect(body.provider.model).toBe("qwen/qwen3-coder");
    expect(body.provider.license).toBe("Apache-2.0");
    expect(body.provider.licenseVerified).toBe(true);
    expect(text).not.toContain("test-openrouter-placeholder");
  });
});

describe("MCP route", () => {
  it("serves initialize over POST", async () => {
    const response = await mcpPost(
      request("/api/mcp", {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).result.serverInfo.name).toBe("patchpilot");
  });

  it("returns a JSON-RPC parse error for malformed JSON", async () => {
    const response = await mcpPost(request("/api/mcp", "{"));
    expect(response.status).toBe(200);
    expect((await response.json()).error.code).toBe(-32700);
  });

  it("enforces bearer auth when a token is configured", async () => {
    vi.stubEnv("PATCHPILOT_MCP_TOKEN", "mcp-secret");
    const payload = { jsonrpc: "2.0", id: 1, method: "ping" };

    const denied = await mcpPost(request("/api/mcp", payload));
    expect(denied.status).toBe(401);

    const allowed = await mcpPost(
      request("/api/mcp", payload, { authorization: "Bearer mcp-secret" }),
    );
    expect(allowed.status).toBe(200);
  });

  it("rejects GET", async () => {
    const response = await mcpGet();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});