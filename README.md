# PatchPilot

**Evidence-checked AI code review for diffs and pasted source.**

Paste a unified diff or a source file. PatchPilot returns severity-ranked findings, but only after checking that each finding's quoted evidence actually exists at the line it claims. You can then ask follow-up questions, generate focused test suggestions, and export a Markdown review report.

Built for the **OpenFire Hackathon** (Alan + open models).

- **Live app:** <https://patchpilot-gamma.vercel.app>
- **Repository:** <https://github.com/ShashankShekhar31/patchpilot>

## The problem

Reviews from LLMs are easy to get and hard to trust. A confident-sounding finding can cite a line that does not exist, paraphrase code that was never submitted, or hallucinate a file entirely. PatchPilot's core idea is simple: **a finding is only shown if its evidence is verifiable in the code you pasted.**

## Features

| Feature | What it does |
| --- | --- |
| Diff or source input | Accepts a unified diff (auto-detected) or plain source, with an optional filename hint and language tag. Two bundled samples: a buggy checkout diff and an order module. |
| Evidence-checked findings | Every finding must quote a verbatim excerpt. PatchPilot re-parses the diff, recomputes the real file and line range for that excerpt, and **drops findings whose evidence is not found**. |
| Severity model | `critical`, `high`, `medium`, `low`, `info`, with counts, filters, confidence, category, explanation, and a suggested fix. |
| Ask follow-ups | Answers questions about the submitted code and the verified findings (fix order, security, tests, scope). |
| Generate Tests | Up to three structured test suggestions: title, test type, setup, expected result, and which finding it covers. Built from the top findings plus minimal code context. |
| Markdown report | Deterministic render of the review with metadata, counts, evidence, fixes, warnings, limitations, and a disclaimer. Preview, copy, or download. |
| Honest status | The UI separates **Live configured** (credential present) from **Live verified** (a real model response actually succeeded). |
| Alan MCP connector | Exposes `review_diff`, `generate_tests`, and `ask_review_question` so Alan agents can call PatchPilot over MCP. |
| Sample mode | Deterministic local rules with a visible "Sample mode" label. Never presented as model output. |

## Current production state

`/api/status` on the deployed app reports **sample mode**:

```
provider.kind      demo
provider.mode      sample
credentialSource   none
reason             OPENROUTER_API_KEY is missing, so PatchPilot fell back to sample mode.
```

The production deployment is intentionally running deterministic sample rules because no model-provider key is configured there yet. Everything in the app is labelled accordingly. Adding `OPENROUTER_API_KEY` in Vercel (see below) switches it to live inference on the next deployment.

## AI providers

PatchPilot talks to any OpenAI-compatible chat-completions endpoint through a small provider abstraction, so it is not tied to one vendor.

### Supported providers

| `PATCHPILOT_PROVIDER` | Endpoint | Notes |
| --- | --- | --- |
| `openrouter` | `https://openrouter.ai/api/v1` | Recommended for deployment. Default model `qwen/qwen3-coder` (Qwen3-Coder 480B A35B Instruct, **Apache-2.0**). |
| `openai-compatible` | Your `LLM_BASE_URL` | vLLM, Ollama, LM Studio, Groq, Together, or any compatible server. |
| `alan` | Alan harness | Uses the OpenAI-compatible endpoint that Alan Code itself uses. Not a documented public API; see below. |
| `demo` | none | Deterministic rules. No network request. |

### Alan harness (hackathon context)

During development, a bounded request against the Alan Code harness returned **HTTP 200** with model `deepseek-v4.1-flash-fast`:

```
https://api.tryalan.ai/public/harness/v1/chat/completions
model: deepseek/deepseek-v4.1-flash
```

DeepSeek V4.1 Flash is **MIT-licensed open weights**: <https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash>.

Important caveats, stated plainly:

