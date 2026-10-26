import { describe, expect, it } from "vitest";
import { AppError, toPublicError } from "@/lib/errors";

describe("public error mapping", () => {
  it("marks truncation as a recoverable 502", () => {
    const mapped = toPublicError(
      new AppError(502, "MODEL_OUTPUT_TRUNCATED", "No partial review was used.", {
        retryable: true,
      }),
    );

    expect(mapped.status).toBe(502);
    expect(mapped.body.error).toEqual({
      code: "MODEL_OUTPUT_TRUNCATED",
      message: "No partial review was used.",
      retryable: true,
    });
  });

  it("does not expose internal error details", () => {
    const mapped = toPublicError(new Error("sk-or-v1-secret leaked"));
    expect(mapped.status).toBe(500);
    expect(mapped.body.error.message).not.toContain("sk-or-v1-secret");
    expect(mapped.body.error.code).toBe("INTERNAL");
  });
});