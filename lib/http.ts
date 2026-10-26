import { ProviderError } from "./errors";

export interface FetchJsonResult<T> {
  status: number;
  headers: Headers;
  body: T;
}

/**
 * Fetch with a hard timeout. Provider response bodies are never logged: they
 * can echo prompts or submitted source.
 */
export async function postJson<T>(
  url: string,
  init: { headers: Record<string, string>; body: unknown; timeoutMs: number },
): Promise<FetchJsonResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...init.headers,
      },
      body: JSON.stringify(init.body),
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await response.text();
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError(
          "PROVIDER_AUTH",
          502,
          "The model provider rejected the API credentials. Check the server environment variables.",
          false,
          response.status,
        );
      }
      if (response.status === 429) {
        throw new ProviderError(
          "PROVIDER_RATE_LIMIT",
          429,
          "The model provider rate-limited this request. Wait a moment and try again.",
          true,
          response.status,
        );
      }
      if (response.status === 402) {
        throw new ProviderError(
          "PROVIDER_AUTH",
          502,
          "The model provider reports insufficient credits.",
          false,
          response.status,
        );
      }
      throw new ProviderError(
        "PROVIDER_UNAVAILABLE",
        502,
        `The model provider returned HTTP ${response.status}.`,
        response.status >= 500,
        response.status,
      );
    }

    try {
      return { status: response.status, headers: response.headers, body: JSON.parse(text) as T };
    } catch {
      throw new ProviderError(
        "PROVIDER_UNAVAILABLE",
        502,
        "The model provider returned a response that was not JSON.",
        true,
      );
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ProviderError(
        "PROVIDER_TIMEOUT",
        504,
        "The model provider timed out. Try a smaller submission or retry.",
        true,
      );
    }
    throw new ProviderError(
      "PROVIDER_UNAVAILABLE",
      502,
      "Could not reach the model provider.",
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}