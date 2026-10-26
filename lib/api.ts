import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { AppError, toPublicError } from "./errors";

const MAX_BODY_BYTES = 200_000;

export function jsonResponse(data: unknown, init: ResponseInit = {}): NextResponse {
  return NextResponse.json(data, {
    ...init,
    headers: {
      "cache-control": "no-store",
      ...(init.headers ?? {}),
    },
  });
}

export function jsonError(error: unknown): NextResponse {
  const { status, body } = toPublicError(error);
  return jsonResponse(body, { status });
}

export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AppError(415, "BAD_REQUEST", "Send the request as application/json.");
  }

  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > MAX_BODY_BYTES) {
    throw new AppError(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new AppError(400, "BAD_REQUEST", "Could not read the request body.");
  }

  if (text.length > MAX_BODY_BYTES) {
    throw new AppError(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new AppError(400, "BAD_REQUEST", "The request body is not valid JSON.");
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const details = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
      .join("; ");
    throw new AppError(400, "BAD_REQUEST", "The request did not pass validation.", {
      details,
    });
  }

  return parsed.data;
}