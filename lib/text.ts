/** Collapse all runs of whitespace to one space and trim. Used only for comparison. */
export function normalizeLine(line: string): string {
  return line.replace(/\r/g, "").replace(/\s+/g, " ").trim();
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

/** Remove Markdown fences the model may wrap around JSON or code evidence. */
export function stripCodeFences(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```$/);
  return match ? match[1].trim() : trimmed;
}

/**
 * Best-effort redaction for messages that may be shown in logs or errors.
 * Never log request bodies, prompts, or model output in the first place.
 */
export function redactSecrets(value: string): string {
  return value
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|sk-or-v1-[A-Za-z0-9_-]{8,})\b/g, "[redacted-key]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi, "$1[redacted]")
    .replace(/(?<=(?:api[_-]?key|token|secret|password)["'\s:=]{0,8})[A-Za-z0-9._~+/-]{16,}/gi, "[redacted]");
}

export function countLines(value: string): number {
  if (!value) return 0;
  return value.split(/\r?\n/).length;
}