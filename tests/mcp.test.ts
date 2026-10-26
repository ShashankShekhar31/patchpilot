import { describe, expect, it } from "vitest";
import { handleMcp } from "@/lib/mcp/handler";
import { SAMPLE_DIFF } from "@/lib/samples";

interface ToolCallResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: {
    content?: { type: string; text: string }[];
    structuredContent?: {
      mode?: string;
      findings?: unknown[];
      provider?: { kind?: string };
    };
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

const demoEnv = { PATCHPILOT_PROVIDER: "demo" };

describe("MCP handler", () => {
  it("negotiates initialize and echoes a supported protocol version", async () => {
    const response = (await handleMcp(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26" },
      },
      { env: demoEnv },
    )) as ToolCallResponse;

    expect(response.result).toMatchObject({
      protocolVersion: "2025-03-26",
      serverInfo: { name: "patchpilot" },
    });
    expect(response.result).toMatchObject({ capabilities: { tools: {} } });
  });

  it("falls back to the latest supported protocol version", async () => {
    const response = (await handleMcp(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } },
      { env: demoEnv },
    )) as ToolCallResponse;
    expect(response.result).toMatchObject({ protocolVersion: "2025-06-18" });
  });

  it("lists the three read-only tools", async () => {
    const response = (await handleMcp(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { env: demoEnv },
    )) as unknown as {
      result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] };
    };

    expect(response.result.tools.map((tool) => tool.name)).toEqual([
      "review_diff",
      "generate_tests",
      "ask_review_question",
    ]);
    expect(response.result.tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true);
  });

  it("runs an evidence-checked review through tools/call", async () => {
    const response = (await handleMcp(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "review_diff", arguments: { code: SAMPLE_DIFF } },
      },
      { env: demoEnv },
    )) as ToolCallResponse;

    expect(response.result?.isError).toBeUndefined();
    expect(response.result?.structuredContent?.mode).toBe("sample");
    expect(response.result?.structuredContent?.provider?.kind).toBe("demo");
    expect(response.result?.structuredContent?.findings).toHaveLength(8);
    expect(response.result?.content?.[0].text).toContain("SQL injection in the coupon lookup");
    expect(response.result?.content?.[0].text).toContain("Evidence verified: yes");
  });

  it("returns an isError tool result for invalid arguments", async () => {
    const response = (await handleMcp(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "review_diff", arguments: { code: "short" } },
      },
      { env: demoEnv },
    )) as ToolCallResponse;

    expect(response.result?.isError).toBe(true);
    expect(response.result?.content?.[0].text).toMatch(/Invalid arguments/);
  });

  it("supports ask and tests tools", async () => {
    const ask = (await handleMcp(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "ask_review_question",
          arguments: { code: SAMPLE_DIFF, question: "What should I fix first?" },
        },
      },
      { env: demoEnv },
    )) as ToolCallResponse;
    expect(ask.result?.content?.[0].text).toMatch(/Sample mode/);

    const tests = (await handleMcp(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "generate_tests", arguments: { code: SAMPLE_DIFF } },
      },
      { env: demoEnv },
    )) as ToolCallResponse;
    expect(tests.result?.content?.[0].text).toContain("20% coupon");
  });

  it("rejects unknown tools and methods using JSON-RPC errors", async () => {
    const unknownTool = (await handleMcp(
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "delete_everything", arguments: {} },
      },
      { env: demoEnv },
    )) as ToolCallResponse;
    expect(unknownTool.error?.code).toBe(-32602);

    const unknownMethod = (await handleMcp(
      { jsonrpc: "2.0", id: 8, method: "resources/list" },
      { env: demoEnv },
    )) as ToolCallResponse;
    expect(unknownMethod.error?.code).toBe(-32601);
  });

  it("accepts notifications without a response and rejects batches", async () => {
    const notification = await handleMcp(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { env: demoEnv },
    );
    expect(notification).toBeNull();

    const batch = (await handleMcp([], { env: demoEnv })) as ToolCallResponse;
    expect(batch.error?.code).toBe(-32600);
  });

  it("rejects an invalid JSON-RPC envelope", async () => {
    const response = (await handleMcp({ method: "ping" }, { env: demoEnv })) as ToolCallResponse;
    expect(response.error?.code).toBe(-32600);
  });
});