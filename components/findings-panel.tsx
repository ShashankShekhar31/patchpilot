"use client";

import { SEVERITIES, SEVERITY_LABEL, type Severity } from "@/lib/severity";
import type { Finding, ReviewResult } from "@/lib/ai/schema";
import type { SampleInput } from "@/lib/samples";
import {
  SEVERITY_STYLES,
  Button,
  Chip,
  CodeBlock,
  SectionLabel,
  SeverityBadge,
  Spinner,
} from "./ui";
import {
  AlertIcon,
  CheckIcon,
  ChevronIcon,
  InfoIcon,
  RefreshIcon,
  ShieldIcon,
} from "./icons";

export interface FindingsPanelProps {
  review: ReviewResult | null;
  loading: boolean;
  filter: Severity | "all";
  onFilter: (filter: Severity | "all") => void;
  expandedId: string | null;
  onToggle: (id: string) => void;
  stale: boolean;
  onReanalyze: () => void;
  onLoadSample: (id: SampleInput["id"]) => void;
  onOpenAbout: () => void;
}

function locationLabel(finding: Finding): string {
  if (!finding.file) return "Location unresolved";
  if (!finding.lineStart) return finding.file;
  const end = finding.lineEnd && finding.lineEnd !== finding.lineStart ? `–${finding.lineEnd}` : "";
  return `${finding.file}:${finding.lineStart}${end}`;
}

