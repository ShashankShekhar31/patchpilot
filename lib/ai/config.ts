import type { ProviderPublic } from "./schema";

export const DEFAULT_OPENROUTER_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_OPENROUTER_MODEL = "qwen/qwen3-coder";
export const DEFAULT_ALAN_URL = "https://api.tryalan.ai/public/harness/v1";
export const DEFAULT_ALAN_MODEL = "deepseek/deepseek-v4.1-flash";
export const DEFAULT_MAX_INPUT_CHARS = 60_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 2_400;
export const DEFAULT_TIMEOUT_MS = 35_000;
export const DEFAULT_DEADLINE_MS = 45_000;
export const DEFAULT_MAX_PROMPT_CHARS = 24_000;

export interface ModelCard {
  name: string;
  license: string;
  licenseVerified: boolean;
  licenseUrl: string | null;
  sourceUrl: string | null;
}

/**
 * Only models whose license was checked at its primary source belong here.
 * Anything else is reported as unverified rather than labelled open source.
 */
export const MODEL_REGISTRY: Record<string, ModelCard> = {
  // Verified against the model card at Hugging Face on 2026-10-26. The Alan
  // harness serves a "fast" variant of this MIT-licensed open-weight model.
  "deepseek/deepseek-v4.1-flash": {
    name: "DeepSeek V4.1 Flash",
    license: "MIT",
    licenseVerified: true,
    licenseUrl: "https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash",
    sourceUrl: "https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash",
  },
  "qwen/qwen3-coder": {
    name: "Qwen3-Coder 480B A35B Instruct",
    license: "Apache-2.0",
    licenseVerified: true,
    licenseUrl: "https://huggingface.co/Qwen/Qwen3-Coder-480B-A35B-Instruct",
    sourceUrl: "https://huggingface.co/Qwen/Qwen3-Coder-480B-A35B-Instruct",
  },
  "openai/gpt-oss-120b": {
    name: "gpt-oss-120b",
    license: "Apache-2.0",
    licenseVerified: true,
    licenseUrl: "https://huggingface.co/openai/gpt-oss-120b",
    sourceUrl: "https://huggingface.co/openai/gpt-oss-120b",
  },
};

export type ProviderKind = "alan" | "openrouter" | "openai-compatible" | "demo";

export type CredentialSource =
  | "ALAN_API_KEY"
  | "ALAN_CODE_API_KEY"
  | "OPENROUTER_API_KEY"
  | "LLM_API_KEY"
  | "none";

export interface ProviderConfig {
  kind: ProviderKind;
  label: string;
  model: string;
  baseUrl: string;
  apiKey: string | null;
  /** Hard timeout for one upstream HTTP attempt. */
  timeoutMs: number;
  /** Hard budget for the whole request, including retries and repair. */
  deadlineMs: number;
  maxInputChars: number;
  maxOutputTokens: number;
  /** Cap on submission characters embedded in a single prompt. */
  maxPromptChars: number;
  jsonMode: boolean;
  reason: string | null;
  card: ModelCard | null;
  credentialSource: CredentialSource;
  alanConversationId: string | null;
}

type Env = Record<string, string | undefined>;

