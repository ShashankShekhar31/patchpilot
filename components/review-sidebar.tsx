"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { ReviewResult, TestResult } from "@/lib/ai/schema";
import { Button, Chip, CopyButton, SectionLabel, Spinner } from "./ui";
import {
  ChatIcon,
  DownloadIcon,
  InfoIcon,
  RefreshIcon,
  ReportIcon,
  SendIcon,
  SparkIcon,
  TestIcon,
} from "./icons";

export type SidebarTab = "ask" | "tests" | "report";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  meta?: string;
  error?: boolean;
}

export interface ReviewSidebarProps {
  review: ReviewResult | null;
  messages: ChatMessage[];
  question: string;
  onQuestionChange: (value: string) => void;
  onAsk: (question?: string) => void;
  asking: boolean;
  askError: string | null;
  onRetryAsk: () => void;
  tests: TestResult | null;
  testing: boolean;
  testsError: string | null;
  onRetryTests: () => void;
  onGenerateTests: () => void;
  report: string;
  onDownloadReport: () => void;
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  canAsk: boolean;
  providerMode: "live" | "sample";
  providerLabel: string;
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
  id,
  controls,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  count?: number;
  id: string;
  controls: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={active}
      aria-controls={controls}
      onClick={onClick}
      className={`relative flex h-10 items-center gap-1.5 px-2.5 text-[12px] font-medium transition-colors ${
        active ? "text-ink" : "text-faint hover:text-muted"
      }`}
    >
      {icon}
      <span>{label}</span>
      {typeof count === "number" && count > 0 ? (
        <span className="rounded bg-line px-1 font-mono text-[9.5px] text-muted">{count}</span>
      ) : null}
      {active ? <span className="absolute inset-x-1 -bottom-px h-0.5 rounded bg-accent" /> : null}
    </button>
  );
}

