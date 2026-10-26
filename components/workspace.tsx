"use client";

import { useMemo, useState } from "react";
import type { PublicStatus } from "@/lib/ai/config";
import type { AskResult, ReviewResult, TestResult } from "@/lib/ai/schema";
import { ApiError, postJson } from "@/lib/client-api";
import { buildMarkdownReport } from "@/lib/report";
import { SAMPLES, identifySample, type SampleInput } from "@/lib/samples";
import type { Severity } from "@/lib/severity";
import { EditorPanel } from "./editor-panel";
import { FindingsPanel } from "./findings-panel";
import { ReviewSidebar, type ChatMessage, type SidebarTab } from "./review-sidebar";
import { StatusDialog } from "./status-dialog";
import { Button, Chip } from "./ui";
import {
  AlertIcon,
  BookIcon,
  CheckIcon,
  CloseIcon,
  CodeIcon,
  LogoMark,
  RefreshIcon,
  ShieldIcon,
} from "./icons";

interface UiError {
  message: string;
  code?: string;
  retryable: boolean;
  action: "review" | "ask" | "tests";
}

function toUiError(error: unknown, action: UiError["action"]): UiError {
  if (error instanceof ApiError) {
    return { message: error.message, code: error.code, retryable: error.retryable, action };
  }
  return {
    message: error instanceof Error ? error.message : "Something unexpected happened.",
    retryable: true,
    action,
  };
}

function compactFindings(review: ReviewResult | null, stale: boolean) {
  if (!review || stale) return [];
  return review.findings.slice(0, 12).map((finding) => ({
    title: finding.title,
    severity: finding.severity,
    category: finding.category,
    file: finding.file,
    lineStart: finding.lineStart,
    explanation: finding.explanation,
    fix: finding.fix,
    evidence: finding.evidence,
  }));
}

