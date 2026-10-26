export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;

export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Informational",
};

const ALIASES: Record<string, Severity> = {
  critical: "critical",
  blocker: "critical",
  severe: "critical",
  high: "high",
  major: "high",
  medium: "medium",
  moderate: "medium",
  low: "low",
  minor: "low",
  info: "info",
  informational: "info",
  information: "info",
  note: "info",
  trivial: "info",
};

/** Accepts messy model output (case, punctuation, synonyms) and returns a known severity. */
export function normalizeSeverity(value: unknown): Severity {
  if (typeof value !== "string") return "medium";
  const key = value.trim().toLowerCase().replace(/[^a-z]/g, "");
  return ALIASES[key] ?? "medium";
}

export function countBySeverity<T extends { severity: Severity }>(
  findings: readonly T[],
): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

export function sortBySeverity<T extends { severity: Severity }>(findings: readonly T[]): T[] {
  return [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}