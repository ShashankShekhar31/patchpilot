import { countLines } from "./text";

export type DiffLineType = "add" | "del" | "context";

export interface DiffLine {
  type: DiffLineType;
  text: string;
  newLine: number | null;
  oldLine: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  oldPath: string | null;
  isNew: boolean;
  isDeleted: boolean;
  hunks: DiffHunk[];
}

export interface DiffSummary {
  isDiff: boolean;
  files: DiffFile[];
  addedLines: number;
  removedLines: number;
}

export interface DiffCodeLine {
  file: string;
  line: number;
  text: string;
  side: "added" | "context" | "removed";
}

export interface InputAnalysis {
  kind: "diff" | "source";
  files: string[];
  addedLines: number;
  removedLines: number;
  diff: DiffSummary | null;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function cleanPath(raw: string): string | null {
  let value = raw.trim();
  if (!value || value === "/dev/null") return null;
  value = value.split("\t")[0].trim();
  if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
    value = value.slice(1, -1);
  }
  value = value.replace(/^[ab]\//, "");
  return value || null;
}

export function looksLikeDiff(input: string): boolean {
  const hasHunk = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(input);
  const hasHeaders = /^diff --git /m.test(input) || /^\+\+\+ /m.test(input);
  return hasHunk && hasHeaders;
}

export function parseDiff(input: string): DiffSummary {
  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let addedLines = 0;
  let removedLines = 0;
  let pendingOldPath: string | null = null;

  const ensureFile = (): DiffFile => {
    if (!currentFile) {
      currentFile = {
        path: "",
        oldPath: pendingOldPath,
        isNew: false,
        isDeleted: false,
        hunks: [],
      };
      files.push(currentFile);
    }
    return currentFile;
  };

  const lines = input.split(/\r?\n/);
  // A trailing newline is a file terminator, not an empty context line.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const path = match ? cleanPath(match[2]) : null;
      currentFile = {
        path: path ?? "",
        oldPath: match ? cleanPath(match[1]) : null,
        isNew: false,
        isDeleted: false,
        hunks: [],
      };
      files.push(currentFile);
      currentHunk = null;
      pendingOldPath = currentFile.oldPath;
      continue;
    }

    if (line.startsWith("--- ")) {
      pendingOldPath = cleanPath(line.slice(4));
      continue;
    }

    if (line.startsWith("+++ ")) {
      const newPath = cleanPath(line.slice(4));
      const file = ensureFile();
      file.oldPath = pendingOldPath;
      file.isNew = pendingOldPath === null && newPath !== null;
      file.isDeleted = newPath === null;
      if (newPath) file.path = newPath;
      else if (pendingOldPath) file.path = pendingOldPath;
      continue;
    }

    const hunkMatch = line.match(HUNK_RE);
    if (hunkMatch) {
      const file = ensureFile();
      currentHunk = {
        header: line,
        oldStart: Number(hunkMatch[1]),
        newStart: Number(hunkMatch[3]),
        lines: [],
      };
      file.hunks.push(currentHunk);
      oldLine = currentHunk.oldStart;
      newLine = currentHunk.newStart;
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith("\\")) continue;

    const marker = line[0];
    const text = line.length > 0 ? line.slice(1) : "";

    if (marker === "+") {
      currentHunk.lines.push({ type: "add", text, newLine, oldLine: null });
      newLine += 1;
      addedLines += 1;
      continue;
    }

    if (marker === "-") {
      currentHunk.lines.push({ type: "del", text, newLine: null, oldLine });
      oldLine += 1;
      removedLines += 1;
      continue;
    }

    if (marker === " " || line === "") {
      currentHunk.lines.push({
        type: "context",
        text: line === "" ? "" : text,
        newLine,
        oldLine,
      });
      newLine += 1;
      oldLine += 1;
    }
  }

  for (const file of files) {
    if (!file.path) file.path = "unknown";
  }

  return {
    isDiff: files.some((file) => file.hunks.length > 0),
    files,
    addedLines,
    removedLines,
  };
}

export function analyzeInput(input: string): InputAnalysis {
  if (looksLikeDiff(input)) {
    const diff = parseDiff(input);
    return {
      kind: "diff",
      files: diff.files.map((file) => file.path),
      addedLines: diff.addedLines,
      removedLines: diff.removedLines,
      diff,
    };
  }

  return {
    kind: "source",
    files: [],
    addedLines: countLines(input),
    removedLines: 0,
    diff: null,
  };
}

/** Flatten a parsed diff into new-file lines plus removed lines for evidence lookup. */
export function diffCodeLines(diff: DiffSummary): DiffCodeLine[] {
  const result: DiffCodeLine[] = [];
  for (const file of diff.files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type === "add" && line.newLine !== null) {
          result.push({ file: file.path, line: line.newLine, text: line.text, side: "added" });
        } else if (line.type === "context" && line.newLine !== null) {
          result.push({ file: file.path, line: line.newLine, text: line.text, side: "context" });
        } else if (line.type === "del" && line.oldLine !== null) {
          result.push({ file: file.path, line: line.oldLine, text: line.text, side: "removed" });
        }
      }
    }
  }
  return result;
}