export function Workspace({ status }: { status: PublicStatus }) {
  const [code, setCode] = useState("");
  const [filename, setFilename] = useState("");
  const [language, setLanguage] = useState("auto");
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [reviewedCode, setReviewedCode] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [tests, setTests] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [testsError, setTestsError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [lastAsk, setLastAsk] = useState<string | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<Severity | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tab, setTab] = useState<SidebarTab>("ask");
  const [statusOpen, setStatusOpen] = useState(false);
  const [liveVerifiedAt, setLiveVerifiedAt] = useState<string | null>(null);

  const limit = status.limits.maxInputChars;
  const stale = review !== null && reviewedCode !== code;
  const sampleId = useMemo(() => identifySample(code), [code]);
  const canAsk = code.trim().length >= 10 && code.length <= limit && !reviewing;
  const isLive = status.provider.mode === "live";
  const liveVerified = liveVerifiedAt !== null;
  const busy = reviewing || asking || testing;

  const report = useMemo(() => {
    if (!review) return "";
    const enriched = stale
      ? {
          ...review,
          warnings: [
            ...review.warnings,
            "The submitted code changed after this review; evidence may no longer match the current input.",
          ],
        }
      : review;
    return buildMarkdownReport(enriched, new Date(review.createdAt));
  }, [review, stale]);

  function resetResults() {
    setReview(null);
    setReviewedCode("");
    setTests(null);
    setTestsError(null);
    setMessages([]);
    setAskError(null);
    setLastAsk(null);
    setFilter("all");
    setExpandedId(null);
    setError(null);
    setTab("ask");
  }

  function loadSample(id: SampleInput["id"]) {
    const sample = SAMPLES.find((item) => item.id === id);
    if (!sample) return;
    setCode(sample.code);
    setFilename(sample.filename);
    setLanguage(sample.language);
    resetResults();
    setNotice(
      `Loaded the bundled ${sample.label.toLowerCase()}. ${sample.description} Results are labelled by the active provider mode.`,
    );
  }

  function clearSubmission() {
    setCode("");
    setFilename("");
    resetResults();
    setNotice(null);
  }

  async function analyze() {
    if (reviewing || code.trim().length < 10 || code.length > limit) return;
    const submitted = code;
    setReviewing(true);
    setError(null);
    setAskError(null);

    try {
      const result = await postJson<ReviewResult>("/api/review", {
        code: submitted,
        filename: filename.trim() || undefined,
        language: language === "auto" ? undefined : language,
      });
      setReview(result);
      if (result.mode === "live") setLiveVerifiedAt(new Date().toISOString());
      setReviewedCode(submitted);
      setTests(null);
      setMessages([]);
      setLastAsk(null);
      setFilter("all");
      setExpandedId(result.findings[0]?.id ?? null);
      setTab("ask");
    } catch (caught) {
      setError(toUiError(caught, "review"));
    } finally {
      setReviewing(false);
    }
  }

  async function ask(text?: string, echo = true) {
    const content = (text ?? question).trim();
    if (!canAsk || asking || content.length < 3) return;

    if (echo) {
      setMessages((previous) => [...previous, { role: "user", content }]);
    }
    setQuestion("");
    setAskError(null);
    setAsking(true);

    try {
      const result = await postJson<AskResult>("/api/ask", {
        code,
        question: content,
        findings: compactFindings(review, stale),
        history: messages
          .slice(-6)
          .map((message) => ({ role: message.role, content: message.content })),
      });
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: result.answer,
          meta: `${result.mode === "live" ? "Live" : "Sample"} · ${result.provider.modelName}`,
        },
      ]);
      if (result.mode === "live") setLiveVerifiedAt(new Date().toISOString());
      setLastAsk(null);
    } catch (caught) {
      setAskError(toUiError(caught, "ask").message);
      setLastAsk(content);
    } finally {
      setAsking(false);
    }
  }

  async function generateTests() {
    if (!canAsk || testing) return;
    setTesting(true);
    setTestsError(null);
    setError(null);
    setTab("tests");

    try {
      const result = await postJson<TestResult>("/api/tests", {
        code,
        language: language === "auto" ? undefined : language,
        findings: compactFindings(review, stale),
      });
      setTests(result);
      if (result.mode === "live") setLiveVerifiedAt(new Date().toISOString());
    } catch (caught) {
      // Keep any previous test suggestions; show the failure next to them.
      setTestsError(toUiError(caught, "tests").message);
    } finally {
      setTesting(false);
    }
  }

  function retry() {
    if (!error) return;
    const action = error.action;
    setError(null);
    if (action === "review") void analyze();
    else if (action === "tests") void generateTests();
    else if (lastAsk) void ask(lastAsk, false);
  }

  function downloadReport() {
    if (!review || !report) return;
    const blob = new Blob([report], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `patchpilot-${review.id}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-line/80 bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1500px] items-center gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <LogoMark className="size-8 shrink-0" />
            <div className="min-w-0">
              <p className="text-[15px] font-semibold leading-5 tracking-tight text-ink">PatchPilot</p>
              <p className="hidden text-[10.5px] leading-4 text-faint sm:block">
                Evidence-checked AI code review
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setStatusOpen(true)}
              className="hidden sm:inline-flex"
            >
              <BookIcon className="size-3.5" />
              Integrations
            </Button>
            <button
              type="button"
              onClick={() => setStatusOpen(true)}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-panel px-2.5 text-[11.5px] text-muted transition-colors hover:border-accent/40 hover:text-ink"
              aria-label={`AI provider status: ${
                isLive
                  ? liveVerified
                    ? "live verified"
                    : "live configured, not yet verified"
                  : "sample mode"
              }. Open details.`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  isLive && liveVerified ? "bg-accent" : "bg-medium"
                }`}
                aria-hidden
              />
              <span className="font-medium text-ink">
                {isLive ? (liveVerified ? "Live verified" : "Live configured") : "Sample mode"}
              </span>
              <span className="hidden max-w-[170px] truncate font-mono text-[10px] text-faint lg:inline">
                {status.provider.modelName}
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 pb-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3 pb-3 pt-5">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-ink sm:text-[26px] sm:leading-8">
              Review code with evidence, not vibes.
            </h1>
            <p className="mt-1 max-w-2xl text-[12.5px] leading-5 text-muted">
              Paste a diff, run an open-model review, and inspect findings whose quoted evidence is
              checked against your code. Ask follow-ups, generate tests, and export a Markdown report.
            </p>
          </div>
          <div className="hidden items-center gap-1.5 lg:flex">
            <Chip tone="accent">
              <CheckIcon className="size-3" />
              Evidence-checked
            </Chip>
            <Chip>
              <CodeIcon className="size-3" />
              Schema validated
            </Chip>
            <Chip>
              <ShieldIcon className="size-3" />
              Never executed
            </Chip>
          </div>
        </div>

        <div
          className={`mb-3 flex flex-wrap items-center gap-2 rounded border px-3 py-2 text-[12px] leading-5 ${
            isLive && liveVerified
              ? "border-accent/25 bg-accent-soft/40 text-muted"
              : "border-medium/30 bg-medium/[0.07] text-muted"
          }`}
        >
          {isLive && liveVerified ? (
            <CheckIcon className="size-3.5 shrink-0 text-accent" />
          ) : (
            <AlertIcon className="size-3.5 shrink-0 text-medium" />
          )}
          <p className="min-w-0 flex-1">
            {isLive ? (
              liveVerified ? (
                <>
                  <span className="font-medium text-ink">Live model verified.</span>{" "}
                  {status.provider.label} · {status.provider.modelName} (
                  {status.provider.license}). Last successful request{" "}
                  {liveVerifiedAt ? new Date(liveVerifiedAt).toLocaleTimeString() : ""}. Requests
                  run server-side.
                </>
              ) : (
                <>
                  <span className="font-medium text-medium">
                    Live provider configured — not yet verified.
                  </span>{" "}
                  {status.provider.label} · {status.provider.modelName} (
                  {status.provider.license}
                  {status.provider.licenseVerified ? "" : ", unverified"}). A configured key is not
                  proof: run a review to confirm a successful model response.
                </>
              )
            ) : (
              <>
                <span className="font-medium text-medium">Sample mode — no model call is made.</span>{" "}
                {status.provider.reason ??
                  "No model credentials are configured; deterministic rules produce the findings."}{" "}
                Set <code className="font-mono text-[11px] text-ink">PATCHPILOT_PROVIDER=alan</code>{" "}
                with <code className="font-mono text-[11px] text-ink">ALAN_API_KEY</code>, or add{" "}
                <code className="font-mono text-[11px] text-ink">OPENROUTER_API_KEY</code>.
              </>
            )}
            <span className="mt-1 block font-mono text-[10.5px] text-faint">
              Current request: {busy ? "running" : error ? "failed" : "idle"} · Last successful live
              request:{" "}
              {liveVerifiedAt
                ? new Date(liveVerifiedAt).toLocaleTimeString()
                : "none in this session"}
            </span>
          </p>
          <Button size="sm" variant="ghost" onClick={() => setStatusOpen(true)}>
            {isLive ? (liveVerified ? "Details" : "Verify setup") : "How to enable"}
          </Button>
        </div>

        {error ? (
          <div
            role="alert"
            className="mb-3 flex flex-wrap items-start gap-2 rounded border border-critical/30 bg-critical/[0.07] px-3 py-2"
          >
            <AlertIcon className="mt-0.5 size-4 shrink-0 text-critical" />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] leading-5 text-critical">{error.message}</p>
              {error.code ? (
                <p className="mt-0.5 font-mono text-[10px] text-faint">{error.code}</p>
              ) : null}
            </div>
            {error.retryable ? (
              <Button size="sm" variant="secondary" onClick={retry}>
                <RefreshIcon className="size-3.5" />
                Retry
              </Button>
            ) : null}
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
              className="rounded p-1 text-faint hover:bg-white/[0.04] hover:text-ink"
            >
              <CloseIcon className="size-3.5" />
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-5 xl:sticky xl:top-[76px] xl:col-span-4 xl:self-start">
            <EditorPanel
              code={code}
              onCodeChange={setCode}
              filename={filename}
              onFilenameChange={setFilename}
              language={language}
              onLanguageChange={setLanguage}
              onAnalyze={analyze}
              onClear={clearSubmission}
              onLoadSample={loadSample}
              loading={reviewing}
              limit={limit}
              sampleId={sampleId}
              notice={notice}
              onDismissNotice={() => setNotice(null)}
            />
          </div>

          <div className="min-w-0 lg:col-span-7 xl:col-span-5">
            <FindingsPanel
              review={review}
              loading={reviewing}
              filter={filter}
              onFilter={setFilter}
              expandedId={expandedId}
              onToggle={(id) => setExpandedId((current) => (current === id ? null : id))}
              stale={stale}
              onReanalyze={analyze}
              onLoadSample={loadSample}
              onOpenAbout={() => setStatusOpen(true)}
            />
          </div>

          <div className="min-w-0 lg:col-span-12 xl:col-span-3">
            <ReviewSidebar
              review={review}
              messages={messages}
              question={question}
              onQuestionChange={setQuestion}
              onAsk={ask}
              asking={asking}
              askError={askError}
              onRetryAsk={() => {
                if (lastAsk) void ask(lastAsk, false);
              }}
              tests={tests}
              testing={testing}
              testsError={testsError}
              onRetryTests={() => void generateTests()}
              onGenerateTests={generateTests}
              report={report}
              onDownloadReport={downloadReport}
              tab={tab}
              onTabChange={setTab}
              canAsk={canAsk}
              providerMode={status.provider.mode}
              providerLabel={status.provider.label}
            />
          </div>
        </div>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-[11px] text-faint">
          <p>
            PatchPilot · MIT licensed · built for the{" "}
            <a
              href="https://luma.com/2k6cxr0n"
              target="_blank"
              rel="noreferrer noopener"
              className="text-muted hover:text-ink"
            >
              OpenFire Hackathon
            </a>{" "}
            with Alan Code.
          </p>
          <p>AI suggestions, not a security audit. Your code is never executed.</p>
        </footer>
      </main>

      <StatusDialog
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        status={status}
        liveVerifiedAt={liveVerifiedAt}
      />
    </div>
  );
}