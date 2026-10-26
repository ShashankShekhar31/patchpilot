import { analyzeInput, diffCodeLines, type DiffCodeLine } from "./diff";
import { normalizeLine, stripCodeFences } from "./text";

export interface EvidenceLocation {
  verified: boolean;
  file: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  side: "added" | "context" | "removed" | "source" | null;
  note?: string;
}

const UNVERIFIED: EvidenceLocation = {
  verified: false,
  file: null,
  lineStart: null,
  lineEnd: null,
  side: null,
  note: "Evidence was not found in the submitted code.",
};

interface IndexedLine {
  file: string;
  line: number;
  text: string;
  side: "added" | "context" | "removed" | "source";
}

function isDiffMarkerLine(line: string): boolean {
  return /^[+\- ]/.test(line);
}

/**
 * Normalize model-supplied evidence. Models often wrap snippets in fences or
 * copy diff markers; neither should prevent an exact match against the input.
 */
export function cleanEvidence(raw: string): string {
  let value = stripCodeFences(raw).replace(/\r\n/g, "\n");
  const lines = value.split("\n");
  const nonEmpty = lines.filter((line) => line.trim().length > 0);

  // Only strip diff markers when every non-empty line has one. Otherwise a
  // leading "-" or "+" may be part of the code itself.
  if (nonEmpty.length > 0 && nonEmpty.every(isDiffMarkerLine)) {
    value = lines.map((line) => line.slice(1)).join("\n");
  }

  return value
    .split("\n")
    .map((line) => line.replace(/^\s*\d+\s*[:|]\s?/, ""))
    .join("\n")
    .trim();
}

function evidenceLines(evidence: string): string[] {
  return evidence
    .split("\n")
    .map(normalizeLine)
    .filter((line, index, all) => line.length > 0 || (index > 0 && index < all.length - 1));
}

function buildSourceIndex(input: string, filename: string): IndexedLine[] {
  return input.split(/\r?\n/).map((text, index) => ({
    file: filename,
    line: index + 1,
    text,
    side: "source" as const,
  }));
}

function buildDiffIndexes(input: string): { all: IndexedLine[]; added: IndexedLine[]; removed: IndexedLine[] } {
  const analysis = analyzeInput(input);
  if (!analysis.diff) return { all: [], added: [], removed: [] };
  const lines: DiffCodeLine[] = diffCodeLines(analysis.diff);
  const all = lines.map((line) => ({
    file: line.file,
    line: line.line,
    text: line.text,
    side: line.side,
  }));
  return {
    all,
    added: all.filter((line) => line.side === "added"),
    removed: all.filter((line) => line.side === "removed"),
  };
}

function matchWindow(index: IndexedLine[], at: number, wanted: string[]): boolean {
  for (let offset = 0; offset < wanted.length; offset += 1) {
    const candidate = index[at + offset];
    if (!candidate || normalizeLine(candidate.text) !== wanted[offset]) return false;
  }
  return true;
}

function firstFileMatch(index: IndexedLine[], wanted: string[], hintFile?: string | null): number {
  const candidates: number[] = [];
  for (let at = 0; at + wanted.length <= index.length; at += 1) {
    if (matchWindow(index, at, wanted)) candidates.push(at);
  }
  if (candidates.length === 0) return -1;
  if (hintFile) {
    const hinted = candidates.find((at) => index[at].file === hintFile || index[at].file.endsWith(hintFile));
    if (hinted !== undefined) return hinted;
  }
  return candidates[0];
}

function locationFromWindow(
  index: IndexedLine[],
  at: number,
  length: number,
): EvidenceLocation {
  const slice = index.slice(at, at + length);
  const first = slice[0];
  const last = slice[length - 1];
  const side = slice.every((line) => line.side === "added")
    ? "added"
    : slice.every((line) => line.side === "removed")
      ? "removed"
      : slice.some((line) => line.side === "added")
        ? "added"
        : "context";

  return {
    verified: true,
    file: first.file,
    lineStart: first.line,
    lineEnd: last.line,
    side,
  };
}

/**
 * Locate evidence in the submitted input and compute line numbers from the
 * actual diff or source. Model-provided locations are never trusted directly.
 */
export function locateEvidence(
  input: string,
  rawEvidence: string,
  options: { filename?: string | null } = {},
): EvidenceLocation {
  const evidence = cleanEvidence(rawEvidence);
  if (evidence.length < 4) {
    return { ...UNVERIFIED, note: "Evidence was too short to verify." };
  }

  const wanted = evidenceLines(evidence);
  if (wanted.length === 0) return UNVERIFIED;

  const analysis = analyzeInput(input);
  const hintFile = options.filename?.trim() || null;

  if (analysis.kind === "diff") {
    const indexes = buildDiffIndexes(input);
    if (indexes.all.length > 0) {
      // Prefer added lines so a finding about new code never resolves to an
      // identical context line in an unrelated file.
      let at = firstFileMatch(indexes.added, wanted, hintFile);
      if (at >= 0) {
        const location = locationFromWindow(indexes.added, at, wanted.length);
        return { ...location, side: "added" };
      }

      at = firstFileMatch(indexes.all, wanted, hintFile);
      if (at >= 0) {
        const location = locationFromWindow(indexes.all, at, wanted.length);
        if (location.side === "removed") {
          return {
            ...location,
            note: "Evidence is on a removed line; the new-file line is unavailable.",
          };
        }
        return location;
      }

      at = firstFileMatch(indexes.removed, wanted, hintFile);
      if (at >= 0) {
        return {
          ...locationFromWindow(indexes.removed, at, wanted.length),
          side: "removed",
          note: "Evidence is on a removed line; the new-file line is unavailable.",
        };
      }
    }
  }

  const sourceIndex = buildSourceIndex(input, hintFile ?? "Submitted source");
  const at = firstFileMatch(sourceIndex, wanted, hintFile);
  if (at >= 0) {
    return { ...locationFromWindow(sourceIndex, at, wanted.length), side: "source" };
  }

  // Last resort: a single-line snippet embedded inside a longer line, e.g. the
  // model quotes `process.env.JWT_SECRET || DEV_SECRET` instead of the whole line.
  if (wanted.length === 1) {
    const needle = wanted[0].toLowerCase();
    if (needle.length >= 8) {
      const indexes =
        analysis.kind === "diff"
          ? (() => {
              const built = buildDiffIndexes(input);
              return [built.added, built.all, built.removed];
            })()
          : [sourceIndex];

      for (const index of indexes) {
        const match = index.find((line) => normalizeLine(line.text).toLowerCase().includes(needle));
        if (match) {
          return {
            verified: true,
            file: match.file,
            lineStart: match.line,
            lineEnd: match.line,
            side: match.side,
            note: "Located as a partial line match.",
          };
        }
      }
    }
  }

  return UNVERIFIED;
}