- Alan's public documentation describes **no public inference API, no API-key issuance page, and no durable harness credential**.
- The harness is configured by the Alan Code desktop agent and authenticated with a **session-scoped** key. That key is not deployable and is deliberately not used or stored by this repository.
- Therefore production should use `openrouter` or `openai-compatible` with a durable key that you control.

Alan's documented path to a durable open-model credential is "bring your own provider key" (**Settings → team → Alan Agent → Custom provider**). PatchPilot supports that key server-side.

## Architecture

```
Browser (React client components)
   │  fetch /api/*
   ▼
Next.js App Router route handlers (Node runtime)
   ├── /api/review  ─┐
   ├── /api/ask      ├── lib/ai/review-service.ts ── provider (OpenAI-compatible HTTP)
   ├── /api/tests   ─┘        │
   │                          ├── lib/ai/prompts.ts      bounded prompts
   │                          ├── lib/ai/context.ts      minimal relevant excerpts
   │                          ├── lib/ai/parse.ts        tolerant JSON extraction + Zod
   │                          └── lib/diff.ts / lib/evidence.ts   evidence verification
   ├── /api/status  ──── lib/ai/config.ts (provider + public status, no secrets)
   └── /api/mcp     ──── lib/mcp/handler.ts (MCP tools for Alan agents)
```

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Zod 4 · Vitest 5. No database, no auth, no separate backend service.

**Design constraints that shaped it:**

- Server-side only credentials; nothing model-related is exposed to the client bundle.
- Input caps (`PATCHPILOT_MAX_INPUT_CHARS`), prompt caps (`PATCHPILOT_MAX_PROMPT_CHARS`), per-attempt timeout, and a whole-request deadline.
- At most one transient retry; truncation and schema failures are not retried in a loop.
- Submitted code is untrusted text: never executed, evaluated, or installed.
- Request bodies, prompts, and model output are never logged.

## Local setup

Requires **Node.js 20.9+** and **pnpm 10**.

```bash
git clone https://github.com/ShashankShekhar31/patchpilot.git
cd patchpilot
pnpm install
cp .env.example .env.local   # then fill in one provider (or leave empty for sample mode)
pnpm dev
```

Open <http://localhost:3000>. Click **Diff sample** and **Analyze changes** to see the evidence-checked review of the bundled buggy checkout module.

Without any credentials the app runs in sample mode and needs no network access.

## Environment variables

All are server-side. Never prefix a credential with `NEXT_PUBLIC_`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PATCHPILOT_PROVIDER` | auto | `alan`, `openrouter`, `openai-compatible`, or `demo` |
| `ALAN_API_KEY` | – | Durable Alan harness key, only if Alan provides one |
| `ALAN_MODEL` | `deepseek/deepseek-v4.1-flash` | Harness model id |
| `ALAN_BASE_URL` | `https://api.tryalan.ai/public/harness/v1` | Harness base URL |
| `ALAN_CONVERSATION_ID` | – | Optional harness header |
| `OPENROUTER_API_KEY` | – | OpenRouter key |
| `OPENROUTER_MODEL` | `qwen/qwen3-coder` | OpenRouter model id |
| `LLM_BASE_URL` | – | OpenAI-compatible base URL |
| `LLM_MODEL` | – | Model id for that endpoint |
| `LLM_API_KEY` | – | Key for that endpoint (if required) |
| `LLM_LABEL`, `LLM_NAME`, `LLM_LICENSE`, `LLM_LICENSE_URL` | – | Optional display metadata |
| `LLM_JSON_MODE` | `on` | Set `off` if the server rejects `response_format` |
| `PATCHPILOT_MAX_INPUT_CHARS` | `60000` | Max submission size |
| `PATCHPILOT_MAX_PROMPT_CHARS` | `24000` | Max submission chars embedded in one prompt |
| `PATCHPILOT_MAX_OUTPUT_TOKENS` | `2400` | Requested response budget |
| `PATCHPILOT_TIMEOUT_MS` | `35000` | One upstream HTTP attempt |
| `PATCHPILOT_DEADLINE_MS` | `45000` | Whole request, including retries |
| `PATCHPILOT_MCP_TOKEN` | – | Bearer token required for `/api/mcp` in production |