function EmptyPanel({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-5 py-8 text-center">
      <div className="flex size-10 items-center justify-center rounded-lg border border-line-strong bg-panel-raised text-faint">
        {icon}
      </div>
      <h3 className="mt-2.5 text-[13px] font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-[260px] text-[11.5px] leading-5 text-faint">{body}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function ReviewSidebar({
  review,
  messages,
  question,
  onQuestionChange,
  onAsk,
  asking,
  askError,
  onRetryAsk,
  tests,
  testing,
  testsError,
  onRetryTests,
  onGenerateTests,
  report,
  onDownloadReport,
  tab,
  onTabChange,
  canAsk,
  providerMode,
  providerLabel,
}: ReviewSidebarProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, asking]);

  function submit() {
    if (!canAsk || asking) return;
    onAsk();
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  const suggestions =
    review && review.findings.length > 0
      ? [
          "What should I fix first?",
          `Explain the ${review.findings[0].severity} finding in more detail.`,
          "What tests would catch these bugs?",
        ]
      : ["What looks risky in this code?", "How would you test this?", "What should I fix first?"];

  const modeLabel =
    providerMode === "live"
      ? `Live · ${providerLabel}`
      : "Sample mode · deterministic rules";

  const testCount = tests?.cases.length ?? 0;

  return (
    <aside className="flex h-[560px] min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-panel xl:sticky xl:top-[76px] xl:h-[calc(100vh-92px)]">
      <div className="flex items-center justify-between gap-2 border-b border-line pl-1 pr-2">
        <div role="tablist" aria-label="Review workspace" className="flex min-w-0">
          <TabButton
            id="tab-ask"
            controls="panel-ask"
            active={tab === "ask"}
            onClick={() => onTabChange("ask")}
            icon={<ChatIcon className="size-3.5" />}
            label="Ask"
            count={messages.filter((message) => message.role === "assistant").length}
          />
          <TabButton
            id="tab-tests"
            controls="panel-tests"
            active={tab === "tests"}
            onClick={() => onTabChange("tests")}
            icon={<TestIcon className="size-3.5" />}
            label="Tests"
            count={testCount}
          />
          <TabButton
            id="tab-report"
            controls="panel-report"
            active={tab === "report"}
            onClick={() => onTabChange("report")}
            icon={<ReportIcon className="size-3.5" />}
            label="Report"
          />
        </div>
        <Chip tone={providerMode === "live" ? "accent" : "warning"} className="hidden sm:inline-flex">
          {providerMode === "live" ? "Live" : "Sample"}
        </Chip>
      </div>

      {tab === "ask" ? (
        <div
          id="panel-ask"
          role="tabpanel"
          aria-labelledby="tab-ask"
          className="flex min-h-0 flex-1 flex-col"
        >
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3" aria-live="polite">
            {messages.length === 0 ? (
              <div className="grid gap-3 py-2">
                <EmptyPanel
                  icon={<ChatIcon className="size-4.5" />}
                  title="Ask about this code"
                  body="Questions are answered from the submitted code and its verified findings. PatchPilot will say when the code does not show enough."
                />
                <div className="grid gap-1.5">
                  <SectionLabel>Suggested questions</SectionLabel>
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => onAsk(suggestion)}
                      disabled={!canAsk || asking}
                      className="rounded border border-line bg-canvas px-2.5 py-2 text-left text-[11.5px] leading-4 text-muted transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid gap-3">
                {messages.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={`rounded-lg border px-3 py-2 ${
                      message.role === "user"
                        ? "border-line-strong bg-panel-raised"
                        : message.error
                          ? "border-critical/30 bg-critical/[0.06]"
                          : "border-line bg-canvas"
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-mono text-[9.5px] uppercase tracking-wide text-faint">
                        {message.role === "user" ? "You" : "PatchPilot"}
                      </span>
                      {message.meta ? (
                        <span className="truncate font-mono text-[9.5px] text-faint">
                          {message.meta}
                        </span>
                      ) : null}
                    </div>
                    <p className="whitespace-pre-wrap text-[12px] leading-5 text-muted">
                      {message.content}
                    </p>
                  </div>
                ))}
                {asking ? (
                  <div className="flex items-center gap-2 px-1 py-1 text-[11.5px] text-faint">
                    <Spinner className="size-3" />
                    Thinking with {modeLabel}…
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {askError ? (
            <div className="flex items-start gap-2 border-t border-critical/25 bg-critical/[0.06] px-3 py-2">
              <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-critical" />
              <p className="min-w-0 flex-1 text-[11.5px] leading-5 text-critical">{askError}</p>
              <Button size="sm" variant="ghost" onClick={onRetryAsk} disabled={asking}>
                <RefreshIcon className="size-3.5" />
                Retry
              </Button>
            </div>
          ) : null}

          <div className="border-t border-line p-2.5">
            <label htmlFor="follow-up" className="sr-only">
              Follow-up question
            </label>
            <textarea
              id="follow-up"
              value={question}
              onChange={(event) => onQuestionChange(event.target.value.slice(0, 1000))}
              onKeyDown={onComposerKeyDown}
              placeholder={canAsk ? "Ask a follow-up… (Enter to send)" : "Paste some code first"}
              rows={2}
              disabled={!canAsk || asking}
              className="w-full resize-none rounded border border-line bg-canvas px-2.5 py-2 text-[12px] leading-5 text-ink placeholder:text-faint focus:border-accent/50 focus:outline-none disabled:opacity-60"
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="truncate font-mono text-[9.5px] text-faint">{modeLabel}</span>
              <div className="flex items-center gap-1.5">
                {question.length > 850 ? (
                  <span className="font-mono text-[9.5px] text-medium">{question.length}/1000</span>
                ) : null}
                <Button
                  size="sm"
                  variant="primary"
                  onClick={submit}
                  disabled={!canAsk || asking || question.trim().length < 3}
                  loading={asking}
                >
                  {!asking ? <SendIcon className="size-3.5" /> : null}
                  Send
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "tests" ? (
        <div
          id="panel-tests"
          role="tabpanel"
          aria-labelledby="tab-tests"
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <SectionLabel>Suggested test cases</SectionLabel>
            <Button
              size="sm"
              variant="secondary"
              onClick={onGenerateTests}
              loading={testing}
              disabled={!canAsk}
            >
              {!testing ? <TestIcon className="size-3.5" /> : null}
              {tests ? "Regenerate" : "Generate tests"}
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {testsError ? (
              <div
                role="alert"
                className="mb-2 flex flex-wrap items-start gap-2 rounded border border-critical/30 bg-critical/[0.07] px-2.5 py-2"
              >
                <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-critical" />
                <p className="min-w-0 flex-1 text-[11.5px] leading-5 text-critical">
                  {testsError}
                </p>
                <Button size="sm" variant="ghost" onClick={onRetryTests} disabled={testing}>
                  <RefreshIcon className="size-3.5" />
                  Retry
                </Button>
              </div>
            ) : null}

            {!tests ? (
              testing ? (
                <div className="grid gap-2" aria-live="polite" aria-busy="true">
                  {[0, 1].map((index) => (
                    <div key={index} className="rounded border border-line bg-canvas p-3">
                      <div className="h-2.5 w-2/3 animate-pulse rounded bg-line" />
                      <div className="mt-2 h-2 w-full animate-pulse rounded bg-line/70" />
                      <div className="mt-3 h-16 animate-pulse rounded bg-line/40" />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyPanel
                  icon={<TestIcon className="size-4.5" />}
                  title="Turn findings into regression tests"
                  body="Generate focused test suggestions for the submitted code. They are suggestions and are never executed."
                  action={
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={onGenerateTests}
                      disabled={!canAsk}
                    >
                      <SparkIcon className="size-3.5" />
                      Generate tests
                    </Button>
                  }
                />
              )
            ) : (
              <div className="grid gap-2.5">
                {testing ? (
                  <div
                    aria-live="polite"
                    className="flex items-center gap-2 rounded border border-accent/25 bg-accent-soft/40 px-2.5 py-2 text-[11px] text-muted"
                  >
                    <Spinner className="size-3 text-accent" />
                    Regenerating tests. Previous suggestions stay visible until the new ones return.
                  </div>
                ) : null}
                <div className="rounded border border-line bg-canvas p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip tone={tests.mode === "live" ? "accent" : "warning"}>
                      {tests.mode === "live" ? "Live model" : "Sample data"}
                    </Chip>
                    <Chip>{tests.framework}</Chip>
                  </div>
                  <p className="mt-2 text-[12px] leading-5 text-muted">{tests.summary}</p>
                </div>

                {tests.cases.map((testCase, index) => (
                  <div key={`${testCase.title}-${index}`} className="rounded border border-line bg-canvas p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <p className="text-[12px] font-medium text-ink">{testCase.title}</p>
                      <Chip>{testCase.testType}</Chip>
                    </div>
                    <dl className="mt-1.5 grid gap-1.5">
                      <div>
                        <dt className="font-mono text-[9.5px] uppercase tracking-wide text-faint">
                          Setup
                        </dt>
                        <dd className="text-[11.5px] leading-4 text-muted">{testCase.setup}</dd>
                      </div>
                      <div>
                        <dt className="font-mono text-[9.5px] uppercase tracking-wide text-faint">
                          Expected
                        </dt>
                        <dd className="text-[11.5px] leading-4 text-muted">{testCase.expected}</dd>
                      </div>
                      <div>
                        <dt className="font-mono text-[9.5px] uppercase tracking-wide text-faint">
                          Covers
                        </dt>
                        <dd className="text-[11.5px] leading-4 text-faint">{testCase.finding}</dd>
                      </div>
                    </dl>
                  </div>
                ))}

                {tests.warnings.map((warning) => (
                  <p key={warning} className="flex items-start gap-1.5 text-[11px] leading-4 text-faint">
                    <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
                    {warning}
                  </p>
                ))}

                <p className="text-[10.5px] leading-4 text-faint">
                  Suggested tests were not executed. Adapt imports, mocks, and fixtures before
                  trusting them.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {tab === "report" ? (
        <div
          id="panel-report"
          role="tabpanel"
          aria-labelledby="tab-report"
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
            <SectionLabel>Markdown report</SectionLabel>
            <div className="flex items-center gap-1.5">
              <CopyButton value={report} label="Copy" size="sm" variant="ghost" />
              <Button
                size="sm"
                variant="secondary"
                onClick={onDownloadReport}
                disabled={!review}
              >
                <DownloadIcon className="size-3.5" />
                Download
              </Button>
            </div>
          </div>

          {!review ? (
            <EmptyPanel
              icon={<ReportIcon className="size-4.5" />}
              title="No report yet"
              body="Run a review to generate a Markdown report with metadata, verified evidence, fixes, warnings, and limitations."
              action={
                <Button size="sm" variant="ghost" onClick={() => onTabChange("ask")}>
                  Back to review chat
                </Button>
              }
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-hidden p-2.5">
              <pre className="h-full overflow-auto rounded border border-line bg-canvas p-3 font-mono text-[11px] leading-5 text-muted">
                <code>{report}</code>
              </pre>
            </div>
          )}
        </div>
      ) : null}
    </aside>
  );
}