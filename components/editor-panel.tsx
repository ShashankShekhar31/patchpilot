"use client";

import { useMemo, useRef, type ChangeEvent, type KeyboardEvent, type UIEvent } from "react";
import type { SampleInput } from "@/lib/samples";
import { Button, Chip, SectionLabel } from "./ui";
import { CodeIcon, InfoIcon, PlayIcon, TrashIcon } from "./icons";

const LANGUAGES = [
  { value: "auto", label: "Auto-detect" },
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript" },
  { value: "tsx", label: "TSX / JSX" },
  { value: "python", label: "Python" },
  { value: "go", label: "Go" },
  { value: "java", label: "Java" },
  { value: "rust", label: "Rust" },
  { value: "sql", label: "SQL" },
  { value: "other", label: "Other" },
];

export interface EditorPanelProps {
  code: string;
  onCodeChange: (value: string) => void;
  filename: string;
  onFilenameChange: (value: string) => void;
  language: string;
  onLanguageChange: (value: string) => void;
  onAnalyze: () => void;
  onClear: () => void;
  onLoadSample: (id: SampleInput["id"]) => void;
  loading: boolean;
  limit: number;
  sampleId: SampleInput["id"] | null;
  notice: string | null;
  onDismissNotice: () => void;
}

export function EditorPanel({
  code,
  onCodeChange,
  filename,
  onFilenameChange,
  language,
  onLanguageChange,
  onAnalyze,
  onClear,
  onLoadSample,
  loading,
  limit,
  sampleId,
  notice,
  onDismissNotice,
}: EditorPanelProps) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const lineCount = useMemo(() => (code ? code.split("\n").length : 1), [code]);
  const overLimit = code.length > limit;
  const tooShort = code.trim().length < 10;
  const nearLimit = code.length > limit * 0.9;

  function onScroll(event: UIEvent<HTMLTextAreaElement>) {
    if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (!loading && !overLimit && !tooShort) onAnalyze();
    }
  }

  return (
    <section aria-labelledby="input-heading" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10.5px] text-faint">01</span>
          <h2 id="input-heading" className="text-[13px] font-semibold text-ink">
            Submission
          </h2>
        </div>
        <div className="flex items-center gap-1.5">
          {sampleId ? <Chip tone="warning">Bundled sample</Chip> : null}
          <Chip>{code.trim().startsWith("diff --git") ? "Diff" : "Source"}</Chip>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-2.5 py-2">
          <label className="sr-only" htmlFor="filename">
            File path
          </label>
          <input
            id="filename"
            value={filename}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onFilenameChange(event.target.value)}
            placeholder="src/checkout.ts (optional)"
            maxLength={200}
            spellCheck={false}
            className="h-8 min-w-[150px] flex-1 rounded border border-line bg-canvas px-2 font-mono text-[12px] text-ink placeholder:text-faint focus:border-accent/60 focus:outline-none"
          />

          <label className="sr-only" htmlFor="language">
            Language
          </label>
          <select
            id="language"
            value={language}
            onChange={(event) => onLanguageChange(event.target.value)}
            className="h-8 rounded border border-line bg-canvas px-2 text-[12px] text-muted focus:border-accent/60 focus:outline-none"
          >
            {LANGUAGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <div className="ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onLoadSample("checkout")}
              title="Load the bundled checkout diff with a real discount bug"
            >
              <CodeIcon className="size-3.5" />
              Diff sample
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onLoadSample("orders")}
              title="Load the bundled order source sample"
            >
              Source sample
            </Button>
          </div>
        </div>

        {notice ? (
          <div className="flex items-start gap-2 border-b border-line bg-accent-soft/50 px-3 py-2 text-[12px] text-muted">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-accent" />
            <p className="flex-1">{notice}</p>
            <button
              type="button"
              onClick={onDismissNotice}
              className="text-faint hover:text-ink"
              aria-label="Dismiss notice"
            >
              ×
            </button>
          </div>
        ) : null}

        <div className="flex h-[360px] sm:h-[430px] xl:h-[500px]">
          <div
            ref={gutterRef}
            aria-hidden
            className="w-11 shrink-0 select-none overflow-hidden border-r border-line bg-panel py-3 text-right font-mono text-[11.5px] leading-5 text-faint"
          >
            {Array.from({ length: lineCount }, (_, index) => (
              <div key={index} className="pr-2">
                {index + 1}
              </div>
            ))}
          </div>
          <textarea
            aria-label="Code or unified diff to review"
            value={code}
            onChange={(event) => onCodeChange(event.target.value)}
            onScroll={onScroll}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap="off"
            placeholder={"Paste a unified diff or a source file.\n\nTip: load the bundled sample to see an evidence-backed review, or paste your own diff and press Ctrl/Cmd + Enter."}
            className="min-w-0 flex-1 resize-none overflow-auto bg-canvas px-3 py-3 font-mono text-[12.5px] leading-5 text-ink placeholder:text-faint/70 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-panel px-2.5 py-2">
          <div className="flex items-center gap-2 font-mono text-[11px] text-faint">
            <span>{lineCount.toLocaleString()} lines</span>
            <span aria-hidden>·</span>
            <span className={overLimit ? "text-critical" : nearLimit ? "text-medium" : ""}>
              {code.length.toLocaleString()} / {limit.toLocaleString()} chars
            </span>
            {overLimit ? <span className="text-critical">Input too large</span> : null}
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={onClear}
              disabled={loading || code.length === 0}
              aria-label="Clear submission"
            >
              <TrashIcon className="size-3.5" />
              Clear
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={onAnalyze}
              loading={loading}
              disabled={tooShort || overLimit}
            >
              {!loading ? <PlayIcon className="size-3" /> : null}
              {loading ? "Analyzing…" : "Analyze changes"}
            </Button>
          </div>
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-[11.5px] text-faint">
        <SectionLabel>Ctrl / ⌘ + Enter runs the review</SectionLabel>
        <span aria-hidden>·</span>
        <span>Code is treated as untrusted text and never executed.</span>
      </p>
    </section>
  );
}