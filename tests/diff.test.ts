import { describe, expect, it } from "vitest";
import { analyzeInput, diffCodeLines, looksLikeDiff, parseDiff } from "@/lib/diff";
import { SAMPLE_DIFF, SAMPLE_SOURCE } from "@/lib/samples";

describe("parseDiff", () => {
  it("parses the bundled checkout diff and counts added lines", () => {
    const parsed = parseDiff(SAMPLE_DIFF);
    expect(parsed.isDiff).toBe(true);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].path).toBe("src/checkout.ts");
    expect(parsed.files[0].isNew).toBe(true);
    expect(parsed.addedLines).toBe(37);
    expect(parsed.removedLines).toBe(0);
    expect(parsed.files[0].hunks[0].newStart).toBe(1);
  });

  it("tracks old and new line numbers across context and removals", () => {
    const diff = `diff --git a/src/math.ts b/src/math.ts
--- a/src/math.ts
+++ b/src/math.ts
@@ -10,4 +10,4 @@
 const a = 1;
-const b = a + 2;
+const b = a + 1;
 return b;
`;
    const parsed = parseDiff(diff);
    const lines = parsed.files[0].hunks[0].lines;

    expect(lines.map((line) => line.type)).toEqual(["context", "del", "add", "context"]);
    expect(lines[0]).toMatchObject({ type: "context", oldLine: 10, newLine: 10 });
    expect(lines[1]).toMatchObject({ type: "del", oldLine: 11, newLine: null });
    expect(lines[2]).toMatchObject({ type: "add", oldLine: null, newLine: 11 });
    expect(lines[3]).toMatchObject({ type: "context", oldLine: 12, newLine: 12 });
    expect(parsed.addedLines).toBe(1);
    expect(parsed.removedLines).toBe(1);
  });

  it("does not treat plain source as a diff", () => {
    expect(looksLikeDiff(SAMPLE_SOURCE)).toBe(false);
    const analysis = analyzeInput(SAMPLE_SOURCE);
    expect(analysis.kind).toBe("source");
    expect(analysis.diff).toBeNull();
    expect(analysis.addedLines).toBe(SAMPLE_SOURCE.split("\n").length);
  });

  it("handles /dev/null additions and deleted files without crashing", () => {
    const added = parseDiff(`--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
`);
    expect(added.files[0].path).toBe("new.ts");
    expect(added.files[0].isNew).toBe(true);
    expect(added.addedLines).toBe(2);

    const deleted = parseDiff(`--- a/old.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-export const gone = true;
`);
    expect(deleted.files[0].path).toBe("old.ts");
    expect(deleted.files[0].isDeleted).toBe(true);
    expect(deleted.removedLines).toBe(1);
  });

  it("keeps removed lines for evidence lookup", () => {
    const parsed = parseDiff(`--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,2 @@
-const secret = "old";
+const secret = "new";
 export { secret };
`);
    const lines = diffCodeLines(parsed);
    expect(lines.find((line) => line.side === "removed")).toMatchObject({
      file: "a.ts",
      line: 1,
      text: 'const secret = "old";',
    });
    expect(lines.find((line) => line.side === "added")).toMatchObject({
      file: "a.ts",
      line: 1,
      text: 'const secret = "new";',
    });
  });
});