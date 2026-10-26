#!/usr/bin/env node
/**
 * Exercise a running PatchPilot instance end to end and print a compact,
 * honest report of what each endpoint returned.
 *
 *   BASE_URL=https://patchpilot-gamma.vercel.app node scripts/e2e-check.mjs
 *   BASE_URL=http://127.0.0.1:3104 node scripts/e2e-check.mjs
 *
 * Only requests the public, documented endpoints and prints counts and modes.
 * It never prints API keys or submitted secrets.
 */
import { SAMPLE_DIFF, SAMPLE_SOURCE } from "../lib/samples.ts";

const base = (process.env.BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const token = process.env.PATCHPILOT_MCP_TOKEN || "";

async function call(path, body, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text, headers: response.headers };
}

function line(label, value) {
  console.log(`${label.padEnd(26)} ${value}`);
}

console.log(`PatchPilot e2e check -> ${base}\n`);

const status = await call("/api/status");
line("GET /api/status", status.status);
if (status.json) {
  line("provider.kind", status.json.provider?.kind);
  line("provider.mode", status.json.provider?.mode);
  line("provider.model", status.json.provider?.model);
  line("credentialSource", status.json.provider?.credentialSource);
  line("reason", status.json.provider?.reason ?? "n/a");
  line("mcp.connectorEnabled", status.json.alan?.connectorEnabled);
}
console.log("");

const review = await call("/api/review", { code: SAMPLE_DIFF, filename: "src/checkout.ts" });
line("POST /api/review", review.status);
if (review.json) {
  line("  mode", review.json.mode);
  line("  findings", review.json.findings?.length);
  line("  counts", JSON.stringify(review.json.counts));
  line("  allEvidenceVerified", review.json.findings?.every((f) => f.evidenceVerified));
  const first = review.json.findings?.[0];
  if (first) {
    line("  first finding", `${first.severity} | ${first.title}`);
    line("  first location", `${first.file}:${first.lineStart}-${first.lineEnd}`);
    line("  first evidence", JSON.stringify((first.evidence ?? "").slice(0, 70)));
  }
}
console.log("");

const findings = (review.json?.findings ?? []).slice(0, 3).map((f) => ({
  title: f.title,
  severity: f.severity,
  category: f.category,
  file: f.file,
  lineStart: f.lineStart,
  explanation: f.explanation,
  fix: f.fix,
  evidence: f.evidence,
}));

for (const question of [
  "What should I fix first?",
  "Which security issue is most serious?",
  "What tests would catch these bugs?",
]) {
  const ask = await call("/api/ask", {
    code: SAMPLE_DIFF,
    question,
    findings,
    history: [],
  });
  const answer = ask.json?.answer ?? "";
  line(`POST /api/ask`, `${ask.status} | ${ask.json?.mode}`);
  line("  question", question);
  line("  answer head", JSON.stringify(answer.slice(0, 90)));
  line("  labelled sample", /sample mode/i.test(answer));
  console.log("");
}

const tests = await call("/api/tests", {
  code: SAMPLE_DIFF,
  language: "typescript",
  findings,
});
line("POST /api/tests", tests.status);
if (tests.json) {
  line("  mode", tests.json.mode);
  line("  cases", tests.json.cases?.length);
  const c = tests.json.cases?.[0];
  if (c) line("  first case", `${c.testType} | ${c.title} | covers: ${c.finding}`);
}
console.log("");

const source = await call("/api/review", { code: SAMPLE_SOURCE, filename: "src/orders.ts" });
line("POST /api/review (source)", source.status);
line("  mode", source.json?.mode);
line("  findings", source.json?.findings?.length);
line("  counts", JSON.stringify(source.json?.counts));
console.log("");

const benign = `export function add(a: number, b: number): number {\n  return a + b;\n}\n`;
const benignReview = await call("/api/review", { code: benign, filename: "src/math.ts" });
line("POST /api/review (benign)", benignReview.status);
line("  findings", benignReview.json?.findings?.length);
if (benignReview.json?.findings?.length) {
  line("  titles", benignReview.json.findings.map((f) => f.title).join("; "));
}
console.log("");

if (token) {
  const mcp = await call(
    "/api/mcp",
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    { authorization: `Bearer ${token}` },
  );
  line("POST /api/mcp tools/list", `${mcp.status} | ${mcp.json?.result?.tools?.length ?? 0} tools`);
} else {
  line("POST /api/mcp", "skipped (no PATCHPILOT_MCP_TOKEN in env)");
}
