#!/usr/bin/env node
/**
 * End-to-end smoke check against a running PatchPilot server.
 *
 *   node --experimental-strip-types scripts/smoke.mjs
 *   BASE_URL=http://127.0.0.1:3100 node --experimental-strip-types scripts/smoke.mjs
 *
 * It sends the bundled sample (public test data), checks the review/ask/tests
 * endpoints, and exercises the MCP connector. It prints counts only, never
 * credentials or response bodies that could contain secrets.
 */
import { SAMPLE_DIFF } from "../lib/samples.ts";

const base = (process.env.BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const token = process.env.PATCHPILOT_MCP_TOKEN || "";
let failed = false;

function check(condition, message) {
  if (condition) {
    console.log(`ok   ${message}`);
  } else {
    failed = true;
    console.error(`FAIL ${message}`);
  }
}

async function post(path, body, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { response, json, text };
}

console.log(`PatchPilot smoke test against ${base}\n`);

const statusResponse = await fetch(`${base}/api/status`);
const status = await statusResponse.json();
check(statusResponse.ok, "GET /api/status returns 200");
check(
  status.provider.mode === "live" || status.provider.mode === "sample",
  `provider mode is explicit: ${status.provider.mode}`,
);
check(status.alan.builtWith === "Alan Code", "Alan build provenance is present");
console.log(
  `     provider=${status.provider.label} model=${status.provider.model} license=${status.provider.license}\n`,
);

const review = await post("/api/review", { code: SAMPLE_DIFF, filename: "src/checkout.ts" });
check(review.response.ok, "POST /api/review returns 200");
check(Array.isArray(review.json?.findings) && review.json.findings.length > 0, "review returns findings");
check(
  review.json?.findings?.every((finding) => finding.evidenceVerified === true),
  "every returned finding has verified evidence",
);
check(
  review.json?.findings?.[0]?.file === "src/checkout.ts",
  "location resolved to src/checkout.ts",
);
console.log(
  `     mode=${review.json?.mode} counts=${JSON.stringify(review.json?.counts)} droppedWarnings=${review.json?.warnings?.length}\n`,
);

const findings = (review.json?.findings ?? []).slice(0, 3).map((finding) => ({
  title: finding.title,
  severity: finding.severity,
  category: finding.category,
  file: finding.file,
  lineStart: finding.lineStart,
  explanation: finding.explanation,
  fix: finding.fix,
}));

const ask = await post("/api/ask", {
  code: SAMPLE_DIFF,
  question: "What should I fix first?",
  findings,
  history: [],
});
check(ask.response.ok, "POST /api/ask returns 200");
check(typeof ask.json?.answer === "string" && ask.json.answer.length > 10, "follow-up has an answer");
console.log(`     mode=${ask.json?.mode} answerChars=${ask.json?.answer?.length}\n`);

const tests = await post("/api/tests", {
  code: SAMPLE_DIFF,
  language: "typescript",
  findings,
});
check(tests.response.ok, "POST /api/tests returns 200");
check(Array.isArray(tests.json?.cases) && tests.json.cases.length > 0, "test suggestions returned");
console.log(`     mode=${tests.json?.mode} cases=${tests.json?.cases?.length} framework=${tests.json?.framework}\n`);

const mcpHeaders = token ? { authorization: `Bearer ${token}` } : {};
const init = await post(
  "/api/mcp",
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
  mcpHeaders,
);
check(init.response.ok && init.json?.result?.serverInfo?.name === "patchpilot", "MCP initialize succeeds");

const mcpReview = await post(
  "/api/mcp",
  {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "review_diff", arguments: { code: SAMPLE_DIFF } },
  },
  mcpHeaders,
);
check(
  mcpReview.response.ok && Array.isArray(mcpReview.json?.result?.structuredContent?.findings),
  "MCP review_diff returns structured findings",
);
console.log(
  `     mcpFindings=${mcpReview.json?.result?.structuredContent?.findings?.length ?? 0} serverError=${mcpReview.json?.result?.isError ?? false}\n`,
);

if (failed) {
  console.error("Smoke test failed.");
  process.exit(1);
}
console.log("All smoke checks passed.");