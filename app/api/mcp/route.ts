import { createHash, timingSafeEqual } from "node:crypto";
import { handleMcp } from "@/lib/mcp/handler";
import { checkRateLimit, requestKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 64_000;

function mcpError(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function isAuthorized(request: Request, expected: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const provided = createHash("sha256").update(match[1]).digest();
  const wanted = createHash("sha256").update(expected).digest();
  return timingSafeEqual(provided, wanted);
}

export async function POST(request: Request) {
  const token = process.env.PATCHPILOT_MCP_TOKEN?.trim();
  if (token) {
    if (!isAuthorized(request, token)) {
      return mcpError(401, "UNAUTHORIZED", "Missing or invalid MCP bearer token.");
    }
  } else if (process.env.NODE_ENV === "production") {
    return mcpError(
      503,
      "MCP_DISABLED",
      "The MCP connector is disabled in production until PATCHPILOT_MCP_TOKEN is configured.",
    );
  }

  const limit = checkRateLimit(`mcp:${requestKey(request)}`, {
    limit: 30,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return mcpError(429, "RATE_LIMITED", "Too many MCP requests. Retry shortly.");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return mcpError(415, "BAD_REQUEST", "MCP requests must use application/json.");
  }

  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > MAX_BODY_BYTES) {
    return mcpError(413, "PAYLOAD_TOO_LARGE", "MCP request body is too large.");
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return mcpError(413, "PAYLOAD_TOO_LARGE", "MCP request body is too large.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }

  const result = await handleMcp(payload);
  if (result === null) {
    return new Response(null, { status: 202, headers: { "cache-control": "no-store" } });
  }

  return Response.json(result, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "mcp-protocol-version": "2025-06-18",
    },
  });
}

export async function GET() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { allow: "POST", "cache-control": "no-store" },
  });
}

export async function DELETE() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { allow: "POST", "cache-control": "no-store" },
  });
}