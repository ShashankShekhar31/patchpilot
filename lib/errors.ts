export type ErrorCode =
  | "BAD_REQUEST"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "PROVIDER_AUTH"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_TIMEOUT"
  | "MODEL_OUTPUT_INVALID"
  | "MODEL_OUTPUT_TRUNCATED"
  | "MCP_DISABLED"
  | "UNAUTHORIZED"
  | "INTERNAL";

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details?: string;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    options: { retryable?: boolean; details?: string } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export class ProviderError extends AppError {
  readonly upstreamStatus?: number;

  constructor(
    code: ErrorCode,
    status: number,
    message: string,
    retryable = false,
    upstreamStatus?: number,
  ) {
    super(status, code, message, { retryable });
    this.name = "ProviderError";
    this.upstreamStatus = upstreamStatus;
  }
}

export function toPublicError(error: unknown): {
  status: number;
  body: { error: { code: ErrorCode; message: string; retryable: boolean; details?: string } };
} {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          ...(error.details ? { details: error.details } : {}),
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL",
        message: "Something went wrong while processing the review.",
        retryable: true,
      },
    },
  };
}