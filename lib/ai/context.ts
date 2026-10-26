import { analyzeInput, diffCodeLines } from "@/lib/diff";
import type { Finding } from "./schema";

export interface RelevantContext {
  text: string;
  excerptCount: number;
  truncated: boolean;
}

interface CodeLine {
  file: string | null;
  line: number;
  text: string;
}

const WINDOW_BEFORE = 6;
const WINDOW_AFTER = 8;
const MAX_EXCERPTS = 3;
const DEFAULT_MAX_CHARS = 6_000;
const SUBMITTED_SOURCE = "Submitted source";

function buildLines(code: string): CodeLine[] {
  const analysis = analyzeInput(code);
  if (analysis.kind === "diff" && analysis.diff) {
    return diffCodeLines(analysis.diff)
      .filter((line) => line.side !== "removed")
      .map((line) => ({ file: line.file, line: line.line, text: line.text }));
  }

  return code.split(/\r?\n/).map((text, index) => ({
    file: null,
    line: index + 1,
    text,
  }));
}

function groupLines(lines: CodeLine[]): Map<string, CodeLine[]> {
  const groups = new Map<string, CodeLine[]>();
  for (const line of lines) {
    const key = line.file ?? SUBMITTED_SOURCE;
    const group = groups.get(key) ?? [];
    group.push(line);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.line - b.line);
  }
  return groups;
}

interface Range {
  key: string;
  start: number;
  end: number;
}

function mergeRanges(ranges: Range[]): Range[] {
  const merged: Range[] = [];
  for (const range of [...ranges].sort((a, b) => (a.key === b.key ? a.start - b.start : a.key.localeCompare(b.key)))) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.key === range.key &&
      range.start <= previous.end + 2
    ) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function renderRange(key: string, group: CodeLine[], start: number, end: number): string {
  const selected = group.filter((line) => line.line >= start && line.line <= end);
  if (selected.length === 0) return "";
  const first = selected[0].line;
  const last = selected[selected.length - 1].line;
  const width = String(last).length;
  const body = selected
    .map((line) => `${String(line.line).padStart(width)}| ${line.text}`)
    .join("\n");
  return `${key}:${first}-${last}\n${body}`;
}

/**
 * Build a small, line-numbered context block around verified findings. Test
 * generation does not need the whole submission, and sending it increases
 * latency and truncation risk without improving the tests.
 */
export function extractRelevantCode(
  code: string,
  findings: Finding[],
  options: { maxChars?: number; before?: number; after?: number; maxExcerpts?: number } = {},
): RelevantContext {
  const maxChars = Math.max(1_000, options.maxChars ?? DEFAULT_MAX_CHARS);
  const before = Math.max(0, options.before ?? WINDOW_BEFORE);
  const after = Math.max(0, options.after ?? WINDOW_AFTER);
  const maxExcerpts = Math.max(1, options.maxExcerpts ?? MAX_EXCERPTS);
  const groups = groupLines(buildLines(code));
  if (groups.size === 0) return { text: "", excerptCount: 0, truncated: false };

  const knownLocations = new Set(groups.keys());
  const onlyKey = groups.size === 1 ? [...groups.keys()][0] : null;
  const ranges: Range[] = [];

  for (const finding of findings) {
    if (!finding.lineStart) continue;
    const key =
      finding.file && knownLocations.has(finding.file)
        ? finding.file
        : (onlyKey ?? finding.file);
    if (!key || !knownLocations.has(key)) continue;
    const endLine = Math.max(finding.lineStart, finding.lineEnd ?? finding.lineStart);
    ranges.push({
      key,
      start: Math.max(1, finding.lineStart - before),
      end: endLine + after,
    });
  }

  const merged = mergeRanges(ranges).slice(0, maxExcerpts);
  const sections: string[] = [];
  let truncated = false;

  if (merged.length > 0) {
    for (const range of merged) {
      const group = groups.get(range.key) ?? [];
      const section = renderRange(range.key, group, range.start, range.end);
      if (!section) continue;
      if (sections.join("\n\n").length + section.length > maxChars) {
        truncated = true;
        const remaining = maxChars - sections.join("\n\n").length;
        if (remaining > 120) {
          sections.push(section.slice(0, remaining) + "\n... [excerpt truncated]");
        }
        break;
      }
      sections.push(section);
    }
  }

  if (sections.length === 0) {
    // No usable finding locations: send only the head of the submission.
    for (const [key, group] of groups) {
      const selected = group.slice(0, 80);
      const section = renderRange(key, group, selected[0].line, selected[selected.length - 1].line);
      if (section.length > maxChars) {
        sections.push(section.slice(0, maxChars) + "\n... [excerpt truncated]");
        truncated = true;
      } else {
        sections.push(section);
      }
      break;
    }
  }

  return {
    text: sections.join("\n\n"),
    excerptCount: sections.length,
    truncated,
  };
}