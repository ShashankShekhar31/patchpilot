import { getPublicStatus } from "@/lib/ai/config";
import { jsonResponse } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return jsonResponse(getPublicStatus());
}