Local-only behaviour: when `PATCHPILOT_PROVIDER=alan` and `ALAN_API_KEY` is absent, PatchPilot may fall back to the local Alan Code session's `ALAN_CODE_API_KEY`. That fallback is never used implicitly, is reported in `/api/status` as `credentialSource: ALAN_CODE_API_KEY`, and is not a deployment strategy.

## Commands

```bash
pnpm dev         # development server
pnpm build       # production build
pnpm start       # run the production build
pnpm test        # Vitest (unit + API route + component tests)
pnpm lint        # ESLint
pnpm typecheck   # tsc --noEmit
```

End-to-end check against any running instance:

```bash
# deployed
BASE_URL=https://patchpilot-gamma.vercel.app node --experimental-strip-types scripts/e2e-check.mjs

# local production build
BASE_URL=http://127.0.0.1:3000 node --experimental-strip-types scripts/e2e-check.mjs
```

The script prints provider mode, finding counts, evidence verification, Ask answers, and test-suggestion counts. It never prints credentials.

`scripts/mock-openai-server.mjs` is a local plumbing stub that returns fixed JSON to test the provider path without a hosted model. It is **not** a model and must not be deployed.

## API

### `GET /api/status`

Public, secret-free provider metadata: `provider.kind`, `mode` (`live`/`sample`), model, license and whether it was verified, credential source enum, limits, and Alan/MCP status.

### `POST /api/review`

```json
{ "code": "diff --git ...", "filename": "src/checkout.ts", "language": "typescript", "focus": "all" }
```

Returns a validated `ReviewResult`: `summary`, `findings[]` (id, title, severity, category, file, lineStart/lineEnd, evidence, explanation, fix, confidence, `evidenceVerified`, `locationSource`), counts, warnings, limitations, mode, provider, usage, duration.

`focus` is optional: `all`, `security`, `bugs`, `tests`, `maintainability`.

### `POST /api/ask`

```json
{
  "code": "...",
  "question": "What should I fix first?",
  "findings": [{ "title": "...", "severity": "critical", "category": "security", "file": "src/checkout.ts", "lineStart": 9 }],
  "history": [{ "role": "user", "content": "..." }]
}
```

Returns `{ answer, mode, provider }`. In sample mode the answer is derived deterministically from the finding list and is prefixed with a clear sample-mode notice.

### `POST /api/tests`

```json
{
  "code": "...",
  "framework": "Vitest",
  "language": "typescript",
  "findings": [{ "title": "...", "severity": "high", "evidence": "..." }]
}
```

Returns at most three structured suggestions (`title`, `testType`, `setup`, `expected`, `finding`). Test code is not generated and tests are not executed.

### `POST /api/mcp`

JSON-RPC 2.0 MCP endpoint (Streamable HTTP, stateless). Tools: `review_diff`, `generate_tests`, `ask_review_question` — all read-only. Without `PATCHPILOT_MCP_TOKEN` it is disabled in production and returns `503`; with a token it requires `Authorization: Bearer <token>` and returns `401` otherwise.

Connect from Alan: **Settings → team → Plugins → MCP → Add custom connector** → `https://<deployment>/api/mcp`, with the bearer token.

Rate limits (per process, in memory): review 12/min, ask 20/min, tests 10/min, MCP 30/min.

## Evidence verification

This is the part worth reviewing closely.

