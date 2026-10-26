#!/usr/bin/env node
/**
 * Detect whether a deployed PatchPilot build includes a specific code change.
 *
 * Uses a behavioural probe rather than a build id: a `JSON.parse` call that is
 * already wrapped in try/catch. The hardened sample-mode heuristic must NOT
 * report it, while older builds DO. That makes the probe a reliable signal for
 * "is the latest commit deployed".
 *
 *   node scripts/check-deploy-freshness.mjs
 *   BASE_URL=https://example.vercel.app node scripts/check-deploy-freshness.mjs
 */
const base = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

const GUARDED_PARSE = `export function parse(raw: string) {
  try {
    const value = JSON.parse(raw);
    return value;
  } catch {
    return null;
  }
}`;

const response = await fetch(`${base}/api/review`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ code: GUARDED_PARSE, filename: "src/parse.ts" }),
});

const body = await response.json();
const findings = body?.findings ?? [];
const falsePositive = findings.some((finding) => /JSON\.parse/i.test(finding.title));

console.log(`status              ${response.status}`);
console.log(`provider.mode       ${body?.mode}`);
console.log(`findings            ${findings.length}`);
console.log(`titles              ${findings.map((f) => f.title).join(" | ") || "(none)"}`);
console.log("");
if (falsePositive) {
  console.log("BUILD: OLD - the unguarded-JSON.parse false positive is still present.");
  process.exit(2);
}
console.log("BUILD: CURRENT - the hardened heuristic is active (no JSON.parse false positive).");
