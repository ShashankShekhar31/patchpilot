import { AppError, ProviderError } from "@/lib/errors";
import { postJson } from "@/lib/http";
import type { ProviderConfig } from "./config";

export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  /** Absolute epoch ms by which this completion must finish. */
  deadlineAt?: number;
}

export interface CompletionResult {
  text: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

export interface ChatProvider {
  readonly config: ProviderConfig;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

interface ChatCompletionResponse {
  choices?: {
    message?: { content?: string | { type?: string; text?: string }[] | null };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join("")
      .trim();
  }
  return "";
}

class OpenAiCompatibleProvider implements ChatProvider {
  readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;
    if (this.config.kind === "openrouter") headers["x-title"] = "PatchPilot";
    if (this.config.kind === "alan" && this.config.alanConversationId) {
      headers["x-alan-conversation-id"] = this.config.alanConversationId;
    }
    return headers;
  }

  private body(request: CompletionRequest, jsonMode: boolean): unknown {
    return {
      model: this.config.model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
      temperature: request.temperature ?? 0.1,
      max_tokens: Math.min(
        this.config.maxOutputTokens,
        Math.max(128, request.maxTokens ?? this.config.maxOutputTokens),
      ),
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    };
  }

  private remainingBudget(request: CompletionRequest): number {
    const deadlineAt = request.deadlineAt ?? Date.now() + this.config.deadlineMs;
    return deadlineAt - Date.now();
  }

  private attemptTimeout(request: CompletionRequest): number {
    const remaining = this.remainingBudget(request);
    return Math.max(1_000, Math.min(this.config.timeoutMs, remaining - 500));
  }

  private async send(
    request: CompletionRequest,
    jsonMode: boolean,
  ): Promise<ChatCompletionResponse> {
    const result = await postJson<ChatCompletionResponse>(
      `${this.config.baseUrl}/chat/completions`,
      {
        headers: this.headers(),
        body: this.body(request, jsonMode),
        timeoutMs: this.attemptTimeout(request),
      },
    );
    return result.body;
  }

  /** Only failures that may succeed on a second attempt are retried. */
  private isTransient(error: unknown): boolean {
    if (!(error instanceof ProviderError)) return false;
    if (error.code === "PROVIDER_TIMEOUT") return true;
    if (error.code === "PROVIDER_RATE_LIMIT") return true;
    return error.code === "PROVIDER_UNAVAILABLE" && error.retryable;
  }

  /**
   * One bounded retry. A completion makes at most two upstream calls: one
   * transient retry, or one response_format fallback, never both in a chain.
   */
  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const wantsJson = Boolean(request.json) && this.config.jsonMode;
    let response: ChatCompletionResponse | null = null;
    let lastError: unknown = null;
    let jsonFallbackUsed = false;
    let transientRetried = false;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      // Do not start a second attempt without enough budget to finish it.
      if (attempt > 0 && this.remainingBudget(request) < 4_000) break;

      try {
        response = await this.send(request, wantsJson && !jsonFallbackUsed);
        break;
      } catch (error) {
        lastError = error;

        const isFormatRejection =
          wantsJson &&
          !jsonFallbackUsed &&
          error instanceof ProviderError &&
          (error.upstreamStatus === 400 || error.upstreamStatus === 422);

        if (isFormatRejection) {
          jsonFallbackUsed = true;
          continue;
        }

        if (!transientRetried && this.isTransient(error)) {
          transientRetried = true;
          // Small bounded backoff, never more than a fraction of the budget.
          const backoff = Math.min(750, Math.max(0, this.remainingBudget(request) - 6_000));
          if (backoff > 0) {
            await new Promise((resolve) => setTimeout(resolve, Math.min(backoff, 750)));
          }
          continue;
        }

        throw error;
      }
    }

    if (!response) {
      throw lastError instanceof Error
        ? lastError
        : new ProviderError("PROVIDER_UNAVAILABLE", 502, "The model provider failed.", true);
    }

    const choice = response.choices?.[0];
    const text = contentToText(choice?.message?.content);
    if (!text) {
      throw new ProviderError(
        "PROVIDER_UNAVAILABLE",
        502,
        "The model returned an empty response.",
        true,
      );
    }

    if (choice?.finish_reason === "length") {
      // Truncation is not a formatting problem: a repair call cannot fix it,
      // so it is surfaced instead of retried.
      throw new AppError(
        502,
        "MODEL_OUTPUT_TRUNCATED",
        "The model stopped before finishing (output limit reached). No partial review was used. Retry, reduce the diff, or raise PATCHPILOT_MAX_OUTPUT_TOKENS above 2400.",
        { retryable: true },
      );
    }

    return {
      text,
      usage: {
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
      },
    };
  }
}

class DemoProvider implements ChatProvider {
  readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  async complete(): Promise<CompletionResult> {
    throw new AppError(
      500,
      "INTERNAL",
      "The sample provider is deterministic and does not make model calls.",
    );
  }
}

export function createProvider(config: ProviderConfig): ChatProvider {
  if (config.kind === "demo") return new DemoProvider(config);
  return new OpenAiCompatibleProvider(config);
}