1. **Parse.** The submission is parsed into a diff (files → hunks → lines with old/new numbers) or a numbered source file.
2. **Normalize the quote.** Model evidence is un-fenced, diff markers are stripped only when every non-empty line has one, and accidental line-number prefixes are removed. Real leading `-` or `+` characters in code are preserved.
3. **Locate.** The quote is matched line-by-line (whitespace-insensitive) against added lines first, then all lines, then removed lines, preferring the hinted file. A single-line partial match is allowed as a last resort and is annotated.
4. **Recompute.** `file`, `lineStart`, and `lineEnd` come from the parsed submission — never from the model. A finding about a removed line is annotated because the new-file line does not exist.
5. **Drop.** If the quote is not found, the finding is discarded and the review reports how many were dropped.
6. **Validate.** Findings are Zod-validated; severities and categories are normalized from common aliases; duplicates (same file + line + title) are removed.

## Known limitations

- Findings are **AI suggestions, not verified vulnerabilities**. Evidence matching proves the quote exists in your code; it does not prove exploitability, reachability, or that the fix is complete.
- Only the pasted diff/source is visible. Imports, callers, tests, and runtime configuration outside the submission are not considered.
- Prompt context is capped, so very large submissions are truncated (the review says so in its warnings and scope).
- Sampling limits: the model is asked for at most 6 findings, verified results are capped at 12, and at most 3 test suggestions are kept.
- Sample mode uses a small rule set (interpolation, `eval`, `innerHTML`, secret fallbacks, unguarded `JSON.parse`, empty catch, unchecked `fetch`, loose equality, page-offset math, missing tests). It is intentionally shallow and **cannot** conclude that code is safe. A guarded `try/catch` around `JSON.parse` and `== null` checks are exempted to avoid false positives.
- Rate limiting is per process; serverless cold starts reset it.
- No persistence, accounts, or team features. Reviews live only in the browser session.
- The Alan harness is undocumented and may change without notice.

## Deploy to Vercel

1. Import <https://github.com/ShashankShekhar31/patchpilot> in Vercel. Framework preset **Next.js**, root directory **`./`**, install `pnpm install`, build `pnpm build`, output `.next`, **Node.js 22.x**.
2. Add environment variables (Production):
   - Live: `PATCHPILOT_PROVIDER=openrouter`, `OPENROUTER_API_KEY=<your key>`, `OPENROUTER_MODEL=qwen/qwen3-coder`
   - or: `PATCHPILOT_PROVIDER=openai-compatible`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`
   - Always: `PATCHPILOT_MCP_TOKEN=<random string>` if you want the MCP connector
3. Deploy, then verify:
   ```bash
   curl -s https://<deployment>/api/status | jq '.provider.mode, .provider.kind'
   BASE_URL=https://<deployment> node --experimental-strip-types scripts/e2e-check.mjs
   ```
   Expect `provider.mode=live` **and** a successful review before describing the deployment as live inference.

The current deployment is `https://patchpilot-gamma.vercel.app` and is running sample mode as described above.

## Demo

- Demo script: [`docs/demo-script.md`](docs/demo-script.md) (about two minutes).
- No screenshots are committed to the repository. The live app is the demo link.

## Submission

Per the official OpenFire Hackathon page (<https://luma.com/2k6cxr0n>), a submission contains:

1. **An X post with a 1–3 minute demo.**
2. **A working link** — <https://patchpilot-gamma.vercel.app>
3. **A public GitHub open-source repo** — <https://github.com/ShashankShekhar31/patchpilot>

## Security

- Credentials are server-side only and read from environment variables at request time.
- `.env.local` is git-ignored; only `.env.example` with empty placeholders is committed.
- Submitted code is never executed.
- Public error responses carry a code and a safe message, never provider payloads.
- The MCP endpoint is bearer-token protected in production.

If you find a security issue, open a private report through the repository rather than a public issue.

## Contributing

Issues and pull requests are welcome. Please run `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` before opening a PR, keep changes scoped, and avoid adding dependencies unless necessary. New sample-mode rules must come with a regression test proving the false-positive case they avoid.

## License

MIT. See [`LICENSE`](LICENSE).
