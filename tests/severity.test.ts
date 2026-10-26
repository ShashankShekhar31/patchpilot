import { describe, expect, it } from "vitest";
import {
  SEVERITIES,
  countBySeverity,
  normalizeSeverity,
  sortBySeverity,
} from "@/lib/severity";

describe("severity handling", () => {
  it("normalizes synonyms and punctuation", () => {
    expect(normalizeSeverity("CRITICAL")).toBe("critical");
    expect(normalizeSeverity("moderate")).toBe("medium");
    expect(normalizeSeverity("Informational")).toBe("info");
    expect(normalizeSeverity("minor")).toBe("low");
    expect(normalizeSeverity("made-up")).toBe("medium");
    expect(normalizeSeverity(null)).toBe("medium");
  });

  it("counts every severity, including zeroes", () => {
    const counts = countBySeverity([
      { severity: "critical" as const },
      { severity: "critical" as const },
      { severity: "info" as const },
    ]);

    expect(counts).toEqual({
      critical: 2,
      high: 0,
      medium: 0,
      low: 0,
      info: 1,
    });
  });

  it("orders findings by severity without mutating the input", () => {
    const input = [
      { id: "a", severity: "info" as const },
      { id: "b", severity: "critical" as const },
      { id: "c", severity: "medium" as const },
    ];
    const sorted = sortBySeverity(input);

    expect(sorted.map((finding) => finding.id)).toEqual(["b", "c", "a"]);
    expect(input.map((finding) => finding.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps the canonical severity order", () => {
    expect(SEVERITIES).toEqual(["critical", "high", "medium", "low", "info"]);
  });
});