function envInt(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

function safeCard(model: string, env: Env): ModelCard | null {
  if (MODEL_REGISTRY[model]) return MODEL_REGISTRY[model];
  if (env.LLM_LICENSE) {
    return {
      name: env.LLM_NAME?.trim() || model,
      license: env.LLM_LICENSE.trim(),
      licenseVerified: false,
      licenseUrl: env.LLM_LICENSE_URL?.trim() || null,
      sourceUrl: null,
    };
  }
  return null;
}

export function resolveProviderConfig(env: Env = process.env): ProviderConfig {
  const timeoutMs = envInt(env, "PATCHPILOT_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 8_000, 60_000);
  const deadlineMs = envInt(env, "PATCHPILOT_DEADLINE_MS", DEFAULT_DEADLINE_MS, 10_000, 58_000);
  const maxPromptChars = envInt(
    env,
    "PATCHPILOT_MAX_PROMPT_CHARS",
    DEFAULT_MAX_PROMPT_CHARS,
    4_000,
    60_000,
  );
  const maxInputChars = envInt(
    env,
    "PATCHPILOT_MAX_INPUT_CHARS",
    DEFAULT_MAX_INPUT_CHARS,
    1_000,
    120_000,
  );
  const maxOutputTokens = envInt(
    env,
    "PATCHPILOT_MAX_OUTPUT_TOKENS",
    DEFAULT_MAX_OUTPUT_TOKENS,
    256,
    8_000,
  );

  const requested = (env.PATCHPILOT_PROVIDER || "").trim().toLowerCase();
  const openrouterKey = env.OPENROUTER_API_KEY?.trim() || null;
  const llmBaseUrl = env.LLM_BASE_URL?.trim() || null;
  const llmModel = env.LLM_MODEL?.trim() || null;

  const alanKey = env.ALAN_API_KEY?.trim() || null;
  const alanSessionKey = env.ALAN_CODE_API_KEY?.trim() || null;
  const alanModel = env.ALAN_MODEL?.trim() || DEFAULT_ALAN_MODEL;
  const alanBaseUrl = (env.ALAN_BASE_URL?.trim() || DEFAULT_ALAN_URL).replace(/\/+$/, "");
  const alanConversationId =
    env.ALAN_CONVERSATION_ID?.trim() || env.ALAN_CODE_CONVERSATION_ID?.trim() || null;

  const base = {
    // A per-attempt timeout can never exceed the whole-request deadline.
    timeoutMs: Math.min(timeoutMs, Math.max(8_000, deadlineMs - 5_000)),
    deadlineMs,
    maxInputChars,
    maxOutputTokens,
    maxPromptChars,
    reason: null as string | null,
  };

  const demo = (reason: string | null): ProviderConfig => ({
    ...base,
    kind: "demo",
    label: "Sample mode",
    model: "deterministic-rules",
    baseUrl: "",
    apiKey: null,
    jsonMode: false,
    reason,
    card: null,
    credentialSource: "none",
    alanConversationId: null,
  });

  const alanConfig = (
    key: string,
    source: "ALAN_API_KEY" | "ALAN_CODE_API_KEY",
    reason: string | null = null,
  ): ProviderConfig => ({
    ...base,
    kind: "alan",
    label: "Alan harness",
    model: alanModel,
    baseUrl: alanBaseUrl,
    apiKey: key,
    jsonMode: true,
    reason,
    card: safeCard(alanModel, env),
    credentialSource: source,
    alanConversationId,
  });

  const openrouterConfig = (): ProviderConfig => {
    const model = env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
    return {
      ...base,
      kind: "openrouter",
      label: "OpenRouter",
      model,
      baseUrl: DEFAULT_OPENROUTER_URL,
      apiKey: openrouterKey,
      jsonMode: true,
      card: safeCard(model, env),
      credentialSource: "OPENROUTER_API_KEY",
      alanConversationId: null,
    };
  };

  const compatibleConfig = (): ProviderConfig => {
    const key = env.LLM_API_KEY?.trim() || null;
    return {
      ...base,
      kind: "openai-compatible",
      label: env.LLM_LABEL?.trim() || "OpenAI-compatible endpoint",
      model: llmModel as string,
      baseUrl: (llmBaseUrl as string).replace(/\/+$/, ""),
      apiKey: key,
      jsonMode: env.LLM_JSON_MODE !== "off",
      card: safeCard(llmModel as string, env),
      credentialSource: key ? "LLM_API_KEY" : "none",
      alanConversationId: null,
    };
  };

  if (requested && !["alan", "openrouter", "openai-compatible", "demo"].includes(requested)) {
    return demo(`Unknown PATCHPILOT_PROVIDER value "${requested}".`);
  }

  if (requested === "demo") {
    return demo("PATCHPILOT_PROVIDER=demo.");
  }

  if (requested === "alan") {
    if (alanKey) return alanConfig(alanKey, "ALAN_API_KEY");
    if (alanSessionKey) {
      return alanConfig(
        alanSessionKey,
        "ALAN_CODE_API_KEY",
        "Using the local Alan Code session credential; it can expire.",
      );
    }
    return demo(
      "PATCHPILOT_PROVIDER=alan but ALAN_API_KEY (or a local ALAN_CODE_API_KEY) is missing.",
    );
  }

  if (requested === "openrouter") {
    if (!openrouterKey) {
      return demo("OPENROUTER_API_KEY is missing, so PatchPilot fell back to sample mode.");
    }
    return openrouterConfig();
  }

  if (requested === "openai-compatible") {
    if (!llmBaseUrl) {
      return demo("LLM_BASE_URL is missing, so PatchPilot fell back to sample mode.");
    }
    if (!llmModel) {
      return demo("LLM_BASE_URL is set but LLM_MODEL is missing, so sample mode is active.");
    }
    return compatibleConfig();
  }

  // No explicit provider. Use durable credentials only; never silently opt into
  // the session-scoped Alan Code credential.
  if (alanKey) return alanConfig(alanKey, "ALAN_API_KEY");
  if (openrouterKey) return openrouterConfig();
  if (llmBaseUrl && llmModel) return compatibleConfig();
  if (llmBaseUrl && !llmModel) {
    return demo("LLM_BASE_URL is set but LLM_MODEL is missing, so sample mode is active.");
  }

  return demo(
    "No live provider is configured. Set PATCHPILOT_PROVIDER=alan with ALAN_API_KEY, or configure OPENROUTER_API_KEY.",
  );
}

export function toPublicProvider(config: ProviderConfig): ProviderPublic {
  return {
    kind: config.kind,
    label: config.label,
    model: config.model,
    modelName: config.card?.name ?? (config.kind === "demo" ? "Deterministic sample rules" : config.model),
    license: config.card?.license ?? (config.kind === "demo" ? "Not applicable" : "Not verified"),
    licenseVerified: config.card?.licenseVerified ?? false,
    licenseUrl: config.card?.licenseUrl ?? null,
    sourceUrl: config.card?.sourceUrl ?? null,
    mode: config.kind === "demo" ? "sample" : "live",
    baseUrlHost: config.baseUrl ? hostOf(config.baseUrl) : "none (local rules)",
    maxInputChars: config.maxInputChars,
    maxOutputTokens: config.maxOutputTokens,
    timeoutMs: config.timeoutMs,
    deadlineMs: config.deadlineMs,
    maxPromptChars: config.maxPromptChars,
    reason: config.reason,
    credentialSource: config.credentialSource,
  };
}

export interface PublicStatus {
  provider: ProviderPublic;
  alan: {
    builtWith: "Alan Code";
    buildModel: "DeepSeek V4.1 Flash";
    buildModelLicense: "MIT";
    buildModelLicenseVerified: boolean;
    buildModelLicenseUrl: string;
    runtimeProvider: "alan-harness" | "external" | "none";
    runtimeInferenceApi: false;
    harnessEndpoint: string | null;
    harnessDocumented: false;
    connectorPath: "/api/mcp";
    connectorEnabled: boolean;
    connectorTokenRequired: boolean;
    customWebhookStatus: "coming soon";
    docsUrl: string;
  };
  limits: {
    maxInputChars: number;
    maxOutputTokens: number;
    timeoutMs: number;
    deadlineMs: number;
    maxPromptChars: number;
  };
  version: string;
  checkedAt: string;
}

export function getPublicStatus(env: Env = process.env): PublicStatus {
  const config = resolveProviderConfig(env);
  const token = env.PATCHPILOT_MCP_TOKEN?.trim();
  const connectorEnabled = Boolean(token) || env.NODE_ENV !== "production";

  return {
    provider: toPublicProvider(config),
    alan: {
      builtWith: "Alan Code",
      buildModel: "DeepSeek V4.1 Flash",
      buildModelLicense: "MIT",
      buildModelLicenseVerified: true,
      buildModelLicenseUrl: "https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash",
      runtimeProvider:
        config.kind === "alan" ? "alan-harness" : config.kind === "demo" ? "none" : "external",
      runtimeInferenceApi: false,
      harnessEndpoint: config.kind === "alan" ? config.baseUrl : null,
      harnessDocumented: false,
      connectorPath: "/api/mcp",
      connectorEnabled,
      connectorTokenRequired: Boolean(token) || env.NODE_ENV === "production",
      customWebhookStatus: "coming soon",
      docsUrl: "https://docs.tryalan.ai/docs/skills/plugins-and-mcp",
    },
    limits: {
      maxInputChars: config.maxInputChars,
      maxOutputTokens: config.maxOutputTokens,
      timeoutMs: config.timeoutMs,
      deadlineMs: config.deadlineMs,
      maxPromptChars: config.maxPromptChars,
    },
    version: "0.1.0",
    checkedAt: new Date().toISOString(),
  };
}