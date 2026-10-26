import { describe, expect, it } from "vitest";
import { cleanEvidence, locateEvidence } from "@/lib/evidence";
import { SAMPLE_DIFF, SAMPLE_SOURCE } from "@/lib/samples";

describe("cleanEvidence", () => {
  it("strips markdown fences and diff markers", () => {
    const cleaned = cleanEvidence("```ts\n+const a = 1;\n+const b = 2;\n```");
    expect(cleaned).toBe("const a = 1;\nconst b = 2;");
  });

  it("does not strip a leading minus from real code when not every line has a marker", () => {
    const cleaned = cleanEvidence("-const a = 1;\nreturn a;");
    expect(cleaned).toContain("-const a = 1;");
  });
});

describe("locateEvidence", () => {
  it("computes new-file line numbers from the diff instead of trusting the model", () => {
    const location = locateEvidence(
      SAMPLE_DIFF,
      "  const cart = await db.query(\n    `SELECT * FROM carts WHERE id = '${cartId}'`\n  );",
      { filename: "src/checkout.ts" },
    );

    expect(location.verified).toBe(true);
    expect(location.file).toBe("src/checkout.ts");
    expect(location.lineStart).toBe(9);
    expect(location.lineEnd).toBe(11);
    expect(location.side).toBe("added");
  });

  it("locates a single line in a source submission", () => {
    const location = locateEvidence(SAMPLE_SOURCE, "  const offset = page * pageSize;", {
      filename: "src/orders.ts",
    });

    expect(location).toMatchObject({
      verified: true,
      file: "src/orders.ts",
      lineStart: 5,
      lineEnd: 5,
      side: "source",
    });
  });

  it("locates a partial line quote and returns the full line number", () => {
    const location = locateEvidence(
      SAMPLE_DIFF,
      "process.env.JWT_SECRET || DEV_SECRET",
      { filename: "src/checkout.ts" },
    );

    expect(location.verified).toBe(true);
    expect(location.lineStart).toBe(30);
  });

  it("rejects fabricated evidence", () => {
    const location = locateEvidence(SAMPLE_DIFF, "const definitelyNotInTheCode = true;");
    expect(location.verified).toBe(false);
    expect(location.lineStart).toBeNull();
    expect(location.note).toMatch(/not found/i);
  });

  it("rejects evidence that is too short to verify", () => {
    const location = locateEvidence(SAMPLE_DIFF, "db");
    expect(location.verified).toBe(false);
    expect(location.note).toMatch(/too short/i);
  });

  it("resolves context lines to their new-file position", () => {
    const diff = `--- a/src/x.ts
+++ b/src/x.ts
@@ -2,3 +2,3 @@
 const keep = 1;
-const old = 2;
+const changed = 2;
 export { keep, changed };
`;
    const location = locateEvidence(diff, "const keep = 1;", { filename: "src/x.ts" });
    expect(location.verified).toBe(true);
    expect(location.lineStart).toBe(2);
    expect(location.side).toBe("context");
  });

  it("flags evidence on a removed line", () => {
    const diff = `--- a/src/x.ts
+++ b/src/x.ts
@@ -1,1 +1,1 @@
-const secret = "old";
+const secret = "new";
`;
    const location = locateEvidence(diff, 'const secret = "old";', { filename: "src/x.ts" });
    expect(location.verified).toBe(true);
    expect(location.side).toBe("removed");
    expect(location.note).toMatch(/removed line/i);
  });
});