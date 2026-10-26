import type { ReviewResult } from "./ai/schema";

function fence(value: string, language = "text"): string {
  let marker = "```";
  while (value.includes(marker)) marker += "`";
  return `${marker}${language}\n${value}\n${marker}`;
}

/**
 * Build a portable Markdown review. This is a deterministic render of the
 * verified result, not another model call.
 */
export function buildMarkdownReport(result: ReviewResult, generatedAt = new Date()): string {
  const lines: string[] = [];

  lines.push(`# PatchPilot review ${result.id}`);
  lines.push("");
  lines.push(`Generated: ${generatedAt.toISOString()}`);
  lines.push(
    `Mode: ${result.mode === "live" ? "live model" : "sample data (no model call)"}  `,
  );
  lines.push(`Provider: ${result.provider.label}  `);
  lines.push(`Model: ${result.provider.modelName} (${result.provider.model})  `);
  lines.push(
    `License: ${result.provider.license}${result.provider.licenseVerified ? "" : " (not verified)"}  `,
  );
  lines.push(
    `Input: ${result.input.kind === "diff" ? "unified diff" : "source"}, ${result.input.chars.toLocaleString()} chars, ${result.input.addedLines} added lines, ${result.input.files.length} file(s)  `,
  );
  lines.push(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
  if (result.usage) {
    lines.push(
      `Tokens: ${result.usage.promptTokens ?? "?"} in / ${result.usage.completionTokens ?? "?"} out`,
    );
  }
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(result.summary);
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  lines.push(
    `| Severity | Count |\n| --- | --- |\n| Critical | ${result.counts.critical} |\n| High | ${result.counts.high} |\n| Medium | ${result.counts.medium} |\n| Low | ${result.counts.low} |\n| Informational | ${result.counts.info} |`,
  );

  if (result.findings.length === 0) {
    lines.push("");
    lines.push("No verified findings were produced.");
  }

  for (const finding of result.findings) {
    lines.push("");
    const location = finding.file
      ? `${finding.file}${finding.lineStart ? `:${finding.lineStart}${finding.lineEnd && finding.lineEnd !== finding.lineStart ? `-${finding.lineEnd}` : ""}` : ""}`
      : "Location not established";
    lines.push(`### ${finding.id} · ${finding.severity.toUpperCase()} · ${finding.title}`);
    lines.push("");
    lines.push(`- Category: ${finding.category}`);
    lines.push(`- Location: ${location}`);
    lines.push(`- Confidence: ${Math.round(finding.confidence * 100)}%`);
    lines.push(`- Evidence verified against submission: ${finding.evidenceVerified ? "yes" : "no"}`);
    if (finding.locationNote) lines.push(`- Location note: ${finding.locationNote}`);
    lines.push("");
    lines.push("**Evidence**");
    lines.push("");
    lines.push(fence(finding.evidence));
    lines.push("");
    lines.push("**Explanation**");
    lines.push("");
    lines.push(finding.explanation);
    lines.push("");
    lines.push("**Suggested fix**");
    lines.push("");
    lines.push(finding.fix);
  }

  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("## Warnings");
    lines.push("");
    for (const warning of result.warnings) lines.push(`- ${warning}`);
  }

  lines.push("");
  lines.push("## Limitations");
  lines.push("");
  for (const limitation of result.limitations) lines.push(`- ${limitation}`);

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(
    "PatchPilot findings are AI suggestions, not verified vulnerabilities. Every excerpt was checked against the submitted input, but correctness and exploitability were not proven. Submitted code was not executed.",
  );
  lines.push("");

  return lines.join("\n");
}