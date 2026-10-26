import { describe, expect, it } from "vitest";
import {
  DEFAULT_ALAN_MODEL,
  DEFAULT_ALAN_URL,
  getPublicStatus,
  resolveProviderConfig,
  toPublicProvider,
} from "@/lib/ai/config";

describe("Alan provider configuration", () => {
  it("resolves the verified Alan harness with a durable app key", () => {
    const config = resolveProviderConfig({
      PATCHPILOT_PROVIDER: "alan",
      ALAN_API_KEY: "alan-app-key",
      ALAN_CONVERSATION_ID: "conv-123",
    });

    expect(config.kind).toBe("alan");
    expect(config.baseUrl).toBe(DEFAULT_ALAN_URL);
    expect(config.model).toBe(DEFAULT_ALAN_MODEL);
    expect(config.credentialSource).toBe("ALAN_API_KEY");
    expect(config.alanConversationId).toBe("conv-123");
    expect(config.card).toMatchObject({
      name: "DeepSeek V4.1 Flash",
      license: "MIT",
      licenseVerified: true,
    });
  });

  it("falls back to the local Alan Code session key only when alan is explicit", () => {
    const explicit = resolveProviderConfig({
      PATCHPILOT_PROVIDER: "alan",
      ALAN_CODE_API_KEY: "session-key",
      ALAN_CODE_CONVERSATION_ID: "session-conv",
    });
    expect(explicit.kind).toBe("alan");
    expect(explicit.credentialSource).toBe("ALAN_CODE_API_KEY");
    expect(explicit.alanConversationId).toBe("session-conv");
    expect(explicit.reason).toMatch(/session credential/i);

    const implicit = resolveProviderConfig({ ALAN_CODE_API_KEY: "session-key" });
    expect(implicit.kind).toBe("demo");
  });

  it("does not pretend to be live when the Alan key is missing", () => {
    const config = resolveProviderConfig({ PATCHPILOT_PROVIDER: "alan" });
    expect(config.kind).toBe("demo");
    expect(config.reason).toMatch(/ALAN_API_KEY/);
  });

  it("auto-selects Alan when a durable ALAN_API_KEY is present", () => {
    const config = resolveProviderConfig({
      ALAN_API_KEY: "alan-app-key",
      OPENROUTER_API_KEY: "openrouter-key",
    });
    expect(config.kind).toBe("alan");
    expect(config.credentialSource).toBe("ALAN_API_KEY");
  });

  it("keeps explicit OpenRouter selection ahead of Alan auto-selection", () => {
    const config = resolveProviderConfig({
      PATCHPILOT_PROVIDER: "openrouter",
      ALAN_API_KEY: "alan-app-key",
      OPENROUTER_API_KEY: "openrouter-key",
    });
    expect(config.kind).toBe("openrouter");
    expect(config.credentialSource).toBe("OPENROUTER_API_KEY");
    expect(config.card?.license).toBe("Apache-2.0");
  });

  it("honours explicit demo mode even when keys are present", () => {
    const config = resolveProviderConfig({
      PATCHPILOT_PROVIDER: "demo",
      ALAN_API_KEY: "alan-app-key",
      OPENROUTER_API_KEY: "openrouter-key",
    });
    expect(config.kind).toBe("demo");
    expect(config.credentialSource).toBe("none");
  });
});

describe("public provider status", () => {
  it("exposes the Alan endpoint and MIT license without exposing the key", () => {
    const env = {
      PATCHPILOT_PROVIDER: "alan",
      ALAN_API_KEY: "super-secret-alan-key",
      ALAN_CONVERSATION_ID: "conv-123",
    };
    const status = getPublicStatus(env);
    const serialized = JSON.stringify(status);

    expect(status.provider.kind).toBe("alan");
    expect(status.provider.mode).toBe("live");
    expect(status.provider.credentialSource).toBe("ALAN_API_KEY");
    expect(status.provider.license).toBe("MIT");
    expect(status.provider.licenseVerified).toBe(true);
    expect(status.alan.runtimeProvider).toBe("alan-harness");
    expect(status.alan.harnessEndpoint).toBe(DEFAULT_ALAN_URL);
    expect(status.alan.harnessDocumented).toBe(false);
    expect(status.alan.buildModelLicense).toBe("MIT");
    expect(status.alan.buildModelLicenseVerified).toBe(true);
    expect(serialized).not.toContain("super-secret-alan-key");
    expect(serialized).not.toContain("conv-123");
  });

  it("reports sample mode with no configured provider", () => {
    const status = getPublicStatus({});
    expect(status.provider.mode).toBe("sample");
    expect(status.provider.credentialSource).toBe("none");
    expect(status.alan.runtimeProvider).toBe("none");
    expect(status.alan.harnessEndpoint).toBeNull();
  });

  it("reports the model card only for verified registry entries", () => {
    const config = resolveProviderConfig({
      LLM_BASE_URL: "http://localhost:8000/v1",
      LLM_MODEL: "unknown-model",
      LLM_LICENSE: "Apache-2.0",
    });
    const provider = toPublicProvider(config);
    expect(provider.license).toBe("Apache-2.0");
    expect(provider.licenseVerified).toBe(false);
  });
});