function Confidence({ value, severity }: { value: number; severity: Severity }) {
  const percent = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-14 overflow-hidden rounded-full bg-line">
        <div
          className={`h-full rounded-full ${SEVERITY_STYLES[severity].bar}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="font-mono text-[10.5px] text-faint">{percent}%</span>
    </div>
  );
}

function FindingCard({
  finding,
  expanded,
  onToggle,
}: {
  finding: Finding;
  expanded: boolean;
  onToggle: () => void;
}) {
  const panelId = `finding-panel-${finding.id}`;
  const buttonId = `finding-button-${finding.id}`;

  return (
    <article
      id={`finding-${finding.id}`}
      className={`overflow-hidden rounded-lg border border-l-2 border-line bg-panel ${SEVERITY_STYLES[finding.severity].border}`}
    >
      <h3>
        <button
          id={buttonId}
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-white/[0.02]"
        >
          <span className="mt-0.5 shrink-0">
            <SeverityBadge severity={finding.severity} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-medium leading-5 text-ink">
              {finding.title}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10.5px] text-faint">
              <span className="truncate">{locationLabel(finding)}</span>
              <span aria-hidden>·</span>
              <span className="capitalize">{finding.category.replace("-", " ")}</span>
              {finding.evidenceVerified ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1 text-accent">
                    <CheckIcon className="size-3" />
                    Evidence verified
                  </span>
                </>
              ) : null}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="hidden sm:block">
              <Confidence value={finding.confidence} severity={finding.severity} />
            </span>
            <ChevronIcon
              className={`size-4 text-faint transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </span>
        </button>
      </h3>

      {expanded ? (
        <div id={panelId} role="region" aria-labelledby={buttonId} className="border-t border-line px-3 pb-3 pt-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <SectionLabel>Evidence from submission</SectionLabel>
            <span className="font-mono text-[10.5px] text-faint sm:hidden">
              confidence {Math.round(finding.confidence * 100)}%
            </span>
          </div>
          <CodeBlock
            value={finding.evidence}
            label={`${locationLabel(finding)}`}
            maxHeight={220}
          />

          {finding.locationNote ? (
            <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-medium">
              <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
              {finding.locationNote}
            </p>
          ) : null}

          <div className="mt-3 grid gap-3">
            <div>
              <SectionLabel>Why it matters</SectionLabel>
              <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-5 text-muted">
                {finding.explanation}
              </p>
            </div>
            <div className="rounded border border-accent/20 bg-accent-soft/40 p-2.5">
              <SectionLabel>Suggested fix</SectionLabel>
              <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-5 text-ink">
                {finding.fix}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function EmptyState({
  onLoadSample,
  onOpenAbout,
}: {
  onLoadSample: (id: SampleInput["id"]) => void;
  onOpenAbout: () => void;
}) {
  return (
    <div className="flex h-full min-h-[360px] flex-col justify-center rounded-lg border border-dashed border-line-strong bg-panel/50 px-6 py-10">
      <div className="mx-auto max-w-sm text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-lg border border-line-strong bg-panel-raised text-accent">
          <ShieldIcon className="size-5" />
        </div>
        <h3 className="mt-3 text-[15px] font-semibold text-ink">No review yet</h3>
        <p className="mt-1 text-[12.5px] leading-5 text-muted">
          Paste a diff or source file, then run an analysis. Every finding must quote real code from
          the submission.
        </p>
        <div className="mt-4 grid gap-2 text-left">
          {[
            "Paste a unified diff or source file.",
            "Run the review and inspect severity and evidence.",
            "Ask follow-ups, generate tests, export Markdown.",
          ].map((step, index) => (
            <div key={step} className="flex items-start gap-2 rounded border border-line bg-panel px-2.5 py-2">
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-line-strong font-mono text-[9.5px] text-faint">
                {index + 1}
              </span>
              <span className="text-[12px] leading-4 text-muted">{step}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="primary" size="sm" onClick={() => onLoadSample("checkout")}>
            Load sample diff
          </Button>
          <Button variant="ghost" size="sm" onClick={onOpenAbout}>
            How it works
          </Button>
        </div>
      </div>
    </div>
  );
}

function RerunStrip({ label }: { label: string }) {
  return (
    <div
      aria-live="polite"
      className="flex items-center gap-2 rounded border border-accent/25 bg-accent-soft/40 px-3 py-2 text-[11.5px] text-muted"
    >
      <Spinner className="size-3 text-accent" />
      {label}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="grid gap-2" aria-live="polite" aria-busy="true">
      <div className="rounded-lg border border-line bg-panel p-4">
        <div className="h-2.5 w-24 animate-pulse rounded bg-line" />
        <div className="mt-3 h-2 w-full animate-pulse rounded bg-line/80" />
        <div className="mt-2 h-2 w-4/5 animate-pulse rounded bg-line/80" />
      </div>
      {[0, 1, 2].map((index) => (
        <div key={index} className="rounded-lg border border-line bg-panel p-4">
          <div className="flex items-center gap-2">
            <div className="h-4 w-16 animate-pulse rounded bg-line" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-line/80" />
          </div>
          <div className="mt-3 h-2 w-1/2 animate-pulse rounded bg-line/70" />
        </div>
      ))}
      <p className="px-1 text-[11.5px] text-faint">
        Analyzing structure, checking each quoted excerpt against the submission…
      </p>
    </div>
  );
}

export function FindingsPanel({
  review,
  loading,
  filter,
  onFilter,
  expandedId,
  onToggle,
  stale,
  onReanalyze,
  onLoadSample,
  onOpenAbout,
}: FindingsPanelProps) {
  const filtered =
    review === null
      ? []
      : filter === "all"
        ? review.findings
        : review.findings.filter((finding) => finding.severity === filter);

  return (
    <section aria-labelledby="findings-heading" className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10.5px] text-faint">02</span>
          <h2 id="findings-heading" className="text-[13px] font-semibold text-ink">
            Findings
          </h2>
          {review ? (
            <span className="font-mono text-[10.5px] text-faint">
              {review.findings.length} verified
            </span>
          ) : null}
        </div>
        {review ? (
          <div className="flex items-center gap-1.5">
            <Chip tone={review.mode === "live" ? "accent" : "warning"}>
              {review.mode === "live" ? "Live result" : "Sample data"}
            </Chip>
            <span className="hidden font-mono text-[10.5px] text-faint sm:inline">
              {review.id}
            </span>
          </div>
        ) : null}
      </div>

      {!review ? (
        loading ? (
          <LoadingState />
        ) : (
          <EmptyState onLoadSample={onLoadSample} onOpenAbout={onOpenAbout} />
        )
      ) : (
        <div className="grid gap-2">
          {loading ? (
            <RerunStrip label="Requesting a new review. The previous findings stay visible until it returns." />
          ) : null}

          {stale ? (
            <div className="flex flex-wrap items-center gap-2 rounded border border-medium/30 bg-medium/10 px-3 py-2 text-[12px] text-medium">
              <AlertIcon className="size-3.5 shrink-0" />
              <span className="flex-1">The code changed after this review. Evidence below may be stale.</span>
              <Button size="sm" variant="secondary" onClick={onReanalyze}>
                <RefreshIcon className="size-3.5" />
                Rerun
              </Button>
            </div>
          ) : null}

          <div className="rounded-lg border border-line bg-panel p-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10.5px] text-faint">
              <span>{review.provider.label}</span>
              <span aria-hidden>·</span>
              <span className="max-w-[220px] truncate">{review.provider.modelName}</span>
              <span aria-hidden>·</span>
              <span>
                {review.provider.license}
                {review.provider.licenseVerified ? "" : " (unverified)"}
              </span>
              <span aria-hidden>·</span>
              <span>{(review.durationMs / 1000).toFixed(1)}s</span>
              {review.usage?.completionTokens ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{review.usage.completionTokens} out tokens</span>
                </>
              ) : null}
            </div>
            <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-5 text-muted">
              {review.summary}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6" role="group" aria-label="Filter findings by severity">
            <button
              type="button"
              onClick={() => onFilter("all")}
              aria-pressed={filter === "all"}
              className={`rounded border px-2 py-1.5 text-left transition-colors ${
                filter === "all"
                  ? "border-accent/50 bg-accent-soft text-ink"
                  : "border-line bg-panel text-muted hover:border-line-strong"
              }`}
            >
              <span className="block font-mono text-[15px] leading-5 text-ink">
                {review.findings.length}
              </span>
              <span className="block text-[10.5px] uppercase tracking-wide">All</span>
            </button>
            {SEVERITIES.map((severity) => (
              <button
                key={severity}
                type="button"
                onClick={() => onFilter(severity)}
                aria-pressed={filter === severity}
                className={`rounded border px-2 py-1.5 text-left transition-colors ${
                  filter === severity
                    ? `${SEVERITY_STYLES[severity].badge}`
                    : "border-line bg-panel text-muted hover:border-line-strong"
                }`}
              >
                <span className={`block font-mono text-[15px] leading-5 ${filter === severity ? "" : SEVERITY_STYLES[severity].text}`}>
                  {review.counts[severity]}
                </span>
                <span className="block text-[10.5px] uppercase tracking-wide">
                  {severity === "info" ? "Info" : SEVERITY_LABEL[severity]}
                </span>
              </button>
            ))}
          </div>

          {review.warnings.length > 0 ? (
            <div className="rounded border border-medium/25 bg-medium/[0.06] px-3 py-2">
              <div className="flex items-start gap-2">
                <AlertIcon className="mt-0.5 size-3.5 shrink-0 text-medium" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px] font-medium text-medium">
                    {review.warnings.length} review note{review.warnings.length === 1 ? "" : "s"}
                  </p>
                  <ul className="mt-1 grid gap-0.5 text-[11.5px] leading-5 text-muted">
                    {review.warnings.map((warning) => (
                      <li key={warning}>· {warning}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : null}

          {filtered.length === 0 ? (
            <div className="rounded-lg border border-line bg-panel px-4 py-8 text-center">
              <p className="text-[13px] text-ink">
                No {filter === "all" ? "" : SEVERITY_LABEL[filter].toLowerCase()} findings.
              </p>
              <p className="mt-1 text-[12px] text-muted">
                {filter === "all"
                  ? "No verified finding survived evidence checks. That is a valid result, not a guarantee."
                  : "Clear the filter to see the rest of the review."}
              </p>
              {filter !== "all" ? (
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => onFilter("all")}>
                  Show all severities
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-2">
              {filtered.map((finding) => (
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  expanded={expandedId === finding.id}
                  onToggle={() => onToggle(finding.id)}
                />
              ))}
            </div>
          )}

          <details className="group rounded-lg border border-line bg-panel px-3 py-2">
            <summary className="cursor-pointer list-none text-[12px] font-medium text-muted hover:text-ink">
              Scope and limitations
            </summary>
            <ul className="mt-2 grid gap-1 text-[11.5px] leading-5 text-faint">
              {review.limitations.map((limitation) => (
                <li key={limitation}>· {limitation}</li>
              ))}
            </ul>
          </details>

          <p className="px-1 text-[11px] leading-4 text-faint">
            Findings are AI suggestions, not verified vulnerabilities. PatchPilot checks that each
            excerpt exists in the submission; it does not prove exploitability.
          </p>
        </div>
      )}
    </section>
  );
}