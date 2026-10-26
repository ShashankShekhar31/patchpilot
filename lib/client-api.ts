export class ApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(message: string, options: { code?: string; retryable?: boolean; status?: number } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = options.code ?? "NETWORK";
    this.retryable = options.retryable ?? true;
    this.status = options.status ?? 0;
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; retryable?: boolean };
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  // Slightly above the server-side whole-request deadline (45s) so the server
  // returns its own structured timeout error first.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000);

  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const errorBody = (payload ?? {}) as ErrorBody;
      throw new ApiError(
        errorBody.error?.message || `Request failed with HTTP ${response.status}.`,
        {
          code: errorBody.error?.code,
          retryable: errorBody.error?.retryable ?? response.status >= 500,
          status: response.status,
        },
      );
    }

    if (payload === null) {
      throw new ApiError("The server returned an empty response.", { retryable: true });
    }

    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(
        "The request exceeded the 50s client budget, so PatchPilot stopped waiting. Any previous review is unchanged. Retry or submit a smaller diff.",
        { code: "CLIENT_TIMEOUT", retryable: true },
      );
    }
    throw new ApiError("Could not reach PatchPilot. Check your connection and retry.", {
      code: "NETWORK",
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
}