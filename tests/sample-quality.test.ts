import { describe, expect, it } from "vitest";
import { runReview } from "@/lib/ai/review-service";
import { SAMPLE_DIFF, SAMPLE_SOURCE } from "@/lib/samples";

const demoEnv = { PATCHPILOT_PROVIDER: "demo" };

function criticalOrWorse(findings: { severity: string }[]): number {
  return findings.filter((finding) => finding.severity === "critical" || finding.severity === "high")
    .length;
}

describe("sample-mode quality on the bundled demos", () => {
  it("reports the real checkout bugs with verified evidence and correct lines", async () => {
    const review = await runReview({ code: SAMPLE_DIFF, filename: "src/checkout.ts" }, { env: demoEnv });
    const titles = review.findings.map((finding) => finding.title);

    expect(titles).toContain("SQL injection in the coupon lookup");
    expect(titles).toContain("Discount treats a percentage as a fraction");
    expect(titles.some((title) => /JWT|secret/i.test(title))).toBe(true);

    for (const finding of review.findings) {
      expect(finding.evidenceVerified).toBe(true);
      expect(finding.file).toBe("src/checkout.ts");
      expect(finding.lineStart).toBeGreaterThan(0);
      expect(finding.lineEnd).toBeGreaterThanOrEqual(finding.lineStart ?? 0);
      expect(finding.fix.length).toBeGreaterThan(10);
    }

    const sql = review.findings.find((finding) => finding.title.includes("SQL injection"));
    expect(sql?.evidence).toContain("SELECT * FROM carts");
    expect(sql?.fix.toLowerCase()).toContain("parameter");
  });

  it("reports the order module bugs and avoids inventing files", async () => {
    const review = await runReview({ code: SAMPLE_SOURCE, filename: "src/orders.ts" }, { env: demoEnv });
    const titles = review.findings.map((finding) => finding.title);

    expect(titles.some((title) => /SQL injection/i.test(title))).toBe(true);
    expect(titles.some((title) => /offset|page/i.test(title))).toBe(true);
    expect(review.findings.every((finding) => finding.file === "src/orders.ts")).toBe(true);
  });

  it("does not report high-signal findings for trivial correct code", async () => {
    const code = `export function add(a: number, b: number): number {\n  return a + b;\n}\n`;
    const review = await runReview({ code, filename: "src/math.ts" }, { env: demoEnv });

    expect(criticalOrWorse(review.findings)).toBe(0);
    expect(review.findings.every((finding) => finding.severity !== "medium")).toBe(true);
  });

  it("does not flag a JSON.parse already guarded by try/catch", async () => {
    const code = `export function parse(raw: string) {
  try {
    const value = JSON.parse(raw);
    return value;
  } catch {
    return null;
  }
}`;
    const review = await runReview({ code, filename: "src/parse.ts" }, { env: demoEnv });
    expect(review.findings.some((finding) => /JSON\.parse/i.test(finding.title))).toBe(false);
  });

  it("still flags an unguarded JSON.parse", async () => {
    const code = `export function parse(raw: string) {
  const value = JSON.parse(raw);
  return value;
}`;
    const review = await runReview({ code, filename: "src/parse.ts" }, { env: demoEnv });
    expect(review.findings.some((finding) => /JSON\.parse/i.test(finding.title))).toBe(true);
  });

  it("does not flag null-or-undefined checks as loose equality", async () => {
    const code = `export function present(value?: string) {
  return value == null ? "missing" : value;
}`;
    const review = await runReview({ code, filename: "src/value.ts" }, { env: demoEnv });
    expect(review.findings.some((finding) => /Loose equality/i.test(finding.title))).toBe(false);
  });

  it("does not flag parameterized SQL as injection", async () => {
    const code = `export async function findUser(db: any, id: string) {
  return db.query("SELECT * FROM users WHERE id = $1", [id]);
}`;
    const review = await runReview({ code, filename: "src/users.ts" }, { env: demoEnv });
    expect(review.findings.some((finding) => /SQL injection/i.test(finding.title))).toBe(false);
  });

  it("labels every sample review clearly and never claims live inference", async () => {
    const review = await runReview({ code: SAMPLE_DIFF }, { env: demoEnv });
    expect(review.mode).toBe("sample");
    expect(review.provider.kind).toBe("demo");
    expect(review.provider.licenseVerified).toBe(false);
    expect(review.warnings.join(" ")).toMatch(/sample mode|deterministic/i);
    expect(review.limitations.join(" ")).toMatch(/not a live model|deterministic|sample mode/i);
  });
});