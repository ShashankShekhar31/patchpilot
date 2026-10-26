import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveProviderConfig } from "@/lib/ai/config";
import { createProvider } from "@/lib/ai/provider";
import { ProviderError } from "@/lib/errors";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function completion(text: string, finishReason = "stop") {
  return {
    choices: [{ message: { content: text }, finish_reason: finishReason }],
    usage: { prompt_tokens: 12, completion_tokens: 34 },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Alan harness provider", () => {
  it("calls the verified Alan endpoint with server-side auth and conversation header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(completion("alan-ok")));
    vi.stubGlobal("fetch", fetchMock);

    const config = resolveProviderConfig({
      PATCHPILOT_PROVIDER: "alan",
      ALAN_API_KEY: "alan-test-key",
      ALAN_CONVERSATION_ID: "conv-1",
      ALAN_MODEL: "deepseek/deepseek-v4.1-flash",
    });
    const provider = createProvider(config);
    const result = await provider.complete({ system: "s", user: "u", json: true });

    expect(result.text).toBe("alan-ok");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.tryalan.ai/public/harness/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer alan-test-key");
    expect(init.headers["x-alan-conversation-id"]).toBe("conv-1");
    expect(init.headers["x-title"]).toBeUndefined();

    const body = JSON.parse(init.body);
    expect(body.model).toBe("deepseek/deepseek-v4.1-flash");
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("falls back to a non-JSON retry when the harness rejects response_format", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "unsupported" }, 400))
      .mockResolvedValueOnce(jsonResponse(completion('{"summary":"ok","findings":[]}')));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createProvider(
      resolveProviderConfig({
        PATCHPILOT_PROVIDER: "alan",
        ALAN_API_KEY: "alan-test-key",
      }),
    );
    const result = await provider.complete({ system: "s", user: "u", json: true });

    expect(result.text).toContain("summary");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).response_format).toBeUndefined();
  });
});

describe("OpenRouter provider", () => {
  it("sends a server-side bearer token and requests JSON mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(completion("hello")));
    vi.stubGlobal("fetch", fetchMock);

    const config = resolveProviderConfig({ OPENROUTER_API_KEY: "test-key" });
    const provider = createProvider(config);
    const result = await provider.complete({ system: "s", user: "u", json: true });

    expect(result.text).toBe("hello");
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 34 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer test-key");
    expect(init.headers["x-title"]).toBe("PatchPilot");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("qwen/qwen3-coder");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBe(config.maxOutputTokens);
  });

  it("retries once without response_format when the server rejects it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "unsupported response_format" }, 400))
      .mockResolvedValueOnce(jsonResponse(completion('{"summary":"ok","findings":[]}')));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createProvider(resolveProviderConfig({ OPENROUTER_API_KEY: "test-key" }));
    const result = await provider.complete({ system: "s", user: "u", json: true });

    expect(result.text).toContain('"summary"');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondBody.response_format).toBeUndefined();
  });

  it("maps 401 to a safe provider auth error without echoing the key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "bad key test-key" }, 401)),
    );
    const provider = createProvider(
      resolveProviderConfig({ OPENROUTER_API_KEY: "test-key" }),
    );

    try {
      await provider.complete({ system: "s", user: "u" });
      throw new Error("expected a provider error");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).code).toBe("PROVIDER_AUTH");
      expect((error as ProviderError).message).not.toContain("test-key");
    }
  });

  it("retries a 429 once and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "slow down" }, 429))
      .mockResolvedValueOnce(jsonResponse(completion("after-retry")));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createProvider(
      resolveProviderConfig({ OPENROUTER_API_KEY: "test-key" }),
    );

    const result = await provider.complete({ system: "s", user: "u" });
    expect(result.text).toBe("after-retry");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces a second 429 instead of retrying forever", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => jsonResponse({ error: "slow down" }, 429));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createProvider(
      resolveProviderConfig({ OPENROUTER_API_KEY: "test-key" }),
    );

    await expect(provider.complete({ system: "s", user: "u" })).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMIT",
      status: 429,
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry an authentication failure", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ error: "bad" }, 401));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createProvider(
      resolveProviderConfig({ OPENROUTER_API_KEY: "test-key" }),
    );

    await expect(provider.complete({ system: "s", user: "u" })).rejects.toMatchObject({
      code: "PROVIDER_AUTH",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not start a second attempt when the deadline is nearly exhausted", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ error: "boom" }, 503));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createProvider(
      resolveProviderConfig({ OPENROUTER_API_KEY: "test-key" }),
    );

    await expect(
      provider.complete({
        system: "s",
        user: "u",
        deadlineAt: Date.now() + 3_000,
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps an aborted request to a timeout error", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    const provider = createProvider(
      resolveProviderConfig({ OPENROUTER_API_KEY: "test-key" }),
    );

    await expect(provider.complete({ system: "s", user: "u" })).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
      status: 504,
      retryable: true,
    });
  });

  it("rejects a truncated response instead of parsing broken JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(completion('{"summary":"cut off', "length"))),
    );
    const provider = createProvider(
      resolveProviderConfig({ OPENROUTER_API_KEY: "test-key" }),
    );

    await expect(provider.complete({ system: "s", user: "u", json: true })).rejects.toMatchObject({
      code: "MODEL_OUTPUT_TRUNCATED",
      retryable: true,
    });
  });

  it("does not retry a truncated response", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => jsonResponse(completion('{"summary":"cut off', "length")));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createProvider(
      resolveProviderConfig({ OPENROUTER_API_KEY: "test-key" }),
    );

    await expect(provider.complete({ system: "s", user: "u", json: true })).rejects.toMatchObject({
      code: "MODEL_OUTPUT_TRUNCATED",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty completion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: "" } }] })),
    );
    const provider = createProvider(
      resolveProviderConfig({ OPENROUTER_API_KEY: "test-key" }),
    );

    await expect(provider.complete({ system: "s", user: "u" })).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });
});

describe("OpenAI-compatible provider", () => {
  it("uses a custom endpoint without an Authorization header when no key is set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(completion("local")));
    vi.stubGlobal("fetch", fetchMock);

    const config = resolveProviderConfig({
      LLM_BASE_URL: "http://127.0.0.1:11434/v1/",
      LLM_MODEL: "qwen2.5-coder:7b",
      LLM_LICENSE: "Apache-2.0",
    });
    const provider = createProvider(config);
    await provider.complete({ system: "s", user: "u" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(init.headers.authorization).toBeUndefined();
    expect(JSON.parse(init.body).model).toBe("qwen2.5-coder:7b");
    expect(config.card?.licenseVerified).toBe(false);
  });

  it("honours LLM_JSON_MODE=off", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(completion("plain")));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createProvider(
      resolveProviderConfig({
        LLM_BASE_URL: "http://localhost:8000/v1",
        LLM_MODEL: "custom",
        LLM_JSON_MODE: "off",
      }),
    );
    await provider.complete({ system: "s", user: "u", json: true });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).response_format).toBeUndefined();
  });
});