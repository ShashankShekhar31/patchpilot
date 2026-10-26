"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import type { PublicStatus } from "@/lib/ai/config";
import { Chip, CopyButton, Modal, SectionLabel } from "./ui";
import { AlertIcon, CheckIcon, ExternalIcon, ShieldIcon } from "./icons";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-line/70 py-1.5 last:border-b-0">
      <dt className="text-[11px] text-faint">{label}</dt>
      <dd className="min-w-0 text-[12px] text-muted">{children}</dd>
    </div>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded border border-line bg-canvas px-1 py-0.5 font-mono text-[10.5px] text-ink">
      {children}
    </code>
  );
}

const subscribeToOrigin = () => () => {};

function ConnectorUrl({ path }: { path: string }) {
  const origin = useSyncExternalStore(
    subscribeToOrigin,
    () => window.location.origin,
    () => "",
  );
  const url = origin ? `${origin}${path}` : path;

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Code>{url}</Code>
      <CopyButton value={url} label="Copy URL" size="sm" variant="ghost" className="h-6 px-1.5" />
    </span>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 text-accent hover:underline"
    >
      {children}
      <ExternalIcon className="size-3" />
    </a>
  );
}

export function StatusDialog({
  open,
  onClose,
  status,
  liveVerifiedAt,
}: {
  open: boolean;
  onClose: () => void;
  status: PublicStatus;
  liveVerifiedAt: string | null;
}) {
  const { provider, alan, limits } = status;
  const isLive = provider.mode === "live";
  const liveVerified = liveVerifiedAt !== null;

  return (
    <Modal open={open} onClose={onClose} title="AI provider and Alan integration" wide>
      <div className="grid gap-5">
        <section>
          <div className="mb-2 flex items-center gap-2">
            <SectionLabel>Runtime AI</SectionLabel>
            <Chip tone={isLive ? "accent" : "warning"}>
              {isLive ? (liveVerified ? "Live verified" : "Live configured") : "Sample data"}
            </Chip>
          </div>

          <div className="rounded border border-line bg-canvas px-3 py-1">
            <dl>
              <Row label="Provider">{provider.label}</Row>
              <Row label="Model">
                <span className="text-ink">{provider.modelName}</span>{" "}
                <span className="font-mono text-[10.5px] text-faint">{provider.model}</span>
              </Row>
              <Row label="License">
                {provider.licenseUrl ? (
                  <ExternalLink href={provider.licenseUrl}>{provider.license}</ExternalLink>
                ) : (
                  <span>{provider.license}</span>
                )}
                {provider.licenseVerified ? (
                  <span className="ml-1 inline-flex items-center gap-1 text-accent">
                    <CheckIcon className="size-3" /> verified at source
                  </span>
                ) : (
                  <span className="ml-1 text-medium">not independently verified</span>
                )}
              </Row>
              <Row label="Endpoint host">
                <span className="font-mono text-[10.5px]">{provider.baseUrlHost}</span>
              </Row>
              <Row label="Server credential">
                {provider.credentialSource === "none" ? (
                  <span>None</span>
                ) : (
                  <Code>{provider.credentialSource}</Code>
                )}
                {provider.credentialSource === "ALAN_CODE_API_KEY" ? (
                  <span className="ml-1 text-medium">
                    session-scoped; set <Code>ALAN_API_KEY</Code> for deployment
                  </span>
                ) : null}
              </Row>
              <Row label="Last live request">
                {liveVerifiedAt
                  ? new Date(liveVerifiedAt).toLocaleString()
                  : "None in this browser session"}
              </Row>
              <Row label="Limits">
                {limits.maxInputChars.toLocaleString()} input chars · {limits.maxOutputTokens.toLocaleString()} output
                tokens · {(limits.timeoutMs / 1000).toFixed(0)}s timeout
              </Row>
            </dl>
          </div>

          {isLive ? (
            <p className="mt-2 text-[11.5px] leading-5 text-faint">
              Live means a server-side credential is configured. That is not treated as proof: the
              status switches to <span className="text-ink">Live verified</span> only after a real
              model response succeeds in this browser session. Keys are never sent to the browser.
            </p>
          ) : (
            <div className="mt-2 rounded border border-medium/30 bg-medium/[0.06] px-3 py-2 text-[11.5px] leading-5 text-medium">
              <span className="font-medium">Sample mode is active.</span>{" "}
              {provider.reason ??
                "No model credentials are configured, so PatchPilot uses deterministic local rules."}{" "}
              No model request is made, and results are labelled as sample data everywhere.
            </div>
          )}

          <div className="mt-2 rounded border border-line bg-canvas p-2.5">
            <p className="text-[11px] font-medium text-muted">Enable live open-model analysis</p>
            <p className="mt-1 text-[11px] leading-5 text-faint">
              Set these in <Code>.env.local</Code> (never commit them) and restart the server:
            </p>
            <div className="mt-1.5 grid gap-1 font-mono text-[10.5px] text-ink">
              <span>PATCHPILOT_PROVIDER=alan</span>
              <span>ALAN_API_KEY=...</span>
              <span>ALAN_MODEL=deepseek/deepseek-v4.1-flash</span>
            </div>
            <p className="mt-1.5 text-[11px] leading-5 text-faint">
              The Alan harness base URL defaults to{" "}
              <Code>https://api.tryalan.ai/public/harness/v1</Code>. For local development the
              session&apos;s <Code>ALAN_CODE_API_KEY</Code> can be used; for deployment supply{" "}
              <Code>ALAN_API_KEY</Code>. OpenRouter remains a fallback:{" "}
              <Code>OPENROUTER_API_KEY</Code> and <Code>OPENROUTER_MODEL</Code>.
            </p>
            <p className="mt-1.5 text-[11px] leading-5 text-faint">
              Any OpenAI-compatible server (vLLM, Ollama, LM Studio, Groq, Together) also works with{" "}
              <Code>LLM_BASE_URL</Code>, <Code>LLM_MODEL</Code>, and optionally <Code>LLM_API_KEY</Code>.
            </p>
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center gap-2">
            <SectionLabel>Alan</SectionLabel>
            <Chip tone="accent">Built with Alan Code</Chip>
          </div>

          <div className="rounded border border-line bg-canvas px-3 py-1">
            <dl>
              <Row label="Build agent">
                Alan Code · <span className="text-ink">DeepSeek V4.1 Flash</span>{" "}
                <ExternalLink href={alan.buildModelLicenseUrl}>MIT</ExternalLink>
              </Row>
              <Row label="Runtime provider">
                {alan.runtimeProvider === "alan-harness" ? (
                  <>
                    <span className="text-ink">Alan harness</span>
                    <span className="ml-1 text-accent">verified by a real request</span>
                    {alan.harnessEndpoint ? (
                      <>
                        {" "}
                        · <Code>{alan.harnessEndpoint}</Code>
                      </>
                    ) : null}
                  </>
                ) : alan.runtimeProvider === "external" ? (
                  <>{provider.label} through PatchPilot&apos;s provider interface</>
                ) : (
                  <span className="text-medium">Not configured; sample mode active</span>
                )}
              </Row>
              <Row label="Runtime API">
                No documented public app-inference API or SDK. The harness endpoint is the same
                OpenAI-compatible provider Alan Code itself uses. It is configured locally and is not
                advertised as a stable public API.
              </Row>
              <Row label="MCP connector">
                <ConnectorUrl path={alan.connectorPath} />{" "}
                {alan.connectorEnabled ? (
                  <span className="ml-1 text-accent">enabled</span>
                ) : (
                  <span className="ml-1 text-medium">disabled in production until a token is set</span>
                )}
                {alan.connectorTokenRequired ? (
                  <span className="ml-1 text-faint">· bearer token required</span>
                ) : null}
              </Row>
              <Row label="Alan webhook">
                Custom Webhook triggers are marked “coming soon” in Alan’s docs, so no workflow
                depends on them.
              </Row>
            </dl>
          </div>

          <div className="mt-2 rounded border border-accent/20 bg-accent-soft/40 p-2.5">
            <p className="text-[11px] font-medium text-ink">Connect PatchPilot to an Alan agent</p>
            <ol className="mt-1 grid list-decimal gap-1 pl-4 text-[11px] leading-5 text-muted">
              <li>
                In Alan, open <span className="text-ink">Settings → your team → Plugins → MCP</span>.
              </li>
              <li>
                Choose <span className="text-ink">Add custom connector</span> and paste{" "}
                <ConnectorUrl path={alan.connectorPath} />.
              </li>
              <li>
                If <Code>PATCHPILOT_MCP_TOKEN</Code> is set, add it as a bearer token. In production
                the connector stays disabled without it.
              </li>
              <li>
                Ask the agent to review a diff with PatchPilot. It can call{" "}
                <Code>review_diff</Code>, <Code>generate_tests</Code>, and{" "}
                <Code>ask_review_question</Code>.
              </li>
            </ol>
            <div className="mt-1.5 flex flex-wrap gap-3">
              <ExternalLink href={alan.docsUrl}>Alan MCP documentation</ExternalLink>
              <ExternalLink href="https://tryalan.ai">tryalan.ai</ExternalLink>
              <ExternalLink href="https://luma.com/2k6cxr0n">OpenFire Hackathon</ExternalLink>
            </div>
          </div>

          <p className="mt-2 text-[11px] leading-5 text-faint">
            Runtime review inference can use the Alan harness with DeepSeek V4.1 Flash, an
            MIT-licensed open-weight model. A bounded verification request returned HTTP 200 on
            2026-10-26. Because the harness is not a documented public API, PatchPilot keeps
            OpenRouter and generic OpenAI-compatible adapters as fallbacks. Alan agents can also call
            PatchPilot back over MCP.
          </p>
        </section>

        <section>
          <div className="mb-2 flex items-center gap-2">
            <SectionLabel>Safety and scope</SectionLabel>
            <ShieldIcon className="size-3.5 text-accent" />
          </div>
          <ul className="grid gap-1.5 text-[11.5px] leading-5 text-muted">
            <li className="flex gap-2">
              <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-accent" />
              Submitted code is treated as untrusted text. It is never executed, evaluated, or
              installed.
            </li>
            <li className="flex gap-2">
              <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-accent" />
              Every finding must quote a verbatim excerpt. Locations are recomputed from the parsed
              diff or source; unsupported findings are dropped.
            </li>
            <li className="flex gap-2">
              <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-accent" />
              API keys stay server-side. Request bodies, prompts, and model output are not logged.
            </li>
            <li className="flex gap-2">
              <AlertIcon className="mt-0.5 size-3.5 shrink-0 text-medium" />
              Findings are AI suggestions, not verified vulnerabilities. Evidence matching proves the
              quote exists, not that the issue is exploitable.
            </li>
          </ul>
        </section>

        <p className="border-t border-line pt-3 font-mono text-[10px] text-faint">
          PatchPilot v{status.version} · status checked {new Date(status.checkedAt).toLocaleString()}
        </p>
      </div>
    </Modal>
  );
}