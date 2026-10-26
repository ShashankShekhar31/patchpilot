import { jsonError, jsonResponse, parseJsonBody } from "@/lib/api";
import { ReviewRequestSchema } from "@/lib/ai/requests";
import { runReview } from "@/lib/ai/review-service";
import { AppError } from "@/lib/errors";
import { checkRateLimit, requestKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const limit = checkRateLimit(`review:${requestKey(request)}`, {
      limit: 12,
      windowMs: 60_000,
    });
    if (!limit.ok) {
      throw new AppError(
        429,
        "RATE_LIMITED",
        `Too many reviews. Try again in ${limit.retryAfterSeconds}s.`,
        { retryable: true },
      );
    }

    const body = await parseJsonBody(request, ReviewRequestSchema);
    const result = await runReview(body);
    return jsonResponse(result);
  } catch (error) {
    return jsonError(error);
  }
}