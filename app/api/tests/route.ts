import { jsonError, jsonResponse, parseJsonBody } from "@/lib/api";
import { TestsRequestSchema } from "@/lib/ai/requests";
import { runTests } from "@/lib/ai/review-service";
import { AppError } from "@/lib/errors";
import { checkRateLimit, requestKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const limit = checkRateLimit(`tests:${requestKey(request)}`, {
      limit: 10,
      windowMs: 60_000,
    });
    if (!limit.ok) {
      throw new AppError(
        429,
        "RATE_LIMITED",
        `Too many test generations. Try again in ${limit.retryAfterSeconds}s.`,
        { retryable: true },
      );
    }

    const body = await parseJsonBody(request, TestsRequestSchema);
    const result = await runTests(body);
    return jsonResponse(result);
  } catch (error) {
    return jsonError(error);
  }
}